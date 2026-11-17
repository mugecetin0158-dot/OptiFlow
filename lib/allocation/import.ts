import { parseCSV, writeCSV } from "../import/csv";
import { normalizeHeader } from "../import/recognition";
import { normalizeDecimal } from "../import/normalize";
import { ParsedCSV } from "../import/types";
import {
  AllocationDataset,
  Draft,
  Issue,
  Table,
  columns,
  datasetColumns,
  emptyDraft,
  Settings,
} from "./types";
export type AllocationSource = {
  id: string;
  name: string;
  text: string;
  parsed: ParsedCSV;
  kind: AllocationDataset | "" | "ignore";
  mappings: string[];
  decimal: "" | "dot" | "comma";
  confirmed: boolean;
  delimiter: string;
};
const aliases: Record<string, string[]> = {
  resource_id: ["resource id", "resource code", "asset id"],
  project_id: ["project id", "project code", "job id"],
  name: ["name", "resource name", "project name"],
  resource_type: ["resource type", "resource category", "skill type"],
  unit: ["unit", "resource unit", "capacity unit"],
  capacity: ["capacity", "available capacity", "supply"],
  unit_cost: ["unit cost", "cost per unit"],
  integer: ["integer", "whole units", "indivisible"],
  output_unit: ["output unit", "project unit"],
  minimum_output: ["minimum output", "required output", "minimum quantity"],
  maximum_output: ["maximum output", "output limit", "maximum quantity"],
  unit_value: ["unit value", "value per output"],
  priority: ["priority", "priority weight"],
  amount_per_output: [
    "amount per output",
    "resource demand",
    "demand per output",
  ],
  compatible: ["compatible", "allowed"],
  minimum_allocation: ["minimum allocation", "allocation minimum"],
  maximum_allocation: ["maximum allocation", "allocation limit"],
  objective: ["optimization objective", "optimization goal", "goal"],
  planning_period: ["planning period", "period"],
  currency: ["business currency", "currency code"],
  budget: ["budget limit", "maximum budget"],
};
export function isModelSettingsFile(name: string) {
  return (
    name.trim().toLowerCase().split(/[\\/]/).pop() ===
    "optiflow_model_settings.csv"
  );
}
export function preserveManualSettings(
  current: Settings,
  baseline: Settings,
  refreshed: Settings,
): Settings {
  const next = { ...refreshed };
  if (current.mode !== baseline.mode) next.mode = current.mode;
  if (current.currency !== baseline.currency) next.currency = current.currency;
  if (current.period !== baseline.period) next.period = current.period;
  if (current.budget !== baseline.budget) next.budget = current.budget;
  return next;
}
export function recognizeAllocation(
  headers: string[],
  kind: AllocationDataset,
): string[] {
  return headers.map((h) => {
    const found = datasetColumns(kind).filter((f) =>
      [f, ...(aliases[f] || [])].some(
        (a) => normalizeHeader(a) === normalizeHeader(h),
      ),
    );
    return found.length === 1 ? found[0] : "";
  });
}
export function createAllocationSource(
  id: string,
  name: string,
  text: string,
  delimiter = "auto",
): AllocationSource {
  const parsed = parseCSV(text, delimiter);
  return {
    id,
    name,
    text,
    parsed,
    kind: "",
    mappings: parsed.headers.map(() => ""),
    decimal: "",
    confirmed: false,
    delimiter,
  };
}
export function requiredColumns(
  table: AllocationDataset,
  mode: Settings["mode"],
) {
  if (table === "model_settings")
    return ["objective", "planning_period", "currency"];
  const required: Record<Table, string[]> = {
    resources: [
      "resource_id",
      "name",
      "resource_type",
      "unit",
      "unit_cost",
      "integer",
    ],
    projects: [
      "project_id",
      "name",
      "output_unit",
      "minimum_output",
      "integer",
      ...(mode === "value" ? ["unit_value"] : []),
    ],
    demands: columns.demands,
    links: [
      "resource_id",
      "project_id",
      "compatible",
      "minimum_allocation",
    ],
  };
  return required[table];
}
const numeric = new Set([
  "capacity",
  "unit_cost",
  "budget",
  "minimum_output",
  "maximum_output",
  "unit_value",
  "priority",
  "amount_per_output",
  "minimum_allocation",
  "maximum_allocation",
]);
const limits = new Set(["capacity", "maximum_output", "maximum_allocation"]);
export function normalizeAllocationCell(
  field: string,
  raw: string,
  decimal: AllocationSource["decimal"],
): string {
  const v = raw.trim();
  if (!v) return "";
  if (limits.has(field) && v.toLowerCase() === "unlimited") return "unlimited";
  if (numeric.has(field)) return normalizeDecimal(v, decimal);
  if (field === "objective") {
    const objective = normalizeHeader(v);
    if (
      ["cost", "minimize cost", "minimum cost", "minimize total cost"].includes(
        objective,
      )
    )
      return "cost";
    if (
      [
        "value",
        "maximize value",
        "maximize priority weighted value",
        "priority weighted value",
      ].includes(objective)
    )
      return "value";
    throw Error("Choose cost or priority-weighted value as the objective.");
  }
  if (field === "currency") return v.toUpperCase();
  if (field === "integer" || field === "compatible") {
    if (["true", "yes"].includes(v.toLowerCase())) return "true";
    if (["false", "no"].includes(v.toLowerCase())) return "false";
    throw Error(
      "Use true/false or explicitly recognized YES/NO for this boolean field.",
    );
  }
  return v;
}
export function transformAllocationSources(
  sources: AllocationSource[],
  settings: Settings,
): {
  draft: Draft;
  issues: Issue[];
  unmapped: { file: string; column: string; decision: string }[];
} {
  const draft = emptyDraft();
  draft.origin = "import";
  draft.importContext = {
    sources: sources.map((s) => ({
      name: s.name,
      kind: s.kind,
      headers: s.parsed.headers,
      rows: s.parsed.rows,
      mappings: s.mappings,
      decimal: s.decimal,
    })),
  };
  draft.settings = { ...settings };
  const issues: Issue[] = [],
    unmapped: { file: string; column: string; decision: string }[] = [];
  if (
    !sources.length ||
    sources.length > 10 ||
    sources.reduce((n, s) => n + s.parsed.rows.length, 0) > 10000
  )
    return {
      draft,
      issues: [
        {
          severity: "error",
          message: "Use at most 10 tabular sources and 10,000 source rows.",
        },
      ],
      unmapped,
    };
  const settingsSourceCount = sources.filter(
    (source) => source.kind === "model_settings",
  ).length;
  for (const file of sources) {
    const source = { fileId: file.id, file: file.name, row: 1 };
    const add = (message: string, detail?: string) =>
      issues.push({ severity: "error", message, source, detail });
    file.mappings.forEach((field, i) => {
      if (!field || field === "ignore" || file.kind === "ignore")
        unmapped.push({
          file: file.name,
          column: file.parsed.headers[i],
          decision:
            field === "ignore" || file.kind === "ignore"
              ? "Irrelevant"
              : "Unmapped",
        });
    });
    if (file.parsed.issues.length) {
      issues.push(
        ...file.parsed.issues.map((i) => ({
          severity: i.severity,
          message: i.message,
          detail: i.detail,
          source,
        })),
      );
      if (file.parsed.issues.some((i) => i.severity === "error")) continue;
    }
    if (!file.kind) {
      add("Confirm the dataset and column meanings before transforming.");
      continue;
    }
    if (file.kind === "ignore") continue;
    if (!file.confirmed)
      add("Confirm the dataset and column meanings before transforming.");
    const kind = file.kind as AllocationDataset,
      fields = datasetColumns(kind),
      selected = file.mappings.filter((f) => f && f !== "ignore");
    if (
      new Set(selected).size !== selected.length ||
      selected.some((f) => !fields.includes(f))
    ) {
      add("Conflicting or incompatible column mappings must be resolved.");
      continue;
    }
    for (const field of requiredColumns(kind, settings.mode))
      if (!selected.includes(field))
        issues.push({
          severity: "error",
          message: "Map or derive this required field before approval.",
          table: kind,
          field,
          source,
          detail: `${kind}.${field}`,
        });
    if (kind === "model_settings") {
      if (settingsSourceCount > 1) {
        add("Use only one model settings source per import.");
        continue;
      }
      if (file.parsed.rows.length !== 1) {
        add("Model settings must contain exactly one data row.");
        continue;
      }
      const row = file.parsed.rows[0];
      for (const field of fields) {
        const index = file.mappings.indexOf(field);
        if (index < 0) continue;
        const raw = row[index] || "";
        if (!raw.trim()) {
          if (field === "budget") draft.settings.budget = "";
          else if (requiredColumns(kind, settings.mode).includes(field))
            issues.push({
              severity: "error",
              message: "A nonempty value is required for this model setting.",
              table: kind,
              field,
              source: { ...source, row: file.parsed.lineNumbers[0] },
            });
          continue;
        }
        try {
          const value = normalizeAllocationCell(field, raw, file.decimal);
          if (field === "objective")
            draft.settings.mode = value as Settings["mode"];
          else if (field === "planning_period") draft.settings.period = value;
          else if (field === "currency") draft.settings.currency = value;
          else if (field === "budget") draft.settings.budget = value;
        } catch (e) {
          issues.push({
            severity: "error",
            message: (e as Error).message,
            table: kind,
            field,
            source: { ...source, row: file.parsed.lineNumbers[0] },
          });
        }
      }
      continue;
    }
    file.parsed.rows.forEach((row, index) => {
      const values: Record<string, string> = Object.fromEntries(
          fields.map((f) => [f, ""]),
        ),
        pending: Record<string, string> = {};
      file.mappings.forEach((field, i) => {
        if (!field || field === "ignore") return;
        values[field] = row[i] || "";
        try {
          values[field] = normalizeAllocationCell(
            field,
            values[field],
            file.decimal,
          );
        } catch (e) {
          pending[field] = (e as Error).message;
        }
      });
      // Retain every allocation-domain source row, including rows with missing fields.
      draft.tables[kind].push({
        values,
        pending,
        sources: [{ ...source, row: file.parsed.lineNumbers[index] }],
      });
    });
  }
  return { draft, issues, unmapped };
}
export const exportCatalog = (draft: Draft, table: Table) =>
  writeCSV(
    columns[table],
    draft.tables[table].map((r) =>
      columns[table].map((f) => r.values[f] || ""),
    ),
  );
