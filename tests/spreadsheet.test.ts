import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { readWorkbook } from "../lib/spreadsheet/read";
import {
  worksheetResponse,
  validateUploadFiles,
} from "../lib/spreadsheet/protocol";
import { parseCSV } from "../lib/import/csv";
import { readFileSync } from "node:fs";
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
    /empty/,
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
      /useSpreadsheetUpload\(consumeFiles\)/,
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
