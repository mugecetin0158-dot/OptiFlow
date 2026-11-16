import { Draft, Input, SolveResult, tables, columns } from "./types";
import { validateDraft } from "./validation";
import { LocalStore } from "../import/storage";
import { writeCSV } from "../import/csv";
export const ALLOCATION_KEY = "optiflow-resource-allocation-v1";
export function saveAllocation(store: LocalStore, draft: Draft) {
  if (!validateDraft(draft).valid)
    throw Error("Resolve all blocking errors before saving.");
  try {
    store.setItem(
      ALLOCATION_KEY,
      JSON.stringify({ version: 1, draft, savedAt: new Date().toISOString() }),
    );
  } catch {
    throw Error(
      "Browser storage is full or unavailable. Nothing was confirmed.",
    );
  }
}
export function loadAllocation(store: LocalStore): Draft | null {
  const raw = store.getItem(ALLOCATION_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw),
      d = saved.draft as Draft;
    if (
      saved.version !== 1 ||
      !["manual", "sample", "import"].includes(d.origin) ||
      !d.settings ||
      !tables.every(
        (t) =>
          Array.isArray(d.tables[t]) &&
          d.tables[t].every(
            (r) =>
              r &&
              r.values &&
              Array.isArray(r.sources) &&
              columns[t].every((f) => typeof r.values[f] === "string"),
          ),
      )
    )
      throw Error();
    if (!validateDraft(d).valid) throw Error();
    return d;
  } catch {
    throw Error(
      "Saved resource data failed validation. Review or replace it before optimization.",
    );
  }
}
export function exportAllocation(p: Input, result: SolveResult) {
  if (!result.analysis || !["OPTIMAL", "FEASIBLE"].includes(result.status))
    throw Error("No validated allocation is available to export.");
  const a = result.analysis;
  const headers = [
    "solver_status",
    "objective_mode",
    "objective_value",
    "currency",
    "planning_period",
    "resource_id",
    "resource_name",
    "project_id",
    "project_name",
    "project_output",
    "output_unit",
    "resource_type",
    "resource_unit",
    "allocated_quantity",
    "unit_cost",
    "allocation_cost",
  ];
  return writeCSV(
    headers,
    a.allocations.map((row) => {
      const r = p.resources.find((r) => r.id === row.resource)!,
        project = p.projects.find((pr) => pr.id === row.project)!;
      return [
        result.status,
        p.mode,
        String(a.objective),
        p.currency,
        p.period,
        r.id,
        r.name,
        project.id,
        project.name,
        String(a.outputs.find((o) => o.project === project.id)!.quantity),
        project.unit,
        r.type,
        r.unit,
        String(row.quantity),
        String(r.cost),
        String(row.cost),
      ];
    }),
  );
}
export function exportProjectOutputs(p: Input, result: SolveResult) {
  if (!result.analysis || !["OPTIMAL", "FEASIBLE"].includes(result.status))
    throw Error("No validated allocation is available to export.");
  return writeCSV(
    [
      "solver_status",
      "planning_period",
      "project_id",
      "output_unit",
      "output_quantity",
      "gross_value",
      "priority_weighted_value",
      "currency",
    ],
    result.analysis.outputs.map((o) => [
      result.status,
      p.period,
      o.project,
      p.projects.find((pr) => pr.id === o.project)!.unit,
      String(o.quantity),
      o.value === null ? "" : String(o.value),
      o.weightedValue === null ? "" : String(o.weightedValue),
      p.currency,
    ]),
  );
}
