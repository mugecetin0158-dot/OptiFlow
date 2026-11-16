"use client";
import { autoAllocationWithProfiles } from "../../lib/import/automation";
import { profileSourcesForAI } from "../../lib/import/automation";
import { useSpreadsheetUpload } from "../SpreadsheetPicker";
import { useMemo, useRef, useState } from "react";
import { Upload, ArrowRight } from "lucide-react";
import { decodeCSV, MAX_BYTES } from "../../lib/import/csv";
import {
  Draft,
  Settings,
  tables,
  columns,
  Table,
} from "../../lib/allocation/types";
import {
  AllocationSource,
  createAllocationSource,
  recognizeAllocation,
  transformAllocationSources,
  normalizeAllocationCell,
  exportCatalog,
} from "../../lib/allocation/import";
import { validateDraft } from "../../lib/allocation/validation";
import CatalogEditor, {
  AllocationIssues,
  AllocationSettings,
  titles,
  Translate,
} from "./CatalogEditor";
import { emptyDraft } from "../../lib/allocation/types";
import { downloadText } from "../smart-import/SmartImport";
import ImportProfiles from "./ImportProfiles";
import { PROFILE_KEY, AllocationProfile } from "../../lib/allocation/profiles";
export default function AllocationImport({
  initialSettings,
  onConfirm,
  t,
}: {
  initialSettings: Settings;
  onConfirm: (d: Draft) => void;
  t: Translate;
}) {
  const [step, setStep] = useState(0);
  const [aiConsent, setAiConsent] = useState(false),
    [aiBusy, setAiBusy] = useState(false),
    [aiComplete, setAiComplete] = useState(false),
    [aiDestinationNotes, setAiDestinationNotes] = useState<{ file: string; note: string }[]>([]),
    [aiProposals, setAiProposals] = useState<{file: string; column: string; original: string; proposed: string; reason: string}[]>([]),
    [aiProposalsReviewed, setAiProposalsReviewed] = useState(false);
  const aiAbort = useRef<AbortController | null>(null);
  const [sources, setSources] = useState<AllocationSource[]>([]),
    [preview, setPreview] = useState<Draft>(() => ({
      ...emptyDraft(),
      settings: { ...initialSettings },
    })),
    [stale, setStale] = useState(true),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [encoding, setEncoding] = useState("auto"),
    [delimiter, setDelimiter] = useState("auto");
  const fileInput = useRef<HTMLInputElement>(null);
  const transformed = useMemo(
    () => transformAllocationSources(sources, preview.settings),
    [sources, preview.settings],
  );
  const validation = useMemo(() => validateDraft(preview), [preview]);
  const valid =
    !stale &&
    validation.valid &&
    !transformed.issues.some((i) => i.severity === "error");
  function update(source: AllocationSource) {
    setSources((old) => old.map((s) => (s.id === source.id ? source : s)));
    setStale(true);
    setAccepted(false);
  }
  async function processWithAI(input: AllocationSource[]) {
    if (!aiConsent || aiBusy || !input.length) return;
    if (input.some((s) => s.parsed.issues.some((i) => i.severity === "error"))) {
      setError("Fix parsing errors before AI processing.");
      return;
    }
    const base = process.env.NEXT_PUBLIC_API_URL;
    if (!base) {
      setError("AI import processing needs a configured private server.");
      setStep(1);
      return;
    }
    const controller = new AbortController();
    aiAbort.current = controller;
    setAiBusy(true);
    setAiComplete(false);
    setAiDestinationNotes([]);
    setAiProposals([]);
    setAiProposalsReviewed(false);
    setStep(1);
    try {
      const response = await fetch(base + "/import/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          target: "allocation",
          locale: ["en", "tr", "fr", "es"].includes(document.documentElement.lang)
            ? document.documentElement.lang
            : "en",
          files: profileSourcesForAI(input as any),
          allowed_fields: [...new Set(tables.flatMap((kind) => columns[kind]))],
        }),
      });
      if (!response.ok) {
        let detail = "";
        try { detail = (await response.json()).detail || ""; } catch {}
        throw Error(detail || (response.status === 503 ? "AI import processing is not configured on the server." : "AI import processing failed. Retry without changing the source data."));
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.files) || payload.files.length !== input.length)
        throw Error("AI returned an invalid structured response.");
      const proposals: typeof aiProposals = [];
      const destinationNotes: typeof aiDestinationNotes = [];
      const analyzed: AllocationSource[] = input.map((source) => {
        const file = payload.files.find((f: any) => f.source_id === source.id);
        if (!file || !Array.isArray(file.datasets) || !Array.isArray(file.columns) ||
            typeof file.destination_note !== "string" || file.destination_note.length > 400)
          throw Error("AI returned an invalid source reference.");
        if (file.datasets.some((dataset: unknown) => typeof dataset !== "string" || !tables.includes(dataset as Table)))
          throw Error("AI returned a dataset type incompatible with Resource Allocation. Select the matching destination or upload a Resource Allocation spreadsheet.");
        if (file.datasets.length === 0 && !file.destination_note.trim())
          throw Error("AI could not match this file to Resource Allocation. Choose a compatible destination or upload a matching spreadsheet.");
        if (file.destination_note) destinationNotes.push({ file: source.name, note: file.destination_note });
        for (const c of Array.isArray(file.corrections) ? file.corrections : []) {
          const column = source.parsed.headers.indexOf(c.column);
          if (column < 0 || typeof c.source_value !== "string" ||
              !source.parsed.rows.some((row) => row[column] === c.source_value) ||
              typeof c.proposed_value !== "string" || typeof c.reason !== "string")
            throw Error("AI returned an invalid correction proposal.");
          proposals.push({ file: source.name, column: c.column, original: c.source_value, proposed: c.proposed_value, reason: c.reason });
        }
        const kind: AllocationSource["kind"] = file.datasets.length === 1 && tables.includes(file.datasets[0]) ? file.datasets[0] as Table : "";
        const mappings = source.parsed.headers.map((header) => {
          const match = file.columns.find((c: any) => c.column === header);
          if (!match) return "";
          if (typeof match.field !== "string" || (match.field && match.field !== "ignore" && (!kind || !columns[kind].includes(match.field))) ||
              typeof match.confidence !== "number" || match.confidence < 0 || match.confidence > 1)
            throw Error("AI returned an invalid column mapping.");
          return match.field as string;
        });
        const confirmed = Boolean(kind) && file.columns.every((c: any) => c.confidence >= .9) &&
          mappings.every(Boolean) && !file.corrections?.length;
        return { ...source, kind, mappings, confirmed };
      });
      setSources(analyzed);
      setAiDestinationNotes(destinationNotes);
      setAiProposals(proposals);
      setAiComplete(true);
      const transformed = transformAllocationSources(analyzed, preview.settings);
      if (analyzed.every((s) => s.confirmed) && !proposals.length && !transformed.issues.some((i) => i.severity === "error")) {
        setPreview(transformed.draft);
        setStale(false);
        setStep(2);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      setAiBusy(false);
      aiAbort.current = null;
    }
  }
  async function consumeFiles(files: File[]) {
    if (busy || !files.length) return false;
    setError("");
    if (files.length + sources.length > 10) {
      setError("Use at most 10 tabular sources.");
      return false;
    }
    setBusy(true);
    try {
      const next: AllocationSource[] = [];
      let cachedProfiles: AllocationProfile[] = [];
      try {
        const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || "[]");
        if (Array.isArray(raw)) cachedProfiles = raw;
      } catch {
        /* A broken saved profile never blocks a fresh import. */
      }
      for (const file of files) {
        if (file.size > MAX_BYTES) throw Error("File exceeds the 2 MB limit.");
        const decoded = decodeCSV(
          new Uint8Array(await file.arrayBuffer()),
          encoding,
        );
        next.push(
          autoAllocationWithProfiles(
            createAllocationSource(
              crypto.randomUUID(),
              file.name,
              decoded.text,
              delimiter,
            ),
            preview.settings,
            cachedProfiles,
          ),
        );
        const worksheetRows = (file as File & { worksheetRows?: number[] })
          .worksheetRows;
        const imported = next[next.length - 1];
        if (
          worksheetRows &&
          !imported.parsed.issues.length &&
          worksheetRows.length === imported.parsed.rows.length
        )
          imported.parsed.lineNumbers = worksheetRows;
      }
      if (
        [...sources, ...next].reduce((n, s) => n + s.parsed.rows.length, 0) >
        10000
      )
        throw Error("Use at most 10 tabular sources and 10,000 source rows.");
      const combined = [...sources, ...next];
      setSources(combined);
      setStale(true);
      setAiComplete(false);
      if (aiConsent) await processWithAI(combined);
      setAccepted(false);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function changePreview(d: Draft) {
    setPreview(d);
    setAccepted(false);
  }
  const { upload, picker } = useSpreadsheetUpload(consumeFiles, t);
  return (
    <div className="smart-import allocation-import">
      <ol className="import-steps">
        {[
          "Upload",
          "AI Processing",
          "Preview & save",
        ].map((label, i) => (
          <li key={label}>
            <button
              aria-current={step === i ? "step" : undefined}
              className={step === i ? "active" : ""}
              disabled={i > 0 && !aiComplete && !aiBusy}
              onClick={() => setStep(i)}
            >
              <span>{i + 1}</span>
              {t(label)}
            </button>
          </li>
        ))}
      </ol>
      {picker}
      <section className="import-intro">
        <Upload size={28} />
        <div>
          <span className="eyebrow">
            {t("RESOURCE ALLOCATION / SMART IMPORT")}
          </span>
          <h2>{t("Map real resources to a valid model.")}</h2>
          <p>
            {t(
              "Four datasets: resources, projects, demands, and compatibility links. Files stay in this browser. Unmapped columns remain available for review.",
            )}
          </p>
        </div>
      </section>
      <div className="import-rule-summary import-validation-stages">
        <span>
          {t("Parsing validation")}
          <b>
            {t(
              !sources.length
                ? "Not started"
                : sources.some((s) =>
                      s.parsed.issues.some((i) => i.severity === "error"),
                    )
                  ? "Needs attention"
                  : "Complete",
            )}
          </b>
        </span>
        <span>
          {t("Mapping validation")}
          <b>
            {t(
              !sources.length
                ? "Not started"
                : transformed.issues.some((i) => i.severity === "error")
                  ? "Needs attention"
                  : tables.some(
                        (table) => transformed.draft.tables[table].length,
                      )
                    ? "Complete"
                    : "No allocation data",
            )}
          </b>
        </span>
        <span>
          {t("Dataset validation")}
          <b>
            {t(
              stale
                ? "Not validated"
                : validation.valid
                  ? "Complete"
                  : "Needs attention",
            )}
          </b>
        </span>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {t(error)}
        </div>
      )}
      <section className="panel import-panel" hidden={step !== 0}>
        <label className="import-confirm"><input type="checkbox" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} />{t("I consent to sending minimized column metadata and redacted representative values to the configured AI provider for this import.")}</label>
        {sources.length > 0 && <button className="btn primary" disabled={!aiConsent || aiBusy} onClick={() => void processWithAI(sources)}>{t("Start AI processing")}</button>}
        <div className="allocation-toolbar">
          <label>
            {t("File encoding")}
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value)}
            >
              {[
                "auto",
                "utf-8",
                "utf-16le",
                "utf-16be",
                "windows-1252",
                "windows-1254",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Delimiter")}
            <select
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value)}
            >
              <option value="auto">{t("Detect from header")}</option>
              {[",", ";", "\t", "|"].map((v) => (
                <option value={v} key={v}>
                  {v === "\t" ? "TAB" : v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          className="import-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          <Upload />
          <h3>{t("Drop CSV or Excel files here")}</h3>
          <p>
            {t(
              "Select a dataset for each file; column names alone do not establish its meaning.",
            )}
          </p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {t(busy ? "Reading files…" : "Choose CSV or Excel files")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.tsv,text/csv"
            multiple
            hidden
            onChange={(e) => void upload(Array.from(e.target.files || []))}
          />
        </div>
      </section>
      <div hidden={step !== 1}>
        {aiBusy && <p role="status">{t("AI is analyzing the import…")} <button className="btn" onClick={() => aiAbort.current?.abort()}>{t("Cancel AI processing")}</button></p>}
        {!aiBusy && !aiComplete && sources.length > 0 && <button className="btn primary" disabled={!aiConsent} onClick={() => void processWithAI(sources)}>{t("Retry AI processing")}</button>}
        {aiComplete && aiDestinationNotes.length > 0 && <div className="notice" role="status">{aiDestinationNotes.map((item) => <p key={item.file}><strong>{item.file}</strong>: {item.note}</p>)}</div>}
        {aiComplete && aiProposals.length > 0 && <div className="panel import-panel"><h3>{t("Corrections requiring approval")}</h3><p>{t("AI proposals are never applied automatically. Correct the affected source or preview value yourself before saving.")}</p>{aiProposals.map((p, i) => <p key={i}>{p.file} · {p.column}: {p.original} → {p.proposed} · {p.reason}</p>)}<label className="import-confirm"><input type="checkbox" checked={aiProposalsReviewed} onChange={(e) => setAiProposalsReviewed(e.target.checked)} />{t("I reviewed these proposals. Keep original values unless I explicitly edit them.")}</label></div>}
        {aiComplete && <>
        {sources.map((source) => (
          <section className="panel import-panel" key={source.id}>
            <div className="section-heading">
              <div>
                <h3>{source.name}</h3>
                <small>
                  {source.parsed.rows.length} {t("records")} ·{" "}
                  {source.parsed.headers.length} {t("columns")}
                </small>
              </div>
              <button
                className="btn"
                onClick={() => {
                  setSources((old) => old.filter((s) => s.id !== source.id));
                  setStale(true);
                  setAccepted(false);
                }}
              >
                {t("Remove file")}
              </button>
            </div>
            <ImportProfiles source={source} onApply={update} />
            <div className="allocation-toolbar">
              <label>
                {t("What do these rows represent?")}
                <select
                  value={source.kind}
                  onChange={(e) => {
                    const kind = e.target.value as AllocationSource["kind"];
                    update({
                      ...source,
                      kind,
                      confirmed: false,
                      mappings:
                        kind && kind !== "ignore"
                          ? recognizeAllocation(source.parsed.headers, kind)
                          : source.parsed.headers.map(() => ""),
                    });
                  }}
                >
                  <option value="">{t("Choose explicitly")}</option>
                  {tables.map((k) => (
                    <option value={k} key={k}>
                      {t(titles[k])}
                    </option>
                  ))}
                  <option value="ignore">{t("Unrelated data")}</option>
                </select>
              </label>
              <label>
                {t("Decimal convention")}
                <select
                  value={source.decimal}
                  onChange={(e) =>
                    update({
                      ...source,
                      decimal: e.target.value as any,
                      confirmed: false,
                    })
                  }
                >
                  <option value="">{t("Require clarification")}</option>
                  <option value="dot">1234.56</option>
                  <option value="comma">1234,56</option>
                </select>
              </label>
              <label>
                {t("Delimiter")}
                <select
                  value={source.delimiter}
                  onChange={(e) =>
                    update(
                      createAllocationSource(
                        source.id,
                        source.name,
                        source.text,
                        e.target.value,
                      ),
                    )
                  }
                >
                  <option value="auto">{t("Detect from header")}</option>
                  {[",", ";", "\t", "|"].map((v) => (
                    <option key={v} value={v}>
                      {v === "\t" ? "TAB" : v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <details className="import-raw">
              <summary>{t("Original uploaded CSV")}</summary>
              <textarea
                readOnly
                aria-label={`${t("Original uploaded CSV")} ${source.name}`}
                value={source.text}
              />
            </details>
            {source.kind && source.kind !== "ignore" && (
              <div className="table-wrap">
                <table className="import-mappings">
                  <thead>
                    <tr>
                      <th>{t("Source column")}</th>
                      <th>{t("Standard field")}</th>
                      <th>{t("Transformation preview")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {source.parsed.headers.map((h, col) => (
                      <tr key={col}>
                        <td>{h}</td>
                        <td>
                          <select
                            aria-label={`${t("Map column")} ${h}`}
                            value={source.mappings[col]}
                            onChange={(e) =>
                              update({
                                ...source,
                                confirmed: false,
                                mappings: source.mappings.map((m, i) =>
                                  i === col ? e.target.value : m,
                                ),
                              })
                            }
                          >
                            <option value="">{t("Keep unmapped")}</option>
                            <option value="ignore">{t("Irrelevant")}</option>
                            {columns[source.kind as Table].map((f) => (
                              <option key={f}>{f}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {source.parsed.rows.slice(0, 3).map((row, index) => {
                            let output = "";
                            try {
                              output =
                                source.mappings[col] &&
                                source.mappings[col] !== "ignore"
                                  ? normalizeAllocationCell(
                                      source.mappings[col],
                                      row[col] || "",
                                      source.decimal,
                                    )
                                  : t("Unmapped");
                            } catch (e) {
                              output = t((e as Error).message);
                            }
                            return (
                              <small className="source-line" key={index}>
                                {source.parsed.lineNumbers[index]}:{" "}
                                {row[col] || "∅"} → {output || "∅"}
                              </small>
                            );
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <label className="import-confirm">
              <input
                type="checkbox"
                checked={source.confirmed}
                disabled={
                  !source.kind ||
                  source.parsed.issues.some((i) => i.severity === "error")
                }
                onChange={(e) =>
                  update({ ...source, confirmed: e.target.checked })
                }
              />
              {t("I confirm this dataset and its column meanings.")}
            </label>
          </section>
        ))}
        {sources.length > 0 && (
          <>
            <AllocationIssues issues={transformed.issues} t={t} />
            <button
              className="btn primary"
              disabled={aiProposals.length > 0 && !aiProposalsReviewed}
              onClick={() => {
                if (
                  !stale &&
                  !window.confirm(
                    t(
                      "Replace the current corrected preview with a new transformation?",
                    ),
                  )
                )
                  return;
                setPreview(transformed.draft);
                setStale(false);
                setStep(2);
                setAccepted(false);
              }}
            >
              {t("Transform & validate")}
              <ArrowRight size={16} />
            </button>
          </>
        )}
        </>}
      </div>
      <div hidden={step !== 2}>
        <AllocationSettings draft={preview} onChange={changePreview} t={t} />
      </div>
      {stale && (
        <p className="notice info">
          {t(
            "Upload and confirm sources, then transform before approving this import.",
          )}
        </p>
      )}
      {!stale && (
        <>
          <AllocationIssues issues={validation.issues} t={t} />
          <div hidden={step !== 2}>
            <CatalogEditor
              draft={preview}
              onChange={changePreview}
              issues={validation.issues}
              t={t}
            />
          </div>
          <div hidden={step !== 2}>
            <details className="panel import-panel">
              <summary>
                {t("Unmapped source columns")} ({transformed.unmapped.length})
              </summary>
              {transformed.unmapped.map((u, i) => (
                <p key={i}>
                  {u.file} · {u.column} · {t(u.decision)}
                </p>
              ))}
            </details>
            <div className="allocation-toolbar">
              {tables.map((table) => (
                <button
                  className="btn"
                  key={table}
                  disabled={!valid}
                  onClick={() =>
                    downloadText(`${table}.csv`, exportCatalog(preview, table))
                  }
                >
                  {table}.csv
                </button>
              ))}
            </div>
            <div className="import-save">
              <label className="import-confirm">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={!valid}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                {t(
                  "I reviewed the data and settings. Replace the resource workspace with this validated import.",
                )}
              </label>
              <button
                className="btn primary"
                disabled={!valid || !accepted}
                onClick={() => {
                  try {
                    onConfirm(preview);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {t("Save & use resource data")}
              </button>
            </div>
          </div>
        </>
      )}
      <div className="allocation-toolbar">
        <button
          className="btn"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          {t("Previous")}
        </button>
        <button
          className="btn"
          disabled={step === 2 || (step === 0 && !aiComplete) || (step === 1 && !aiComplete)}
          onClick={() => setStep(step + 1)}
        >
          {t("Next")}
        </button>
      </div>
    </div>
  );
}
