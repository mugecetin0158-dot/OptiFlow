"use client";
import { useEffect, useRef, useState } from "react";
import {
  AISuggestion,
  requestAISuggestions,
} from "../../lib/import/automation";
export default function AIMappingHelp({
  target,
  headers,
  allowed,
  onChoose,
}: {
  target: "scheduling" | "allocation";
  headers: string[];
  allowed: string[];
  onChoose: (s: AISuggestion) => void;
}) {
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const unknown = headers.filter(Boolean).slice(0, 20);
  async function ask() {
    if (!unknown.length) return;
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError("");
    setSuggestions([]);
    try {
      setSuggestions(
        await requestAISuggestions(target, unknown, allowed, controller.signal),
      );
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      setLoading(false);
      abort.current = null;
    }
  }
  if (!unknown.length) return null;
  return (
    <div className="notice info">
      <p>
        Optional AI mapping help sends only the selected column headers to a
        private server and then to OpenAI. No rows, values, constraints, or
        employee records are sent. Suggestions require your review and never
        fill missing data.
      </p>
      <button
        className="btn"
        disabled={loading || !unknown.length}
        onClick={ask}
      >
        I consent — suggest mappings
      </button>
      {loading && (
        <button className="btn" onClick={() => abort.current?.abort()}>
          Cancel AI request
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && suggestions.length === 0 && (
        <small>Deterministic mapping and validation work without AI.</small>
      )}
      {suggestions.map((s, i) => (
        <p key={i}>
          <strong>
            {s.column} → {s.field}
          </strong>
          : {s.reason}{" "}
          <button className="btn" onClick={() => onChoose(s)}>
            Apply suggestion for review
          </button>
        </p>
      ))}
    </div>
  );
}
