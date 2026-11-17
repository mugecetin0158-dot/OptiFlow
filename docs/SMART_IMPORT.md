# OptiFlow Smart Import

A browser-local CSV-only import workflow integrated with OptiFlow's existing Next.js application. Upload one or multiple CSV files; UTF-8 and BOM-marked files, comma and semicolon delimiters, quoted fields, escaped quotes, empty cells, and common line endings are supported. Each file remains a separate source through AI-first dataset detection and deterministic validation. Unsupported file types and malformed CSV data block import with actionable errors. Imported Scheduling adapts validated records to the existing GLPK solver; the Python demo endpoint and demo scenario workflow remain separate.

## Run and use

```sh
npm ci
npm run dev
```

Open http://localhost:3000 and choose **Smart Import** in the sidebar. The destination selector keeps the Scheduling workflow below separate from the new [Resource Allocation import adapter](RESOURCE_ALLOCATION.md#smart-import-integration), whose validated datasets can be optimized directly.

1. **Upload:** drop or choose one or multiple `.csv` files. UTF-8 is detected automatically; select a legacy encoding explicitly if necessary. Comma and semicolon delimiters are supported. To replace a source, select it under Upload action and upload one replacement. Remove sources individually, inspect paginated raw records, or correct and reparse raw CSV without reuploading.
2. **AI Interpretation:** after consent, AI identifies datasets and proposes column mappings while preserving source values. Review uncertain mappings, normalizations, and corrections here. Exact-alias matches and saved profiles remain available, but neither an assignment nor an absent value is silently treated as demand or availability. Choose DMY/MDY when numeric dates are ambiguous and a decimal convention for fractional values.
3. **Missing Information:** answer only the required, unresolved questions. Each card identifies the target field, source dataset, and available source-column suggestions; use a date, number, choice, or text input as appropriate. This stage is skipped when no required information is missing. No ID, pay, role, hour limit, availability, staffing demand, or constraint is invented.
4. **Preview:** transform and validate, then review and edit all three datasets, rules, warnings, and unmapped fields. Enter dates as YYYY-MM-DD, times as HH:mm, decimals with a period, and roles as a JSON array such as `["Cashier", "Manager"]`. Supply rest time, maximum shifts, business timezone, currency, and a seven-day period start; review optional business weekly/daily caps, closed weekdays, and multiple-shift behavior. Export `employees.csv`, `availability.csv`, and `shifts.csv`. Internal validation remains authoritative.
5. **Save:** confirm the review checkbox and save after resolving all blocking errors. A changed source mapping makes the preview stale and disables saving/export until rebuilt. Saving opens the separate **Validated imported data** view. Select **Optimize imported schedule** to generate a schedule with the existing GLPK optimizer. Switch back to **Demo scenarios** to use the existing scheduling demo; neither mode overwrites the other.

The workflow and messages are translated into English, Turkish, French, and Spanish. Standard schema field names and export filenames stay canonical for interoperability. User-entered names, IDs, and roles are never translated.

## Representative files

Use `tests/fixtures/import/team.csv`, `windows.csv`, and `demand.csv` together:

- Team: choose dot decimals. Roles are already JSON lists.
- Windows: choose DMY dates and map `approved leave` to `unavailable` in the status-value section.
- Confirm the detected Employees, Availability, and Shift Requirements datasets for their respective files.
- Rules for this explicit fictional test: week start `2026-11-16`, timezone `Europe/Istanbul`, currency `USD`, rest `11`, maximum weekly shifts `5`, weekly cap `40`, daily cap `8`, allow multiple shifts, no closed weekdays. These are fixture settings, not business or legal recommendations.

Other fixtures demonstrate ambiguous headers, unrelated invoices, employee assignments, and malformed quoted CSV. None is loaded automatically into a user's import.

## Modules

