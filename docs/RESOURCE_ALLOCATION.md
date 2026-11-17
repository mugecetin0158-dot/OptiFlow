# OptiFlow v0.2 — Resource Allocation

A browser-local, general resource-to-project LP/MILP module integrated with the existing Next.js application. It reuses the installed GLPK WebAssembly/Web Worker package and Smart Import's CSV parser, decoder, header normalization, decimal normalization, CSV writer, and source-row conventions. No new dependency, API, authentication system, or hosting migration is required. Scheduling and its existing import workflow retain their own schemas, storage, and solver.

## Run and try

```sh
npm ci
npm run dev
# http://localhost:3000 → Resource Allocation
npm test
npm run typecheck
npm run build
```

The workspace initially contains no business data. Choose **Load labeled sample** to explicitly load fictional data, or **Start manual entry** and fill the four catalogs. Existing local validated resource data is restored if available. Loading a sample or starting over asks before replacing a populated workspace. Input edits clear prior results; a solve finishing after an edit cannot overwrite the new state.

The sample represents a studio's single delivery week. In **Minimize cost**, the Website project requires one output, optional audits require zero, and the independently verified optimum is **USD 1,380**. Switch to **Maximize priority-weighted value** and run again: the optimum is **11,000 weighted USD**, with one Website and three Audits. All sample priorities equal 1, so gross value is also USD 11,000. This is stated project value, **not profit, savings, revenue recognition, or a forecast**. Value maximization does not break objective ties by minimizing cost.

## Catalogs and units

| Dataset         | Canonical columns                                                                       |
| --------------- | --------------------------------------------------------------------------------------- |
| `resources.csv` | `resource_id,name,resource_type,unit,capacity,unit_cost,integer`                        |
| `projects.csv`  | `project_id,name,output_unit,minimum_output,maximum_output,unit_value,priority,integer` |
| `demands.csv`   | `project_id,resource_type,unit,amount_per_output`                                       |
| `links.csv`     | `resource_id,project_id,compatible,minimum_allocation,maximum_allocation`               |

The optional `optiflow_model_settings.csv` file contains exactly one row with `objective`, `planning_period`, and `currency`; `budget` is optional. Its objective must explicitly identify cost minimization (`cost` or `minimize_cost`) or priority-weighted value maximization (`value` or `maximize_priority_weighted_value`). The importer maps these values into the existing allocation model settings. An omitted budget preserves an existing setting; a supplied blank budget means no budget limit. Missing required settings are surfaced for correction rather than inferred.

- Resource/project IDs are unique strings; leading zeros are retained. Names, types, units, and references are case-sensitive. One resource can supply several projects, and multiple resources can substitute for each other only within the **same resource type and unit**. Engineering hours do not replace design hours merely because both use hours. `hour` and `minute` never imply automatic conversion.
- `capacity` is total resource quantity in the selected planning period. `unit_cost` is the cost in the single chosen currency per unit allocated, not a fixed cost for owning capacity. All numeric inputs are nonnegative, finite, and at most 1e9; demands and priority weights are strictly positive. The product of value and priority must be at most 1e9. Scale extreme models before solving.
- `amount_per_output` is resource units per one project output unit. For example, 30 engineering hours per delivered website. Every project must have at least one explicit positive demand. Multiple resource categories require separate demand rows. Duplicate project/type/unit demands are errors, not silently summed.
- `minimum_output` is a hard output obligation in **both objectives**. `maximum_output` is a hard upper limit. An indivisible, optional project uses `integer=true`, minimum 0 and maximum 1; a mandatory one uses minimum and maximum 1. Continuous output can represent divisible work or production volume; integer output can represent whole jobs or batches.
- Resource `integer=true` makes **each resource-to-project allocation** an integer quantity. It does not automatically make project output integer. These are separate decisions. Fractional bounds on integer variables remain hard constraints; e.g. an integer output restricted to [0.5, 0.8] is infeasible.
- `compatible=true` is required to allocate along a resource/project pair. An omitted link or an explicit false link forbids allocation. Link references must exist. Compatible links must match a demand for the project's resource type/unit. Link minima/maxima are **total quantities for the whole period**, not quantities per output. A positive link minimum is unconditional and may force production. Incompatible links must have minimum 0.
- Enter the literal `unlimited` for unlimited capacity, maximum output, or maximum allocation. Blank required limits are errors and never become infinity. A blank optional **budget** explicitly means no budget constraint; a zero budget remains a real zero limit. Blank optional **priority** means weight 1, as labeled. `unit_value` may be omitted for cost minimization, but value maximization requires an explicit value, including an explicit zero where appropriate. Missing values are never inferred from names or sample data.
- `integer` and `compatible` are explicit booleans. CSV accepts true/false and YES/NO; unknown values require correction. Canonical tables use true/false. Edited numeric cells use a decimal point. CSV fractional numbers require an explicit dot/comma decimal convention; thousands separators and currency symbols are not guessed.

## Mathematical formulation

