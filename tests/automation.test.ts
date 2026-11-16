import { test } from "node:test";
import assert from "node:assert/strict";
import { createSource } from "../lib/import/recognition";
import {
  autoScheduling,
  autoAllocation,
  autoAllocationWithProfiles,
  detectHeaderRow,
  correctionJournal,
  cleanSuggestions,
  requestAISuggestions,
  profileSourcesForAI,
  cleanImportAnalysis,
  applyImportAnalysis,
  requestAIImportAnalysis,
  aiVerificationRequired,
  prepareAIImport,
  datasetReadiness,
} from "../lib/import/automation";
import { createAllocationSource } from "../lib/allocation/import";
import { sampleDraft } from "../lib/allocation/sample";
import { exportCatalog } from "../lib/allocation/import";
import { makeProfile } from "../lib/import/profiles";
import { transformSources } from "../lib/import/pipeline";
import { validateDraft } from "../lib/import/validation";
import {
  Dataset,
  emptyRules,
  Field,
  Mapping,
} from "../lib/import/types";
import { readWorkbook } from "../lib/spreadsheet/read";
import { readFileSync } from "node:fs";
import { writeCSV, parseCSV } from "../lib/import/csv";
const staff =
  "employee_id,name,hourly_rate,max_weekly_hours,roles\n001,Ada,20,40,barista";
test("confident scheduling fields automatically parse, classify, transform and validate", () => {
  const result = autoScheduling([createSource("x", "staff.csv", staff)], []);
  assert.equal(result.ready, true);
  assert.equal(result.sources[0].confirmed, true);
  assert.equal(result.result!.draft.employees[0].values.employee_id, "001");
  assert.equal(
    validateDraft(result.result!.draft, emptyRules, "employees").valid,
    true,
  );
});
test("ambiguity and missing required mappings stay in review", () => {
  for (const text of [
    "Badge,Hours,Rate\n001,40,20",
    "employee_id,name\n001,Ada",
  ])
    assert.equal(
      autoScheduling([createSource("x", "a.csv", text)], []).ready,
      false,
    );
});
test("confirmed profiles can auto-map reordered columns while revalidating values", () => {
  const original = autoScheduling([createSource("x", "a.csv", staff)], [])
    .sources[0];
  const profile = makeProfile(original, "staff", "profile");
  const candidate = createSource(
    "y",
    "b.csv",
    "roles,name,employee_id,max_weekly_hours,hourly_rate\nbarista,Ada,001,40,bad",
  );
  const applied = autoScheduling([candidate], [profile]);
  assert.equal(applied.ready, true);
  assert.equal(applied.sources[0].mappings[2].target, "employee_id");
  assert.ok(applied.result!.draft.employees[0].pending?.hourly_rate);
});
test("allocation catalog with distinctive complete fields is classified; partial data remains unconfirmed", () => {
  const d = sampleDraft(),
    resource = createAllocationSource(
      "x",
      "resources.csv",
      exportCatalog(d, "resources"),
    );
  const auto = autoAllocation(resource, d.settings);
  assert.equal(auto.kind, "resources");
  assert.equal(auto.confirmed, true);
  assert.equal(
    autoAllocation(
      createAllocationSource("y", "unknown.csv", "resource_id,name\nr,A"),
      d.settings,
    ).confirmed,
    false,
  );
});
test("Excel worksheets and CSV feed the same deterministic path", async () => {
  const bytes = readFileSync("public/planning-catalog.xlsx");
  const sheets = await readWorkbook(new Uint8Array(bytes).buffer);
  assert.ok(sheets.length > 1);
  const csv = writeCSV(sheets[0].rows[0], sheets[0].rows.slice(1));
  assert.equal(parseCSV(csv).issues.length, 0);
  const source = createAllocationSource("x", "workbook", csv);
  assert.equal(autoAllocation(source, sampleDraft().settings).confirmed, true);
});
test("untrusted AI responses cannot inject unknown fields or records", () => {
  assert.deepEqual(
    cleanSuggestions(
      [
        {
          column: "Hours",
          field: "max_weekly_hours",
          reason: "Possibly a limit",
        },
        { column: "Hours", field: "admin", reason: "bad" },
        { column: "unknown", field: "name", reason: "bad" },
      ],
      ["Hours"],
      ["max_weekly_hours"],
    ),
    [
      {
        column: "Hours",
        field: "max_weekly_hours",
        reason: "Possibly a limit",
      },
    ],
  );
  assert.throws(
    () => cleanSuggestions({ suggestions: [] }, ["Hours"], ["name"]),
    /invalid response/,
  );
});
test("no assistant endpoint leaves deterministic mapping available", async () => {
  await assert.rejects(
    requestAISuggestions("scheduling", ["Hours"], ["max_weekly_hours"]),
    /private server/,
  );
  assert.equal(
    autoScheduling([createSource("x", "a.csv", staff)], []).ready,
    true,
  );
});

