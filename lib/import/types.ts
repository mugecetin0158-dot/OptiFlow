export type Dataset = "employees" | "availability" | "shifts";
export const datasets: Dataset[] = ["employees", "availability", "shifts"];
export const schemas: Record<Dataset, string[]> = {
  employees: [
    "employee_id",
    "name",
    "hourly_rate",
    "max_weekly_hours",
    "roles",
  ],
  availability: ["employee_id", "date", "start_time", "end_time", "status"],
  shifts: [
    "shift_id",
    "date",
    "start_time",
    "end_time",
    "required_count",
    "required_role",
  ],
};
export const fields = [
  "employee_id",
  "name",
  "hourly_rate",
  "max_weekly_hours",
  "roles",
  "date",
  "start_time",
  "end_time",
  "status",
  "shift_id",
  "required_count",
  "required_role",
  "availability_date",
  "availability_start_time",
  "availability_end_time",
  "shift_date",
  "shift_start_time",
  "shift_end_time",
  "end_date",
  "availability_end_date",
  "shift_end_date",
] as const;
export type Field = (typeof fields)[number];
export type Mapping = {
  target: Field | "" | "ignore";
  state: "auto" | "suggested" | "confirmed" | "unmapped";
  reason: string;
  transform?: "direct" | "date" | "time" | "status" | "time_range";
  overnight?: "ask" | "next_day";
};
export type SourceRef = { fileId: string; file: string; row: number };
export type Issue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  dataset?: Dataset;
  record?: number;
  field?: string;
  source?: SourceRef;
  detail?: string;
};
export type ParsedCSV = {
  headers: string[];
  rows: string[][];
  lineNumbers: number[];
  delimiter: string;
  issues: Issue[];
};
export type Normalization = {
  dateOrder: "" | "DMY" | "MDY";
  decimal: "" | "dot" | "comma";
  roleSeparator: "" | "|" | ";" | ",";
  statusMap: Record<string, "available" | "unavailable">;
};
export type ImportSource = {
  id: string;
  name: string;
  text: string;
  originalText?: string;
  encoding: string;
  delimiter: string;
  parsed: ParsedCSV;
  mappings: Mapping[];
  kinds: Dataset[];
  confirmed: boolean;
  options: Normalization;
};
export type DraftRecord = {
  values: Record<string, string>;
  sources: SourceRef[];
  pending?: Record<string, string>;
};
export type ImportDraft = Record<Dataset, DraftRecord[]>;
export type EmployeeRecord = {
  employee_id: string;
  name: string;
  hourly_rate: number;
  max_weekly_hours: number;
  roles: string[];
};
export type AvailabilityRecord = {
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  end_date?: string;
  status: "available" | "unavailable";
};
export type ShiftRecord = {
  shift_id: string;
  date: string;
  start_time: string;
  end_time: string;
  end_date?: string;
  required_count: number;
  required_role: string;
};
export type StandardData = {
  employees: EmployeeRecord[];
  availability: AvailabilityRecord[];
  shifts: ShiftRecord[];
};
export type Rules = {
  minRestHours: string;
  maxShiftsPerWeek: string;
  maxWeeklyHours: string;
  timezone: string;
  currency: string;
  weekStart: string;
  closedWeekdays: number[];
  maxDailyHours: string;
  allowMultipleShifts: boolean | null;
  reviewed: boolean;
};
export const emptyRules: Rules = {
  minRestHours: "",
  maxShiftsPerWeek: "",
  maxWeeklyHours: "",
  timezone: "",
  currency: "",
  weekStart: "",
  closedWeekdays: [],
  maxDailyHours: "",
  allowMultipleShifts: null,
  reviewed: false,
};
export const emptyDraft = (): ImportDraft => ({
  employees: [],
  availability: [],
  shifts: [],
});
export type ImportProfile = {
  id: string;
  name: string;
  headers: string[];
  mappings: Mapping[];
  kinds: Dataset[];
  options: Normalization;
  updatedAt: string;
};
export type SavedImport = {
  version: 1;
  savedAt: string;
  data: StandardData;
  draft: ImportDraft;
  issues: Issue[];
  unmapped: { file: string; column: string; decision: string }[];
  rulesRevision: string;
  corrections?: {
    file: string;
    row: number;
    column: string;
    original: string;
    result: string;
    reason: string;
  }[];
};
export type Validation = {
  issues: Issue[];
  data: StandardData;
  valid: boolean;
};

// Required schemas stay compatible; end_date is an explicit optional extension.
export const previewFields = (kind: Dataset) =>
  kind === "employees" ? schemas[kind] : [...schemas[kind], "end_date"];
