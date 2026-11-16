import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { readWorkbook } from "../lib/spreadsheet/read";
import {
  worksheetResponse,
  validateUploadFiles,
  localizeSpreadsheetMessage,
} from "../lib/spreadsheet/protocol";
import { parseCSV } from "../lib/import/csv";
import { normalizeWorksheets } from "../lib/spreadsheet/normalize";
import { createSource } from "../lib/import/recognition";
import { profileSourcesForAI } from "../lib/import/automation";
import { translate, Language } from "../lib/i18n";
import { readFileSync } from "node:fs";
function fixture(name: string) {
  const bytes = readFileSync(`tests/fixtures/spreadsheet/${name}`);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}
async function workbook(names: string[]) {
  const w = new ExcelJS.Workbook();
  for (const name of names)
    w.addWorksheet(name).addRows([
      ["Badge", "Day"],
      ["001", "2026-11-16"],
    ]);
  return new Uint8Array((await w.xlsx.writeBuffer()) as any).buffer;
}
for (const names of [
  ["Staff"],
  ["Staff", "Resources", "Inventory", "Constraints"],
])
  test(`valid XLSX: ${names.length} sheets`, async () => {
    assert.deepEqual(
      (await readWorkbook(await workbook(names))).map((s) => s.name),
      names,
    );
  });
