import { Draft, Input, Analysis } from "../allocation/types";
export type Objective = "cost" | "output" | "net" | "legacy_value";
export type Period = { id: string; start: string; end: string; draft: Draft };
export type Policy = {
  kind: "renewable" | "consumable" | "legacy";
  carry: boolean;
  opening: string;
  receipts: Record<string, string>;
};
export type Plan = {
  version: 2;
  name: string;
  objective: Objective;
  periods: Period[];
  policies: Record<string, Policy>;
  weights: Record<string, string>;
  budget: string;
  outputBounds: Record<string, { min: string; max: string }>;
  seconds: number;
};
export type Check = {
  id: string;
  period: string;
  message: string;
  actual: number;
  lower: number | null;
  upper: number | null;
  passed: boolean;
  residual: number;
};
export type Report = {
  verified: boolean;
  checks: Check[];
  periods: {
    id: string;
    analysis: Analysis;
    stock: {
      resource: string;
      opening: number;
      receipts: number;
      consumed: number;
      closing: number;
      discarded: number;
    }[];
  }[];
  objective: number;
  cost: number;
  value: number | null;
  net: number | null;
};
export type Run = {
  id: string;
  scenarioId: string;
  revision: number;
  hash: string;
  input: Plan;
  createdAt: string;
  finishedAt?: string;
  status:
    | "running"
    | "OPTIMAL"
    | "FEASIBLE"
    | "INFEASIBLE"
    | "UNBOUNDED"
    | "UNKNOWN"
    | "ERROR"
    | "cancelled"
    | "interrupted";
  verification?: Report;
  variables?: Record<string, number>;
  solverObjective?: number;
  message?: string;
  versions: { model: string; verifier: string; solver: string };
  settings: { seconds: number; gap: number; tolerance: number };
};
export type Scenario = {
  id: string;
  revision: number;
  name: string;
  plan: Plan;
  updatedAt: string;
};
export const emptyPlan = (): Plan => ({
  version: 2,
  name: "Untitled scenario",
  objective: "cost",
  periods: [],
  policies: {},
  weights: {},
  budget: "",
  outputBounds: {},
  seconds: 20,
});
export const migrate = (draft: Draft): Plan => ({
  ...emptyPlan(),
  name: draft.settings.period || "Imported scenario",
  objective: draft.settings.mode === "value" ? "legacy_value" : "cost",
  periods: [
    { id: "period-1", start: "", end: "", draft: structuredClone(draft) },
  ],
  policies: Object.fromEntries(
    draft.tables.resources.map((r) => [
      r.values.resource_id,
      { kind: "legacy", carry: false, opening: "", receipts: {} },
    ]),
  ),
});
export type Prepared = { period: Period; input: Input };
