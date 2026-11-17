import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GLPK from "glpk.js";
import ResourceWorkspace from "../components/allocation/ResourceWorkspace";
import AllocationImport from "../components/allocation/AllocationImport";
import AllocationResults from "../components/allocation/AllocationResults";
import CatalogEditor from "../components/allocation/CatalogEditor";
import { sampleDraft, sampleInput } from "../lib/allocation/sample";
import { emptyDraft } from "../lib/allocation/types";
import { solveAllocation } from "../lib/allocation/solver";
import { translate, Language } from "../lib/i18n";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import catalog from "../lib/translations.json";
(globalThis as any).React = React;
test("resource workspace starts empty, labels sample explicitly, and keeps all language options", () => {
  for (const language of ["en", "tr", "fr", "es"] as Language[]) {
    const html = renderToStaticMarkup(
      <ResourceWorkspace
        language={language}
        visible
        importActive={false}
        onImport={() => {}}
        onImported={() => {}}
      />,
    );
    for (const label of [
      "Start manual entry",
      "Load labeled sample",
      "No allocation has been generated.",
      "Optimize resource allocation",
    ])
      assert.ok(html.includes(translate(language, label)), label);
    assert.ok(!html.includes("Website delivery"));
    assert.ok(!html.includes("1380"));
  }
});
test("resource Smart Import exposes real file controls, staging, and no fabricated preview", () => {
  const html = renderToStaticMarkup(
    <AllocationImport
      initialSettings={emptyDraft().settings}
      onConfirm={() => {}}
      t={(s) => s}
    />,
  );
  assert.ok(html.includes('type="file"'));
  assert.ok(html.includes("Parsing validation"));
  assert.ok(html.includes("Mapping validation"));
  assert.ok(html.includes("Dataset validation"));
  assert.ok(html.includes("What Resource Allocation needs"));
  assert.ok(html.includes("Required fields"));
  assert.ok(html.includes("Optional fields"));
  assert.equal(
    (html.match(/<ol class="import-steps">([\s\S]*?)<\/ol>/)?.[1].match(/<li>/g) || []).length,
    5,
  );
  assert.ok(!html.includes("Optional Verification"));
  assert.ok(html.includes("Not validated"));
  assert.ok(!html.includes("No validation errors or warnings"));
});
test("catalog controls preserve escaped source values and editable resource fields", () => {
  const draft = sampleDraft();
  draft.tables.resources[0].values.name = '<script>alert("x")</script>';
  const html = renderToStaticMarkup(
    <CatalogEditor
      draft={draft}
      onChange={() => {}}
      issues={[]}
      t={(s) => s}
    />,
  );
  assert.ok(html.includes("resource_id"));
  assert.ok(html.includes("unit_cost"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("Compatibility &amp; limits"));
});
test("actual results show objective, unit-specific utilization, binding constraints and CSV actions", async () => {
  const input = sampleInput(),
    result = await solveAllocation(input, GLPK());
  const html = renderToStaticMarkup(
    <AllocationResults input={input} result={result} t={(s) => s} />,
  );
  for (const label of [
    "1380",
    "OPTIMAL",
    "Resource utilization",
    "Binding constraints",
    "Export allocations CSV",
    "Project outputs",
  ])
    assert.ok(html.includes(label), label);
  assert.ok(html.includes("hour"));
});
test("unbounded/unknown/infeasible results never render an accepted allocation or export", () => {
  for (const status of ["UNBOUNDED", "UNKNOWN", "INFEASIBLE"] as const) {
    const html = renderToStaticMarkup(
      <AllocationResults
        input={sampleInput()}
        result={{
          status,
          engine: "GLPK",
          seconds: 0,
          messages: ["No accepted solution"],
        }}
        t={(s) => s}
      />,
    );
    assert.ok(html.includes(status));
    assert.ok(!html.includes("Export allocations CSV"));
    assert.ok(!html.includes("All hard constraints passed"));
  }
});
test("new explicit UI labels and conditional labels have Turkish and French translations", () => {
  const files = readdirSync("components/allocation").filter((f) =>
    f.endsWith("tsx"),
  );
  for (const name of files) {
    const source = ts.createSourceFile(
      name,
      readFileSync(`components/allocation/${name}`, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function literals(node: ts.Node) {
      if (
        ts.isStringLiteral(node) &&
        /[A-Za-z]/.test(node.text) &&
        node.text !== "—"
      ) {
        const key = node.text.trim();
        assert.ok(catalog[key]?.[0] && catalog[key]?.[1], `${name}: ${key}`);
      } else if (ts.isConditionalExpression(node)) {
        literals(node.whenTrue);
        literals(node.whenFalse);
      }
    }
    function walk(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "t" &&
        node.arguments[0]
      )
        literals(node.arguments[0]);
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
});