test("AI import metadata is minimized and sensitive representative values are redacted", () => {
  const source = createSource(
    "staff",
    "staff.csv",
    "Worker ID,Worker Name,Work Date,Can Work?\nW001,Ada Lovelace,2026-11-16,YES",
  );
  const profile = profileSourcesForAI([source])[0];
  assert.equal(profile.row_count, 1);
  assert.match(profile.columns[0].samples[0], /^<redacted:/);
  assert.match(profile.columns[1].samples[0], /^<redacted:/);
  assert.deepEqual(profile.columns[2].samples, ["2026-11-16"]);
  assert.deepEqual(profile.columns[3].samples, ["YES"]);
});

test("structured AI mappings are schema checked and preserve unresolved columns", () => {
  const source = createSource(
    "windows",
    "windows.csv",
    "Badge,Day,Time Window,Can Work?\nW001,2026-11-16,14:00-22:00,YES",
  );
  const raw = {
    files: [{
      source_id: "windows",
      datasets: ["availability"],
      destination_note: "",
      columns: [
        { column: "Badge", field: "employee_id", transform: "direct", confidence: .99, reason: "identifier" },
        { column: "Day", field: "date", transform: "date", confidence: .98, reason: "date values" },
        { column: "Time Window", field: "start_time", transform: "time_range", confidence: .96, reason: "range" },
        { column: "Can Work?", field: "status", transform: "status", confidence: .72, reason: "confirm meaning" },
      ],
      corrections: [],
    }],
  };
  const cleaned = cleanImportAnalysis(raw, [source]);
  const applied = applyImportAnalysis([source], cleaned)[0];
  assert.deepEqual(applied.kinds, ["availability"]);
  assert.equal(applied.mappings[2].transform, "time_range");
  assert.equal(applied.mappings[3].state, "suggested");
  assert.equal(aiVerificationRequired([applied], []), true);
  const confirmed = applyImportAnalysis([source], {
    files: [{
      ...cleaned.files[0],
      columns: cleaned.files[0].columns.map((c) => ({ ...c, confidence: .99 })),
    }],
    questions: [],
    requires_verification: false,
  })[0];
  assert.equal(aiVerificationRequired([confirmed], []), false);
  assert.equal(aiVerificationRequired([confirmed], [{ column: "Day", source_value: "2026-11-16", proposed_value: "2026-11-16", reason: "review", substantive: true }]), true);
  assert.throws(
    () => cleanImportAnalysis({ files: [{ ...raw.files[0], columns: [{ ...raw.files[0].columns[0], field: "invented" }] }] }, [source]),
    /invalid column mapping/,
  );
  assert.throws(
    () => cleanImportAnalysis({ files: [{ ...raw.files[0], datasets: ["resources"] }] }, [source]),
    /incompatible with Scheduling/,
  );
  assert.throws(
    () => cleanImportAnalysis({ files: [{ ...raw.files[0], datasets: [], destination_note: "" }] }, [source]),
    /could not match this file to Scheduling/,
  );
});

test("mandatory AI import fails clearly when the private endpoint is absent", async () => {
  const source = createSource("x", "x.csv", "Badge,Day\nW1,2026-11-16");
  await assert.rejects(requestAIImportAnalysis([source]), /configured private server/);
});

test("header row detection skips a title row but keeps ordinary first-row headers", () => {
  assert.equal(
    detectHeaderRow([
      ["Staff report"],
      ["employee_id", "name", "hourly_rate"],
      ["001", "Ada", "20"],
    ]),
    1,
  );
  assert.equal(
    detectHeaderRow([
      ["Badge", "Day"],
      ["W001", "2026-11-16"],
    ]),
    0,
  );
});
test("saved allocation profile with reordered columns requires new-value validation", async () => {
  const { makeAllocationProfile } = await import("../lib/allocation/profiles");
  const d = sampleDraft(),
    source = autoAllocation(
      createAllocationSource("x", "r.csv", exportCatalog(d, "resources")),
      d.settings,
    );
  const profile = makeAllocationProfile(source, "Resource catalog");
  const reordered = createAllocationSource(
    "y",
    "r.csv",
    writeCSV(
      [...source.parsed.headers].reverse(),
      source.parsed.rows.map((r) => [...r].reverse()),
    ),
  );
  assert.equal(
    autoAllocationWithProfiles(reordered, d.settings, [profile]).confirmed,
    true,
  );
  reordered.parsed.rows[0][0] = "maybe";
  const invalid = autoAllocationWithProfiles(reordered, d.settings, [profile]);
  assert.equal(invalid.confirmed, true);
  assert.ok(
    (await import("../lib/allocation/import")).transformAllocationSources(
      [invalid],
      d.settings,
    ).draft.tables.resources[0].pending?.integer,
  );
});

