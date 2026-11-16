import { ImportSource, Issue } from "./types";
import { mappingConflicts } from "./recognition";
import { missingMappings, transformRow } from "./transformations";

export function mappingIssues(
  file: ImportSource,
  inspectValues = false,
): Issue[] {
  const source = { fileId: file.id, file: file.name, row: 1 };
  const issues: Issue[] = [];
  const add = (message: string, detail = "") =>
    issues.push({
      severity: "error",
      code: "mapping",
      message,
      detail,
      source,
    });
  if (!file.confirmed)
    add("Confirm what the source rows represent before transforming.");
  if (!file.kinds.length) {
    if (file.confirmed)
      issues.push({
        severity: "warning",
        code: "unrelated",
        message:
          "Retained as unrelated data; no scheduling records will be produced.",
        source,
      });
    return issues;
  }
  for (const detail of mappingConflicts(file))
    add("Conflicting mappings must be resolved.", detail);
  if (file.mappings.some((m) => m.state === "suggested"))
    add("Confirm or clear all suggested mappings.");
  for (const { kind, field } of missingMappings(file))
    issues.push({
      severity: "error",
      code: "missing-mapping",
      message: "Map or derive this required field before approval.",
      dataset: kind,
      field,
      source,
    });
  if (inspectValues)
    for (const kind of file.kinds)
      file.parsed.rows.forEach((row, i) => {
        const result = transformRow(file, row, kind);
        for (const [field, message] of Object.entries(result.pending))
          issues.push({
            severity: "error",
            code: "transformation",
            message,
            dataset: kind,
            field,
            source: { ...source, row: file.parsed.lineNumbers[i] },
          });
      });
  return issues;
}

export function importStages(
  sources: ImportSource[],
  datasetIssues: Issue[],
  stale: boolean,
  hasRecords: boolean,
) {
  const parsingErrors = sources
    .flatMap((s) => s.parsed.issues)
    .filter((i) => i.severity === "error");
  const mappingErrors = sources
    .flatMap((s) => mappingIssues(s, stale))
    .filter((i) => i.severity === "error");
  const unresolvedValues = datasetIssues.some(
    (i) => i.code === "transformation" && i.severity === "error",
  );
  return {
    parsing: !sources.length
      ? "Not started"
      : parsingErrors.length
        ? "Needs attention"
        : "Complete",
    mapping: !sources.length
      ? "Not started"
      : parsingErrors.length || mappingErrors.length || unresolvedValues
        ? "Needs attention"
        : sources.every((s) => !s.kinds.length)
          ? "No scheduling data"
          : "Complete",
    dataset:
      stale || !hasRecords
        ? "Not validated"
        : parsingErrors.length ||
            mappingErrors.length ||
            datasetIssues.some((i) => i.severity === "error")
          ? "Needs attention"
          : "Complete",
  };
}
