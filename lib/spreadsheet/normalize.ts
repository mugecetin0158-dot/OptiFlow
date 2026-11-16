import { detectHeaderRow } from "../import/automation";
import { writeCSV } from "../import/csv";
import type { WorkbookSheet } from "./read";

export type NormalizedWorksheet = {
  name: string;
  csv: string;
  rowNumbers: number[];
};

export function normalizeWorksheets(
  fileName: string,
  sheets: WorkbookSheet[],
): NormalizedWorksheet[] {
  return sheets.map((sheet) => {
    const headerRow = detectHeaderRow(sheet.rows);
    const sourceHeaders = sheet.rows[headerRow] || [];
    let width = sourceHeaders.length;
    while (width && !sourceHeaders[width - 1].trim()) width--;
    if (!width)
      throw Error(`${sheet.name}: Worksheet has no tabular data to import.`);

    const headers = sourceHeaders.slice(0, width);
    if (headers.some((header) => !header.trim()))
      throw Error(
        `${sheet.name}: Worksheet data has no corresponding column header.`,
      );

    const records = sheet.rows.slice(headerRow + 1);
    records.forEach((row, index) => {
      if (row.slice(width).some((cell) => cell.trim()))
        throw Error(
          `${sheet.name}!row ${headerRow + index + 2}: Worksheet data has no corresponding column header.`,
        );
    });
    const rows = records.map((row) =>
      headers.map((_, column) => row[column] || ""),
    );
    const rowNumbers = records
      .map((row, index) => ({ row, number: headerRow + index + 2 }))
      .filter(({ row }) => row.some((cell) => cell.trim()))
      .map(({ number }) => number);
    const source = fileName.slice(0, 110);
    return {
      name: `${source} [worksheet: ${sheet.name}]`,
      csv: writeCSV(headers, rows),
      rowNumbers,
    };
  });
}