test("CSV remains a valid upload and preserves quoted data", () => {
  validateUploadFiles([{ name: "staff.CSV", size: 40 }]);
  assert.deepEqual(parseCSV('name,id\n"Doe, Jane",001').rows, [
    ["Doe, Jane", "001"],
  ]);
});
test("empty workbook and zero-byte file have clear errors", async () => {
  await assert.rejects(
    readWorkbook(await workbook([])),
    /no readable worksheets|empty/,
  );
  const w = new ExcelJS.Workbook();
  w.addWorksheet("Blank");
  await assert.rejects(
    readWorkbook(new Uint8Array((await w.xlsx.writeBuffer()) as any).buffer),
    /empty/,
  );
  assert.throws(
    () => validateUploadFiles([{ name: "empty.xlsx", size: 0 }]),
    /empty\.xlsx: The file is empty/,
  );
});
test("corrupt Excel archive fails gracefully", async () => {
  await assert.rejects(
    readWorkbook(new Uint8Array([1, 2, 3]).buffer),
    /archive/,
  );
});
test("invalid workbook metadata reproducing ExcelJS sheets crash is translated to an actionable error", async () => {
  const zip = await JSZip.loadAsync(await workbook(["Staff"]));
  zip.file("xl/workbook.xml", '<?xml version="1.0"?><invalid/>');
  await assert.rejects(
    readWorkbook(await zip.generateAsync({ type: "arraybuffer" })),
    (e) =>
      e instanceof Error &&
      e.message.includes("workbook metadata") &&
      !e.message.includes("undefined"),
  );
});
test("openpyxl single-sheet workbook normalizes dates, numbers, blanks and source rows", async () => {
  const sheets = await readWorkbook(fixture("openpyxl-single.xlsx"));
  const [table] = normalizeWorksheets("openpyxl-single.xlsx", sheets);
  const parsed = parseCSV(table.csv);
  assert.equal(table.name, "openpyxl-single.xlsx [worksheet: Staff]");
  assert.deepEqual(parsed.headers, [
    "employee_id",
    "name",
    "hourly_rate",
    "max_weekly_hours",
    "roles",
    "start_date",
  ]);
  assert.deepEqual(parsed.rows, [
    ["001", "Ada Lovelace", "22.5", "40", "Manager", "2026-11-16"],
    ["002", "Grace Hopper", "", "32", "Analyst", "2026-11-17"],
  ]);
  assert.deepEqual(table.rowNumbers, [3, 4]);
  assert.equal(parsed.issues.length, 0);
});
test("openpyxl multi-sheet workbook keeps every tab separate for the AI import profile", async () => {
  const sheets = await readWorkbook(fixture("openpyxl-multi.xlsx"));
  const tables = normalizeWorksheets("openpyxl-multi.xlsx", sheets);
  const expected = [
    "Employees",
    "Availability",
    "Shift Demand",
    "Resources",
    "Projects",
    "Demands",
    "Links",
  ];
  assert.deepEqual(
    tables.map((table) => table.name.match(/\[worksheet: (.+)\]$/)?.[1]),
    expected,
  );
  assert.equal(tables.length, expected.length);
  const sources = tables.map((table, index) =>
    createSource(String(index), table.name, table.csv),
  );
  const profiles = profileSourcesForAI(sources);
  assert.deepEqual(
    profiles.map((profile) => profile.name),
    tables.map((table) => table.name),
  );
  assert.deepEqual(profiles.map((profile) => profile.columns[0].header), [
    "employee_id",
    "employee_id",
    "shift_id",
    "resource_id",
    "project_id",
    "project_id",
    "resource_id",
  ]);
  assert.deepEqual(tables.map((table) => table.rowNumbers), [
    [2],
    [2],
    [2],
    [2],
    [2],
    [2],
    [2],
  ]);
  assert.equal(parseCSV(tables[1].csv).rows[0][1], "2026-11-16");
  assert.equal(parseCSV(tables[1].csv).rows[0][2], "09:00");
  assert.equal(parseCSV(tables[2].csv).rows[0][4], "2");
});
test("worksheet data without a matching header or a tabular header is never dropped", () => {
  const sheet = (name: string, rows: string[][]) => ({
    name,
    rows,
    formulas: [],
    warnings: [],
  });
  assert.throws(
    () =>
      normalizeWorksheets("orphaned.xlsx", [
        sheet("Staff", [
          ["employee_id", "name"],
          ["001", "Ada", "unlabeled data"],
        ]),
      ]),
    /Staff!row 2: Worksheet data has no corresponding column header/,
  );
  assert.throws(
    () => normalizeWorksheets("empty-tab.xlsx", [sheet("Notes", [["", ""]])]),
    /Notes: Worksheet has no tabular data to import/,
  );
});
test("formula values without cached results are rejected, never replaced with blanks", async () => {
  await assert.rejects(
    readWorkbook(fixture("openpyxl-uncached-formula.xlsx")),
    /Formula!A2: Formula has no cached result/,
  );
});
test("cached formula results retain their Excel date, time and numeric representations", async () => {
  const w = new ExcelJS.Workbook();
  const sheet = w.addWorksheet("Calculated");
  sheet.addRow(["date", "time", "count", "blank"]);
  sheet.addRow([
    { formula: "DATE(2026,11,16)", result: new Date("2026-11-16T00:00:00Z") },
    { formula: "TIME(9,0,0)", result: new Date("1899-12-30T09:00:00Z") },
    { formula: "1+1", result: 2 },
    null,
  ]);
  sheet.getCell("A2").numFmt = "yyyy-mm-dd";
  sheet.getCell("B2").numFmt = "hh:mm";
  const bytes = await w.xlsx.writeBuffer();
  const read = await readWorkbook(
    new Uint8Array(bytes as any).buffer,
  );
  assert.deepEqual(read[0].rows[1], ["2026-11-16", "09:00", "2", ""]);
  assert.deepEqual(read[0].formulas.map((formula) => formula.cached), [
    "2026-11-16",
    "09:00",
    "2",
  ]);
});
test("spreadsheet status and contextual errors are localized in all supported languages", () => {
  for (const language of ["en", "tr", "fr", "es"] as Language[]) {
    const loading = localizeSpreadsheetMessage("Reading workbook locally…", (s) =>
      translate(language, s),
    );
    const missingCache = localizeSpreadsheetMessage(
      "Staff!A2: Formula has no cached result. Recalculate the workbook and save it before importing.",
      (s) => translate(language, s),
    );
    const emptyFile = localizeSpreadsheetMessage(
      "staff.csv: The file is empty. Choose a file containing data.",
      (s) => translate(language, s),
    );
    assert.equal(loading, translate(language, "Reading workbook locally…"));
    if (language !== "en")
      assert.notEqual(loading, "Reading workbook locally…");
    assert.ok(emptyFile.startsWith("staff.csv: "));
    assert.equal(
      emptyFile.slice("staff.csv: ".length),
      translate(language, "The file is empty. Choose a file containing data."),
    );
    assert.ok(missingCache.startsWith("Staff!A2: "));
    assert.equal(
      missingCache.slice("Staff!A2: ".length),
      translate(
        language,
        "Formula has no cached result. Recalculate the workbook and save it before importing.",
      ),
    );
    if (language !== "en")
      assert.notEqual(
        missingCache.slice("Staff!A2: ".length),
        "Formula has no cached result. Recalculate the workbook and save it before importing.",
      );
  }
});
test("unsupported extension rejected before CSV processing", () => {
  for (const name of ["file.xls", "file.xlsm", "file.pdf", "file"])
    assert.throws(
      () => validateUploadFiles([{ name, size: 10 }]),
      /Unsupported/,
    );
});
test("missing or malformed worksheet metadata never reaches UI", () => {
  for (const data of [
    undefined,
    null,
    {},
    { sheets: [undefined] },
    { sheets: [{ name: "x", rows: [] }] },
  ])
    assert.throws(() => worksheetResponse(data), /worksheet|metadata/);
});
test("both import targets use the same XLSX boundary and independent hook state", async () => {
  for (const file of [
    "components/smart-import/SmartImport.tsx",
    "components/allocation/AllocationImport.tsx",
  ])
    assert.match(
      readFileSync(file, "utf8"),
      /useSpreadsheetUpload\(consumeFiles, t\)/,
    );
  const scheduling = worksheetResponse({
    sheets: await readWorkbook(await workbook(["Staff"])),
  });
  const allocation = worksheetResponse({
    sheets: await readWorkbook(await workbook(["Resources"])),
  });
  scheduling[0].rows[1][0] = "edited";
  assert.equal(allocation[0].rows[1][0], "001");
});
