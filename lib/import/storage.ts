import {
  SavedImport,
  Rules,
  ImportDraft,
  Issue,
  ImportProfile,
  schemas,
  datasets,
  fields,
} from "./types";
import { validateDraft } from "./validation";
import { writeCSV } from "./csv";
export const DATA_KEY = "optiflow-smart-import-v1",
  RULES_KEY = "optiflow-import-rules-v1",
  PROFILE_KEY = "optiflow-import-profiles-v1";
export type LocalStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function saveValidated(
  store: LocalStore,
  draft: ImportDraft,
  rules: Rules,
  unmapped: SavedImport["unmapped"],
  pipelineIssues: Issue[] = [],
  corrections: NonNullable<SavedImport["corrections"]> = [],
): SavedImport {
  const check = validateDraft(draft, rules);
  if (!check.valid || pipelineIssues.some((i) => i.severity === "error"))
    throw Error("Resolve all blocking errors before saving.");
  const revision = JSON.stringify(rules);
  const saved: SavedImport = {
    version: 1,
    savedAt: new Date().toISOString(),
    data: check.data,
    draft: structuredClone(draft),
    issues: [
      ...pipelineIssues.filter((i) => i.severity === "warning"),
      ...check.issues,
    ],
    unmapped,
    corrections: structuredClone(corrections),
    rulesRevision: revision,
  };
  const oldData = store.getItem(DATA_KEY),
    oldRules = store.getItem(RULES_KEY);
  try {
    store.setItem(RULES_KEY, revision);
    store.setItem(DATA_KEY, JSON.stringify(saved));
  } catch {
    try {
      oldRules === null
        ? store.removeItem(RULES_KEY)
        : store.setItem(RULES_KEY, oldRules);
      oldData === null
        ? store.removeItem(DATA_KEY)
        : store.setItem(DATA_KEY, oldData);
    } catch {}
    throw Error(
      "Browser storage is full or unavailable. Nothing was confirmed. Export the CSV files instead.",
    );
  }
  return saved;
}
export function loadValidated(
  store: LocalStore,
): { saved: SavedImport; rules: Rules } | null {
  const raw = store.getItem(DATA_KEY),
    config = store.getItem(RULES_KEY);
  if (!raw && !config) return null;
  if (!raw || !config)
    throw Error("Saved import is incomplete. Review and save it again.");
  try {
    const saved = JSON.parse(raw) as SavedImport,
      rules = JSON.parse(config) as Rules;
    if (
      saved.version !== 1 ||
      saved.rulesRevision !== JSON.stringify(rules) ||
      !validateDraft(saved.draft, rules).valid
    )
      throw Error();
    return {
      saved: { ...saved, data: validateDraft(saved.draft, rules).data },
      rules,
    };
  } catch {
    throw Error(
      "Saved import failed validation. Review the data before using it.",
    );
  }
}
export function exportStandard(
  data: SavedImport["data"],
  kind: (typeof datasets)[number],
) {
  const headers =
    kind !== "employees" &&
    data[kind].some((r) => r.end_date && r.end_date !== r.date)
      ? [...schemas[kind], "end_date"]
      : schemas[kind];
  const rows = data[kind].map((record) =>
    headers.map((field) => {
      const value =
        (record as any)[field] ??
        (field === "end_date" ? (record as any).date : "");
      return Array.isArray(value) ? JSON.stringify(value) : String(value);
    }),
  );
  return writeCSV(headers, rows);
}
export function loadProfiles(store: LocalStore): ImportProfile[] {
  const raw = store.getItem(PROFILE_KEY);
  if (!raw) return [];
  const profiles = JSON.parse(raw);
  if (
    !Array.isArray(profiles) ||
    profiles.some(
      (p) =>
        !p.id ||
        !p.name ||
        !Array.isArray(p.headers) ||
        !Array.isArray(p.mappings) ||
        p.headers.length !== p.mappings.length ||
        !p.options ||
        !Array.isArray(p.kinds) ||
        p.kinds.some((k) => !datasets.includes(k)) ||
        p.headers.some((h) => typeof h !== "string") ||
        p.mappings.some(
          (m) =>
            !m ||
            (m.transform !== undefined &&
              !["direct", "date", "time", "status", "time_range"].includes(
                m.transform,
              )) ||
            (m.overnight !== undefined &&
              !["ask", "next_day"].includes(m.overnight)) ||
            !["auto", "suggested", "confirmed", "unmapped"].includes(m.state) ||
            (m.target !== "" &&
              m.target !== "ignore" &&
              !fields.includes(m.target)),
        ) ||
        !["", "DMY", "MDY"].includes(p.options.dateOrder) ||
        !["", "dot", "comma"].includes(p.options.decimal) ||
        !["", "|", ";", ","].includes(p.options.roleSeparator) ||
        !p.options.statusMap ||
        Object.values(p.options.statusMap).some(
          (s) => s !== "available" && s !== "unavailable",
        ),
    )
  )
    throw Error("Saved profiles could not be read.");
  return profiles;
}
export function saveProfiles(store: LocalStore, profiles: ImportProfile[]) {
  if (profiles.some((p) => !p.name.trim()))
    throw Error("Give the profile a name.");
  try {
    store.setItem(PROFILE_KEY, JSON.stringify(profiles));
  } catch {
    throw Error("Profile storage is full or unavailable.");
  }
}
