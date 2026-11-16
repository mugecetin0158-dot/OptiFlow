import { detectableShortages } from "../allocation/model";
import { Plan, Run } from "./types";
import { build, prepare, verify } from "./model";
import { solverStatus } from "../allocation/solver";
import { Repository, hashPlan } from "./history";
export type Progress = {
  phase: "preparing" | "solving" | "verifying";
  elapsed: number;
  observedObjective?: number;
};
export function startRun(
  plan: Plan,
  scenarioId: string,
  revision: number,
  repo: Repository,
  factory: () => Promise<any>,
  onProgress: (p: Progress) => void,
) {
  const snapshot = structuredClone(plan),
    id = crypto.randomUUID(),
    started = Date.now();
  let cancelled = false,
    stopped = false,
    g: any,
    timer: any,
    timeout: any,
    cancelReject: (e: Error) => void = () => {};
  const cancellation = new Promise<never>((_, reject) => {
    cancelReject = reject;
  });
  const work = (async () => {
    const errors = prepare(snapshot).errors;
    if (errors.length) throw Error(errors.join("\n"));
    const run: Run = {
      id,
      scenarioId,
      revision,
      hash: await hashPlan(snapshot),
      input: snapshot,
      createdAt: new Date().toISOString(),
      status: "running",
      versions: {
        model: "planning-2",
        verifier: "planning-2",
        solver: "GLPK 5.0 / glpk.js 4.0.2",
      },
      settings: { seconds: snapshot.seconds, gap: 0, tolerance: 1e-6 },
    };
    await repo.saveRun(run);
    let phase: Progress["phase"] = "preparing",
      observedObjective: number | undefined;
    timer = setInterval(
      () =>
        onProgress({
          phase,
          elapsed: (Date.now() - started) / 1000,
          observedObjective,
        }),
      200,
    );
    try {
      if (cancelled) throw Error("Cancelled");
      const initialization = factory().then((engine) => {
        if (cancelled || stopped) {
          engine.terminate?.();
          throw Error("Cancelled");
        }
        g = engine;
        return engine;
      });
      timeout = setTimeout(
        () => cancelReject(Error("Solver initialization timed out.")),
        15000,
      );
      await Promise.race([initialization, cancellation]);
      clearTimeout(timeout);
      if (cancelled) throw Error("Cancelled");
      phase = "solving";
      const lp = build(snapshot, g);
      timeout = setTimeout(
        () => {
          g?.terminate?.();
          cancelReject(Error("Worker exceeded its solve deadline."));
        },
        (snapshot.seconds + 5) * 1000,
      );
      const raw = await Promise.race([
        g.solve(lp, {
          msglev: g.GLP_MSG_OFF,
          presol: lp.generals.length > 0,
          tmlim: snapshot.seconds,
          mipgap: 0,
          ...(!lp.generals.length
            ? {
                cb: {
                  each: 50,
                  call: (r: any) => {
                    if (!cancelled && Number.isFinite(r.result?.z))
                      observedObjective = r.result.z;
                  },
                },
              }
            : {}),
        }),
        cancellation,
      ]);
      clearTimeout(timeout);
      phase = "verifying";
      onProgress({ phase, elapsed: (Date.now() - started) / 1000 });
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) throw Error("Cancelled");
      run.status = solverStatus(raw.result.status, g) as Run["status"];
      if (run.status === "INFEASIBLE")
        run.message = [
          "GLPK proved the joint model infeasible. No hard constraints were relaxed. Review period demand, compatibility, capacities, budgets and stock balances.",
          ...prepare(snapshot).periods.flatMap((p) =>
            detectableShortages(p.input).map((m) => `${p.period.id}: ${m}`),
          ),
        ].join("\n");
      else if (run.status === "UNBOUNDED")
        run.message =
          "GLPK proved the objective unbounded. Review unlimited capacities and output limits. No finite optimum is available.";
      else if (run.status === "UNKNOWN")
        run.message =
          "GLPK did not establish a usable solution status within this run. No recommendation is accepted.";
      if (run.status === "OPTIMAL" || run.status === "FEASIBLE") {
        run.variables = raw.result.vars;
        run.solverObjective = raw.result.z;
        run.verification = verify(snapshot, raw.result.vars, raw.result.z);
        if (!run.verification.verified) {
          run.status = "ERROR";
          run.message = "Independent verification rejected the candidate.";
        }
      }
    } catch (e) {
      run.status = cancelled ? "cancelled" : "ERROR";
      run.message = (e as Error).message;
      delete run.verification;
      delete run.variables;
    } finally {
      stopped = true;
      clearInterval(timer);
      clearTimeout(timeout);
      g?.terminate?.();
    }
    run.finishedAt = new Date().toISOString();
    await repo.saveRun(run);
    return run;
  })();
  // Attach a rejection handler immediately, including cancellation before persistence finishes.
  cancellation.catch(() => {});
  return {
    id,
    promise: work,
    cancel: () => {
      cancelled = true;
      g?.terminate?.();
      cancelReject(Error("Cancelled by user."));
    },
  };
}
