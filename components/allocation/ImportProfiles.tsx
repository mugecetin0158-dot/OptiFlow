"use client";
import { useEffect, useState } from "react";
import { AllocationSource } from "../../lib/allocation/import";
import {
  AllocationProfile,
  PROFILE_KEY,
  applyAllocationProfile,
  makeAllocationProfile,
} from "../../lib/allocation/profiles";
import { titles, fieldLabels, Translate } from "./CatalogEditor";
export default function ImportProfiles({
  source,
  onApply,
  t,
}: {
  source: AllocationSource;
  onApply: (s: AllocationSource) => void;
  t: Translate;
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
      setMessage(t((e as Error).message));
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
      setMessage(t((e as Error).message));
    }
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) load();
      }}
    >
      <summary>{t("Reusable allocation import profiles")}</summary>
      <p>
        {t("Apply a profile, inspect or change its mappings above, confirm, then save with the same name to update it. New values are always revalidated.")}
      </p>
      <label>
        {t("Profile name")}{" "}
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
              !window.confirm(t("Replace the saved mappings for this profile?"))
            )
              return;
            if (old) p.id = old.id;
            persist([...latest.filter((x) => x.id !== p.id), p]);
            setMessage(t("Profile saved locally."));
          })
        }
      >
        {t("Save confirmed mappings")}
      </button>
      {message && <p role="status">{t(message)}</p>}
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
                  t("Profile applied. Review and confirm the dataset meaning."),
                );
              })
            }
          >
            {t("Apply / edit")}
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
            {t("Delete")}
          </button>
          <details>
            <summary>{t("Inspect mappings")}</summary>
            <p>
              {t(titles[p.kind])} · {t("Decimal convention")}: {p.decimal || t("Require clarification")}
            </p>
            {p.headers.map((h, i) => (
              <p key={i}>
                {h} → {p.mappings[i] ? t(fieldLabels[p.mappings[i]] || p.mappings[i]) : t("unmapped")}
              </p>
            ))}
          </details>
        </div>
      ))}
    </details>
  );
}
