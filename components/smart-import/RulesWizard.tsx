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
  const fieldError = (field: string) => {
    const errors = issues.filter((issue) => issue.field === field);
    return errors.length ? (
      <small className="field-error-text" id={`rules-${field}-error`}>
        {errors.map((issue) => t(issue.message)).join(" ")}
      </small>
    ) : null;
  };
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
      </div>
      <div className="import-form-grid">
        <label>
          {t("Minimum rest between shifts (hours)")}
          <input
            type="number"
            min="0"
            max="168"
            step="0.25"
            className={issues.some((i) => i.field === "minRestHours") ? "invalid" : ""}
            aria-invalid={issues.some((i) => i.field === "minRestHours")}
            aria-describedby={issues.some((i) => i.field === "minRestHours") ? "rules-minRestHours-error" : undefined}
            value={rules.minRestHours}
            onChange={(e) => update("minRestHours", e.target.value)}
          />
          {fieldError("minRestHours")}
        </label>
        <label>
          {t("Maximum shifts per employee per week")}
          <input
            type="number"
            min="1"
            max="168"
            className={issues.some((i) => i.field === "maxShiftsPerWeek") ? "invalid" : ""}
            aria-invalid={issues.some((i) => i.field === "maxShiftsPerWeek")}
            aria-describedby={issues.some((i) => i.field === "maxShiftsPerWeek") ? "rules-maxShiftsPerWeek-error" : undefined}
            value={rules.maxShiftsPerWeek}
            onChange={(e) => update("maxShiftsPerWeek", e.target.value)}
          />
          {fieldError("maxShiftsPerWeek")}
        </label>
        <label>
          {t("Business weekly hour cap (optional)")}
          <input
            type="number"
            min="0"
            max="168"
            step="0.25"
            className={issues.some((i) => i.field === "maxWeeklyHours") ? "invalid" : ""}
            aria-invalid={issues.some((i) => i.field === "maxWeeklyHours")}
            aria-describedby={issues.some((i) => i.field === "maxWeeklyHours") ? "rules-maxWeeklyHours-error" : undefined}
            placeholder={t("Use each employee’s limit")}
            value={rules.maxWeeklyHours}
            onChange={(e) => update("maxWeeklyHours", e.target.value)}
          />
          {fieldError("maxWeeklyHours")}
        </label>
        <label>
          {t("Business timezone")}
          <input
            list="import-timezones"
            placeholder="Europe/Istanbul"
            className={issues.some((i) => i.field === "timezone") ? "invalid" : ""}
            aria-invalid={issues.some((i) => i.field === "timezone")}
            aria-describedby={issues.some((i) => i.field === "timezone") ? "rules-timezone-error" : undefined}
            value={rules.timezone}
            onChange={(e) => update("timezone", e.target.value)}
          />
          {fieldError("timezone")}
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
            className={issues.some((i) => i.field === "currency") ? "invalid" : ""}
            aria-invalid={issues.some((i) => i.field === "currency")}
            aria-describedby={issues.some((i) => i.field === "currency") ? "rules-currency-error" : undefined}
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
          {fieldError("currency")}
        </label>
        <label>
          {t("Scheduling week start")}
          <input
            type="date"
            className={issues.some((i) => i.field === "weekStart") ? "invalid" : ""}
            aria-invalid={issues.some((i) => i.field === "weekStart")}
            aria-describedby={issues.some((i) => i.field === "weekStart") ? "rules-weekStart-error" : undefined}
            value={rules.weekStart}
            onChange={(e) => update("weekStart", e.target.value)}
          />
          {fieldError("weekStart")}
        </label>
        <label>
          {t("Maximum daily hours (optional)")}
          <input
            type="number"
            min="0"
            max="24"
            step="0.25"
            className={issues.some((i) => i.field === "maxDailyHours") ? "invalid" : ""}
            aria-invalid={issues.some((i) => i.field === "maxDailyHours")}
            aria-describedby={issues.some((i) => i.field === "maxDailyHours") ? "rules-maxDailyHours-error" : undefined}
            value={rules.maxDailyHours}
            onChange={(e) => update("maxDailyHours", e.target.value)}
          />
          {fieldError("maxDailyHours")}
        </label>
        <label>
          {t("Multiple shifts on the same day")}
          <select
            className={issues.some((i) => i.field === "allowMultipleShifts") ? "invalid" : ""}
            aria-invalid={issues.some((i) => i.field === "allowMultipleShifts")}
            aria-describedby={issues.some((i) => i.field === "allowMultipleShifts") ? "rules-allowMultipleShifts-error" : undefined}
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
          {fieldError("allowMultipleShifts")}
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
