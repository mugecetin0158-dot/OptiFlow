import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import GLPK from "glpk.js";
import { parseCSV, decodeCSV, writeCSV } from "../lib/import/csv";
import {
  recognize,
  createSource,
  mappingConflicts,
  normalizeHeader,
} from "../lib/import/recognition";
import {
  normalizeDate,
  normalizeTime,
  normalizeDecimal,
  normalizeStatus,
} from "../lib/import/normalize";
import { transformSources } from "../lib/import/pipeline";
import { validateDraft, isAvailable } from "../lib/import/validation";
import {
  makeProfile,
  applyProfile,
  matchingProfile,
} from "../lib/import/profiles";
import {
  saveValidated,
  loadValidated,
  exportStandard,
  DATA_KEY,
  RULES_KEY,
  LocalStore,
} from "../lib/import/storage";
import { schedulingInput } from "../lib/import/integration";
import { solve } from "../lib/solver";
import { Rules, schemas } from "../lib/import/types";
const fixture = (name: string) =>
  readFileSync(`tests/fixtures/import/${name}.csv`, "utf8");
const rules: Rules = {
  minRestHours: "11",
  maxShiftsPerWeek: "5",
  maxWeeklyHours: "40",
  timezone: "Europe/Istanbul",
  currency: "USD",
  weekStart: "2026-11-16",
  closedWeekdays: [],
  maxDailyHours: "8",
  allowMultipleShifts: true,
  reviewed: true,
};
function inputs() {
  const team = createSource("a", "team.csv", fixture("team"));
  team.confirmed = true;
  team.options.decimal = "dot";
  const windows = createSource("b", "windows.csv", fixture("windows"));
  windows.confirmed = true;
  windows.options.dateOrder = "DMY";
  windows.options.statusMap = { "approved leave": "unavailable" };
  const shifts = createSource("c", "demand.csv", fixture("demand"));
  shifts.confirmed = true;
  return [team, windows, shifts];
}
function memory(): LocalStore {
  const values = new Map<string, string>();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
    removeItem: (k) => {
      values.delete(k);
    },
  };
}

