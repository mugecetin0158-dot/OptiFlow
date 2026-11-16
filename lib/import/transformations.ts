import {
  Dataset,
  ImportSource,
  Mapping,
  Normalization,
  previewFields,
  schemas,
} from "./types";
import {
  normalizeDate,
  normalizeDecimal,
  normalizeRoles,
  normalizeStatus,
  normalizeTime,
  validISO,
} from "./normalize";

export function transformation(m: Mapping): NonNullable<Mapping["transform"]> {
  if (m.transform) return m.transform;
  if (m.target.endsWith("date")) return "date";
  if (m.target.endsWith("time")) return "time";
  if (m.target === "status") return "status";
  return "direct";
}
export function mappingOutputs(m: Mapping): string[] {
  if (!m.target || m.target === "ignore") return [];
  return transformation(m) === "time_range"
    ? [m.target, m.target.replace(/start_time$/, "end_time")]
    : [m.target];
}
export function canonicalField(target: string, kind: Dataset): string | null {
  if (previewFields(kind).includes(target)) return target;
  const prefix = kind === "shifts" ? "shift_" : "availability_";
  const field =
    kind !== "employees" && target.startsWith(prefix)
      ? target.slice(prefix.length)
      : target;
  return previewFields(kind).includes(field) ? field : null;
}
export function missingMappings(source: ImportSource) {
  return source.kinds.flatMap((kind) =>
    schemas[kind]
      .filter(
        (field) =>
          !source.mappings.some((m) =>
            mappingOutputs(m).some((o) => canonicalField(o, kind) === field),
          ),
      )
      .map((field) => ({ kind, field })),
  );
}
export function configurationError(m: Mapping): string | null {
  if (!m.target || m.target === "ignore") return null;
  const mode = transformation(m);
  if (
    mode === "time_range" &&
    !/^(availability_|shift_)?start_time$/.test(m.target)
  )
    return "A time-range transformation must target start_time and end_time.";
  if (mode === "date" && !m.target.endsWith("date"))
    return "Date parsing requires a date field.";
  if (mode === "time" && !m.target.endsWith("time"))
    return "Time parsing requires a time field.";
  if (mode === "status" && m.target !== "status")
    return "Status normalization requires the status field.";
  return null;
}
export function splitTimeRange(raw: string) {
  const parts = raw.trim().split(/\s*[-–—]\s*/);
  if (parts.length !== 2 || parts.some((p) => !p))
    throw Error(
      "Use a complete time range, for example 09:00–17:00 or 9 AM - 5 PM.",
    );
  if (/am|pm/i.test(parts[0]) !== /am|pm/i.test(parts[1]))
    throw Error("Specify AM/PM on both times, or use 24-hour times.");
  const start = normalizeTime(parts[0]),
    end = normalizeTime(parts[1]);
  if (start === end)
    throw Error(
      "Equal start and end times are ambiguous. Supply separate times and an explicit end date.",
    );
  return { start_time: start, end_time: end, overnight: end < start };
}
export function nextDate(date: string) {
  if (!validISO(date))
    throw Error(
      "A valid start date is required to derive the next-day end date.",
    );
  const next = new Date(date + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const result = next.toISOString().slice(0, 10);
  if (!validISO(result))
    throw Error("End date is outside the supported calendar range.");
  return result;
}
// Pure per-cell transform, shared by the mapper preview and the import pipeline.
export function transformCell(
  raw: string,
  m: Mapping,
  options: Normalization,
): Record<string, string> {
  const problem = configurationError(m);
  if (problem) throw Error(problem);
  if (!m.target || m.target === "ignore") return {};
  const value = raw.trim(),
    mode = transformation(m);
  if (!value) return Object.fromEntries(mappingOutputs(m).map((f) => [f, ""]));
  if (mode === "time_range") {
    const range = splitTimeRange(value);
    return {
      [m.target]: range.start_time,
      [m.target.replace(/start_time$/, "end_time")]: range.end_time,
    };
  }
  let result = value;
  if (mode === "date") result = normalizeDate(value, options.dateOrder);
  else if (mode === "time") result = normalizeTime(value);
  else if (mode === "status")
    result = normalizeStatus(value, options.statusMap);
  else if (m.target === "hourly_rate" || m.target === "max_weekly_hours")
    result = normalizeDecimal(value, options.decimal);
  else if (m.target === "roles")
    result = JSON.stringify(normalizeRoles(value, options.roleSeparator));
  return { [m.target]: result };
}

export function transformRow(
  source: ImportSource,
  row: string[],
  kind: Dataset,
) {
  const values: Record<string, string> = Object.fromEntries(
    schemas[kind].map((f) => [f, ""]),
  );
  const pending: Record<string, string> = {};
  for (const [col, mapping] of source.mappings.entries()) {
    const outputs = mappingOutputs(mapping)
      .map((o) => canonicalField(o, kind))
      .filter((f): f is string => !!f);
    if (!outputs.length) continue;
    const raw = row[col] || "";
    try {
      for (const [target, value] of Object.entries(
        transformCell(raw, mapping, source.options),
      )) {
        const field = canonicalField(target, kind);
        if (field) values[field] = value;
      }
    } catch (error) {
      for (const field of outputs) {
        values[field] = raw; // Never discard an unrecognized source value.
        pending[field] = (error as Error).message;
      }
    }
  }
  if (kind !== "employees") {
    const ranges = source.mappings.filter(
      (m) =>
        transformation(m) === "time_range" && canonicalField(m.target, kind),
    );
    if (
      ranges.length &&
      !pending.start_time &&
      !pending.end_time &&
      values.start_time &&
      values.end_time &&
      values.end_time < values.start_time &&
      !values.end_date
    ) {
      if (ranges.every((m) => m.overnight === "next_day")) {
        try {
          values.end_date = nextDate(values.date);
        } catch (error) {
          pending.end_date = (error as Error).message;
        }
      } else
        pending.end_date =
          "Overnight interval: confirm next-day interpretation or supply an explicit end_date.";
    }
  }
  return { values, pending };
}
