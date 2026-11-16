export type Employee = {
  id: string;
  name: string;
  wage: number;
  maxHours: number;
  availability: boolean[];
};
export type Shift = {
  id: number;
  day: number;
  period: string;
  start: string;
  end: string;
  required: number;
};
export type Scenario = {
  name: string;
  startDate: string;
  employees: Employee[];
  shifts: Shift[];
};
export type Result = {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN";
  assignments: string[][];
  seconds: number;
  engine: string;
  messages: string[];
};
export const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export const duration = (s: Shift) => (minutes(s.end) - minutes(s.start)) / 60;
export const overlap = (a: Shift, b: Shift) =>
  a.day === b.day &&
  minutes(a.start) < minutes(b.end) &&
  minutes(b.start) < minutes(a.end);
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
export function dateFor(start: string, day: number) {
  const d = new Date(start + "T12:00:00Z");
  if (!Number.isFinite(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}
export function preset(name = "Retail Store"): Scenario {
  const names = [
    "Alex Morgan",
    "Jamie Chen",
    "Sam Rivera",
    "Taylor Brooks",
    "Jordan Lee",
    "Casey Patel",
    "Riley Davis",
    "Morgan Quinn",
    "Avery Kim",
    "Drew Ellis",
  ];
  const count = name === "Café" ? 6 : name === "Office" ? 10 : 8;
  const employees = names.slice(0, count).map((n, i) => ({
    id: `e${i}`,
    name: n,
    wage: [18, 20, 17, 22, 19, 21, 18.5, 24, 23, 19.5][i],
    maxHours:
      name === "Office"
        ? [24, 32, 40, 20, 32, 24, 40, 28, 20, 32][i]
        : name === "Café"
          ? 32
          : 32,
    availability: Array.from({ length: 14 }, (_, s) =>
      name === "Office" ? s < 10 : !((s + i * 3) % 11 === 0),
    ),
  }));
  const shifts = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    day: Math.floor(i / 2),
    period: i % 2 ? "Afternoon" : "Morning",
    start: i % 2 ? "13:00" : "09:00",
    end: i % 2 ? "17:00" : "13:00",
    required:
      name === "Office"
        ? i < 10
          ? 3
          : 0
        : name === "Café"
          ? i % 2 === 0
            ? 3
            : 2
          : i >= 10
            ? 3
            : 2,
  }));
  if (name === "Infeasible test") {
    employees.forEach((e) => (e.availability[0] = false));
  }
  return { name, startDate: "2026-11-16", employees, shifts };
}
export function inputErrors(p: Scenario): string[] {
  const errors: string[] = [];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(p.startDate) ||
    !Number.isFinite(Date.parse(p.startDate))
  )
    errors.push("Choose a valid scheduling start date.");
  if (new Set(p.employees.map((e) => e.id)).size !== p.employees.length)
    errors.push("Employee identifiers must be unique.");
  if (p.shifts.some((s, i) => s.day !== Math.floor(i / 2)))
    errors.push("Provide two ordered shifts per day.");
  if (!p.employees.length) errors.push("Add at least one employee.");
  if (p.employees.length > 30)
    errors.push("This prototype supports up to 30 employees.");
  if (p.shifts.length !== 14)
    errors.push("Provide exactly 14 shifts for the seven-day period.");
  p.employees.forEach((e) => {
    if (!e.name.trim()) errors.push("Every employee needs a name.");
    if (
      !Number.isFinite(e.wage) ||
      e.wage < 0 ||
      e.wage > 1000 ||
      Math.abs(e.wage * 100 - Math.round(e.wage * 100)) > 1e-6
    )
      errors.push(
        `${e.name}: wage must be $0–$1,000 with at most two decimals.`,
      );
    if (
      !Number.isFinite(e.maxHours) ||
      e.maxHours < 0 ||
      e.maxHours > 168 ||
      !Number.isInteger(e.maxHours * 60)
    )
      errors.push(`${e.name}: maximum hours must be 0–168 in whole minutes.`);
    if (e.availability.length !== 14)
      errors.push(`${e.name}: availability must cover all 14 shifts.`);
  });
  p.shifts.forEach((s) => {
    const label = `Day ${s.day + 1} ${s.period}`;
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) ||
      duration(s) <= 0
    )
      errors.push(
        `${label}: end time must be after start time on the same day.`,
      );
    if (!Number.isInteger(s.required) || s.required < 0 || s.required > 30)
      errors.push(`${label}: staffing must be a whole number from 0–30.`);
  });
  return [...new Set(errors)];
}
export function shortages(p: Scenario) {
  const m: string[] = [];
  p.shifts.forEach((s, i) => {
    const n = p.employees.filter(
      (e) => e.availability[i] && e.maxHours >= duration(s),
    ).length;
    if (n < s.required)
      m.push(
        `Day ${s.day + 1} ${s.period}: needs ${s.required}, but only ${n} eligible employees are available.`,
      );
  });
  const demand = p.shifts.reduce((n, s) => n + s.required * duration(s), 0),
    capacity = p.employees.reduce((n, e) => n + e.maxHours, 0);
  if (capacity < demand)
    m.push(
      `Weekly demand is ${demand} hours; employee limits provide only ${capacity} hours.`,
    );
  return m;
}
export function analyze(p: Scenario, assignments: string[][]) {
  const hours: Record<string, number> = Object.fromEntries(
    p.employees.map((e) => [e.id, 0]),
  );
  let totalCost = 0,
    covered = 0,
    required = 0;
  const daily = Array(7).fill(0);
  const violations: string[] = [];
  p.shifts.forEach((s, i) => {
    const ids = assignments[i] || [];
    required += s.required;
    covered += Math.min(ids.length, s.required);
    if (ids.length < s.required)
      violations.push(
        `Day ${s.day + 1} ${s.period}: ${s.required - ids.length} unfilled position(s).`,
      );
    if (new Set(ids).size !== ids.length)
      violations.push("Duplicate employee assignment.");
    ids.forEach((id) => {
      const e = p.employees.find((e) => e.id === id);
      if (!e) {
        violations.push("An assigned employee no longer exists.");
        return;
      }
      hours[id] += duration(s);
      const c = e.wage * duration(s);
      totalCost += c;
      daily[s.day] += c;
      if (!e.availability[i])
        violations.push(
          `${e.name} is unavailable for day ${s.day + 1} ${s.period}.`,
        );
      for (let j = 0; j < i; j++)
        if ((assignments[j] || []).includes(id) && overlap(s, p.shifts[j]))
          violations.push(
            `${e.name} has overlapping shifts on day ${s.day + 1}.`,
          );
    });
  });
  p.employees.forEach((e) => {
    if (hours[e.id] > e.maxHours + 1e-7)
      violations.push(
        `${e.name}: ${hours[e.id]}h exceeds the ${e.maxHours}h weekly limit.`,
      );
  });
  return {
    hours,
    totalCost,
    totalHours: Object.values(hours).reduce((a, b) => a + b, 0),
    daily,
    coverage: required ? (covered / required) * 100 : 100,
    violations,
  };
}
export function csv(
  p: Scenario,
  a: string[][],
  translate: (value: string) => string = (value) => value,
) {
  const rows = [
    [
      "Employee",
      "Date",
      "Shift",
      "Start",
      "End",
      "Hours",
      "Hourly wage (USD)",
      "Assignment cost (USD)",
    ].map(translate),
  ];
  p.shifts.forEach((s, i) =>
    (a[i] || []).forEach((id) => {
      const e = p.employees.find((e) => e.id === id);
      if (e)
        rows.push([
          e.name,
          dateFor(p.startDate, s.day),
          translate(s.period),
          s.start,
          s.end,
          String(duration(s)),
          e.wage.toFixed(2),
          (duration(s) * e.wage).toFixed(2),
        ]);
    }),
  );
  return rows
    .map((r) =>
      r
        .map(
          (v) => '"' + v.replace(/^[=+@\-]/, "'$&").replaceAll('"', '""') + '"',
        )
        .join(","),
    )
    .join("\r\n");
}