test("CSV quoting, delimiters, newlines, escaped quotes, empty cells and trace lines", () => {
  const p = parseCSV(
    'id;name;note\r\n001;"A; B";"hello\r\n""quoted"""\r\n002;C;\r\n',
  );
  assert.equal(p.delimiter, ";");
  assert.equal(p.rows[0][0], "001");
  assert.equal(p.rows[0][1], "A; B");
  assert.equal(p.rows[0][2], 'hello\r\n"quoted"');
  assert.equal(p.rows[1][2], "");
  assert.deepEqual(p.lineNumbers, [2, 4]);
  assert.equal(p.issues.length, 0);
  assert.deepEqual(
    parseCSV('name;note\rÉmile;"café\r\n""déjà vu""; ¡hola!"').rows,
    [["Émile", 'café\r\n"déjà vu"; ¡hola!']],
  );
  assert.equal(parseCSV("a\tb\n1\t2").issues[0].message, "Unsupported delimiter.");
  assert.equal(parseCSV("a|b\n1|2").issues[0].message, "Unsupported delimiter.");
});
test("malformed, empty, inconsistent rows and duplicate headers are rejected", () => {
  for (const text of [
    fixture("malformed"),
    "",
    "a,b\n1,2,3",
    "a,a\n1,2",
    'a,b\n1,"x"oops',
  ])
    assert.ok(
      parseCSV(text).issues.some((i) => i.severity === "error"),
      text,
    );
  assert.ok(parseCSV("a,b;c\n1,2;3").issues.length);
});
test("blank physical lines are skipped but explicit empty-field records are retained", () => {
  const parsed = parseCSV("id,name\n\n,\n");
  assert.deepEqual(parsed.rows, [["", ""]]);
  assert.deepEqual(parsed.lineNumbers, [3]);
  assert.equal(parsed.issues.length, 0);
});
test("Unicode and explicit legacy encodings preserve names", () => {
  assert.equal(
    decodeCSV(new TextEncoder().encode("\uFEFFname\nÉmile")).text,
    "name\nÉmile",
  );
  const bytes = new Uint8Array([
    255,
    254,
    ...Buffer.from("name\nMüge", "utf16le"),
  ]);
  assert.equal(decodeCSV(bytes).text, "name\nMüge");
  assert.throws(() => decodeCSV(new Uint8Array([0xe9])));
  assert.equal(decodeCSV(new Uint8Array([0xe9]), "windows-1252").text, "é");
});
test("exact aliases normalize punctuation without fuzzy guesses", () => {
  assert.equal(normalizeHeader(" Staff_Number "), "staff number");
  const m = recognize([
    "STAFF-NUMBER",
    "Worker Name",
    "Hourly Wage",
    "max_weekly_hours",
    "Roles",
  ]);
  assert.deepEqual(
    m.map((x) => x.target),
    schemas.employees,
  );
  assert.ok(m.every((x) => x.state === "auto"));
  assert.equal(recognize(["employe id"])[0].state, "unmapped");
});
test("ambiguous columns remain pending and unknown structures remain unmapped", () => {
  const a = createSource("a", "ambiguous", fixture("ambiguous"));
  assert.equal(a.mappings[2].state, "suggested");
  assert.equal(a.mappings[3].state, "suggested");
  assert.equal(a.mappings[4].state, "suggested");
  assert.equal(a.mappings[5].target, "");
  assert.equal(transformSources([a]).draft.employees.length, 0);
  const u = createSource("u", "unrelated", fixture("unrelated"));
  assert.deepEqual(u.kinds, []);
  u.confirmed = true;
  assert.equal(transformSources([u]).draft.shifts.length, 0);
  const assigned = createSource("x", "assignments", fixture("assignments"));
  assert.ok(!assigned.kinds.includes("shifts"));
  assert.ok(!assigned.kinds.includes("availability"));
});
test("date, time, decimal and status normalization auto-corrects only unambiguous values", () => {
  assert.equal(normalizeDate("2026/11/16"), "2026-11-16");
  assert.throws(() => normalizeDate("03/04/2026"));
  assert.equal(normalizeDate("03/04/2026", "DMY"), "2026-04-03");
  assert.equal(normalizeDate("03/04/2026", "MDY"), "2026-03-04");
  assert.throws(() => normalizeDate("31/02/2026", "DMY"));
  assert.equal(normalizeTime("9 AM"), "09:00");
  assert.equal(normalizeTime("12:30 pm"), "12:30");
  assert.throws(() => normalizeTime("25:00"));
  assert.equal(normalizeDecimal("18.50", "", true), "18.5");
  assert.throws(() => normalizeDecimal("1,234", "", true));
  assert.equal(normalizeDecimal("18,50", "comma"), "18.5");
  assert.throws(() => normalizeDecimal("1,200.00", "dot"));
  assert.throws(() => normalizeStatus("approved", {}));
  assert.equal(
    normalizeStatus("approved", { approved: "unavailable" }),
    "unavailable",
  );
  assert.throws(() => normalizeStatus("constructor", {}));
  assert.equal(recognize(["constructor"])[0].state, "unmapped");
});
test("full transform produces real records, source traceability and no invented defaults", () => {
  const result = transformSources(inputs());
  assert.equal(result.issues.filter((i) => i.severity === "error").length, 0);
  const check = validateDraft(result.draft, rules);
  assert.equal(check.valid, true, JSON.stringify(check.issues));
  assert.equal(check.data.employees[0].employee_id, "001");
  assert.equal(check.data.employees[0].hourly_rate, 18.5);
  assert.deepEqual(check.data.employees[0].roles, ["Cashier", "Manager"]);
  assert.equal(check.data.availability[3].status, "unavailable");
  assert.deepEqual(result.draft.employees[0].sources, [
    { fileId: "a", file: "team.csv", row: 2 },
  ]);
  assert.ok(result.unmapped.some((u) => u.column === "Payroll Notes"));
});
test("unambiguous decimals normalize automatically while ambiguous numeric formats stay blocking", () => {
  const files = inputs();
  files[0].options.decimal = "";
  const normalized = transformSources(files);
  assert.equal(normalized.draft.employees[0].values.hourly_rate, "18.5");
  assert.equal(validateDraft(normalized.draft, rules).valid, true);
  const rateColumn = files[0].mappings.findIndex(
    (mapping) => mapping.target === "hourly_rate",
  );
  files[0].parsed.rows[0][rateColumn] = "1,200.00";
  const ambiguous = transformSources(files);
  assert.match(
    ambiguous.draft.employees[0].pending!.hourly_rate,
    /ambiguous/i,
  );
  assert.equal(validateDraft(ambiguous.draft, rules).valid, false);
});
test("missing fields, duplicate employee IDs, invalid references and role mismatch block saving", () => {
  const d = transformSources(inputs()).draft;
  d.employees[0].values.name = "";
  d.employees.push(structuredClone(d.employees[1]));
  d.availability[0].values.employee_id = "999";
  d.shifts[0].values.required_role = "Chef";
  const r = validateDraft(d, rules);
  assert.equal(r.valid, false);
  for (const text of [
    "missing",
    "Duplicate employee",
    "reference",
    "Required role",
  ])
    assert.ok(
      r.issues.some((i) => i.message.includes(text)),
      text,
    );
});
test("conflicting mappings and generic/specialized date collisions block transformation", () => {
  const s = inputs()[0];
  s.mappings[1] = { ...s.mappings[0] };
  assert.ok(mappingConflicts(s).length);
  assert.ok(transformSources([s]).issues.some((i) => i.code === "mapping"));
  const a = createSource(
    "a",
    "a",
    "employee_id,date,availability_date,start_time,end_time,availability\n001,2026-11-16,2026-11-16,09:00,17:00,available",
  );
  assert.ok(mappingConflicts(a).length);
});
test("availability supports adjacent windows, rejects contradictions and never infers missing availability", () => {
  const { draft } = transformSources(inputs());
  const data = validateDraft(draft, rules).data;
  assert.equal(isAvailable(data, "001", "2026-11-16", "09:00", "17:00"), true);
  assert.equal(isAvailable(data, "001", "2026-11-17", "09:00", "17:00"), false);
  draft.availability.push({
    values: {
      employee_id: "001",
      date: "2026-11-16",
      start_time: "12:00",
      end_time: "14:00",
      status: "unavailable",
    },
    sources: [],
  });
  assert.ok(
    validateDraft(draft, rules).issues.some((i) =>
      i.message.startsWith("Available and unavailable"),
    ),
  );
  draft.availability[0].values.end_time = "08:00";
  assert.ok(
    validateDraft(draft, rules).issues.some((i) =>
      i.message.includes("Overnight"),
    ),
  );
});
test("mixed data rows transform relevant datasets and consolidate identical employee facts explicitly", () => {
  const s = createSource(
    "m",
    "mixed",
    "employee_id,name,hourly_rate,max_weekly_hours,roles,date,start_time,end_time,availability\n001,Alice,18,32,Cashier,2026-11-16,09:00,13:00,available\n001,Alice,18,32,Cashier,2026-11-16,13:00,17:00,available\n002,Bob,20,24,Cashier,,,,",
  );
  s.confirmed = true;
  const r = transformSources([s]);
  assert.equal(r.draft.employees.length, 2);
  assert.equal(r.draft.employees[0].sources.length, 2);
  assert.equal(r.draft.availability.length, 2);
  assert.ok(r.issues.some((i) => i.code === "repeated-employee"));
});
test("profiles handle reordered headers, require confirmation, and revalidate new values", () => {
  const source = inputs()[0];
  const profile = makeProfile(source, "Payroll", "p");
  const next = createSource(
    "new",
    "new",
    "Roles,Maximum Weekly Hours,Hourly Wage,Worker Name,Staff Number,Payroll Notes\nCashier,32,wrong,Alice,003,",
  );
  assert.ok(matchingProfile(profile, next.parsed.headers));
  const applied = applyProfile(next, profile);
  assert.equal(applied.confirmed, false);
  assert.equal(applied.mappings[4].target, "employee_id");
  applied.confirmed = true;
  const r = transformSources([applied]);
  assert.ok(!validateDraft(r.draft, rules).valid);
  assert.throws(() =>
    applyProfile(createSource("bad", "bad", "x\n1"), profile),
  );
});
test("standard CSV exports round-trip IDs, UTF-8 names, role lists and exact schema headers", () => {
  const r = validateDraft(transformSources(inputs()).draft, rules);
  for (const kind of ["employees", "availability", "shifts"] as const) {
    const csv = exportStandard(r.data, kind),
      parsed = parseCSV(csv);
    assert.deepEqual(parsed.headers, schemas[kind]);
    assert.equal(parsed.issues.length, 0);
    assert.equal(parsed.rows.length, r.data[kind].length);
  }
  const p = parseCSV(exportStandard(r.data, "employees"));
  assert.equal(p.rows[0][0], "001");
  assert.equal(p.rows[0][1], "Doe, Alice");
  assert.deepEqual(JSON.parse(p.rows[0][4]), ["Cashier", "Manager"]);
  assert.equal(p.rows[1][1], "Émile Yılmaz");
});
test("saved data and rules persist separately and adapt to the existing optimizer without losing roles or windows", () => {
  const store = memory();
  store.setItem("optiflow-v1", "DEMO");
  const { draft, issues, unmapped } = transformSources(inputs());
  const saved = saveValidated(store, draft, rules, unmapped, issues);
  assert.ok(store.getItem(DATA_KEY));
  assert.ok(store.getItem(RULES_KEY));
  assert.equal(store.getItem("optiflow-v1"), "DEMO");
  const restored = loadValidated(store)!;
  assert.deepEqual(restored.saved.data, saved.data);
  const input = schedulingInput(restored.saved, restored.rules);
  assert.equal(input.source, "import");
  assert.equal(input.canOptimize, true);
  assert.deepEqual(input.data, saved.data);
  assert.deepEqual(input.scenario.employees[0].roles, ["Cashier", "Manager"]);
  assert.equal(input.scenario.shifts[0].requiredRole, "Cashier");
  assert.equal(input.scenario.shifts[0].start, "09:00");
  assert.equal(input.scenario.shifts[0].end, "17:00");
  assert.equal(input.scenario.shifts[0].dailyMinutes["2026-11-16"], 480);
  assert.deepEqual(input.scenario.employees[0].availability, [true]);
  store.setItem(RULES_KEY, JSON.stringify({ ...rules, minRestHours: "0" }));
  assert.throws(() => loadValidated(store));
});
test("imported optimization assigns role-qualified employees for variable intervals", async () => {
  const { draft, issues, unmapped } = transformSources(inputs());
  draft.shifts[0].values.required_role = "Manager";
  draft.shifts[0].values.start_time = "13:00";
  draft.shifts[0].values.required_count = "1";
  const store = memory();
  const saved = saveValidated(store, draft, rules, unmapped, issues);
  const adapted = schedulingInput(saved, rules);
  const result = await solve(adapted.scenario, GLPK());
  assert.equal(result.status, "OPTIMAL");
  assert.deepEqual(result.assignments, [["001"]]);
});
test("imported invalid data and ambiguous timezone wall-times are reported instead of guessed", () => {
  const { draft, issues, unmapped } = transformSources(inputs());
  const saved = saveValidated(memory(), draft, rules, unmapped, issues);
  assert.throws(
    () => schedulingInput(saved, { ...rules, maxShiftsPerWeek: "4" }),
    /requires validation/,
  );
  const dstRules = {
    ...rules,
    timezone: "America/New_York",
    weekStart: "2026-03-02",
  };
  const dstDraft = structuredClone(draft);
  dstDraft.availability[0].values.date = "2026-03-08";
  dstDraft.availability[0].values.start_time = "01:00";
  dstDraft.availability[0].values.end_time = "04:00";
  dstDraft.shifts[0].values.date = "2026-03-08";
  dstDraft.shifts[0].values.start_time = "02:00";
  dstDraft.shifts[0].values.end_time = "03:00";
  const dstSaved = saveValidated(memory(), dstDraft, dstRules, unmapped, issues);
  assert.throws(() => schedulingInput(dstSaved, dstRules), /does not exist/);
  const fallRules = {
    ...rules,
    timezone: "America/New_York",
    weekStart: "2026-10-26",
  };
  const fallDraft = structuredClone(draft);
  fallDraft.shifts[0].values.date = "2026-11-01";
  fallDraft.shifts[0].values.start_time = "01:30";
  fallDraft.shifts[0].values.end_time = "03:00";
  const fallSaved = saveValidated(
    memory(),
    fallDraft,
    fallRules,
    unmapped,
    issues,
  );
  assert.throws(() => schedulingInput(fallSaved, fallRules), /ambiguous/);
});
test("imported optimizer returns infeasible when weekly shift-count rules cannot be met", async () => {
  const { draft, issues, unmapped } = transformSources(inputs());
  draft.shifts[0].values.required_role = "Manager";
  draft.shifts[0].values.end_time = "12:00";
  draft.shifts.push({
    values: {
      shift_id: "S-002",
      date: "2026-11-16",
      start_time: "13:00",
      end_time: "17:00",
      required_count: "1",
      required_role: "Manager",
    },
    sources: [],
  });
  draft.availability = draft.availability.filter(
    (window) => window.values.employee_id === "001",
  );
  const strictRules = {
    ...rules,
    minRestHours: "0",
    maxShiftsPerWeek: "1",
  };
  const saved = saveValidated(memory(), draft, strictRules, unmapped, issues);
  const adapted = schedulingInput(saved, strictRules);
  const result = await solve(adapted.scenario, GLPK());
  assert.equal(result.status, "INFEASIBLE");
  assert.deepEqual(result.assignments, []);
});
test("imported optimizer enforces minimum rest, maximum daily hours, and same-day shift rules", async () => {
  for (const patch of [
    { minRestHours: "2", maxDailyHours: "8", allowMultipleShifts: true },
    { minRestHours: "0", maxDailyHours: "6", allowMultipleShifts: true },
    { minRestHours: "0", maxDailyHours: "8", allowMultipleShifts: false },
  ]) {
    const { draft, issues, unmapped } = transformSources(inputs());
    draft.shifts[0].values.required_role = "Manager";
    draft.shifts[0].values.required_count = "1";
    draft.shifts[0].values.end_time = "12:00";
    draft.shifts.push({
      values: {
        shift_id: "S-002",
        date: "2026-11-16",
        start_time: "13:00",
        end_time: "17:00",
        required_count: "1",
        required_role: "Manager",
      },
      sources: [],
    });
    const constrainedRules = {
      ...rules,
      minRestHours: patch.minRestHours,
      maxDailyHours: patch.maxDailyHours,
      allowMultipleShifts: patch.allowMultipleShifts,
    };
    const saved = saveValidated(
      memory(),
      draft,
      constrainedRules,
      unmapped,
      issues,
    );
    const adapted = schedulingInput(saved, constrainedRules);
    const result = await solve(adapted.scenario, GLPK());
    assert.equal(result.status, "INFEASIBLE", JSON.stringify(patch));
  }
});
test("blocking errors and storage failure cannot report a successful save", () => {
  const d = transformSources(inputs()).draft;
  d.employees[0].values.name = "";
  assert.throws(() => saveValidated(memory(), d, rules, []));
  const good = transformSources(inputs()).draft;
  const store = memory(),
    set = store.setItem;
  store.setItem = (key, value) => {
    if (key === DATA_KEY) throw Error("quota");
    set(key, value);
  };
  assert.throws(() => saveValidated(store, good, rules, []), /storage/);
  assert.equal(store.getItem(RULES_KEY), null);
});
test("closed days and unreviewed rules block confirmation; shortages are warnings, not fabricated solutions", () => {
  const d = transformSources(inputs()).draft;
  assert.equal(validateDraft(d, { ...rules, reviewed: false }).valid, false);
  assert.equal(
    validateDraft(d, { ...rules, closedWeekdays: [1] }).valid,
    false,
  );
  d.shifts[0].values.required_count = "3";
  const r = validateDraft(d, rules);
  assert.equal(r.valid, true);
  assert.ok(
    r.issues.some(
      (i) => i.message.includes("infeasible") && i.severity === "warning",
    ),
  );
});

