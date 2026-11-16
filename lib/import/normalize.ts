import { Normalization } from "./types";
export function validISO(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function normalizeDate(
  input: string,
  order: Normalization["dateOrder"] = "",
): string {
  const s = input.trim();
  if (!s) return "";
  if (validISO(s)) return s;
  let y: string, m: string, d: string;
  let match = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (match) {
    [, y, m, d] = match;
  } else {
    match = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
    if (!match) throw Error("Invalid calendar date.");
    if (!order) {
      const a = +match[1],
        b = +match[2];
      if (a > 12 && b <= 12) order = "DMY";
      else if (b > 12 && a <= 12) order = "MDY";
      else if (a === b) order = "DMY";
      else throw Error("Choose DMY or MDY for non-ISO dates.");
    }
    [, d, m, y] = match;
    if (order === "MDY") [d, m] = [m, d];
  }
  const result = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (!validISO(result)) throw Error("Invalid calendar date.");
  return result;
}
export function normalizeTime(input: string) {
  const s = input.trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) throw Error("Use HH:mm or an explicit AM/PM time.");
  let h = +m[1];
  const min = +(m[2] || "0");
  if (m[3]) {
    if (h < 1 || h > 12) throw Error("Invalid time.");
    h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  }
  if (h > 23 || min > 59) throw Error("Invalid time.");
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
export function normalizeDecimal(
  input: string,
  mode: Normalization["decimal"] = "",
): string {
  const s = input.trim();
  if (!s) return "";
  if (/^[-+]?\d+$/.test(s)) return String(Number(s));
  if (!mode) throw Error("Choose a decimal convention for fractional values.");
  const re = mode === "dot" ? /^[-+]?\d+(?:\.\d+)?$/ : /^[-+]?\d+(?:,\d+)?$/;
  if (!re.test(s))
    throw Error(
      "Invalid decimal. Currency symbols and thousands separators are not supported.",
    );
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) throw Error("Invalid number.");
  return String(n);
}
export function normalizeRoles(
  s: string,
  separator: Normalization["roleSeparator"],
) {
  if (s.trim().startsWith("[")) {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string"))
      throw Error("Roles must be a JSON list of role names.");
    return [...new Set(parsed.map((v) => v.trim()).filter(Boolean))];
  }
  return [
    ...new Set(
      (separator ? s.split(separator) : [s])
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}
export function normalizeStatus(s: string, map: Normalization["statusMap"]) {
  const key = s.trim().toLowerCase();
  if (!key) return "";
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  const known: Record<string, string> = {
    yes: "available",
    no: "unavailable",
    available: "available",
    unavailable: "unavailable",
    disponible: "available",
    indisponible: "unavailable",
    uygun: "available",
    "uygun değil": "unavailable",
    "uygun degil": "unavailable",
  };
  if (Object.prototype.hasOwnProperty.call(known, key)) return known[key];
  throw Error("Confirm how this status maps to available or unavailable.");
}
export const timeMinutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
