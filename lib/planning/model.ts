import { Plan, Prepared, Check, Report } from "./types";
import { validateDraft } from "../allocation/validation";
import {
  buildAllocationModel,
  analyzeAllocation,
  TOLERANCE,
} from "../allocation/model";
import { validISO } from "../import/normalize";
export function number(s: string) {
  const n = /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
  return n <= 1e9 ? n : NaN;
}
export function prepare(plan: Plan): { errors: string[]; periods: Prepared[] } {
  const errors: string[] = [],
    periods: Prepared[] = [];
  if (plan.version !== 2 || !plan.name.trim())
    errors.push("A scenario name is required.");
  if (!["cost", "output", "net", "legacy_value"].includes(plan.objective))
    errors.push("Unknown objective.");
  if (!Number.isInteger(plan.seconds) || plan.seconds < 1 || plan.seconds > 120)
    errors.push("Solve limit must be 1–120 seconds.");
  if (!plan.periods.length || plan.periods.length > 24)
    errors.push("Use 1–24 periods.");
  const ids = new Set<string>();
  let previous = "";
  for (const p of plan.periods) {
    if (!p.id.trim() || ids.has(p.id))
      errors.push("Period IDs must be unique and nonempty.");
    ids.add(p.id);
    const legacySingle = plan.periods.length === 1 && !p.start && !p.end;
    if (
      !legacySingle &&
      (!validISO(p.start) ||
        !validISO(p.end) ||
        p.end < p.start ||
        p.start <= previous)
    )
      errors.push(`${p.id}: dates must be valid, ordered and non-overlapping.`);
    previous = p.end;
    const draft = structuredClone(p.draft);
    draft.settings.mode =
      plan.objective === "net" || plan.objective === "legacy_value"
        ? "value"
        : "cost";
    const v = validateDraft(draft);
    errors.push(
      ...v.issues
        .filter((i) => i.severity === "error")
        .map((i) => `${p.id}: ${i.field || i.table || ""} ${i.message}`),
    );
    periods.push({ period: p, input: v.input });
  }
  const resources = periods[0]?.input.resources || [],
    projects = periods[0]?.input.projects || [];
  for (const { period, input } of periods) {
    if (input.currency !== periods[0].input.currency)
      errors.push("All periods must use the same currency.");
    if (
      JSON.stringify(
        input.resources.map((r) => [r.id, r.type, r.unit, r.integer]).sort(),
      ) !==
      JSON.stringify(
        resources.map((r) => [r.id, r.type, r.unit, r.integer]).sort(),
      )
    )
      errors.push(
        `${period.id}: resource identities, units, types and integer flags must match across periods.`,
      );
    if (
      JSON.stringify(
        input.projects.map((p) => [p.id, p.unit, p.integer]).sort(),
      ) !==
      JSON.stringify(projects.map((p) => [p.id, p.unit, p.integer]).sort())
    )
      errors.push(
        `${period.id}: project identities, output units and integer flags must match across periods.`,
      );
  }
  for (const r of resources) {
    const policy = plan.policies[r.id];
    if (!policy || !["renewable", "consumable", "legacy"].includes(policy.kind))
      errors.push(`${r.id}: choose a resource kind.`);
    else if (policy.kind === "legacy" && periods.length > 1)
      errors.push(
        `${r.id}: classify this legacy resource before adding periods.`,
      );
    else if (policy.kind === "consumable") {
      if (typeof policy.carry !== "boolean")
        errors.push(`${r.id}: explicitly choose a carryover policy.`);
      if (!Number.isFinite(number(policy.opening)))
        errors.push(`${r.id}: explicit nonnegative opening stock is required.`);
      for (const p of plan.periods)
        if (!Number.isFinite(number(policy.receipts[p.id] || "")))
          errors.push(
            `${r.id}/${p.id}: explicit receipts (including zero) are required.`,
          );
    }
  }
  if (plan.objective === "output") {
    const mixed = new Set(projects.map((p) => p.unit)).size > 1;
    for (const p of projects) {
      const w = plan.weights[p.id];
      if ((mixed || w) && !(Number.isFinite(number(w)) && number(w) > 0))
        errors.push(
          `${p.id}: explicit positive output weight required for mixed units.`,
        );
    }
  }
  if (plan.budget && !Number.isFinite(number(plan.budget)))
    errors.push("Horizon budget must be nonnegative or blank.");
  for (const [id, b] of Object.entries(plan.outputBounds)) {
    if (!projects.some((p) => p.id === id))
      errors.push(`Unknown horizon project: ${id}`);
    if (
      (b.min && !Number.isFinite(number(b.min))) ||
      (b.max && !Number.isFinite(number(b.max))) ||
      (b.min && b.max && number(b.min) > number(b.max))
    )
      errors.push(`${id}: invalid horizon output bounds.`);
  }
  return { errors, periods };
}
export const key = (t: number, v: string) => `t${t}_${v}`;
export function build(plan: Plan, g: any) {
  const { errors, periods } = prepare(plan);
  if (errors.length) throw Error(errors.join("\n"));
  const lp: any = {
    name: "OptiFlow joint multi-period allocation",
    objective: {
      name: plan.objective,
      direction: plan.objective === "cost" ? g.GLP_MIN : g.GLP_MAX,
      vars: [],
    },
    subjectTo: [],
    bounds: [],
    generals: [],
  };
  const add = (
    name: string,
    vars: any[],
    lower: number | null,
    upper: number | null,
  ) =>
    lp.subjectTo.push({
      name,
      vars,
      bnds: {
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
      },
    });
  const costTerms: any[] = [],
    outputTerms: Record<string, any[]> = Object.create(null);
  periods.forEach(({ input }, t) => {
    const one = buildAllocationModel(input, g);
    lp.subjectTo.push(
      ...one.subjectTo.map((c) => ({
        ...c,
        name: key(t, c.name),
        vars: c.vars.map((v) => ({ ...v, name: key(t, v.name) })),
      })),
    );
    lp.bounds.push(...one.bounds.map((b) => ({ ...b, name: key(t, b.name) })));
    lp.generals.push(...one.generals.map((v) => key(t, v)));
    for (const v of one.objective.vars) {
      let coef = 0;
      if (v.name.startsWith("x_")) {
        const link = input.links[+v.name.slice(2)],
          r = input.resources.find((r) => r.id === link.resource)!;
        coef =
          plan.objective === "cost"
            ? r.cost
            : plan.objective === "net"
              ? -r.cost
              : 0;
        costTerms.push({ name: key(t, v.name), coef: r.cost });
      } else {
        const p = input.projects[+v.name.slice(2)];
        coef =
          plan.objective === "output"
            ? plan.weights[p.id]
              ? number(plan.weights[p.id])
              : 1
            : plan.objective === "net"
              ? p.value!
              : plan.objective === "legacy_value"
                ? p.value! * p.priority
                : 0;
        (outputTerms[p.id] ??= []).push({ name: key(t, v.name), coef: 1 });
      }
      lp.objective.vars.push({ name: key(t, v.name), coef });
    }
    input.resources.forEach((r, ri) => {
      const policy = plan.policies[r.id];
      if (policy.kind !== "consumable") return;
      const stock = key(t, `stock_${ri}`),
        discard = key(t, `discard_${ri}`);
      for (const name of [stock, discard]) {
        lp.bounds.push({ name, type: g.GLP_LO, lb: 0, ub: 0 });
        lp.objective.vars.push({ name, coef: 0 });
      }
      const consumed = input.links.flatMap((l, i) =>
        l.compatible && l.resource === r.id
          ? [{ name: key(t, `x_${i}`), coef: 1 }]
          : [],
      );
      const previousIndex = t
        ? periods[t - 1].input.resources.findIndex((prev) => prev.id === r.id)
        : ri;
      const rhs =
        number(policy.receipts[plan.periods[t].id]) +
        (t === 0 ? number(policy.opening) : 0);
      add(
        key(t, `inventory_${ri}`),
        [
          ...consumed,
          { name: stock, coef: 1 },
          { name: discard, coef: 1 },
          ...(t
            ? [{ name: key(t - 1, `stock_${previousIndex}`), coef: -1 }]
            : []),
        ],
        rhs,
        rhs,
      );
      add(
        key(t, "policy_" + ri),
        [{ name: policy.carry ? discard : stock, coef: 1 }],
        0,
        0,
      );
    });
  });
  if (plan.budget) add("horizon_budget", costTerms, null, number(plan.budget));
  for (const [id, b] of Object.entries(plan.outputBounds))
    if (b.min || b.max)
      add(
        `horizon_output_${Object.keys(outputTerms).indexOf(id)}`,
        outputTerms[id],
        b.min ? number(b.min) : 0,
        b.max ? number(b.max) : null,
      );
  return lp;
}
export function verify(
  plan: Plan,
  vars: Record<string, number>,
  solverObjective: number,
): Report {
  const prepared = prepare(plan);
  if (prepared.errors.length) throw Error(prepared.errors.join("\n"));
  const checks: Check[] = [],
    totals: Record<string, number> = Object.create(null);
  let cost = 0,
    value = 0,
    known = true,
    objective = 0;
  function check(
    id: string,
    period: string,
    message: string,
    actual: number,
    lower: number | null,
    upper: number | null,
    tolerance = TOLERANCE,
  ) {
    const residual = Math.max(
      lower === null ? 0 : lower - actual,
      upper === null ? 0 : actual - upper,
      0,
    );
    checks.push({
      id,
      period,
      message,
      actual,
      lower,
      upper,
      residual,
      passed: Number.isFinite(actual) && residual <= tolerance,
    });
  }
  const periods = prepared.periods.map(({ period, input }, t) => {
    const local: Record<string, number> = {};
    for (const [k, v] of Object.entries(vars))
      if (k.startsWith(`t${t}_`)) local[k.slice(`t${t}_`.length)] = v;
    input.links.forEach((l, i) => {
      if (!l.compatible && local[`x_${i}`] !== undefined)
        check(
          `compatibility_${i}`,
          period.id,
          "Incompatible allocation must be zero",
          local[`x_${i}`],
          0,
          0,
        );
    });
    const analysis = analyzeAllocation(input, local);
    analysis.constraints.forEach((c) =>
      check(c.name, period.id, c.kind, c.activity, c.lower, c.upper),
    );
    analysis.violations.forEach((v, i) =>
      check(`independent_${i}`, period.id, v, NaN, 0, 0),
    );
    cost += analysis.cost;
    if (analysis.value === null) known = false;
    else value += analysis.value;
    for (const o of analysis.outputs) {
      totals[o.project] = (totals[o.project] || 0) + o.quantity;
      const p = input.projects.find((p) => p.id === o.project)!;
      check(
        `integer_y_${p.id}`,
        period.id,
        "Project integrality",
        p.integer ? Math.abs(o.quantity - Math.round(o.quantity)) : 0,
        0,
        0,
      );
    }
    objective +=
      plan.objective === "cost"
        ? analysis.cost
        : plan.objective === "net"
          ? (analysis.value ?? NaN) - analysis.cost
          : plan.objective === "legacy_value"
            ? (analysis.weightedValue ?? NaN)
            : analysis.outputs.reduce(
                (n, o) =>
                  n +
                  o.quantity *
                    (plan.weights[o.project]
                      ? number(plan.weights[o.project])
                      : 1),
                0,
              );
    const stock = input.resources.flatMap((r, ri) => {
      const policy = plan.policies[r.id];
      if (policy.kind !== "consumable") return [];
      const prev = t
        ? prepared.periods[t - 1].input.resources.findIndex(
            (p) => p.id === r.id,
          )
        : ri;
      const opening = t
          ? vars[key(t - 1, `stock_${prev}`)]
          : number(policy.opening),
        receipts = number(policy.receipts[period.id]),
        consumed = analysis.utilization.find((u) => u.resource === r.id)!.used,
        closing = vars[key(t, `stock_${ri}`)],
        discarded = vars[key(t, `discard_${ri}`)];
      check(
        `stock_${ri}`,
        period.id,
        "Closing stock nonnegativity",
        closing,
        0,
        null,
      );
      check(
        `discard_${ri}`,
        period.id,
        "Discard nonnegativity",
        discarded,
        0,
        null,
      );
      check(
        `balance_${ri}`,
        period.id,
        "Inventory balance",
        opening + receipts - consumed - closing - discarded,
        0,
        0,
      );
      check(
        `policy_${ri}`,
        period.id,
        policy.carry ? "No unrequested disposal" : "No carryover",
        policy.carry ? discarded : closing,
        0,
        0,
      );
      return [
        { resource: r.id, opening, receipts, consumed, closing, discarded },
      ];
    });
    return { id: period.id, analysis, stock };
  });
  if (plan.budget)
    check(
      "horizon_budget",
      "",
      "Horizon budget",
      cost,
      null,
      number(plan.budget),
    );
  for (const [id, b] of Object.entries(plan.outputBounds))
    if (b.min || b.max)
      check(
        `horizon_${id}`,
        "",
        "Horizon output",
        totals[id],
        b.min ? number(b.min) : 0,
        b.max ? number(b.max) : null,
      );
  check(
    "objective",
    "",
    "Independently recomputed objective",
    solverObjective,
    objective,
    objective,
    1e-6 * Math.max(1, Math.abs(objective)),
  );
  return {
    verified: checks.every((c) => c.passed),
    checks,
    periods,
    objective,
    cost,
    value: known ? value : null,
    net: known ? value - cost : null,
  };
}
