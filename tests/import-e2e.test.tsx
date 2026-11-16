import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import SmartImport from "../components/smart-import/SmartImport";
import { readFileSync } from "node:fs";
import { File } from "node:buffer";
import { Field } from "../lib/import/types";
import { readWorkbook } from "../lib/spreadsheet/read";

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

test("openpyxl multi-sheet XLSX reaches AI with every normalized worksheet and renders Scheduling preview", async () => {
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
    Worker: globalThis.Worker,
  };
  class FixtureWorkbookWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage(bytes: ArrayBuffer) {
      void readWorkbook(bytes).then(
        (sheets) => this.onmessage?.({ data: { sheets } } as MessageEvent),
        (error) =>
          this.onmessage?.({
            data: { error: (error as Error).message },
          } as MessageEvent),
      );
    }
    terminate() {}
  }
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: FixtureWorkbookWorker,
  });
  Object.defineProperty(dom.window, "confirm", {
    configurable: true,
    value: () => true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  let interpretedRequest: any;
  const targets: Record<string, { field: Field; transform: string }> = {
    employee_id: { field: "employee_id", transform: "direct" },
    name: { field: "name", transform: "direct" },
    hourly_rate: { field: "hourly_rate", transform: "direct" },
    max_weekly_hours: { field: "max_weekly_hours", transform: "direct" },
    roles: { field: "roles", transform: "direct" },
    shift_id: { field: "shift_id", transform: "direct" },
    required_count: { field: "required_count", transform: "direct" },
    required_role: { field: "required_role", transform: "direct" },
    status: { field: "status", transform: "status" },
  };
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.example.test/import/interpret");
    interpretedRequest = JSON.parse(String(init?.body));
    const files = interpretedRequest.files.map((file: any) => {
      const worksheet = file.name.match(/\[worksheet: (.+)\]\.csv$/)?.[1];
      const datasets =
        worksheet === "Employees"
          ? ["employees"]
          : worksheet === "Availability"
            ? ["availability"]
            : worksheet === "Shift Demand"
              ? ["shifts"]
              : [];
      return {
        source_id: file.source_id,
        datasets,
        destination_note: datasets.length
          ? ""
          : "Allocation information retained outside Scheduling.",
        columns: file.columns.map((column: { header: string }) => {
          let target = targets[column.header];
          if (column.header === "date")
            target = {
              field:
                worksheet === "Availability"
                  ? "availability_date"
                  : "shift_date",
              transform: "date",
            };
          if (column.header === "start_time")
            target = {
              field:
                worksheet === "Availability"
                  ? "availability_start_time"
                  : "shift_start_time",
              transform: "time",
            };
          if (column.header === "end_time")
            target = {
              field:
                worksheet === "Availability"
                  ? "availability_end_time"
                  : "shift_end_time",
              transform: "time",
            };
          return {
            column: column.header,
            field: target?.field || "ignore",
            transform: target?.transform || "direct",
            confidence: 0.99,
            reason: "Synthetic end-to-end mapping",
          };
        }),
        corrections: [],
      };
    });
    return new Response(
      JSON.stringify({
        files,
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
    await act(async () => {
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].click();
    });

    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    const workbookBytes = readFileSync(
      "tests/fixtures/spreadsheet/openpyxl-multi.xlsx",
    );
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [
        new File([workbookBytes], "openpyxl-multi.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ],
    });
    await act(async () => {
      fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    assert.ok(
      interpretedRequest,
      document.querySelector('[role="alert"]')?.textContent ||
        document.body.textContent ||
        "The workbook upload did not reach the AI import endpoint.",
    );
    const expectedWorksheets = [
      "Employees",
      "Availability",
      "Shift Demand",
      "Resources",
      "Projects",
      "Demands",
      "Links",
    ];
    assert.equal(interpretedRequest.files.length, expectedWorksheets.length);
    assert.deepEqual(
      interpretedRequest.files.map((file: any) => file.name),
      expectedWorksheets.map(
        (name) => `openpyxl-multi.xlsx [worksheet: ${name}].csv`,
      ),
    );
    const samples = interpretedRequest.files.map((file: any) =>
      Object.fromEntries(
        file.columns.map((column: any) => [column.header, column.samples]),
      ),
    );
    assert.deepEqual(
      interpretedRequest.files.map((file: any) => file.row_count),
      expectedWorksheets.map(() => 1),
    );
    assert.deepEqual(interpretedRequest.files.map((file: any) => file.columns[0].header), [
      "employee_id",
      "employee_id",
      "shift_id",
      "resource_id",
      "project_id",
      "project_id",
      "resource_id",
    ]);
    assert.deepEqual(samples[0].roles, ["Picker"]);
    assert.deepEqual(samples[1].date, ["2026-11-16"]);
    assert.deepEqual(samples[1].start_time, ["09:00"]);
    assert.deepEqual(samples[2].required_count, ["2"]);
    assert.deepEqual(samples[3].capacity, ["4"]);
    assert.deepEqual(samples[4].minimum_output, ["100"]);
    assert.deepEqual(samples[5].amount_per_output, ["0.02"]);
    assert.deepEqual(samples[6].compatible, ["yes"]);
    assert.ok(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="employees 1 name"]',
      )?.value === "Ada Lovelace",
    );
    assert.equal(
      document.querySelectorAll(".import-data-tables section").length,
      3,
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
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: previous.Worker,
    });
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
