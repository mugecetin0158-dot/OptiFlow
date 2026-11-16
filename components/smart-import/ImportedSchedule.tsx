"use client";
import { FileSpreadsheet, ArrowRight } from "lucide-react";
import { SavedImport, Rules, Dataset } from "../../lib/import/types";
import { schedulingInput } from "../../lib/import/integration";
import { exportStandard } from "../../lib/import/storage";
import { Translate } from "./RulesWizard";
import DataPreview, { IssueList, RuleSummary } from "./DataPreview";
import { downloadText } from "./SmartImport";
export default function ImportedSchedule({
  saved,
  rules,
  t,
  onReview,
}: {
  saved: SavedImport | null;
  rules: Rules | null;
  t: Translate;
  onReview: () => void;
}) {
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
  return (
    <div className="smart-import">
      <div className="import-intro">
        <FileSpreadsheet size={28} />
        <div>
          <span className="badge green">{t("Validated import")}</span>
          <h2>{t("Your data is available to Scheduling.")}</h2>
          <p>{t("No schedule has been generated for this dataset.")}</p>
        </div>
        <button className="btn" onClick={onReview}>
          {t("Review import")}
        </button>
      </div>
      <div className="notice info">
        <div>
          <strong>{t("Optimizer connection required")}</strong>
          <p>{t(input.reason)}</p>
        </div>
      </div>
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