- `lib/import/types.ts`: schemas, draft and standardized types, traceability, rules, profiles.
- `lib/import/csv.ts`: quote-aware state-machine parser, delimiter detection, encoding conversion, bounded input size, exports.
- `lib/import/recognition.ts`: configurable exact alias dictionary and normalization; explicit uncertainty and mapping conflicts. No fuzzy matching.
- `lib/import/normalize.ts`: dates, times, decimals, roles, and status normalization.
- `lib/import/transformations.ts`: shared mapper/pipeline transformation functions, output-field ownership, range splitting, and explicit next-day derivation.
- `lib/import/stages.ts`: separate parsing, mapping, and dataset status reporting.
- `lib/import/pipeline.ts`: dataset routing, per-field unresolved clarification, multi-dataset records, exact repeated employee consolidation, provenance, unmapped data.
- `lib/import/validation.ts`: required fields, ID uniqueness and references, roles, same-day and explicit overnight windows, duplicate/conflicting availability, rules, and detectable coverage shortages.
- `lib/import/profiles.ts`: confirmed reusable mappings; normalized header matching supports reordered columns.
- `lib/import/storage.ts`: separate data/rules/profile storage, revalidation on reload, failure handling, and canonical exports.
- `lib/import/integration.ts`: validated conversion into the solver model, including IANA timezone interval conversion.
- `components/smart-import/`: upload workflow, mapping editor, rules wizard, editable previews, and imported Scheduling view.
- `app/page.tsx`: navigation, dashboard entry, and isolated demo/import source switch.
- `app/smart-import.css`: responsive styling using the existing design tokens.

## Recognition and normalization policy

Exact, normalized aliases are proposed automatically. Header normalization handles case, common punctuation, separators, whitespace, and diacritics. `Hours`, `Rate`, `Salary`, `Job Title`, `Skills`, and generic `Status` need confirmation. Multiple columns cannot target the same field, generic and dataset-specific time fields cannot collide, and mapped fields must belong to a selected dataset. Specialized fields (`availability_date`, `shift_start_time`, etc.) support files containing different kinds of information with different time columns.

Source identifiers remain strings, preserving leading zeros. Input whitespace is trimmed. No name-based joining is attempted. Numeric dates with only one valid day/month interpretation are recognized automatically, allowing mixed ISO and unambiguous local dates. Ambiguous dates require an explicit DMY/MDY selection. Ambiguous decimals require a convention; currency symbols and grouping separators are rejected rather than guessed. Time formats include HH:mm, whole hours, and explicit AM/PM. Time-range columns support hyphens, en/em dashes, 24-hour times, and explicit AM/PM on both endpoints. Equal endpoints and partial AM/PM are ambiguous and blocked. Overnight ranges require an explicit next-day policy or mapped end date.

Identical repeated employee facts (often from mixed employee/availability files) are consolidated with a warning and **all** source row references. Different facts for the same ID remain conflicting records and block saving. Missing availability stays unknown. Known available windows can jointly cover a shift only when contiguous; explicit unavailable windows block eligibility. Contradictory overlaps are blocking errors; same-status overlaps are warnings. These are data checks, not schedule generation.

Unknown columns are retained in the source preview and listed in the final unmapped-column report. Unrelated files and existing assignments remain separate source information. Mixed rows with no relevant output receive a traceable warning. Roles are exact, case-sensitive labels defined by the imported employees; required roles must match them.

## Profiles

After confirming a file's meanings, save its mappings under a profile name. A future file with the same normalized header set offers the profile even if column order differs. Apply it explicitly, review dataset meaning, and validate the new values. Profiles also remember direct/date/time/status/range transformation modes, the overnight policy, normalization and explicit status-value choices; they contain no employee records.

Inspect a saved profile to review every source-to-target transformation and its options. To edit a mapping profile, apply it, adjust and confirm mappings, and save with the same name; confirm replacement. Profiles can be renamed or deleted from the profile manager. No profile bypasses validation.

## Persistence and privacy

The browser's localStorage contains three separate keys:

- `optiflow-smart-import-v1`: validated canonical data, editable canonical records, source-row references, warnings, and unmapped-column metadata.
- `optiflow-import-rules-v1`: reviewed structured scheduling settings.
- `optiflow-import-profiles-v1`: reusable mapping profiles.

