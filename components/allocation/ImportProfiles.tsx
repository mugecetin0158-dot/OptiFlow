"use client";
import { useEffect, useState } from "react";
import { AllocationSource } from "../../lib/allocation/import";
import {
  AllocationProfile,
  PROFILE_KEY,
  applyAllocationProfile,
  makeAllocationProfile,
} from "../../lib/allocation/profiles";
export default function ImportProfiles({
  source,
  onApply,
}: {
  source: AllocationSource;
  onApply: (s: AllocationSource) => void;
}) {
  const [profiles, setProfiles] = useState<AllocationProfile[]>([]),
    [name, setName] = useState(""),
    [message, setMessage] = useState("");
  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) || "[]");
      if (!Array.isArray(stored)) throw Error("Invalid profile storage.");
      setProfiles(stored);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(load, []);
  function persist(next: AllocationProfile[]) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    setProfiles(next);
  }
  function action(fn: () => void) {
    try {
      setMessage("");
      fn();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) load();
      }}
    >
      <summary>Reusable allocation import profiles</summary>
      <p>
        Apply a profile, inspect or change its mappings above, confirm, then
        save with the same name to update it. New values are always revalidated.
      </p>
      <label>
        Profile name{" "}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button
        className="btn"
        onClick={() =>
          action(() => {
            const p = makeAllocationProfile(source, name);
            const latest: AllocationProfile[] = JSON.parse(
              localStorage.getItem(PROFILE_KEY) || "[]",
            );
            const old = latest.find((x) => x.name === p.name);
            if (
              old &&
              !window.confirm("Replace the saved mappings for this profile?")
            )
              return;
            if (old) p.id = old.id;
            persist([...latest.filter((x) => x.id !== p.id), p]);
            setMessage("Profile saved locally.");
          })
        }
      >
        Save confirmed mappings
      </button>
      {message && <p role="status">{message}</p>}
      {profiles.map((p) => (
        <div key={p.id}>
          <strong>{p.name}</strong>
          <button
            className="btn"
            onClick={() =>
              action(() => {
                onApply(applyAllocationProfile(source, p));
                setName(p.name);
                setMessage(
                  "Profile applied. Review and confirm the dataset meaning.",
                );
              })
            }
          >
            Apply / edit
          </button>
          <button
            className="btn"
            onClick={() =>
              action(() => {
                const latest: AllocationProfile[] = JSON.parse(
                  localStorage.getItem(PROFILE_KEY) || "[]",
                );
                persist(latest.filter((x) => x.id !== p.id));
              })
            }
          >
            Delete
          </button>
          <details>
            <summary>Inspect mappings</summary>
            <p>
              {p.kind} · decimal: {p.decimal || "clarify"}
            </p>
            {p.headers.map((h, i) => (
              <p key={i}>
                {h} → {p.mappings[i] || "unmapped"}
              </p>
            ))}
          </details>
        </div>
      ))}
    </details>
  );
}
