"use client";
import { useEffect, useRef, useState } from "react";
import {
  localizeSpreadsheetMessage,
  validateUploadFiles,
  worksheetResponse,
} from "../lib/spreadsheet/protocol";
import { normalizeWorksheets } from "../lib/spreadsheet/normalize";
import type { WorkbookSheet } from "../lib/spreadsheet/read";

type NormalizedFile = File & {
  worksheetRows?: number[];
};

export function useSpreadsheetUpload(
  consume: (files: File[]) => Promise<boolean>,
  translate: (message: string) => string,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const worker = useRef<Worker | null>(null),
    reject = useRef<(error: Error) => void>(() => {});
  const localize = (message: string) =>
    localizeSpreadsheetMessage(message, translate);

  useEffect(
    () => () => {
      worker.current?.terminate();
      reject.current(Error("Workbook import cancelled."));
    },
    [],
  );

  async function read(file: File): Promise<WorkbookSheet[]> {
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      throw Error("Workbook could not be parsed.");
    }
    return new Promise((resolve, fail) => {
      let current: Worker;
      try {
        current = new Worker(
          new URL("../lib/spreadsheet/worker.ts", import.meta.url),
        );
      } catch {
        fail(Error("Workbook could not be parsed."));
        return;
      }
      worker.current = current;
      const timeout = setTimeout(() => {
        finish();
        fail(Error("Workbook parsing timed out."));
      }, 20000);
      const finish = () => {
        clearTimeout(timeout);
        current.terminate();
        worker.current = null;
      };
      reject.current = (error) => {
        finish();
        fail(error);
      };
      current.onmessage = (event) => {
        finish();
        try {
          resolve(worksheetResponse(event.data));
        } catch (error) {
          fail(error);
        }
      };
      current.onmessageerror = () => {
        finish();
        fail(
          Error(
            "The workbook parser returned unreadable data. Please try again.",
          ),
        );
      };
      current.onerror = () => {
        finish();
        fail(Error("Workbook could not be parsed."));
      };
      current.postMessage(bytes, [bytes]);
    });
  }

  async function upload(files: File[]) {
    if (busy) return;
    setError("");
    try {
      validateUploadFiles(files);
      const excelFiles = files.filter((file) => /\.xlsx$/i.test(file.name));
      if (!excelFiles.length) {
        await consume(files);
        return;
      }

      setBusy(true);
      const normalized: File[] = files.filter(
        (file) => !/\.xlsx$/i.test(file.name),
      );
      for (const file of excelFiles) {
        if (file.size > 10 * 1024 * 1024)
          throw Error("XLSX limit: 10 MB.");
        const sheets = await read(file);
        for (const table of normalizeWorksheets(file.name, sheets)) {
          const normalizedFile = new File(
            [table.csv],
            `${table.name}.csv`,
            { type: "text/csv" },
          ) as NormalizedFile;
          normalizedFile.worksheetRows = table.rowNumbers;
          normalized.push(normalizedFile);
        }
      }
      setBusy(false);
      if (!normalized.length)
        throw Error("The workbook has no tabular data to import.");
      if (!(await consume(normalized)))
        throw Error(
          "Import was not accepted. Review the upload error and check the workbook data.",
        );
    } catch (failure) {
      setError(
        localize(
          failure instanceof Error ? failure.message : String(failure),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <>
      {busy && (
        <div className="notice info" role="status">
          {translate("Reading workbook locally…")}{" "}
          <button
            className="btn"
            onClick={() => reject.current(Error("Workbook import cancelled."))}
          >
            {translate("Cancel")}
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="btn" onClick={() => setError("")}>
            {translate("Dismiss")}
          </button>
        </div>
      )}
    </>
  );
  return { upload, picker };
}