The previous demo state (`optiflow-v1`) is untouched. The active source mode is stored under `optiflow-source-mode`. Saved imports are revalidated on reload, and the stored rules revision must match. Failed writes report failure and attempt to restore the previous saved state. Storage is not transactional across tabs; reload rejects a mismatched pair rather than using it.

Raw files and unconfirmed corrections remain in browser memory while navigating the dashboard, import page, and scheduling module; they are not persisted or uploaded. They disappear on reload or when leaving the application for its marketing landing page. Validated data is local and unencrypted, device/browser-specific, and subject to storage quotas. There is no account, server sync, database, or automatic backup. CSV exports provide a portable copy. Exports retain exact strings (including formula-like IDs) and warn when spreadsheet software could interpret them as formulas; import such columns as text. A UTF-8 BOM preserves non-ASCII names.

## Limits and remaining engine work

- Imports are limited to 10 CSV files, 80 columns per file, 2 MB and 5,000 data rows per file, and 10,000 source rows total. Browser memory/storage can impose smaller practical limits.
- UTF-8 and BOM-marked UTF-16 are detected; Windows-1252 and Windows-1254 are explicit choices. Comma and semicolon separators are supported. Ambiguous delimiters require selection.
- PDF, TSV, pipe-delimited files, nested tables, headerless files, locale prose dates, thousands separators, and automatic wide-grid unpivoting are not supported. One header row is required. Role arrays are exported as JSON inside CSV cells.
- Time windows may cross midnight with an explicit `end_date`; maximum duration is 24 calendar-wall-clock hours. Shift requirements must fit the configured seven-day period. Shift/rest/daily-hour durations use elapsed minutes in the selected IANA timezone. Ambiguous or nonexistent local times during daylight-saving transitions are rejected with an actionable error instead of guessed.
- Availability statuses include YES → available and NO → unavailable. Unknown values require explicit mapping; all distinct values are accessible in paginated controls. Empty values are never defaulted.
- An explicit rules review is required. The adapter enforces exact role eligibility, contiguous availability coverage and unavailable windows, imported staffing counts, individual and optional business weekly-hour caps, minimum rest between imported shifts, maximum shifts per week, optional maximum daily hours (splitting overnight shifts at local midnight), the reviewed same-day multi-shift rule, and closed weekdays validated during import.
- The GLPK solver is shared with the existing demo; its demo inputs and interface remain unchanged. Imported mode supports up to 30 employees and 100 shift requirements. `schedulingInput()` revalidates the draft and rules revision and either creates a complete solver model or reports a blocking error; no rows, roles, constraints, or availability are silently discarded.
- The seven-day import schema does not include already assigned shifts from adjacent weeks. Minimum-rest checks therefore cover only shifts in the generated planning period; rest from/to unknown external assignments cannot be verified. Import those commitments as a future supported dataset before treating cross-period rest as certified. Ambiguous/nonexistent daylight-saving wall times are also rejected rather than resolved by assumption.
- Production work still includes authenticated storage, tenant isolation, audit/versioning, retention controls, jurisdiction-specific rule review, and cross-period assignment support.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

`npm test` runs the original scheduling and localization tests plus the Smart Import suite. Import fixtures and tests cover parsing, encodings, aliases, ambiguity, unrelated data, missing fields, duplicates, normalization, references, overlaps, profiles, canonical CSV exports, separate persistence, quota failure, role-aware optimization, timezone conversion, invalid inputs, and infeasible imported schedules. React server-render smoke checks exercise the new components without pretending to be browser interaction tests.

No ESLint configuration or lint command exists in this repository. TypeScript checks, production compilation, and whitespace validation are used; no lint pass is claimed. Browser automation tools are unavailable in this managed session, so drag/drop, native file selection, focus, and responsive visual behavior still need end-to-end browser/device verification.

## Transformation upgrade: quick acceptance test

