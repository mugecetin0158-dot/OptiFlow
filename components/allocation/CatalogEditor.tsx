"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Draft,
  Issue,
  Table,
  tables,
  columns,
} from "../../lib/allocation/types";
export type Translate = (s: string) => string;
export const titles: Record<Table, string> = {
  resources: "Resources",
  projects: "Projects",
  demands: "Resource demands",
  links: "Compatibility & limits",
};
export const fieldLabels: Record<string, string> = {
  resource_id: "Resource ID",
  project_id: "Project ID",
  name: "Name",
  resource_type: "Resource type",
  unit: "Resource unit",
  capacity: "Capacity",
  unit_cost: "Cost per resource unit",
  integer: "Whole units only",
  output_unit: "Output unit",
  minimum_output: "Minimum output",
  maximum_output: "Maximum output",
  unit_value: "Value per output",
  priority: "Priority weight (optional)",
  amount_per_output: "Resource units per output",
  compatible: "Compatible",
  minimum_allocation: "Minimum allocation",
  maximum_allocation: "Maximum allocation",
};
export function AllocationIssues({
  issues,
  t,
}: {
  issues: Issue[];
  t: Translate;
}) {
  return (
    <div className="import-issues" role="status">
      {issues.slice(0, 100).map((i, n) => (
        <div className={`import-issue ${i.severity}`} key={n}>
          <span
            className={`badge ${i.severity === "error" ? "issue-error" : "issue-warning"}`}
          >
            {t(i.severity === "error" ? "Error" : "Warning")}
          </span>
          <div>
            <strong>{t(i.message)}</strong>
            <small>
              {i.table && t(titles[i.table])}
              {i.record !== undefined && ` · ${i.record + 1}`}
              {i.field && ` · ${t(fieldLabels[i.field] || i.field)}`}
              {i.source && ` · ${i.source.file}:${i.source.row}`}
              {i.detail &&
                ` · ${
                  i.detail.includes(".")
                    ? (() => {
                        const [table, field] = i.detail.split(".");
                        return `${t(titles[table as Table] || table)} · ${t(fieldLabels[field] || field)}`;
                      })()
                    : t(i.detail)
                }`}
            </small>
          </div>
        </div>
      ))}
      {issues.length > 100 && (
        <p>
          {t("Showing the first 100 issues. Correct these and revalidate.")}
        </p>
      )}
    </div>
  );
}
export function AllocationSettings({
  draft,
  onChange,
  t,
  hideObjective = false,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  t: Translate;
  hideObjective?: boolean;
}) {
  const set = (field: string, value: string) =>
    onChange({ ...draft, settings: { ...draft.settings, [field]: value } });
  return (
    <section className="panel import-panel">
      <h3>{t("Allocation model")}</h3>
      <div className="allocation-settings import-form-grid">
        <label hidden={hideObjective}>
          {t("Objective")}
          <select
            value={draft.settings.mode}
            onChange={(e) => set("mode", e.target.value)}
          >
            <option value="cost">{t("Minimize cost")}</option>
            <option value="value">
              {t("Maximize priority-weighted value")}
            </option>
          </select>
        </label>
        <label hidden={hideObjective}>
          {t("Planning period")}
          <input
            placeholder={t("For example: November delivery plan")}
            value={draft.settings.period}
            onChange={(e) => set("period", e.target.value)}
          />
        </label>
        <label>
          {t("Business currency")}
          <input
            aria-label={t("Business currency")}
            placeholder="USD / EUR / TRY"
            maxLength={3}
            value={draft.settings.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        </label>
        <label>
          {t("Budget (blank = no budget limit)")}
          <input
            inputMode="decimal"
            value={draft.settings.budget}
            onChange={(e) => set("budget", e.target.value)}
          />
        </label>
      </div>
      <p className="footnote" hidden={hideObjective}>
        {t(
          draft.settings.mode === "cost"
            ? "Meet minimum outputs at minimum cost. Optional projects with zero minimum need not receive resources."
            : "Maximize value × priority × output. Costs are reported and obey the budget, but are not minimized in this objective.",
        )}
      </p>
    </section>
  );
}
export default function CatalogEditor({
  draft,
  onChange,
  issues,
  t,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  issues: Issue[];
  t: Translate;
}) {
  const [table, setTable] = useState<Table>("resources"),
    [page, setPage] = useState(0);
  const rows = draft.tables[table],
    current = Math.min(page, Math.max(0, Math.ceil(rows.length / 15) - 1));
  function edit(index: number, field: string, value: string) {
    const d = structuredClone(draft);
    d.tables[table][index].values[field] = value;
    delete d.tables[table][index].pending?.[field];
    onChange(d);
  }
  return (
    <section className="panel allocation-catalog">
      <div
        className="allocation-tabs"
        role="tablist"
        aria-label={t("Resource catalogs")}
      >
        {tables.map((k) => (
          <button
            role="tab"
            aria-selected={table === k}
            className={table === k ? "active" : ""}
            key={k}
            onClick={() => {
              setTable(k);
              setPage(0);
            }}
          >
            {t(titles[k])}
            <span>{draft.tables[k].length}</span>
          </button>
        ))}
      </div>
      <div className="import-table-heading">
        <div>
          <h3>{t(titles[table])}</h3>
          <p className="footnote">
            {t(
              table === "resources"
                ? "Capacities and costs apply to the same planning period. Resource type and unit must match demand exactly."
                : table === "projects"
                  ? "Set minimum and maximum outputs. Use whole units and maximum 1 for an indivisible project. Blank priority means weight 1."
                  : table === "demands"
                    ? "Each row is a positive resource requirement per one unit of project output."
                    : "Only explicit compatible links allow allocation. Limits are total quantities for this planning period, not per output.",
            )}
          </p>
        </div>
        <button
          className="btn"
          disabled={
            rows.length >=
            (table === "resources" || table === "projects"
              ? 50
              : table === "demands"
                ? 500
                : 2500)
          }
          onClick={() => {
            onChange({
              ...draft,
              tables: {
                ...draft.tables,
                [table]: [
                  ...rows,
                  {
                    values: Object.fromEntries(
                      columns[table].map((f) => [f, ""]),
                    ),
                    sources: [],
                  },
                ],
              },
            });
            setPage(Math.floor(rows.length / 15));
          }}
        >
          <Plus size={15} />
          {t("Add record")}
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {columns[table].map((f) => (
                <th key={f}>
                  {t(fieldLabels[f])}
                  <small className="source-line">{f}</small>
                </th>
              ))}
              <th>{t("Source")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * 15, current * 15 + 15).map((r, j) => {
              const index = current * 15 + j;
              return (
                <tr key={index}>
                  <td>{index + 1}</td>
                  {columns[table].map((f) => {
                    const bad = issues.filter(
                      (i) =>
                        i.table === table &&
                        i.record === index &&
                        (!i.field || i.field === f) &&
                        i.severity === "error",
                    );
                    const errorId = `allocation-${table}-${index}-${f}-error`;
                    return (
                      <td key={f}>
                        {f === "integer" || f === "compatible" ? (
                          <select
                            aria-label={`${t(titles[table])} ${index + 1} ${t(fieldLabels[f])}`}
                            aria-invalid={!!bad.length}
                            aria-describedby={bad.length ? errorId : undefined}
                            className={bad.length ? "invalid" : ""}
                            value={r.values[f] || ""}
                            onChange={(e) => edit(index, f, e.target.value)}
                          >
                            <option value="">{t("Choose explicitly")}</option>
                            {!["", "true", "false"].includes(r.values[f]) && (
                              <option value={r.values[f]}>{r.values[f]}</option>
                            )}
                            <option value="true">{t("Yes")}</option>
                            <option value="false">{t("No")}</option>
                          </select>
                        ) : (
                          <input
                            aria-label={`${t(titles[table])} ${index + 1} ${t(fieldLabels[f])}`}
                            aria-invalid={!!bad.length}
                            aria-describedby={bad.length ? errorId : undefined}
                            className={bad.length ? "invalid" : ""}
                            type={
                              [
                                "capacity",
                                "maximum_output",
                                "maximum_allocation",
                              ].includes(f)
                                ? "text"
                                : [
                                    "unit_cost",
                                    "minimum_output",
                                    "unit_value",
                                    "priority",
                                    "amount_per_output",
                                    "minimum_allocation",
                                  ].includes(f)
                                  ? "number"
                                  : "text"
                            }
                            inputMode={
                              [
                                "capacity",
                                "maximum_output",
                                "maximum_allocation",
                              ].includes(f)
                                ? "decimal"
                                : undefined
                            }
                            title={bad.map((i) => t(i.message)).join("\n")}
                            value={r.values[f] || ""}
                            onChange={(e) => edit(index, f, e.target.value)}
                          />
                        )}
                        {bad.length > 0 && (
                          <small className="field-error-text" id={errorId}>
                            {bad.map((issue) => t(issue.message)).join(" ")}
                          </small>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <small>
                      {r.sources.length
                        ? `${r.sources[0].file}:${r.sources[0].row}`
                        : t("Manual entry")}
                    </small>
                  </td>
                  <td>
                    <button
                      className="icon-btn danger"
                      aria-label={`${t("Remove record")} ${index + 1}`}
                      onClick={() =>
                        onChange({
                          ...draft,
                          tables: {
                            ...draft.tables,
                            [table]: rows.filter((_, i) => i !== index),
                          },
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={columns[table].length + 3}>
                  {t(
                    "No records. Add your own data or explicitly load the sample.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="footnote allocation-hint">
        {t(
          "Use decimal points in edited cells. Enter unlimited explicitly for unlimited capacity or upper limits; empty required cells are invalid.",
        )}
      </p>
      {rows.length > 15 && (
        <div className="import-pagination">
          <button
            className="btn"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {t("Previous")}
          </button>
          <span>
            {current + 1} / {Math.ceil(rows.length / 15)}
          </span>
          <button
            className="btn"
            disabled={(current + 1) * 15 >= rows.length}
            onClick={() => setPage(current + 1)}
          >
            {t("Next")}
          </button>
        </div>
      )}
    </section>
  );
}
