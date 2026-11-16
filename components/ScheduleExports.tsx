"use client";
import { useState } from "react";
import { Scenario, Result } from "../lib/model";
import { schedulingSheets } from "../lib/planning/scheduling";
import { excel, sheetCSV } from "../lib/planning/export";
import { downloadText } from "./smart-import/SmartImport";
export default function ScheduleExports({
  input,
  result,
  edited,
}: {
  input: Scenario;
  result: Result | null;
  edited: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <span>
      <button
        className="btn"
        disabled={!result?.assignments.length}
        onClick={() => {
          if (result)
            downloadText(
              "schedule-verification.csv",
              sheetCSV(schedulingSheets(input, result, edited)[0]),
            );
        }}
      >
        Verification CSV
      </button>
      <button
        className="btn"
        disabled={!result?.assignments.length}
        onClick={async () => {
          try {
            if (!result) return;
            setError("");
            const data = await excel(schedulingSheets(input, result, edited));
            const url = URL.createObjectURL(
              new Blob([data as BlobPart], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "schedule-with-verification.xlsx";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Export Excel
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
