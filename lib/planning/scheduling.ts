import {
  Scenario,
  Result,
  analyze,
  inputErrors,
  dateFor,
  duration,
} from "../model";
import { Sheet } from "./export";
// Verification of the current assignment, including manual edits; never reuses solver feasibility claims.
export function schedulingSheets(
  input: Scenario,
  result: Result,
  edited: boolean,
): Sheet[] {
  const a = analyze(input, result.assignments),
    errors = [...inputErrors(input), ...a.violations];
  if (result.assignments.length !== input.shifts.length)
    errors.push("Assignment vector length does not match the shift catalog.");
  const status = edited ? "MANUAL_EDIT" : result.status;
  const verified = !errors.length;
  return [
    {
      name: "Schedule verification",
      headers: ["solver_status", "verification", "check", "value"],
      rows: [
        [
          status,
          verified ? "passed" : "failed",
          "total_cost_USD",
          String(a.totalCost),
        ],
        [
          status,
          verified ? "passed" : "failed",
          "total_hours",
          String(a.totalHours),
        ],
        [
          status,
          verified ? "passed" : "failed",
          "coverage_percent",
          String(a.coverage),
        ],
        ...errors.map((e) => [status, "failed", e, ""]),
        [
          status,
          verified ? "passed" : "failed",
          "optimality",
          !edited && result.status === "OPTIMAL" && verified
            ? "solver-proven for this snapshot"
            : "not established for current assignments",
        ],
      ],
    },
    {
      name: "Schedule",
      headers: [
        "employee_id",
        "name",
        "date",
        "start_time",
        "end_time",
        "hours",
        "cost_USD",
        "verification",
      ],
      rows: input.shifts.flatMap((s, i) =>
        (result.assignments[i] || []).map((id) => {
          const e = input.employees.find((e) => e.id === id);
          return [
            id,
            e?.name || "",
            dateFor(input.startDate, s.day),
            s.start,
            s.end,
            String(duration(s)),
            e ? String(duration(s) * e.wage) : "",
            verified ? "passed" : "INVALID DRAFT",
          ];
        }),
      ),
    },
  ];
}
