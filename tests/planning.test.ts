import { test } from "node:test";
import assert from "node:assert/strict";
import GLPK from "glpk.js";
import { Plan, Run, Scenario, migrate } from "../lib/planning/types";
import { prepare, build, verify } from "../lib/planning/model";
import { toDraft } from "../lib/allocation/validation";
import { sampleDraft } from "../lib/allocation/sample";
import { startRun } from "../lib/planning/controller";
import {
  Repository,
  comparison,
  duplicate,
  hashPlan,
  recover,
} from "../lib/planning/history";
import { runSheets, sheetCSV, excel } from "../lib/planning/export";
import { parseCSV } from "../lib/import/csv";
const g = GLPK();
function plan(): Plan {
  const d = toDraft({
    mode: "cost",
    currency: "USD",
    period: "P1",
    budget: null,
    resources: [
      {
        id: "r",
        name: "Resource",
        type: "work",
        unit: "unit",
        capacity: 10,
        cost: 1,
        integer: false,
      },
    ],
    projects: [
      {
        id: "p",
        name: "Project",
        unit: "batch",
        min: 0,
        max: 10,
        value: 5,
        priority: 2,
        integer: false,
      },
    ],
    demands: [{ project: "p", type: "work", unit: "unit", amount: 1 }],
    links: [
      { resource: "r", project: "p", compatible: true, min: 0, max: null },
    ],
  });
  const p = migrate(d);
  p.periods[0] = { id: "P1", start: "2026-11-16", end: "2026-11-22", draft: d };
  p.policies.r = { kind: "renewable", carry: false, opening: "", receipts: {} };
  return p;
}
function two() {
  const p = plan();
  const second = structuredClone(p.periods[0]);
  second.id = "P2";
  second.start = "2026-11-23";
  second.end = "2026-11-29";
  second.draft.settings.period = "P2";
  second.draft.tables.resources[0].values.unit_cost = "4";
  p.periods.push(second);
  return p;
}
function solve(p: Plan) {
  const lp = build(p, g),
    raw = g.solve(lp, {
      presol: !!lp.generals.length,
      msglev: g.GLP_MSG_OFF,
      mipgap: 0,
    });
  return {
    raw,
    report:
      raw.result.status === g.GLP_OPT
        ? verify(p, raw.result.vars, raw.result.z)
        : null,
  };
}
function memory(): Repository {
  const scenarios = new Map<string, Scenario>(),
    runs = new Map<string, Run>();
  return {
    listScenarios: async () => structuredClone([...scenarios.values()]),
    listRuns: async () => structuredClone([...runs.values()]),
    saveScenario: async (s) => {
      scenarios.set(s.id, structuredClone(s));
    },
    saveRun: async (r) => {
      runs.set(r.id, structuredClone(r));
    },
    deleteScenario: async (id) => {
      scenarios.delete(id);
    },
    deleteRun: async (id) => {
      runs.delete(id);
    },
  };
}
test("legacy migration preserves the old single-period optimum and weighted objective", () => {
  const d = sampleDraft();
  assert.equal(solve(migrate(d)).report!.objective, 1380);
  d.settings.mode = "value";
  assert.equal(migrate(d).objective, "legacy_value");
  assert.equal(solve(migrate(d)).report!.objective, 11000);
});
test("joint horizon obligation allocates output to cheaper period rather than solving periods separately", () => {
  const p = two();
  p.outputBounds.p = { min: "12", max: "" };
  const { report } = solve(p);
  assert.equal(report!.objective, 18);
  assert.equal(report!.verified, true);
  assert.deepEqual(
    report!.periods.map((p) => p.analysis.outputs[0].quantity),
    [10, 2],
  );
});
test("renewable resources reset and budgets remain specific to each period", () => {
  const p = two();
  p.objective = "output";
  p.periods[0].draft.settings.budget = "2";
  p.periods[1].draft.settings.budget = "12";
  const r = solve(p).report!;
  assert.equal(r.objective, 5);
  assert.deepEqual(
    r.periods.map((p) => p.analysis.outputs[0].quantity),
    [2, 3],
  );
  p.budget = "10";
  assert.equal(solve(p).report!.objective, 4);
});
test("consumable carryover is explicit; stock cannot be spent twice", () => {
  const p = two();
  p.policies.r = {
    kind: "consumable",
    carry: false,
    opening: "2",
    receipts: { P1: "0", P2: "0" },
  };
  p.periods[1].draft.tables.projects[0].values.minimum_output = "2";
  assert.equal(solve(p).raw.result.status, g.GLP_NOFEAS);
  p.policies.r.carry = true;
  const r = solve(p).report!;
  assert.equal(r.verified, true);
  assert.equal(r.periods[0].stock[0].closing, 2);
  assert.equal(r.periods[1].stock[0].consumed, 2);
  assert.equal(r.periods[1].stock[0].closing, 0);
  p.periods[0].draft.tables.projects[0].values.minimum_output = "1";
  assert.equal(solve(p).raw.result.status, g.GLP_NOFEAS);
});
test("no carryover reports discarded stock instead of silently losing it", () => {
  const p = two();
  p.policies.r = {
    kind: "consumable",
    carry: false,
    opening: "5",
    receipts: { P1: "0", P2: "2" },
  };
  p.periods[0].draft.tables.projects[0].values.minimum_output = "1";
  const r = solve(p).report!;
  assert.equal(r.periods[0].stock[0].discarded, 4);
  assert.equal(r.periods[1].stock[0].opening, 0);
  assert.equal(r.periods[1].stock[0].discarded, 2);
});
test("net value is gross value minus consumption cost, never priority-weighted revenue", () => {
  const p = plan();
  p.objective = "net";
  const r = solve(p).report!;
  assert.equal(r.objective, 40);
  assert.equal(r.value, 50);
  assert.equal(r.cost, 10);
  assert.equal(r.net, 40);
  p.periods[0].draft.tables.resources[0].values.unit_cost = "6";
  assert.equal(solve(p).report!.objective, 0);
  p.periods[0].draft.tables.projects[0].values.minimum_output = "2";
  assert.equal(solve(p).report!.objective, -2);
});
test("mixed output units need explicit weights and missing period data blocks solving", () => {
  const p = two();
  const pr = structuredClone(p.periods[0].draft.tables.projects[0]);
  pr.values.project_id = "q";
  pr.values.output_unit = "contract";
  for (const period of p.periods) {
    period.draft.tables.projects.push(structuredClone(pr));
    const demand = structuredClone(period.draft.tables.demands[0]);
    demand.values.project_id = "q";
    period.draft.tables.demands.push(demand);
  }
  p.objective = "output";
  assert.ok(prepare(p).errors.some((e) => e.includes("weight")));
  p.weights = { p: "1", q: "2" };
  assert.deepEqual(prepare(p).errors, []);
  p.policies.r = {
    kind: "consumable",
    carry: true,
    opening: "",
    receipts: { P1: "0" },
  };
  assert.ok(prepare(p).errors.some((e) => e.includes("opening")));
  assert.ok(prepare(p).errors.some((e) => e.includes("P2")));
});
test("overlapping periods and unclassified legacy multi-period resources are rejected", () => {
  const p = two();
  p.periods[1].start = p.periods[0].end;
  assert.ok(prepare(p).errors.some((e) => e.includes("non-overlapping")));
  p.policies.r.kind = "legacy";
  assert.ok(prepare(p).errors.some((e) => e.includes("classify")));
});
test("independent verifier rejects objective, bounds, budgets, integrality and inventory corruption", () => {
  const p = two();
  p.objective = "output";
  for (const period of p.periods)
    period.draft.tables.resources[0].values.integer = "true";
  p.budget = "12";
  const { raw } = solve(p);
  assert.equal(verify(p, raw.result.vars, raw.result.z + 1).verified, false);
  for (const key of ["t0_x_0", "t0_y_0"]) {
    const values = { ...raw.result.vars, [key]: 100 };
    assert.equal(verify(p, values, raw.result.z).verified, false);
  }
  const fractional = { ...raw.result.vars, t0_x_0: 0.5, t0_y_0: 0.5 };
  assert.equal(verify(p, fractional, raw.result.z).verified, false);
  p.policies.r = {
    kind: "consumable",
    carry: true,
    opening: "2",
    receipts: { P1: "0", P2: "0" },
  };
  const r = solve(p).raw;
  assert.equal(
    verify(p, { ...r.result.vars, t0_stock_0: 999 }, r.result.z).verified,
    false,
  );
});
test("unbounded continuous horizon remains unbounded; no verifier result is fabricated", () => {
  const p = plan();
  p.objective = "net";
  p.periods[0].draft.tables.resources[0].values.capacity = "unlimited";
  p.periods[0].draft.tables.projects[0].values.maximum_output = "unlimited";
  assert.equal(solve(p).raw.result.status, g.GLP_UNBND);
});
test("immutable run snapshots, hashes, scenario duplication and recovery are reproducible", async () => {
  const repo = memory(),
    p = plan();
  const first = await startRun(
    p,
    "s",
    1,
    repo,
    async () => g,
    () => {},
  ).promise;
  assert.equal(first.status, "OPTIMAL");
  assert.equal(first.verification!.verified, true);
  p.name = "Edited";
  assert.notEqual(first.hash, await hashPlan(p));
  assert.equal(first.input.name, "P1");
  const s = { id: "s", revision: 1, name: "S", plan: p, updatedAt: "" };
  const copied = duplicate(s);
  copied.plan.periods[0].draft.tables.resources[0].values.capacity = "0";
  assert.equal(p.periods[0].draft.tables.resources[0].values.capacity, "10");
  await repo.saveRun({
    ...first,
    id: "interrupted",
    status: "running",
    createdAt: "2020-01-01T00:00:00Z",
  });
  assert.equal(
    (await recover(repo)).find((r) => r.id === "interrupted")!.status,
    "interrupted",
  );
});
test("cancel before initialization and during solve settles without an accepted result", async () => {
  for (const before of [true, false]) {
    const repo = memory();
    let resolveStarted!: () => void;
    const started = new Promise<void>((r) => (resolveStarted = r));
    let terminated = false;
    const fake = {
      ...g,
      terminate: () => {
        terminated = true;
      },
      solve: () => {
        resolveStarted();
        return new Promise(() => {});
      },
    };
    const job = startRun(
      plan(),
      "s",
      1,
      repo,
      async () => fake,
      () => {},
    );
    if (!before) await started;
    job.cancel();
    const r = await job.promise;
    assert.equal(r.status, "cancelled");
    assert.equal(r.verification, undefined);
    if (!before) assert.equal(terminated, true);
  }
});
test("cancellation during initialization terminates a late worker and does not overwrite history", async () => {
  const repo = memory();
  let release!: (g: any) => void;
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  let terminated = false;
  const job = startRun(
    plan(),
    "s",
    1,
    repo,
    () => {
      entered();
      return new Promise((r) => (release = r));
    },
    () => {},
  );
  await ready;
  job.cancel();
  assert.equal((await job.promise).status, "cancelled");
  release({
    ...g,
    terminate: () => {
      terminated = true;
    },
  });
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(terminated, true);
  assert.equal((await repo.listRuns())[0].status, "cancelled");
});
test("storage failures are not reported as successful saved runs", async () => {
  const repo = memory();
  repo.saveRun = async () => {
    throw Error("quota");
  };
  await assert.rejects(
    startRun(
      plan(),
      "s",
      1,
      repo,
      async () => g,
      () => {},
    ).promise,
    /quota/,
  );
});
test("comparisons suppress incompatible financial deltas and undefined percentages", async () => {
  const repo = memory();
  const a = await startRun(
      plan(),
      "s",
      1,
      repo,
      async () => g,
      () => {},
    ).promise,
    b = structuredClone(a);
  b.id = "b";
  assert.equal(comparison(a, b).costPercent, null);
  b.input.periods[0].draft.settings.currency = "EUR";
  assert.equal(comparison(a, b).costDelta, null);
  assert.ok(comparison(a, b).differences.length);
});
test("CSV and Excel exports include snapshots and verification and preserve text cells", async () => {
  const run = await startRun(
    plan(),
    "s",
    1,
    memory(),
    async () => g,
    () => {},
  ).promise;
  const sheets = runSheets(run);
  assert.ok(sheets.some((s) => s.name === "Verification"));
  for (const sheet of sheets)
    assert.equal(
      parseCSV(sheetCSV(sheet)).issues.filter(
        (i) => i.message !== "The file has headers but no records.",
      ).length,
      0,
    );
  const bytes = await excel([
    {
      name: "Text",
      headers: ["ID", "Name"],
      rows: [["001", '=HYPERLINK("x")']],
    },
  ]);
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.worksheets[0].getCell("A2").value, "001");
  assert.equal(workbook.worksheets[0].getCell("B2").value, '=HYPERLINK("x")');
  const failed = {
    ...run,
    status: "ERROR" as const,
    verification: { ...run.verification!, verified: false },
  };
  assert.ok(!runSheets(failed).some((s) => s.name === "Allocations"));
});
test("allocation profiles reuse normalized reordered headers, require reconfirmation and revalidate new values", async () => {
  const {
    createAllocationSource,
    recognizeAllocation,
    transformAllocationSources,
  } = await import("../lib/allocation/import");
  const { makeAllocationProfile, applyAllocationProfile } =
    await import("../lib/allocation/profiles");
  const { exportCatalog } = await import("../lib/allocation/import");
  const d = sampleDraft();
  let source = createAllocationSource(
    "a",
    "resources.csv",
    exportCatalog(d, "resources"),
  );
  source = {
    ...source,
    kind: "resources",
    confirmed: true,
    mappings: recognizeAllocation(source.parsed.headers, "resources"),
  };
  const profile = makeAllocationProfile(source, "Resource catalog");
  const reordered = {
    ...source,
    parsed: {
      ...source.parsed,
      headers: [...source.parsed.headers].reverse(),
      rows: source.parsed.rows.map((r) => [...r].reverse()),
    },
  };
  const applied = applyAllocationProfile(reordered, profile);
  assert.equal(applied.confirmed, false);
  assert.deepEqual(applied.mappings, [...source.mappings].reverse());
  assert.ok(
    transformAllocationSources([applied], d.settings).issues.some((i) =>
      i.message.includes("Confirm"),
    ),
  );
  applied.confirmed = true;
  const ci = applied.mappings.indexOf("capacity");
  applied.parsed.rows[0][ci] = "unknown";
  assert.ok(
    transformAllocationSources([applied], d.settings).draft.tables.resources[0]
      .pending?.capacity,
  );
  assert.throws(
    () =>
      applyAllocationProfile(
        { ...source, parsed: { ...source.parsed, headers: ["unexpected"] } },
        profile,
      ),
    /same source headers/,
  );
});
test("scheduling verification exports distinguish manual edits and reject violations", async () => {
  const { preset } = await import("../lib/model");
  const { schedulingSheets } = await import("../lib/planning/scheduling");
  const { default: demo } = await import("../lib/demo.json");
  const p = preset();
  const original = schedulingSheets(p, demo as any, false);
  assert.ok(
    original[0].rows.some(
      (r) => r[2] === "optimality" && r[3].startsWith("solver-proven"),
    ),
  );
  const manual = schedulingSheets(p, demo as any, true);
  assert.ok(manual[0].rows.every((r) => r[0] === "MANUAL_EDIT"));
  const invalid = { ...demo, assignments: demo.assignments.map(() => []) };
  assert.ok(
    schedulingSheets(p, invalid as any, true)[0].rows.every(
      (r) => r[1] === "failed",
    ),
  );
});
test("verified explanations reconstruct objective contributions and do not imply marginal savings", async () => {
  const { explain } = await import("../lib/planning/explain");
  const p = two();
  p.objective = "net";
  const r = await startRun(
    p,
    "s",
    1,
    memory(),
    async () => g,
    () => {},
  ).promise;
  assert.ok(
    explain(r).some((s) =>
      s.includes("gross output value 100 − allocation cost 50 = 50"),
    ),
  );
  assert.ok(explain({ ...r, status: "INFEASIBLE" }).length === 0);
  assert.ok(explain(r).some((s) => s.includes("does not prove")));
});
test("live runs in other tabs are not marked interrupted before their worker deadline", async () => {
  const repo = memory();
  const r = await startRun(
    plan(),
    "s",
    1,
    repo,
    async () => g,
    () => {},
  ).promise;
  await repo.saveRun({ ...r, status: "running" });
  assert.equal((await recover(repo))[0].status, "running");
});

test("exported input snapshots retain their canonical hash across JSON round-trips", async () => {
  const p = plan();
  p.periods[0].draft.importContext = undefined;
  assert.equal(
    await hashPlan(p),
    await hashPlan(JSON.parse(JSON.stringify(p))),
  );
});
