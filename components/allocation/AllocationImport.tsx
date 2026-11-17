"use client";
import { autoAllocationWithProfiles } from "../../lib/import/automation";
import { profileSourcesForAI } from "../../lib/import/automation";
import { useCSVUpload } from "../CsvPicker";
import { useEffect, useMemo, useRef, useState } from "react";
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
  fieldLabels,
  Translate,
} from "./CatalogEditor";
import { emptyDraft } from "../../lib/allocation/types";
import { requiredColumns } from "../../lib/allocation/import";
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
  const unresolvedIssues = [
    ...transformed.issues,
    ...validation.issues,
  ].filter((issue) => issue.severity === "error");
  const unresolvedCount = new Set(
    unresolvedIssues.map((issue) =>
      issue.field
        ? `${issue.table || ""}:${issue.record ?? ""}:${issue.field}:${issue.source?.fileId || ""}`
        : `${issue.message}:${issue.source?.fileId || ""}`,
    ),
  ).size;
  const hasMissingInformation = unresolvedCount > 0;
  useEffect(() => {
    if (step === 2 && !stale && !hasMissingInformation) setStep(3);
  }, [step, stale, hasMissingInformation]);
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
          throw Error("AI returned a dataset type incompatible with Resource Allocation. Select the matching destination or upload a Resource Allocation CSV file.");
        if (file.datasets.length === 0 && !file.destination_note.trim())
          throw Error("AI could not match this file to Resource Allocation. Choose a compatible destination or upload a matching CSV file.");
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
        setStep(validateDraft(transformed.draft).valid ? 3 : 2);
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
  const { upload, picker } = useCSVUpload(consumeFiles, t);
  return (
    <div className="smart-import allocation-import">
      <ol className="import-steps">
        {[
          "Upload",
          "AI Interpretation",
          "Missing Information",
          "Preview",
          "Save",
        ].map((label, i) => (
          <li key={label}>
            <button
              aria-current={step === i ? "step" : undefined}
              className={step === i ? "active" : ""}
              disabled={
                (i > 0 && !aiComplete && !aiBusy) ||
                (i === 2 && !hasMissingInformation) ||
                (i >= 3 && hasMissingInformation)
              }
              onClick={() => setStep(i)}
            >
              <span>{i + 1}</span>
              {t(label)}
            </button>
          </li>
        ))}
      </ol>
      {aiComplete && unresolvedCount > 0 && (
        <div className="notice missing-warning" role="alert">
          <strong>
            {t("Required information is missing")}: {unresolvedCount}{" "}
            {t(unresolvedCount === 1 ? "unresolved field" : "unresolved fields")}
          </strong>
          <button
            className="btn"
            onClick={() => setStep(2)}
            aria-label={t("Go to missing-information questions")}
          >
            {t("Answer missing questions")}
          </button>
        </div>
      )}
      {step === 0 && (
        <section className="panel allocation-requirements">
          <h3>{t("What Resource Allocation needs")}</h3>
          <p>{t("Required information comes from the allocation model and its validation rules.")}</p>
          <div className="allocation-requirement-grid">
            {tables.map((table) => {
              const required = requiredColumns(table, preview.settings.mode);
              const optional = columns[table].filter((field) => !required.includes(field));
              return (
                <article key={table}>
                  <h4>{t(titles[table])}</h4>
                  {table === "links" && <p>{t("This dataset is optional. When supplied, its required fields apply to each compatibility link.")}</p>}
                  <strong>{t("Required fields")}</strong>
                  <p>{required.map((field) => t(fieldLabels[field])).join(", ")}</p>
                  <strong>{t("Optional fields")}</strong>
                  <p>{optional.length ? optional.map((field) => t(fieldLabels[field])).join(", ") : t("None")}</p>
                </article>
              );
            })}
            <article>
              <h4>{t("Model settings")}</h4>
              <strong>{t("Required fields")}</strong>
              <p>{t("Objective")}, {t("Planning period")}, {t("Business currency")}</p>
              <strong>{t("Optional fields")}</strong>
              <p>{t("Budget (blank = no budget limit)")}</p>
            </article>
          </div>
          <p className="footnote">{t("Capacity, maximum output, maximum allocation, and project priority may be unlimited or use their documented defaults. Value per output is required only for value maximization.")}</p>
        </section>
      )}
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
              {[",", ";"].map((v) => (
                <option value={v} key={v}>
                  {v}
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
          <h3>{t("Drop CSV files here")}</h3>
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
            {t(busy ? "Reading files…" : "Choose CSV files")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            onChange={(e) => void upload(Array.from(e.target.files || []))}
          />
        </div>
      </section>
      <div hidden={step !== 1}>
        {aiBusy && <p role="status">{t("AI is analyzing the import…")} <button className="btn" onClick={() => aiAbort.current?.abort()}>{t("Cancel AI processing")}</button></p>}
        {!aiBusy && !aiComplete && sources.length > 0 && <button className="btn primary" disabled={!aiConsent} onClick={() => void processWithAI(sources)}>{t("Retry AI processing")}</button>}
        {aiComplete && aiDestinationNotes.length > 0 && <div className="notice" role="status">{aiDestinationNotes.map((item) => <p key={item.file}><strong>{item.file}</strong>: {t(item.note)}</p>)}</div>}
        {aiComplete && aiProposals.length > 0 && <div className="panel import-panel"><h3>{t("Corrections requiring approval")}</h3><p>{t("AI proposals are never applied automatically. Correct the affected source or preview value yourself before saving.")}</p>{aiProposals.map((p, i) => <p key={i}>{p.file} · {p.column}: {p.original} → {p.proposed} · {t(p.reason)}</p>)}<label className="import-confirm"><input type="checkbox" checked={aiProposalsReviewed} onChange={(e) => setAiProposalsReviewed(e.target.checked)} />{t("I reviewed these proposals. Keep original values unless I explicitly edit them.")}</label></div>}
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
            <ImportProfiles source={source} onApply={update} t={t} />
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
                  {[",", ";"].map((v) => (
                    <option key={v} value={v}>
                      {v}
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
                              <option key={f} value={f}>{t(fieldLabels[f] || f)}</option>
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
                const nextDraft = transformed.draft;
                setPreview(nextDraft);
                setStale(false);
                setStep(
                  transformed.issues.some((issue) => issue.severity === "error") ||
                    !validateDraft(nextDraft).valid
                    ? 2
                    : 3,
                );
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
      {step === 2 && (
        <section className="panel import-panel missing-information-panel">
          <h3>{t("Missing Information")}</h3>
          <p>{t("Complete only the required fields identified by model validation. Optional fields may remain blank.")}</p>
          {unresolvedIssues.map((issue, index) => {
            const key = `${issue.table || ""}:${issue.record ?? ""}:${issue.field || issue.message}:${issue.source?.fileId || ""}`;
            if (unresolvedIssues.some((other, otherIndex) =>
              otherIndex < index &&
              other.table === issue.table &&
              other.record === issue.record &&
              other.field === issue.field &&
              other.source?.fileId === issue.source?.fileId &&
              other.message === issue.message,
            )) return null;
            const source = issue.source && sources.find((item) => item.id === issue.source?.fileId);
            return (
              <article className="missing-question-card unresolved" key={key}>
                <h4>{issue.table ? t(titles[issue.table]) : t("Model settings")}</h4>
                <p>{t(issue.message)}</p>
                <dl>
                  <div><dt>{t("Target field")}</dt><dd>{issue.field ? t(fieldLabels[issue.field] || issue.field) : t("Model settings")}</dd></div>
                  <div><dt>{t("Source dataset")}</dt><dd>{source?.name || (issue.table ? t(titles[issue.table]) : t("Model settings"))}</dd></div>
                  <div><dt>{t("Suggested mapping")}</dt><dd>{issue.detail ? t("Map or enter the value for this required field.") : t("Enter a value that satisfies this field.")}</dd></div>
                </dl>
                {issue.detail && (
                  <button className="btn" onClick={() => setStep(1)}>
                    {t("Review source mappings")}
                  </button>
                )}
              </article>
            );
          })}
          <p className="field-error-text" role="status">
            {t("Unresolved fields")}: {unresolvedCount}
          </p>
        </section>
      )}
      <div hidden={step !== 2 && step !== 3}>
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
          {(step === 2 || step === 3) && <AllocationIssues issues={validation.issues} t={t} />}
          <div hidden={step !== 2 && step !== 3}>
            <CatalogEditor
              draft={preview}
              onChange={changePreview}
              issues={validation.issues}
              t={t}
            />
          </div>
          <div hidden={step !== 3}>
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
                  disabled={!valid || hasMissingInformation}
                  onClick={() =>
                    downloadText(`${table}.csv`, exportCatalog(preview, table))
                  }
                >
                  {table}.csv
                </button>
              ))}
            </div>
            {step === 3 && (
              <button
                className="btn primary"
                disabled={!valid}
                onClick={() => setStep(4)}
              >
                {t("Continue to save")} <ArrowRight size={16} />
              </button>
            )}
          </div>
        </>
      )}
      {step === 4 && !stale && (
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
                disabled={!valid || hasMissingInformation || !accepted}
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
      )}
      <div className="allocation-toolbar">
        <button
          className="btn"
          disabled={step === 0}
          onClick={() =>
            setStep(step === 3 && !hasMissingInformation ? 1 : step - 1)
          }
        >
          {t("Previous")}
        </button>
        <button
          className="btn"
          disabled={
            step === 4 ||
            (step === 0 && !aiComplete) ||
            step === 1 ||
            (step === 2 && (!valid || stale)) ||
            (step === 3 && !valid)
          }
          onClick={() => setStep(step === 0 ? 1 : step + 1)}
        >
          {t("Next")}
        </button>
      </div>
    </div>
  );
}
