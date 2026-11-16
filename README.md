# OptiFlow v0.2

**Smarter Decisions. Better Operations.**

A runnable business optimization prototype with a landing page, dashboard, six-module directory, and functional Scheduling and Resource Allocation optimizers. Four modules are explicitly marked as planned.

## Spreadsheet-to-optimization upgrade

Resource Allocation now supports joint multi-period LP/MILP planning, explicit renewable/consumable policies, cost/output/net-value objectives, independent verification, saved scenarios, immutable local run history, cancellation, comparisons and CSV/Excel exports. Both Smart Import destinations accept CSV and XLSX with worksheet selection. See the [upgrade guide, mathematical formulation, test instructions and limitations](docs/PLANNING_UPGRADE.md).

## Smart Import

OptiFlow includes browser-local CSV/XLSX parsing followed, after explicit consent, by backend-only Gemini interpretation. Deterministic transformation and validation remain authoritative; missing facts become targeted questions and are never invented. See [AI-first setup and limits](docs/ai-first-import.md) and the [schema guide](docs/SMART_IMPORT.md).

## Resource Allocation

The second operational module provides real local LP/MILP optimization, resource and project catalogs, explicit compatibility and limits, cost/value objectives, allocation analytics, and CSV exports. Start with empty manual entry or explicitly load the fictional sample. Smart Import now has a Resource Allocation destination for validated resource/project/demand/link CSVs. See [formulation, units, statuses, sample instructions, and limitations](docs/RESOURCE_ALLOCATION.md).

## Run locally

Requires Node.js 20.9+ (24 tested) and npm. No accounts, credentials, paid APIs, or database are required.

```sh
npm ci
npm run dev
```

Visit http://localhost:3000. The default uses GLPK compiled to WebAssembly in a browser Web Worker. It solves a real binary mixed-integer program; it is not a greedy assignment algorithm. The browser solver is lazy-loaded when generating a schedule or resource allocation. `npm run build` creates a static site in `out/`.

### Use the preferred Python / OR-Tools backend

Requires Python 3.11+ (3.12 tested).

```sh
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run dev
```

Windows: use `.venv\Scripts\python` / `.venv\Scripts\pip` and set `NEXT_PUBLIC_API_URL` with the shell's environment-variable syntax. Restart Next.js after changing this variable. The CORS allowlist permits localhost and 127.0.0.1 on port 3000. API docs: http://127.0.0.1:8000/docs. Health: `/health`. Solver: `POST /solve`.

The hosted static demo uses browser GLPK because its hosting runtime cannot run a Python process. The Python source and tested CP-SAT API are included for local use. The frontend does not silently fall back if a configured backend fails.

### Connect Gemini for AI-first Smart Import

Gemini is optional during development but required to complete AI interpretation. Copy `.env.example` to an untracked `.env`, add `GEMINI_API_KEY`, and export the variables before starting FastAPI. Never prefix the key with `NEXT_PUBLIC_`.

```sh
set -a; . ./.env; set +a
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run dev
```

The server uses `GEMINI_IMPORT_MODEL`, `GEMINI_TIMEOUT_SECONDS`, `GEMINI_MAX_RETRIES`, and `OPTIFLOW_CORS_ORIGINS`. Without a key, uploads still parse locally and the UI reports that AI interpretation is unavailable. Live Gemini calls are not exercised by automated tests.

## Languages

Use the language selector in the app header or landing-page navigation to switch between English, Türkçe, and Français. Your preference is stored under `optiflow-language` in this browser. Navigation, forms, validation, solver messages, guide content, and CSV headings are translated. Dates, numbers, and USD amounts follow the selected locale; changing language never converts currencies or alters assignments, employee names, or solver inputs. New run timestamps are stored as ISO instants and displayed in Europe/Istanbul time. CSV dates and numeric values remain in an unambiguous, machine-readable format. Exported files include a UTF-8 BOM for Turkish and French characters. Existing run timestamps saved by v0.1 retain their original display format.

Translation catalog: `lib/translations.json`; formatting and dynamic messages: `lib/i18n.ts`.

## Explore the prototype

1. Open **Scheduling**, select Retail Store, Café, or Office, and select **Load example**.
2. Edit employees, wages, hour limits, individual availability, dates, shift times, and per-shift staffing needs.
3. Select **Generate Optimal Schedule**. Review the actual solver status and calculated cost, hours, coverage, and utilization.
4. Select a shift in the weekly table to change assignments. Constraint warnings update immediately. Manual drafts never retain an optimality claim.
5. Export CSV, or try **Infeasible test** to see diagnostic feedback.

Changes and the last eight run summaries persist in this browser's local storage. Changes to model inputs invalidate the previous solution. Inputs changed during an in-flight solve cannot accept the stale result. Use fictional data only.

## Optimization model

Sets: employees E, shifts S. Binary `x[e,s]` indicates assignment. Availability `a[e,s]` is 0/1, staffing demand `r[s]` is a nonnegative integer, duration `h[s]` is in minutes, weekly limit `H[e]` is in minutes, and wage `w[e]` is in integer cents per hour.

Minimize:

```
Σ(e,s) w[e] × h[s] × x[e,s]
```

Dividing the objective by 6,000 converts cents-minutes to USD. The constant scaling does not change the minimizer. This accounts for actual shift durations, including unequal durations.

Subject to:

