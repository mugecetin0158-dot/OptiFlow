"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Draft } from "../../lib/allocation/types";
import { sampleDraft } from "../../lib/allocation/sample";
import { validateDraft } from "../../lib/allocation/validation";
import { toDraft } from "../../lib/allocation/validation";
import {
  Plan,
  Run,
  Scenario,
  migrate,
  emptyPlan,
} from "../../lib/planning/types";
import { explain } from "../../lib/planning/explain";
import { prepare, verify, number } from "../../lib/planning/model";
import {
  repository,
  hashPlan,
  recover,
  duplicate,
  comparison,
} from "../../lib/planning/history";
import { startRun, Progress } from "../../lib/planning/controller";
import {
  runSheets,
  sheetCSV,
  scenarioSheet,
  excel,
} from "../../lib/planning/export";
import CatalogEditor, { AllocationSettings } from "../allocation/CatalogEditor";
import AllocationResults from "../allocation/AllocationResults";
import { downloadText } from "../smart-import/SmartImport";
const id = () => crypto.randomUUID();
function downloadBinary(name: string, bytes: any) {
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Workbench({
  incoming,
  onImport,
  t,
}: {
  incoming: Draft;
  onImport: () => void;
  t: (s: string) => string;
}) {
  const [plan, setPlan] = useState<Plan>(() => migrate(incoming)),
    [selected, setSelected] = useState(0),
    [scenario, setScenario] = useState<Scenario | null>(null),
    [scenarios, setScenarios] = useState<Scenario[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [result, setResult] = useState<Run | null>(null),
    [progress, setProgress] = useState<Progress | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [compareIds, setCompareIds] = useState<string[]>([]),
    [step, setStep] = useState<"model" | "history" | "compare">("model");
  const job = useRef<ReturnType<typeof startRun> | null>(null),
    revision = useRef(0),
    launching = useRef(false),
    mounted = useRef(true),
    lastIncoming = useRef(incoming);
  async function refresh() {
    const [s, r] = await Promise.all([
      repository.listScenarios(),
      recover(repository),
    ]);
    if (mounted.current) {
      setScenarios(s);
      setRuns(r.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
  }
  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        await recover(repository);
        let s = await repository.listScenarios();
        const legacy = localStorage.getItem("optiflow-resource-allocation-v1");
        if (legacy && !s.some((x) => x.id === "legacy-allocation-v1")) {
          const draft = JSON.parse(legacy).draft;
          if (validateDraft(draft).valid) {
            const migrated: Scenario = {
              id: "legacy-allocation-v1",
              revision: 1,
              name: "Migrated single-period model",
              plan: migrate(draft),
              updatedAt: new Date().toISOString(),
            };
            await repository.saveScenario(migrated);
          }
        }
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      mounted.current = false;
      job.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (incoming === lastIncoming.current) return;
    lastIncoming.current = incoming;
    revision.current++;
    setResult(null);
    setPlan((old) => {
      if (!old.periods.length) return migrate(incoming);
      const next = structuredClone(old);
      next.periods[Math.min(selected, next.periods.length - 1)].draft =
        structuredClone(incoming);
      for (const r of incoming.tables.resources)
        if (!next.policies[r.values.resource_id])
          next.policies[r.values.resource_id] = {
            kind: "legacy",
            carry: false,
            opening: "",
            receipts: {},
          };
      return next;
    });
  }, [incoming]);
  const validation = useMemo(() => prepare(plan), [plan]),
    index = Math.min(selected, Math.max(0, plan.periods.length - 1)),
    period = plan.periods[index];
  function change(next: Plan) {
    revision.current++;
    setPlan(next);
    setResult(null);
    setNotice("");
  }
  function patch(values: Partial<Plan>) {
    change({ ...plan, ...values });
  }
  function periodPatch(values: any) {
    const next = structuredClone(plan);
    Object.assign(next.periods[index], values);
    change(next);
  }
  async function save(asNew = false) {
    const now = new Date().toISOString();
    const s: Scenario = {
      id: !asNew && scenario ? scenario.id : id(),
      revision: !asNew && scenario ? scenario.revision + 1 : 1,
      name: plan.name,
      plan: structuredClone(plan),
      updatedAt: now,
    };
    await repository.saveScenario(s);
    setScenario(s);
    await refresh();
    setNotice(
      "Scenario saved locally. Saving a draft does not establish feasibility.",
    );
    return s;
  }
  async function safely(fn: () => Promise<void>) {
    try {
      setError("");
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function solve() {
    if (validation.errors.length || launching.current) return;
    launching.current = true;
    const rev = revision.current;
    setProgress({ phase: "preparing", elapsed: 0 });
    await safely(async () => {
      try {
        const s = await save();
        setResult(null);
        const controller = startRun(
          plan,
          s.id,
          s.revision,
          repository,
          async () => {
            const GLPK = (await import("glpk.js")).default;
            return await GLPK();
          },
          (p) => {
            if (mounted.current) setProgress(p);
          },
        );
        job.current = controller;
        const run = await controller.promise;
        if (mounted.current) {
          if (revision.current === rev) setResult(run);
          else
            setNotice(
              "Inputs changed; the completed run is available in history for its original snapshot.",
            );
          await refresh();
        }
      } finally {
        job.current = null;
        launching.current = false;
        if (mounted.current) setProgress(null);
      }
    });
  }

  const comparisonRuns = compareIds
      .map((i) => runs.find((r) => r.id === i))
      .filter((r): r is Run => !!r),
    diff =
      comparisonRuns.length === 2
        ? comparison(comparisonRuns[0], comparisonRuns[1])
        : null;
  const resourceIds = [
      ...new Set(
        plan.periods
          .flatMap((p) =>
            p.draft.tables.resources.map((r) => r.values.resource_id),
          )
          .filter(Boolean),
      ),
    ],
    projectIds = [
      ...new Set(
        plan.periods
          .flatMap((p) =>
            p.draft.tables.projects.map((r) => r.values.project_id),
          )
          .filter(Boolean),
      ),
    ];
  return (
    <div className="smart-import planning-workbench">
      <section className="import-intro">
        <div>
          <span className="eyebrow">{t("JOINT MULTI-PERIOD PLANNING")}</span>
          <h2>{t("From spreadsheet to verified decisions")}</h2>
          <p>
            {t("One model across all periods. Explicit resource policies, immutable run snapshots, and independent verification.")}
          </p>
        </div>
      </section>
      <div className="allocation-toolbar">
        {(["model", "history", "compare"] as const).map((v) => (
          <button
            className={`btn ${step === v ? "primary" : ""}`}
            key={v}
            onClick={() => setStep(v)}
          >
            {v === "model"
              ? t("Model & constraints")
              : v === "history"
                ? t("Scenarios & run history")
                : t("Compare runs")}
          </button>
        ))}
        <a className="btn" href="/planning-catalog.xlsx" download>
          {t("Download fictional sample workbook")}
        </a>
        <button className="btn" onClick={onImport}>
          {t("Import CSV / Excel into selected period")}
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice info" role="status">
          {notice}
        </div>
      )}
      {progress && (
        <div className="notice info" role="status">
          {t(progress.phase)} · {progress.elapsed.toFixed(1)} {t("seconds")}{" "}
          {progress.observedObjective !== undefined &&
            ` · ${t("observed simplex objective")} ${progress.observedObjective} (${t("not a verified result")})`}
          <button
            className="btn"
            disabled={!job.current}
            onClick={() => job.current?.cancel()}
          >
            {t("Cancel optimization")}
          </button>
        </div>
      )}
      {step === "model" && (
        <>
          <section className="panel import-panel">
            <div className="allocation-toolbar">
              <label>
                {t("Scenario name")}
                <input
                  value={plan.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <button
                className="btn"
                onClick={() =>
                  safely(async () => {
                    await save();
                  })
                }
              >
                {t("Save scenario")}
              </button>
              <button
                className="btn"
                onClick={() =>
                  safely(async () => {
                    await save(true);
                  })
                }
              >
                {t("Save as new scenario")}
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (
                    window.confirm(
                      t("Replace the working model with a labeled fictional sample?"),
                    )
                  ) {
                    change(migrate(sampleDraft()));
                    setSelected(0);
                    setScenario(null);
                  }
                }}
              >
                {t("Load labeled sample")}
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (
                    window.confirm(
                      t("Start an empty model? Saved scenarios and runs remain available."),
                    )
                  ) {
                    change(emptyPlan());
                    setScenario(null);
                    setSelected(0);
                  }
                }}
              >
                {t("Start manual entry")}
              </button>
            </div>
            <div className="import-form-grid allocation-settings">
              <label>
                {t("Objective")}
                <select
                  value={plan.objective}
                  onChange={(e) =>
                    patch({ objective: e.target.value as Plan["objective"] })
                  }
                >
                  <option value="cost">{t("Minimize cost")}</option>
                  <option value="output">
                    {t("Maximize explicitly weighted output")}
                  </option>
                  <option value="net">
                    {t("Maximize net value (gross value − cost)")}
                  </option>
                  {plan.objective === "legacy_value" && (
                    <option value="legacy_value">
                      {t("Legacy priority-weighted value")}
                    </option>
                  )}
                </select>
              </label>
              <label>
                {t("Horizon budget (blank = no additional limit)")}
                <input
                  value={plan.budget}
                  onChange={(e) => patch({ budget: e.target.value })}
                />
              </label>
              <label>
                {t("Solve limit (1–120 seconds)")}
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={plan.seconds}
                  onChange={(e) => patch({ seconds: +e.target.value })}
                />
              </label>
            </div>
            <p>
              {t("Period costs are costs of consumption. Receipts are fixed inputs, not purchase decisions. Output weights are explicit unit conversions; priorities never change monetary net value.")}
            </p>
          </section>
          <section className="panel import-panel">
            <h3>{t("Planning periods")}</h3>
            <div className="allocation-toolbar">
              {plan.periods.map((p, i) => (
                <button
                  className={`btn ${index === i ? "primary" : ""}`}
                  key={i}
                  onClick={() => setSelected(i)}
                >
                  {p.id || `Period ${i + 1}`}
                </button>
              ))}
              <button
                className="btn"
                disabled={plan.periods.length >= 24}
                onClick={() => {
                  const blank = migrate({
                    ...incoming,
                    importContext: undefined,
                    tables: {
                      resources: [],
                      projects: [],
                      demands: [],
                      links: [],
                    },
                  }).periods[0];
                  blank.id = `period-${plan.periods.length + 1}`;
                  blank.draft.settings.period = blank.id;
                  patch({ periods: [...plan.periods, blank] });
                  setSelected(plan.periods.length);
                }}
              >
                Add empty period
              </button>
              {period && (
                <button
                  className="btn"
                  disabled={plan.periods.length >= 24}
                  onClick={() => {
                    const copy = structuredClone(period);
                    copy.id = `period-${plan.periods.length + 1}`;
                    copy.start = "";
                    copy.end = "";
                    copy.draft.settings.period = copy.id;
                    patch({ periods: [...plan.periods, copy] });
                    setSelected(plan.periods.length);
                  }}
                >
                  Explicitly copy selected period assumptions
                </button>
              )}
            </div>
            {period && (
              <div className="import-form-grid allocation-settings">
                <label>
                  Period ID
                  <input
                    value={period.id}
                    onChange={(e) => {
                      const next = structuredClone(plan),
                        old = period.id;
                      next.periods[index].id = e.target.value;
                      next.periods[index].draft.settings.period =
                        e.target.value;
                      for (const p of Object.values(next.policies)) {
                        if (old in p.receipts) {
                          p.receipts[e.target.value] = p.receipts[old];
                          delete p.receipts[old];
                        }
                      }
                      change(next);
                    }}
                  />
                </label>
                <label>
                  Start date
                  <input
                    type="date"
                    value={period.start}
                    onChange={(e) => periodPatch({ start: e.target.value })}
                  />
                </label>
                <label>
                  End date (inclusive)
                  <input
                    type="date"
                    value={period.end}
                    onChange={(e) => periodPatch({ end: e.target.value })}
                  />
                </label>
                <button
                  className="btn"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Remove this period from the working model?",
                      )
                    ) {
                      patch({
                        periods: plan.periods.filter((_, i) => i !== index),
                      });
                      setSelected(0);
                    }
                  }}
                >
                  Remove period
                </button>
              </div>
            )}
          </section>
          {period && (
            <>
              <AllocationSettings
                hideObjective
                draft={{
                  ...period.draft,
                  settings: {
                    ...period.draft.settings,
                    mode:
                      plan.objective === "net" ||
                      plan.objective === "legacy_value"
                        ? "value"
                        : "cost",
                  },
                }}
                onChange={(d) => periodPatch({ draft: d })}
                t={t}
              />
              <CatalogEditor
                draft={period.draft}
                onChange={(draft) => {
                  const next = structuredClone(plan);
                  next.periods[index].draft = draft;
                  for (const r of draft.tables.resources)
                    if (!next.policies[r.values.resource_id])
                      next.policies[r.values.resource_id] = {
                        kind: "legacy",
                        carry: false,
                        opening: "",
                        receipts: {},
                      };
                  change(next);
                }}
                issues={
                  validateDraft({
                    ...period.draft,
                    settings: {
                      ...period.draft.settings,
                      mode: plan.objective === "net" ? "value" : "cost",
                    },
                  }).issues
                }
                t={t}
              />
            </>
          )}
          <section className="panel import-panel">
            <h3>Resource renewal and consumable stock</h3>
            <p>
              No carryover is assumed. Consumable receipts must be entered
              explicitly, including zeros. With carryover disabled, unused stock
              is reported as discarded.
            </p>
            {resourceIds.map((r) => {
              const policy = plan.policies[r] || {
                kind: "legacy",
                carry: false,
                opening: "",
                receipts: {},
              };
              const edit = (v: any) =>
                patch({
                  policies: { ...plan.policies, [r]: { ...policy, ...v } },
                });
              return (
                <fieldset key={r}>
                  <legend>{r}</legend>
                  <div className="allocation-toolbar">
                    <label>
                      Resource kind
                      <select
                        value={policy.kind}
                        onChange={(e) => edit({ kind: e.target.value })}
                      >
                        <option value="legacy">
                          Unclassified legacy single-period supply
                        </option>
                        <option value="renewable">
                          Renewable capacity (resets each period)
                        </option>
                        <option value="consumable">Consumable inventory</option>
                      </select>
                    </label>
                    {policy.kind === "consumable" && (
                      <>
                        <label>
                          Opening stock
                          <input
                            value={policy.opening}
                            onChange={(e) => edit({ opening: e.target.value })}
                          />
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={policy.carry}
                            onChange={(e) => edit({ carry: e.target.checked })}
                          />
                          Explicitly enable carryover
                        </label>
                        {plan.periods.map((p) => (
                          <label key={p.id}>
                            {p.id} receipts
                            <input
                              value={policy.receipts[p.id] || ""}
                              onChange={(e) =>
                                edit({
                                  receipts: {
                                    ...policy.receipts,
                                    [p.id]: e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                </fieldset>
              );
            })}
          </section>
          <section className="panel import-panel">
            <h3>Project horizon constraints and output weights</h3>
            {projectIds.map((p) => (
              <div className="allocation-toolbar" key={p}>
                <strong>{p}</strong>
                <label>
                  Output weight
                  <input
                    value={plan.weights[p] || ""}
                    onChange={(e) =>
                      patch({
                        weights: { ...plan.weights, [p]: e.target.value },
                      })
                    }
                  />
                </label>
                {(["min", "max"] as const).map((k) => (
                  <label key={k}>
                    Horizon {k} (blank = none)
                    <input
                      value={plan.outputBounds[p]?.[k] || ""}
                      onChange={(e) =>
                        patch({
                          outputBounds: {
                            ...plan.outputBounds,
                            [p]: {
                              min: "",
                              max: "",
                              ...plan.outputBounds[p],
                              [k]: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
          </section>
          <section className="panel import-panel">
            <h3>Model validation</h3>
            {validation.errors.length ? (
              <ul>
                {validation.errors.slice(0, 100).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : (
              <p>
                Inputs are valid. Feasibility and optimality require a solver
                run.
              </p>
            )}
            <button
              className="btn primary"
              disabled={!!validation.errors.length || !!progress}
              onClick={solve}
            >
              Optimize all periods together
            </button>
          </section>
        </>
      )}
      {step === "history" && (
        <>
          <section className="panel import-panel">
            <h3>Saved scenarios</h3>
            {scenarios.map((s) => (
              <div className="allocation-toolbar" key={s.id}>
                <strong>{s.name}</strong>
                <span>revision {s.revision}</span>
                <button
                  className="btn"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Open this saved scenario and replace the working model?",
                      )
                    ) {
                      change(structuredClone(s.plan));
                      setScenario(s);
                      setSelected(0);
                      setStep("model");
                    }
                  }}
                >
                  Open / edit
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    safely(async () => {
                      await repository.saveScenario(duplicate(s));
                      await refresh();
                    })
                  }
                >
                  Duplicate
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    downloadText("scenario.csv", sheetCSV(scenarioSheet(s)))
                  }
                >
                  Export scenario CSV
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    safely(async () => {
                      if (
                        window.confirm(
                          "Delete this scenario? Historical runs keep their snapshots.",
                        )
                      ) {
                        await repository.deleteScenario(s.id);
                        await refresh();
                      }
                    })
                  }
                >
                  Delete
                </button>
              </div>
            ))}
          </section>
          <section className="panel import-panel">
            <h3>Immutable run history</h3>
            <button className="btn" onClick={() => safely(refresh)}>
              Refresh history
            </button>
            <p>
              Interrupted runs are identified after their worker deadline, so
              opening another tab does not invalidate a live run.
            </p>
            {runs.map((r) => (
              <div className="allocation-toolbar" key={r.id}>
                <span>
                  {r.createdAt} · {r.input.name} · {r.status} ·{" "}
                  {r.verification?.verified ? "verified" : "not verified"}
                </span>
                <button className="btn" onClick={() => setResult(r)}>
                  Inspect result
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    change(structuredClone(r.input));
                    setScenario(
                      scenarios.find((s) => s.id === r.scenarioId) || null,
                    );
                    setSelected(0);
                    setStep("model");
                    setNotice(
                      "Historical inputs restored. Run again to create a new immutable run.",
                    );
                  }}
                >
                  Reopen / rerun inputs
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    safely(async () => {
                      if (window.confirm("Delete this historical run?")) {
                        await repository.deleteRun(r.id);
                        await refresh();
                      }
                    })
                  }
                >
                  Delete run
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {step === "compare" && (
        <section className="panel import-panel">
          <h3>Compare two run snapshots</h3>
          {runs.map((r) => (
            <label className="import-confirm" key={r.id}>
              <input
                type="checkbox"
                checked={compareIds.includes(r.id)}
                disabled={!compareIds.includes(r.id) && compareIds.length >= 2}
                onChange={(e) =>
                  setCompareIds(
                    e.target.checked
                      ? [...compareIds, r.id]
                      : compareIds.filter((id) => id !== r.id),
                  )
                }
              />
              {r.input.name} · {r.createdAt} · {r.status}
            </label>
          ))}
          {diff && (
            <>
              <p>
                {diff.reasons.join(" ") ||
                  "Matching currency and horizon; cost comparison is available."}
              </p>
              <p>
                Cost difference: {diff.costDelta ?? "not comparable"} ·
                percentage:{" "}
                {diff.costPercent === null
                  ? "undefined"
                  : diff.costPercent.toFixed(2) + "%"}
              </p>
              <p>
                Differences describe changed assumptions and observed outcomes,
                not a proof of causality or savings.
              </p>
              <details>
                <summary>
                  Assumption differences ({diff.differences.length})
                </summary>
                {diff.differences.map((d, i) => (
                  <p key={i}>{d}</p>
                ))}
              </details>
              <button
                className="btn"
                onClick={() =>
                  downloadText(
                    "comparison.csv",
                    sheetCSV({
                      name: "Comparison",
                      headers: [
                        "baseline",
                        "alternative",
                        "cost_delta",
                        "cost_percent",
                        "limitations",
                        "assumption_differences",
                      ],
                      rows: [
                        [
                          comparisonRuns[0].id,
                          comparisonRuns[1].id,
                          String(diff.costDelta ?? ""),
                          String(diff.costPercent ?? ""),
                          diff.reasons.join("; "),
                          diff.differences.join("\n"),
                        ],
                      ],
                    }),
                  )
                }
              >
                Export comparison CSV
              </button>
              {comparisonRuns.map((r) => (
                <div key={r.id}>
                  <h4>{r.input.name}</h4>
                  <p>
                    Cost {r.verification?.cost ?? "—"} · gross value{" "}
                    {r.verification?.value ?? "—"} · net value{" "}
                    {r.verification?.net ?? "—"}
                  </p>
                  {r.verification?.periods.map((p) => (
                    <div key={p.id}>
                      <strong>{p.id}</strong>
                      <p>
                        Outputs:{" "}
                        {p.analysis.outputs
                          .map((o) => `${o.project}: ${o.quantity}`)
                          .join(" · ")}
                      </p>
                      <p>
                        Utilization:{" "}
                        {p.analysis.utilization
                          .map(
                            (u) =>
                              `${u.resource}: ${u.used} ${u.unit} / ${u.capacity ?? "unlimited"}`,
                          )
                          .join(" · ")}
                      </p>
                      <p>
                        Budget:{" "}
                        {r.input.periods.find((t) => t.id === p.id)?.draft
                          .settings.budget || "unlimited"}{" "}
                        · cost {p.analysis.cost}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      )}
      {result && (
        <section className="panel import-panel">
          <h3>Run {result.id}</h3>
          <p>
            Solver: {result.status} · Verification:{" "}
            {result.verification?.verified ? "passed" : "not verified"}
          </p>
          <p style={{ whiteSpace: "pre-line" }}>{result.message}</p>
          {explain(result).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          <p>
            Input hash: <code>{result.hash}</code>
          </p>
          <p>
            Objective: {result.input.objective} · verified value{" "}
            {result.verification?.verified
              ? result.verification.objective
              : "unavailable"}
          </p>
          <div className="allocation-toolbar">
            {runSheets(result).map((s) => (
              <button
                className="btn"
                key={s.name}
                onClick={() => downloadText(s.name + ".csv", sheetCSV(s))}
              >
                {s.name} CSV
              </button>
            ))}
            <button
              className="btn"
              onClick={() =>
                safely(async () =>
                  downloadBinary(
                    "optimization-run.xlsx",
                    await excel(runSheets(result)),
                  ),
                )
              }
            >
              Export Excel workbook
            </button>
            <button
              className="btn"
              disabled={!result.variables}
              onClick={async () => {
                try {
                  if ((await hashPlan(result.input)) !== result.hash)
                    throw Error(
                      "Input snapshot hash mismatch. The stored record is inconsistent.",
                    );
                  const report = verify(
                    result.input,
                    result.variables!,
                    result.solverObjective!,
                  );
                  setNotice(
                    `Independent recheck: ${report.verified ? "passed" : "failed"}. Original run record was not changed.`,
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Reverify snapshot
            </button>
          </div>
          {result.verification && (
            <details>
              <summary>
                Independent verification ({result.verification.checks.length}{" "}
                checks)
              </summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Period",
                        "Constraint",
                        "Actual",
                        "Lower",
                        "Upper",
                        "Residual",
                        "Passed",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.verification.checks.map((c, i) => (
                      <tr key={i}>
                        <td>{c.period}</td>
                        <td>
                          {c.message} · {c.id}
                        </td>
                        <td>{String(c.actual)}</td>
                        <td>{c.lower ?? "—"}</td>
                        <td>{c.upper ?? "—"}</td>
                        <td>{String(c.residual)}</td>
                        <td>{String(c.passed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {result.verification?.verified &&
            result.verification.periods.map((p, i) => (
              <div key={p.id}>
                <h3>{p.id}</h3>
                <AllocationResults
                  jointSlice
                  input={prepare(result.input).periods[i].input}
                  result={{
                    status: "FEASIBLE",
                    seconds: 0,
                    engine: "Period slice of joint GLPK solve",
                    messages: [
                      "Optimality, when proven, applies to the joint model; this period was not optimized separately.",
                    ],
                    analysis: p.analysis,
                  }}
                  t={t}
                />
                <p>
                  Verified allocation cost:{" "}
                  {p.analysis.allocations
                    .map(
                      (a) =>
                        `${a.quantity} ${a.unit} × ${a.quantity === 0 ? "unit cost from input" : a.cost / a.quantity} = ${a.cost}`,
                    )
                    .join(" + ")}
                  . Total: {p.analysis.cost}.
                </p>
                <p>
                  Unused renewable capacity:{" "}
                  {p.analysis.utilization
                    .filter(
                      (u) =>
                        result.input.policies[u.resource]?.kind !==
                        "consumable",
                    )
                    .map(
                      (u) =>
                        `${u.resource}: ${u.capacity === null ? "unlimited" : u.capacity - u.used} ${u.unit}`,
                    )
                    .join(" · ")}
                </p>
                {p.stock.map((s) => (
                  <p key={s.resource}>
                    {s.resource}: opening {s.opening} + receipts {s.receipts} −
                    consumption {s.consumed} = closing {s.closing} + discarded{" "}
                    {s.discarded}. Carryover{" "}
                    {result.input.policies[s.resource].carry
                      ? "enabled"
                      : "disabled"}
                    .
                  </p>
                ))}
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