1. Upload `tests/fixtures/import/raw_worker_windows.csv` through Smart Import.
2. Confirm **Availability** is the intended meaning. `Badge`, `Day`, and `Can Work?` have deterministic aliases. Confirm the suggested **Split into start_time and end_time** transformation on `Time Window`.
3. Inspect the transformed-value preview. YES/NO normalize to available/unavailable; `11/17/2026` has only one valid interpretation and becomes `2026-11-17` without selecting a global date order.
4. Confirm the dataset/column meanings, then **Transform & validate**. Download **availability.csv** from Validate & correct (or Preview & save). The output contains exactly these standard values, with CSV quoting and a UTF-8 BOM:

```csv
employee_id,date,start_time,end_time,status
W001,2026-11-16,14:00,22:00,available
W002,2026-11-17,09:00,17:00,unavailable
```

This file alone does **not** authorize scheduling: employee references remain unverified until employee records are supplied, and full approval also requires shift requirements and reviewed rules. Independent CSV export performs scoped schema/duplicate/conflict validation; it does not claim the complete scheduling dataset is ready. If employee records are supplied, unknown employee references block the availability export too.

5. Try `MAYBE` instead of YES: it is preserved and flagged with source filename/line. Map it explicitly in the status-value editor, rebuild, and revalidate; or correct the canonical status cell. No source file edit or reupload is necessary.
6. Try `22:00–06:00`: choose **Earlier end time means next day**, or map an explicit `end_date`. The standardized record includes `end_date: 2026-11-17`. Without that decision, approval/export is blocked. Cross-day overlap checks include windows on the next date.
7. Save **Warehouse Availability** as a mapping profile; upload a matching file, apply the profile, and reconfirm the dataset. New values are always validated. Use **Inspect profile**, or apply/edit/save under the same name to update it.

### Validation and compatibility

- **Parsing** covers CSV structure only. It never displays a full-data all-clear banner.
- **Mapping** covers dataset confirmation, required direct/derived fields, transformation configuration, and output collisions. Source previews also show unresolved value transformations. Unmapped required fields block final approval; unrelated columns remain visible without forced mappings.
- **Dataset** covers required values, pending clarifications, dates/times, references, duplicates, contradictions, rules, and configured-period checks. Editing canonical cells explicitly resolves their pending transformation question, then runs validation again.
- Direct mapping preserves canonical values; date/time/status transformation modes perform normalization. Existing profiles without a `transform` property retain their original field-based normalization behavior.
- Same-day exports retain the original five-column availability schema. When any interval crosses midnight, exports append `end_date`; same-day rows in that file use their start date. Both availability and shift-requirement exports, imported previews, reload validation, and availability coverage use the extension consistently. Original uploads remain available separately from edited raw CSV during the current session.
- Import validation checks calendar-wall-time consistency; optimization converts validated windows to actual instants in the selected timezone and rejects DST gaps or ambiguous wall times. Overnight shifts are split over their actual local calendar dates for daily-hour limits.

`tests/import-transformations.test.ts` includes an end-to-end **data-pipeline** test for the exact fixture, plus direct mappings, range formats, statuses, mixed/invalid dates, overnight dates, duplicates, missing fields, ambiguous dataset meaning, conflicting mappings, exports, profile reuse, and shift requirements. These are executed automated tests, not browser interaction tests.

### Files changed in this upgrade

Created: `lib/import/transformations.ts`, `lib/import/stages.ts`, `tests/import-transformations.test.ts`, and `tests/fixtures/import/raw_worker_windows.csv`.

Updated: `lib/import/{types,recognition,normalize,pipeline,validation,profiles,storage}.ts`; `components/smart-import/{SourceMapping,DataPreview,SmartImport}.tsx`; `app/smart-import.css`; `lib/translations.json`; `tests/import-ui.test.tsx`; `package.json`; this document; and the downloadable `public/optiflow-source.zip`.

Executed verification: **54 automated tests passed**, including 16 transformation/data-flow tests and 5 React server-render tests; `npm run typecheck`, `npm run build`, and `git diff --check` passed. Browser interaction testing was unavailable. No Python/backend changes were needed.
