import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Workbench from "../components/planning/Workbench";
import AllocationImport from "../components/allocation/AllocationImport";
import { emptyDraft } from "../lib/allocation/types";
(globalThis as any).React = React;
test("planning workspace exposes editable periods, explicit policies and objective choices without a fake result", () => {
  const html = renderToStaticMarkup(
    <Workbench incoming={emptyDraft()} onImport={() => {}} t={(s) => s} />,
  );
  for (const text of [
    "Add empty period",
    "Start date",
    "End date",
    "Minimize cost",
    "Maximize net value",
    "Optimize all periods together",
    "Scenarios &amp; run history",
    "Compare runs",
    "Start manual entry",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes("Verification: passed"));
});
test("allocation import uses three-stage AI navigation and accepts real workbook selection", () => {
  const html = renderToStaticMarkup(
    <AllocationImport
      initialSettings={emptyDraft().settings}
      onConfirm={() => {}}
      t={(s) => s}
    />,
  );
  for (const label of [
    "Upload",
    "AI Processing",
    "Preview &amp; save",
  ])
    assert.ok(html.includes(label));
  assert.ok(!html.includes("Map columns"));
  assert.ok(html.includes("I consent to sending minimized column metadata"));
  assert.ok(html.includes('accept=".xlsx,.csv,.tsv,text/csv"'));
  assert.ok(html.includes("Mapping validation"));
});
