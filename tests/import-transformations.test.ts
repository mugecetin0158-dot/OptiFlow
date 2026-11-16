import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSource, mappingConflicts } from "../lib/import/recognition";
import {
  splitTimeRange,
  transformCell,
  missingMappings,
} from "../lib/import/transformations";
import { normalizeDate, normalizeStatus } from "../lib/import/normalize";
import { transformSources } from "../lib/import/pipeline";
import { validateDraft, isAvailable } from "../lib/import/validation";
import { importStages, mappingIssues } from "../lib/import/stages";
import { parseCSV } from "../lib/import/csv";
import { makeProfile, applyProfile } from "../lib/import/profiles";
import {
  exportStandard,
  saveValidated,
  saveProfiles,
  loadProfiles,
  PROFILE_KEY,
} from "../lib/import/storage";
import { emptyRules, emptyDraft, ImportSource } from "../lib/import/types";
const raw = readFileSync(
  "tests/fixtures/import/raw_worker_windows.csv",
  "utf8",
);
function confirmed(text = raw): ImportSource {
  const s = createSource("windows", "raw_worker_windows.csv", text);
  s.kinds = ["availability"];
  s.mappings = s.mappings.map((m) => ({ ...m, state: "confirmed" }));
  s.confirmed = true;
  return s;
}
const run = (s: ImportSource) => transformSources([s]);
const check = (s: ImportSource) =>
  validateDraft(run(s).draft, emptyRules, "availability");
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
}

