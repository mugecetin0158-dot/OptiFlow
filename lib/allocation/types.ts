import { DraftRecord, SourceRef } from "../import/types";
export const tables = ["resources", "projects", "demands", "links"] as const;
export type Table = (typeof tables)[number];
export const columns: Record<Table, string[]> = {
  resources: [
    "resource_id",
    "name",
    "resource_type",
    "unit",
    "capacity",
    "unit_cost",
    "integer",
  ],
  projects: [
    "project_id",
    "name",
    "output_unit",
    "minimum_output",
    "maximum_output",
    "unit_value",
    "priority",
    "integer",
  ],
  demands: ["project_id", "resource_type", "unit", "amount_per_output"],
  links: [
    "resource_id",
    "project_id",
    "compatible",
    "minimum_allocation",
    "maximum_allocation",
  ],
};
export type Settings = {
  mode: "cost" | "value";
  currency: string;
  period: string;
  budget: string;
};
export type Draft = {
  importContext?: {
    sources: {
      name: string;
      kind: string;
      headers: string[];
      rows: string[][];
      mappings: string[];
      decimal: string;
    }[];
  };
  settings: Settings;
  tables: Record<Table, DraftRecord[]>;
  origin: "manual" | "sample" | "import";
};
export const emptyDraft = (): Draft => ({
  settings: { mode: "cost", currency: "", period: "", budget: "" },
  tables: { resources: [], projects: [], demands: [], links: [] },
  origin: "manual",
});
export type Resource = {
  id: string;
  name: string;
  type: string;
  unit: string;
  capacity: number | null;
  cost: number;
  integer: boolean;
};
export type Project = {
  id: string;
  name: string;
  unit: string;
  min: number;
  max: number | null;
  value: number | null;
  priority: number;
  integer: boolean;
};
export type Demand = {
  project: string;
  type: string;
  unit: string;
  amount: number;
};
export type Link = {
  resource: string;
  project: string;
  compatible: boolean;
  min: number;
  max: number | null;
};
export type Input = {
  mode: "cost" | "value";
  currency: string;
  period: string;
  budget: number | null;
  resources: Resource[];
  projects: Project[];
  demands: Demand[];
  links: Link[];
};
export type Issue = {
  severity: "error" | "warning";
  message: string;
  table?: Table;
  record?: number;
  field?: string;
  source?: SourceRef;
  detail?: string;
};
export type Constraint = {
  name: string;
  kind: string;
  reference: string;
  unit: string;
  activity: number;
  lower: number | null;
  upper: number | null;
  slack: number;
  binding: boolean;
};
export type Analysis = {
  allocations: {
    resource: string;
    project: string;
    quantity: number;
    cost: number;
    unit: string;
  }[];
  outputs: {
    project: string;
    quantity: number;
    value: number | null;
    weightedValue: number | null;
  }[];
  utilization: {
    resource: string;
    used: number;
    capacity: number | null;
    percentage: number | null;
    unit: string;
  }[];
  constraints: Constraint[];
  violations: string[];
  cost: number;
  value: number | null;
  weightedValue: number | null;
  objective: number;
};
export type SolveResult = {
  status:
    "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNBOUNDED" | "UNKNOWN" | "ERROR";
  seconds: number;
  messages: string[];
  analysis?: Analysis;
  engine: string;
};
