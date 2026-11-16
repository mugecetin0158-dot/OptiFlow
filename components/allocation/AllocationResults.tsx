"use client";
import { useState } from "react";
import { Input, SolveResult } from "../../lib/allocation/types";
import { Translate } from "./CatalogEditor";
import {
  exportAllocation,
  exportProjectOutputs,
} from "../../lib/allocation/storage";
import { downloadText } from "../smart-import/SmartImport";
export default function AllocationResults({
  input,
  result,
  t,
  jointSlice = false,
}: {
  input: Input;
  result: SolveResult | null;
  t: Translate;
  jointSlice?: boolean;
}) {
  const [bindingOnly, setBindingOnly] = useState(true);
  const number = (n: number) =>
    Number.isFinite(n) ? String(Number(n.toFixed(6))) : "—";
  if (!result)
    return (
      <section className="panel import-panel allocation-empty">
        <h3>{t("No allocation has been generated.")}</h3>
        <p>
          {t(
            "Validate your inputs and run the optimizer to see a real solution.",
          )}
        </p>
      </section>
    );
  const a = result.analysis;
  return (
    <div className="allocation-results">
      <section className="panel import-panel">
        <div className="section-heading">
          <h3>
            {t("Solver status")}:{" "}
            <span
              className={`badge ${result.status === "OPTIMAL" ? "green" : result.status === "FEASIBLE" ? "issue-warning" : "muted"}`}
            >
              {t(result.status)}
            </span>
          </h3>
          <small>
            {result.engine} · {number(result.seconds)}s
          </small>
        </div>
        {result.messages.map((m, i) => (
          <p className="notice info" key={i}>
            {t(m)}
          </p>
        ))}
        {a && <p>{t("All hard constraints passed independent validation.")}</p>}
      </section>
      {a && (
        <>
          <div className="import-summary-cards">
            <div className="metric" hidden={jointSlice}>
              <span>
                {t(
                  input.mode === "cost"
                    ? "Cost objective"
                    : "Priority-weighted value objective",
                )}
              </span>
              <strong>{number(a.objective)}</strong>
              <small>
                {input.currency}
                {input.mode === "value" ? ` · ${t("weighted")}` : ""}
              </small>
            </div>
            <div className="metric">
              <span>{t("Total resource cost")}</span>
              <strong>{number(a.cost)}</strong>
              <small>{input.currency}</small>
            </div>
            <div className="metric">
              <span>{t("Gross project value")}</span>
              <strong>{a.value === null ? "—" : number(a.value)}</strong>
              <small>{input.currency}</small>
            </div>
            <div className="metric">
              <span>{t("Binding constraints")}</span>
              <strong>{a.constraints.filter((c) => c.binding).length}</strong>
              <small>{t("Within numerical tolerance")}</small>
            </div>
          </div>
          <div className="allocation-toolbar" hidden={jointSlice}>
            <button
              className="btn"
              onClick={() =>
                downloadText(
                  "resource_allocations.csv",
                  exportAllocation(input, result),
                )
              }
            >
              {t("Export allocations CSV")}
            </button>
            <button
              className="btn"
              onClick={() =>
                downloadText(
                  "project_outputs.csv",
                  exportProjectOutputs(input, result),
                )
              }
            >
              {t("Export project outputs CSV")}
            </button>
          </div>
          <section className="panel import-panel">
            <h3>{t("Resource utilization")}</h3>
            <div className="allocation-utilization">
              {a.utilization.map((u) => (
                <div key={u.resource}>
                  <div>
                    <strong>
                      {input.resources.find((r) => r.id === u.resource)!.name}
                    </strong>
                    <span>
                      {number(u.used)} /{" "}
                      {u.capacity === null
                        ? t("Unlimited")
                        : number(u.capacity)}{" "}
                      {u.unit} ·{" "}
                      {u.percentage === null ? "—" : `${number(u.percentage)}%`}
                    </span>
                  </div>
                  <progress
                    aria-label={`${t("Resource utilization")} ${u.resource}`}
                    value={
                      u.percentage === null
                        ? 0
                        : Math.min(100, Math.max(0, u.percentage))
                    }
                    max={100}
                  />
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="import-table-heading">
              <h3>{t("Project outputs")}</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {[
                      "Project",
                      "Output",
                      "Output unit",
                      "Gross project value",
                    ].map((h) => (
                      <th key={h}>{t(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.outputs.map((o) => (
                    <tr key={o.project}>
                      <td>
                        {input.projects.find((p) => p.id === o.project)!.name}
                      </td>
                      <td>{number(o.quantity)}</td>
                      <td>
                        {input.projects.find((p) => p.id === o.project)!.unit}
                      </td>
                      <td>
                        {o.value === null
                          ? "—"
                          : `${number(o.value)} ${input.currency}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="import-table-heading">
              <h3>{t("Allocations")}</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {["Resource", "Project", "Quantity", "Unit", "Cost"].map(
                      (h) => (
                        <th key={h}>{t(h)}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {a.allocations
                    .filter((a) => Math.abs(a.quantity) > 1e-8)
                    .map((row, i) => (
                      <tr key={i}>
                        <td>
                          {
                            input.resources.find((r) => r.id === row.resource)!
                              .name
                          }
                        </td>
                        <td>
                          {
                            input.projects.find((p) => p.id === row.project)!
                              .name
                          }
                        </td>
                        <td>{number(row.quantity)}</td>
                        <td>{row.unit}</td>
                        <td>
                          {number(row.cost)} {input.currency}
                        </td>
                      </tr>
                    ))}
                  {!a.allocations.some((r) => Math.abs(r.quantity) > 1e-8) && (
                    <tr>
                      <td colSpan={5}>
                        {t("The valid solution allocates zero resources.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="import-table-heading">
              <div>
                <h3>{t("Constraint activity & slack")}</h3>
                <p className="footnote">
                  {t(
                    "Binding means zero slack; equalities always bind. This is not a shadow price or proof of scarcity.",
                  )}
                </p>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={bindingOnly}
                  onChange={(e) => setBindingOnly(e.target.checked)}
                />
                {t("Binding only")}
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {[
                      "Constraint",
                      "Reference",
                      "Activity",
                      "Lower bound",
                      "Upper bound",
                      "Slack",
                      "Unit",
                    ].map((h) => (
                      <th key={h}>{t(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.constraints
                    .filter((c) => !bindingOnly || c.binding)
                    .map((c) => (
                      <tr key={c.name}>
                        <td>{t(c.kind)}</td>
                        <td>{c.reference}</td>
                        <td>{number(c.activity)}</td>
                        <td>{c.lower === null ? "—" : number(c.lower)}</td>
                        <td>{c.upper === null ? "—" : number(c.upper)}</td>
                        <td>{number(c.slack)}</td>
                        <td>{c.unit}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
