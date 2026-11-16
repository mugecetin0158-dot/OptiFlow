import { Run, Scenario } from "./types";
import { writeCSV } from "../import/csv";
export type Sheet = { name: string; headers: string[]; rows: string[][] };
function chunks(text: string) {
  return text.match(/[\s\S]{1,30000}/g) || [""];
}
export function runSheets(run: Run): Sheet[] {
  const base = [
    run.id,
    run.scenarioId,
    run.status,
    run.verification?.verified ? "verified" : "not verified",
  ];
  const sheets: Sheet[] = [
    {
      name: "Run",
      headers: [
        "run_id",
        "scenario_id",
        "solver_status",
        "verification",
        "input_hash",
        "objective",
        "model_version",
        "solver_version",
        "settings",
        "input_snapshot",
        "verifier_version",
        "created_at",
        "finished_at",
        "solver_objective",
      ],
      rows: [
        [
          ...base,
          run.hash,
          run.input.objective,
          run.versions.model,
          run.versions.solver,
          JSON.stringify(run.settings),
          "See Input snapshot sheet; concatenate chunk values in order",
          run.versions.verifier,
          run.createdAt,
          run.finishedAt || "",
          String(run.solverObjective ?? ""),
        ],
      ],
    },
  ];
  sheets.push({
    name: "Input snapshot",
    headers: ["run_id", "chunk_index", "json_chunk"],
    rows: chunks(JSON.stringify(run.input)).map((s, i) => [
      run.id,
      String(i),
      s,
    ]),
  });
  if (run.variables)
    sheets.push({
      name: "Solver variables",
      headers: ["run_id", "variable", "value"],
      rows: Object.entries(run.variables).map(([name, value]) => [
        run.id,
        name,
        String(value),
      ]),
    });
  if (run.verification) {
    sheets.push({
      name: "Verification",
      headers: [
        "run_id",
        "period",
        "constraint",
        "check",
        "actual",
        "lower",
        "upper",
        "residual",
        "passed",
      ],
      rows: run.verification.checks.map((c) => [
        run.id,
        c.period,
        c.id,
        c.message,
        String(c.actual),
        c.lower === null ? "" : String(c.lower),
        c.upper === null ? "" : String(c.upper),
        String(c.residual),
        String(c.passed),
      ]),
    });
  }
  if (
    !run.verification?.verified ||
    !["OPTIMAL", "FEASIBLE"].includes(run.status)
  )
    return sheets;
  sheets.push({
    name: "Allocations",
    headers: [
      "run_id",
      "scenario_id",
      "solver_status",
      "verification",
      "period",
      "resource",
      "project",
      "quantity",
      "unit",
      "cost",
      "currency",
    ],
    rows: run.verification.periods.flatMap((p) =>
      p.analysis.allocations.map((a) => [
        ...base,
        p.id,
        a.resource,
        a.project,
        String(a.quantity),
        a.unit,
        String(a.cost),
        run.input.periods.find((t) => t.id === p.id)!.draft.settings.currency,
      ]),
    ),
  });
  sheets.push({
    name: "Periods",
    headers: [
      "run_id",
      "period",
      "cost",
      "gross_value",
      "net_value",
      "budget",
      "budget_usage_percent",
      "currency",
    ],
    rows: run.verification.periods.map((p) => {
      const settings = run.input.periods.find((t) => t.id === p.id)!.draft
          .settings,
        budget = settings.budget;
      return [
        run.id,
        p.id,
        String(p.analysis.cost),
        p.analysis.value === null ? "" : String(p.analysis.value),
        p.analysis.value === null
          ? ""
          : String(p.analysis.value - p.analysis.cost),
        budget,
        budget && +budget > 0 ? String((p.analysis.cost / +budget) * 100) : "",
        settings.currency,
      ];
    }),
  });
  sheets.push({
    name: "Outputs",
    headers: ["run_id", "period", "project", "output", "unit"],
    rows: run.verification.periods.flatMap((p) =>
      p.analysis.outputs.map((o) => [
        run.id,
        p.id,
        o.project,
        String(o.quantity),
        run.input.periods
          .find((t) => t.id === p.id)!
          .draft.tables.projects.find((r) => r.values.project_id === o.project)!
          .values.output_unit,
      ]),
    ),
  });
  sheets.push({
    name: "Utilization",
    headers: [
      "run_id",
      "period",
      "resource",
      "used",
      "capacity",
      "unit",
      "percent",
      "unused",
    ],
    rows: run.verification.periods.flatMap((p) =>
      p.analysis.utilization.map((u) => [
        run.id,
        p.id,
        u.resource,
        String(u.used),
        u.capacity === null ? "unlimited" : String(u.capacity),
        u.unit,
        u.percentage === null ? "" : String(u.percentage),
        u.capacity === null ? "" : String(u.capacity - u.used),
      ]),
    ),
  });
  sheets.push({
    name: "Inventory",
    headers: [
      "run_id",
      "period",
      "resource",
      "opening",
      "receipts",
      "consumption",
      "closing",
      "discarded",
    ],
    rows: run.verification.periods.flatMap((p) =>
      p.stock.map((s) => [
        run.id,
        p.id,
        s.resource,
        ...[s.opening, s.receipts, s.consumed, s.closing, s.discarded].map(
          String,
        ),
      ]),
    ),
  });
  return sheets;
}
export const sheetCSV = (s: Sheet) => writeCSV(s.headers, s.rows);
export const scenarioSheet = (s: Scenario): Sheet => ({
  name: "Scenario",
  headers: [
    "scenario_id",
    "revision",
    "name",
    "chunk_index",
    "snapshot_json_chunk",
  ],
  rows: chunks(JSON.stringify(s.plan)).map((chunk, i) => [
    s.id,
    String(s.revision),
    s.name,
    String(i),
    chunk,
  ]),
});
export async function excel(sheets: Sheet[]) {
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    if (
      [sheet.headers, ...sheet.rows].some((row) =>
        row.some((cell) => cell.length > 32767),
      )
    )
      throw Error(
        "Excel cell exceeds 32,767 characters. Use CSV for this dataset.",
      );
    const w = workbook.addWorksheet(sheet.name.slice(0, 31));
    w.addRow(sheet.headers);
    sheet.rows.forEach((r) => w.addRow(r));
    w.getRow(1).font = { bold: true };
    w.views = [{ state: "frozen", ySplit: 1 }];
  }
  return workbook.xlsx.writeBuffer();
}