test("safe normalization records original and corrected cell with source row", () => {
  const source = autoScheduling(
    [
      createSource(
        "x",
        "a.csv",
        "employee_id,name,hourly_rate,max_weekly_hours,roles\n001, Ada ,20,40,barista",
      ),
    ],
    [],
  ).sources[0];
  const journal = correctionJournal([source]);
  assert.ok(
    journal.some(
      (c) =>
        c.column === "name" &&
        c.original === " Ada " &&
        c.result === "Ada" &&
        c.row === 2,
    ),
  );
});

type SyntheticFile = {
  id: string;
  name: string;
  text: string;
  dataset: Dataset;
  mappings: [Field, NonNullable<Mapping["transform"]>][];
};
const syntheticFiles: SyntheticFile[] = [
  {
    id: "employees",
    name: "ai_employee.csv",
    text: readFileSync("tests/fixtures/import/ai_employee.csv", "utf8"),
    dataset: "employees",
    mappings: [
      ["employee_id", "direct"],
      ["name", "direct"],
      ["hourly_rate", "direct"],
      ["max_weekly_hours", "direct"],
      ["roles", "direct"],
    ],
  },
  {
    id: "availability",
    name: "ai_availability.csv",
    text: readFileSync("tests/fixtures/import/ai_availability.csv", "utf8"),
    dataset: "availability",
    mappings: [
      ["employee_id", "direct"],
      ["date", "date"],
      ["start_time", "time"],
      ["end_time", "time"],
      ["status", "status"],
    ],
  },
  {
    id: "shifts",
    name: "ai_shifts.csv",
    text: readFileSync("tests/fixtures/import/ai_shifts.csv", "utf8"),
    dataset: "shifts",
    mappings: [
      ["shift_id", "direct"],
      ["date", "date"],
      ["start_time", "time"],
      ["end_time", "time"],
      ["required_count", "direct"],
      ["required_role", "direct"],
    ],
  },
];

function interpretedSources(files = syntheticFiles, options: {
  confidence?: number;
  employeeOnly?: boolean;
} = {}) {
  const sources = files.map((file) =>
    createSource(file.id, file.name, file.text),
  );
  const raw = {
    files: sources.map((source) => {
      const fixture = files.find((file) => file.id === source.id)!;
      return {
        source_id: source.id,
        datasets: [fixture.dataset],
        destination_note: "",
        columns: source.parsed.headers.map((column, index) => {
          const [field, transform] = fixture.mappings[index];
          return {
            column,
            field,
            transform,
            confidence: options.confidence ?? 0.99,
            reason: "Synthetic fixture mapping",
          };
        }),
        corrections: [],
      };
    }),
    questions: options.employeeOnly
      ? []
      : [{
          id: "model:objective",
          prompt: "Choose an optimization objective.",
          answer_type: "choice",
          options: ["minimize_cost", "maximize_output"],
          target: "model.objective",
          required: true,
        }],
    requires_verification: !options.employeeOnly,
  };
  const analysis = cleanImportAnalysis(raw, sources);
  return { sources, analysis };
}

test("AI mappings populate all Scheduling preview datasets with provenance despite model questions", () => {
  const { sources, analysis } = interpretedSources();
  const prepared = prepareAIImport(sources, analysis);
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
  const validation = validateDraft(prepared.draft, rules);
  assert.equal(analysis.requires_verification, true);
  assert.equal(prepared.requiresMappingReview, false);
  assert.equal(prepared.draft.employees.length, 1);
  assert.equal(prepared.draft.availability.length, 1);
  assert.equal(prepared.draft.shifts.length, 1);
  assert.deepEqual(validation.data.employees[0], {
    employee_id: "EMP-001",
    name: "Example Worker",
    hourly_rate: 20,
    max_weekly_hours: 40,
    roles: ["Picker"],
  });
  assert.equal(validation.data.availability[0].status, "available");
  assert.equal(validation.data.shifts[0].shift_id, "SHIFT-001");
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  for (const kind of ["employees", "availability", "shifts"] as const) {
    assert.deepEqual(prepared.draft[kind][0].sources, [{
      fileId: kind,
      file: `ai_${kind === "employees" ? "employee" : kind}.csv`,
      row: 2,
    }]);
  }
});

