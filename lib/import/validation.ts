import {
  ImportDraft,
  Issue,
  Rules,
  schemas,
  datasets,
  Validation,
  StandardData,
  Dataset,
} from "./types";
import { validISO, timeMinutes } from "./normalize";
const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const decimal = (s: string) =>
  /^\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s));
export function validateRules(r: Rules): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string, message: string) =>
    issues.push({ severity: "error", code: "rules", field, message });
  if (!r.reviewed) add("rules", "Review and confirm the scheduling rules.");
  if (!decimal(r.minRestHours) || +r.minRestHours > 168)
    add("minRestHours", "Enter a minimum rest period from 0 to 168 hours.");
  if (
    !/^\d+$/.test(r.maxShiftsPerWeek) ||
    +r.maxShiftsPerWeek < 1 ||
    +r.maxShiftsPerWeek > 168
  )
    add("maxShiftsPerWeek", "Enter a maximum from 1 to 168 shifts per week.");
  if (
    r.maxWeeklyHours &&
    (!decimal(r.maxWeeklyHours) ||
      +r.maxWeeklyHours <= 0 ||
      +r.maxWeeklyHours > 168)
  )
    add(
      "maxWeeklyHours",
      "The optional weekly limit must be greater than 0 and at most 168 hours.",
    );
  if (
    r.maxDailyHours &&
    (!decimal(r.maxDailyHours) ||
      +r.maxDailyHours <= 0 ||
      +r.maxDailyHours > 24)
  )
    add(
      "maxDailyHours",
      "The optional daily limit must be greater than 0 and at most 24 hours.",
    );
  try {
    if (!r.timezone) throw Error();
    new Intl.DateTimeFormat("en", { timeZone: r.timezone }).format(new Date());
  } catch {
    add("timezone", "Choose a valid IANA business timezone.");
  }
  const codes =
    typeof (Intl as any).supportedValuesOf === "function"
      ? (Intl as any).supportedValuesOf("currency")
      : ["USD", "EUR", "TRY", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "INR"];
  if (!codes.includes(r.currency))
    add("currency", "Choose a supported ISO currency code.");
  if (!validISO(r.weekStart))
    add("weekStart", "Choose a valid scheduling week start.");
  if (
    !Array.isArray(r.closedWeekdays) ||
    r.closedWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    add("closedWeekdays", "Closed weekdays must be valid weekday numbers.");
  if (typeof r.allowMultipleShifts !== "boolean")
    add(
      "allowMultipleShifts",
      "Confirm whether multiple shifts per day are allowed.",
    );
  return issues;
}
export function validateDraft(
  draft: ImportDraft,
  rules: Rules,
  scope?: Dataset,
): Validation {
  const issues: Issue[] = scope ? [] : [...validateRules(rules)];
  const data: StandardData = { employees: [], availability: [], shifts: [] };
  const add = (
    dataset: Dataset,
    record: number,
    field: string,
    message: string,
    severity: "error" | "warning" = "error",
    detail = "",
  ) =>
    issues.push({
      severity,
      code: "record",
      dataset,
      record,
      field,
      message,
      detail,
      source: draft[dataset][record]?.sources[0],
    });
  for (const dataset of datasets) {
    if ((!scope || scope === dataset) && !draft[dataset].length)
      issues.push({
        severity: "error",
        code: "empty",
        dataset,
        message: "This required dataset has no records.",
      });
    draft[dataset].forEach((row, index) => {
      for (const [field, message] of Object.entries(row.pending || {}))
        issues.push({
          severity: "error",
          code: "transformation",
          dataset,
          record: index,
          field,
          message,
          source: row.sources[0],
        });
      for (const field of schemas[dataset])
        if (!row.values[field]?.trim())
          add(dataset, index, field, "Required value is missing.");
      for (const [field, value] of Object.entries(row.values))
        if (/^[=+@\-]/.test(value))
          add(
            dataset,
            index,
            field,
            "Spreadsheet formula-like text is preserved. Import exports as text in spreadsheet software.",
            "warning",
          );
    });
  }
  const ids = new Set<string>(),
    roles = new Set<string>();
  draft.employees.forEach(({ values: v }, i) => {
    if (ids.has(v.employee_id))
      add(
        "employees",
        i,
        "employee_id",
        "Duplicate employee ID. Merge or remove the conflicting record.",
      );
    ids.add(v.employee_id);
    if (!decimal(v.hourly_rate))
      add(
        "employees",
        i,
        "hourly_rate",
        "Hourly rate must be a nonnegative decimal without currency symbols.",
      );
    if (
      !decimal(v.max_weekly_hours) ||
      +v.max_weekly_hours <= 0 ||
      +v.max_weekly_hours > 168
    )
      add(
        "employees",
        i,
        "max_weekly_hours",
        "Weekly hours must be greater than 0 and at most 168.",
      );
    let list: string[] = [];
    try {
      const parsed = JSON.parse(v.roles);
      if (
        !Array.isArray(parsed) ||
        !parsed.length ||
        parsed.some((x) => typeof x !== "string" || !x.trim())
      )
        throw Error();
      list = parsed.map((s: string) => s.trim());
      if (new Set(list).size !== list.length)
        add("employees", i, "roles", "Duplicate role names in the role list.");
      list.forEach((role) => roles.add(role));
    } catch {
      add(
        "employees",
        i,
        "roles",
        "Roles must be a nonempty JSON list of role names.",
      );
    }
    data.employees.push({
      employee_id: v.employee_id,
      name: v.name,
      hourly_rate: Number(v.hourly_rate),
      max_weekly_hours: Number(v.max_weekly_hours),
      roles: list,
    });
  });
  const shiftIds = new Set<string>(),
    availabilityKeys = new Set<string>();
  for (const dataset of ["availability", "shifts"] as const)
    draft[dataset].forEach(({ values: v }, i) => {
      if (!validISO(v.date))
        add(dataset, i, "date", "Date must be a real ISO date: YYYY-MM-DD.");
      if (!validTime(v.start_time))
        add(dataset, i, "start_time", "Time must use 24-hour HH:mm.");
      if (!validTime(v.end_time))
        add(dataset, i, "end_time", "Time must use 24-hour HH:mm.");
      if (v.end_date && !validISO(v.end_date))
        add(
          dataset,
          i,
          "end_date",
          "End date must be a real ISO date: YYYY-MM-DD.",
        );
      if (
        validISO(v.date) &&
        validTime(v.start_time) &&
        validTime(v.end_time) &&
        (!v.end_date || validISO(v.end_date))
      ) {
        const window = {
          date: v.date,
          start_time: v.start_time,
          end_time: v.end_time,
          end_date: v.end_date,
        };
        const duration = intervalEnd(window) - intervalStart(window);
        if (duration <= 0 || duration > 1440)
          add(
            dataset,
            i,
            "end_date",
            "Time windows must be positive and at most 24 hours. Overnight intervals require an explicit next-day end_date.",
          );
      }
      if (dataset === "availability") {
        if (!ids.has(v.employee_id))
          add(
            dataset,
            i,
            "employee_id",
            "Employee ID does not reference an imported employee.",
            scope && !draft.employees.length ? "warning" : "error",
          );
        if (!["available", "unavailable"].includes(v.status))
          add(
            dataset,
            i,
            "status",
            "Status must be explicitly available or unavailable.",
          );
        const key = JSON.stringify([
          ...schemas.availability.map((f) => v[f]),
          v.end_date || v.date,
        ]);
        if (availabilityKeys.has(key))
          add(
            dataset,
            i,
            "status",
            "Duplicate availability record. Remove the duplicate.",
          );
        availabilityKeys.add(key);
        data.availability.push({
          employee_id: v.employee_id,
          date: v.date,
          start_time: v.start_time,
          end_time: v.end_time,
          ...(v.end_date ? { end_date: v.end_date } : {}),
          status: v.status as "available" | "unavailable",
        });
      } else {
        if (shiftIds.has(v.shift_id))
          add(
            dataset,
            i,
            "shift_id",
            "Duplicate shift ID. Each role requirement needs a distinct ID.",
          );
        shiftIds.add(v.shift_id);
        if (
          !/^\d+$/.test(v.required_count) ||
          +v.required_count <= 0 ||
          !Number.isSafeInteger(+v.required_count)
        )
          add(
            dataset,
            i,
            "required_count",
            "Required count must be a positive integer.",
          );
        if (!roles.has(v.required_role))
          add(
            dataset,
            i,
            "required_role",
            "Required role does not match an imported employee role. Role names are case-sensitive.",
            scope && !draft.employees.length ? "warning" : "error",
          );
        if (!scope && validISO(v.date) && validISO(rules.weekStart)) {
          const start = Date.parse(rules.weekStart + "T00:00:00Z"),
            date = Date.parse(v.date + "T00:00:00Z");
          const end =
            intervalEnd({
              date: v.date,
              start_time: v.start_time,
              end_time: v.end_time,
              end_date: v.end_date,
            }) * 60000;
          if (
            date < start ||
            date >= start + 7 * 86400000 ||
            end > start + 7 * 86400000
          )
            add(
              dataset,
              i,
              "date",
              "Shift is outside the configured seven-day scheduling period.",
            );
          if (
            rules.closedWeekdays.includes(new Date(date).getUTCDay()) ||
            (v.end_date &&
              v.end_date !== v.date &&
              v.end_time !== "00:00" &&
              validISO(v.end_date) &&
              rules.closedWeekdays.includes(
                new Date(v.end_date + "T00:00:00Z").getUTCDay(),
              ))
          )
            add(
              dataset,
              i,
              "date",
              "A shift requirement falls on a configured closed weekday.",
            );
        }
        data.shifts.push({
          shift_id: v.shift_id,
          date: v.date,
          start_time: v.start_time,
          end_time: v.end_time,
          ...(v.end_date ? { end_date: v.end_date } : {}),
          required_count: Number(v.required_count),
          required_role: v.required_role,
        });
      }
    });
  const windows = new Map<string, number[]>();
  data.availability.forEach((v, i) => {
    const key = v.employee_id;
    const group = windows.get(key) || [];
    group.push(i);
    windows.set(key, group);
  });
  for (const group of windows.values()) {
    group.sort(
      (a, b) =>
        intervalStart(data.availability[a]) -
        intervalStart(data.availability[b]),
    );
    const active: Record<string, { end: number; index: number }> =
      Object.create(null);
    for (const i of group) {
      const v = data.availability[i];
      if (
        !validTime(v.start_time) ||
        !validTime(v.end_time) ||
        !validISO(v.date) ||
        (v.end_date && !validISO(v.end_date)) ||
        !["available", "unavailable"].includes(v.status)
      )
        continue;
      for (const status of ["available", "unavailable"])
        if (active[status] && active[status].end > intervalStart(v))
          add(
            "availability",
            i,
            "status",
            status !== v.status
              ? "Available and unavailable windows overlap. Split the windows or correct the conflict."
              : "Availability windows overlap with the same status.",
            status !== v.status ? "error" : "warning",
            `Record ${active[status].index + 1}`,
          );
      if (!active[v.status] || intervalEnd(v) > active[v.status].end)
        active[v.status] = { end: intervalEnd(v), index: i };
    }
  }
  const employeeAvailability = new Set(
    data.availability.map((a) => a.employee_id),
  );
  data.employees.forEach((e, i) => {
    if (!employeeAvailability.has(e.employee_id))
      add(
        "employees",
        i,
        "employee_id",
        "No availability was supplied for this employee. Missing availability remains unknown.",
        "warning",
      );
  });
  if (!scope && !issues.some((i) => i.severity === "error")) {
    const availabilityByEmployee = new Map<string, typeof data.availability>();
    for (const a of data.availability) {
      const list = availabilityByEmployee.get(a.employee_id) || [];
      list.push(a);
      availabilityByEmployee.set(a.employee_id, list);
    }
    data.shifts.forEach((s, i) => {
      let eligible = 0;
      for (const employee of data.employees) {
        if (!employee.roles.includes(s.required_role)) continue;
        const availability =
          availabilityByEmployee.get(employee.employee_id) || [];
        if (
          isAvailable(
            { ...data, availability },
            employee.employee_id,
            s.date,
            s.start_time,
            s.end_time,
            s.end_date,
          )
        )
          eligible++;
        if (eligible >= s.required_count) break;
      }
      if (eligible < s.required_count)
        add(
          "shifts",
          i,
          "required_count",
          "Known availability and roles cannot cover this requirement. Data is valid, but scheduling may be infeasible.",
          "warning",
          `${eligible} / ${s.required_count}`,
        );
    });
  }
  const resultIssues = scope
    ? issues.filter((i) => i.dataset === scope)
    : issues;
  return {
    issues: resultIssues,
    data,
    valid: !resultIssues.some((i) => i.severity === "error"),
  };
}
// Calendar-wall-time intervals. Timezone/DST elapsed-hour calculations belong to the future imported-data optimizer.
type Window = {
  date: string;
  start_time: string;
  end_time: string;
  end_date?: string;
};
export const intervalStart = (v: Window) =>
  Date.parse(v.date + "T00:00:00Z") / 60000 + timeMinutes(v.start_time);
export const intervalEnd = (v: Window) =>
  Date.parse((v.end_date || v.date) + "T00:00:00Z") / 60000 +
  timeMinutes(v.end_time);
export function isAvailable(
  data: StandardData,
  id: string,
  date: string,
  start: string,
  end: string,
  endDate?: string,
) {
  const requested = {
    date,
    start_time: start,
    end_time: end,
    end_date: endDate,
  };
  const from = intervalStart(requested),
    to = intervalEnd(requested);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
    return false;
  const windows = data.availability.filter((a) => a.employee_id === id);
  if (
    windows.some(
      (a) =>
        a.status === "unavailable" &&
        intervalStart(a) < to &&
        from < intervalEnd(a),
    )
  )
    return false;
  const yes = windows
    .filter((a) => a.status === "available")
    .sort((a, b) => intervalStart(a) - intervalStart(b));
  let covered = from;
  for (const w of yes) {
    if (intervalStart(w) > covered) break;
    if (intervalEnd(w) > covered) covered = intervalEnd(w);
    if (covered >= to) return true;
  }
  return false;
}
