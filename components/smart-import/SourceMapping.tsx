"use client";
import { useMemo, useState } from "react";
import {
  ImportSource,
  ImportProfile,
  fields,
  datasets,
} from "../../lib/import/types";
import { createSource, mappingConflicts } from "../../lib/import/recognition";
import { matchingProfile } from "../../lib/import/profiles";
import { Translate } from "./RulesWizard";
import {
  transformation,
  transformCell,
  transformRow,
  mappingOutputs,
} from "../../lib/import/transformations";
import { mappingIssues } from "../../lib/import/stages";
import { normalizeStatus } from "../../lib/import/normalize";
import { IssueList } from "./DataPreview";
export default function SourceMapping({
  source,
  onChange,
  onRemove,
  onProfile,
  onApply,
  profiles,
  t,
}: {
  source: ImportSource;
  onChange: (s: ImportSource) => void;
  onRemove: () => void;
  onProfile: (name: string) => void;
  onApply: (id: string) => void;
  profiles: ImportProfile[];
  t: Translate;
}) {
  const [raw, setRaw] = useState(source.text),
    [name, setName] = useState(""),
    [previewPage, setPreviewPage] = useState(0),
    [statusPage, setStatusPage] = useState(0);
  const suggestions = profiles.filter((p) =>
    matchingProfile(p, source.parsed.headers),
  );
  function update(next: Partial<ImportSource>) {
    onChange({ ...source, ...next, confirmed: false });
  }
  const mappingProblems = useMemo(() => mappingIssues(source, true), [source]);
  function reparse(text: string, delimiter: string) {
    return {
      ...createSource(source.id, source.name, text, source.encoding, delimiter),
      originalText: source.originalText ?? source.text,
    };
  }
  const statusColumn = source.mappings.findIndex((m) => m.target === "status");
  const statuses =
    statusColumn < 0
      ? []
      : [
          ...new Set(
            source.parsed.rows
              .map((r) => (r[statusColumn] || "").trim().toLowerCase())
              .filter(Boolean),
          ),
        ];
  const currentStatusPage = Math.min(
    statusPage,
    Math.max(0, Math.ceil(statuses.length / 20) - 1),
  );
  return (
    <section className="panel import-source">
      <div className="import-source-heading">
        <div>
          <h3>{source.name}</h3>
          <p>
            {source.parsed.rows.length} {t("records")} ·{" "}
            {source.parsed.headers.length} {t("columns")} · {source.encoding} ·{" "}
            {t("Delimiter")}:{" "}
            {source.parsed.delimiter === "\t" ? "TAB" : source.parsed.delimiter}
          </p>
        </div>
        <button className="btn" onClick={onRemove}>
          {t("Remove file")}
        </button>
      </div>
      <div className="import-rule-summary" role="status">
        <span>
          {t("Parsing validation")}:{" "}
          <b>
            {t(
              source.parsed.issues.some((i) => i.severity === "error")
                ? "Needs attention"
                : "Complete",
            )}
          </b>
        </span>
        <span>
          {t("Mapping validation")}:{" "}
          <b>
            {t(
              mappingProblems.some((i) => i.severity === "error")
                ? "Needs attention"
                : source.kinds.length
                  ? "Complete"
                  : "No scheduling data",
            )}
          </b>
        </span>
      </div>
      {source.parsed.issues.length > 0 && (
        <IssueList issues={source.parsed.issues} t={t} />
      )}
      {mappingProblems.length > 0 && (
        <details>
          <summary>
            {t("Mapping and transformation issues")} ({mappingProblems.length})
          </summary>
          <IssueList issues={mappingProblems} t={t} />
        </details>
      )}
      <details className="import-raw">
        <summary>{t("Preview records or correct the source CSV")}</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("Line")}</th>
                {source.parsed.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {source.parsed.rows
                .slice(previewPage * 10, previewPage * 10 + 10)
                .map((r, i) => (
                  <tr key={i}>
                    <td>{source.parsed.lineNumbers[previewPage * 10 + i]}</td>
                    {r.map((v, j) => (
                      <td key={j}>{v || "∅"}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="import-pagination">
          <button
            className="btn"
            disabled={previewPage === 0}
            onClick={() => setPreviewPage(previewPage - 1)}
          >
            {t("Previous")}
          </button>
          <span>
            {previewPage + 1} /{" "}
            {Math.max(1, Math.ceil(source.parsed.rows.length / 10))}
          </span>
          <button
            className="btn"
            disabled={(previewPage + 1) * 10 >= source.parsed.rows.length}
            onClick={() => setPreviewPage(previewPage + 1)}
          >
            {t("Next")}
          </button>
        </div>
        <label>
          {t("Delimiter")}
          <select
            value={source.delimiter}
            onChange={(e) => {
              onChange(reparse(raw, e.target.value));
              setPreviewPage(0);
            }}
          >
            <option value="auto">{t("Detect from header")}</option>
            <option value=",">{t("Comma")}</option>
            <option value=";">{t("Semicolon")}</option>
            <option value={"\t"}>Tab</option>
            <option value="|">|</option>
          </select>
        </label>
        <label>
          {t("Edit raw CSV")}
          <textarea
            spellCheck={false}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </label>
        <button
          className="btn"
          onClick={() => {
            onChange(reparse(raw, source.delimiter));
            setPreviewPage(0);
          }}
        >
          {t("Reparse source and reset mappings")}
        </button>
      </details>
      <details className="import-raw">
        <summary>{t("Original uploaded CSV")}</summary>
        <textarea
          aria-label={t("Original uploaded CSV")}
          readOnly
          value={source.originalText ?? source.text}
        />
      </details>
      <div className="import-classification">
        <strong>{t("What do these rows represent?")}</strong>
        <p>
          {t(
            "Confirm the meaning, not just the column names. Existing assignments are not staffing demand.",
          )}
        </p>
        <div>
          {datasets.map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={source.kinds.includes(kind)}
                onChange={(e) =>
                  update({
                    kinds: e.target.checked
                      ? [...source.kinds, kind]
                      : source.kinds.filter((k) => k !== kind),
                  })
                }
              />
              {t(kind)}
            </label>
          ))}
        </div>
        <small>
          {t(
            "Leave every dataset unchecked for unrelated data or existing assignments.",
          )}
        </small>
      </div>
      {suggestions.length > 0 && (
        <div className="notice info">
          <div>
            <strong>{t("Matching import profiles")}</strong>
            {suggestions.map((p) => (
              <button
                className="btn"
                key={p.id}
                onClick={() => {
                  onApply(p.id);
                  setName(p.name);
                }}
              >
                {t("Apply profile")}: {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="import-mappings">
          <thead>
            <tr>
              <th>{t("Source column")}</th>
              <th>{t("Sample values")}</th>
              <th>{t("Standard field")}</th>
              <th>{t("Transformation preview")}</th>
              <th>{t("Recognition")}</th>
            </tr>
          </thead>
          <tbody>
            {source.parsed.headers.map((h, i) => {
              const m = source.mappings[i];
              return (
                <tr key={i}>
                  <td>
                    <strong>{h}</strong>
                  </td>
                  <td>
                    <code>
                      {source.parsed.rows
                        .slice(0, 3)
                        .map((r) => r[i] || "∅")
                        .join(" · ")}
                    </code>
                  </td>
                  <td>
                    <select
                      aria-label={`${t("Map column")} ${h}`}
                      value={m.target}
                      onChange={(e) =>
                        update({
                          mappings: source.mappings.map((x, j) =>
                            i === j
                              ? {
                                  target: e.target.value as any,
                                  state: "confirmed",
                                  reason: "Confirmed by you",
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      <option value="">{t("Keep unmapped")}</option>
                      <option value="ignore">{t("Irrelevant")}</option>
                      {fields.map((f) => (
                        <option key={f} value={f}>
                          {t(f)}
                        </option>
                      ))}
                    </select>
                    {m.target && m.target !== "ignore" && (
                      <>
                        <label>
                          {t("Transformation")}
                          <select
                            aria-label={`${t("Transformation")} ${h}`}
                            value={transformation(m)}
                            onChange={(e) =>
                              update({
                                mappings: source.mappings.map((x, j) =>
                                  i === j
                                    ? {
                                        ...x,
                                        transform: e.target.value as any,
                                        state: "confirmed",
                                        reason: "Confirmed by you",
                                      }
                                    : x,
                                ),
                              })
                            }
                          >
                            <option value="direct">
                              {t("Direct mapping")}
                            </option>
                            {m.target.endsWith("date") && (
                              <option value="date">{t("Date parsing")}</option>
                            )}
                            {m.target.endsWith("time") && (
                              <option value="time">{t("Time parsing")}</option>
                            )}
                            {m.target === "status" && (
                              <option value="status">
                                {t("Value normalization")}
                              </option>
                            )}
                            {m.target.endsWith("start_time") && (
                              <option value="time_range">
                                {t("Split into start_time and end_time")}
                              </option>
                            )}
                          </select>
                        </label>
                        {transformation(m) === "time_range" && (
                          <label>
                            {t("Overnight interpretation")}
                            <select
                              aria-label={`${t("Overnight interpretation")} ${h}`}
                              value={m.overnight || "ask"}
                              onChange={(e) =>
                                update({
                                  mappings: source.mappings.map((x, j) =>
                                    i === j
                                      ? {
                                          ...x,
                                          overnight: e.target.value as any,
                                        }
                                      : x,
                                  ),
                                })
                              }
                            >
                              <option value="ask">
                                {t("Require clarification")}
                              </option>
                              <option value="next_day">
                                {t("Earlier end time means next day")}
                              </option>
                            </select>
                          </label>
                        )}
                        <small>{mappingOutputs(m).map(t).join(" + ")}</small>
                      </>
                    )}
                    {m.state === "suggested" && (
                      <button
                        className="text-link"
                        onClick={() =>
                          update({
                            mappings: source.mappings.map((x, j) =>
                              i === j
                                ? {
                                    ...x,
                                    state: "confirmed",
                                    reason: "Confirmed by you",
                                  }
                                : x,
                            ),
                          })
                        }
                      >
                        {t("Confirm suggested mapping")}
                      </button>
                    )}
                  </td>
                  <td>
                    {source.parsed.rows.slice(0, 3).map((row, rowIndex) => {
                      try {
                        const transformed = transformCell(
                          row[i] || "",
                          m,
                          source.options,
                        );
                        const preview = source.kinds
                          .filter((k) => k !== "employees")
                          .map((k) => transformRow(source, row, k));
                        const overnight =
                          transformation(m) === "time_range"
                            ? preview.find((r) => r.pending.end_date)?.pending
                                .end_date
                            : undefined;
                        const endDate =
                          transformation(m) === "time_range"
                            ? preview.find((r) => r.values.end_date)?.values
                                .end_date
                            : undefined;
                        return (
                          <small className="source-line" key={rowIndex}>
                            {source.parsed.lineNumbers[rowIndex]}:{" "}
                            {Object.entries(transformed)
                              .map(([k, v]) => `${k}: ${v || "∅"}`)
                              .join(" · ") ||
                              t(
                                m.target === "ignore"
                                  ? "Irrelevant"
                                  : "Unmapped",
                              )}
                            {endDate && ` · end_date: ${endDate}`}
                            {overnight && (
                              <strong className="danger">{t(overnight)}</strong>
                            )}
                          </small>
                        );
                      } catch (error) {
                        return (
                          <small className="source-line danger" key={rowIndex}>
                            {source.name}:{source.parsed.lineNumbers[rowIndex]}{" "}
                            · {t((error as Error).message)}
                          </small>
                        );
                      }
                    })}
                  </td>
                  <td>
                    <span
                      className={`badge ${m.state === "auto" ? "green" : m.state === "suggested" ? "issue-warning" : "muted"}`}
                    >
                      {t(
                        !m.target
                          ? "Unmapped"
                          : m.target === "ignore"
                            ? "Irrelevant"
                            : m.state === "auto"
                              ? "Automatic"
                              : m.state === "suggested"
                                ? "Needs confirmation"
                                : m.state === "confirmed"
                                  ? "Confirmed"
                                  : "Unmapped",
                      )}
                    </span>
                    <small>{t(m.reason)}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mappingConflicts(source).length > 0 && (
        <div className="notice error">
          {t("Conflicting mappings must be resolved.")}{" "}
          {mappingConflicts(source).join(", ")}
        </div>
      )}
      <div className="import-form-grid import-normalization">
        <label>
          {t("Non-ISO date order")}
          <select
            value={source.options.dateOrder}
            onChange={(e) =>
              update({
                options: {
                  ...source.options,
                  dateOrder: e.target.value as any,
                },
              })
            }
          >
            <option value="">{t("Require clarification")}</option>
            <option value="DMY">DD/MM/YYYY</option>
            <option value="MDY">MM/DD/YYYY</option>
          </select>
        </label>
        <label>
          {t("Decimal convention")}
          <select
            value={source.options.decimal}
            onChange={(e) =>
              update({
                options: { ...source.options, decimal: e.target.value as any },
              })
            }
          >
            <option value="">{t("Require clarification")}</option>
            <option value="dot">1234.56</option>
            <option value="comma">1234,56</option>
          </select>
        </label>
        <label>
          {t("Role list separator")}
          <select
            value={source.options.roleSeparator}
            onChange={(e) =>
              update({
                options: {
                  ...source.options,
                  roleSeparator: e.target.value as any,
                },
              })
            }
          >
            <option value="">{t("One role per cell or JSON list")}</option>
            <option value="|">|</option>
            <option value=";">;</option>
            <option value=",">,</option>
          </select>
        </label>
      </div>
      {statuses.length > 0 && (
        <details className="import-status-map">
          <summary>
            {t("Confirm status values, including approved time off")}
          </summary>
          <p>
            {t(
              "YES → available; NO → unavailable. Review every distinct source value. Unknown values require your decision.",
            )}
          </p>
          {statuses
            .slice(currentStatusPage * 20, currentStatusPage * 20 + 20)
            .map((v) => (
              <label key={v}>
                <code>{v}</code>
                <span>
                  {(() => {
                    try {
                      return `→ ${normalizeStatus(v, source.options.statusMap)}`;
                    } catch {
                      return t("Needs clarification");
                    }
                  })()}
                </span>
                <select
                  aria-label={`${t("Status meaning")} ${v}`}
                  value={source.options.statusMap[v] || ""}
                  onChange={(e) => {
                    const statusMap = { ...source.options.statusMap };
                    if (e.target.value) statusMap[v] = e.target.value as any;
                    else delete statusMap[v];
                    update({ options: { ...source.options, statusMap } });
                  }}
                >
                  <option value="">
                    {t("Use explicit recognized status only")}
                  </option>
                  <option value="available">{t("Available")}</option>
                  <option value="unavailable">{t("Unavailable")}</option>
                </select>
              </label>
            ))}
          {statuses.length > 20 && (
            <div className="import-pagination">
              <button
                className="btn"
                disabled={currentStatusPage === 0}
                onClick={() => setStatusPage(currentStatusPage - 1)}
              >
                {t("Previous")}
              </button>
              <span>
                {currentStatusPage + 1} / {Math.ceil(statuses.length / 20)}
              </span>
              <button
                className="btn"
                disabled={(currentStatusPage + 1) * 20 >= statuses.length}
                onClick={() => setStatusPage(currentStatusPage + 1)}
              >
                {t("Next")}
              </button>
            </div>
          )}
        </details>
      )}
      <label className="import-confirm">
        <input
          type="checkbox"
          checked={source.confirmed}
          disabled={
            source.parsed.issues.some((i) => i.severity === "error") ||
            !!mappingConflicts(source).length ||
            (source.kinds.length > 0 &&
              source.mappings.some((m) => m.state === "suggested"))
          }
          onChange={(e) => onChange({ ...source, confirmed: e.target.checked })}
        />
        {t(
          "I confirm the selected datasets and column meanings. Shift requirements represent demand, not assignments.",
        )}
      </label>
      <div className="import-profile-save">
        <input
          aria-label={t("Profile name")}
          placeholder={t("Profile name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn"
          disabled={
            !source.confirmed ||
            !name.trim() ||
            mappingProblems.some((i) => i.severity === "error")
          }
          onClick={() => onProfile(name)}
        >
          {t("Save mapping profile")}
        </button>
      </div>
    </section>
  );
}
