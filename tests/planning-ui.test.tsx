import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Workbench from "../components/planning/Workbench";
import AllocationImport from "../components/allocation/AllocationImport";
import ImportedSchedule from "../components/smart-import/ImportedSchedule";
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
test("validated scheduling imports expose the live optimizer instead of the old connection gate", () => {
  const rules = {
    minRestHours: "0",
    maxShiftsPerWeek: "5",
    maxWeeklyHours: "",
    timezone: "Etc/UTC",
    currency: "USD",
    weekStart: "2026-11-16",
    closedWeekdays: [],
    maxDailyHours: "8",
    allowMultipleShifts: true,
    reviewed: true,
  };
  const values = {
    employees: [
      {
        employee_id: "E-1",
        name: "Example Worker",
        hourly_rate: 20,
        max_weekly_hours: 40,
        roles: ["Picker"],
      },
    ],
    availability: [
      {
        employee_id: "E-1",
        date: "2026-11-16",
        start_time: "09:00",
        end_time: "17:00",
        status: "available" as const,
      },
    ],
    shifts: [
      {
        shift_id: "S-1",
        date: "2026-11-16",
        start_time: "09:00",
        end_time: "17:00",
        required_count: 1,
        required_role: "Picker",
      },
    ],
  };
  const saved = {
    version: 1 as const,
    savedAt: "2026-11-16T00:00:00.000Z",
    data: values,
    draft: {
      employees: [
        {
          values: {
            employee_id: "E-1",
            name: "Example Worker",
            hourly_rate: "20",
            max_weekly_hours: "40",
            roles: '["Picker"]',
          },
          sources: [],
        },
      ],
      availability: [
        {
          values: {
            employee_id: "E-1",
            date: "2026-11-16",
            start_time: "09:00",
            end_time: "17:00",
            status: "available",
          },
          sources: [],
        },
      ],
      shifts: [
        {
          values: {
            shift_id: "S-1",
            date: "2026-11-16",
            start_time: "09:00",
            end_time: "17:00",
            required_count: "1",
            required_role: "Picker",
          },
          sources: [],
        },
      ],
    },
    issues: [],
    unmapped: [],
    rulesRevision: JSON.stringify(rules),
  };
  const html = renderToStaticMarkup(
    <ImportedSchedule
      saved={saved}
      rules={rules}
      language="en"
      t={(s) => s}
      onReview={() => {}}
    />,
  );
  assert.ok(html.includes("Optimize imported schedule"));
  assert.ok(html.includes("Minimum-rest checks cover shifts"));
  assert.ok(!html.includes("Optimizer connection required"));
});