Let R be resources, P projects, and A the explicitly compatible resource/project pairs. A resource has type/unit key k(r). For each project's demand key k, d[p,k] is resource quantity required per output unit. Let:

- x[r,p] ≥ 0 be resource r allocated to project p, for (r,p) in A; all other allocations are fixed at zero.
- y[p] ≥ 0 be project output in that project's output unit.
- C[r] be resource capacity, c[r] cost per resource unit, v[p] value per output, and w[p] the optional priority weight.
- m[p], M[p] be output bounds; L[r,p], U[r,p] be allocation bounds; B be the optional budget.

**Cost minimization:**

```text
minimize Σ_(r,p in A) c[r] x[r,p]
```

**Value maximization:**

```text
maximize Σ_p w[p] v[p] y[p]
```

Both models enforce:

```text
Σ_(p: (r,p) in A) x[r,p] ≤ C[r]                    for each finite resource capacity
Σ_(r: (r,p) in A, k(r)=k) x[r,p] = d[p,k] y[p]      for every project demand key
m[p] ≤ y[p] ≤ M[p]                                for each project
L[r,p] ≤ x[r,p] ≤ U[r,p]                          for each allowed pair
Σ_(r,p in A) c[r] x[r,p] ≤ B                       when a budget is supplied
```

Explicitly unlimited upper bounds are omitted, not replaced with an arbitrary large number. Demand equalities prevent allocating unused surplus merely to inflate utilization. Individual integer flags restrict the corresponding x or y variables to integers; otherwise they remain continuous. Integer variables with [0,1] output bounds implement binary project selection. Limits are represented as rows so fractional limits on integer decisions are enforced without silently rounding or causing invalid GLPK column bounds.

Costs are currency amounts. Values are declared currency per output; the value objective is **priority-weighted currency**, not necessarily actual monetary value. Reports therefore show the objective, gross unweighted project value, and total cost separately. No cross-resource aggregate utilization mixes incompatible units. All capacity/usage totals refer to one planning period; the period is a label, not a temporal schedule.

## Solver statuses and result checks

| GLPK result                            | Application status | Behavior                                                                                                     |
| -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `GLP_OPT`                              | `OPTIMAL`          | Display only after independent business-constraint and objective checks. MIP relative gap requested is zero. |
| `GLP_FEAS`                             | `FEASIBLE`         | Display independently validated candidate; explicitly state optimality was not proved.                       |
| `GLP_NOFEAS`                           | `INFEASIBLE`       | No accepted allocation. Report constraints to inspect and detectable project/type capacity shortages.        |
| `GLP_UNBND`                            | `UNBOUNDED`        | No finite objective/accepted allocation. Explain explicit unbounded capacity, output, and budget choices.    |
| `GLP_UNDEF`, `GLP_INFEAS`, other codes | `UNKNOWN`          | No accepted allocation. An infeasible iterate is not proof the model is infeasible.                          |
| Failed independent checks              | `ERROR`            | Reject the candidate and expose diagnostics. No result export.                                               |

The browser solve uses a fresh GLPK worker, a 20-second solve limit, zero requested MIP gap, and terminates the worker after the run. Pure LPs use simplex without presolve to retain definitive unbounded status reporting. MIPs use presolve. GLPK may report an indeterminate MIP when its relaxation is unbounded; this remains **Unknown**, since an unbounded continuous relaxation alone is not proof of integer feasibility and unboundedness.

An independent checker evaluates nonnegativity, integrality, resource totals, project output bounds, compatibility, link limits, exact per-type/unit demands, and budget from the returned decisions. It recalculates costs and values and compares the objective with GLPK's result. Missing or nonfinite decision values are rejected. Business constraints and integrality use **absolute tolerance 1e-6 units**. Objective agreement uses relative tolerance 1e-6. These are floating-point numerical tolerances, not configurable soft constraints or business-level relaxations.

Constraint reports show activity, lower/upper bounds, and slack in each constraint's own units. Binding means slack within 1e-6 of zero; demand equalities always bind. Binding is **not** a shadow price, marginal value, or proof of scarcity. MIP dual prices are not claimed. Resource utilization percentages are not defined for unlimited or zero capacity; quantities remain visible.

## Smart Import integration

1. **Upload:** open **Smart Import → Import destination → Resource Allocation**. Before selecting files, review the required and optional fields for resources, projects, demands, compatibility links, and model settings. Upload the four fictional catalog files in `tests/fixtures/allocation/`, optionally with `optiflow_model_settings.csv`, or your own CSVs.
2. **AI Interpretation:** review AI-proposed dataset and column mappings, confirm each source's meaning, and correct transformed values. Multiple files per catalog table are supported; each catalog file represents one table. Model settings are a single-row dataset and the exact `optiflow_model_settings.csv` filename is recognized automatically. Unknown boolean/decimal values remain preserved with field and source-line errors.
3. **Missing Information:** fill only fields reported by deterministic model validation. This stage is skipped when all required information is present. Capacity, maximum output, maximum allocation, and project priority retain their documented optional/unlimited/default behavior; value per output is required only for value maximization.
4. **Preview:** review the validated catalogs and settings, fix references, duplicates, and pending values, and optionally download canonical catalogs. Editing a flagged cell explicitly resolves its normalization question, subject to validation. No resource, project, capacity, compatibility, or demand is manufactured.
5. **Save:** confirm the replacement checkbox and **Save & use resource data**. This replaces only the resource workspace and opens its module. Dataset validity does not imply feasibility; run the optimizer separately.