test("incompatible dataset mappings are rejected and unrelated assignment columns remain visible", () => {
  const source = createSource("x", "assignments", fixture("assignments"));
  source.confirmed = true;
  const result = transformSources([source]);
  assert.equal(result.unmapped.length, 5);
  assert.ok(
    result.unmapped.every(
      (u) => u.decision === "Unrelated / existing assignments",
    ),
  );
  source.kinds = ["employees"];
  assert.ok(mappingConflicts(source).some((s) => s.includes("date")));
  assert.equal(transformSources([source]).draft.employees.length, 0);
});

test("profile edits and deletion persist, and malformed stored profiles are rejected", async () => {
  const { saveProfiles, loadProfiles, PROFILE_KEY } =
    await import("../lib/import/storage");
  const store = memory();
  const p = makeProfile(inputs()[0], "Team", "p");
  saveProfiles(store, [p]);
  const updated = {
    ...p,
    name: "Renamed team",
    options: { ...p.options, decimal: "comma" as const },
  };
  saveProfiles(store, [updated]);
  assert.equal(loadProfiles(store)[0].name, "Renamed team");
  assert.equal(loadProfiles(store)[0].options.decimal, "comma");
  saveProfiles(store, []);
  assert.deepEqual(loadProfiles(store), []);
  store.setItem(PROFILE_KEY, JSON.stringify([{ ...p, headers: [123] }]));
  assert.throws(() => loadProfiles(store));
});
