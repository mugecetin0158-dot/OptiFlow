import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import SmartImport from "../components/smart-import/SmartImport";

(globalThis as any).React = React;
process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

test("Scheduling refresh accepts zero, partial, and complete answers and updates unresolved questions", async () => {
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
  const objectiveQuestion = {
    id: "objective",
    prompt: "Choose an objective",
    answer_type: "choice",
    options: ["minimize_cost", "maximize_output"],
    target: "model.objective",
    required: true,
  };
  const hoursQuestion = {
    id: "weekly-hours",
    prompt: "Provide weekly hours",
    answer_type: "number",
    options: [],
    target: "employees.max_weekly_hours",
    required: true,
  };
  let interpretationCalls = 0;
  const submittedAnswers: { question_id: string; value: string }[][] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/answers")) {
      const request = JSON.parse(String(init?.body));
      submittedAnswers.push(request.answers);
      return new Response(
        JSON.stringify({
          accepted: request.answers.length,
          remaining_questions:
            submittedAnswers.length === 1
              ? [objectiveQuestion, hoursQuestion]
              : [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    interpretationCalls++;
    const request = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        session_id: "session-1",
        files: request.files.map((file: any) => ({
          source_id: file.source_id,
          datasets: ["employees"],
          destination_note: "",
          columns: file.columns.map((column: any) => ({
            column: column.header,
            field: column.header,
            transform: "direct",
            confidence: 0.99,
            reason: "Test mapping",
          })),
          corrections: [],
        })),
        questions: [objectiveQuestion, hoursQuestion],
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
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [
        new File(
          [readFileSync("tests/fixtures/import/ai_employee.csv", "utf8")],
          "employees.csv",
          { type: "text/csv" },
        ),
      ],
    });
    await act(async () => {
      fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    assert.equal(interpretationCalls, 1);
    const refresh = () =>
      document.querySelector<HTMLButtonElement>(
        ".missing-question-actions button",
      )!;
    assert.ok(refresh());
    assert.equal(refresh().disabled, false);

    await act(async () => refresh().click());
    assert.equal(submittedAnswers.length, 0, "zero answers must not call the answers API");
    const objective = document.querySelector<HTMLSelectElement>(
      ".missing-question-card select",
    )!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        dom.window.HTMLSelectElement.prototype,
        "value",
      )?.set;
      setValue?.call(objective, "minimize_cost");
      objective.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      objective.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => refresh().click());
    assert.deepEqual(submittedAnswers[0], [
      { question_id: "objective", value: "minimize_cost" },
    ]);
    assert.equal(document.querySelectorAll(".missing-question-card").length, 2);
    assert.equal(
      document.querySelector<HTMLSelectElement>(
        ".missing-question-card select",
      )?.value,
      "minimize_cost",
      "partial refresh must preserve the supplied answer",
    );

    const hours = document.querySelector<HTMLInputElement>(
      '.missing-question-card input[type="number"]',
    )!;
    await act(async () => {
      const setSelectValue = Object.getOwnPropertyDescriptor(
        dom.window.HTMLSelectElement.prototype,
        "value",
      )?.set;
      const setInputValue = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setSelectValue?.call(objective, "maximize_output");
      objective.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      objective.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      setInputValue?.call(hours, "40");
      hours.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      hours.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await act(async () => refresh().click());
    assert.deepEqual(submittedAnswers[1], [
      { question_id: "objective", value: "maximize_output" },
      { question_id: "weekly-hours", value: "40" },
    ]);
    assert.equal(interpretationCalls, 1, "refresh must not repeat AI interpretation");
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
