import { Dataset, Field, Mapping, ImportSource } from "./types";
import {
  mappingOutputs,
  configurationError,
  canonicalField,
} from "./transformations";
import { parseCSV } from "./csv";
export const normalizeHeader = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[_\-./()\[\]:]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
// Exact aliases only. Add business-specific aliases here; fuzzy guesses are never accepted.
export const aliases: Partial<Record<Field, string[]>> = {
  employee_id: [
    "employee id",
    "badge",
    "staff id",
    "staff number",
    "emp no",
    "worker id",
    "personnel number",
    "personel no",
    "calisan id",
    "matricule",
    "id employe",
  ],
  name: [
    "name",
    "employee name",
    "full name",
    "staff name",
    "worker name",
    "ad soyad",
    "nom complet",
    "nom employe",
  ],
  hourly_rate: [
    "hourly rate",
    "hourly wage",
    "hourly pay",
    "pay per hour",
    "hourly salary",
    "saatlik ucret",
    "taux horaire",
  ],
  max_weekly_hours: [
    "max weekly hours",
    "maximum weekly hours",
    "weekly hour limit",
    "max hours per week",
    "haftalik azami saat",
    "heures hebdomadaires maximum",
  ],
  roles: ["roles", "role"],
  date: ["date", "tarih", "day", "work date"],
  start_time: ["start time", "begin time", "baslangic saati", "heure de debut"],
  end_time: ["end time", "finish time", "bitis saati", "heure de fin"],
  status: [
    "can work",
    "availability status",
    "availability",
    "disponibilite",
    "uygunluk",
  ],
  shift_id: ["shift id", "requirement id", "demand id", "vardiya id"],
  required_count: [
    "required count",
    "required staff",
    "required employees",
    "staff needed",
    "staffing requirement",
    "minimum staffing",
    "gerekli personel",
    "effectif requis",
  ],
  required_role: [
    "required role",
    "required skill",
    "gerekli rol",
    "role requis",
  ],
  availability_date: ["availability date", "available date"],
  availability_start_time: ["availability start", "available from"],
  availability_end_time: ["availability end", "available until"],
  shift_date: ["shift date", "requirement date"],
  shift_start_time: ["shift start", "shift start time"],
  shift_end_time: ["shift end", "shift end time"],
  end_date: ["end date"],
  availability_end_date: ["availability end date"],
  shift_end_date: ["shift end date"],
};
const uncertain: Record<string, Field> = {
  hours: "max_weekly_hours",
  rate: "hourly_rate",
  salary: "hourly_rate",
  "job title": "roles",
  position: "roles",
  skills: "roles",
  "max hours": "max_weekly_hours",
  status: "status",
  "time off": "status",
  approved: "status",
  start: "start_time",
  end: "end_time",
  count: "required_count",
  headcount: "required_count",
};
export function recognize(headers: string[], dictionary = aliases): Mapping[] {
  return headers.map((h) => {
    const key = normalizeHeader(h);
    if (["time window", "available hours", "time range"].includes(key))
      return {
        target: "start_time",
        transform: "time_range",
        overnight: "ask",
        state: "suggested",
        reason:
          "Time range detected. Confirm the transformation and dataset meaning.",
      };
    if (Object.prototype.hasOwnProperty.call(uncertain, key))
      return {
        target: uncertain[key],
        state: "suggested",
        reason: "Ambiguous meaning. Confirm or change this mapping.",
      };
    const matches = Object.entries(dictionary).filter(([target, values]) =>
      [target, ...values!].some((v) => normalizeHeader(v) === key),
    );
    if (matches.length === 1)
      return {
        target: matches[0][0] as Field,
        state: "auto",
        reason: "Exact recognized alias",
      };
    return {
      target: "",
      state: "unmapped",
      reason:
        /monday|tuesday|wednesday|thursday|friday|saturday|sunday|pazartesi|lundi/.test(
          key,
        )
          ? "Wide schedules require explicit dates and separate rows."
          : "No safe match. Keep unmapped or choose a field.",
    };
  });
}
export function suggestedKinds(mappings: Mapping[]): Dataset[] {
  const fields = mappings
    .filter((m) => m.state === "auto")
    .map((m) => m.target);
  const kinds: Dataset[] = [];
  if (
    fields.includes("employee_id") &&
    (fields.includes("name") || fields.includes("hourly_rate"))
  )
    kinds.push("employees");
  if (
    fields.includes("status") ||
    fields.some((f) => String(f).startsWith("availability_"))
  )
    kinds.push("availability");
  if (fields.includes("required_count") && fields.includes("required_role"))
    kinds.push("shifts");
  return kinds;
}
export function createSource(
  id: string,
  name: string,
  text: string,
  encoding = "utf-8",
  delimiter = "auto",
): ImportSource {
  const parsed = parseCSV(text, delimiter);
  const mappings = recognize(parsed.headers);
  return {
    id,
    name,
    text,
    originalText: text,
    encoding,
    delimiter,
    parsed,
    mappings,
    kinds: suggestedKinds(mappings),
    confirmed: false,
    options: { dateOrder: "", decimal: "", roleSeparator: "", statusMap: {} },
  };
}
export function mappingConflicts(source: ImportSource): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  source.mappings.forEach((m) => {
    const config = configurationError(m);
    if (config) errors.push(config);
    for (const target of mappingOutputs(m)) {
      if (seen.has(target)) errors.push(target);
      seen.add(target);
      if (
        source.kinds.length &&
        !source.kinds.some((kind) => canonicalField(target, kind))
      )
        errors.push(`${target} → ${source.kinds.join(", ")}`);
    }
  });
  for (const kind of source.kinds) {
    const resolved = new Set<string>();
    for (const m of source.mappings)
      for (const output of mappingOutputs(m)) {
        const field = canonicalField(output, kind);
        if (field && resolved.has(field)) errors.push(`${kind}.${field}`);
        if (field) resolved.add(field);
      }
  }
  return errors;
}
