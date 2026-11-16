import type { WorkbookSheet } from "./read";
export function validateUploadFiles(files: { name: string; size: number }[]) {
  for (const file of files) {
    if (!/\.(xlsx|csv|tsv)$/i.test(file.name))
      throw Error("Unsupported file type. Choose an .xlsx, .csv or .tsv file.");
    if (!file.size)
      throw Error(
        `${file.name}: the file is empty. Choose a file containing data.`,
      );
  }
}
export function worksheetResponse(data: unknown): WorkbookSheet[] {
  const value = data as { error?: unknown; sheets?: unknown } | null;
  if (value && typeof value.error === "string") throw Error(value.error);
  if (!value || !Array.isArray(value.sheets) || !value.sheets.length)
    throw Error(
      "The workbook has no readable worksheets. Save it as an Excel .xlsx workbook and try again.",
    );
  for (const s of value.sheets) {
    if (
      !s ||
      typeof s.name !== "string" ||
      !s.name.trim() ||
      !Array.isArray(s.rows) ||
      !s.rows.every(
        (r: unknown) =>
          Array.isArray(r) && r.every((c) => typeof c === "string"),
      ) ||
      !Array.isArray(s.warnings) ||
      !s.warnings.every((w: unknown) => typeof w === "string") ||
      !Array.isArray(s.formulas) ||
      !s.formulas.every(
        (f: any) =>
          f &&
          Number.isInteger(f.row) &&
          f.row >= 0 &&
          f.row < s.rows.length &&
          Number.isInteger(f.col) &&
          f.col >= 0 &&
          f.col < s.rows[f.row].length &&
          (f.cached === null || typeof f.cached === "string"),
      )
    )
      throw Error(
        "Worksheet metadata is missing or invalid. Save a new .xlsx copy and try again.",
      );
  }
  if (
    !value.sheets.some((s) =>
      s.rows.some((r: string[]) => r.some((c) => c.trim())),
    )
  )
    throw Error(
      "The workbook is empty. Add a header row and records before importing.",
    );
  return value.sheets;
}
