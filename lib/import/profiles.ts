import { ImportProfile, ImportSource, fields } from "./types";
import { mappingIssues } from "./stages";
import { normalizeHeader, mappingConflicts } from "./recognition";
export function matchingProfile(profile: ImportProfile, headers: string[]) {
  const a = profile.headers.map(normalizeHeader),
    b = headers.map(normalizeHeader);
  return (
    new Set(a).size === a.length &&
    new Set(b).size === b.length &&
    a.length === b.length &&
    a.every((h) => b.includes(h))
  );
}
export function makeProfile(
  source: ImportSource,
  name: string,
  id: string,
): ImportProfile {
  if (!name.trim()) throw Error("Give the profile a name.");
  if (
    !source.confirmed ||
    source.mappings.some((m) => m.state === "suggested") ||
    mappingConflicts(source).length ||
    mappingIssues(source, true).some((i) => i.severity === "error")
  )
    throw Error(
      "Confirm the dataset types and resolve mappings before saving a profile.",
    );
  return {
    id,
    name: name.trim(),
    headers: [...source.parsed.headers],
    mappings: structuredClone(source.mappings),
    kinds: [...source.kinds],
    options: structuredClone(source.options),
    updatedAt: new Date().toISOString(),
  };
}
export function applyProfile(
  source: ImportSource,
  profile: ImportProfile,
): ImportSource {
  if (!matchingProfile(profile, source.parsed.headers))
    throw Error("Profile columns do not match this file.");
  if (
    profile.mappings.some(
      (m) => m.target && m.target !== "ignore" && !fields.includes(m.target),
    )
  )
    throw Error("Profile contains an unsupported target field.");
  return {
    ...source,
    mappings: source.parsed.headers.map((h) => {
      const index = profile.headers.findIndex(
        (p) => normalizeHeader(p) === normalizeHeader(h),
      );
      return {
        ...profile.mappings[index],
        state: "confirmed",
        reason: "Reused profile. New values still require validation.",
      };
    }),
    kinds: [...profile.kinds],
    options: structuredClone(profile.options),
    confirmed: false,
  };
}
