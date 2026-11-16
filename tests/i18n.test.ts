import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import catalog from "../lib/translations.json";
import {
  translate,
  formatMoney,
  formatDay,
  formatRunTime,
  isLanguage,
  Language,
} from "../lib/i18n";
import { preset, analyze, csv, inputErrors, shortages } from "../lib/model";
import initialResult from "../lib/demo.json";

test("planning workbench labels have complete translations", () => {
  const labels = [
    "JOINT MULTI-PERIOD PLANNING",
    "From spreadsheet to verified decisions",
    "Model & constraints",
    "Scenarios & run history",
    "Compare runs",
    "Planning periods",
    "Cancel optimization",
    "Save scenario",
    "Minimize cost",
    "Maximize explicitly weighted output",
    "Maximize net value (gross value − cost)",
  ];
  for (const label of labels) {
    for (const language of ["tr", "fr"] as Language[]) {
      assert.notEqual(translate(language, label), label, `${language}: ${label}`);
    }
  }
});

test("every explicit interface label has Turkish and French translations", () => {
  const source = readFileSync("app/page.tsx", "utf8");
  const file = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "tr" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const key = node.arguments[0].text.trim();
      if (/[a-z]/i.test(key)) {
        assert.ok(catalog[key], key);
        assert.ok(catalog[key][0] && catalog[key][1], key);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(isLanguage("tr"), true);
  assert.equal(isLanguage("fr"), true);
  assert.equal(isLanguage("de"), false);
});

test("four-language catalog has complete nonempty translations", () => {
  assert.ok(Object.keys(catalog).length >= 800);
  for (const [key, translations] of Object.entries(catalog)) {
    assert.equal(translations.length, 3, key);
    for (const value of translations) assert.ok(typeof value === "string" && value.trim(), key);
  }
  for (const language of ["en", "tr", "fr", "es"] as Language[]) {
    assert.equal(isLanguage(language), true);
    assert.ok(translate(language, "Resource Allocation"));
  }
  assert.equal(translate("es", "Resource Allocation"), "Asignación de recursos");
  assert.match(translate("es", "Day 1 Morning: needs 2, but only 1 eligible employees are available."), /^Día 1/);
  assert.match(formatMoney("es", 12345.5), /12\.345,50/);
});

test("CSV-only import removes obsolete Excel messages and retains export translations", () => {
  const obsoleteKeys = [
    "Drop CSV or Excel files here",
    "Choose CSV or Excel files",
    "Unsupported file type. Choose an .xlsx, .csv or .tsv file.",
    "Encrypted workbooks are unsupported.",
    "Reading workbook locally…",
    "Worksheet has no tabular data to import.",
    "Import CSV / Excel into selected period",
    "Download fictional sample workbook",
  ];
  for (const key of obsoleteKeys)
    assert.equal(catalog[key as keyof typeof catalog], undefined, key);

  assert.ok(catalog["From spreadsheet to verified decisions"]);
  assert.ok(
    catalog[
      "Spreadsheet formula-like text is preserved. Import exports as text in spreadsheet software."
    ],
  );
});

test("literal UI translation calls resolve in all four languages", () => {
  function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(`${directory}/${entry.name}`) : /\.tsx$/.test(entry.name) ? [`${directory}/${entry.name}`] : []);
  }
  const missing = new Set<string>();
  for (const path of [...files("app"), ...files("components")]) {
    const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && /^(t|tr)$/.test(node.expression.getText(file)) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text.trim();
        if (/[a-z]/i.test(key) && !catalog[key as keyof typeof catalog]) missing.add(`${path}: ${key}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  assert.deepEqual([...missing], []);
});

test("localized model messages preserve employee names, amounts and hard-constraint meaning", () => {
  const p = preset();
  p.employees[0].name = "Morning";
  p.employees[0].wage = -1;
  p.employees[0].maxHours = -1;
  p.shifts[0].end = "08:00";
  p.shifts[1].required = 31;
  const cases = [
    ...inputErrors(p),
    ...shortages(preset("Infeasible test")),
    "Morning is unavailable for day 1 Afternoon.",
    "Morning has overlapping shifts on day 2.",
    "Morning: 36h exceeds the 32h weekly limit.",
    "Day 1 Morning: 2 unfilled position(s).",
    "Weekly demand is 128 hours; employee limits provide only 120 hours.",
    "Retail Store example loaded",
    "8 employees in your team",
    "14 shifts with staffing requirements",
    "2 constraint violations",
  ];
  for (const l of ["tr", "fr"] as Language[])
    for (const text of cases) {
      assert.notEqual(translate(l, text), text, `${l}: ${text}`);
    }
  assert.match(
    translate("tr", "Morning is unavailable for day 1 Afternoon."),
    /^Morning,/,
  );
  assert.match(
    translate("fr", "Morning has overlapping shifts on day 2."),
    /^Morning /,
  );
  assert.equal(
    translate("tr", "Add at least one employee.\nEvery employee needs a name."),
    "En az bir çalışan ekleyin.\nHer çalışan için bir ad girin.",
  );
  assert.equal(
    translate("en", "Generate Optimal Schedule"),
    "Generate Optimal Schedule",
  );
});

test("CSV localization changes headings and shifts but never employee data or assignment costs", () => {
  const p = preset();
  p.employees[0].name = "Morning";
  const before = JSON.stringify({ p, result: initialResult });
  const original = analyze(p, initialResult.assignments);
  for (const l of ["tr", "fr"] as Language[]) {
    const output = csv(p, initialResult.assignments, (s) => translate(l, s));
    assert.ok(output.startsWith(`"${translate(l, "Employee")}"`));
    assert.ok(output.includes('"2026-11-16"'));
    assert.ok(output.includes(`"${translate(l, "Morning")}"`));
    assert.ok(
      output.includes('"Morning"'),
      "Employee name must not be translated",
    );
    assert.equal(
      output.split("\r\n").length,
      csv(p, initialResult.assignments).split("\r\n").length,
    );
    assert.deepEqual(analyze(p, initialResult.assignments), original);
  }
  assert.equal(JSON.stringify({ p, result: initialResult }), before);
});

test("date and currency formatting follows the language without currency conversion", () => {
  assert.equal(formatMoney("en", 1234.5), "$1,234.50");
  assert.match(formatMoney("tr", 1234.5), /1\.234,50/);
  assert.match(formatMoney("fr", 1234.5), /1\s234,50/);
  assert.match(formatDay("tr", "2026-11-16", "weekday"), /Pzt/);
  assert.match(formatDay("fr", "2026-11-16", "weekday"), /lun/);
  assert.match(formatRunTime("tr", "2026-11-13T20:00:00Z"), /23:00/);
  assert.equal(formatDay("tr", ""), "");
});
