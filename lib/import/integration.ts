import { Scenario } from "../model";
import { validateDraft } from "./validation";
import { AvailabilityRecord, Rules, SavedImport } from "./types";

type WallTime = { date: string; time: string };
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const wallCache = new Map<string, number>();

function formatter(timeZone: string) {
  let value = formatterCache.get(timeZone);
  if (!value) {
    try {
      value = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      throw Error("The scheduling timezone is not supported by this browser.");
    }
    formatterCache.set(timeZone, value);
  }
  return value;
}

function partsAt(epochMinute: number, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(new Date(epochMinute * 60000));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function wallMinutes(value: WallTime) {
  const [year, month, day] = value.date.split("-").map(Number);
  const [hour, minute] = value.time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

function candidates(value: WallTime, timeZone: string) {
  const cacheKey = `${timeZone}|${value.date}|${value.time}`;
  const cached = wallCache.get(cacheKey);
  if (cached !== undefined) return [cached];
  const target = wallMinutes(value);
  const offsets = new Set<number>();
  for (let hour = -48; hour <= 48; hour += 6) {
    const sample = target + hour * 60;
    offsets.add(wallMinutes(partsAt(sample, timeZone)) - sample);
  }
  const matches = [...offsets]
    .map((offset) => target - offset)
    .filter(
      (candidate) =>
        partsAt(candidate, timeZone).date === value.date &&
        partsAt(candidate, timeZone).time === value.time,
    )
    .sort((a, b) => a - b);
  return [...new Set(matches)];
}

function toInstant(value: WallTime, timeZone: string) {
  const matches = candidates(value, timeZone);
  if (matches.length !== 1)
    throw Error(
      matches.length
        ? `The local time ${value.date} ${value.time} is ambiguous in ${timeZone}; choose a different time or timezone.`
        : `The local time ${value.date} ${value.time} does not exist in ${timeZone}; correct the time or timezone.`,
    );
  wallCache.set(`${timeZone}|${value.date}|${value.time}`, matches[0]);
  return matches[0];
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dayStart(date: string, timeZone: string) {
  for (let minute = 0; minute < 1440; minute++) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const matches = candidates({ date, time }, timeZone);
    if (matches.length) return matches[0];
  }
  throw Error(
    `The calendar date ${date} does not exist in ${timeZone}; correct the scheduling period.`,
  );
}

function dateOffset(date: string, startDate: string) {
  return (
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
    86400000
  );
}

function intervalInstants(
  value: Pick<AvailabilityRecord, "date" | "start_time" | "end_time" | "end_date">,
  timeZone: string,
) {
  const start = toInstant(
    { date: value.date, time: value.start_time },
    timeZone,
  );
  const end = toInstant(
    { date: value.end_date || value.date, time: value.end_time },
    timeZone,
  );
  return { start, end };
}

function dailyMinutes(start: number, end: number, timeZone: string) {
  const daily: Record<string, number> = {};
  let cursor = start;
  while (cursor < end) {
    const date = partsAt(cursor, timeZone).date;
    const nextDay = dayStart(addDays(date, 1), timeZone);
    const segmentEnd = Math.min(end, nextDay);
    if (segmentEnd <= cursor)
      throw Error("A shift could not be divided across local calendar days.");
    daily[date] = (daily[date] || 0) + segmentEnd - cursor;
    cursor = segmentEnd;
  }
  return daily;
}

function isAvailable(
  windows: { start: number; end: number; status: AvailabilityRecord["status"] }[],
  shiftStart: number,
  shiftEnd: number,
) {
  if (
    windows.some(
      (window) =>
        window.status === "unavailable" &&
        window.start < shiftEnd &&
        shiftStart < window.end,
    )
  )
    return false;
  const available = windows
    .filter((window) => window.status === "available")
    .sort((a, b) => a.start - b.start);
  let covered = shiftStart;
  for (const window of available) {
    if (window.start > covered) break;
    if (window.end > covered) covered = window.end;
    if (covered >= shiftEnd) return true;
  }
  return false;
}

export function schedulingInput(saved: SavedImport, rules: Rules) {
  const check = validateDraft(saved.draft, rules);
  if (!check.valid || saved.rulesRevision !== JSON.stringify(rules))
    throw Error("Imported scheduling data requires validation.");
  if (check.data.employees.length > 30)
    throw Error(
      "Imported scheduling optimization supports at most 30 employees.",
    );
  if (check.data.shifts.length > 100)
    throw Error(
      "Imported scheduling optimization supports at most 100 shift requirements.",
    );

  const { data } = check;
  const availability = new Map<
    string,
    { start: number; end: number; status: AvailabilityRecord["status"] }[]
  >();
  data.availability.forEach((window) => {
    const employeeWindows = availability.get(window.employee_id) || [];
    employeeWindows.push({
      ...intervalInstants(window, rules.timezone),
      status: window.status,
    });
    availability.set(window.employee_id, employeeWindows);
  });
  const shifts = data.shifts.map((shift, index) => {
    const instants = intervalInstants(shift, rules.timezone);
    if (instants.end <= instants.start)
      throw Error(
        `Shift ${shift.shift_id} must end after it starts in the selected timezone.`,
      );
    return {
      id: index,
      day: dateOffset(shift.date, rules.weekStart),
      period: shift.required_role,
      start: shift.start_time,
      end: shift.end_time,
      required: shift.required_count,
      requiredRole: shift.required_role,
      date: shift.date,
      startAt: instants.start,
      endAt: instants.end,
      dailyMinutes: dailyMinutes(instants.start, instants.end, rules.timezone),
    };
  });
  const employees = data.employees.map((employee) => ({
    id: employee.employee_id,
    name: employee.name,
    wage: employee.hourly_rate,
    maxHours: Math.min(
      employee.max_weekly_hours,
      rules.maxWeeklyHours ? Number(rules.maxWeeklyHours) : Infinity,
    ),
    roles: [...employee.roles],
    availability: shifts.map((shift) =>
      isAvailable(
        availability.get(employee.employee_id) || [],
        shift.startAt,
        shift.endAt,
      ),
    ),
  }));
  const scenario: Scenario = {
    name: "Imported schedule",
    startDate: rules.weekStart,
    employees,
    shifts,
    constraints: {
      minRestMinutes: Number(rules.minRestHours) * 60,
      maxShiftsPerWeek: Number(rules.maxShiftsPerWeek),
      maxDailyHours: rules.maxDailyHours
        ? Number(rules.maxDailyHours)
        : null,
      allowMultipleShifts: rules.allowMultipleShifts === true,
    },
  };
  return {
    source: "import" as const,
    data,
    rules: structuredClone(rules),
    scenario,
    canOptimize: true as const,
  };
}
