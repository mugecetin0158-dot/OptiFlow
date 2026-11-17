import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import SmartImport from "../components/smart-import/SmartImport";
import AllocationImport from "../components/allocation/AllocationImport";
import { sampleDraft } from "../lib/allocation/sample";
import { Field } from "../lib/import/types";

(globalThis as any).React = React;
process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

test("multiple Scheduling CSVs reach Gemini interpretation and populate the preview", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost",
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
    confirm: globalThis.confirm,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(dom.window, "confirm", {
    configurable: true,
    value: () => true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const files = [
    ["employees.csv", "ai_employee.csv"],
    ["availability.csv", "ai_availability.csv"],
    ["shifts.csv", "ai_shifts.csv"],
  ] as const;
  let interpretedRequest: any;
  let answerCalls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/answers")) {
      answerCalls++;
      return new Response(
        JSON.stringify({ accepted: 0, remaining_questions: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    assert.equal(String(input), "https://api.example.test/import/interpret");
    interpretedRequest = JSON.parse(String(init?.body));
    const interpretations = interpretedRequest.files.map((file: any) => {
      const dataset = file.name.startsWith("employees")
        ? "employees"
        : file.name.startsWith("availability")
          ? "availability"
          : "shifts";
      const targets: Record<string, Field> =
        dataset === "employees"
          ? {
              employee_id: "employee_id",
              name: "name",
              hourly_rate: "hourly_rate",
              max_weekly_hours: "max_weekly_hours",
              roles: "roles",
            }
          : dataset === "availability"
            ? {
                employee_id: "employee_id",
                date: "availability_date",
                start_time: "availability_start_time",
                end_time: "availability_end_time",
                status: "status",
              }
            : {
                shift_id: "shift_id",
                date: "shift_date",
                start_time: "shift_start_time",
                end_time: "shift_end_time",
                required_count: "required_count",
                required_role: "required_role",
              };
      return {
        source_id: file.source_id,
        datasets: [dataset],
        destination_note: "",
        columns: file.columns.map((column: { header: string }) => ({
          column: column.header,
          field: targets[column.header],
          transform:
            column.header === "date"
              ? "date"
              : column.header.endsWith("_time") || column.header.endsWith("time")
                ? "time"
                : column.header === "status"
                  ? "status"
                  : "direct",
          confidence: 0.99,
          reason: "Synthetic end-to-end mapping",
        })),
        corrections: [],
      };
    });
    return new Response(
      JSON.stringify({
        files: interpretations,
        questions: [],
        requires_verification: false,
        provider: "gemini",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(
        <SmartImport
          language="en"
          saved={null}
          savedRules={{
            minRestHours: "0",
            maxShiftsPerWeek: "5",
            timezone: "Etc/UTC",
            currency: "USD",
            weekStart: "2026-11-16",
            closedWeekdays: [],
            maxWeeklyHours: "",
            maxDailyHours: "",
            allowMultipleShifts: true,
            reviewed: true,
          }}
          onSaved={() => {}}
        />,
      );
    });
    await act(async () => {
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].click();
    });

    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    assert.equal(fileInput.multiple, true);
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: files.map(
        ([name, fixture]) =>
          new File(
            [readFileSync(`tests/fixtures/import/${fixture}`, "utf8")],
            name,
            { type: "text/csv" },
          ),
      ),
    });
    await act(async () => {
      fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    assert.equal(interpretedRequest.target, "scheduling");
    assert.deepEqual(
      interpretedRequest.files.map((file: any) => file.name),
      files.map(([name]) => name),
    );
    assert.deepEqual(
      interpretedRequest.files.map((file: any) => file.row_count),
      [1, 1, 1],
    );
    assert.ok(
      interpretedRequest.files[0].columns
        .find((column: { header: string }) => column.header === "name")
        .samples[0].startsWith("<redacted:"),
    );
    assert.ok(interpretedRequest.files.every((file: any) => !("rows" in file)));

    const summary = [...document.querySelectorAll(".import-summary-cards .metric")];
    assert.deepEqual(
      summary.slice(0, 3).map((metric) => [
        metric.querySelector("span")?.textContent?.trim(),
        metric.querySelector("strong")?.textContent?.trim(),
      ]),
      [
        ["Employees", "1"],
        ["Availability windows", "1"],
        ["Shift requirements", "1"],
      ],
    );
    assert.equal(document.querySelectorAll(".import-data-tables section").length, 3);
    assert.equal(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="employees 1 name"]',
      )?.value,
      "Example Worker",
    );
    assert.equal(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="availability 1 status"]',
      )?.value,
      "available",
    );
    assert.equal(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="shifts 1 shift_id"]',
      )?.value,
      "SHIFT-001",
    );
    assert.equal(document.querySelectorAll(".source-line").length, 3);
    assert.ok(document.body.textContent?.includes("availability.csv:2"));
    assert.equal(
      [...document.querySelectorAll<HTMLButtonElement>(".import-steps button")]
        .find((button) => button.getAttribute("aria-current") === "step")
        ?.textContent?.trim(),
      "4Preview",
      "Missing Information is skipped when interpretation, data, and rules are resolved",
    );
    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="employees 1 name"]',
    )!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(name, "Corrected Worker");
      name.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      name.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      document
        .querySelector<HTMLButtonElement>(".section-heading button")
        ?.click();
    });
    assert.equal(name.value, "Corrected Worker");
    assert.ok(document.body.textContent?.includes("availability.csv:2"));
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".import-steps button")]
        .find((button) => button.textContent?.includes("Missing Information"))
        ?.click();
    });
    const refresh = document.querySelector<HTMLButtonElement>(
      ".missing-question-actions button",
    )!;
    assert.ok(refresh);
    assert.equal(refresh.disabled, false);
    await act(async () => refresh.click());
    assert.equal(answerCalls, 0, "refreshing without answers must not call the answers API");
    assert.equal(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="employees 1 name"]',
      )?.value,
      "Corrected Worker",
      "refreshing must preserve preview corrections",
    );
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".import-steps button")]
        .find((button) => button.textContent?.includes("Upload"))
        ?.click();
    });
    for (const dataset of ["Employees", "Availability", "Shifts"])
      assert.ok(
        document.querySelector(`[aria-label="${dataset}: Validated"]`),
        `${dataset} should be validated in the Upload-stage readiness indicators`,
      );
    await act(async () => {
      root.render(
        <SmartImport
          language="tr"
          saved={null}
          savedRules={null}
          onSaved={() => {}}
        />,
      );
    });
    assert.ok(document.body.textContent?.includes("employees.csv"));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, {
      window: previous.window,
      document: previous.document,
      localStorage: previous.localStorage,
      fetch: previous.fetch,
      confirm: previous.confirm,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previous.navigator,
    });
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});

