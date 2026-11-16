"use client";
import Workbench from "../planning/Workbench";
import { useEffect, useMemo, useRef, useState } from "react";
import { Layers, Play, Loader2, Upload, Save, RotateCcw } from "lucide-react";
import { Language, translate } from "../../lib/i18n";
import {
  Draft,
  Input,
  SolveResult,
  emptyDraft,
  tables,
} from "../../lib/allocation/types";
import { validateDraft } from "../../lib/allocation/validation";
import { sampleDraft } from "../../lib/allocation/sample";
import { loadAllocation, saveAllocation } from "../../lib/allocation/storage";
import { solveAllocation } from "../../lib/allocation/solver";
import { exportCatalog } from "../../lib/allocation/import";
import CatalogEditor, {
  AllocationSettings,
  AllocationIssues,
} from "./CatalogEditor";
import AllocationResults from "./AllocationResults";
import AllocationImport from "./AllocationImport";
import { downloadText } from "../smart-import/SmartImport";
export default function ResourceWorkspace({
  language,
  visible,
  importActive,
  onImport,
  onImported,
}: {
  language: Language;
  visible: boolean;
  importActive: boolean;
  onImport: () => void;
  onImported: () => void;
}) {
  const [legacyEditor, setLegacyEditor] = useState(false);
  const t = (s: string) => translate(language, s);
  const [draft, setDraft] = useState<Draft>(emptyDraft),
    [result, setResult] = useState<SolveResult | null>(null),
    [solvedInput, setSolvedInput] = useState<Input | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const revision = useRef(0),
    worker = useRef<any>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    try {
      const saved = loadAllocation(localStorage);
      if (saved) setDraft(saved);
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      alive.current = false;
      revision.current++;
      worker.current?.terminate?.();
    };
  }, []);
  const validation = useMemo(() => validateDraft(draft), [draft]);
  function change(next: Draft) {
    revision.current++;
    setDraft(next);
    setResult(null);
    setSolvedInput(null);
    setNotice("");
    setError("");
  }
  async function optimize() {
    if (!validation.valid || busy) return;
    const job = revision.current;
    setBusy(true);
    setResult(null);
    setSolvedInput(null);
    setError("");
    setNotice("");
    try {
      const GLPK = (await import("glpk.js")).default;
      const g = await GLPK();
      worker.current = g;
      try {
        const input = structuredClone(validation.input);
        const solved = await solveAllocation(input, g);
        if (alive.current && job === revision.current) {
          setResult(solved);
          setSolvedInput(input);
        } else if (alive.current)
          setNotice("Inputs changed during optimization. Run the model again.");
      } finally {
        (g as any).terminate?.();
        worker.current = null;
      }
    } catch (e) {
      if (alive.current && job === revision.current)
        setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function replace(next: Draft) {
    if (
      tables.some((table) => draft.tables[table].length) &&
      !window.confirm(t("Replace the current resource workspace?"))
    )
      return;
    change(next);
  }
  return (
    <div hidden={!visible} className="resource-workspace">
      <div hidden={!importActive}>
        <AllocationImport
          initialSettings={draft.settings}
          t={t}
          onConfirm={(next) => {
            saveAllocation(localStorage, next);
            change(next);
            setNotice(
              "Validated resource data saved locally. Run the optimizer to generate an allocation.",
            );
            onImported();
          }}
        />
      </div>
      <div hidden={importActive}>
        <button className="btn" onClick={() => setLegacyEditor(!legacyEditor)}>
          {legacyEditor
            ? "Open multi-period workspace"
            : "Open legacy single-period workspace"}
        </button>
        <div hidden={legacyEditor}>
          <Workbench incoming={draft} onImport={onImport} t={t} />
        </div>
      </div>
      <div hidden={importActive || !legacyEditor} className="smart-import">
        <section className="import-intro">
          <div className="import-intro-icon">
            <Layers size={28} />
          </div>
          <div>
            <span className="eyebrow">
              {t("OPTIFLOW v0.2 / RESOURCE ALLOCATION")}
            </span>
            <h2>{t("Turn capacity into a practical plan.")}</h2>
            <p>
              {t(
                "A real local LP/MILP solver. Explicit demands, hard limits, and independently checked results.",
              )}
            </p>
          </div>
          <span className="badge teal">
            {t(
              draft.origin === "sample"
                ? "Fictional sample data"
                : draft.origin === "import"
                  ? "Imported data"
                  : "Manual-entry workspace",
            )}
          </span>
        </section>
        <div className="allocation-toolbar">
          <button className="btn" onClick={() => replace(sampleDraft())}>
            <RotateCcw size={15} />
            {t("Load labeled sample")}
          </button>
          <button className="btn" onClick={() => replace(emptyDraft())}>
            {t("Start manual entry")}
          </button>
          <button className="btn" onClick={onImport}>
            <Upload size={15} />
            {t("Open Smart Import")}
          </button>
          <button
            className="btn"
            disabled={!validation.valid}
            onClick={() => {
              try {
                saveAllocation(localStorage, draft);
                setNotice("Resource data saved locally.");
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Save size={15} />
            {t("Save locally")}
          </button>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {t(error)}
          </div>
        )}
        {notice && (
          <div className="notice info" role="status">
            {t(notice)}
          </div>
        )}
        <AllocationSettings draft={draft} onChange={change} t={t} />
        <div className="notice info">
          {t(
            "Resources substitute only within an identical type and unit. Missing compatibility links prohibit allocation. No hard constraints are relaxed.",
          )}
        </div>
        <CatalogEditor
          draft={draft}
          onChange={change}
          issues={validation.issues}
          t={t}
        />
        <details className="panel import-panel" open={!validation.valid}>
          <summary>
            {t("Input validation")} ·{" "}
            {validation.issues.filter((i) => i.severity === "error").length}{" "}
            {t("errors")}
          </summary>
          <AllocationIssues issues={validation.issues} t={t} />
          {validation.valid && (
            <p>
              {t(
                "Inputs are valid. Feasibility and optimality still require a solver run.",
              )}
            </p>
          )}
        </details>
        <div className="allocation-toolbar">
          <button
            className="btn primary"
            disabled={!validation.valid || busy}
            onClick={optimize}
          >
            {busy ? <Loader2 className="spin" size={17} /> : <Play size={17} />}{" "}
            {t(busy ? "Optimizing…" : "Optimize resource allocation")}
          </button>
          <details>
            <summary>{t("Export input catalogs")}</summary>
            <div className="allocation-toolbar">
              {tables.map((table) => (
                <button
                  className="btn"
                  disabled={!validation.valid}
                  key={table}
                  onClick={() =>
                    downloadText(`${table}.csv`, exportCatalog(draft, table))
                  }
                >
                  {table}.csv
                </button>
              ))}
            </div>
          </details>
        </div>
        <AllocationResults
          input={solvedInput || validation.input}
          result={result}
          t={t}
        />
        <details className="panel import-panel">
          <summary>{t("Model, units & solver guarantees")}</summary>
          <p>
            {t(
              "All capacities, link limits, costs, and budgets refer to one planning period. Demand is resource units per unit of project output. Allocation equals demand × output for each project/type/unit.",
            )}
          </p>
          <p>
            {t(
              "Whole-unit resource allocations and project outputs use integer variables. Unlimited upper limits must be explicit. Priorities multiply value only; they never override hard constraints.",
            )}
          </p>
          <p>
            {t(
              "Optimal is shown only for GLPK_OPT with zero requested MIP gap. Feasible means validated but not proven optimal. Infeasible, unbounded, unknown, and failed validation never display an accepted allocation.",
            )}
          </p>
          <p>
            {t(
              "GLPK uses floating-point arithmetic: hard constraints and integrality are checked within 0.000001 units. Scale data sensibly. Browser data is local to this device and is not an automatic backup.",
            )}
          </p>
          <p>
            {t(
              "The solve limit is 20 seconds. Indeterminate mixed-integer models remain Unknown; an unbounded LP relaxation alone is not a proof about the integer model.",
            )}
          </p>
        </details>
      </div>
    </div>
  );
}
