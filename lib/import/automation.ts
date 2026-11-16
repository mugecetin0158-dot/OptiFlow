import {
  Dataset,
  Field,
  ImportSource,
  ImportProfile,
  fields as schedulingFields,
} from "./types";
import { applyProfile, matchingProfile } from "./profiles";
import { mappingIssues } from "./stages";
import { transformSources } from "./pipeline";
import {
  AllocationSource,
  recognizeAllocation,
  requiredColumns,
  transformAllocationSources,
} from "../allocation/import";
import { Table, tables, Settings } from "../allocation/types";
import { normalizeHeader } from "./recognition";
import {
  AllocationProfile,
  applyAllocationProfile,
} from "../allocation/profiles";

// Classification needs a distinctive combination of fields, not a lone ambiguous heading.
export function autoScheduling(
  sources: ImportSource[],
  profiles: ImportProfile[],
) {
  const prepared = sources.map((source) => {
    const matches = profiles.filter((p) =>
      matchingProfile(p, source.parsed.headers),
    );
    const next =
      matches.length === 1 ? applyProfile(source, matches[0]) : source;
    const clear =
      next.kinds.length === 1 &&
      !next.parsed.issues.some((i) => i.severity === "error") &&
      !next.mappings.some((m) => m.state === "suggested") &&
      mappingIssues({ ...next, confirmed: true }, false).every(
        (i) => i.severity !== "error",
      );
    return { ...next, confirmed: clear };
  });
  const ready = prepared.length > 0 && prepared.every((s) => s.confirmed);
  return {
    sources: prepared,
    ready,
    result: ready ? transformSources(prepared) : null,
  };
}
const signatures: Record<Table, string[]> = {
  resources: ["resource_id", "resource_type", "capacity"],
  projects: ["project_id", "output_unit", "minimum_output"],
  demands: ["project_id", "resource_type", "amount_per_output"],
  links: ["resource_id", "project_id", "compatible"],
};
export function autoAllocation(
  source: AllocationSource,
  settings: Settings,
): AllocationSource {
  if (source.parsed.issues.some((i) => i.severity === "error")) return source;
  const matches = tables.filter((kind) => {
    const mapped = recognizeAllocation(source.parsed.headers, kind);
    return (
      signatures[kind].every((f) => mapped.includes(f)) &&
      requiredColumns(kind, settings.mode).every((f) => mapped.includes(f))
    );
  });
  if (matches.length !== 1) return source;
  const kind = matches[0],
    next = {
      ...source,
      kind,
      mappings: recognizeAllocation(source.parsed.headers, kind),
      confirmed: true,
    };
  const transformed = transformAllocationSources([next], settings);
  return transformed.issues.some((i) => i.severity === "error")
    ? { ...next, confirmed: false }
    : next;
}
export type AISuggestion = { column: string; field: string; reason: string };

export type AIImportCorrection = {
  column: string;
  source_value: string;
  proposed_value: string;
  reason: string;
  substantive: boolean;
};
export type AIImportFile = {
  source_id: string;
  datasets: Dataset[];
  columns: {
    column: string;
    field: Field | "" | "ignore";
    transform: "direct" | "date" | "time" | "status" | "time_range";
    confidence: number;
    reason: string;
  }[];
  corrections: AIImportCorrection[];
};
export type AIMissingQuestion = {
  id: string;
  prompt: string;
  answer_type: "text" | "number" | "choice" | "boolean";
  options: string[];
  target: string;
  required: boolean;
};
export type AIModelInterpretation = {
  objective: {
    kind: "minimize_cost" | "maximize_output" | "maximize_net_value" | "unknown";
    description: string;
    source_fields: string[];
    confidence: number;
  };
  decision_variables: {
    name: string;
    meaning: string;
    unit: string;
    source_fields: string[];
    confidence: number;
  }[];
  constraints: {
    kind: string;
    description: string;
    source_fields: string[];
    hard: boolean;
    confidence: number;
  }[];
  relationships: {
    from_dataset: string;
    from_field: string;
    to_dataset: string;
    to_field: string;
    kind: string;
    confidence: number;
  }[];
};
export type AIImportResult = {
  session_id?: string;
  files: AIImportFile[];
  model?: AIModelInterpretation;
  questions: AIMissingQuestion[];
  requires_verification: boolean;
  provider?: "gemini";
};