test("direct mappings preserve badge identifiers and canonical fields", () => {
  const source = confirmed(
    "Worker ID,Work Date,start_time,end_time,Availability Status\n0001,2026-11-16,09:00,17:00,available",
  );
  source.mappings = source.mappings.map((m) => ({ ...m, transform: "direct" }));
  assert.deepEqual(run(source).draft.availability[0].values, {
    employee_id: "0001",
    date: "2026-11-16",
    start_time: "09:00",
    end_time: "17:00",
    status: "available",
  });
});
test("common time-range delimiters and explicit AM/PM split deterministically", () => {
  for (const value of [
    "09:00-17:00",
    "09:00 - 17:00",
    "9 AM - 5 PM",
    "09:00–17:00",
    "09:00—17:00",
  ]) {
    assert.deepEqual(splitTimeRange(value), {
      start_time: "09:00",
      end_time: "17:00",
      overnight: false,
    });
  }
  for (const value of [
    "9-5 PM",
    "9 AM - 5",
    "morning",
    "09:00-17:00-18:00",
    "24:00-25:00",
    "9-9",
  ])
    assert.throws(() => splitTimeRange(value), value);
});
test("YES/NO normalize without conflating unknown status or approved time off", () => {
  assert.equal(normalizeStatus(" YES ", {}), "available");
  assert.equal(normalizeStatus("no", {}), "unavailable");
  for (const value of ["maybe", "approved", "1", "constructor"])
    assert.throws(() => normalizeStatus(value, {}));
  assert.equal(
    normalizeStatus("approved", { approved: "unavailable" }),
    "unavailable",
  );
});
test("mixed ISO and uniquely determined local dates normalize; ambiguous and invalid dates do not", () => {
  for (const date of ["2026-11-17", "11/17/2026", "17/11/2026", "2026/11/17"])
    assert.equal(normalizeDate(date), "2026-11-17");
  assert.equal(normalizeDate("11/11/2026"), "2026-11-11");
  for (const date of [
    "03/04/2026",
    "2026-02-29",
    "02/30/2026",
    "31/04/2026",
    "99/99/2026",
  ])
    assert.throws(() => normalizeDate(date), date);
  assert.equal(normalizeDate("03/04/2026", "MDY"), "2026-03-04");
  assert.equal(normalizeDate("29/02/2028"), "2028-02-29");
});
test("full fixture pipeline produces exactly the requested standard values and export", () => {
  const s = createSource("fixture", "raw_worker_windows.csv", raw);
  assert.deepEqual(
    s.mappings.map((m) => m.target),
    ["employee_id", "date", "start_time", "status"],
  );
  assert.equal(s.mappings[2].transform, "time_range");
  assert.equal(s.mappings[2].state, "suggested");
  assert.equal(run(s).draft.availability.length, 0);
  s.mappings[2].state = "confirmed";
  s.kinds = ["availability"];
  s.confirmed = true;
  assert.deepEqual(missingMappings(s), []);
  const result = run(s);
  assert.deepEqual(result.issues, []);
  const validation = validateDraft(result.draft, emptyRules, "availability");
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.data.availability, [
    {
      employee_id: "W001",
      date: "2026-11-16",
      start_time: "14:00",
      end_time: "22:00",
      status: "available",
    },
    {
      employee_id: "W002",
      date: "2026-11-17",
      start_time: "09:00",
      end_time: "17:00",
      status: "unavailable",
    },
  ]);
  const csv = exportStandard(validation.data, "availability");
  assert.deepEqual(parseCSV(csv).headers, [
    "employee_id",
    "date",
    "start_time",
    "end_time",
    "status",
  ]);
  assert.deepEqual(parseCSV(csv).rows, [
    ["W001", "2026-11-16", "14:00", "22:00", "available"],
    ["W002", "2026-11-17", "09:00", "17:00", "unavailable"],
  ]);
  assert.equal(validation.data.employees.length, 0);
  assert.ok(validation.issues.every((i) => i.severity === "warning"));
  assert.equal(validateDraft(result.draft, emptyRules).valid, false);
  assert.throws(() => saveValidated(memory(), result.draft, emptyRules, []));
  assert.equal(s.text, raw);
});
test("unknown values retain source and line, block export, and can be clarified without reupload", () => {
  const s = confirmed(raw.replace("YES", "MAYBE"));
  const draft = run(s).draft;
  assert.equal(draft.availability[0].values.status, "MAYBE");
  const invalid = validateDraft(draft, emptyRules, "availability");
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.issues.some(
      (i) =>
        i.field === "status" &&
        i.source?.file === "raw_worker_windows.csv" &&
        i.source.row === 2,
    ),
  );
  s.options.statusMap.maybe = "available";
  assert.equal(check(s).valid, true);
  assert.ok(s.text.includes("MAYBE"));
  draft.availability[0].values.status = "available";
  delete draft.availability[0].pending!.status;
  assert.equal(validateDraft(draft, emptyRules, "availability").valid, true);
});
test("overnight intervals require explicit confirmation and export a real end_date", () => {
  const s = confirmed(raw.replace("14:00-22:00", "22:00-06:00"));
  assert.equal(check(s).valid, false);
  assert.match(run(s).draft.availability[0].pending!.end_date, /Overnight/);
  s.mappings[2].overnight = "next_day";
  const result = check(s);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.data.availability[0].end_date, "2026-11-17");
  const exported = parseCSV(exportStandard(result.data, "availability"));
  assert.deepEqual(exported.headers, [
    "employee_id",
    "date",
    "start_time",
    "end_time",
    "status",
    "end_date",
  ]);
  assert.deepEqual(exported.rows[0], [
    "W001",
    "2026-11-16",
    "22:00",
    "06:00",
    "available",
    "2026-11-17",
  ]);
  assert.equal(exported.rows[1][5], "2026-11-17");
  const roundtrip = confirmed(exportStandard(result.data, "availability"));
  assert.equal(check(roundtrip).valid, true);
  const monthEnd = confirmed(
    raw
      .replace("2026-11-16", "2026-12-31")
      .replace("14:00-22:00", "22:00-06:00"),
  );
  monthEnd.mappings[2].overnight = "next_day";
  assert.equal(check(monthEnd).data.availability[0].end_date, "2027-01-01");
});
test("explicit end dates are validated and next-day contradictions are detected", () => {
  const s = confirmed(
    "Badge,Day,Time Window,Can Work?,End Date\nW001,2026-11-16,22:00-06:00,YES,2026-11-17\nW001,2026-11-17,01:00-02:00,NO,2026-11-17",
  );
  assert.ok(
    check(s).issues.some((i) =>
      i.message.startsWith("Available and unavailable"),
    ),
  );
  const d = run(s).draft;
  d.availability.pop();
  const data = validateDraft(d, emptyRules, "availability").data;
  assert.equal(isAvailable(data, "W001", "2026-11-17", "01:00", "03:00"), true);
  assert.equal(
    isAvailable(data, "W001", "2026-11-16", "23:00", "03:00", "2026-11-17"),
    true,
  );
  assert.equal(
    isAvailable(data, "W001", "2026-11-17", "05:00", "07:00"),
    false,
  );
  for (const badDate of ["2026-11-15", "2026-11-19", "2026-02-30"]) {
    d.availability[0].values.end_date = badDate;
    assert.equal(validateDraft(d, emptyRules, "availability").valid, false);
  }
});
test("duplicate normalized intervals are blocked even when same-day end_date is explicit", () => {
  const d = run(confirmed()).draft;
  d.availability.push(structuredClone(d.availability[0]));
  d.availability[2].values.end_date = d.availability[2].values.date;
  assert.ok(
    validateDraft(d, emptyRules, "availability").issues.some((i) =>
      i.message.includes("Duplicate availability"),
    ),
  );
});
test("missing mappings and unknown structures never produce a ready stage", () => {
  const s = confirmed("Mystery,Comment\none,two");
  const result = run(s);
  assert.ok(
    result.issues.some(
      (i) => i.code === "missing-mapping" && i.severity === "error",
    ),
  );
  assert.deepEqual(importStages([s], [], false, false), {
    parsing: "Complete",
    mapping: "Needs attention",
    dataset: "Not validated",
  });
  assert.equal(check(s).valid, false);
  assert.equal(
    mappingIssues(s).filter((i) => i.code === "missing-mapping").length,
    5,
  );
  const malformed = confirmed('Badge,Day\nW001,"unterminated');
  assert.equal(
    importStages([malformed], [], false, false).parsing,
    "Needs attention",
  );
});
test("time-range headers alone never infer availability, assignments, or staffing demand", () => {
  const s = createSource(
    "x",
    "ambiguous.csv",
    "Badge,Day,Time Window\nW001,2026-11-16,09:00-17:00",
  );
  assert.deepEqual(s.kinds, []);
  assert.equal(run(s).draft.availability.length, 0);
  assert.ok(mappingIssues(s).some((i) => i.severity === "error"));
  s.confirmed = true;
  const result = run(s);
  assert.deepEqual(result.draft, emptyDraft());
  assert.equal(result.unmapped.length, 3);
  assert.equal(
    importStages([s], [], false, false).mapping,
    "No scheduling data",
  );
});
test("one-to-many outputs participate in mapping conflict and configuration checks", () => {
  const s = confirmed(raw.trim() + "\n");
  s.parsed.headers.push("Finish");
  s.mappings.push({ target: "end_time", state: "confirmed", reason: "manual" });
  assert.ok(mappingConflicts(s).some((v) => v.includes("end_time")));
  assert.equal(run(s).draft.availability.length, 0);
  s.mappings[2].target = "employee_id";
  assert.ok(mappingConflicts(s).some((v) => v.includes("time-range")));
  assert.throws(() => transformCell("09:00-17:00", s.mappings[2], s.options));
});
test("transformation profiles persist, reorder safely, allow edits, and revalidate new values", () => {
  const source = confirmed();
  source.mappings[2].overnight = "next_day";
  const profile = makeProfile(source, "Warehouse Availability", "p");
  const store = memory();
  saveProfiles(store, [profile]);
  const loaded = loadProfiles(store)[0];
  assert.equal(loaded.mappings[2].transform, "time_range");
  assert.equal(loaded.mappings[2].overnight, "next_day");
  const next = createSource(
    "next",
    "new.csv",
    "Can Work?,Time Window,Day,Badge\nMAYBE,22:00-06:00,2026-11-16,0007",
  );
  const reused = applyProfile(next, loaded);
  assert.equal(reused.confirmed, false);
  reused.confirmed = true;
  assert.equal(check(reused).valid, false);
  reused.options.statusMap.maybe = "unavailable";
  assert.equal(check(reused).valid, true);
  const edited = makeProfile(reused, profile.name, profile.id);
  saveProfiles(store, [edited]);
  assert.equal(loadProfiles(store)[0].options.statusMap.maybe, "unavailable");
  store.setItem(
    PROFILE_KEY,
    JSON.stringify([
      {
        ...edited,
        mappings: edited.mappings.map((m) => ({
          ...m,
          transform: "execute-code",
        })),
      },
    ]),
  );
  assert.throws(() => loadProfiles(store));
});
test("shift requirements retain their own date/time transformations and explicit overnight export", () => {
  const s = createSource(
    "s",
    "shifts.csv",
    "shift_id,Work Date,Time Window,required_count,required_role\nN1,2026-11-16,10 PM - 6 AM,2,Picker",
  );
  s.kinds = ["shifts"];
  s.mappings = s.mappings.map((m) => ({
    ...m,
    state: "confirmed",
    overnight: "next_day",
  }));
  s.confirmed = true;
  const result = run(s);
  assert.deepEqual(result.issues, []);
  const validation = validateDraft(result.draft, emptyRules, "shifts");
  assert.equal(validation.valid, true);
  assert.equal(validation.data.shifts[0].end_date, "2026-11-17");
  assert.equal(
    parseCSV(exportStandard(validation.data, "shifts")).rows[0][6],
    "2026-11-17",
  );
});

