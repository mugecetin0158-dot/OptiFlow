import { test } from "node:test";
import assert from "node:assert/strict";
import GLPK from "glpk.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { preset, analyze, inputErrors, csv, Scenario } from "../lib/model";
import { solve } from "../lib/solver";
const g = GLPK();
const fixtureResults: any[] = [];
for (const name of ["Retail Store", "Café", "Office", "Infeasible test"])
  test(`preset: ${name}`, async () => {
    const p = preset(name);
    const r = await solve(p, g);
    assert.equal(
      r.status,
      name === "Infeasible test" ? "INFEASIBLE" : "OPTIMAL",
    );
    if (r.status === "OPTIMAL") {
      const a = analyze(p, r.assignments);
      assert.equal(a.violations.length, 0);
      assert.equal(a.coverage, 100);
      assert.ok(a.totalCost > 0);
      fixtureResults.push({ p, cost: a.totalCost });
    } else assert.ok(r.messages[0].includes("only 0"));
    mkdirSync("tests/fixtures", { recursive: true });
    writeFileSync(
      "tests/fixtures/scenarios.json",
      JSON.stringify(fixtureResults, null, 2),
    );
  });
function small(): Scenario {
  const p = preset();
  p.employees = p.employees
    .slice(0, 3)
    .map((e, i) => ({
      ...e,
      wage: [10, 12, 17][i],
      maxHours: [5, 8, 20][i],
      availability: Array(14).fill(true),
    }));
  p.shifts.forEach((s, i) => {
    s.required = i < 3 ? 1 : 0;
  });
  p.shifts[0].end = "12:00";
  p.shifts[1].start = "11:00";
  p.shifts[1].end = "14:00";
  p.shifts[2].end = "14:00";
  return p;
}
test("integer solver matches exhaustive enumeration with unequal durations, overlaps and hour limits", async () => {
  for (let seed = 0; seed < 6; seed++) {
    const p = small();
    p.employees[0].availability[seed % 3] = false;
    p.employees[1].maxHours = seed + 3;
    let best = Infinity;
    for (let mask = 0; mask < 512; mask++) {
      const a = p.shifts.map((_, si) =>
        si >= 3
          ? []
          : p.employees
              .filter((_, ei) => (mask >> (si * 3 + ei)) & 1)
              .map((e) => e.id),
      );
      const s = analyze(p, a);
      if (!s.violations.length) best = Math.min(best, s.totalCost);
    }
    const r = await solve(p, g);
    assert.equal(r.status, "OPTIMAL");
    assert.equal(analyze(p, r.assignments).totalCost, best);
  }
});
test("overlap makes jointly impossible staffing infeasible", async () => {
  const p = small();
  p.employees = p.employees.slice(0, 1);
  p.employees[0].maxHours = 100;
  assert.equal((await solve(p, g)).status, "INFEASIBLE");
});
test("manual changes detect coverage, unavailable, hours and conflicts", () => {
  const p = small();
  p.employees[0].availability[0] = false;
  const a = p.shifts.map((_, i) => (i < 3 ? [p.employees[0].id] : []));
  const issues = analyze(p, a).violations.join(" ");
  assert.match(issues, /unavailable/);
  assert.match(issues, /overlapping/);
  assert.match(issues, /exceeds/);
  a[2] = [];
  assert.match(analyze(p, a).violations.join(" "), /unfilled/);
});
test("input validation rejects empty teams and invalid wages/times", () => {
  const p = small();
  p.employees = [];
  assert.ok(inputErrors(p).length);
  p.employees = preset().employees;
  p.employees[0].wage = -1;
  p.shifts[0].end = "08:00";
  assert.ok(inputErrors(p).length >= 2);
});
test("CSV contains dates, real hours/cost and escapes spreadsheet formulas", async () => {
  const p = small();
  p.employees[0].name = '=HYPERLINK("x")';
  const r = await solve(p, g);
  const output = csv(p, r.assignments);
  assert.match(output, /Assignment cost/);
  assert.match(output, /2026-11-16/);
  assert.match(output, /'=HYPERLINK/);
});
test("changing availability affects the optimized assignments", async () => {
  const p = small();
  const first = await solve(p, g);
  const id = first.assignments[0][0];
  p.employees.find((e) => e.id === id)!.availability[0] = false;
  const second = await solve(p, g);
  assert.ok(!second.assignments[0].includes(id));
  assert.equal(analyze(p, second.assignments).violations.length, 0);
});
