import { AllocationSource, requiredColumns } from "./import";
import { columns, Table } from "./types";
import { normalizeHeader } from "../import/recognition";
export type AllocationProfile = {
  version: 1;
  id: string;
  name: string;
  kind: Table;
  headers: string[];
  mappings: string[];
  decimal: AllocationSource["decimal"];
};
export const PROFILE_KEY = "optiflow-allocation-profiles-v1";
export function makeAllocationProfile(
  source: AllocationSource,
  name: string,
): AllocationProfile {
  if (
    !source.confirmed ||
    !source.kind ||
    source.kind === "ignore" ||
    source.kind === "model_settings" ||
    !name.trim()
  )
    throw Error("Confirm dataset meanings and enter a profile name first.");
  const mapped = source.mappings.filter((m) => m && m !== "ignore");
  if (
    new Set(mapped).size !== mapped.length ||
    mapped.some((m) => !columns[source.kind as Table].includes(m)) ||
    requiredColumns(source.kind, "cost").some((m) => !mapped.includes(m))
  )
    throw Error(
      "Resolve missing or conflicting required mappings before saving a profile.",
    );
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: name.trim(),
    kind: source.kind,
    headers: source.parsed.headers.map(normalizeHeader),
    mappings: [...source.mappings],
    decimal: source.decimal,
  };
}
export function applyAllocationProfile(
  source: AllocationSource,
  profile: AllocationProfile,
): AllocationSource {
  if (
    profile.version !== 1 ||
    !columns[profile.kind] ||
    !Array.isArray(profile.headers) ||
    !Array.isArray(profile.mappings) ||
    profile.headers.length !== profile.mappings.length ||
    !["", "dot", "comma"].includes(profile.decimal)
  )
    throw Error("Invalid import profile.");
  const headers = source.parsed.headers.map(normalizeHeader);
  if (
    new Set(headers).size !== headers.length ||
    new Set(profile.headers).size !== profile.headers.length ||
    headers.length !== profile.headers.length ||
    headers.some((h) => !profile.headers.includes(h))
  )
    throw Error(
      "This profile requires the same source headers (column order may differ).",
    );
  const mappings = headers.map(
    (h) => profile.mappings[profile.headers.indexOf(h)],
  );
  if (
    mappings.some(
      (m) => m && m !== "ignore" && !columns[profile.kind].includes(m),
    )
  )
    throw Error("Profile contains an incompatible mapping.");
  return {
    ...source,
    kind: profile.kind,
    decimal: profile.decimal,
    mappings,
    confirmed: false,
  };
}