function valueType(value: string) {
  const v = value.trim();
  if (!v) return "empty";
  if (/^-?\d+$/.test(v)) return "integer";
  if (/^-?\d+[.,]\d+$/.test(v)) return "decimal";
  if (/^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(v)) return "date";
  if (/^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i.test(v)) return "time";
  if (/\d\s*(?::\d{2})?\s*(?:[AP]M)?\s*[-–—]\s*\d/i.test(v)) return "time_range";
  if (/^(?:yes|no|true|false|available|unavailable|evet|hayır|oui|non)$/i.test(v)) return "boolean";
  return "text";
}
function safeSample(header: string, value: string) {
  const normalized = normalizeHeader(header);
  if (/name|email|phone|address|salary|wage|pay|employee|worker|staff|badge|personnel/.test(normalized)) {
    const type = valueType(value);
    return `<redacted:${type}:${value.trim().length}>`;
  }
  return value.slice(0, 80);
}
export function profileSourcesForAI(sources: ImportSource[]) {
  return sources.map((source) => ({
    source_id: source.id,
    name: source.name.slice(0, 160),
    row_count: source.parsed.rows.length,
    columns: source.parsed.headers.map((header, index) => {
      const values = source.parsed.rows.map((r) => r[index] || ""),
        nonblank = values.filter((v) => v.trim()),
        types = [...new Set(nonblank.map(valueType))],
        samples = [...new Set(nonblank.map((v) => safeSample(header, v)))].slice(0, 3);
      return {
        header,
        inferred_type: types.length === 0 ? "empty" : types.length === 1 ? types[0] : "mixed",
        samples,
        blank_count: values.length - nonblank.length,
        unique_count: new Set(nonblank).size,
      };
    }),
  }));
}

export function cleanImportAnalysis(raw: unknown, sources: ImportSource[]): AIImportResult {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).files))
    throw Error("AI returned an invalid structured response.");
  const byId = new Map(sources.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const files: AIImportFile[] = (raw as any).files.map((item: any) => {
    const source = item && byId.get(item.source_id);
    if (!source || seen.has(source.id)) throw Error("AI returned an invalid source reference.");
    seen.add(source.id);
    const headerSet = new Set(source.parsed.headers), fieldSet = new Set<string>(schedulingFields);
    const columns = Array.isArray(item.columns) ? item.columns.map((column: any) => {
      if (!column || !headerSet.has(column.column) || (column.field && column.field !== "ignore" && !fieldSet.has(column.field)) ||
          !["direct","date","time","status","time_range"].includes(column.transform) ||
          typeof column.confidence !== "number" || column.confidence < 0 || column.confidence > 1 ||
          typeof column.reason !== "string" || column.reason.length > 240)
        throw Error("AI returned an invalid column mapping.");
      return column;
    }) : [];
    const datasets = Array.isArray(item.datasets)
      ? item.datasets.filter((v: unknown): v is Dataset => ["employees","availability","shifts"].includes(String(v)))
      : [];
    const samples = new Map(profileSourcesForAI([source])[0].columns.map((c) => [c.header, new Set(c.samples)]));
    const corrections = Array.isArray(item.corrections) ? item.corrections.map((c: any) => {
      if (!c || !headerSet.has(c.column) || !samples.get(c.column)?.has(c.source_value) ||
          typeof c.proposed_value !== "string" || typeof c.reason !== "string" ||
          c.proposed_value.length > 240 || c.reason.length > 240)
        throw Error("AI returned an invalid correction proposal.");
      return { ...c, substantive: Boolean(c.substantive) };
    }) : [];
    return { source_id: source.id, datasets, columns, corrections };
  });
  if (files.length !== sources.length) throw Error("AI did not analyze every source file.");
  const root = raw as any;
  const questions: AIMissingQuestion[] = Array.isArray(root.questions)
    ? root.questions.map((q: any) => {
        if (
          !q || typeof q.id !== "string" || typeof q.prompt !== "string" ||
          !["text", "number", "choice", "boolean"].includes(q.answer_type) ||
          !Array.isArray(q.options) || typeof q.target !== "string" ||
          typeof q.required !== "boolean"
        ) throw Error("AI returned an invalid missing-information question.");
        return q;
      })
    : [];
  const model = root.model;
  if (model !== undefined && (
    !model || typeof model !== "object" || !model.objective ||
    !["minimize_cost", "maximize_output", "maximize_net_value", "unknown"].includes(model.objective.kind) ||
    !Array.isArray(model.decision_variables) || !Array.isArray(model.constraints) ||
    !Array.isArray(model.relationships)
  )) throw Error("AI returned an invalid optimization-model interpretation.");
  return {
    session_id: typeof root.session_id === "string" ? root.session_id : undefined,
    files,
    model,
    questions,
    requires_verification:
      typeof root.requires_verification === "boolean"
        ? root.requires_verification
        : questions.length > 0,
    provider: root.provider === "gemini" ? "gemini" : undefined,
  };
}

