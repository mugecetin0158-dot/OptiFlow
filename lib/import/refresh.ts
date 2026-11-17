import { SourceRef } from "./types";

type ImportRecord = {
  values: Record<string, string>;
  sources: SourceRef[];
  pending?: Record<string, string>;
};

const sourceKeys = (record: ImportRecord) =>
  record.sources.map((source) => `${source.fileId}:${source.row}`);

function findSourceRecord(records: ImportRecord[], keys: Set<string>) {
  return records.find((record) =>
    sourceKeys(record).some((key) => keys.has(key)),
  );
}

export function preserveManualDraftEdits<T extends Record<string, ImportRecord[]>>(
  current: T,
  baseline: T,
  refreshed: T,
): T {
  const result = { ...refreshed } as Record<string, ImportRecord[]>;
  for (const table of Object.keys(refreshed)) {
    const currentRows = current[table] ?? [];
    const baselineRows = baseline[table] ?? [];
    const refreshedRows = refreshed[table] ?? [];
    const matchedCurrent = new Set<ImportRecord>();
    result[table] = refreshedRows.map((row) => {
      const keys = new Set(sourceKeys(row));
      const previous = findSourceRecord(currentRows, keys);
      if (!previous) return row;
      const sourceBaseline = findSourceRecord(baselineRows, keys);
      if (!sourceBaseline) return row;
      matchedCurrent.add(previous);
      const values = { ...row.values };
      const pending = { ...(row.pending || {}) };
      for (const [field, value] of Object.entries(previous.values)) {
        if (value.trim() && value !== sourceBaseline.values[field]) {
          values[field] = value;
          delete pending[field];
        }
      }
      return { ...row, values, pending };
    });
    result[table] = [
      ...result[table],
      ...currentRows.filter(
        (row) => row.sources.length === 0 && !matchedCurrent.has(row),
      ),
    ];
  }
  return result as T;
}