test("all three imported datasets preserve overnight dates through save, reload, and scheduling integration", async () => {
  const { loadValidated } = await import("../lib/import/storage");
  const { schedulingInput } = await import("../lib/import/integration");
  const employee = createSource(
    "e",
    "team.csv",
    "employee_id,name,hourly_rate,max_weekly_hours,roles\nW001,Example One,20,40,Picker\nW002,Example Two,22,32,Picker",
  );
  employee.confirmed = true;
  const available = confirmed(raw.replace("14:00-22:00", "22:00-06:00"));
  available.mappings[2].overnight = "next_day";
  const shift = createSource(
    "s",
    "shifts.csv",
    "shift_id,date,start_time,end_time,end_date,required_count,required_role\nN1,2026-11-16,23:00,05:00,2026-11-17,1,Picker",
  );
  shift.confirmed = true;
  const result = transformSources([employee, available, shift]);
  const rules = {
    ...emptyRules,
    minRestHours: "0",
    maxShiftsPerWeek: "5",
    timezone: "Etc/UTC",
    currency: "USD",
    weekStart: "2026-11-16",
    allowMultipleShifts: true,
    reviewed: true,
  };
  const validation = validateDraft(result.draft, rules);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.ok(!validation.issues.some((i) => i.message.includes("infeasible")));
  const store = memory();
  saveValidated(store, result.draft, rules, result.unmapped, result.issues);
  const loaded = loadValidated(store)!;
  assert.equal(loaded.saved.data.availability[0].end_date, "2026-11-17");
  assert.equal(loaded.saved.data.shifts[0].end_date, "2026-11-17");
  assert.equal(schedulingInput(loaded.saved, loaded.rules).canOptimize, false);
  const crossingWeek = structuredClone(result.draft);
  crossingWeek.shifts[0].values.date = "2026-11-22";
  crossingWeek.shifts[0].values.end_date = "2026-11-23";
  assert.ok(
    validateDraft(crossingWeek, rules).issues.some((i) =>
      i.message.includes("outside the configured"),
    ),
  );
  assert.ok(
    validateDraft(result.draft, { ...rules, closedWeekdays: [2] }).issues.some(
      (i) => i.message.includes("closed weekday"),
    ),
  );
});

test("validation stages track unresolved transformations and explicit canonical corrections", () => {
  const source = confirmed(raw.replace("YES", "MAYBE"));
  const draft = run(source).draft;
  let validation = validateDraft(draft, emptyRules, "availability");
  assert.equal(
    importStages([source], validation.issues, false, true).mapping,
    "Needs attention",
  );
  draft.availability[0].values.status = "available";
  delete draft.availability[0].pending!.status;
  validation = validateDraft(draft, emptyRules, "availability");
  assert.equal(
    importStages([source], validation.issues, false, true).mapping,
    "Complete",
  );
});
