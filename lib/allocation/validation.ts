import { Draft, Input, Issue, Table, tables, columns } from "./types";
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e9;
const text = (s: unknown): s is string =>
  typeof s === "string" && !!s.trim() && s.length <= 150;
export function validateInput(p: Input): Issue[] {
  const issues: Issue[] = [];
  const add = (
    message: string,
    table?: Table,
    record?: number,
    field?: string,
    detail?: string,
  ) =>
    issues.push({ severity: "error", message, table, record, field, detail });
  if (!["cost", "value"].includes(p.mode)) add("Choose a valid objective.");
  if (!text(p.period)) add("Enter a planning-period label.");
  try {
    if (
      !/^[A-Z]{3}$/.test(p.currency) ||
      !(Intl as any).supportedValuesOf("currency").includes(p.currency)
    )
      throw Error();
  } catch {
    add("Choose a supported ISO currency code.");
  }
  if (p.budget !== null && !finite(p.budget))
    add("Budget must be nonnegative, or explicitly unlimited.");
  if (!p.resources.length || p.resources.length > 50)
    add("Use between 1 and 50 resources.", "resources");
  if (!p.projects.length || p.projects.length > 50)
    add("Use between 1 and 50 projects.", "projects");
  if (p.demands.length > 500 || p.links.length > 2500)
    add("Use at most 500 demands and 2,500 compatibility links.");
  const ids = new Set<string>(),
    projects = new Set<string>();
  p.resources.forEach((r, i) => {
    if (!text(r.id) || ids.has(r.id))
      add(
        "Resource IDs must be nonempty and unique.",
        "resources",
        i,
        "resource_id",
      );
    ids.add(r.id);
    for (const [f, v] of [
      ["name", r.name],
      ["resource_type", r.type],
      ["unit", r.unit],
    ])
      if (!text(v))
        add(
          "A nonempty text value is required (maximum 150 characters).",
          "resources",
          i,
          f,
        );
    if (r.capacity !== null && !finite(r.capacity))
      add(
        "Capacity must be nonnegative or explicitly unlimited.",
        "resources",
        i,
        "capacity",
      );
    if (!finite(r.cost))
      add("Unit cost must be nonnegative.", "resources", i, "unit_cost");
    if (typeof r.integer !== "boolean")
      add(
        "Choose whether quantities must be whole numbers.",
        "resources",
        i,
        "integer",
      );
  });
  p.projects.forEach((r, i) => {
    if (!text(r.id) || projects.has(r.id))
      add(
        "Project IDs must be nonempty and unique.",
        "projects",
        i,
        "project_id",
      );
    projects.add(r.id);
    for (const [f, v] of [
      ["name", r.name],
      ["output_unit", r.unit],
    ])
      if (!text(v))
        add(
          "A nonempty text value is required (maximum 150 characters).",
          "projects",
          i,
          f,
        );
    if (!finite(r.min))
      add(
        "Minimum output must be nonnegative.",
        "projects",
        i,
        "minimum_output",
      );
    if (r.max !== null && (!finite(r.max) || r.max < r.min))
      add(
        "Maximum output must be at least the minimum, or explicitly unlimited.",
        "projects",
        i,
        "maximum_output",
      );
    if (
      (p.mode === "value" && r.value === null) ||
      (r.value !== null && !finite(r.value))
    )
      add(
        "Value maximization requires an explicit nonnegative value per output.",
        "projects",
        i,
        "unit_value",
      );
    if (!finite(r.priority) || r.priority <= 0)
      add(
        "Priority must be positive; blank means weight 1.",
        "projects",
        i,
        "priority",
      );
    if (
      r.value !== null &&
      Number.isFinite(r.value * r.priority) &&
      r.value * r.priority > 1e9
    )
      add(
        "Scale value and priority so their product is at most 1,000,000,000.",
        "projects",
        i,
        "priority",
      );
    if (typeof r.integer !== "boolean")
      add(
        "Choose whether quantities must be whole numbers.",
        "projects",
        i,
        "integer",
      );
    if (!p.demands.some((d) => d.project === r.id))
      add(
        "Every project needs at least one explicit resource demand.",
        "projects",
        i,
        "project_id",
      );
  });
  const seen = new Set<string>();
  p.demands.forEach((d, i) => {
    if (!projects.has(d.project))
      add("Demand references an unknown project.", "demands", i, "project_id");
    if (!text(d.type) || !text(d.unit))
      add("Demand type and unit are required.", "demands", i, "resource_type");
    if (!finite(d.amount) || d.amount <= 0)
      add(
        "Demand per output must be positive.",
        "demands",
        i,
        "amount_per_output",
      );
    const key = JSON.stringify([d.project, d.type, d.unit]);
    if (seen.has(key))
      add(
        "Duplicate demand for the same project, resource type, and unit.",
        "demands",
        i,
      );
    seen.add(key);
    // Different unit labels never imply an automatic conversion.
    if (p.resources.some((r) => r.type === d.type && r.unit !== d.unit))
      issues.push({
        severity: "warning",
        message:
          "Only exactly matching resource types and units can supply this demand. No unit conversion is applied.",
        table: "demands",
        record: i,
      });
  });
  const pairs = new Set<string>();
  p.links.forEach((l, i) => {
    const r = p.resources.find((r) => r.id === l.resource);
    if (!r)
      add("Link references an unknown resource.", "links", i, "resource_id");
    if (!projects.has(l.project))
      add("Link references an unknown project.", "links", i, "project_id");
    const key = JSON.stringify([l.resource, l.project]);
    if (pairs.has(key)) add("Duplicate resource-to-project link.", "links", i);
    pairs.add(key);
    if (typeof l.compatible !== "boolean")
      add("Explicit compatibility is required.", "links", i, "compatible");
    if (!finite(l.min))
      add(
        "Minimum allocation must be nonnegative.",
        "links",
        i,
        "minimum_allocation",
      );
    if (l.max !== null && (!finite(l.max) || l.max < l.min))
      add(
        "Maximum allocation must be at least the minimum, or explicitly unlimited.",
        "links",
        i,
        "maximum_allocation",
      );
    if (!l.compatible && l.min > 0)
      add(
        "An incompatible link cannot have a positive minimum allocation.",
        "links",
        i,
        "minimum_allocation",
      );
    if (
      l.compatible &&
      r &&
      !p.demands.some(
        (d) =>
          d.project === l.project && d.type === r.type && d.unit === r.unit,
      )
    )
      add(
        "Compatible links must match an explicit demand type and unit.",
        "links",
        i,
      );
  });
  return issues;
}
export function validateDraft(d: Draft): {
  input: Input;
  issues: Issue[];
  valid: boolean;
} {
  const issues: Issue[] = [];
  for (const table of tables)
    d.tables[table].forEach((row, record) => {
      for (const [field, message] of Object.entries(row.pending || {}))
        issues.push({
          severity: "error",
          message,
          table,
          record,
          field,
          source: row.sources[0],
        });
      for (const [field, value] of Object.entries(row.values))
        if (/^[=+@\-]/.test(value))
          issues.push({
            severity: "warning",
            message:
              "Spreadsheet formula-like text is preserved. Import exports as text in spreadsheet software.",
            table,
            record,
            field,
            source: row.sources[0],
          });
    });
  const num = (s: string | undefined) =>
    s !== undefined && /^\d+(?:\.\d+)?$/.test(s.trim()) ? Number(s) : NaN;
  const limit = (s: string | undefined) =>
    s?.trim().toLowerCase() === "unlimited" ? null : num(s);
  const bool = (s: string | undefined) =>
    s === "true"
      ? true
      : s === "false"
        ? false
        : (undefined as unknown as boolean);
  const rows = (table: Table) =>
    d.tables[table].map((r) =>
      Object.fromEntries(
        Object.entries(r.values).map(([k, v]) => [k, v.trim()]),
      ),
    );
  const input: Input = {
    mode: d.settings.mode,
    currency: d.settings.currency.trim(),
    period: d.settings.period.trim(),
    budget: d.settings.budget.trim() === "" ? null : num(d.settings.budget),
    resources: rows("resources").map((v) => ({
      id: v.resource_id,
      name: v.name,
      type: v.resource_type,
      unit: v.unit,
      capacity: limit(v.capacity),
      cost: num(v.unit_cost),
      integer: bool(v.integer),
    })),
    projects: rows("projects").map((v) => ({
      id: v.project_id,
      name: v.name,
      unit: v.output_unit,
      min: num(v.minimum_output),
      max: limit(v.maximum_output),
      value: !v.unit_value ? null : num(v.unit_value),
      priority: !v.priority ? 1 : num(v.priority),
      integer: bool(v.integer),
    })),
    demands: rows("demands").map((v) => ({
      project: v.project_id,
      type: v.resource_type,
      unit: v.unit,
      amount: num(v.amount_per_output),
    })),
    links: rows("links").map((v) => ({
      resource: v.resource_id,
      project: v.project_id,
      compatible: bool(v.compatible),
      min: num(v.minimum_allocation),
      max: limit(v.maximum_allocation),
    })),
  };
  issues.push(
    ...validateInput(input).map((i) => ({
      ...i,
      source:
        i.table && i.record !== undefined
          ? d.tables[i.table][i.record]?.sources[0]
          : undefined,
    })),
  );
  return { input, issues, valid: !issues.some((i) => i.severity === "error") };
}
export function toDraft(p: Input, origin: Draft["origin"] = "manual"): Draft {
  const str = (v: unknown) => (v === null ? "unlimited" : String(v));
  const row = (values: Record<string, string>) => ({ values, sources: [] });
  return {
    origin,
    settings: {
      mode: p.mode,
      currency: p.currency,
      period: p.period,
      budget: p.budget === null ? "" : String(p.budget),
    },
    tables: {
      resources: p.resources.map((r) =>
        row(
          Object.fromEntries(
            columns.resources.map((k, i) => [
              k,
              str(
                [r.id, r.name, r.type, r.unit, r.capacity, r.cost, r.integer][
                  i
                ],
              ),
            ]),
          ),
        ),
      ),
      projects: p.projects.map((r) =>
        row(
          Object.fromEntries(
            columns.projects.map((k, i) => [
              k,
              i === 5 && r.value === null
                ? ""
                : str(
                    [
                      r.id,
                      r.name,
                      r.unit,
                      r.min,
                      r.max,
                      r.value,
                      r.priority,
                      r.integer,
                    ][i],
                  ),
            ]),
          ),
        ),
      ),
      demands: p.demands.map((r) =>
        row(
          Object.fromEntries(
            columns.demands.map((k, i) => [
              k,
              str([r.project, r.type, r.unit, r.amount][i]),
            ]),
          ),
        ),
      ),
      links: p.links.map((r) =>
        row(
          Object.fromEntries(
            columns.links.map((k, i) => [
              k,
              str([r.resource, r.project, r.compatible, r.min, r.max][i]),
            ]),
          ),
        ),
      ),
    },
  };
}
