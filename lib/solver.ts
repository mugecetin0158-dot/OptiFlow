import {
  Scenario,
  Result,
  inputErrors,
  shortages,
  minutes,
  overlap,
  analyze,
} from "./model";
export function buildModel(p: Scenario, g: any) {
  const vars = p.employees.flatMap((e, ei) =>
    p.shifts.map((s, si) => ({
      name: `x_${ei}_${si}`,
      coef: Math.round(e.wage * 100) * (minutes(s.end) - minutes(s.start)),
    })),
  );
  const subjectTo: any[] = [];
  p.shifts.forEach((s, si) =>
    subjectTo.push({
      name: `coverage_${si}`,
      vars: p.employees.map((_, ei) => ({ name: `x_${ei}_${si}`, coef: 1 })),
      bnds: { type: g.GLP_LO, lb: s.required, ub: 0 },
    }),
  );
  p.employees.forEach((e, ei) => {
    subjectTo.push({
      name: `hours_${ei}`,
      vars: p.shifts.map((s, si) => ({
        name: `x_${ei}_${si}`,
        coef: minutes(s.end) - minutes(s.start),
      })),
      bnds: { type: g.GLP_UP, lb: 0, ub: Math.round(e.maxHours * 60) },
    });
    p.shifts.forEach((s, si) => {
      if (!e.availability[si])
        subjectTo.push({
          name: `available_${ei}_${si}`,
          vars: [{ name: `x_${ei}_${si}`, coef: 1 }],
          bnds: { type: g.GLP_FX, lb: 0, ub: 0 },
        });
      p.shifts.forEach((t, ti) => {
        if (ti < si && overlap(s, t))
          subjectTo.push({
            name: `overlap_${ei}_${si}_${ti}`,
            vars: [
              { name: `x_${ei}_${si}`, coef: 1 },
              { name: `x_${ei}_${ti}`, coef: 1 },
            ],
            bnds: { type: g.GLP_UP, lb: 0, ub: 1 },
          });
      });
    });
  });
  return {
    name: "OptiFlow minimum labor cost",
    objective: { direction: g.GLP_MIN, name: "cost_cents_minutes", vars },
    subjectTo,
    binaries: vars.map((v) => v.name),
  };
}
export async function solve(p: Scenario, g: any): Promise<Result> {
  const start = performance.now();
  const errors = inputErrors(p);
  if (errors.length) throw new Error(errors.join("\n"));
  const messages = shortages(p);
  if (messages.length)
    return {
      status: "INFEASIBLE",
      assignments: [],
      seconds: 0,
      engine: "GLPK · integer programming",
      messages,
    };
  const raw = await g.solve(buildModel(p, g), {
    msglev: g.GLP_MSG_OFF,
    presol: true,
    mipgap: 0,
    tmlim: 20,
  });
  const status =
    raw.result.status === g.GLP_OPT
      ? "OPTIMAL"
      : raw.result.status === g.GLP_FEAS
        ? "FEASIBLE"
        : raw.result.status === g.GLP_NOFEAS
          ? "INFEASIBLE"
          : "UNKNOWN";
  const assignments =
    status === "OPTIMAL" || status === "FEASIBLE"
      ? p.shifts.map((_, si) =>
          p.employees
            .filter((_, ei) => raw.result.vars[`x_${ei}_${si}`] > 0.5)
            .map((e) => e.id),
        )
      : [];
  if (assignments.length && analyze(p, assignments).violations.length)
    throw new Error(
      "Solver result failed independent constraint validation. No schedule was accepted.",
    );
  return {
    status,
    assignments,
    seconds: (performance.now() - start) / 1000,
    engine: "GLPK · integer programming",
    messages:
      status === "INFEASIBLE"
        ? [
            "No assignment satisfies availability, coverage, overlapping shifts, and weekly hour limits together. Try increasing capacity or reducing demand.",
          ]
        : status === "UNKNOWN"
          ? [
              "The solver reached its limit without a usable solution. Reduce the problem size or adjust constraints.",
            ]
          : status === "FEASIBLE"
            ? [
                "A valid schedule was found, but optimality was not proven within the time limit.",
              ]
            : [],
  };
}
