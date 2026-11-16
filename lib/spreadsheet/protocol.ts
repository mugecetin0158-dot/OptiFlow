import type { WorkbookSheet } from "./read";
const spreadsheetMessages = [
  "Unsupported file type. Choose an .xlsx, .csv or .tsv file.",
  "The file is empty. Choose a file containing data.",
  "Encrypted workbooks are unsupported.",
  "Workbook archive is invalid or expands beyond 100 MB.",
  "XLSX limit: 10 MB.",
  "This Excel file could not be read. Its workbook metadata may be missing, damaged or unsupported. Open it in Excel or LibreOffice, save a new .xlsx copy, and try again.",
  "The workbook has no readable worksheets. Save it as an Excel .xlsx workbook and try again.",
  "Workbook limit: 50 worksheets.",
  "Worksheet exceeds 10,000 data rows or 80 columns.",
  "Elapsed-duration cells need an explicit duration, not a clock time.",
  "Unsupported cell value; replace it with an explicit literal value.",
  "Nonfinite numeric cell.",
  "Formula has no cached result. Recalculate the workbook and save it before importing.",
  "Worksheet metadata is missing or invalid. Save a new .xlsx copy and try again.",
  "The workbook is empty. Add a header row and records before importing.",
  "Workbook parsing timed out.",
  "The workbook parser returned unreadable data. Please try again.",
  "Workbook could not be parsed.",
  "Import was not accepted. Review the upload error and check the workbook data.",
  "Reading workbook locally…",
  "Workbook import cancelled.",
  "The workbook has no tabular data to import.",
  "Worksheet has no tabular data to import.",
  "Worksheet data has no corresponding column header.",
] as const;

export function localizeSpreadsheetMessage(
  message: string,
  translate: (value: string) => string,
) {
  const key = spreadsheetMessages.find(
    (candidate) =>
      message === candidate || message.endsWith(`: ${candidate}`),
  );
  if (!key) return translate(message);
  return message.slice(0, -key.length) + translate(key);
}

export function validateUploadFiles(files: { name: string; size: number }[]) {
  for (const file of files) {
    if (!/\.(xlsx|csv|tsv)$/i.test(file.name))
      throw Error("Unsupported file type. Choose an .xlsx, .csv or .tsv file.");
    if (!file.size)
      throw Error(`${file.name}: The file is empty. Choose a file containing data.`);
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
