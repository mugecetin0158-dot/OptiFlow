# Spreadsheet-to-optimization upgrade

Implemented locally; deployment is a separate approval step. The existing scheduling optimizer, manual adjustments, demo data, language controls and import rules remain available. New planning controls currently use English; the existing localized interface and catalogs remain intact.

## Run and test

Node 20.9+ and npm:

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

Open Resource Allocation. The default workspace is the multi-period planner; the legacy single-period editor remains accessible. There is no account or remote data service. CSV is the only supported import format; ExcelJS 4.4.0 remains for Excel workbook exports. GLPK remains the existing local WebAssembly worker solver. No optimizer calls an AI API.

### Import walkthrough

1. Open Resource Allocation → **Import CSV into selected period** (or Smart Import → Resource Allocation).
2. Upload one or multiple CSV files containing resource, project, demand and compatibility catalogs. Existing sample CSV fixtures are in `tests/fixtures/allocation`. Comma and semicolon delimiters are supported. Review/edit cells using the paginated preview.
3. In **Map columns**, explicitly identify each dataset. Review rule-based suggestions, override mappings and decimal conventions, and confirm meanings. Unrelated columns stay in source context. Mapping profiles can be saved, inspected, reused, edited and deleted locally; applying a profile always requires renewed confirmation and value validation.
4. Transform, then correct errors in **Validate & correct**. Configure currency, a period label and optional budget in **Configure rules**. Confirm and save in **Preview & save**. Parsing success alone does not establish readiness.
5. The validated catalog replaces the selected period's catalogs. Import one period at a time; automatic grouping of rows by a `period_id` column is not implemented. Select the destination period before importing; never combine multiple periods in a single period catalog. CSV filenames/header rows and source row references are retained, along with source columns, mapping choices and normalized tables.
6. Add periods or explicitly copy an existing period's assumptions. Enter ordered, non-overlapping dates; classify resources and configure inventory policies, receipts, period budgets and horizon constraints.
7. Optimize all periods together. Inspect solver status, independent checks, allocations, outputs, capacity usage, binding constraints and inventory balances. Save/duplicate scenarios and compare two historical runs. Reopening a run restores its original inputs; rerunning creates a new run.

The scheduling Smart Import uses the same CSV-only picker and preserves its AI-first steps, transformations, rules wizard and dataset validation. Validated imported schedules now use an adapter to the existing GLPK solver, enforcing roles, variable shift intervals, availability, weekly/daily hour caps, weekly shift counts, rest gaps, same-day shift rules, closed weekdays, and timezone-aware durations. Ambiguous/nonexistent daylight-saving times are rejected. The seven-day import does not include prior/future assignments, so rest at the period boundary cannot be verified. Demo scheduling remains separate and retains its independent-check CSV and Excel exports; manual edits never inherit an optimality claim in those exports.

## Mathematical model

Indices: periods t, resources r, projects p, resource types k. `x[r,p,t] ≥ 0` allocates a resource; `y[p,t] ≥ 0` is project output. Whole-unit flags make the corresponding x/y variables integer. Incompatible links have no decision variable and contribute zero. Explicit link minima/maxima and output minima/maxima remain hard constraints.

For every period:

- Resource withdrawal capacity: `sum_p x[r,p,t] ≤ capacity[r,t]`.
- Demand balance by type and unit: `sum_(r of k) x[r,p,t] = demand[p,k,t] * y[p,t]`.
- Period cost: `C[t] = sum_(r,p) cost[r,t] * x[r,p,t]`.
- Optional period budget: `C[t] ≤ budget[t]`.

Demand coefficients have units resource-units/output-unit. Costs are currency/resource-unit; values are currency/output-unit. Types with different resource units cannot be substituted. Resource/project identities, units and whole-unit flags must match across periods; coefficients, costs, capacities, compatibility and limits may differ. Use zero limits for inactive catalogs instead of silently omitting them.

**Renewable:** capacity is independently available each period; nothing is carried forward.

**Consumable:** explicitly supplied opening stock and receipts obey

`opening[r,t] + receipts[r,t] = sum_p x[r,p,t] + closing[r,t] + discarded[r,t]`.

Only t=0 uses the entered opening stock. Subsequent opening equals previous closing. Carryover is off by default: closing is fixed at zero and unconsumed stock is reported as discarded. Enabling carryover fixes discarded to zero. Receipts are fixed inputs, not purchasing decisions. Existing capacity remains a separate withdrawal/throughput limit. Consumption is charged at that period's cost; acquisition, holding, salvage and disposal costs are not modeled.

Optional horizon constraints couple all periods: `sum_t C[t] ≤ horizon_budget` and lower/upper bounds on `sum_t y[p,t]`. The solver receives one joint model, not independent per-period solves.

Objectives:

- Cost: minimize `sum_t C[t]`, subject to all required output. Zero required output can correctly yield a zero-activity optimum.
- Output: maximize `sum_(p,t) weight[p] * y[p,t]`. Same-unit output defaults to weight 1; mixed units require explicit positive conversion/utility weights. This is not revenue.
- Net value: maximize `sum_(p,t) value[p,t] * y[p,t] - sum_t C[t]`; every value must be supplied. Priority never multiplies monetary net value.
- Migrated legacy value models retain their original priority-weighted gross-value objective. They are not relabeled net value.

