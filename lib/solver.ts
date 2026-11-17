import {
  Scenario,
  Result,
  inputErrors,
  shortages,
  analyze,
  duration,
  intervalStart,
  intervalEnd,
} from "./model";
export function buildModel(p: Scenario, g: any) {
  const vars = p.employees.flatMap((e, ei) =>
    p.shifts.map((s, si) => ({
      name: `x_${ei}_${si}`,
      coef: e.wage * duration(s) * 60,
    })),
  );
  const subjectTo: any[] = [];
  p.shifts.forEach((s, si) => {
    subjectTo.push({
      name: `coverage_${si}`,
      vars: p.employees.map((_, ei) => ({ name: `x_${ei}_${si}`, coef: 1 })),
      bnds: { type: g.GLP_LO, lb: s.required, ub: 0 },
    });
  });
  p.employees.forEach((e, ei) => {
    subjectTo.push({
      name: `hours_${ei}`,
      vars: p.shifts.map((s, si) => ({
        name: `x_${ei}_${si}`,
        coef: duration(s) * 60,
      })),
      bnds: { type: g.GLP_UP, lb: 0, ub: e.maxHours * 60 },
    });
    p.shifts.forEach((s, si) => {
      if (!e.availability[si])
        subjectTo.push({
          name: `available_${ei}_${si}`,
          vars: [{ name: `x_${ei}_${si}`, coef: 1 }],
          bnds: { type: g.GLP_FX, lb: 0, ub: 0 },
        });
      if (s.requiredRole && !e.roles?.includes(s.requiredRole))
        subjectTo.push({
          name: `role_${ei}_${si}`,
          vars: [{ name: `x_${ei}_${si}`, coef: 1 }],
          bnds: { type: g.GLP_FX, lb: 0, ub: 0 },
        });
      p.shifts.forEach((t, ti) => {
        if (
          ti < si &&
          intervalStart(s) < intervalEnd(t) &&
          intervalStart(t) < intervalEnd(s)
        )
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
    if (p.constraints) {
      subjectTo.push({
        name: `shift_count_${ei}`,
        vars: p.shifts.map((_, si) => ({
          name: `x_${ei}_${si}`,
          coef: 1,
        })),
        bnds: {
          type: g.GLP_UP,
          lb: 0,
          ub: p.constraints.maxShiftsPerWeek,
        },
      });
      const byDay = new Map<number, number[]>();
      p.shifts.forEach((s, si) => {
        const group = byDay.get(s.day) || [];
        group.push(si);
        byDay.set(s.day, group);
      });
      if (!p.constraints.allowMultipleShifts)
        byDay.forEach((indices, day) =>
          subjectTo.push({
            name: `one_shift_${ei}_${day}`,
            vars: indices.map((si) => ({ name: `x_${ei}_${si}`, coef: 1 })),
            bnds: { type: g.GLP_UP, lb: 0, ub: 1 },
          }),
        );
      if (p.constraints.maxDailyHours !== null) {
        const dates = new Map<string, { shift: number; minutes: number }[]>();
        p.shifts.forEach((s, si) => {
          const daily = s.dailyMinutes || {
            [String(s.day)]: intervalEnd(s) - intervalStart(s),
          };
          Object.entries(daily).forEach(([date, value]) => {
            const group = dates.get(date) || [];
            group.push({ shift: si, minutes: value });
            dates.set(date, group);
          });
        });
        dates.forEach((entries, date) =>
          subjectTo.push({
            name: `daily_hours_${ei}_${date.replaceAll("-", "_")}`,
            vars: entries.map(({ shift, minutes: value }) => ({
              name: `x_${ei}_${shift}`,
              coef: value / 60,
            })),
            bnds: {
              type: g.GLP_UP,
              lb: 0,
              ub: p.constraints!.maxDailyHours!,
            },
          }),
        );
      }
      if (p.constraints.minRestMinutes > 0)
        p.shifts.forEach((s, si) =>
          p.shifts.forEach((t, ti) => {
            if (ti >= si) return;
            const gap =
              Math.max(intervalStart(s), intervalStart(t)) -
              Math.min(intervalEnd(s), intervalEnd(t));
            if (gap < p.constraints!.minRestMinutes)
              subjectTo.push({
                name: `rest_${ei}_${si}_${ti}`,
                vars: [
                  { name: `x_${ei}_${si}`, coef: 1 },
                  { name: `x_${ei}_${ti}`, coef: 1 },
                ],
                bnds: { type: g.GLP_UP, lb: 0, ub: 1 },
              });
          }),
        );
    }
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
      "The optimizer result failed independent constraint validation. No schedule was accepted.",
    );
  return {
    status,
    assignments,
    seconds: (performance.now() - start) / 1000,
    engine: "GLPK · integer programming",
    messages:
      status === "INFEASIBLE"
        ? [
            "No assignment satisfies role requirements, availability, coverage, rest periods, shift limits, and working-hour limits together. Review the imported constraints or staffing requirements.",
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