test("employee-only AI imports retain employee data and report genuinely missing datasets", () => {
  const { sources, analysis } = interpretedSources(
    syntheticFiles.slice(0, 1),
    { employeeOnly: true },
  );
  const prepared = prepareAIImport(sources, analysis);
  const validation = validateDraft(prepared.draft, emptyRules);
  assert.equal(prepared.draft.employees.length, 1);
  assert.deepEqual(prepared.draft.availability, []);
  assert.deepEqual(prepared.draft.shifts, []);
  assert.deepEqual(
    validation.issues
      .filter((issue) => issue.code === "empty")
      .map((issue) => issue.dataset)
      .sort(),
    ["availability", "shifts"],
  );
});

test("ambiguous AI mappings populate provisional records and block acceptance pending clarification", () => {
  const ambiguous: SyntheticFile[] = [{
    ...syntheticFiles[0],
    text: "employee_id,name,rate,max_weekly_hours,roles\nEMP-001,Example Worker,20,40,Picker",
    mappings: [
      ["employee_id", "direct"],
      ["name", "direct"],
      ["hourly_rate", "direct"],
      ["max_weekly_hours", "direct"],
      ["roles", "direct"],
    ],
  }];
  const { sources, analysis } = interpretedSources(ambiguous, {
    confidence: 0.65,
    employeeOnly: true,
  });
  const prepared = prepareAIImport(sources, analysis);
  assert.equal(prepared.requiresMappingReview, true);
  assert.equal(prepared.draft.employees.length, 1);
  assert.equal(prepared.draft.employees[0].values.hourly_rate, "20");
  assert.match(
    prepared.draft.employees[0].pending?.hourly_rate || "",
    /Confirm this suggested source-column mapping/,
  );
  assert.equal(prepared.sources[0].mappings[2].state, "suggested");
  assert.ok(prepared.issues.some((issue) => issue.code === "confirmation"));
  assert.equal(
    validateDraft(prepared.draft, emptyRules, "employees").valid,
    false,
  );
});

test("invalid AI-mapped values remain visible with source provenance and block validation", () => {
  const availability = {
    ...syntheticFiles[1],
    text: readFileSync("tests/fixtures/import/ai_availability.csv", "utf8")
      .replace("available", "maybe"),
  };
  const { sources, analysis } = interpretedSources([availability]);
  const prepared = prepareAIImport(sources, analysis);
  const row = prepared.draft.availability[0];
  assert.equal(row.values.status, "maybe");
  assert.equal(row.pending?.status, "Confirm how this status maps to available or unavailable.");
  assert.deepEqual(row.sources, [{
    fileId: "availability",
    file: "ai_availability.csv",
    row: 2,
  }]);
  assert.equal(
    validateDraft(prepared.draft, emptyRules, "availability").valid,
    false,
  );
});

test("dataset readiness distinguishes uploaded, identified, validated, and missing data", () => {
  const { sources, analysis } = interpretedSources(
    syntheticFiles.slice(0, 1),
    { employeeOnly: true },
  );
  const empty = {
    employees: [],
    availability: [],
    shifts: [],
  };
  assert.deepEqual(
    datasetReadiness([], empty, [], emptyRules, false, false),
    { employees: "Missing", availability: "Missing", shifts: "Missing" },
  );
  assert.deepEqual(
    datasetReadiness(sources, empty, [], emptyRules, false, false),
    { employees: "Uploaded", availability: "Uploaded", shifts: "Uploaded" },
  );
  const prepared = prepareAIImport(sources, analysis);
  assert.deepEqual(
    datasetReadiness(
      prepared.sources,
      prepared.draft,
      prepared.issues,
      emptyRules,
      true,
      false,
    ),
    { employees: "Validated", availability: "Missing", shifts: "Missing" },
  );
  assert.equal(
    datasetReadiness(
      prepared.sources,
      prepared.draft,
      prepared.issues,
      emptyRules,
      true,
      true,
    ).employees,
    "Identified",
  );
});
