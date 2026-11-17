"use client";
import { useState } from "react";
import { FileSpreadsheet, ArrowRight } from "lucide-react";
import { SavedImport, Rules, Dataset } from "../../lib/import/types";
import { schedulingInput } from "../../lib/import/integration";
import { exportStandard } from "../../lib/import/storage";
import { analyze, Result } from "../../lib/model";
import { Language, locales } from "../../lib/i18n";
import { solve } from "../../lib/solver";
import { Translate } from "./RulesWizard";
import DataPreview, { IssueList, RuleSummary } from "./DataPreview";
import { downloadText } from "./SmartImport";
export default function ImportedSchedule({
  saved,
  rules,
  language,
  t,
  onReview,
}: {
  saved: SavedImport | null;
  rules: Rules | null;
  language: Language;
  t: Translate;
  onReview: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!saved || !rules)
    return (
      <div className="empty-state">
        <FileSpreadsheet size={36} />
        <h3>{t("Start with validated business data.")}</h3>
        <p>
          {t(
            "Import employee, availability, and staffing requirements before using imported-data mode.",
          )}
        </p>
        <button className="btn primary" onClick={onReview}>
          {t("Open Smart Import")}
          <ArrowRight size={16} />
        </button>
      </div>
    );
  let input: ReturnType<typeof schedulingInput>;
  try {
    input = schedulingInput(saved, rules);
  } catch (e) {
    return (
      <div className="notice error">
        {t((e as Error).message)}
        <button className="btn" onClick={onReview}>
          {t("Review import")}
        </button>
      </div>
    );
  }
  async function optimize() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const GLPK = (await import("glpk.js")).default;
      const glpk = await GLPK();
      try {
        setResult(await solve(input.scenario, glpk));
      } finally {
        (glpk as any).terminate?.();
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Optimization failed. Please review the imported data and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const summary =
    result?.assignments.length
      ? analyze(input.scenario, result.assignments)
      : null;
  const formatMoney = (value: number) =>
    new Intl.NumberFormat(locales[language], {
      style: "currency",
      currency: rules.currency,
      maximumFractionDigits: 2,
    }).format(value);
  const formatNumber = (value: number) =>
    new Intl.NumberFormat(locales[language], {
      maximumFractionDigits: 2,
    }).format(value);
  return (
    <div className="smart-import">
      <div className="import-intro">
        <FileSpreadsheet size={28} />
        <div>
          <span className="badge green">{t("Validated import")}</span>
          <h2>{t("Your data is available to Scheduling.")}</h2>
          <p>
            {result?.assignments.length
              ? t("The generated schedule satisfies the imported constraints within the planning period.")
              : t("Optimize the validated imported schedule using its reviewed rules.")}
          </p>
        </div>
        <button className="btn" onClick={onReview}>
          {t("Review import")}
        </button>
      </div>
      <div className="notice info imported-optimize">
        <div>
          <strong>{t("Imported schedule optimization")}</strong>
          <p>{t("Roles, availability windows, shift intervals, and reviewed rules are enforced by the optimizer.")}</p>
          <p>{t("Minimum-rest checks cover shifts in this seven-day plan only; no prior or following assignments were imported, so rest across the period boundary cannot be verified.")}</p>
        </div>
        <button className="btn primary" onClick={optimize} disabled={busy}>
          {t(busy ? "Optimizing…" : "Optimize imported schedule")}
        </button>
      </div>
      {error && <div className="notice error" role="alert">{t(error)}</div>}
      {result && (
        <div
          className={`notice ${result.status === "OPTIMAL" || result.status === "FEASIBLE" ? "success" : "error"}`}
          role="status"
        >
          <div>
            <strong>
              {t(
                result.status === "OPTIMAL"
                  ? "Optimal imported schedule generated"
                  : result.status === "FEASIBLE"
                    ? "Feasible imported schedule generated"
                    : result.status === "INFEASIBLE"
                      ? "No schedule satisfies the imported constraints"
                      : "The optimizer could not find a schedule",
              )}
            </strong>
            <p>{t(result.engine)} · {formatNumber(result.seconds)}{t("s")}</p>
            {result.messages.map((message) => <p key={message}>{t(message)}</p>)}
            {summary && (
              <p>
                {t("Scheduled labor cost")}: {formatMoney(summary.totalCost)}
                {" · "}
                {t("Scheduled hours")}: {formatNumber(summary.totalHours)}
              </p>
            )}
          </div>
        </div>
      )}
      {summary && (
        <section className="panel import-panel">
          <h3>{t("Generated schedule")}</h3>
          {input.scenario.shifts.map((shift, index) => {
            const names = (result?.assignments[index] || [])
              .map((employeeId) =>
                input.scenario.employees.find((employee) => employee.id === employeeId)?.name,
              )
              .filter((name): name is string => !!name);
            return (
              <div className="scenario" key={shift.id}>
                <div>
                  <strong>{shift.date} · {shift.start}–{shift.end}</strong>
                  <small>
                    {shift.requiredRole} · {names.length}/{shift.required} {t("assigned")}
                  </small>
                </div>
                <span>{names.length ? names.join(", ") : t("No assignments")}</span>
              </div>
            );
          })}
        </section>
      )}
      <div className="panel import-panel">
        <h3>{t("Scheduling rules summary")}</h3>
        <RuleSummary rules={rules} t={t} />
      </div>
      <DataPreview
        draft={saved.draft}
        issues={saved.issues}
        t={t}
        canExport
        onExport={(kind: Dataset) =>
          downloadText(`${kind}.csv`, exportStandard(input.data, kind))
        }
      />
      <details className="panel import-panel">
        <summary>
          {t("Saved validation notes")} ({saved.issues.length})
        </summary>
        <IssueList issues={saved.issues} t={t} />
      </details>
    </div>
  );
}