export function applyImportAnalysis(sources: ImportSource[], result: AIImportResult) {
  const analyses = new Map(result.files.map((f) => [f.source_id, f]));
  return sources.map((source) => {
    const analysis = analyses.get(source.id);
    if (!analysis) return source;
    const byHeader = new Map(analysis.columns.map((c) => [c.column, c]));
    return {
      ...source,
      kinds: analysis.datasets,
      confirmed: false,
      mappings: source.parsed.headers.map((header) => {
        const column = byHeader.get(header);
        if (!column || !column.field)
          return { target: "" as const, state: "unmapped" as const, reason: column?.reason || "AI left this column unresolved." };
        if (column.field === "ignore")
          return { target: "ignore" as const, state: column.confidence >= 0.9 ? "auto" as const : "suggested" as const, reason: `AI (${Math.round(column.confidence * 100)}%): ${column.reason}` };
        return {
          target: column.field,
          transform: column.transform,
          overnight: column.transform === "time_range" ? "ask" as const : undefined,
          state: column.confidence >= 0.9 ? "auto" as const : "suggested" as const,
          reason: `AI (${Math.round(column.confidence * 100)}%): ${column.reason}`,
        };
      }),
    };
  });
}

export function aiVerificationRequired(
  sources: ImportSource[],
  corrections: AIImportCorrection[],
) {
  return (
    corrections.length > 0 ||
    sources.some(
      (source) =>
        source.kinds.length === 0 ||
        source.mappings.some(
          (mapping) =>
            mapping.state === "suggested" || mapping.state === "unmapped",
        ),
    )
  );
}

export async function requestAIImportAnalysis(
  sources: ImportSource[],
  locale: "en" | "tr" | "fr" | "es" = "en",
  signal?: AbortSignal,
) {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw Error("AI import processing needs a configured private server.");
  const response = await fetch(base + "/import/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "scheduling", locale, files: profileSourcesForAI(sources), allowed_fields: schedulingFields }),
    signal,
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).detail || ""; } catch {}
    if (response.status === 429) throw Error(detail || "Gemini rate limit reached. Wait before retrying.");
    if (response.status === 503) throw Error(detail || "Gemini import processing is not configured on the server.");
    throw Error(detail || "Gemini import processing failed. Retry without changing the source data.");
  }
  return cleanImportAnalysis(await response.json(), sources);
}

export async function submitMissingAnswers(
  sessionId: string,
  answers: Record<string, string>,
  signal?: AbortSignal,
) {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw Error("AI import processing needs a configured private server.");
  const response = await fetch(`${base}/import/sessions/${encodeURIComponent(sessionId)}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: Object.entries(answers).map(([question_id, value]) => ({ question_id, value })) }),
    signal,
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).detail || ""; } catch {}
    throw Error(detail || "Missing information could not be saved.");
  }
  return response.json() as Promise<{ accepted: number; remaining_questions: AIMissingQuestion[] }>;
}

export async function requestModelPreview(sessionId: string, model: unknown) {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw Error("AI import processing needs a configured private server.");
  const response = await fetch(`${base}/import/sessions/${encodeURIComponent(sessionId)}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.detail || "Model preview validation failed.");
  return result as { ready: boolean; issues: { severity: string; message: string }[]; summary: Record<string, number> };
}

