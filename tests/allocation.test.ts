import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import GLPK from "glpk.js";
import { Input, emptyDraft, tables } from "../lib/allocation/types";
import { sampleInput, sampleDraft } from "../lib/allocation/sample";
import {
  validateDraft,
  validateInput,
  toDraft,
} from "../lib/allocation/validation";
import { solveAllocation, solverStatus } from "../lib/allocation/solver";
import {
  analyzeAllocation,
  buildAllocationModel,
} from "../lib/allocation/model";
import {
  createAllocationSource,
  recognizeAllocation,
  transformAllocationSources,
  exportCatalog,
  requiredColumns,
  preserveManualSettings,
} from "../lib/allocation/import";
import {
  saveAllocation,
  loadAllocation,
  ALLOCATION_KEY,
  exportAllocation,
  exportProjectOutputs,
} from "../lib/allocation/storage";
import { parseCSV } from "../lib/import/csv";
const g = GLPK();
function simple(): Input {
  return {
    mode: "value",
    currency: "USD",
    period: "Explicit test period",
    budget: null,
    resources: [
      {
        id: "001",
        name: "Resource",
        type: "labor",
        unit: "hour",
        capacity: 10,
        cost: 2,
        integer: false,
      },
    ],
    projects: [
      {
        id: "P",
        name: "Project",
        unit: "batch",
        min: 0,
        max: 10,
        value: 5,
        priority: 1,
        integer: false,
      },
    ],
    demands: [{ project: "P", type: "labor", unit: "hour", amount: 1 }],
    links: [
      { resource: "001", project: "P", compatible: true, min: 0, max: null },
    ],
  };
}
function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
test("sample cost optimum meets hard minimum outputs at exactly 1380", async () => {
  const p = sampleInput(),
    r = await solveAllocation(p, g);
  assert.equal(r.status, "OPTIMAL");
  assert.equal(r.analysis!.objective, 1380);
  assert.deepEqual(
    r.analysis!.outputs.map((o) => o.quantity),
    [1, 0],
  );
  assert.deepEqual(r.analysis!.violations, []);
  assert.equal(r.analysis!.value, 5000);
});
test("sample value optimum produces 11000 with explicit outputs and real utilization", async () => {
  const p = sampleInput();
  p.mode = "value";
  const r = await solveAllocation(p, g);
  assert.equal(r.status, "OPTIMAL");
  assert.equal(r.analysis!.objective, 11000);
  assert.deepEqual(
    r.analysis!.outputs.map((o) => o.quantity),
    [1, 3],
  );
  assert.equal(
    r.analysis!.utilization.find((u) => u.resource === "DES")!.percentage,
    100,
  );
  assert.ok(
    r.analysis!.constraints.some(
      (c) => c.name === "capacity_2" && c.binding && Math.abs(c.slack) < 1e-6,
    ),
  );
});
test("continuous outputs and integer resource or project domains produce different correct optima", async () => {
  const p = simple();
  p.resources[0].capacity = 2.5;
  assert.equal((await solveAllocation(p, g)).analysis!.objective, 12.5);
  p.resources[0].integer = true;
  assert.equal((await solveAllocation(p, g)).analysis!.objective, 10);
  p.resources[0].integer = false;
  p.projects[0].integer = true;
  assert.equal((await solveAllocation(p, g)).analysis!.objective, 10);
});
test("fractional limits on integer variables are not rounded into a silent relaxation", async () => {
  const p = simple();
  p.projects[0].integer = true;
  p.projects[0].min = 0.5;
  p.projects[0].max = 0.8;
  assert.equal((await solveAllocation(p, g)).status, "INFEASIBLE");
});
test("mixed-integer allocation agrees with exhaustive enumeration", async () => {
  for (let seed = 0; seed < 5; seed++) {
    const p = simple();
    p.resources = [
      { ...p.resources[0], capacity: 2 + (seed % 2), integer: true },
      { ...p.resources[0], id: "002", capacity: 2, cost: 3, integer: true },
    ];
    p.projects = [
      { ...p.projects[0], max: 3, integer: true },
      {
        ...p.projects[0],
        id: "Q",
        min: 1,
        max: 3,
        value: 7,
        priority: 1 + (seed % 2),
        integer: true,
      },
    ];
    p.demands = [p.demands[0], { ...p.demands[0], project: "Q" }];
    p.links = p.resources.flatMap((r) =>
      p.projects.map((pr) => ({
        resource: r.id,
        project: pr.id,
        compatible: true,
        min: 0,
        max: 2,
      })),
    );
    p.budget = 5 + seed;
    let best = -Infinity;
    for (let a = 0; a <= 2; a++)
      for (let b = 0; b <= 2; b++)
        for (let c = 0; c <= 2; c++)
          for (let d = 0; d <= 2; d++) {
            if (
              a + b > p.resources[0].capacity! ||
              c + d > 2 ||
              a + c > 3 ||
              b + d > 3 ||
              b + d < 1 ||
              2 * (a + b) + 3 * (c + d) > p.budget
            )
              continue;
            best = Math.max(
              best,
              5 * (a + c) + 7 * p.projects[1].priority * (b + d),
            );
          }
    const result = await solveAllocation(p, g);
    assert.equal(result.status, "OPTIMAL");
    assert.equal(result.analysis!.objective, best);
  }
});
test("shared capacity infeasibility is proved even when individual demands each fit", async () => {
  const p = simple();
  p.projects[0].min = 6;
  p.projects.push({ ...p.projects[0], id: "Q" });
  p.demands.push({ ...p.demands[0], project: "Q" });
  p.links.push({ ...p.links[0], project: "Q" });
  const r = await solveAllocation(p, g);
  assert.equal(r.status, "INFEASIBLE");
  assert.equal(r.analysis, undefined);
  assert.ok(r.messages[0].includes("hard constraints"));
});
test("missing compatibility prohibits allocations; shortages identify affected demand", async () => {
  const p = simple();
  p.projects[0].min = 1;
  p.links = [];
  const r = await solveAllocation(p, g);
  assert.equal(r.status, "INFEASIBLE");
  assert.ok(r.messages.some((m) => m.includes("compatible capacity ≤ 0")));
});
test("compatibility caps, exact type/unit matching, and budget are enforced", async () => {
  const p = simple();
  p.links[0].max = 3;
  assert.equal((await solveAllocation(p, g)).analysis!.objective, 15);
  p.budget = 4;
  assert.equal((await solveAllocation(p, g)).analysis!.objective, 10);
  p.projects[0].min = 3;
  assert.equal((await solveAllocation(p, g)).status, "INFEASIBLE");
  p.demands[0].unit = "minute";
  assert.ok(
    validateInput(p).some(
      (i) => i.severity === "error" && i.message.includes("match"),
    ),
  );
});
test("an explicit continuous unlimited model returns UNBOUNDED without a fabricated result", async () => {
  const p = simple();
  p.resources[0].capacity = null;
  p.projects[0].max = null;
  const r = await solveAllocation(p, g);
  assert.equal(r.status, "UNBOUNDED");
  assert.equal(r.analysis, undefined);
  assert.throws(() => exportAllocation(p, r));
  p.budget = 6;
  const bounded = await solveAllocation(p, g);
  assert.equal(bounded.status, "OPTIMAL");
  assert.equal(bounded.analysis!.objective, 15);
});
test("zero capacities, zero costs, zero values, and optional outputs are valid edge cases", async () => {
  const p = simple();
  p.resources[0].capacity = 0;
  const zero = await solveAllocation(p, g);
  assert.equal(zero.status, "OPTIMAL");
  assert.equal(zero.analysis!.objective, 0);
  assert.equal(zero.analysis!.utilization[0].percentage, null);
  p.resources[0].capacity = 10;
  p.resources[0].cost = 0;
  p.budget = 0;
  assert.equal((await solveAllocation(p, g)).analysis!.objective, 50);
  p.projects[0].value = 0;
  assert.equal((await solveAllocation(p, g)).analysis!.objective, 0);
});
test("priority weights change the chosen project and never override a hard minimum", async () => {
  const p = simple();
  p.projects = [
    { ...p.projects[0], min: 2 },
    { ...p.projects[0], id: "Q", value: 3, priority: 2 },
  ];
  p.demands.push({ ...p.demands[0], project: "Q" });
  p.links.push({ ...p.links[0], project: "Q" });
  const r = await solveAllocation(p, g);
  assert.deepEqual(
    r.analysis!.outputs.map((o) => o.quantity),
    [2, 8],
  );
  assert.equal(r.analysis!.weightedValue, 58);
  assert.equal(r.analysis!.value, 34);
});
test("invalid, empty, duplicate, missing-value and contradictory models cannot solve", async () => {
  assert.equal(validateDraft(emptyDraft()).valid, false);
  for (const change of [
    (p: Input) => {
      p.resources[0].capacity = NaN;
    },
    (p: Input) => {
      p.resources[0].cost = -1;
    },
    (p: Input) => {
      p.resources.push({ ...p.resources[0] });
    },
    (p: Input) => {
      p.demands.push({ ...p.demands[0] });
    },
    (p: Input) => {
      p.links[0].compatible = false;
      p.links[0].min = 1;
    },
    (p: Input) => {
      p.projects[0].value = null;
    },
    (p: Input) => {
      p.links[0].resource = "missing";
    },
    (p: Input) => {
      p.demands = [];
    },
  ]) {
    const p = simple();
    change(p);
    assert.ok(validateInput(p).some((i) => i.severity === "error"));
    await assert.rejects(() => solveAllocation(p, g));
  }
});
test("blank upper bounds never turn into unlimited, and zero is never treated as missing", () => {
  const d = toDraft(simple());
  d.tables.resources[0].values.capacity = "";
  assert.equal(validateDraft(d).valid, false);
  d.tables.resources[0].values.capacity = "unlimited";
  assert.equal(validateDraft(d).valid, true);
  d.tables.resources[0].values.capacity = "0";
  assert.equal(validateDraft(d).input.resources[0].capacity, 0);
});
test("import requirements follow the optimization schema's conditional and optional fields", () => {
  assert.deepEqual(requiredColumns("resources", "cost"), [
    "resource_id",
    "name",
    "resource_type",
    "unit",
    "unit_cost",
    "integer",
  ]);
  assert.ok(!requiredColumns("resources", "cost").includes("capacity"));
  assert.ok(!requiredColumns("projects", "cost").includes("unit_value"));
  assert.ok(requiredColumns("projects", "value").includes("unit_value"));
  assert.ok(!requiredColumns("projects", "cost").includes("maximum_output"));
  assert.ok(!requiredColumns("links", "cost").includes("maximum_allocation"));
  assert.deepEqual(requiredColumns("model_settings", "cost"), [
    "objective",
    "planning_period",
    "currency",
  ]);
});
test("model settings imports populate model settings, allow an omitted budget, and reject missing values", () => {
  const source = createAllocationSource(
    "settings",
    "optiflow_model_settings.csv",
    "objective,planning_period,currency\nmaximize_priority_weighted_value,Q4 plan,eur",
  );
  source.kind = "model_settings";
  source.mappings = recognizeAllocation(source.parsed.headers, "model_settings");
  source.confirmed = true;
  const initial = { ...simpleSettings(), budget: "500" };
  const transformed = transformAllocationSources([source], initial);
  assert.deepEqual(transformed.issues, []);
  assert.deepEqual(transformed.draft.settings, {
    mode: "value",
    currency: "EUR",
    period: "Q4 plan",
    budget: "500",
  });

  const budgetSource = createAllocationSource(
    "settings-with-budget",
    "optiflow_model_settings.csv",
    "objective,planning_period,currency,budget\ncost,Q4 plan,USD,",
  );
  budgetSource.kind = "model_settings";
  budgetSource.mappings = recognizeAllocation(
    budgetSource.parsed.headers,
    "model_settings",
  );
  budgetSource.confirmed = true;
  assert.equal(
    transformAllocationSources([budgetSource], initial).draft.settings.budget,
    "",
  );

  source.parsed.rows[0][0] = "";
  const missing = transformAllocationSources([source], initial);
  assert.ok(
    missing.issues.some(
      (issue) => issue.field === "objective" && issue.source?.row === 2,
    ),
  );
  source.parsed.rows[0][0] = "unknown";
  assert.ok(
    transformAllocationSources([source], initial).issues.some(
      (issue) => issue.field === "objective" && issue.message.includes("Choose"),
    ),
  );
});
test("refresh preserves manually corrected model settings but accepts changed imported settings", () => {
  const baseline = { mode: "cost" as const, currency: "USD", period: "Week 1", budget: "" };
  assert.deepEqual(
    preserveManualSettings(
      { ...baseline, period: "Corrected week" },
      baseline,
      { mode: "value", currency: "EUR", period: "Week 2", budget: "100" },
    ),
    { mode: "value", currency: "EUR", period: "Corrected week", budget: "100" },
  );
});
test("independent result validation rejects a solver candidate violating a hard constraint", async () => {
  const p = simple();
  const fake = {
    ...g,
    solve: () => ({
      result: { status: g.GLP_OPT, z: 500, vars: { y_0: 100, x_0: 100 } },
    }),
  };
  const r = await solveAllocation(p, fake);
  assert.equal(r.status, "ERROR");
  assert.equal(r.analysis, undefined);
  assert.ok(
    analyzeAllocation(p, { y_0: 1 }).violations.some((s) =>
      s.includes("Missing"),
    ),
  );
});
test("feasible, unknown, and infeasible-iterate statuses never become optimal claims", async () => {
  const p = simple();
  const feasible = await solveAllocation(p, {
    ...g,
    solve: () => ({
      result: { status: g.GLP_FEAS, z: 5, vars: { y_0: 1, x_0: 1 } },
    }),
  });
  assert.equal(feasible.status, "FEASIBLE");
  assert.match(feasible.messages[0], /not proven/);
  for (const status of [g.GLP_UNDEF, g.GLP_INFEAS, 999]) {
    assert.equal(solverStatus(status, g), "UNKNOWN");
    const r = await solveAllocation(p, {
      ...g,
      solve: () => ({ result: { status, z: 0, vars: {} } }),
    });
    assert.equal(r.analysis, undefined);
  }
});
test("CSV aliases are deterministic and ambiguous or unrelated columns stay unmapped", () => {
  assert.deepEqual(
    recognizeAllocation(
      [
        "Resource Code",
        "Available Capacity",
        "Cost per Unit",
        "Rate",
        "Payroll Notes",
      ],
      "resources",
    ),
    ["resource_id", "capacity", "unit_cost", "", ""],
  );
  const s = createAllocationSource("s", "unknown.csv", "Monday,Rate\n9-5,12");
  assert.equal(s.kind, "");
  assert.ok(
    transformAllocationSources([s], emptyDraft().settings).issues.some(
      (i) => i.severity === "error",
    ),
  );
});
function sourceFor(table: (typeof tables)[number], text: string) {
  const s = createAllocationSource(table, `${table}.csv`, text);
  s.kind = table;
  s.mappings = recognizeAllocation(s.parsed.headers, table);
  s.decimal = "dot";
  s.confirmed = true;
  return s;
}
test("four CSV fixtures flow through Smart Import, persistence, actual optimization, and export", async () => {
  const sources = tables.map((t) =>
    sourceFor(t, readFileSync(`tests/fixtures/allocation/${t}.csv`, "utf8")),
  );
  const result = transformAllocationSources(sources, sampleDraft().settings);
  assert.deepEqual(result.issues, []);
  const v = validateDraft(result.draft);
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.equal(result.draft.tables.resources[0].sources[0].row, 2);
  const store = memory();
  store.setItem("optiflow-v1", "SCHEDULING");
  store.setItem("optiflow-smart-import-v1", "SCHEDULING_IMPORT");
  saveAllocation(store, result.draft);
  const restored = loadAllocation(store)!;
  assert.equal(store.getItem("optiflow-v1"), "SCHEDULING");
  assert.equal(store.getItem("optiflow-smart-import-v1"), "SCHEDULING_IMPORT");
  const r = await solveAllocation(validateDraft(restored).input, g);
  assert.equal(r.status, "OPTIMAL");
  assert.equal(r.analysis!.objective, 1380);
  const csv = parseCSV(exportAllocation(v.input, r));
  assert.equal(csv.issues.length, 0);
  assert.equal(csv.rows[0][0], "OPTIMAL");
  assert.equal(csv.rows[0][2], "1380");
  assert.equal(csv.rows.length, 7);
  assert.equal(parseCSV(exportProjectOutputs(v.input, r)).rows.length, 2);
});
test("CSV preserves IDs and unknown values, flags bad mappings, and allows explicit corrections", () => {
  const s = sourceFor(
    "resources",
    'Resource Code,Name,Resource Type,Unit,Capacity,Unit Cost,Integer,Private notes\n001,Test,labor,hour,"1,5",2,MAYBE,retained',
  );
  s.decimal = "";
  const r = transformAllocationSources([s], simpleSettings());
  assert.equal(r.draft.tables.resources[0].values.resource_id, "001");
  assert.equal(r.draft.tables.resources[0].values.capacity, "1,5");
  assert.ok(r.draft.tables.resources[0].pending!.capacity);
  assert.ok(r.draft.tables.resources[0].pending!.integer);
  assert.ok(r.unmapped.some((u) => u.column === "Private notes"));
  assert.ok(s.text.includes("retained"));
  s.decimal = "comma";
  assert.equal(
    transformAllocationSources([s], simpleSettings()).draft.tables.resources[0]
      .values.capacity,
    "1.5",
  );
  s.mappings[1] = "resource_id";
  assert.ok(
    transformAllocationSources([s], simpleSettings()).issues.some((i) =>
      i.message.includes("Conflicting"),
    ),
  );
  const malformed = sourceFor("resources", 'resource_id,name\n001,"oops');
  assert.ok(
    transformAllocationSources([malformed], simpleSettings()).issues.some((i) =>
      i.message.includes("Unclosed"),
    ),
  );
});
function simpleSettings() {
  return toDraft(simple()).settings;
}
test("missing required mappings block import and saved corruption is rejected", () => {
  const s = sourceFor("resources", "resource_id\n001");
  assert.ok(
    transformAllocationSources([s], simpleSettings()).issues.some((i) =>
      i.message.includes("required field"),
    ),
  );
  const store = memory();
  assert.throws(() => saveAllocation(store, emptyDraft()));
  saveAllocation(store, sampleDraft());
  store.setItem(
    ALLOCATION_KEY,
    JSON.stringify({
      version: 1,
      draft: {
        ...sampleDraft(),
        settings: { ...sampleDraft().settings, currency: "???" },
      },
    }),
  );
  assert.throws(() => loadAllocation(store));
});
test("catalog CSV round-trips all data and quoted names without substituting values", () => {
  const d = sampleDraft();
  d.tables.resources[0].values.name = 'Studio, "East"';
  for (const table of tables) {
    const parsed = parseCSV(exportCatalog(d, table));
    assert.equal(parsed.issues.length, 0);
    assert.equal(parsed.rows.length, d.tables[table].length);
  }
  const p = parseCSV(exportCatalog(d, "resources"));
  assert.equal(p.rows[0][1], 'Studio, "East"');
});

test("an indeterminate unbounded mixed-integer relaxation is not mislabeled infeasible or optimal", async () => {
  const p = sampleInput();
  p.mode = "value";
  p.resources.forEach((r) => (r.capacity = null));
  p.projects.forEach((p) => (p.max = null));
  const result = await solveAllocation(p, g);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.analysis, undefined);
});
