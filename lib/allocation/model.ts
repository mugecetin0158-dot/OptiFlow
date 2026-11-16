import { Input, Analysis, Constraint } from "./types";
export const TOLERANCE = 1e-6;
export type LinearConstraint = {
  name: string;
  kind: string;
  reference: string;
  unit: string;
  terms: { name: string; coef: number }[];
  lower: number | null;
  upper: number | null;
};
export function formulation(p: Input) {
  const variables: {
    name: string;
    lower: number;
    upper: number | null;
    integer: boolean;
    cost: number;
    value: number;
  }[] = [];
  const constraints: LinearConstraint[] = [];
  p.projects.forEach((project, i) =>
    variables.push({
      name: `y_${i}`,
      lower: project.min,
      upper: project.max,
      integer: project.integer,
      cost: 0,
      value: (project.value || 0) * project.priority,
    }),
  );
  p.links.forEach((link, i) => {
    if (!link.compatible) return;
    const resource = p.resources.find((r) => r.id === link.resource)!;
    variables.push({
      name: `x_${i}`,
      lower: link.min,
      upper: link.max,
      integer: resource.integer,
      cost: resource.cost,
      value: 0,
    });
  });
  const termsFor = (test: (l: Input["links"][number]) => boolean) =>
    p.links.flatMap((l, i) =>
      l.compatible && test(l) ? [{ name: `x_${i}`, coef: 1 }] : [],
    );
  p.resources.forEach((r, i) => {
    if (r.capacity !== null)
      constraints.push({
        name: `capacity_${i}`,
        kind: "Resource capacity",
        reference: r.id,
        unit: r.unit,
        terms: termsFor((l) => l.resource === r.id),
        lower: null,
        upper: r.capacity,
      });
  });
  p.demands.forEach((d, i) => {
    const eligible = new Set(
      p.resources
        .filter((r) => r.type === d.type && r.unit === d.unit)
        .map((r) => r.id),
    );
    constraints.push({
      name: `demand_${i}`,
      kind: "Demand balance",
      reference: `${d.project} · ${d.type}`,
      unit: d.unit,
      terms: [
        ...termsFor((l) => l.project === d.project && eligible.has(l.resource)),
        {
          name: `y_${p.projects.findIndex((pr) => pr.id === d.project)}`,
          coef: -d.amount,
        },
      ],
      lower: 0,
      upper: 0,
    });
  });
  if (p.budget !== null)
    constraints.push({
      name: "budget",
      kind: "Budget",
      reference: p.currency,
      unit: p.currency,
      terms: variables
        .filter((v) => v.name.startsWith("x_"))
        .map((v) => ({ name: v.name, coef: v.cost })),
      lower: null,
      upper: p.budget,
    });
  return { variables, constraints };
}
export function buildAllocationModel(p: Input, g: any) {
  const { variables, constraints } = formulation(p);
  const bounds = (lower: number | null, upper: number | null) => ({
    type:
      lower === null
        ? g.GLP_UP
        : upper === null
          ? g.GLP_LO
          : lower === upper
            ? g.GLP_FX
            : g.GLP_DB,
    lb: lower ?? 0,
    ub: upper ?? 0,
  });
  return {
    name: "OptiFlow resource allocation",
    objective: {
      name: p.mode === "cost" ? "total_cost" : "priority_weighted_value",
      direction: p.mode === "cost" ? g.GLP_MIN : g.GLP_MAX,
      vars: variables.map((v) => ({
        name: v.name,
        coef: p.mode === "cost" ? v.cost : v.value,
      })),
    },
    subjectTo: [
      ...constraints.map((c) => ({
        name: c.name,
        vars: c.terms,
        bnds: bounds(c.lower, c.upper),
      })),
      ...variables.map((v) => ({
        name: `limit_${v.name}`,
        vars: [{ name: v.name, coef: 1 }],
        bnds: bounds(v.lower, v.upper),
      })),
    ],
    bounds: variables.map((v) => ({
      name: v.name,
      type: g.GLP_LO,
      lb: 0,
      ub: 0,
    })),
    generals: variables.filter((v) => v.integer).map((v) => v.name),
  };
}
// This checker evaluates the business constraints directly, not GLPK's row activities.
export function analyzeAllocation(
  p: Input,
  values: Record<string, number>,
): Analysis {
  const violations: string[] = [],
    constraints: Constraint[] = [];
  const value = (name: string) => {
    const n = values[name];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      violations.push(`Missing or nonfinite variable: ${name}`);
      return 0;
    }
    return n;
  };
  const bound = (
    name: string,
    kind: string,
    reference: string,
    unit: string,
    activity: number,
    lower: number | null,
    upper: number | null,
  ) => {
    if (
      !Number.isFinite(activity) ||
      (lower !== null && activity < lower - TOLERANCE) ||
      (upper !== null && activity > upper + TOLERANCE)
    )
      violations.push(`${kind}: ${reference}`);
    const slack = Math.min(
      lower === null ? Infinity : activity - lower,
      upper === null ? Infinity : upper - activity,
    );
    constraints.push({
      name,
      kind,
      reference,
      unit,
      activity,
      lower,
      upper,
      slack,
      binding: Math.abs(slack) <= TOLERANCE,
    });
  };
  const outputs = p.projects.map((project, i) => {
    const quantity = value(`y_${i}`);
    bound(
      `output_${i}`,
      "Project output",
      project.id,
      project.unit,
      quantity,
      project.min,
      project.max,
    );
    if (
      project.integer &&
      Math.abs(quantity - Math.round(quantity)) > TOLERANCE
    )
      violations.push(`Integer project output: ${project.id}`);
    return {
      project: project.id,
      quantity,
      value: project.value === null ? null : quantity * project.value,
      weightedValue:
        project.value === null
          ? null
          : quantity * project.value * project.priority,
    };
  });
  const allocations = p.links.flatMap((link, i) => {
    if (!link.compatible) {
      if (values[`x_${i}`] && Math.abs(values[`x_${i}`]) > TOLERANCE)
        violations.push(`Incompatible link: ${link.resource}/${link.project}`);
      return [];
    }
    const resource = p.resources.find((r) => r.id === link.resource)!;
    const quantity = value(`x_${i}`);
    bound(
      `link_${i}`,
      "Allocation limit",
      `${link.resource} → ${link.project}`,
      resource.unit,
      quantity,
      link.min,
      link.max,
    );
    if (
      resource.integer &&
      Math.abs(quantity - Math.round(quantity)) > TOLERANCE
    )
      violations.push(`Integer resource allocation: ${resource.id}`);
    return [
      {
        resource: link.resource,
        project: link.project,
        quantity,
        cost: quantity * resource.cost,
        unit: resource.unit,
      },
    ];
  });
  const utilization = p.resources.map((resource, i) => {
    const used = allocations
      .filter((a) => a.resource === resource.id)
      .reduce((sum, a) => sum + a.quantity, 0);
    if (resource.capacity !== null)
      bound(
        `capacity_${i}`,
        "Resource capacity",
        resource.id,
        resource.unit,
        used,
        null,
        resource.capacity,
      );
    return {
      resource: resource.id,
      used,
      capacity: resource.capacity,
      percentage:
        resource.capacity === null || resource.capacity === 0
          ? null
          : (used / resource.capacity) * 100,
      unit: resource.unit,
    };
  });
  p.demands.forEach((d, i) => {
    const resourceIds = new Set(
      p.resources
        .filter((r) => r.type === d.type && r.unit === d.unit)
        .map((r) => r.id),
    );
    const supplied = allocations
      .filter((a) => a.project === d.project && resourceIds.has(a.resource))
      .reduce((n, a) => n + a.quantity, 0);
    const required =
      d.amount * outputs.find((o) => o.project === d.project)!.quantity;
    bound(
      `demand_${i}`,
      "Demand balance",
      `${d.project} · ${d.type}`,
      d.unit,
      supplied,
      required,
      required,
    );
  });
  const cost = allocations.reduce((n, a) => n + a.cost, 0);
  const known = outputs.every((o) => o.value !== null);
  const totalValue = known ? outputs.reduce((n, o) => n + o.value!, 0) : null,
    weightedValue = known
      ? outputs.reduce((n, o) => n + o.weightedValue!, 0)
      : null;
  if (p.budget !== null)
    bound("budget", "Budget", p.currency, p.currency, cost, null, p.budget);
  const objective = p.mode === "cost" ? cost : weightedValue!;
  if (!Number.isFinite(objective)) violations.push("Nonfinite objective");
  return {
    allocations,
    outputs,
    utilization,
    constraints,
    violations,
    cost,
    value: totalValue,
    weightedValue,
    objective,
  };
}
export function detectableShortages(p: Input): string[] {
  const messages: string[] = [];
  for (const project of p.projects)
    for (const d of p.demands.filter((d) => d.project === project.id)) {
      const minimum = d.amount * project.min;
      let supply = 0;
      for (const l of p.links.filter(
        (l) => l.compatible && l.project === project.id,
      )) {
        const r = p.resources.find((r) => r.id === l.resource)!;
        if (r.type === d.type && r.unit === d.unit)
          supply += Math.min(r.capacity ?? Infinity, l.max ?? Infinity);
      }
      if (supply + TOLERANCE < minimum)
        messages.push(
          `${project.id} · ${d.type}: ${minimum} ${d.unit} required for minimum output; compatible capacity ≤ ${supply} ${d.unit}.`,
        );
    }
  return messages;
}
