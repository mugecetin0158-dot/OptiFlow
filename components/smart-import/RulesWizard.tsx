"use client";
import { Rules } from "../../lib/import/types";
import { validateRules } from "../../lib/import/validation";
export type Translate = (s: string) => string;
export default function RulesWizard({
  rules,
  onChange,
  t,
}: {
  rules: Rules;
  onChange: (r: Rules) => void;
  t: Translate;
}) {
  const update = (key: keyof Rules, value: unknown) =>
    onChange({ ...rules, [key]: value, reviewed: false });
  const issues = validateRules(rules).filter((i) => i.field !== "rules");
  const currencyCodes =
    typeof (Intl as any).supportedValuesOf === "function"
      ? (Intl as any).supportedValuesOf("currency")
      : ["USD", "EUR", "TRY", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "INR"];
  return (
    <div className="panel import-panel">
      <div className="section-heading">
        <div>
          <h2>{t("Scheduling rules")}</h2>
          <p>
            {t(
              "Business rules are stored separately from imported records. No legal defaults are assumed.",
            )}
          </p>
        </div>
        <span className="badge teal">{t("Step 4")}</span>
      </div>
      <div className="import-form-grid">
        <label>
          {t("Minimum rest between shifts (hours)")}
          <input
            type="number"
            min="0"
            max="168"
            step="0.25"
            value={rules.minRestHours}
            onChange={(e) => update("minRestHours", e.target.value)}
          />
        </label>
        <label>
          {t("Maximum shifts per employee per week")}
          <input
            type="number"
            min="1"
            max="168"
            value={rules.maxShiftsPerWeek}
            onChange={(e) => update("maxShiftsPerWeek", e.target.value)}
          />
        </label>
        <label>
          {t("Business weekly hour cap (optional)")}
          <input
            type="number"
            min="0"
            max="168"
            step="0.25"
            placeholder={t("Use each employee’s limit")}
            value={rules.maxWeeklyHours}
            onChange={(e) => update("maxWeeklyHours", e.target.value)}
          />
        </label>
        <label>
          {t("Business timezone")}
          <input
            list="import-timezones"
            placeholder="Europe/Istanbul"
            value={rules.timezone}
            onChange={(e) => update("timezone", e.target.value)}
          />
          <datalist id="import-timezones">
            {[
              "Europe/Istanbul",
              "Europe/Paris",
              "Europe/London",
              "America/New_York",
              "America/Los_Angeles",
              "Asia/Tokyo",
              "UTC",
            ].map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label>
          {t("Business currency")}
          <select
            value={rules.currency}
            onChange={(e) => update("currency", e.target.value)}
          >
            <option value="">{t("Select currency")}</option>
            {currencyCodes.map((v: string) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Scheduling week start")}
          <input
            type="date"
            value={rules.weekStart}
            onChange={(e) => update("weekStart", e.target.value)}
          />
        </label>
        <label>
          {t("Maximum daily hours (optional)")}
          <input
            type="number"
            min="0"
            max="24"
            step="0.25"
            value={rules.maxDailyHours}
            onChange={(e) => update("maxDailyHours", e.target.value)}
          />
        </label>
        <label>
          {t("Multiple shifts on the same day")}
          <select
            value={
              rules.allowMultipleShifts === null
                ? ""
                : String(rules.allowMultipleShifts)
            }
            onChange={(e) =>
              update(
                "allowMultipleShifts",
                e.target.value === "" ? null : e.target.value === "true",
              )
            }
          >
            <option value="">{t("Choose explicitly")}</option>
            <option value="true">
              {t("Allowed, subject to rest and hour limits")}
            </option>
            <option value="false">{t("At most one shift per day")}</option>
          </select>
        </label>
      </div>
      <fieldset className="import-weekdays">
        <legend>{t("Closed weekdays (optional)")}</legend>
        {[
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ].map((day, i) => (
          <label key={day}>
            <input
              type="checkbox"
              checked={rules.closedWeekdays.includes(i)}
              onChange={(e) =>
                update(
                  "closedWeekdays",
                  e.target.checked
                    ? [...rules.closedWeekdays, i]
                    : rules.closedWeekdays.filter((x) => x !== i),
                )
              }
            />
            {t(day)}
          </label>
        ))}
      </fieldset>
      <p className="footnote">
        {t(
          "Only these structured restrictions are stored. Free-text instructions are not executable rules.",
        )}
      </p>
      {issues.length > 0 && (
        <div className="notice info">
          <div>
            {issues.map((i, n) => (
              <p key={n}>{t(i.message)}</p>
            ))}
          </div>
        </div>
      )}
      <label className="import-confirm">
        <input
          type="checkbox"
          checked={rules.reviewed}
          disabled={issues.length > 0}
          onChange={(e) => onChange({ ...rules, reviewed: e.target.checked })}
        />
        {t(
          "I have reviewed these business rules. They do not guarantee employment-law compliance.",
        )}
      </label>
    </div>
  );
}
