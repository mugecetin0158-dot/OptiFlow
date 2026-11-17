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
test("allocation import uses five-stage AI navigation and accepts CSV files", () => {
  const html = renderToStaticMarkup(
    <AllocationImport
      initialSettings={emptyDraft().settings}
      onConfirm={() => {}}
      t={(s) => s}
    />,
  );
  for (const label of [
    "Upload",
    "AI Interpretation",
    "Missing Information",
    "Preview",
    "Save",
  ])
    assert.ok(html.includes(label));
  const steps = html.match(/<ol class="import-steps">([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(steps);
  assert.equal((steps.match(/<li>/g) || []).length, 5);
  assert.ok(!html.includes("AI Processing"));
  assert.ok(!html.includes("Preview &amp; save"));
  assert.ok(!html.includes("Optional Verification"));
  assert.ok(!html.includes("Map columns"));
  assert.ok(html.includes("I consent to sending minimized column metadata"));
  assert.ok(html.includes('accept=".csv,text/csv"'));
  assert.ok(html.includes("multiple"));
  assert.ok(html.includes("Mapping validation"));
});