test("Resource Allocation refresh stays enabled with no unresolved data and preserves preview corrections", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost",
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
    confirm: globalThis.confirm,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  let interpretationCalls = 0;
  globalThis.fetch = async (_input, init) => {
    interpretationCalls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.target, "allocation");
    return new Response(
      JSON.stringify({
        files: request.files.map((file: any) => ({
          source_id: file.source_id,
          datasets: [file.name.replace(".csv", "")],
          destination_note: "",
          columns: file.columns.map((column: any) => ({
            column: column.header,
            field: column.header,
            confidence: 0.99,
          })),
          corrections: [],
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(
        <AllocationImport
          initialSettings={sampleDraft().settings}
          onConfirm={() => {}}
          t={(value) => value}
        />,
      );
    });
    await act(async () => {
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [
        ...["resources", "projects", "demands", "links"].map(
          (table) =>
            new File(
              [readFileSync(`tests/fixtures/allocation/${table}.csv`, "utf8")],
              `${table}.csv`,
              { type: "text/csv" },
            ),
        ),
      ],
    });
    await act(async () => {
      fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".import-steps button")]
        .find((button) => button.textContent?.includes("Missing Information"))
        ?.click();
    });
    const refresh = document.querySelector<HTMLButtonElement>(
      ".missing-question-actions button",
    )!;
    assert.ok(refresh);
    assert.equal(refresh.disabled, false);
    assert.ok(document.body.textContent?.includes("Unresolved fields: 0"));

    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label$="Name"]',
    )!;
    assert.ok(name);
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(name, "Corrected resource");
      name.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      name.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(".missing-question-actions button")
        ?.click();
    });
    assert.equal(interpretationCalls, 1, "local refresh must not repeat AI interpretation");
    assert.equal(name.value, "Corrected resource");
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".import-steps button")]
        .find((button) => button.textContent?.includes("Missing Information"))
        ?.click();
    });
    assert.equal(
      document.querySelector<HTMLButtonElement>(
        ".missing-question-actions button",
      )?.disabled,
      false,
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, {
      window: previous.window,
      document: previous.document,
      localStorage: previous.localStorage,
      fetch: previous.fetch,
      confirm: previous.confirm,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previous.navigator,
    });
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
