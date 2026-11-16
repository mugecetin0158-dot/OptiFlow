import { Run } from "./types";
import { prepare, number } from "./model";
export function explain(run: Run): string[] {
  if (
    !run.verification?.verified ||
    !["OPTIMAL", "FEASIBLE"].includes(run.status)
  )
    return [];
  const r = run.verification,
    lines: string[] = [];
  if (run.input.objective === "cost")
    lines.push(
      `Objective = sum of allocation quantity × period unit cost = ${r.cost}.`,
    );
  if (run.input.objective === "net")
    lines.push(
      `Objective = gross output value ${r.value} − allocation cost ${r.cost} = ${r.objective}. Priorities do not multiply revenue.`,
    );
  const prepared = prepare(run.input).periods;
  if (
    run.input.objective === "output" ||
    run.input.objective === "legacy_value"
  ) {
    for (const [i, p] of r.periods.entries())
      for (const o of p.analysis.outputs) {
        const project = prepared[i].input.projects.find(
          (x) => x.id === o.project,
        )!;
        const weight =
          run.input.objective === "output"
            ? run.input.weights[o.project]
              ? number(run.input.weights[o.project])
              : 1
            : project.value! * project.priority;
        lines.push(
          `${p.id}/${o.project}: ${o.quantity} ${project.unit} × ${weight} objective units per output = ${o.quantity * weight}.`,
        );
      }
    lines.push(
      `Sum of output contributions = ${r.objective}. This objective is not monetary net value.`,
    );
  }
  const budget = run.input.budget;
  if (budget)
    lines.push(
      `Horizon budget: ${r.cost} used of ${budget}; remaining ${number(budget) - r.cost}.`,
    );
  const binding = r.checks.filter(
    (c) =>
      c.passed &&
      (c.id === "horizon_budget" || c.id.startsWith("horizon_")) &&
      ((c.lower !== null && Math.abs(c.actual - c.lower) <= 1e-6) ||
        (c.upper !== null && Math.abs(c.actual - c.upper) <= 1e-6)),
  );
  binding.forEach((c) =>
    lines.push(
      `Binding horizon constraint ${c.id}: activity ${c.actual}, lower ${c.lower ?? "none"}, upper ${c.upper ?? "none"}.`,
    ),
  );
  lines.push(
    "Binding means a bound is reached; it does not prove that relaxing it improves the objective. Compare verified scenarios to measure trade-offs.",
  );
  if (run.status === "FEASIBLE")
    lines.push(
      "The candidate passed feasibility checks; the solver has not proven this is the best possible objective.",
    );
  return lines;
}
