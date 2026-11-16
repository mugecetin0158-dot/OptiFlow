import { Issue, ParsedCSV } from "./types";
export const MAX_BYTES = 2 * 1024 * 1024,
  MAX_ROWS = 5000,
  MAX_FILES = 10;
export function decodeCSV(
  bytes: Uint8Array,
  encoding = "auto",
): { text: string; encoding: string } {
  if (bytes.byteLength > MAX_BYTES)
    throw new Error("File exceeds the 2 MB limit.");
  let chosen = encoding;
  if (chosen === "auto") {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) chosen = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) chosen = "utf-16be";
    else chosen = "utf-8";
  }
  if (
    !["utf-8", "utf-16le", "utf-16be", "windows-1252", "windows-1254"].includes(
      chosen,
    )
  )
    throw new Error("Unsupported encoding.");
  try {
    const text = new TextDecoder(chosen, { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
    if (text.includes("\0")) throw Error();
    return { text, encoding: chosen };
  } catch {
    throw new Error(
      "Cannot decode this file. Select its encoding and upload it again.",
    );
  }
}
function headerCounts(text: string) {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted) {
      if (c === "\n" || c === "\r") break;
      if (c in counts) counts[c]++;
    }
  }
  return counts;
}
export function parseCSV(text: string, chosen = "auto"): ParsedCSV {
  text = text.replace(/^\uFEFF/, "");
  const issues: Issue[] = [];
  const fail = (message: string, detail = "") =>
    issues.push({ severity: "error", code: "csv", message, detail });
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    fail("File exceeds the 2 MB limit.");
    return {
      headers: [],
      rows: [],
      lineNumbers: [],
      delimiter: chosen,
      issues,
    };
  }
  let delimiter = chosen;
  if (chosen === "auto") {
    const entries = Object.entries(headerCounts(text)).sort(
      (a, b) => b[1] - a[1],
    );
    if (entries[0][1] && entries[0][1] === entries[1][1])
      fail("Delimiter is ambiguous. Choose a delimiter explicitly.");
    delimiter = entries[0][1] ? entries[0][0] : ",";
  }
  if (![",", ";"].includes(delimiter)) {
    fail("Unsupported delimiter.");
    return { headers: [], rows: [], lineNumbers: [], delimiter, issues };
  }
  const records: string[][] = [],
    lines: number[] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false,
    line = 1,
    start = 1;
  const finish = () => {
    row.push(cell);
    if (row.length > 1 || closed || row.some((v) => v.trim() !== "")) {
      records.push(row);
      lines.push(start);
    }
    row = [];
    cell = "";
    closed = false;
    start = line + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += c;
        if (c === "\r") {
          if (text[i + 1] === "\n") {
            cell += "\n";
            i++;
          }
          line++;
        } else if (c === "\n") line++;
      }
      continue;
    }
    if (c === delimiter) {
      row.push(cell);
      cell = "";
      closed = false;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finish();
      line++;
      if (records.length > MAX_ROWS + 1) {
        fail("File exceeds the 5,000-row limit.");
        break;
      }
      continue;
    }
    if (closed) {
      if (c === " " || c === "\t") continue;
      fail("Unexpected characters after a quoted value.", `Line ${line}`);
      closed = false;
      cell += c;
      continue;
    }
    if (c === '"') {
      if (cell === "") quoted = true;
      else {
        fail("Unexpected quote in an unquoted value.", `Line ${line}`);
        cell += c;
      }
    } else cell += c;
  }
  if (quoted)
    fail("Unclosed quoted value. Check the source CSV.", `Line ${start}`);
  if (cell !== "" || row.length || closed) finish();
  if (!records.length) {
    fail("The file is empty.");
    return { headers: [], rows: [], lineNumbers: [], delimiter, issues };
  }
  const headers = records.shift()!.map((v) => v.trim());
  lines.shift();
  if (headers.some((h) => !h)) fail("Every column needs a nonempty header.");
  if (
    new Set(headers.map((h) => h.toLocaleLowerCase())).size !== headers.length
  )
    fail("Duplicate column headers must be renamed in the source CSV.");
  if (headers.length > 80) fail("File exceeds the 80-column limit.");
  records.forEach((r, i) => {
    if (r.length !== headers.length)
      fail(
        "Row length does not match the header.",
        `Line ${lines[i]}: ${r.length} / ${headers.length}`,
      );
  });
  if (records.length > MAX_ROWS) fail("File exceeds the 5,000-row limit.");
  if (!records.length) fail("The file has headers but no records.");
  return {
    headers,
    rows: records,
    lineNumbers: lines,
    delimiter,
    issues: issues.slice(0, 100),
  };
}
export function writeCSV(headers: string[], rows: string[][]) {
  const q = (s: string) => '"' + String(s).replaceAll('"', '""') + '"';
  return (
    "\uFEFF" + [headers, ...rows].map((r) => r.map(q).join(",")).join("\r\n")
  );
}
