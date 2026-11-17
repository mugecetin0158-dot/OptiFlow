"use client";
import {
  AIImportCorrection,
  AIImportResult,
  correctionJournal,
  applyGroupedIssueAnswer,
  canonicalQuestionKey,
  datasetReadiness,
  groupImportIssues,
  isValidQuestionAnswer,
  prepareAIImport,
  requestAIImportAnalysis,
  requestModelPreview,
  saveAIImportModel,
  submitMissingAnswers,
  uniqueMissingQuestions,
} from "../../lib/import/automation";
import { useCSVUpload } from "../CsvPicker";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Trash2,
  Loader2,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { Language, translate } from "../../lib/i18n";
import {
  ImportSource,
  ImportDraft,
  Issue,
  Rules,
  SavedImport,
  ImportProfile,
  Mapping,
  Dataset,
  datasets,
  fields as importFields,
  emptyDraft,
  emptyRules,
} from "../../lib/import/types";
import { decodeCSV, MAX_FILES, MAX_BYTES } from "../../lib/import/csv";
import { createSource } from "../../lib/import/recognition";
import { transformSources } from "../../lib/import/pipeline";
import { preserveManualDraftEdits } from "../../lib/import/refresh";
import { importStages } from "../../lib/import/stages";
import {
  mappingOutputs,
  transformation,
} from "../../lib/import/transformations";
import { validateDraft } from "../../lib/import/validation";
import { applyProfile, makeProfile } from "../../lib/import/profiles";
import {
  saveValidated,
  exportStandard,
  loadProfiles,
  saveProfiles,
} from "../../lib/import/storage";
import RulesWizard from "./RulesWizard";
import DataPreview, { IssueList, RuleSummary } from "./DataPreview";
import SourceMapping from "./SourceMapping";
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function SmartImport({
  language,
  saved,
  savedRules,
  onSaved,
}: {
  language: Language;
  saved: SavedImport | null;
  savedRules: Rules | null;
  onSaved: (s: SavedImport, r: Rules) => void;
}) {
  const t = (s: string) => translate(language, s);
  const [step, setStep] = useState(0),
    [sources, setSources] = useState<ImportSource[]>([]),
    [draft, setDraft] = useState<ImportDraft>(saved?.draft || emptyDraft()),
    [rules, setRules] = useState<Rules>(savedRules || { ...emptyRules }),
    [pipelineIssues, setPipelineIssues] = useState<Issue[]>([]),
    [unmapped, setUnmapped] = useState<SavedImport["unmapped"]>(
      saved?.unmapped || [],
    ),
    [profiles, setProfiles] = useState<ImportProfile[]>([]),
    [error, setError] = useState(""),
    [errorFile, setErrorFile] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshBusy, setRefreshBusy] = useState(false),
    [dragging, setDragging] = useState(false),
    [encoding, setEncoding] = useState("auto"),
    [delimiter, setDelimiter] = useState("auto"),
    [replaceId, setReplaceId] = useState(""),
    [stale, setStale] = useState(false),
    [accepted, setAccepted] = useState(false);
  const [consent, setConsent] = useState(false),
    [aiBusy, setAiBusy] = useState(false),
    [aiComplete, setAiComplete] = useState(false),
    [aiCorrections, setAiCorrections] = useState<AIImportCorrection[]>([]),
    [correctionsReviewed, setCorrectionsReviewed] = useState(false);
  const [aiResult, setAiResult] = useState<AIImportResult | null>(null),
    [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({}),
    [unresolvedAnswers, setUnresolvedAnswers] = useState<Record<string, string>>({}),
    [savedModelId, setSavedModelId] = useState("");
  const requiredQuestions = uniqueMissingQuestions(
    aiResult?.questions || [],
  ).filter((question) => question.required);
  const questionGroups = requiredQuestions.reduce<
    [string, typeof requiredQuestions][]
  >((groups, question) => {
    const dataset = question.target.split(".")[0] || "model";
    const group = groups.find(([name]) => name === dataset);
    if (group) group[1].push(question);
    else groups.push([dataset, [question]]);
    return groups;
  }, []);
  const aiAbort = useRef<AbortController | null>(null);
  const [validationRevision, setValidationRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      setProfiles(loadProfiles(localStorage));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => () => aiAbort.current?.abort(), []);
  const validation = useMemo(
    () => validateDraft(draft, rules),
    [draft, rules, validationRevision],
  );
  const issues = [...pipelineIssues, ...validation.issues];
  const errors = issues.filter((i) => i.severity === "error"),
    warnings = issues.filter((i) => i.severity === "warning");
  const groupedErrors = groupImportIssues(errors, draft);
  const unresolvedKeys = new Set(groupedErrors.map((group) => group.key));
  for (const question of uniqueMissingQuestions(aiResult?.questions || [])) {
    if (!question.required) continue;
    unresolvedKeys.add(canonicalQuestionKey(question));
  }
  const unresolvedCount = unresolvedKeys.size;
  const hasMissingInformation = unresolvedCount > 0;
  const valid =
    validation.valid &&
    !pipelineIssues.some((i) => i.severity === "error") &&
    !stale;
  const exportChecks = useMemo(
    () =>
      Object.fromEntries(
        datasets.map((kind) => [kind, validateDraft(draft, rules, kind)]),
      ) as Record<Dataset, ReturnType<typeof validateDraft>>,
    [draft, rules],
  );
  const canExport = (kind: Dataset) =>
    !stale &&
    exportChecks[kind].valid &&
    !pipelineIssues.some(
      (i) => i.severity === "error" && (!i.dataset || i.dataset === kind),
    );
  function exportDataset(kind: Dataset) {
    if (!canExport(kind)) return;
    downloadText(`${kind}.csv`, exportStandard(exportChecks[kind].data, kind));
  }
  const corrections = useMemo(
    () => correctionJournal(sources.filter((s) => s.confirmed)),
    [sources],
  );
  const stages = importStages(
    sources,
    issues,
    stale,
    datasets.some((k) => draft[k].length > 0),
  );
  const readiness = datasetReadiness(
    sources,
    draft,
    pipelineIssues,
    rules,
    aiComplete,
    stale,
  );
  function changeSource(next: ImportSource) {
    setSources((old) => old.map((s) => (s.id === next.id ? next : s)));
    setStale(true);
    setAccepted(false);
  }
  function changeQuestionAnswer(key: string, value: string) {
    setQuestionAnswers((old) => ({ ...old, [key]: value }));
    setUnresolvedAnswers((old) => {
      if (old[key] === undefined || old[key] === value) return old;
      const next = { ...old };
      delete next[key];
      return next;
    });
  }
  function changeDraft(next: ImportDraft) {
    setDraft(next);
    setAccepted(false);
    setNotice("");
  }
  async function processWithAI(next = sources) {
    if (!consent || !next.length || aiBusy) return;
    if (
      draft.employees.length + draft.availability.length + draft.shifts.length >
        0 &&
      !window.confirm(
        t("Rebuild from source files? This replaces current preview edits."),
      )
    )
      return;
    if (next.some((s) => s.parsed.issues.some((i) => i.severity === "error"))) {
      setError("Fix parsing errors before AI processing.");
      return;
    }
    const controller = new AbortController();
    aiAbort.current = controller;
    setAiBusy(true);
    setAiComplete(false);
    setAiCorrections([]);
    setCorrectionsReviewed(false);
    setQuestionAnswers({});
    setError("");
    setNotice("");
    setStep(1);
    try {
      const analysis = await requestAIImportAnalysis(next, language, controller.signal);
      setAiResult(analysis);
      const correctionProposals = analysis.files.flatMap((f) => f.corrections);
      const prepared = prepareAIImport(next, analysis);
      setSources(prepared.sources);
      setAiCorrections(correctionProposals);
      setAiComplete(true);
      setDraft(prepared.draft);
      setPipelineIssues(prepared.issues);
      setUnmapped(prepared.unmapped);
      setStale(false);
      setAccepted(false);
      const hasRequiredQuestions = analysis.questions.some(
        (question) => question.required,
      );
      const validated = validateDraft(prepared.draft, rules);
      const previewHasErrors =
        prepared.issues.some((issue) => issue.severity === "error") ||
        !validated.valid;
      if (hasRequiredQuestions || previewHasErrors) setStep(2);
      else if (
        analysis.requires_verification ||
        prepared.requiresMappingReview ||
        correctionProposals.length
      ) setStep(1);
      else setStep(3);
      setNotice(
        previewHasErrors || hasRequiredQuestions
          ? "AI processing completed. Complete the highlighted information."
          : analysis.requires_verification ||
                prepared.requiresMappingReview ||
                correctionProposals.length
              ? "AI processing completed. Review only the unresolved items."
              : "AI processing completed. The validated preview is ready.",
      );
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      setAiBusy(false);
      aiAbort.current = null;
    }
  }
  async function consumeFiles(files: File[]) {
    if (busy || !files.length) return false;
    let activeFile = "";
    setErrorFile("");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (replaceId && files.length !== 1)
        throw Error("Select exactly one file when replacing a source.");
      if (sources.length + (replaceId ? 0 : files.length) > MAX_FILES)
        throw Error("Import at most 10 tabular sources per import.");
      const added: ImportSource[] = [];
      for (const file of files) {
        activeFile = file.name;
        if (file.size > MAX_BYTES) throw Error("File exceeds the 2 MB limit.");
        const decoded = decodeCSV(
          new Uint8Array(await file.arrayBuffer()),
          encoding,
        );
        added.push(
          createSource(
            crypto.randomUUID(),
            file.name,
            decoded.text,
            decoded.encoding,
            delimiter,
          ),
        );
      }
      const next = replaceId
        ? sources.map((s) => (s.id === replaceId ? added[0] : s))
        : [...sources, ...added];
      if (next.reduce((n, s) => n + s.parsed.rows.length, 0) > 10000)
        throw Error("An import may contain at most 10,000 source records.");
      setSources(next);
      setAiComplete(false);
      setAiCorrections([]);
      setStale(true);
      if (consent) await processWithAI(next);
      setReplaceId("");
      setAccepted(false);
      return true;
    } catch (e) {
      setError((e as Error).message);
      setErrorFile(activeFile);
      return false;
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  function transform() {
    setErrorFile("");
    setError("");
    if (!sources.length) {
      setError("Upload at least one CSV file.");
      return;
    }
    if (
      draft.employees.length + draft.availability.length + draft.shifts.length >
        0 &&
      !window.confirm(
        t("Rebuild from source files? This replaces current preview edits."),
      )
    )
      return;
    const result = transformSources(sources);
    setDraft(
      stale
        ? result.draft
        : preserveManualDraftEdits(draft, result.draft, result.draft),
    );
    setPipelineIssues(result.issues);
    setUnmapped(result.unmapped);
    setStale(false);
    setAccepted(false);
    const needsMissingInformation =
      result.issues.some((issue) => issue.severity === "error") ||
      validateDraft(result.draft, rules).issues.some(
        (issue) => issue.severity === "error",
      );
    setStep(needsMissingInformation ? 2 : 3);
    setNotice(
      "Transformation complete. Review missing information and validation errors.",
    );
  }
  async function refreshAndRevalidate() {
    if (!aiResult || refreshBusy) return;
    setRefreshBusy(true);
    setError("");
    try {
      const answers = Object.fromEntries(
        aiResult.questions
          .filter((question) => question.required)
          .map((question) => [
            question.id,
            questionAnswers[canonicalQuestionKey(question)] || "",
          ]),
      );
      const submittedAnswers = Object.fromEntries(
        aiResult.questions
          .filter((question) => {
            const key = canonicalQuestionKey(question);
            const answer = questionAnswers[key];
            return (
              question.required &&
              isValidQuestionAnswer(question, answer) &&
              unresolvedAnswers[key] !== answer
            );
          })
          .map((question) => [
            question.id,
            questionAnswers[canonicalQuestionKey(question)],
          ]),
      );
      const answerResult =
        aiResult.session_id && Object.keys(submittedAnswers).length
          ? await submitMissingAnswers(aiResult.session_id, submittedAnswers)
        : { remaining_questions: aiResult.questions };
      const remainingQuestions = uniqueMissingQuestions(
        answerResult.remaining_questions,
      );
      const objectiveAnswer = aiResult.questions.find(
        (question) =>
          canonicalQuestionKey(question) ===
          "model.objective:optimization-objective",
      );
      const objectiveValue = objectiveAnswer
        ? answers[objectiveAnswer.id]
        : "";
      const objectiveKind = (
        ["minimize_cost", "maximize_output", "maximize_net_value"] as const
      ).find((kind) => kind === objectiveValue);
      const model =
        aiResult.model && objectiveKind
          ? {
              ...aiResult.model,
              objective: {
                ...aiResult.model.objective,
                kind: objectiveKind,
                description: objectiveKind,
                confidence: 1,
              },
            }
          : aiResult.model;
      const transformed = transformSources(sources);
      const nextDraft = preserveManualDraftEdits(
        draft,
        transformed.draft,
        transformed.draft,
      );
      const nextValidation = validateDraft(nextDraft, rules);
      const mappingReview = sources.some(
        (source) =>
          source.kinds.length > 0 &&
          (!source.confirmed ||
            source.mappings.some(
              (mapping) =>
                mapping.state === "suggested" || mapping.state === "unmapped",
            )),
      );
      const hasErrors =
        transformed.issues.some((issue) => issue.severity === "error") ||
        !nextValidation.valid;
      const nextUnresolvedAnswers: Record<string, string> = {};
      for (const question of remainingQuestions) {
        const key = canonicalQuestionKey(question);
        const answer = questionAnswers[key];
        if (answer) nextUnresolvedAnswers[key] = answer;
      }
      setAiResult({ ...aiResult, model, questions: remainingQuestions });
      setUnresolvedAnswers(nextUnresolvedAnswers);
      setDraft(nextDraft);
      setPipelineIssues(transformed.issues);
      setUnmapped(transformed.unmapped);
      setStale(false);
      setAccepted(false);
      setStep(
        mappingReview
          ? 1
          : remainingQuestions.some((question) => question.required) || hasErrors
            ? 2
            : 3,
      );
      setNotice("Refresh and revalidation completed. Review any remaining questions or errors.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setRefreshBusy(false);
    }
  }
  function persistProfiles(next: ImportProfile[]) {
    try {
      saveProfiles(localStorage, next);
      setProfiles(next);
      setNotice("Import profiles saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function saveProfile(source: ImportSource, name: string) {
    try {
      const existing = profiles.find((p) => p.name === name.trim());
      if (
        existing &&
        !window.confirm(
          t("Replace this saved profile with the confirmed mappings?"),
        )
      )
        return;
      const profile = makeProfile(
        source,
        name,
        existing?.id || crypto.randomUUID(),
      );
      persistProfiles(
        existing
          ? profiles.map((p) => (p.id === existing.id ? profile : p))
          : [...profiles, profile],
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    setErrorFile("");
    setError("");
    if (!valid || !accepted) {
      setError(
        "Resolve all blocking errors and confirm the preview before saving.",
      );
      return;
    }
    try {
      if (aiResult?.session_id) {
        const preview = await requestModelPreview(aiResult.session_id, {
          ...validation.data,
          rules,
          objective: aiResult.model?.objective,
        });
        if (!preview.ready) throw Error(preview.issues.map((issue) => issue.message).join(" "));
        const savedAI = await saveAIImportModel(aiResult.session_id);
        setSavedModelId(savedAI.model_id);
      }
      const result = saveValidated(
        localStorage,
        draft,
        rules,
        unmapped,
        pipelineIssues,
        corrections,
      );
      onSaved(result, rules);
      setNotice("Validated data saved locally. No optimization has been run.");
      setAccepted(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const steps = ["Upload", "AI Interpretation", "Missing Information", "Preview", "Save"];
  const { upload, picker } = useCSVUpload(consumeFiles, t);
  return (
    <div className="smart-import">
      {picker}
      <div className="import-intro">
        <div className="import-intro-icon">
          <FileSpreadsheet size={27} />
        </div>
        <div>
          <span className="eyebrow">{t("STOP OPTIMIZING AIR")}</span>
          <h2>{t("Start with validated data.")}</h2>
          <p>
            {t(
              "Upload locally, let AI propose the model, then verify only what needs attention. No invented values or constraints.",
            )}
          </p>
        </div>
        <span className="badge teal">
          <ShieldCheck size={14} />
          {t("Processed in this browser")}
        </span>
      </div>
      <ol className="import-steps">
        {steps.map((name, i) => (
          <li key={name}>
            <button
              aria-current={step === i ? "step" : undefined}
              className={step === i ? "active" : ""}
              disabled={
                (i > 0 && !aiComplete && !aiBusy) ||
                (i === 2 && !aiComplete) ||
                (i >= 3 && hasMissingInformation)
              }
              onClick={() => setStep(i)}
            >
              <span>{i + 1}</span>
              {t(name)}
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
      <div
        className="import-rule-summary import-validation-stages"
        role="status"
      >
        {(
          [
            ["Parsing validation", stages.parsing],
            ["Mapping validation", stages.mapping],
            ["Dataset validation", stages.dataset],
          ] as const
        ).map(([label, state]) => (
          <span key={label}>
            {t(label)}: <b>{t(state)}</b>
          </span>
        ))}
      </div>
      {error && (
        <div className="notice error" role="alert">
          <span>
            {errorFile && <strong>{errorFile}: </strong>}
            {t(error)}
          </span>
          <button
            onClick={() => {
              setError("");
              setErrorFile("");
            }}
          >
            {t("Dismiss")}
          </button>
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {t(notice)}
        </div>
      )}
      {stale && step >= 3 && (
        <div className="notice error">
          {t(
            "Source mappings changed. Rebuild the preview before saving or exporting.",
          )}
          <button className="btn" onClick={transform}>
            {t("Rebuild preview")}
          </button>
        </div>
      )}
      {step === 0 && (
        <>
          <section className="panel import-panel scheduling-requirements">
            <header>
              <span className="eyebrow">{t("Scheduling data")}</span>
              <h2>{t("What you'll need")}</h2>
              <p>
                {t(
                  "To create a complete scheduling model, OptiFlow needs three types of data:",
                )}
              </p>
            </header>
            <div className="scheduling-requirements-grid">
              {(
                [
                  [
                    "employees",
                    "Employee data",
                    "Employee IDs, names, hourly rates, maximum weekly hours, and roles.",
                  ],
                  [
                    "availability",
                    "Availability data",
                    "Which employees are available, on which dates, and during which hours.",
                  ],
                  [
                    "shifts",
                    "Shift data",
                    "The shifts that need coverage, including dates, start/end times, required staffing counts, and roles.",
                  ],
                ] as const
              ).map(([kind, heading, description], index) => (
                <article key={kind}>
                  <span className="requirement-number">{index + 1}</span>
                  <div>
                    <h3>{t(heading)}</h3>
                    <p>{t(description)}</p>
                  </div>
                </article>
              ))}
            </div>
            <p className="scheduling-requirements-note">
              {t(
                "Upload these datasets together or separately. OptiFlow will automatically identify and organize the information using AI. If anything is missing or unclear, we'll ask you to provide it.",
              )}
            </p>
            <div className="dataset-readiness" aria-label={t("Dataset readiness")}>
              {(
                [
                  ["employees", "Employees"],
                  ["availability", "Availability"],
                  ["shifts", "Shifts"],
                ] as const
              ).map(([kind, label]) => (
                <div
                  className={`dataset-readiness-item readiness-${readiness[kind].toLowerCase()}`}
                  key={kind}
                  aria-label={`${t(label)}: ${t(readiness[kind])}`}
                >
                  <span>{t(label)}</span>
                  <strong>{t(readiness[kind])}</strong>
                </div>
              ))}
            </div>
            <small className="dataset-readiness-help">
              {t(
                "Uploaded means a file was received; AI has not identified its datasets yet.",
              )}
            </small>
          </section>
          <div className="panel import-panel">
            <label className="import-confirm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {t(
                "I consent to sending minimized column metadata and redacted representative values to the configured AI provider for this import.",
              )}
            </label>
            <p className="footnote">
              {t(
                "Files are parsed locally. Full rows are not sent; likely personal, payroll, and identifier values are redacted before the request.",
              )}
            </p>
            <div className="import-upload-settings">
              <label>
                {t("File encoding")}
                <select
                  value={encoding}
                  onChange={(e) => setEncoding(e.target.value)}
                >
                  <option value="auto">
                    {t("UTF-8 or Unicode BOM detection")}
                  </option>
                  {[
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
                  <option value=",">{t("Comma")}</option>
                  <option value=";">{t("Semicolon")}</option>
                </select>
              </label>
              <label>
                {t("Upload action")}
                <select
                  value={replaceId}
                  onChange={(e) => setReplaceId(e.target.value)}
                >
                  <option value="">{t("Add new files")}</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {t("Replace")}: {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className={`import-dropzone ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void upload(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={32} />
              <h3>{t("Drop CSV files here")}</h3>
              <p>{t("Up to 10 files · 2 MB per file · 5,000 rows per file")}</p>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {busy ? <Loader2 className="spin" size={16} /> : <PlusIcon />}
                {t(busy ? "Reading files…" : "Choose CSV files")}
              </button>
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                multiple={!replaceId}
                hidden
                onChange={(e) => void upload(Array.from(e.target.files || []))}
              />
            </div>
            <p className="footnote">
              {t(
                "Legacy encodings require an explicit choice. Unknown columns and unrelated files can remain unmapped.",
              )}
            </p>
          </div>
          {sources.length > 0 && (
            <div className="import-uploaded">
              {sources.map((s) => (
                <div className="panel" key={s.id}>
                  <FileSpreadsheet size={20} />
                  <div>
                    <strong>{s.name}</strong>
                    <small>
                      {s.parsed.rows.length} {t("records")} ·{" "}
                      {s.parsed.headers.join(", ")}
                    </small>
                  </div>
                  <button className="btn" disabled={!aiComplete && !aiBusy} onClick={() => setStep(1)}>
                    {t(aiComplete ? "Verify AI results" : "AI Processing")}
                  </button>
                  <button
                    className="icon-btn danger"
                    aria-label={`${t("Remove file")} ${s.name}`}
                    onClick={() => {
                      setSources(sources.filter((x) => x.id !== s.id));
                      setStale(true);
                      setAccepted(false);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {sources.length > 0 && !aiComplete && (
            <button
              className="btn primary"
              disabled={!consent || aiBusy}
              onClick={() => void processWithAI()}
            >
              {aiBusy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              {t(aiBusy ? "AI is analyzing the import…" : "Start AI processing")}
            </button>
          )}
          <div className="notice info">
            <div>
              <strong>
                {t(
                  "Any CSV can be inspected. Not every CSV contains scheduling data.",
                )}
              </strong>
              <p>
                {t(
                  "Wide weekly grids, assignments, sales, and payroll totals are not silently converted into availability or demand.",
                )}
              </p>
            </div>
          </div>
        </>
      )}
      {step >= 1 && corrections.length > 0 && (
        <details className="panel import-panel">
          <summary>{t("Automatic corrections")} ({corrections.length})</summary>
          <p>
            {t("Every change retains the original cell, row, result and rule. Uncertain values remain errors until you correct them.")}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Source row")}</th>
                  <th>{t("Original")}</th>
                  <th>{t("Normalized")}</th>
                  <th>{t("Reason")}</th>
                </tr>
              </thead>
              <tbody>
                {corrections.slice(0, 100).map((c, i) => (
                  <tr key={i}>
                    <td>
                      {c.file}:{c.row} · {c.column}
                    </td>
                    <td>{c.original}</td>
                    <td>{c.result}</td>
                    <td>{t(c.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {corrections.length > 100 && (
            <p>
              {t(`Showing 100 changes; all ${corrections.length} are saved with the validated dataset.`)}
            </p>
          )}
        </details>
      )}
      {step === 1 && (
        <>
          {!sources.length ? (
            <div className="empty-state">
              <FileSpreadsheet size={36} />
              <h3>{t("Upload files to review their columns.")}</h3>
              <button className="btn primary" onClick={() => setStep(0)}>
                {t("Upload CSV files")}
              </button>
            </div>
          ) : aiBusy ? (
            <div className="panel import-panel import-ai-processing" role="status">
              <Loader2 className="spin" size={28} />
              <h3>{t("AI is analyzing the import…")}</h3>
              <p>{t("Identifying datasets, column meanings, transformations, and unresolved information.")}</p>
              <button className="btn" onClick={() => aiAbort.current?.abort()}>
                {t("Cancel AI processing")}
              </button>
            </div>
          ) : !aiComplete ? (
            <div className="panel import-panel">
              <h3>{t("AI processing is required")}</h3>
              <p>{t("Retry AI processing to continue. OptiFlow will not silently substitute rule-based mapping.")}</p>
              <button className="btn primary" disabled={!consent} onClick={() => void processWithAI()}>
                <Sparkles size={16} /> {t("Retry AI processing")}
              </button>
            </div>
          ) : (
            sources.map((source) => (
              <div key={source.id}>
                <details className="panel import-panel" open={source.mappings.some((m) => m.state === "suggested" || m.state === "unmapped") || !source.kinds.length}>
                  <summary>{t("Verify or edit source mappings")}: {source.name}</summary>
                  <SourceMapping
                  source={source}
                  onChange={changeSource}
                  onRemove={() => {
                    setSources(sources.filter((s) => s.id !== source.id));
                    setStale(true);
                    setAccepted(false);
                  }}
                  onProfile={(name) => saveProfile(source, name)}
                  onApply={(id) => {
                    try {
                      changeSource(
                        applyProfile(
                          source,
                          profiles.find((p) => p.id === id)!,
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                  profiles={profiles}
                  t={t}
                />
                </details>
              </div>
            ))
          )}
          {aiComplete && aiCorrections.length > 0 && (
            <div className="panel import-panel">
              <h3>{t("Corrections requiring approval")}</h3>
              <p>{t("AI proposals are never applied automatically. Correct the affected source or preview value yourself before saving.")}</p>
              {aiCorrections.map((c, i) => (
                <p key={i}><strong>{c.column}</strong>: {c.source_value} → {c.proposed_value} · {t(c.reason)}</p>
              ))}
              <label className="import-confirm">
                <input type="checkbox" checked={correctionsReviewed} onChange={(e) => setCorrectionsReviewed(e.target.checked)} />
                {t("I reviewed these proposals. Keep original values unless I explicitly edit them.")}
              </label>
            </div>
          )}
          {aiComplete && aiResult?.files.some((file) => file.destination_note) && (
            <div className="notice" role="status">
              {aiResult.files.filter((file) => file.destination_note).map((file) => (
                <p key={file.source_id}>
                  <strong>{sources.find((source) => source.id === file.source_id)?.name}</strong>:{" "}
                  {t(file.destination_note)}
                </p>
              ))}
            </div>
          )}
          {sources.length > 0 && aiComplete && (
            <button
              className="btn primary"
              disabled={aiCorrections.length > 0 && !correctionsReviewed}
              onClick={transform}
            >
              {t("Complete verification & build preview")}
              <ArrowRight size={16} />
            </button>
          )}
          {aiComplete && <details className="panel import-panel">
            <summary>
              {t("Reusable import profiles")} ({profiles.length})
            </summary>
            <p>
              {t(
                "Matching uses normalized headers, even when columns change order. Applying a profile never skips value validation or dataset confirmation.",
              )}
            </p>
            {profiles.map((profile) => (
              <div className="import-profile-row" key={profile.id}>
                <input
                  aria-label={t("Profile name")}
                  value={profile.name}
                  onChange={(e) =>
                    setProfiles(
                      profiles.map((p) =>
                        p.id === profile.id
                          ? { ...p, name: e.target.value }
                          : p,
                      ),
                    )
                  }
                />
                <button
                  className="btn"
                  disabled={!profile.name.trim()}
                  onClick={() => persistProfiles(profiles)}
                >
                  {t("Save name")}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    persistProfiles(profiles.filter((p) => p.id !== profile.id))
                  }
                >
                  {t("Delete profile")}
                </button>
                <details>
                  <summary>{t("Inspect profile")}</summary>
                  <p>{profile.kinds.map((k) => t(k)).join(" · ")}</p>
                  {profile.headers.map((header, index) => (
                    <p key={index}>
                      <strong>{header}</strong> →{" "}
                      {mappingOutputs(profile.mappings[index]).map(t).join(" + ") ||
                        t(
                          profile.mappings[index].target === "ignore"
                            ? "Irrelevant"
                            : "Unmapped",
                        )}{" "}
                      ·                       {t(transformation(profile.mappings[index]))}
                      {profile.mappings[index].overnight === "next_day" &&
                        ` · ${t("Earlier end time means next day")}`}
                    </p>
                  ))}
                  <pre>{JSON.stringify(profile.options, null, 2)}</pre>
                </details>
              </div>
            ))}
            <p className="footnote">
              {t(
                "To edit a profile, apply it to a matching file, adjust and confirm the mappings, then save with the same profile name.",
              )}
            </p>
          </details>}
        </>
      )}
      {step === 2 && aiResult && (
        <div className="panel import-panel">
          <h3>{t("Missing Information")}</h3>
          <p>{t("Answer only the questions required to complete a trustworthy model. OptiFlow never invents missing rules.")}</p>
          {questionGroups.map(([group, questions]) => (
            <section className="missing-question-group" key={group}>
              <h4>{t(group === "model" ? "Optimization model" : group)}</h4>
              {questions.map((question) => {
            const [dataset, ...targetParts] = question.target.split(".");
            const target = targetParts.join(".");
            const answerKey = canonicalQuestionKey(question);
            const sourceId = question.id.startsWith("missing:")
              ? question.id.split(":")[1]
              : "";
            const source = sources.find((item) => item.id === sourceId);
            const suggestedColumns = source?.parsed.headers.filter((header, index) =>
              !source.mappings[index].target ||
              source.mappings[index].target === "ignore" ||
              source.mappings[index].state === "unmapped",
            ) || [];
            const mappingTarget =
              (dataset === "availability" || dataset === "shifts") &&
              ["date", "start_time", "end_time"].includes(target)
                ? `${dataset === "shifts" ? "shift" : "availability"}_${target}`
                : target;
            const canMap = importFields.includes(mappingTarget as (typeof importFields)[number]);
            return (
              <article className="missing-question-card" key={question.id}>
                <p>
                  {t(
                    question.id.startsWith("missing:")
                      ? "Which source column or supplied value provides this required information?"
                      : question.target === "model.objective"
                        ? "Choose the optimization objective."
                        : question.prompt,
                  )}
                </p>
                <dl>
                  <div><dt>{t("Target field")}</dt><dd>{target ? t(target) : t("Objective")}</dd></div>
                  <div><dt>{t("Source dataset")}</dt><dd>{t(dataset)}{source ? ` · ${source.name}` : ""}</dd></div>
                  <div><dt>{t("Suggested mapping")}</dt><dd>{source && suggestedColumns.length ? suggestedColumns.join(", ") : t("No source column is mapped yet.")}</dd></div>
                </dl>
                {source && canMap && suggestedColumns.length > 0 && (
                  <label>
                    {t("Map a source column")}
                    <select
                      value=""
                      onChange={(event) => {
                        const columnIndex = source.parsed.headers.indexOf(event.target.value);
                        if (columnIndex < 0) return;
                        const field = mappingTarget as (typeof importFields)[number];
                        const transform: Mapping["transform"] =
                          mappingTarget.endsWith("date")
                            ? "date"
                            : mappingTarget.endsWith("time")
                                ? "time"
                                : mappingTarget === "status"
                                  ? "status"
                                  : "direct";
                        const nextSource = {
                          ...source,
                          confirmed: false,
                          mappings: source.mappings.map((mapping, index) =>
                            index === columnIndex
                                ? {
                                    ...mapping,
                                    target: field,
                                    transform,
                                    state: "confirmed" as const,
                                    reason: "Confirmed by you",
                                  }
                              : mapping,
                          ),
                        };
                        changeSource(nextSource);
                        changeQuestionAnswer(answerKey, event.target.value);
                      }}
                    >
                      <option value="">{t("Choose a source column")}</option>
                      {suggestedColumns.map((column) => <option key={column}>{column}</option>)}
                    </select>
                  </label>
                )}
                {question.answer_type === "choice" ? (
                  <label>{t("Your answer")}
                    <select value={questionAnswers[answerKey] || ""} onChange={(event) => changeQuestionAnswer(answerKey, event.target.value)}>
                      <option value="">{t("Select an answer")}</option>
                      {question.options.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                    </select>
                  </label>
                ) : question.answer_type === "boolean" ? (
                  <label>{t("Your answer")}
                    <select value={questionAnswers[answerKey] || ""} onChange={(event) => changeQuestionAnswer(answerKey, event.target.value)}>
                      <option value="">{t("Select an answer")}</option>
                      <option value="true">{t("Yes")}</option>
                      <option value="false">{t("No")}</option>
                    </select>
                  </label>
                ) : (
                  <label>{t("Your answer")}
                    <input
                      type={question.answer_type === "number" ? "number" : target.endsWith("date") ? "date" : target.endsWith("time") ? "time" : "text"}
                      value={questionAnswers[answerKey] || ""}
                      aria-invalid={question.required && !questionAnswers[answerKey]?.trim()}
                      onChange={(event) => changeQuestionAnswer(answerKey, event.target.value)}
                    />
                  </label>
                )}
                {unresolvedAnswers[answerKey] === questionAnswers[answerKey] && (
                  <p className="field-error-text" role="status">
                    {t("This question is still unresolved after refresh. Review the answer or mapping before trying again.")}
                  </p>
                )}
              </article>
            );
              })}
            </section>
          ))}
          {groupedErrors.filter(({ issue }) => issue.dataset && issue.field).map((group) => {
            const { issue } = group;
            const rowRef = group.records[0];
            const row = rowRef ? draft[rowRef.dataset][rowRef.record] : undefined;
            const source = issue.source && sources.find((item) => item.id === issue.source?.fileId);
            const mappingIssue = issue.code === "missing-mapping";
            return (
              <article className="missing-question-card unresolved" key={group.key}>
                <h4>{t(issue.dataset!)}</h4>
                <p>{t(issue.message)}</p>
                {group.records.length > 1 && (
                  <p>{t(`${group.records.length} affected rows`)}</p>
                )}
                <dl>
                  <div><dt>{t("Target field")}</dt><dd>{t(issue.field!)}</dd></div>
                  <div><dt>{t("Source dataset")}</dt><dd>{source?.name || issue.source?.file || t(issue.dataset!)}</dd></div>
                  <div><dt>{t("Suggested mapping")}</dt><dd>{mappingIssue ? t("Choose a matching source column or add the value in the preview.") : t("Enter a value that satisfies this field.")}</dd></div>
                </dl>
                {mappingIssue ? (
                  <button className="btn" onClick={() => setStep(1)}>{t("Review source mappings")}</button>
                ) : row && rowRef ? (
                  <>
                    <label>{t("Your answer")}
                      <input
                        type={["hourly_rate", "max_weekly_hours", "required_count"].includes(issue.field!) ? "number" : issue.field!.endsWith("date") || issue.field === "date" ? "date" : issue.field!.endsWith("time") ? "time" : "text"}
                        className="invalid"
                        aria-invalid="true"
                        aria-label={`${t(issue.dataset!)} ${rowRef.record + 1} ${t(issue.field!)}`}
                        value={row.values[issue.field!] || ""}
                        onChange={(event) => {
                          changeDraft(applyGroupedIssueAnswer(draft, group, event.target.value));
                        }}
                      />
                    </label>
                    <span className="field-error-text">{t(issue.message)}</span>
                  </>
                ) : null}
              </article>
            );
          })}
          <RulesWizard
            rules={rules}
            onChange={(nextRules) => {
              setRules(nextRules);
              setAccepted(false);
            }}
            t={t}
          />
          {issues.some(
            (issue) =>
              issue.severity === "error" && (!issue.dataset || !issue.field),
          ) && (
            <IssueList
              issues={issues.filter(
                (issue) =>
                  issue.severity === "error" && (!issue.dataset || !issue.field),
              )}
              t={t}
            />
          )}
          <div className="missing-question-actions">
            <button
              className="btn primary"
              disabled={refreshBusy}
              onClick={() => void refreshAndRevalidate()}
            >
              {refreshBusy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              {t("Refresh & Revalidate")}
            </button>
          </div>
        </div>
      )}
      {(step === 3 || step === 4) && (
        <>
          {aiResult?.model && <div className="panel import-panel">
            <h3>{t("AI Interpretation")}</h3>
            <p><strong>{t("Objective")}:</strong> {t(aiResult.model.objective.kind)} — {t(aiResult.model.objective.description)}</p>
            <p><strong>{t("Decision variables")}:</strong> {aiResult.model.decision_variables.map((variable) => t(variable.name)).join(", ") || t("None identified")}</p>
            <p><strong>{t("Constraints")}:</strong> {aiResult.model.constraints.length}</p>
            <p className="footnote">{t("AI interpretation is explanatory. Deterministic validation remains authoritative.")}</p>
          </div>}
          <div className="section-heading">
            <div>
              <h2>{t("Correct the data, keep the source.")}</h2>
              <p>
                {t(
                  "Edit any cell, add missing records, or remove conflicts. Validation updates immediately. Source rows remain traceable.",
                )}
              </p>
            </div>
            <button
              className="btn"
              onClick={() => {
                setValidationRevision((n) => n + 1);
                setNotice("Validation refreshed.");
                setAccepted(false);
              }}
            >
              {t("Revalidate")}
            </button>
          </div>
          <IssueList issues={issues.filter((i) => i.code !== "rules")} t={t} />
          <p className="notice info">
            {t(
              "Individual CSV exports validate that dataset. Missing employee references remain unverified; full scheduling approval still requires all datasets and rules.",
            )}
          </p>
        </>
      )}
      {(step === 3 || step === 4) && (
        <>
          <RulesWizard
            rules={rules}
            onChange={(r) => {
              setRules(r);
              setAccepted(false);
            }}
            t={t}
          />
        </>
      )}
      {(step === 3 || step === 4) && (
        <>
          <div className="import-summary-cards">
            <div className="metric">
              <span>{t("Employees")}</span>
              <strong>{draft.employees.length}</strong>
            </div>
            <div className="metric">
              <span>{t("Availability windows")}</span>
              <strong>{draft.availability.length}</strong>
            </div>
            <div className="metric">
              <span>{t("Shift requirements")}</span>
              <strong>{draft.shifts.length}</strong>
            </div>
            <div className="metric">
              <span>{t("Validation")}</span>
              <strong>
                {errors.length} {t("errors")}
              </strong>
              <small>
                {warnings.length} {t("warnings")}
              </small>
            </div>
          </div>
          <div className="panel import-panel">
            <h3>{t("Scheduling rules summary")}</h3>
            <RuleSummary rules={rules} t={t} />
          </div>
          <p className="notice info">
            {t(
              "Individual CSV exports validate that dataset. Missing employee references remain unverified; full scheduling approval still requires all datasets and rules.",
            )}
          </p>
          <IssueList issues={issues} t={t} />
          <DataPreview
            draft={draft}
            onChange={changeDraft}
            issues={issues}
            t={t}
            canExport={canExport}
            onExport={exportDataset}
          />
          <details className="panel import-panel">
            <summary>
              {t("Unmapped source columns")} ({unmapped.length})
            </summary>
            {unmapped.map((u, i) => (
              <p key={i}>
                {u.file} · <strong>{u.column}</strong> · {t(u.decision)}
              </p>
            ))}
            {!unmapped.length && <p>{t("No unmapped source columns.")}</p>}
          </details>
          {step === 3 && <button className="btn primary" disabled={!valid || hasMissingInformation} onClick={() => setStep(4)}>
            {t("Continue to save")} <ArrowRight size={16} />
          </button>}
          {step === 4 && <div className="import-save">
            <label className="import-confirm">
              <input
                type="checkbox"
                disabled={!valid}
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              {t(
                "I reviewed the records, rules, warnings, and unmapped columns. Save this dataset for Scheduling.",
              )}
            </label>
            <button
              className="btn primary"
              disabled={!valid || hasMissingInformation || !accepted}
              onClick={() => void save()}
            >
              <CheckCircle2 size={17} />
              {t("Confirm & save validated data")}
            </button>
            <p>
              {t(
                "Saved locally in this browser. Open Scheduling and choose Optimize imported schedule to generate a schedule; demo scenarios stay separate.",
              )}
            </p>
            {savedModelId && <p>{t("Saved model ID")}: <code>{savedModelId}</code></p>}
          </div>}
        </>
      )}
    </div>
  );
}
function PlusIcon() {
  return <FileSpreadsheet size={16} />;
}