The importer is an allocation-domain adapter using shared Smart Import primitives. Scheduling's richer time-range transformations and reusable profiles are preserved unchanged. Resource mapping profiles and multi-dataset rows within one source file are not yet supported; classify each allocation file as a single catalog table. `rate` and other ambiguous headers remain unmapped. CSV delimiter/encoding behavior follows the existing parser (quoted cells, escaped quotes, multiline fields, UTF-8/UTF-16 BOM, explicit Windows-1252/1254, comma/semicolon/tab/pipe).

## Persistence and exports

- Validated resource drafts/settings save explicitly under `optiflow-resource-allocation-v1`; reload revalidates them. Existing Scheduling keys are untouched. Invalid drafts cannot be saved as validated inputs.
- Editing works in session without automatic saves; use **Save locally** for persistence. Results are not persisted or automatically rerun. Raw CSV text remains only in session memory. Navigating to the landing page or reloading discards unsaved drafts/raw imports, as with the existing app.
- CSV processing, validation and solving stay in the browser even if the optional Scheduling Python API is configured. There is no allocation backend, external data upload, new authentication, paid service, or AI API.
- `resource_allocations.csv` records status, objective/mode, currency/period, resource/project identifiers and names, project output, type/unit, allocated quantity, cost per unit, and actual allocation cost. Zero allocations are included for traceability. `project_outputs.csv` includes all project outputs, including zeros and projects with no allowed links.
- Exports are UTF-8 with BOM, quoted/escaped CSV cells and canonical headers. Values are preserved; formula-like text receives an input warning. Import such columns as text in spreadsheet applications. Empty unknown project value is not exported as zero.
- Local storage is device/browser-specific, unencrypted and subject to quotas; there is no cross-device sharing or automatic backup.

## Limits and development scope

Up to 50 resources, 50 projects, 500 demand rows, 2,500 links; CSV parsing limits remain 10 files, 2 MB/file, 5,000 rows/file and 10,000 uploaded rows total. No multi-period carryover, time windows, conversion efficiencies, fixed setup costs, uncertain demand, nonlinear economies, cross-project dependencies, fairness objectives, lexicographic tie-breaking, or scheduling coupling is implied. Same-type/unit resources are perfectly substitutable at a 1:1 conversion ratio. Positive demand is consumed proportionally to output. Larger and badly scaled models may return Unknown or fail independent validation.

The existing imported-Scheduling optimizer gate is intentionally unchanged. This module solves resource allocations directly; it does not convert imported employee data into a staff schedule.

Next steps would be reusable resource import profiles, unit-conversion policies, multi-period/resource-flow extensions, richer infeasibility certificates, model/run history, and additional browser/device interaction tests. Any future production storage/security architecture is outside v0.2; none was introduced here.

## Source organization and checks

- `lib/allocation/types.ts`: independent catalog, draft, input, result, and constraint types.
- `validation.ts`: strict input validation, draft conversion, numeric and dimensional checks.
- `model.ts`: LP/MILP construction, independent result analysis, detectable shortages.
- `solver.ts`: GLPK options/status mapping and post-solve acceptance.
- `import.ts`: shared-parser adapter, aliases, mapping/normalization, provenance, catalog exports.
- `storage.ts`: separate validated local persistence and result exports.
- `sample.ts`: labeled fictional sample.
- `components/allocation/`: catalogs/settings, resource import, results, workspace lifecycle.
- `app/page.tsx`, `app/layout.tsx`, `app/allocation.css`: navigation, module availability, destination selector, styling.
- `lib/translations.json`: English/Turkish/French UI and validation labels. Canonical CSV headers, user data and technical identifier diagnostics remain stable.
- `tests/allocation.test.ts`, `tests/allocation-ui.test.tsx`, `tests/fixtures/allocation/`: actual GLPK tests, exhaustive small-instance oracle, CSV→validation→persistence→solver→export integration, and React server-render checks.

`npm test` also reruns all original scheduling and Smart Import regressions. Browser automation is unavailable in the managed workspace; server rendering does not constitute click/drag-drop or visual end-to-end verification. No ESLint setup exists; use TypeScript, production compilation, and `git diff --check`.

### Executed verification for this release

All **81 automated tests** passed: 54 pre-existing Scheduling/Smart Import checks, 21 Resource Allocation solver/import tests, and 6 new React server-render/localization checks. `npm run typecheck`, `npm run build`, and `git diff --check` also passed. No browser interaction test or Python/backend change is claimed.
