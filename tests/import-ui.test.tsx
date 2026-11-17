import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SmartImport from "../components/smart-import/SmartImport";
import SourceMapping from "../components/smart-import/SourceMapping";
import ImportedSchedule from "../components/smart-import/ImportedSchedule";
import { createSource } from "../lib/import/recognition";
import { translate, Language } from "../lib/i18n";
// tsx uses classic JSX for this repository's Next.js preserve setting.
(globalThis as any).React = React;
const escapeHTML = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
test("upload workflow renders in all three languages without employee data or fake success", () => {
  for (const language of ["en", "tr", "fr", "es"] as Language[]) {
    const html = renderToStaticMarkup(
      <SmartImport
        language={language}
        saved={null}
        savedRules={null}
        onSaved={() => {}}
      />,
    );
    assert.ok(html.includes(translate(language, "Choose CSV files")));
    assert.ok(html.includes('accept=".csv,text/csv"'));
    assert.ok(!html.includes(".xlsx"));
    assert.ok(
      html.includes(escapeHTML(translate(language, "What you'll need"))),
    );
    assert.ok(
      html.includes(
        escapeHTML(
          translate(
            language,
            "To create a complete scheduling model, OptiFlow needs three types of data:",
          ),
        ),
      ),
    );
    for (const text of [
      "Employee IDs, names, hourly rates, maximum weekly hours, and roles.",
      "Which employees are available, on which dates, and during which hours.",
      "The shifts that need coverage, including dates, start/end times, required staffing counts, and roles.",
      "Upload these datasets together or separately. OptiFlow will automatically identify and organize the information using AI. If anything is missing or unclear, we'll ask you to provide it.",
      "Dataset readiness",
    ])
      assert.ok(html.includes(escapeHTML(translate(language, text))), text);
    for (const dataset of ["Employees", "Availability", "Shifts"])
      assert.ok(
        html.includes(
          escapeHTML(
            `${translate(language, dataset)}: ${translate(language, "Missing")}`,
          ),
        ),
      );
    for (const stage of ["AI Interpretation", "Missing Information", "Preview", "Save"])
      assert.ok(html.includes(translate(language, stage)));
    assert.ok(!html.includes(translate(language, "Optional Verification")));
    const stages = html.match(/<ol class="import-steps">([\s\S]*?)<\/ol>/)?.[1] || "";
    assert.equal((stages.match(/<li>/g) || []).length, 5);
    assert.ok(!html.includes(translate(language, "Map columns")));
    assert.ok(html.includes(translate(language, "I consent to sending minimized column metadata and redacted representative values to the configured AI provider for this import.")));
    assert.ok(!html.includes("Alex Morgan"));
    assert.ok(
      !html.includes(
        translate(
          language,
          "Validated data saved locally. No optimization has been run.",
        ),
      ),
    );
  }
});
test("source mapping shows ambiguous fields, stable machine target values and escaped file content", () => {
  const source = createSource(
    "1",
    "<script>alert(1)</script>.csv",
    "Staff Number,Rate,Hours\n001,18,32",
  );
  const html = renderToStaticMarkup(
    <SourceMapping
      source={source}
      onChange={() => {}}
      onRemove={() => {}}
      onProfile={() => {}}
      onApply={() => {}}
      profiles={[]}
      t={(s) => translate("tr", s)}
    />,
  );
  assert.ok(html.includes(translate("tr", "Needs confirmation")));
  assert.ok(html.includes('value="hourly_rate"'));
  assert.ok(html.includes("001"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>alert(1)"));
});
test("empty imported Scheduling mode requests validated data and offers no solve action", () => {
  const html = renderToStaticMarkup(
    <ImportedSchedule
      saved={null}
      rules={null}
      t={(s) => s}
      onReview={() => {}}
    />,
  );
  assert.ok(html.includes("Open Smart Import"));
  assert.ok(!html.includes("Generate Optimal Schedule"));
});

test("mapper separates parsing from mapping and previews time-range outputs before confirmation", () => {
  const source = createSource(
    "w",
    "raw_worker_windows.csv",
    "Badge,Day,Time Window,Can Work?\nW001,2026-11-16,14:00-22:00,YES\nW002,11/17/2026,09:00-17:00,NO",
  );
  for (const language of ["en", "tr", "fr", "es"] as Language[]) {
    const html = renderToStaticMarkup(
      <SourceMapping
        source={source}
        onChange={() => {}}
        onRemove={() => {}}
        onProfile={() => {}}
        onApply={() => {}}
        profiles={[]}
        t={(s) => translate(language, s)}
      />,
    );
    for (const label of [
      "Parsing validation",
      "Mapping validation",
      "Needs attention",
      "Split into start_time and end_time",
      "Original uploaded CSV",
    ])
      assert.ok(html.includes(translate(language, label)), label);
    assert.ok(html.includes("start_time: 14:00"));
    assert.ok(html.includes("end_time: 22:00"));
    assert.ok(html.includes("2026-11-17"));
    assert.ok(html.includes("status: unavailable"));
    assert.ok(
      !html.includes(translate(language, "No validation errors or warnings.")),
    );
  }
});
test("unknown columns never show an all-clear banner after successful parsing", () => {
  const source = createSource("u", "unknown.csv", "Unrelated,Other\nx,y");
  const html = renderToStaticMarkup(
    <SourceMapping
      source={source}
      onChange={() => {}}
      onRemove={() => {}}
      onProfile={() => {}}
      onApply={() => {}}
      profiles={[]}
      t={(s) => s}
    />,
  );
  assert.ok(html.includes("Parsing validation"));
  assert.ok(html.includes("Needs attention"));
  assert.ok(!html.includes("No validation errors or warnings."));
});
