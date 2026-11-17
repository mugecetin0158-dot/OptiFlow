import {
  Dataset,
  ImportDraft,
  ImportSource,
  Issue,
  SourceRef,
} from "./types";
import { canonicalField, mappingOutputs } from "./transformations";

export type ImportCorrection = {
  file: string;
  row: number;
  column: string;
  original: string;
  result: string;
  reason: string;
};

const roleKey = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

const employeeKey = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

function correctionFor(
  sources: ImportSource[],
  ref: SourceRef,
  kind: Dataset,
  field: string,
  result: string,
  reason: string,
): ImportCorrection | null {
  const source = sources.find((candidate) => candidate.id === ref.fileId);
  if (!source) return null;
  const rowIndex = source.parsed.lineNumbers.indexOf(ref.row);
  if (rowIndex < 0) return null;
  const column = source.mappings.findIndex((mapping) =>
    mappingOutputs(mapping).some(
      (output) => canonicalField(output, kind) === field,
    ),
  );
  if (column < 0) return null;
  const original = source.parsed.rows[rowIndex]?.[column] || "";
  if (original === result) return null;
  return {
    file: source.name,
    row: ref.row,
    column: source.parsed.headers[column],
    original,
    result,
    reason,
  };
}

function recordCorrections(
  sources: ImportSource[],
  dataset: Dataset,
  record: ImportDraft[Dataset][number],
  field: string,
  result: string,
  reason: string,
) {
  return record.sources
    .map((ref) => correctionFor(sources, ref, dataset, field, result, reason))
    .filter((correction): correction is ImportCorrection => correction !== null);
}

export function reconcileDraft(
  draft: ImportDraft,
  sources: ImportSource[],
): { draft: ImportDraft; corrections: ImportCorrection[]; issues: Issue[] } {
  const next = structuredClone(draft);
  const corrections: ImportCorrection[] = [];
  const employeesByKey = new Map<string, Set<string>>();

  for (const employee of next.employees) {
    const key = employeeKey(employee.values.employee_id);
    if (!key) continue;
    const ids = employeesByKey.get(key) || new Set<string>();
    ids.add(employee.values.employee_id);
    employeesByKey.set(key, ids);
  }

  const ambiguousIds = new Set(
    [...employeesByKey]
      .filter(([, ids]) => ids.size > 1)
      .map(([key]) => key),
  );
  for (const employee of next.employees) {
    if (ambiguousIds.has(employeeKey(employee.values.employee_id)))
      employee.pending = {
        ...employee.pending,
        employee_id:
          "Employee IDs differ only by formatting and cannot be matched safely. Resolve the conflicting identifiers.",
      };
  }

  for (const record of next.availability) {
    const current = record.values.employee_id;
    const key = employeeKey(current);
    const ids = employeesByKey.get(key);
    if (!current || !ids?.size) continue;
    if (ambiguousIds.has(key) || ids.size !== 1) {
      record.pending = {
        ...record.pending,
        employee_id:
          "This employee ID matches more than one imported employee after formatting normalization.",
      };
      continue;
    }
    const canonical = [...ids][0];
    if (current === canonical) continue;
    record.values.employee_id = canonical;
    corrections.push(
      ...recordCorrections(
        sources,
        "availability",
        record,
        "employee_id",
        canonical,
        "Matched an employee ID across uploaded datasets.",
      ),
    );
  }

  const rolesByKey = new Map<string, string>();
  for (const employee of next.employees) {
    let roles: unknown;
    try {
      roles = JSON.parse(employee.values.roles);
    } catch {
      continue;
    }
    if (!Array.isArray(roles)) continue;
    for (const role of roles) {
      if (typeof role !== "string" || !role.trim()) continue;
      const normalized = role.trim().replace(/\s+/g, " ");
      const key = roleKey(normalized);
      if (key && !rolesByKey.has(key)) rolesByKey.set(key, normalized);
    }
  }

  for (const employee of next.employees) {
    let roles: unknown;
    try {
      roles = JSON.parse(employee.values.roles);
    } catch {
      continue;
    }
    if (!Array.isArray(roles)) continue;
    const normalized = roles.map((role) =>
      typeof role === "string"
        ? rolesByKey.get(roleKey(role)) || role.trim().replace(/\s+/g, " ")
        : role,
    );
    const result = JSON.stringify([...new Set(normalized)]);
    if (result !== employee.values.roles) {
      employee.values.roles = result;
      corrections.push(
        ...recordCorrections(
          sources,
          "employees",
          employee,
          "roles",
          result,
          "Matched role names using case-insensitive whitespace and punctuation normalization.",
        ),
      );
    }
  }

  for (const shift of next.shifts) {
    const current = shift.values.required_role;
    const canonical = rolesByKey.get(roleKey(current));
    if (!canonical || canonical === current) continue;
    shift.values.required_role = canonical;
    corrections.push(
      ...recordCorrections(
        sources,
        "shifts",
        shift,
        "required_role",
        canonical,
        "Matched the required role to an imported employee role.",
      ),
    );
  }

  return { draft: next, corrections, issues: [] };
}
