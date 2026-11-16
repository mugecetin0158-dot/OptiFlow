"use client";
import { useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import {
  ImportDraft,
  Dataset,
  schemas,
  previewFields,
  datasets,
  Issue,
  Rules,
} from "../../lib/import/types";
import { Translate } from "./RulesWizard";
export function IssueList({ issues, t }: { issues: Issue[]; t: Translate }) {
  return (
    <div className="import-issues" role="status">
      {issues.length === 0 ? (
        <div className="notice success">
          {t("No validation errors or warnings.")}
        </div>
      ) : (
        issues.slice(0, 150).map((issue, i) => (
          <div key={i} className={`import-issue ${issue.severity}`}>
            <span
              className={`badge ${issue.severity === "error" ? "issue-error" : "muted"}`}
            >
              {t(issue.severity === "error" ? "Error" : "Warning")}
            </span>
            <div>
              <strong>{t(issue.message)}</strong>
              <small>
                {issue.dataset && t(issue.dataset)}
                {issue.record !== undefined &&
                  ` · ${t("Record")} ${issue.record + 1}`}
                {issue.field && ` · ${issue.field}`}
                {issue.source && ` · ${issue.source.file}:${issue.source.row}`}
                {issue.detail && ` · ${issue.detail}`}
              </small>
            </div>
          </div>
        ))
      )}
      {issues.length > 150 && (
        <p>
          {t(
            "Showing the first 150 issues. Correct these and revalidate to reveal the remaining issues.",
          )}
        </p>
      )}
    </div>
  );
}
export function RuleSummary({ rules, t }: { rules: Rules; t: Translate }) {
  return (
    <div className="import-rule-summary">
      <span>
        {t("Minimum rest")}: <b>{rules.minRestHours || "—"}h</b>
      </span>
      <span>
        {t("Weekly shift limit")}: <b>{rules.maxShiftsPerWeek || "—"}</b>
      </span>
      <span>
        {t("Weekly hour cap")}:{" "}
        <b>{rules.maxWeeklyHours || t("Employee limits")}</b>
      </span>
      <span>
        {t("Maximum daily hours")}: <b>{rules.maxDailyHours || "—"}</b>
      </span>
      <span>
        {t("Business timezone")}: <b>{rules.timezone || "—"}</b>
      </span>
      <span>
        {t("Business currency")}: <b>{rules.currency || "—"}</b>
      </span>
      <span>
        {t("Scheduling week start")}: <b>{rules.weekStart || "—"}</b>
      </span>
      <span>
        {t("Multiple shifts on the same day")}:{" "}
        <b>
          {rules.allowMultipleShifts === null
            ? "—"
            : t(rules.allowMultipleShifts ? "Allowed" : "Not allowed")}
        </b>
      </span>
      <span>
        {t("Closed weekdays")}:{" "}
        <b>
          {rules.closedWeekdays.length
            ? rules.closedWeekdays
                .map((d) =>
                  t(
                    [
                      "Sunday",
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                    ][d],
                  ),
                )
                .join(", ")
            : t("None selected")}
        </b>
      </span>
    </div>
  );
}
export default function DataPreview({
  draft,
  onChange,
  issues,
  t,
  onExport,
  canExport = false,
}: {
  draft: ImportDraft;
  onChange?: (d: ImportDraft) => void;
  issues: Issue[];
  t: Translate;
  onExport?: (d: Dataset) => void;
  canExport?: boolean | ((kind: Dataset) => boolean);
}) {
  const [pages, setPages] = useState<Record<Dataset, number>>({
    employees: 0,
    availability: 0,
    shifts: 0,
  });
  function edit(kind: Dataset, index: number, field: string, value: string) {
    if (!onChange) return;
    const next = structuredClone(draft);
    next[kind][index].values[field] = value;
    if (next[kind][index].pending) delete next[kind][index].pending![field];
    onChange(next);
  }
  return (
    <div className="import-data-tables">
      {datasets.map((kind) => {
        const page = Math.min(
            pages[kind],
            Math.max(0, Math.ceil(draft[kind].length / 20) - 1),
          ),
          start = page * 20;
        return (
          <section className="panel" key={kind}>
            <div className="import-table-heading">
              <div>
                <h3>
                  {t(kind)} <span className="count">{draft[kind].length}</span>
                </h3>
                <small>
                  {kind === "employees"
                    ? t(
                        'Roles use a JSON list, for example ["Cashier", "Manager"].',
                      )
                    : t(
                        "Dates use YYYY-MM-DD; times use HH:mm. Set end_date explicitly for overnight intervals; blank means same day.",
                      )}
                </small>
              </div>
              <div className="import-actions">
                {onChange && (
                  <button
                    className="btn"
                    onClick={() => {
                      onChange({
                        ...draft,
                        [kind]: [
                          ...draft[kind],
                          {
                            values: Object.fromEntries(
                              previewFields(kind).map((f) => [f, ""]),
                            ),
                            sources: [],
                          },
                        ],
                      });
                      setPages({
                        ...pages,
                        [kind]: Math.floor(draft[kind].length / 20),
                      });
                    }}
                  >
                    <Plus size={14} />
                    {t("Add record")}
                  </button>
                )}
                {onExport && (
                  <button
                    className="btn"
                    disabled={
                      !(typeof canExport === "function"
                        ? canExport(kind)
                        : canExport)
                    }
                    onClick={() => onExport(kind)}
                  >
                    <Download size={14} />
                    {kind === "shifts" ? "shifts.csv" : `${kind}.csv`}
                  </button>
                )}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {previewFields(kind).map((field) => (
                      <th key={field}>{field}</th>
                    ))}
                    <th>{t("Source")}</th>
                    {onChange && <th />}
                  </tr>
                </thead>
                <tbody>
                  {draft[kind].slice(start, start + 20).map((r, j) => {
                    const index = start + j;
                    return (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        {previewFields(kind).map((field) => {
                          const problems = issues.filter(
                            (i) =>
                              i.dataset === kind &&
                              i.record === index &&
                              i.field === field &&
                              i.severity === "error",
                          );
                          return (
                            <td key={field}>
                              {onChange ? (
                                <input
                                  className={problems.length ? "invalid" : ""}
                                  aria-label={`${t(kind)} ${index + 1} ${field}`}
                                  aria-invalid={problems.length > 0}
                                  title={problems
                                    .map((p) => t(p.message))
                                    .join("\n")}
                                  value={r.values[field] || ""}
                                  onChange={(e) =>
                                    edit(kind, index, field, e.target.value)
                                  }
                                />
                              ) : (
                                <span>{r.values[field]}</span>
                              )}
                            </td>
                          );
                        })}
                        <td>
                          <details>
                            <summary>
                              {r.sources.length
                                ? `${r.sources[0].file}:${r.sources[0].row}`
                                : t("Manual entry")}
                            </summary>
                            {r.sources.map((s, k) => (
                              <small className="source-line" key={k}>
                                {s.file}:{s.row}
                              </small>
                            ))}
                          </details>
                        </td>
                        {onChange && (
                          <td>
                            <button
                              className="icon-btn danger"
                              aria-label={`${t("Remove record")} ${index + 1}`}
                              onClick={() =>
                                onChange({
                                  ...draft,
                                  [kind]: draft[kind].filter(
                                    (_, i) => i !== index,
                                  ),
                                })
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!draft[kind].length && (
                    <tr>
                      <td colSpan={schemas[kind].length + 3}>
                        {t(
                          "No records. Map source columns or add the missing information explicitly.",
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {draft[kind].length > 20 && (
              <div className="import-pagination">
                <button
                  className="btn"
                  disabled={page === 0}
                  onClick={() => setPages({ ...pages, [kind]: page - 1 })}
                >
                  {t("Previous")}
                </button>
                <span>
                  {start + 1}–{Math.min(start + 20, draft[kind].length)} /{" "}
                  {draft[kind].length}
                </span>
                <button
                  className="btn"
                  disabled={start + 20 >= draft[kind].length}
                  onClick={() => setPages({ ...pages, [kind]: page + 1 })}
                >
                  {t("Next")}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