A single undated period is supported for backward compatibility; multi-period plans require explicit dates and resource classification. No stock or receipt is inferred from capacity.

## Verification and status

A separate business-constraint checker recomputes allocations, cost/value/output objective, link/output bounds, compatibility, integrality, capacities, demand balances, budgets, stock balances, carryover policies and horizon limits. It does not trust GLPK row activities. Constraint tolerance is 1e-6 absolute; objective tolerance is `1e-6 * max(1, abs(recomputed objective))`. Missing/nonfinite values fail checks. Inputs use explicit numeric limits up to 1e9; avoid poorly scaled models.

- OPTIMAL + verified: GLPK proved optimality under its numerical tolerances and the independent checker accepted feasibility.
- FEASIBLE + verified: valid candidate, optimality not established.
- INFEASIBLE: GLPK proved no feasible allocation; messages include detectable per-period shortages, not a fabricated minimal conflict set.
- UNBOUNDED: no finite optimal objective; no accepted recommendation.
- UNKNOWN: no usable status, including ambiguous solver termination; no claim of infeasibility or optimality.
- ERROR / cancelled / interrupted: no accepted result. A rejected candidate can retain failed verification evidence but is not exported as a recommendation.

Binding constraints describe reached bounds, not marginal improvement estimates. Explanations show verified arithmetic; scenario differences are observations, not proof of causality or financial savings. Period slices are labeled feasible and reference joint optimality, not independent period optimality.

## History, scenarios and cancellation

IndexedDB `optiflow-planning` stores scenarios and runs; mappings use localStorage `optiflow-allocation-profiles-v1`. Existing `optiflow-resource-allocation-v1` data is preserved and migrated into a separate scenario. Draft scenarios may be saved with validation errors but cannot be solved until corrected.

Every run stores a cloned input snapshot, SHA-256 input hash, period catalogs/source mappings, constraints, objective, solver/verifier versions, time/gap/tolerance settings, timestamps, raw variables, status and verification evidence. Completed run records cannot be overwritten through the repository. Scenario revisions can change; old run inputs remain immutable. Deleting a scenario leaves its historical snapshots intact. Different optimal allocations may appear on a rerun when multiple optima exist.

Storage failures are surfaced. Browser site-data clearing removes local history. There is no account sync, encryption at rest, team concurrency control or durable remote backup. Export important inputs/results. Scenario edits are last-writer-wins across tabs; avoid simultaneous editing of the same scenario. Recovery marks unfinished runs interrupted only after the initialization/solve deadline, so it does not cancel live work in another tab. Use Refresh history after the deadline.

Solving runs in the existing GLPK worker. The UI reports real elapsed time and phase; continuous LP callbacks may expose observed simplex objective values. They are not verified incumbents. The wrapper does not supply reliable MIP gap/node progress, so no percentage or invented progress bar is displayed. Cancellation settles the controller promise, terminates the worker, and saves a cancelled run. Initialization and solve deadlines are bounded. Independent verification and model assembly occur on the main thread, bounded by prototype size limits; extremely large inputs may briefly block during these phases.

## Exports and limits

CSV exports cover allocations, outputs, period summaries, stock movements, verification, raw solver variables, scenario snapshots and comparisons. Excel run workbooks contain the same sheets, with source text stored as literal cell values (formulas are not executed). Input JSON is chunked to keep each Excel cell within its limit; concatenate chunks in index order to reconstruct the snapshot. CSV exports preserve source text; import text columns explicitly when opening CSV in spreadsheet software.

Import limits: 10 CSV files, 2 MB and 5,000 data rows per file, 80 columns per file, and 10,000 combined source rows. Excess input produces errors, not truncated success.

Planning limits: 24 periods; each period retains 50 resources, 50 projects, 500 demand records and 2,500 compatibility links; solve limit 1–120 seconds. There is no automatic unit/currency conversion, project-output inventory, precedence, purchasing, stochastic demand, nonlinear objective, arbitrary free-text constraint execution, or dual-price sensitivity analysis. Imported scheduling is limited to 30 employees and 100 shift requirements and cannot certify rest against assignments outside its seven-day horizon.

## Next steps

Browser-driven interaction tests (including IndexedDB transaction/quota behavior), full translations of new controls, larger-model performance profiling, period-column import grouping, scenario conflict handling across tabs, and general imported-scheduling constraint support are the next implementation milestones. Production deployment requires explicit approval.

## Executed validation

The upgrade was checked with `npm test` (107 passing JavaScript tests), `npm run typecheck`, and `npm run build`. The existing optional Python API suite passed all 3 tests; its first sandboxed invocation stalled, and the successful rerun used normal local-process permissions. The backend reports an existing Starlette/httpx deprecation warning. No new Python dependency was added.

Tests include real GLPK objective solutions and infeasibility/unbounded statuses, corrupted-candidate verification, explicit stock carryover, source mappings/profiles, Excel exports, immutable snapshot/hash behavior, controller cancellation and failed persistence via an injected repository, and server-rendered UI regressions. IndexedDB transactions and browser worker/click interactions still require real-browser testing; those are not claimed as tested. No separate lint script is configured.
