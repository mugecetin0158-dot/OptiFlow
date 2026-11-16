import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import SmartImport from "../components/smart-import/SmartImport";
import { readFileSync } from "node:fs";
import { File } from "node:buffer";
import { Field } from "../lib/import/types";

(globalThis as any).React = React;
process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

test("uploading a Scheduling spreadsheet reaches AI and renders editable populated previews", async () => {
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

  const sourceText = readFileSync(
    "tests/fixtures/import/ai_scheduling.csv",
    "utf8",
  );
  let interpretedRequest: any;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.example.test/import/interpret");
    interpretedRequest = JSON.parse(String(init?.body));
    const file = interpretedRequest.files[0];
    const targets: Record<string, Field> = {
      employee_id: "employee_id",
      name: "name",
      hourly_rate: "hourly_rate",
      max_weekly_hours: "max_weekly_hours",
      roles: "roles",
      availability_date: "availability_date",
      availability_start_time: "availability_start_time",
      availability_end_time: "availability_end_time",
      availability_status: "status",
      shift_id: "shift_id",
      shift_date: "shift_date",
      shift_start_time: "shift_start_time",
      shift_end_time: "shift_end_time",
      required_count: "required_count",
      required_role: "required_role",
    };
    return new Response(
      JSON.stringify({
        files: [
          {
            source_id: file.source_id,
            datasets: ["employees", "availability", "shifts"],
            destination_note: "",
            columns: file.columns.map((column: { header: string }) => ({
              column: column.header,
              field: targets[column.header],
              transform:
                column.header.endsWith("_date")
                  ? "date"
                  : column.header.endsWith("_time")
                    ? "time"
                    : column.header === "availability_status"
                      ? "status"
                      : "direct",
              confidence: 0.99,
              reason: "Synthetic end-to-end mapping",
            })),
            corrections: [],
          },
        ],
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
          savedRules={null}
          onSaved={() => {}}
        />,
      );
    });
    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await act(async () => {
      checkboxes[0].click();
    });

    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File([sourceText], "scheduling.csv", { type: "text/csv" })],
    });
    await act(async () => {
      fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    assert.equal(interpretedRequest.target, "scheduling");
    assert.equal(interpretedRequest.files[0].row_count, 1);
    assert.ok(interpretedRequest.files[0].columns.length > 10);
    assert.ok(
      interpretedRequest.files[0].columns
        .find((column: { header: string }) => column.header === "name")
        .samples[0].startsWith("<redacted:"),
    );
    assert.equal("rows" in interpretedRequest.files[0], false);

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
    const tables = document.querySelectorAll(".import-data-tables section");
    assert.equal(tables.length, 3);
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
    assert.ok(document.body.textContent?.includes("scheduling.csv:2"));
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
