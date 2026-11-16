# Public MVP deployment readiness

## Recommendation and authorization boundary

Keep this repository private. OptiFlow is a static Next.js export (`out/`), with browser-local computation and storage. Vercel is suitable; the existing Sites deployment is also suitable and avoids moving origins (and therefore leaving existing browser-local data behind). No deployment or access change is authorized by this preparation task.

For Vercel, authorize: **Create/connect a Vercel project to this private repository and deploy the reviewed commit as a publicly accessible MVP**. Confirm the Vercel account/team and desired domain. Repository visibility need not change. If staying on Sites, authorize **Deploy the reviewed commit to the existing OptiFlow Site and change its audience to public**. These are different actions; neither has been performed in this audit.

## Setup

Use Node.js 22 LTS, `npm ci`, `npm test`, `npm run typecheck`, then `npm run build`. Import the private repository into Vercel, select Next.js, use repository root, build `npm run build`, output `out`. The committed `vercel.json` sets these values and response headers. Do not configure a Python server, rewrite everything to index.html, or publish the repository directory as static content. Only `out/` is deployable.

No application environment variables or paid APIs are required. Leave `NEXT_PUBLIC_API_URL` unset in Preview and Production; builds now reject it. The optional unauthenticated FastAPI backend is local development only and is not a public production service. `NEXT_PUBLIC_*` values are embedded in downloadable JavaScript: never use them for secrets. Vercel credentials belong in the hosting platform, not project files. `.env*` and `.vercel` are ignored, except the documented `.env.example`.

The existing `public/optiflow-source.zip` intentionally distributes source under GPL-3.0 because GLPK/glpk.js are GPL-3.0. Keeping the Git repository private does not make the deployed JavaScript/source archive confidential. Review this distribution model before commercial publication; do not remove required source availability casually.

## Security review

- No API keys or private-key material were found by pattern scanning application source and generated output. This is a bounded review, not a guarantee that no secret exists anywhere in Git history. The apparent long `sk-` match in a minified library was not a credential.
- No application API routes or production database exist. Spreadsheet contents remain in the browser. Google Fonts requests disclose normal request metadata to Google; they do not send spreadsheet contents.
- Imports are bounded and parsed locally; cached formulas require confirmation, and formulas are not executed. ZIP size checks are not a security boundary against every malicious workbook. Avoid untrusted uploads during beta, and test resource exhaustion before broad release.
- Security headers add MIME sniffing, referrer, framing and unused-device restrictions. A strict CSP is not added untested: GLPK uses Blob workers and WebAssembly, Excel uses a bundled worker, and Next static HTML uses inline hydration scripts. A restrictive policy can break computation silently. Test a report-only policy before enforcing one.
- PostCSS is pinned via override to 8.5.23 to address the reported source-map/file-disclosure and stringify advisories without changing mathematical models or upgrading Next across major versions.
- ExcelJS retains an indirect uuid advisory. The reported vulnerability concerns v3/v5/v6 with caller-supplied buffers; ExcelJS's inspected use is v4 for conditional-format IDs. No application code invokes those affected APIs. This remains a dependency risk, not a claim that the package is advisory-free. Do not apply npm's suggested major downgrade blindly.
- CSV exports preserve text, including spreadsheet formula-looking content. Opening CSV directly in Excel may interpret formulas. Use text import or the XLSX export, whose string cells remain literal. Source files and local browser storage can contain sensitive business data: there is no encryption at rest or shared-account isolation.

## Functional verification and remaining release gates

Automated tests cover real GLPK scheduling and allocation solutions, infeasible/unbounded cases, independent verification, multi-period constraints, import mapping and validation, workbook parsing/export, scenarios, snapshots, cancellation-controller behavior and server-rendered UI. Passing these does not establish browser worker correctness.

Browser automation is unavailable in this environment. Production compilation checks worker bundling, but actual worker startup, cancellation, IndexedDB behavior, downloads, accessibility and mobile layout MUST be checked on a preview deployment before calling the public release fully verified. No real-browser test results are claimed.

Preview acceptance checklist (Chrome desktop, Safari/iPhone, and Android; 375px and 1440px widths):

1. Open Resource Allocation, load the labeled sample, optimize cost; verify objective 1380 and independent checks passing. Confirm Network has no missing JS/WASM/worker files, and Console has no worker/CSP errors.
2. Import the provided sample workbook, select all four worksheets, confirm meanings/mappings, validate, configure and save. Solve and compare with the sample optimum. Also test malformed CSV, ambiguous values, missing formulas and errors beyond the first preview page.
3. Add a dated second period, explicitly classify resources, set receipts/carryover and horizon constraints. Verify outputs/capacities/budgets and inventory balances. Try an infeasible model; no accepted recommendation should appear.
4. Cancel a running solve; ensure the UI stays responsive and the run is cancelled. Reload, reopen a historical run, reverify, and duplicate/compare scenarios. Test storage denial/quota behavior.
5. Export CSV and Excel, reopen them and compare amounts, IDs and verification status. Test text starting with `=` using XLSX or CSV text import.
6. Scheduling: solve each fictional preset, edit an assignment into a violation, check warnings and export labeling. Imported scheduling remains gated because the demo optimizer cannot enforce every imported rule.
7. Check mobile navigation, horizontal tables, all five import steps, dark mode, keyboard controls and zoom. Existing responsive CSS remains; visual/device correctness is not established by static rendering tests.

## Beta limitations

A visible MVP Beta notice now explains local persistence and human review. Independent feasibility verification is preserved and remains distinct from solver-proven optimality. Existing limits include one-period-at-a-time imports, maximum 24 planning periods, English-only new planning controls, no team synchronization, no regulatory compliance guarantee and no durable backup. Browser origin changes do not migrate localStorage/IndexedDB; export before changing hosts. See PLANNING_UPGRADE.md for model assumptions and full limits.

## Executed audit results

- `npm test`: 107 passed.
- `npm run build`: passed; static export generated.
- `npm run typecheck`: passed after build completion. A concurrent attempt initially encountered regenerated `.next/types` files; run these commands sequentially.
- `npm run check:production`: passed (referenced static assets, workbook availability, Vercel output configuration and local-API build rejection). This is not a browser test.
- `npm audit --omit=dev`: two moderate findings (ExcelJS/uuid), zero high or critical after the PostCSS patch. Audit exits nonzero because these findings remain.
- `git diff --check`: passed. No standalone lint command/configuration exists; no separate lint success is claimed.
- The optional Python backend was not modified or rerun during this audit. Its three tests passed in the preceding implementation validation.

Status: repository prepared for a preview deployment; public-launch recommendation remains conditional on completing the browser acceptance checklist and accepting or resolving the residual dependency risk. No code was pushed, deployed, or made public during this audit.
