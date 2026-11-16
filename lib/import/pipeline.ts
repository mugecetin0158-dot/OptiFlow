import { ImportSource, ImportDraft, Issue, emptyDraft } from "./types";
import { mappingConflicts } from "./recognition";
import { missingMappings, transformRow } from "./transformations";
export function transformSources(sources: ImportSource[]): {
  draft: ImportDraft;
  issues: Issue[];
  unmapped: { file: string; column: string; decision: string }[];
} {
  const draft = emptyDraft(),
    issues: Issue[] = [],
    unmapped: { file: string; column: string; decision: string }[] = [];
  if (sources.reduce((n, s) => n + s.parsed.rows.length, 0) > 10000)
    return {
      draft,
      issues: [
        {
          severity: "error",
          code: "limit",
          message: "An import may contain at most 10,000 source records.",
        },
      ],
      unmapped,
    };
  const repeatedEmployees = new Map<string, (typeof draft.employees)[number]>();
  for (const file of sources) {
    const source = { fileId: file.id, file: file.name, row: 1 };
    file.mappings.forEach((m, i) => {
      if (!file.kinds.length || !m.target || m.target === "ignore")
        unmapped.push({
          file: file.name,
          column: file.parsed.headers[i],
          decision: !file.kinds.length
            ? "Unrelated / existing assignments"
            : m.target === "ignore"
              ? "Irrelevant"
              : "Unmapped",
        });
    });
    if (file.parsed.issues.some((i) => i.severity === "error")) {
      issues.push(...file.parsed.issues.map((i) => ({ ...i, source })));
      continue;
    }
    if (!file.confirmed) {
      issues.push({
        severity: "error",
        code: "classification",
        message: "Confirm what the source rows represent before transforming.",
        source,
      });
      continue;
    }
    if (!file.kinds.length) {
      issues.push({
        severity: "warning",
        code: "unrelated",
        message:
          "No scheduling datasets selected. This file is retained as unrelated information.",
        source,
      });
      continue;
    }
    const conflicts = mappingConflicts(file);
    if (conflicts.length) {
      issues.push({
        severity: "error",
        code: "mapping",
        message: "Conflicting mappings must be resolved.",
        detail: conflicts.join(", "),
        source,
      });
      continue;
    }
    if (file.mappings.some((m) => m.state === "suggested")) {
      issues.push({
        severity: "error",
        code: "confirmation",
        message: "Confirm or clear all suggested mappings.",
        source,
      });
      continue;
    }
    const usedRows = new Set<number>();
    for (const kind of file.kinds) {
      for (const { field } of missingMappings(file).filter(
        (m) => m.kind === kind,
      ))
        issues.push({
          severity: "error",
          code: "missing-mapping",
          message: "Map or derive this required field before approval.",
          field,
          dataset: kind,
          source,
        });
      file.parsed.rows.forEach((row, index) => {
        if (file.kinds.length > 1) {
          const relevant =
            kind === "employees"
              ? ["name", "hourly_rate", "max_weekly_hours", "roles"]
              : kind === "shifts"
                ? [
                    "shift_id",
                    "required_count",
                    "required_role",
                    "shift_date",
                    "shift_start_time",
                    "shift_end_time",
                  ]
                : file.kinds.includes("shifts")
                  ? [
                      "status",
                      "availability_date",
                      "availability_start_time",
                      "availability_end_time",
                    ]
                  : [
                      "status",
                      "date",
                      "start_time",
                      "end_time",
                      "availability_date",
                      "availability_start_time",
                      "availability_end_time",
                    ];
          if (
            !file.mappings.some(
              (m, col) => relevant.includes(m.target) && row[col]?.trim(),
            )
          )
            return;
        }
        const ref = { ...source, row: file.parsed.lineNumbers[index] };
        const { values, pending } = transformRow(file, row, kind);
        if (Object.values(values).every((v) => !v)) return;
        usedRows.add(index);
        if (kind === "employees") {
          const key = JSON.stringify([values, pending]);
          const equal = repeatedEmployees.get(key);
          if (equal) {
            equal.sources.push(ref);
            issues.push({
              severity: "warning",
              code: "repeated-employee",
              message:
                "Identical repeated employee rows were consolidated with source traceability.",
              source: ref,
            });
            return;
          }
        }
        const record = { values, sources: [ref], pending };
        draft[kind].push(record);
        if (kind === "employees")
          repeatedEmployees.set(JSON.stringify([values, pending]), record);
      });
    }
    file.parsed.rows.forEach((_, i) => {
      if (!usedRows.has(i))
        issues.push({
          severity: "warning",
          code: "untransformed-row",
          message:
            "This source row did not produce a record for the selected datasets.",
          source: { ...source, row: file.parsed.lineNumbers[i] },
        });
    });
  }
  return { draft, issues, unmapped };
}
