import { worksheetResponse } from "./protocol";
export type WorkbookSheet = {
  name: string;
  rows: string[][];
  formulas: { row: number; col: number; cached: string | null }[];
  warnings: string[];
};
function checkArchive(bytes: ArrayBuffer) {
  const v = new DataView(bytes);
  let size = 0,
    entries = 0;
  for (let i = 0; i + 46 <= v.byteLength; i++) {
    if (v.getUint32(i, true) !== 0x02014b50) continue;
    entries++;
    size += v.getUint32(i + 24, true);
    if (v.getUint16(i + 8, true) & 1)
      throw Error("Encrypted workbooks are unsupported.");
    i +=
      45 +
      v.getUint16(i + 28, true) +
      v.getUint16(i + 30, true) +
      v.getUint16(i + 32, true);
  }
  if (!entries || size > 100 * 1024 * 1024)
    throw Error("Workbook archive is invalid or expands beyond 100 MB.");
}
export async function readWorkbook(
  bytes: ArrayBuffer,
): Promise<WorkbookSheet[]> {
  if (bytes.byteLength > 10 * 1024 * 1024) throw Error("XLSX limit: 10 MB.");
  checkArchive(bytes);
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  let worksheets: typeof workbook.worksheets;
  try {
    await workbook.xlsx.load(bytes);
    worksheets = workbook.worksheets;
  } catch {
    throw Error(
      "This Excel file could not be read. Its workbook metadata may be missing, damaged or unsupported. Open it in Excel or LibreOffice, save a new .xlsx copy, and try again.",
    );
  }
  if (!Array.isArray(worksheets) || !worksheets.length)
    throw Error(
      "The workbook has no readable worksheets. Save it as an Excel .xlsx workbook and try again.",
    );
  if (worksheets.length > 50)
    throw Error("Workbook limit: 50 worksheets.");
  const sheets = worksheets.map((sheet) => {
    if (sheet.rowCount > 10001 || sheet.columnCount > 80)
      throw Error(
        `${sheet.name}: Worksheet exceeds 10,000 data rows or 80 columns.`,
      );
    const rows: string[][] = [],
      formulas: WorkbookSheet["formulas"] = [],
      warnings: string[] = [];
    function literal(value: any, format: string): string {
      if (value === null || value === undefined) return "";
      if (value instanceof Date) {
        const timeFormat = format.replace(/"[^"]*"|\\./g, "");
        if (/[hs]/i.test(timeFormat) && !/[yd]/i.test(timeFormat)) {
          if (/\[h/i.test(timeFormat))
            throw Error(
              "Elapsed-duration cells need an explicit duration, not a clock time.",
            );
          return value.toISOString().slice(11, value.getUTCSeconds() ? 19 : 16);
        }
        return value.toISOString().endsWith("T00:00:00.000Z")
          ? value.toISOString().slice(0, 10)
          : value.toISOString();
      }
      if (typeof value === "object") {
        if (value.richText)
          return value.richText.map((v: any) => v.text).join("");
        if ("hyperlink" in value) {
          warnings.push(
            "Hyperlinks were retained as text only; no link was fetched.",
          );
          return String(value.text || "");
        }
        throw Error(
          "Unsupported cell value; replace it with an explicit literal value.",
        );
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw Error("Nonfinite numeric cell.");
        if (Number.isInteger(value) && !Number.isSafeInteger(value))
          warnings.push(
            "A numeric identifier may have lost precision in Excel. Verify against the source.",
          );
        if (/^0+$/.test(format) && Number.isSafeInteger(value) && value >= 0)
          return String(value).padStart(format.length, "0");
      }
      return String(value);
    }
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row: string[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getCell(r, c),
          v: any = cell.value;
        if (
          v &&
          typeof v === "object" &&
          ("formula" in v || "sharedFormula" in v)
        ) {
          if (v.result === undefined || v.result === null)
            throw Error(
              `${sheet.name}!${cell.address}: Formula has no cached result. Recalculate the workbook and save it before importing.`,
            );
          let cached: string;
          try {
            cached = literal(v.result, cell.numFmt);
          } catch (e) {
            throw Error(
              `${sheet.name}!${cell.address}: ${(e as Error).message}`,
            );
          }
          formulas.push({ row: r - 1, col: c - 1, cached });
          row.push(cached);
        } else {
          try {
            row.push(literal(v, cell.numFmt));
          } catch (e) {
            throw Error(
              `${sheet.name}!${cell.address}: ${(e as Error).message}`,
            );
          }
        }
      }
      rows.push(row);
    }
    return {
      name: sheet.name,
      rows,
      formulas,
      warnings: [...new Set(warnings)],
    };
  });
  return worksheetResponse({ sheets });
}