export async function saveAIImportModel(sessionId: string) {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw Error("AI import processing needs a configured private server.");
  const response = await fetch(`${base}/import/sessions/${encodeURIComponent(sessionId)}/save`, { method: "POST" });
  const result = await response.json();
  if (!response.ok) throw Error(result.detail || "The validated model could not be saved.");
  return result as { model_id: string; saved: true; storage: string };
}
export function cleanSuggestions(
  raw: unknown,
  headers: string[],
  allowed: string[],
): AISuggestion[] {
  if (!Array.isArray(raw))
    throw Error(
      "Mapping assistant returned an invalid response. Review columns manually.",
    );
  const names = new Set(headers.map(normalizeHeader)),
    fields = new Set(allowed);
  return raw
    .slice(0, 20)
    .filter(
      (s: any) =>
        s &&
        typeof s.column === "string" &&
        names.has(normalizeHeader(s.column)) &&
        typeof s.field === "string" &&
        fields.has(s.field) &&
        typeof s.reason === "string" &&
        s.reason.length <= 240,
    )
    .map((s) => ({ column: s.column, field: s.field, reason: s.reason }));
}
export async function requestAISuggestions(
  target: "scheduling" | "allocation",
  headers: string[],
  allowed: string[],
  signal?: AbortSignal,
) {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base)
    throw Error(
      "Optional mapping assistance needs a configured private server. Continue with manual mapping.",
    );
  const response = await fetch(base + "/import/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      headers: headers.slice(0, 20),
      allowed_fields: allowed,
    }),
    signal,
  });
  if (!response.ok)
    throw Error(
      response.status === 503
        ? "Mapping assistance is unavailable on the server. Continue with manual mapping."
        : "Mapping assistance failed. Continue with manual mapping.",
    );
  return cleanSuggestions(
    (await response.json()).suggestions,
    headers,
    allowed,
  );
}
export function detectHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 12);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i] || [],
      names = cells.map(normalizeHeader).filter(Boolean);
    if (names.length < 2 || new Set(names).size !== names.length) continue;
    if (names.filter((n) => /[a-z]/i.test(n)).length < 2) continue;
    const known = Object.values(signatures).flat();
    if (
      names.some((n) => known.some((k) => normalizeHeader(k) === n)) ||
      names.some((n) =>
        [
          "employee id",
          "name",
          "badge",
          "date",
          "hourly rate",
          "required count",
          "status",
          "day",
        ].includes(n),
      )
    )
      return i;
    if (i === 0 && rows.length > 1) return 0;
  }
  return 0;
}

export function autoAllocationWithProfiles(
  source: AllocationSource,
  settings: Settings,
  profiles: AllocationProfile[],
) {
  const matches = profiles.filter(
    (p) =>
      Array.isArray(p?.headers) &&
      p.headers.length === source.parsed.headers.length &&
      p.headers.every((h) =>
        source.parsed.headers.map(normalizeHeader).includes(normalizeHeader(h)),
      ),
  );
  if (matches.length === 1) {
    try {
      const reused = applyAllocationProfile(source, matches[0]);
      const candidate = { ...reused, confirmed: true };
      const converted = transformAllocationSources([candidate], settings);
      if (!converted.issues.some((i) => i.severity === "error"))
        return candidate;
      return reused;
    } catch {
      /* Ignore invalid saved profiles and use dictionary recognition. */
    }
  }
  return autoAllocation(source, settings);
}
import { transformCell, mappingOutputs } from "./transformations";
export type Correction = {
  file: string;
  row: number;
  column: string;
  original: string;
  result: string;
  reason: string;
};
export function correctionJournal(sources: ImportSource[]): Correction[] {
  const changes: Correction[] = [];
  for (const source of sources)
    for (const [ri, row] of source.parsed.rows.entries())
      for (const [ci, m] of source.mappings.entries()) {
        if (!mappingOutputs(m).length) continue;
        const original = row[ci] || "";
        try {
          for (const [field, result] of Object.entries(
            transformCell(original, m, source.options),
          ))
            if (result !== original)
              changes.push({
                file: source.name,
                row: source.parsed.lineNumbers[ri],
                column: source.parsed.headers[ci],
                original,
                result,
                reason: `${field}: ${m.transform || "deterministic normalization"}`,
              });
        } catch {
          /* Transformation failures remain blocking validation errors. */
        }
      }
  return changes;
}
