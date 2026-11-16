import { Plan, Run, Scenario } from "./types";
export interface Repository {
  listScenarios(): Promise<Scenario[]>;
  listRuns(): Promise<Run[]>;
  saveScenario(s: Scenario): Promise<void>;
  saveRun(r: Run): Promise<void>;
  deleteScenario(id: string): Promise<void>;
  deleteRun(id: string): Promise<void>;
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("optiflow-planning", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("scenarios", { keyPath: "id" });
      r.result.createObjectStore("runs", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(Error("Local history storage is unavailable."));
  });
}
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let value: T;
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        Error(
          "History storage failed or quota was exceeded. No save was confirmed.",
        ),
      );
    };
  });
}
export const repository: Repository = {
  listScenarios: () => transaction("scenarios", "readonly", (s) => s.getAll()),
  listRuns: () => transaction("runs", "readonly", (s) => s.getAll()),
  saveScenario: async (s) => {
    await transaction("scenarios", "readwrite", (o) =>
      o.put(structuredClone(s)),
    );
  },
  saveRun: async (r) => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("runs", "readwrite"),
        store = tx.objectStore("runs");
      const request = store.get(r.id);
      request.onsuccess = () => {
        const previous = request.result as Run | undefined;
        if (
          previous &&
          (previous.status !== "running" ||
            previous.hash !== r.hash ||
            canonical(previous.input) !== canonical(r.input))
        ) {
          tx.abort();
          return;
        }
        store.put(structuredClone(r));
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(
          Error(
            "Run save failed. Completed run snapshots cannot be overwritten; check local storage quota.",
          ),
        );
      };
    });
  },
  deleteScenario: async (id) => {
    await transaction("scenarios", "readwrite", (o) => o.delete(id));
  },
  deleteRun: async (id) => {
    await transaction("runs", "readwrite", (o) => o.delete(id));
  },
};
export function canonical(value: unknown): string {
  if (Array.isArray(value))
    return (
      "[" +
      value.map((v) => (v === undefined ? "null" : canonical(v))).join(",") +
      "]"
    );
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .filter((k) => (value as any)[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical((value as any)[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function hashPlan(p: Plan) {
  const b = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(p)),
  );
  return Array.from(new Uint8Array(b), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function recover(repo: Repository) {
  const runs = await repo.listRuns();
  for (const r of runs)
    if (
      r.status === "running" &&
      Date.now() > Date.parse(r.createdAt) + (r.settings.seconds + 40) * 1000
    ) {
      r.status = "interrupted";
      r.finishedAt = new Date().toISOString();
      r.message =
        "No completion was recorded before the worker deadline. This run was interrupted.";
      await repo.saveRun(r);
    }
  return runs;
}
export function duplicate(s: Scenario): Scenario {
  return {
    ...structuredClone(s),
    id: crypto.randomUUID(),
    revision: 1,
    name: s.name + " (copy)",
    plan: { ...structuredClone(s.plan), name: s.name + " (copy)" },
    updatedAt: new Date().toISOString(),
  };
}
export function comparison(a: Run, b: Run) {
  const reasons: string[] = [];
  if (
    !a.verification?.verified ||
    !b.verification?.verified ||
    !["OPTIMAL", "FEASIBLE"].includes(a.status) ||
    !["OPTIMAL", "FEASIBLE"].includes(b.status)
  )
    reasons.push("Both runs require verified feasible results.");
  const currencies = (r: Run) =>
    r.input.periods.map((p) => p.draft.settings.currency);
  if (canonical(currencies(a)) !== canonical(currencies(b)))
    reasons.push("Currencies differ.");
  if (
    canonical(a.input.periods.map((p) => [p.id, p.start, p.end])) !==
    canonical(b.input.periods.map((p) => [p.id, p.start, p.end]))
  )
    reasons.push("Planning horizons differ.");
  const differences: string[] = [];
  function diff(x: any, y: any, path: string) {
    if (canonical(x) === canonical(y)) return;
    if (x && y && typeof x === "object" && typeof y === "object") {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
        diff(x[k], y[k], path ? `${path}.${k}` : k);
    } else
      differences.push(
        `${path}: ${JSON.stringify(x) ?? "missing"} → ${JSON.stringify(y) ?? "missing"}`,
      );
  }
  diff(a.input, b.input, "");
  const cost = reasons.length
    ? null
    : b.verification!.cost - a.verification!.cost;
  return {
    reasons,
    differences,
    costDelta: cost,
    costPercent:
      cost !== null && a.verification!.cost !== 0
        ? (cost / a.verification!.cost) * 100
        : null,
  };
}
