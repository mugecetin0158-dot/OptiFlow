"use client";
import { detectHeaderRow } from "../lib/import/automation";
import { useRef, useState, useEffect } from "react";
import {
  validateUploadFiles,
  worksheetResponse,
} from "../lib/spreadsheet/protocol";
import { WorkbookSheet } from "../lib/spreadsheet/read";
import { writeCSV } from "../lib/import/csv";
export function useSpreadsheetUpload(
  consume: (files: File[]) => Promise<boolean>,
) {
  const [books, setBooks] = useState<
      { file: string; sheets: WorkbookSheet[] }[]
    >([]),
    [chosen, setChosen] = useState<Record<string, boolean>>({}),
    [headers, setHeaders] = useState<Record<string, number>>({}),
    [pages, setPages] = useState<Record<string, number>>({}),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const worker = useRef<Worker | null>(null),
    reject = useRef<(e: Error) => void>(() => {}),
    pending = useRef<File[]>([]);
  useEffect(
    () => () => {
      worker.current?.terminate();
      reject.current(Error("Cancelled"));
    },
    [],
  );
  async function upload(files: File[]) {
    if (busy) return;
    try {
      validateUploadFiles(files);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setError("");
    if (!files.some((f) => /\.xlsx$/i.test(f.name))) {
      await consume(files);
      return;
    }
    setBusy(true);
    setError("");
    setBooks([]);
    setChosen({});
    setHeaders({});
    setPages({});
    setAccepted(false);
    pending.current = files.filter((f) => !/\.xlsx$/i.test(f.name));
    try {
      const loaded: typeof books = [];
      for (const file of files.filter((f) => /\.xlsx$/i.test(f.name))) {
        if (file.size > 10 * 1024 * 1024) throw Error("XLSX limit: 10 MB.");
        const bytes = await file.arrayBuffer();
        const sheets = await new Promise<WorkbookSheet[]>((resolve, fail) => {
          const w = new Worker(
            new URL("../lib/spreadsheet/worker.ts", import.meta.url),
          );
          worker.current = w;
          const timeout = setTimeout(() => {
            w.terminate();
            fail(Error("Workbook parsing timed out."));
          }, 20000);
          const finish = () => {
            clearTimeout(timeout);
            w.terminate();
            worker.current = null;
          };
          reject.current = (e) => {
            finish();
            fail(e);
          };
          w.onmessage = (e) => {
            finish();
            try {
              resolve(worksheetResponse(e.data));
            } catch (error) {
              fail(error);
            }
          };
          w.onmessageerror = () => {
            finish();
            fail(
              Error(
                "The workbook parser returned unreadable data. Please try again.",
              ),
            );
          };
          w.onerror = () => {
            finish();
            fail(Error("Workbook could not be parsed."));
          };
          w.postMessage(bytes, [bytes]);
        });
        loaded.push({ file: file.name, sheets });
      }
      setBooks(loaded);
      setHeaders(
        Object.fromEntries(
          loaded.flatMap((b, bi) =>
            b.sheets.map((s, si) => [`${bi}:${si}`, detectHeaderRow(s.rows)]),
          ),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    try {
      const files = [...pending.current];
      let count = 0;
      for (const [bi, b] of books.entries())
        for (const [si, s] of b.sheets.entries()) {
          const id = `${bi}:${si}`;
          if (!chosen[id]) continue;
          const h = headers[id] || 0;
          const formulas = s.formulas.filter((f) => f.row >= h);
          if ((formulas.length || s.warnings.length) && !accepted)
            throw Error(
              "Review worksheet warnings and explicitly accept cached formula values, or correct the source cells.",
            );
          if (formulas.some((f) => f.cached === null))
            throw Error(
              "Formula has no cached result. Enter an explicit cell value in the worksheet preview.",
            );
          count += s.rows.length - h - 1;
          if (count > 10000)
            throw Error("Selected worksheets exceed 10,000 rows.");
          files.push(
            Object.assign(
              new File(
                [writeCSV(s.rows[h] || [], s.rows.slice(h + 1))],
                `${b.file} [${s.name}; header row ${h + 1}].csv`,
                { type: "text/csv" },
              ),
              {
                worksheetRows: s.rows
                  .slice(h + 1)
                  .map((row, i) => ({ row, i }))
                  .filter(({ row }) => row.some((v) => v.trim()))
                  .map(({ i }) => h + i + 2),
              },
            ),
          );
        }
      if (!files.length) throw Error("Select at least one worksheet.");
      if (!(await consume(files)))
        throw Error(
          "Import was not accepted. Review the upload error and correct or reduce the selected worksheets.",
        );
      setBooks([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const picker = (
    <>
      {busy && (
        <div className="notice info">
          Reading workbook locally…{" "}
          <button
            className="btn"
            onClick={() => reject.current(Error("Workbook import cancelled."))}
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="btn" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      {books.length > 0 && (
        <section className="panel import-panel">
          <h3>Select worksheets and review cells</h3>
          <p>
            Formulas are never executed. Cached results may be stale; explicit
            acceptance is required. Select the header row. Preview cells are
            editable.
          </p>
          {books.map((b, bi) =>
            b.sheets.map((s, si) => {
              const id = `${bi}:${si}`;
              const page = pages[id] || 0;
              return (
                <details key={id}>
                  <summary>
                    <input
                      type="checkbox"
                      aria-label={`Import ${b.file} ${s.name}`}
                      checked={!!chosen[id]}
                      onChange={(e) =>
                        setChosen({ ...chosen, [id]: e.target.checked })
                      }
                    />
                    {b.file} · {s.name} · {s.rows.length} rows
                  </summary>
                  <label>
                    Header row{" "}
                    <input
                      type="number"
                      min={1}
                      max={s.rows.length}
                      value={(headers[id] || 0) + 1}
                      onChange={(e) =>
                        setHeaders({
                          ...headers,
                          [id]: Math.max(
                            0,
                            Math.min(s.rows.length - 1, +e.target.value - 1),
                          ),
                        })
                      }
                    />
                  </label>
                  {s.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        {s.rows
                          .slice(page * 20, (page + 1) * 20)
                          .map((row, offset) => {
                            const ri = page * 20 + offset;
                            return (
                              <tr key={ri}>
                                <th>{ri + 1}</th>
                                {row.map((cell, ci) => (
                                  <td key={ci}>
                                    <input
                                      aria-label={`${s.name} row ${ri + 1} column ${ci + 1}`}
                                      value={cell}
                                      onChange={(e) => {
                                        const next = structuredClone(books);
                                        next[bi].sheets[si].rows[ri][ci] =
                                          e.target.value;
                                        next[bi].sheets[si].formulas = next[
                                          bi
                                        ].sheets[si].formulas.filter(
                                          (f) => f.row !== ri || f.col !== ci,
                                        );
                                        setBooks(next);
                                      }}
                                    />
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    {s.formulas.length} formula cells. Page {page + 1} of{" "}
                    {Math.max(1, Math.ceil(s.rows.length / 20))}. All records
                    remain included.
                    <button
                      className="btn"
                      disabled={!page}
                      onClick={() => setPages({ ...pages, [id]: page - 1 })}
                    >
                      Previous rows
                    </button>
                    <button
                      className="btn"
                      disabled={(page + 1) * 20 >= s.rows.length}
                      onClick={() => setPages({ ...pages, [id]: page + 1 })}
                    >
                      Next rows
                    </button>
                  </p>
                </details>
              );
            }),
          )}
          <label className="import-confirm">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I reviewed worksheet warnings and accept cached formula values for
            this import.
          </label>
          <button className="btn primary" onClick={apply}>
            Use selected worksheets
          </button>
          <button className="btn" onClick={() => setBooks([])}>
            Cancel
          </button>
        </section>
      )}
    </>
  );
  return { upload, picker };
}