```
Σ(e) x[e,s] ≥ r[s]                       for each shift
x[e,s] ≤ a[e,s]                          for each employee and shift
Σ(s) h[s] × x[e,s] ≤ H[e]                for each employee
x[e,s] + x[e,t] ≤ 1                     for every overlapping same-day pair
x[e,s] ∈ {0,1}
```

The local backend uses OR-Tools CP-SAT. The hosted implementation uses GLPK mixed-integer branch-and-bound with zero requested relative MIP gap. Both have a 20-second solver limit and return OPTIMAL only when the solver reports proof of optimality. FEASIBLE means an incumbent was found without proof; UNKNOWN means no usable solution within the limit. INFEASIBLE means either a detectable necessary condition failed or the solver proved impossibility. GLPK uses floating-point numerical tolerances; it is not a symbolic rational-arithmetic proof system.

The frontend independently checks all returned assignments. A failed check rejects the result. Manual editing supports invalid drafts but displays warnings and labels their CSV filenames `INVALID-DRAFT`. An employee may work both adjacent shifts if weekly hours allow it; there is no unrequested one-shift-per-day rule.

Coverage is `sum(min(assigned, required)) / sum(required)`; excess staffing cannot hide another shift's shortage. A zero-demand week has 100% coverage by convention. Positive wages generally discourage excess staffing; zero-cost ties may include excess staffing. No savings claims are made.

## Code map

- `app/page.tsx`: application navigation and interactive screens.
- `app/globals.css`: responsive visual system, light/dark themes, motion preferences.
- `lib/model.ts`: types, presets, validation, independent checks, analytics, safe CSV generation.
- `lib/solver.ts`: solver-independent model construction and GLPK adapter.
- `backend/main.py`: validated FastAPI schema and OR-Tools CP-SAT implementation.
- `tests/solver.test.ts`: preset, exhaustive optimum, constraint, validation, and CSV tests.
- `tests/test_api.py`: API validation, CP-SAT/GLPK cross-checks, overlap and duration tests.

## Verification

```sh
npm test
.venv/bin/pip install pytest httpx
.venv/bin/python -m pytest tests/test_api.py -q
npm run build
```

Run JS tests first to refresh the cross-solver fixtures. The JS suite checks six small cases against every possible binary assignment, then tests all presets, infeasibility, manual violations, changed availability, input errors, and CSV escaping. The Python suite independently validates CP-SAT results and compares costs with GLPK.

Browser automation was not available in the build environment. Automated end-to-end interaction, visual, screen-reader, and device checks remain to be performed. Production compilation and model/API tests are separate from browser verification.

## Current scheduling limitations

- Seven days, exactly two same-day shifts per day, maximum 30 employees; no overnight shifts.
- Only coverage, availability, weekly hour limits, and overlap constraints are implemented. No breaks, minimum rest, overtime, roles/skills, fairness, preference, holiday, or labor-law rules. No claim of employment-regulation compliance.
- A 20-second limit bounds solver runtime, not network/worker startup. Harder instances may return a feasible solution or no usable solution.
- USD wages support up to two decimal places; weekly-hour limits resolve to whole minutes. Dates have no timezone or DST model.
- Browser storage is local, device-specific, and unencrypted. No authentication is required by the app. The hosted Site itself may have owner-private platform access.
- Scheduling run history is a summary, not a versioned schedule archive; resource planning has separate immutable snapshots. Loading another example replaces current inputs and clears its result.
- No collaboration, database, tenant isolation, audit trail, or backend job queue. The local API is a development service.
- GLPK/glpk.js is GPL-3.0. The prototype's distributed application source is provided under GPL-3.0; review dependency licensing and choose a compatible distribution strategy or solver before commercializing. OR-Tools uses Apache-2.0.
- Styles use plain CSS rather than Tailwind to keep this build lightweight. Font loading uses Google Fonts with local system fallbacks.

## Commercial roadmap

1. **Production foundations:** PostgreSQL, tenant isolation, authentication/RBAC, encrypted transport/storage, schema migrations, backups, audit trails, rate limits, and background optimization jobs with cancel/progress controls. Deploy the CP-SAT backend as a service.
2. **Domain validity:** skill/role coverage, overtime and breaks, rest days, employee preferences and fairness objectives, overnight/timezone/DST support, jurisdiction-specific rule validation with qualified review, and better conflict explanations.
3. **Workflow quality:** versioned scenarios, reproducible baselines, approval/publishing workflow, shift swaps, accessibility/device testing, import validation, observability, reliability tests, and privacy/retention controls.
4. **Integrations and economics:** payroll/HR/POS imports, demand forecasting, comparable scenario costs, capacity/load testing, licensing review, and usage-based plans supported by measured infrastructure costs.
5. **Platform expansion:** extend the implemented resource allocation module and add inventory optimization, budget optimization, workforce planning, and decision analysis as separate model adapters. Those four additional modules remain planned.

## Public MVP hosting

See [deployment readiness and authorization steps](docs/DEPLOYMENT_READINESS.md) before public launch. The Vercel configuration serves the static export; no production API environment variable is required. After building, run `npm run check:production`.

## Smart Import automation

CSV/XLSX sources parse locally, then Gemini proposes schema-checked mappings and model semantics after explicit consent. Missing information and uncertain mappings remain reviewable; deterministic validation gates preview and save. See [AI-first setup and limits](docs/ai-first-import.md).
