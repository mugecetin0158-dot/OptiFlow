import { Input, SolveResult } from "./types";
import { validateInput } from "./validation";
import {
  buildAllocationModel,
  analyzeAllocation,
  detectableShortages,
} from "./model";
export function solverStatus(status: number, g: any): SolveResult["status"] {
  if (status === g.GLP_OPT) return "OPTIMAL";
  if (status === g.GLP_FEAS) return "FEASIBLE";
  if (status === g.GLP_NOFEAS) return "INFEASIBLE";
  if (status === g.GLP_UNBND) return "UNBOUNDED";
  return "UNKNOWN"; // GLP_INFEAS is an infeasible iterate, not a proof of model infeasibility.
}
export async function solveAllocation(p: Input, g: any): Promise<SolveResult> {
  const errors = validateInput(p).filter((i) => i.severity === "error");
  if (errors.length) throw Error(errors.map((i) => i.message).join("\n"));
  const start = performance.now(),
    model = buildAllocationModel(p, g);
  const engine = model.generals.length
    ? "GLPK · mixed-integer programming"
    : "GLPK · linear programming";
  // Simplex without presolve reports a definitive unbounded status for continuous LPs.
  const raw = await g.solve(model, {
    msglev: g.GLP_MSG_OFF,
    presol: model.generals.length > 0,
    mipgap: 0,
    tmlim: 20,
  });
  const status = solverStatus(raw.result.status, g),
    seconds = (performance.now() - start) / 1000;
  if (status === "OPTIMAL" || status === "FEASIBLE") {
    const analysis = analyzeAllocation(p, raw.result.vars);
    if (
      analysis.violations.length ||
      !Number.isFinite(raw.result.z) ||
      Math.abs(analysis.objective - raw.result.z) >
        1e-6 * Math.max(1, Math.abs(analysis.objective))
    )
      return {
        status: "ERROR",
        engine,
        seconds,
        messages: [
          "The solver result failed independent validation. No allocation was accepted.",
          ...analysis.violations,
        ],
      };
    return {
      status,
      engine,
      seconds,
      analysis,
      messages:
        status === "FEASIBLE"
          ? ["A valid allocation was found, but optimality was not proven."]
          : [],
    };
  }
  return {
    status,
    engine,
    seconds,
    messages:
      status === "INFEASIBLE"
        ? [
            "No allocation satisfies all hard constraints. Review minimum outputs, shared capacities, compatibility, allocation limits, integer requirements, and budget.",
            ...detectableShortages(p),
          ]
        : status === "UNBOUNDED"
          ? [
              "The objective has no finite optimum under these explicit limits. Add a finite capacity, output limit, or budget where the business requires one.",
            ]
          : [
              "The solver did not establish a usable solution or a definitive status. No allocation is displayed. Try a smaller or better-scaled model.",
            ],
  };
}
