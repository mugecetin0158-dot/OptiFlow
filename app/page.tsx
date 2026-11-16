"use client";
import { useEffect, useState, useRef } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  LayoutDashboard,
  CalendarDays,
  Layers,
  Users,
  Boxes,
  Wallet,
  ChartNoAxesCombined,
  Workflow,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  Plus,
  Download,
  Check,
  CheckCircle2,
  X,
  Settings2,
  Play,
  Clock,
  Menu,
  SlidersHorizontal,
  BookOpen,
  RotateCcw,
  Trash2,
  AlertCircle,
  Loader2,
  Zap,
  ArrowDownToLine,
  Building2,
  Languages,
  Upload,
} from "lucide-react";
import {
  Scenario,
  Result,
  preset,
  analyze,
  duration,
  dateFor,
  inputErrors,
  csv,
} from "../lib/model";
import { solve } from "../lib/solver";
import initialResult from "../lib/demo.json";
import ScheduleExports from "../components/ScheduleExports";
import ResourceWorkspace from "../components/allocation/ResourceWorkspace";
import SmartImport from "../components/smart-import/SmartImport";
import ImportedSchedule from "../components/smart-import/ImportedSchedule";
import { SavedImport, Rules } from "../lib/import/types";
import { loadValidated } from "../lib/import/storage";
import {
  Language,
  languages,
  isLanguage,
  translate,
  formatMoney,
  formatNumber,
  formatDay,
  formatRunTime,
  weekLetters,
} from "../lib/i18n";
const modules = [
  {
    name: "Scheduling",
    icon: CalendarDays,
    desc: "The right people. The right shifts. The lowest cost.",
    tag: "Available now",
  },
  {
    name: "Resource Allocation",
    icon: Layers,
    desc: "Put your resources where they make the biggest difference.",
  },
  {
    name: "Inventory Optimization",
    icon: Boxes,
    desc: "Balance stock levels with demand and carrying costs.",
  },
  {
    name: "Budget Optimization",
    icon: Wallet,
    desc: "Make every dollar work toward your business goals.",
  },
  {
    name: "Workforce Planning",
    icon: Users,
    desc: "Build a team that keeps pace with your business.",
  },
  {
    name: "Decision Analysis",
    icon: Workflow,
    desc: "Compare alternatives and move forward with confidence.",
  },
];
const initials = (n: string) =>
  n
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
function Logo() {
  return (
    <span className="brand">
      <span className="logo">
        <i />
        <i />
        <i />
      </span>
      OptiFlow<span className="version">v0.2</span>
    </span>
  );
}
export default function App() {
  const [importTarget, setImportTarget] = useState<"scheduling" | "allocation">(
    "scheduling",
  );
  const [imported, setImported] = useState<SavedImport | null>(null);
  const [importRules, setImportRules] = useState<Rules | null>(null);
  const [sourceMode, setSourceMode] = useState<"demo" | "import">("demo");
  const [language, setLanguage] = useState<Language>("en");
  function tr<T>(value: T): T {
    return (
      typeof value === "string" ? translate(language, value) : value
    ) as T;
  }
  const money = (n: number) => formatMoney(language, n);
  const number = (n: number) => formatNumber(language, n);
  const labels = (scenario: Scenario) =>
    Array.from({ length: 7 }, (_, i) =>
      dateFor(scenario.startDate, i)
        ? formatDay(language, dateFor(scenario.startDate, i))
        : tr(`Day ${i + 1}`),
    );
  const [page, setPage] = useState("Dashboard"),
    [tab, setTab] = useState("Schedule"),
    [p, setP] = useState<Scenario>(preset()),
    [result, setResult] = useState<Result | null>(initialResult as Result),
    [edited, setEdited] = useState(false),
    [busy, setBusy] = useState(false),
    [dark, setDark] = useState(false),
    [menu, setMenu] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [editShift, setEditShift] = useState<number | null>(null),
    [ready, setReady] = useState(false),
    [runs, setRuns] = useState<any[]>([
      {
        id: 0,
        name: "Retail Store",
        status: "OPTIMAL",
        cost: analyze(preset(), initialResult.assignments).totalCost,
        time: "Included solved example",
      },
    ]),
    [scenario, setScenario] = useState("Retail Store");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("optiflow-v1");
      if (saved) {
        const s = JSON.parse(saved);
        if (s.p && inputErrors(s.p).length === 0) {
          setP(s.p);
          setScenario(s.p.name);
          setResult(s.result);
          setEdited(!!s.edited);
          setRuns(s.runs || []);
        }
      }
      setDark(localStorage.getItem("optiflow-theme") === "dark");
      const savedLanguage = localStorage.getItem("optiflow-language");
      if (isLanguage(savedLanguage)) setLanguage(savedLanguage);
    } catch {}
    try {
      const data = loadValidated(localStorage);
      if (data) {
        setImported(data.saved);
        setImportRules(data.rules);
        if (localStorage.getItem("optiflow-source-mode") === "import")
          setSourceMode("import");
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(
          "optiflow-v1",
          JSON.stringify({ p, result, edited, runs }),
        );
      } catch {
        setError(
          "Browser storage is unavailable. Changes will only last until you close this page.",
        );
      }
  }, [p, result, edited, runs, ready]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("optiflow-theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (editShift === null) return;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditShift(null);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
        ),
      );
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [editShift]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `OptiFlow — ${translate(language, "Smarter Decisions. Better Operations.")}`;
    if (ready)
      try {
        localStorage.setItem("optiflow-language", language);
      } catch {}
  }, [language, ready]);
  const revision = useRef(0);
  const stats = result?.assignments.length
    ? analyze(p, result.assignments)
    : null;
  function go(s: string) {
    setPage(s);
    setMenu(false);
    setError("");
  }
  function update(next: Scenario) {
    revision.current++;
    setP(next);
    setResult(null);
    setEdited(false);
    setError("");
  }
  function load() {
    update(preset(scenario));
    setToast(`${scenario} example loaded`);
    setEditShift(null);
  }
  async function generate() {
    if (sourceMode === "import") {
      setError("Imported data cannot be sent to the demo optimizer.");
      return;
    }
    setError("");
    const errors = inputErrors(p);
    if (errors.length) {
      setError(errors.join("\n"));
      return;
    }
    setBusy(true);
    setResult(null);
    setEdited(false);
    const job = revision.current;
    try {
      let r: Result;
      if (process.env.NEXT_PUBLIC_API_URL) {
        const response = await fetch(
          process.env.NEXT_PUBLIC_API_URL + "/solve",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
            signal: AbortSignal.timeout(30000),
          },
        );
        if (!response.ok)
          throw new Error(
            "The optimization backend rejected this request. Check that it is running and the inputs are valid.",
          );
        r = await response.json();
      } else {
        const GLPK = (await import("glpk.js")).default;
        const g = await GLPK();
        try {
          r = await solve(p, g);
        } finally {
          (g as any).terminate?.();
        }
      }
      if (job !== revision.current) {
        setToast(
          "Inputs changed during optimization. Generate a new schedule.",
        );
        return;
      }
      if (r.assignments.length && analyze(p, r.assignments).violations.length)
        throw new Error(
          "The returned schedule failed independent constraint validation.",
        );
      setResult(r);
      setTab("Schedule");
      setRuns((old) =>
        [
          {
            id: Date.now(),
            name: p.name,
            status: r.status,
            cost: r.assignments.length
              ? analyze(p, r.assignments).totalCost
              : null,
            time: new Date().toISOString(),
          },
          ...old,
        ].slice(0, 8),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Optimization failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function exportSchedule() {
    if (!result?.assignments.length) return;
    const url = URL.createObjectURL(
      new Blob(["\ufeff", csv(p, result.assignments, tr)], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `optiflow-${p.startDate}${stats?.violations.length ? "-INVALID-DRAFT" : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(
      stats?.violations.length
        ? "Exported as an invalid draft. Review constraint warnings."
        : "Schedule exported successfully",
    );
  }
  function assignment(id: string) {
    if (editShift === null || !result) return;
    const a = result.assignments.map((ids) => [...ids]);
    a[editShift] = a[editShift].includes(id)
      ? a[editShift].filter((x) => x !== id)
      : [...a[editShift], id];
    setResult({ ...result, assignments: a });
    setEdited(true);
  }
  const languageSelector = (
    <label className="language-selector">
      <Languages size={16} aria-hidden="true" />
      <span className="sr-only">{tr("Language")}</span>
      <select
        aria-label={tr("Language")}
        value={language}
        onChange={(e) => {
          if (isLanguage(e.target.value)) setLanguage(e.target.value);
        }}
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
  const action = (
    <button className="btn primary" onClick={generate} disabled={busy}>
      {busy ? <Loader2 className="spin" size={17} /> : <Zap size={17} />}{" "}
      {tr(busy ? "Solving schedule…" : "Generate Optimal Schedule")}
    </button>
  );
  const metrics = (
    <div className="metrics">
      {[
        {
          name: "Weekly labor cost",
          value: stats ? money(stats.totalCost) : "—",
          detail: stats
            ? "Based on actual assignments"
            : "Generate a schedule to calculate",
          icon: Wallet,
        },
        {
          name: "Scheduled hours",
          value: stats ? `${stats.totalHours} hrs` : "—",
          detail: `${p.employees.length} employees in your team`,
          icon: Clock,
        },
        {
          name: "Staffing coverage",
          value: stats ? `${stats.coverage.toFixed(0)}%` : "—",
          detail: stats
            ? `${p.shifts.filter((s) => s.required > 0).length} shifts with staffing requirements`
            : "Coverage across the scheduling period",
          icon: Users,
        },
        {
          name: "Schedule health",
          value: stats
            ? stats.violations.length
              ? "Needs review"
              : "All clear"
            : "Ready to run",
          detail: stats
            ? stats.violations.length
              ? `${stats.violations.length} constraint violations`
              : "All hard constraints satisfied"
            : "Your inputs are ready to optimize",
          icon: CheckCircle2,
        },
      ].map((m) => (
        <div className="metric" key={m.name}>
          <div className="metric-top">
            {tr(m.name)}
            <m.icon size={17} />
          </div>
          <strong>{tr(m.value)}</strong>
          <small>{tr(m.detail)}</small>
        </div>
      ))}
    </div>
  );
  const scenarioControl = (
    <div className="scenario">
      <div className="scenario-icon">
        <Building2 size={20} />
      </div>
      <div>
        <strong>{tr("Explore a demo scenario")}</strong>
        <small>{tr("Fictional data. Real optimization.")}</small>
      </div>
      <div className="scenario-actions">
        <select
          aria-label={tr("Demo scenario")}
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        >
          {["Retail Store", "Café", "Office", "Infeasible test"].map((n) => (
            <option key={n} value={n}>
              {tr(n)}
            </option>
          ))}
        </select>
        <button className="btn" onClick={load}>
          <RotateCcw size={15} />
          {tr("Load example")}
        </button>
      </div>
    </div>
  );
  const moduleGrid = (
    <div className="module-grid">
      {modules.map((m, i) => (
        <article className={`module ${i < 2 ? "available" : ""}`} key={m.name}>
          <div className="module-head">
            <span className="module-icon">
              <m.icon size={23} />
            </span>
            <span className={`badge ${i < 2 ? "green" : "muted"}`}>
              {tr(i < 2 ? "Available now" : "Coming soon")}
            </span>
          </div>
          <h3>{tr(m.name)}</h3>
          <p>{tr(m.desc)}</p>
          {i < 2 ? (
            <button
              className="text-link"
              onClick={() => {
                go(m.name);
                if (i === 0) setTab("Schedule");
              }}
            >
              {tr(i === 0 ? "Open scheduling " : "Open resource allocation")}
              <ArrowRight size={17} />
            </button>
          ) : (
            <span className="planned">
              {tr("On the roadmap ")}
              <span>{tr("↗")}</span>
            </span>
          )}
        </article>
      ))}
    </div>
  );
  if (page === "Home")
    return (
      <div className="landing">
        <nav>
          <Logo />
          <div>
            {languageSelector}
            <button
              className="link"
              onClick={() =>
                document
                  .getElementById("features")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              {tr("Platform")}
            </button>
            <button
              className="link"
              onClick={() =>
                document
                  .getElementById("use-cases")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              {tr("Use cases")}
            </button>
            <button
              className="icon-btn"
              aria-label={tr("Toggle theme")}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button className="btn primary" onClick={() => go("Dashboard")}>
              {tr("Launch Demo ")}
              <ArrowUpRight size={16} />
            </button>
          </div>
        </nav>
        <section className="hero">
          <div>
            <span className="eyebrow">
              <span className="dot" />
              {tr(" OPERATIONS, OPTIMIZED")}
            </span>
            <h1>
              {tr("Smarter Decisions.")}
              <br />
              <em>{tr("Better Operations.")}</em>
            </h1>
            <p>
              {tr(
                "Turn everyday business complexity into your next best move. Mathematical optimization, made accessible to every team.",
              )}
            </p>
            <button
              className="btn primary large"
              onClick={() => go("Dashboard")}
            >
              {tr("Launch Demo ")}
              <ArrowRight size={18} />
            </button>
            <small>
              {tr("No sign-up. No paid APIs. Just a smarter way to plan.")}
            </small>
          </div>
          <div className="hero-visual">
            <span className="badge green">
              {tr("● Optimal solution found")}
            </span>
            <h3>{tr("Your week. Working better.")}</h3>
            <div className="mini-days">
              {weekLetters(language).map((d, i) => (
                <div key={i}>
                  <small>{tr(d)}</small>
                  {[0, 1, 2].map((j) => (
                    <span key={j} className={(i + j) % 3 === 0 ? "pale" : ""} />
                  ))}
                </div>
              ))}
            </div>
            <div className="hero-foot">
              <CheckCircle2 size={22} />
              <div>
                <strong>{tr("Every constraint considered.")}</strong>
                <small>{tr("Availability · Coverage · Weekly hours")}</small>
              </div>
            </div>
          </div>
        </section>
        <section className="landing-section" id="features">
          <span className="eyebrow">{tr("BUILT FOR BETTER DECISIONS")}</span>
          <h2>{tr("Less guesswork. More possibility.")}</h2>
          <p>
            {tr(
              "One platform for the operational decisions that move your business forward.",
            )}
          </p>
          {moduleGrid}
        </section>
        <section className="steps">
          {[
            [
              "01",
              "Input",
              "Bring your people, requirements, and real-world constraints.",
            ],
            [
              "02",
              "Optimize",
              "Let a mathematical solver explore the possible assignments.",
            ],
            [
              "03",
              "Improve",
              "Review a feasible plan, make adjustments, and put it to work.",
            ],
          ].map((s) => (
            <div key={s[0]}>
              <span>{tr(s[0])}</span>
              <h3>{tr(s[1])}</h3>
              <p>{tr(s[2])}</p>
            </div>
          ))}
        </section>
        <section className="landing-section" id="use-cases">
          <span className="eyebrow">
            {tr("YOUR BUSINESS, BETTER BALANCED")}
          </span>
          <h2>{tr("Built for everyday operations.")}</h2>
          <div className="use-cases">
            {[
              "Retail & hospitality",
              "Offices & professional services",
              "Education",
              "Logistics & manufacturing",
            ].map((s) => (
              <div key={s}>
                <Building2 />
                <h3>{tr(s)}</h3>
                <p>
                  {tr(
                    "Start with employee scheduling. More optimization tools are planned.",
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
        <footer>
          <Logo />
          <span>{tr("Smarter Decisions. Better Operations.")}</span>
          <button className="link" onClick={() => go("Guide")}>
            {tr("Model & limitations")}
          </button>
        </footer>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <button
          className="brand-button"
          onClick={() => go("Home")}
          aria-label={tr("OptiFlow home")}
        >
          <Logo />
        </button>
        <div className="workspace">
          <span className="workspace-avatar">{"D"}</span>
          <div>
            <strong>{tr("Demo workspace")}</strong>
            <small>{tr("Explore what’s possible")}</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-label">{tr("WORKSPACE")}</span>
        <nav>
          {[
            { name: "Dashboard", icon: LayoutDashboard },
            { name: "Modules", icon: Layers },
            { name: "Scheduling", icon: CalendarDays },
            { name: "Resource Allocation", icon: Layers },
            { name: "Smart Import", icon: Upload },
          ].map((n) => (
            <button
              key={n.name}
              className={page === n.name ? "nav-item active" : "nav-item"}
              onClick={() => go(n.name)}
            >
              <n.icon size={19} />
              {tr(n.name)}
              {["Scheduling", "Resource Allocation"].includes(n.name) && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">
            <Workflow size={22} />
          </span>
          <strong>
            {tr("Small changes.")}
            <br />
            {tr("Smarter operations.")}
          </strong>
          <p>
            {tr("Explore what mathematical optimization can do for your team.")}
          </p>
          <button onClick={() => go("Guide")}>
            {tr("How OptiFlow works ")}
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => go("Guide")}>
            <BookOpen size={18} />
            {tr("Guide & resources")}
          </button>
          <button className="nav-item" onClick={() => setDark(!dark)}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}{" "}
            {tr(dark ? "Light mode" : "Dark mode")}
          </button>
          <div className="profile">
            <span className="avatar">{"DM"}</span>
            <div>
              <strong>{tr("Demo manager")}</strong>
              <small>{tr("Local demo workspace")}</small>
            </div>
            <span className="dot" />
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="scrim"
          aria-label={tr("Close navigation")}
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-btn"
              aria-label={tr("Open navigation")}
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span>{tr("Workspace")}</span>
            <ChevronRight size={14} />
            <strong>{tr(page)}</strong>
          </div>
          <div className="topbar-right">
            {languageSelector}
            <span className="demo-label">
              <span className="dot" />
              {tr("Interactive prototype")}
            </span>
            <button
              className="icon-btn"
              aria-label={tr("Toggle color mode")}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="avatar small">{"DM"}</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {tr(
                  page === "Dashboard"
                    ? "YOUR OPERATIONS, AT A GLANCE"
                    : page === "Scheduling"
                      ? "OPTIMIZATION / SCHEDULING"
                      : "THE OPTIFLOW PLATFORM",
                )}
              </span>
              <h1>
                {tr(
                  page === "Dashboard"
                    ? "A better plan starts here."
                    : page === "Scheduling"
                      ? "Employee scheduling"
                      : page === "Modules"
                        ? "Your optimization toolkit"
                        : page === "Resource Allocation"
                          ? "Resource Allocation"
                          : page === "Smart Import"
                            ? "OptiFlow Smart Import"
                            : "From inputs to optimal decisions.",
                )}
              </h1>
              <p>
                {tr(
                  page === "Dashboard"
                    ? "Welcome back. Turn your operational challenges into clear, confident decisions."
                    : page === "Scheduling"
                      ? "Build a cost-efficient week that works for your team."
                      : page === "Modules"
                        ? "Purpose-built tools for the decisions that matter."
                        : page === "Smart Import"
                          ? "Turn existing CSV files into validated operational data."
                          : "A transparent model. A practical starting point.",
                )}
              </p>
            </div>
            {page === "Dashboard" ? (
              <button className="btn primary" onClick={() => go("Scheduling")}>
                <Plus size={17} />
                {tr("New optimization")}
              </button>
            ) : page === "Scheduling" && sourceMode === "demo" ? (
              <div className="allocation-toolbar">
                <ScheduleExports input={p} result={result} edited={edited} />
                <button
                  className="btn"
                  onClick={exportSchedule}
                  disabled={!stats}
                >
                  <Download size={16} />
                  {tr("Export CSV")}
                </button>
              </div>
            ) : (
              <span className="badge teal">{"OptiFlow v0.2"}</span>
            )}
          </div>
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle size={20} />
              <span style={{ whiteSpace: "pre-line" }}>{tr(error)}</span>
              <button
                aria-label={tr("Dismiss error")}
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "Dashboard" && (
            <>
              {sourceMode === "demo" ? (
                metrics
              ) : (
                <div className="scenario">
                  <FileImportSummary imported={imported} tr={tr} />
                  <button
                    className="btn primary"
                    onClick={() => go("Scheduling")}
                  >
                    {tr("Review imported data")}
                  </button>
                </div>
              )}
              <div className="scenario">
                <div>
                  <strong>{tr("Bring your own business data")}</strong>
                  <small>
                    {tr(
                      "Import CSV files with explicit mappings and validation.",
                    )}
                  </small>
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    setImportTarget("scheduling");
                    go("Smart Import");
                  }}
                >
                  <Upload size={16} />
                  {tr("Open Smart Import")}
                </button>
              </div>
              <div className="dashboard-banner">
                <div>
                  <span className="badge translucent">
                    <Zap size={12} />
                    {tr(" YOUR FIRST STEP TO SMARTER OPERATIONS")}
                  </span>
                  <h2>{tr("A great week starts with the right schedule.")}</h2>
                  <p>
                    {tr(
                      "Balance your team’s availability, meet staffing needs, and keep labor costs in check.",
                    )}
                  </p>
                  <button
                    className="btn white"
                    onClick={() => go("Scheduling")}
                  >
                    {tr("Optimize your schedule ")}
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="banner-art">
                  <div className="art-top">
                    <CalendarDays size={19} />
                    <span>{tr("A week of possibilities")}</span>
                    <CheckCircle2 size={17} />
                  </div>
                  <div className="art-grid">
                    {Array.from({ length: 21 }, (_, i) => (
                      <i
                        className={
                          i % 4 === 0 ? "filled" : i % 3 === 0 ? "light" : ""
                        }
                        key={i}
                      />
                    ))}
                  </div>
                  <span className="art-caption">
                    <span className="dot" />
                    {tr(" Constraints in. Clarity out.")}
                  </span>
                </div>
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    {tr("Optimization modules ")}
                    <span className="count">{tr("6")}</span>
                  </h2>
                  <p>{tr("The tools to make your next move a better one.")}</p>
                </div>
                <button className="text-link" onClick={() => go("Modules")}>
                  {tr("View all modules ")}
                  <ArrowRight size={16} />
                </button>
              </div>
              {moduleGrid}
              <div className="section-heading">
                <div>
                  <h2>{tr("Recent optimization runs")}</h2>
                  <p>{tr("Your latest decisions, all in one place.")}</p>
                </div>
                <span className="badge muted">{tr("This browser")}</span>
              </div>
              <div className="panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{tr("Scenario")}</th>
                      <th>{tr("Module")}</th>
                      <th>{tr("Status")}</th>
                      <th>{tr("Labor cost")}</th>
                      <th>{tr("Run time")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.length ? (
                      runs.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{tr(r.name)}</strong>
                          </td>
                          <td>{tr("Scheduling")}</td>
                          <td>
                            <span
                              className={`badge ${r.status === "OPTIMAL" ? "green" : "muted"}`}
                            >
                              {tr(r.status)}
                            </span>
                          </td>
                          <td>{tr(r.cost === null ? "—" : money(r.cost))}</td>
                          <td>{tr(formatRunTime(language, r.time))}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty-row">
                            <Clock size={22} />
                            <span>
                              {tr("Your first optimization is one click away.")}
                            </span>
                            <button
                              className="text-link"
                              onClick={() => go("Scheduling")}
                            >
                              {tr("Create a schedule ")}
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {page === "Modules" && (
            <>
              {moduleGrid}
              <div className="notice info">
                <BookOpen size={20} />
                <span>
                  {tr(
                    "Scheduling and Resource Allocation are functional. The other four modules are planned features.",
                  )}
                </span>
              </div>
            </>
          )}
          {page === "Smart Import" && (
            <div className="import-source-switch">
              <label>
                {tr("Import destination")}
                <select
                  value={importTarget}
                  onChange={(e) => setImportTarget(e.target.value as any)}
                >
                  <option value="scheduling">{tr("Scheduling")}</option>
                  <option value="allocation">
                    {tr("Resource Allocation")}
                  </option>
                </select>
              </label>
            </div>
          )}
          {ready && (
            <ResourceWorkspace
              language={language}
              visible={
                page === "Resource Allocation" ||
                (page === "Smart Import" && importTarget === "allocation")
              }
              importActive={
                page === "Smart Import" && importTarget === "allocation"
              }
              onImport={() => {
                setImportTarget("allocation");
                go("Smart Import");
              }}
              onImported={() => go("Resource Allocation")}
            />
          )}
          {ready && (
            <div
              hidden={page !== "Smart Import" || importTarget !== "scheduling"}
            >
              <SmartImport
                language={language}
                saved={imported}
                savedRules={importRules}
                onSaved={(saved, rules) => {
                  setImported(saved);
                  setImportRules(rules);
                  setSourceMode("import");
                  revision.current++;
                  try {
                    localStorage.setItem("optiflow-source-mode", "import");
                  } catch {}
                  go("Scheduling");
                }}
              />
            </div>
          )}
          {page === "Scheduling" && (
            <div className="import-source-switch">
              <label>
                {tr("Scheduling data source")}
                <select
                  value={sourceMode}
                  onChange={(e) => {
                    revision.current++;
                    setSourceMode(e.target.value as "demo" | "import");
                    try {
                      localStorage.setItem(
                        "optiflow-source-mode",
                        e.target.value,
                      );
                    } catch {}
                  }}
                >
                  <option value="demo">{tr("Demo scenarios")}</option>
                  <option value="import">
                    {tr("Validated imported data")}
                  </option>
                </select>
              </label>
              <button
                className="text-link"
                onClick={() => {
                  setImportTarget("scheduling");
                  go("Smart Import");
                }}
              >
                {tr("Open Smart Import")}
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          {page === "Scheduling" && sourceMode === "import" && (
            <ImportedSchedule
              saved={imported}
              rules={importRules}
              t={tr}
              onReview={() => {
                setImportTarget("scheduling");
                go("Smart Import");
              }}
            />
          )}
          {page === "Scheduling" && sourceMode === "demo" && (
            <>
              {scenarioControl}
              <div className="tabs">
                {[
                  "Schedule",
                  "Employees",
                  "Availability",
                  "Shift settings",
                  "Analytics",
                ].map((t) => (
                  <button
                    className={tab === t ? "selected" : ""}
                    onClick={() => setTab(t)}
                    key={t}
                  >
                    {tr(t)}
                    {t === "Employees" && <span>{tr(p.employees.length)}</span>}
                  </button>
                ))}
              </div>
              <div className="schedule-toolbar">
                <div className="period">
                  <CalendarDays size={18} />
                  <label>
                    {tr("Week starting")}{" "}
                    <input
                      aria-label={tr("Scheduling start date")}
                      type="date"
                      value={p.startDate}
                      onChange={(e) =>
                        update({ ...p, startDate: e.target.value })
                      }
                    />
                  </label>
                </div>
                {action}
              </div>
              {result && (
                <div
                  role="status"
                  className={`notice ${result.status === "INFEASIBLE" || result.status === "UNKNOWN" ? "error" : stats?.violations.length ? "error" : "success"}`}
                >
                  <CheckCircle2 size={20} />
                  <div>
                    <strong>
                      {tr(
                        stats?.violations.length
                          ? "Manual draft has constraint violations"
                          : edited
                            ? "Manually adjusted · optimality not claimed"
                            : result.status === "OPTIMAL"
                              ? "Optimal schedule found"
                              : result.status === "FEASIBLE"
                                ? "Feasible schedule · optimality not proven"
                                : result.status === "INFEASIBLE"
                                  ? "This schedule is infeasible"
                                  : "No solution found within the limit",
                      )}
                    </strong>
                    <small>
                      {tr(result.engine)}
                      {tr(" · ")}
                      {number(result.seconds)}
                      {tr("s")}
                      {tr(
                        result.status === "OPTIMAL" && !edited
                          ? " · Minimum labor cost proven for this model"
                          : "",
                      )}
                    </small>
                    {result.messages.map((m) => (
                      <p key={m}>{tr(m)}</p>
                    ))}
                    {stats?.violations.slice(0, 8).map((m) => (
                      <p key={m}>{tr(m)}</p>
                    ))}
                    {(stats?.violations.length || 0) > 8 && (
                      <p>
                        {tr("Plus ")}
                        {tr(stats!.violations.length - 8)}
                        {tr(" more violations.")}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {tab === "Schedule" && (
                <>
                  {metrics}
                  <div className="section-heading">
                    <div>
                      <h2>{tr("Your weekly schedule")}</h2>
                      <p>
                        {tr(
                          stats
                            ? "Select a shift to review or change assignments."
                            : "Set up your team, then generate your first optimal schedule.",
                        )}
                      </p>
                    </div>
                    <span className="badge muted">{tr(p.name)}</span>
                  </div>
                  <div className="panel table-wrap">
                    <table className="schedule-table">
                      <thead>
                        <tr>
                          <th>{tr("SHIFT")}</th>
                          {labels(p).map((d, day) => (
                            <th key={d}>
                              {tr(
                                dateFor(p.startDate, day)
                                  ? formatDay(
                                      language,
                                      dateFor(p.startDate, day),
                                      "weekday",
                                    )
                                  : d,
                              )}
                              <small>
                                {tr(
                                  dateFor(p.startDate, day)
                                    ? formatDay(
                                        language,
                                        dateFor(p.startDate, day),
                                        "date",
                                      )
                                    : "",
                                )}
                              </small>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[0, 1].map((period) => (
                          <tr key={period}>
                            <td>
                              <span className="shift-icon">
                                {period ? <Sun size={20} /> : <Sun size={20} />}
                              </span>
                              <strong>
                                {tr(period ? "Afternoon" : "Morning")}
                              </strong>
                              <small>
                                {tr(period ? "PM shift" : "AM shift")}
                              </small>
                            </td>
                            {Array.from({ length: 7 }, (_, day) => {
                              const index = day * 2 + period,
                                s = p.shifts[index],
                                ids = result?.assignments[index] || [];
                              return (
                                <td key={day}>
                                  <button
                                    className="shift-cell"
                                    onClick={() => stats && setEditShift(index)}
                                    disabled={!stats}
                                  >
                                    <span className="shift-time">
                                      {tr(s.start)}
                                      {tr(" – ")}
                                      {tr(s.end)}
                                    </span>
                                    {ids.map((id) => {
                                      const e = p.employees.find(
                                        (e) => e.id === id,
                                      );
                                      return (
                                        <span className="assignment" key={id}>
                                          <span>
                                            {initials(e?.name || "?")}
                                          </span>
                                          {e?.name}
                                        </span>
                                      );
                                    })}
                                    {!ids.length && (
                                      <span className="unassigned">
                                        {tr(
                                          s.required
                                            ? "No assignments"
                                            : "No coverage needed",
                                        )}
                                      </span>
                                    )}
                                    <span
                                      className={`coverage ${stats && ids.length >= s.required ? "covered" : ""}`}
                                    >
                                      {stats && ids.length >= s.required ? (
                                        <Check size={12} />
                                      ) : (
                                        <Users size={12} />
                                      )}{" "}
                                      {tr(ids.length)}
                                      {tr(" / ")}
                                      {tr(s.required)}
                                      {tr(" staff")}
                                    </span>
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="footnote">
                    <SlidersHorizontal size={14} />
                    {tr(
                      "Hard constraints: coverage, availability, weekly hours, and no overlapping shifts.",
                    )}
                  </p>
                </>
              )}
              {tab === "Employees" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>{tr("Your team")}</h2>
                      <p>
                        {tr(
                          "Changes save automatically in this browser and reset the current schedule.",
                        )}
                      </p>
                    </div>
                    <button
                      className="btn"
                      disabled={p.employees.length >= 30}
                      onClick={() =>
                        update({
                          ...p,
                          employees: [
                            ...p.employees,
                            {
                              id: crypto.randomUUID(),
                              name: tr("New employee"),
                              wage: 20,
                              maxHours: 32,
                              availability: Array(14).fill(true),
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={16} />
                      {tr("Add employee")}
                    </button>
                  </div>
                  <div className="panel table-wrap">
                    <table className="employee-table">
                      <thead>
                        <tr>
                          <th>{tr("Employee name")}</th>
                          <th>{tr("Hourly wage (USD)")}</th>
                          <th>{tr("Max weekly hours")}</th>
                          <th>{tr("Available shifts")}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {p.employees.map((e, i) => (
                          <tr key={e.id}>
                            <td>
                              <div className="employee-name">
                                <span className={`avatar color-${i % 4}`}>
                                  {initials(e.name)}
                                </span>
                                <input
                                  aria-label={tr(`Employee ${i + 1} name`)}
                                  value={e.name}
                                  onChange={(ev) =>
                                    update({
                                      ...p,
                                      employees: p.employees.map((x) =>
                                        x.id === e.id
                                          ? { ...x, name: ev.target.value }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                              </div>
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                max="1000"
                                step="0.01"
                                aria-label={tr(`${e.name} hourly wage`)}
                                value={Number.isFinite(e.wage) ? e.wage : ""}
                                onChange={(ev) =>
                                  update({
                                    ...p,
                                    employees: p.employees.map((x) =>
                                      x.id === e.id
                                        ? {
                                            ...x,
                                            wage:
                                              ev.target.value === ""
                                                ? NaN
                                                : Number(ev.target.value),
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                max="168"
                                step="1"
                                aria-label={tr(`${e.name} maximum hours`)}
                                value={
                                  Number.isFinite(e.maxHours) ? e.maxHours : ""
                                }
                                onChange={(ev) =>
                                  update({
                                    ...p,
                                    employees: p.employees.map((x) =>
                                      x.id === e.id
                                        ? {
                                            ...x,
                                            maxHours:
                                              ev.target.value === ""
                                                ? NaN
                                                : Number(ev.target.value),
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <span className="badge teal">
                                {tr(e.availability.filter(Boolean).length)}
                                {tr(" of 14")}
                              </span>
                            </td>
                            <td>
                              <button
                                className="icon-btn danger"
                                aria-label={tr(`Remove ${e.name}`)}
                                onClick={() =>
                                  update({
                                    ...p,
                                    employees: p.employees.filter(
                                      (x) => x.id !== e.id,
                                    ),
                                  })
                                }
                              >
                                <Trash2 size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!p.employees.length && (
                      <div className="empty-row">
                        {tr(
                          "No employees yet. Add a team member to get started.",
                        )}
                      </div>
                    )}
                  </div>
                  <p className="footnote">
                    {tr(
                      "Use fictional employee data only. No personal information is needed.",
                    )}
                  </p>
                </>
              )}
              {tab === "Availability" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>{tr("Make room for everyone’s availability.")}</h2>
                      <p>
                        {tr(
                          "Click a cell to toggle availability for that shift.",
                        )}
                      </p>
                    </div>
                    <span className="badge green">
                      <Check size={13} />
                      {tr("Available")}
                    </span>
                  </div>
                  <div className="panel table-wrap">
                    <table className="availability">
                      <thead>
                        <tr>
                          <th>{tr("Employee")}</th>
                          {labels(p).map((d) => (
                            <th colSpan={2} key={d}>
                              {tr(d)}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          <th />
                          {p.shifts.map((s, i) => (
                            <th key={i}>
                              {tr(s.period === "Morning" ? "AM" : "PM")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {p.employees.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <strong>{e.name}</strong>
                            </td>
                            {e.availability.map((a, i) => (
                              <td key={i}>
                                <button
                                  aria-label={tr(
                                    `${e.name}, ${labels(p)[p.shifts[i].day]}, ${tr(p.shifts[i].period)}`,
                                  )}
                                  aria-pressed={a}
                                  className={`avail ${a ? "yes" : ""}`}
                                  onClick={() =>
                                    update({
                                      ...p,
                                      employees: p.employees.map((x) =>
                                        x.id === e.id
                                          ? {
                                              ...x,
                                              availability: x.availability.map(
                                                (v, j) => (j === i ? !v : v),
                                              ),
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                >
                                  {a ? <Check size={15} /> : <X size={14} />}
                                </button>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {tab === "Shift settings" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>{tr("Set the rhythm of your week.")}</h2>
                      <p>
                        {tr(
                          "Configure each shift independently. Set required staff to zero for closed periods.",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="panel table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{tr("Day")}</th>
                          <th>{tr("Shift")}</th>
                          <th>{tr("Start time")}</th>
                          <th>{tr("End time")}</th>
                          <th>{tr("Duration")}</th>
                          <th>{tr("Required staff")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.shifts.map((s, i) => (
                          <tr key={i}>
                            <td>
                              <strong>{tr(labels(p)[s.day])}</strong>
                            </td>
                            <td>{tr(s.period)}</td>
                            {(["start", "end"] as const).map((key) => (
                              <td key={key}>
                                <input
                                  aria-label={tr(
                                    `${labels(p)[s.day]} ${tr(s.period)} ${tr(key)}`,
                                  )}
                                  type="time"
                                  value={s[key]}
                                  onChange={(e) =>
                                    update({
                                      ...p,
                                      shifts: p.shifts.map((x, j) =>
                                        j === i
                                          ? { ...x, [key]: e.target.value }
                                          : x,
                                      ),
                                    })
                                  }
                                />
                              </td>
                            ))}
                            <td>
                              {tr(
                                duration(s) > 0 ? `${duration(s)}h` : "Invalid",
                              )}
                            </td>
                            <td>
                              <input
                                aria-label={tr(
                                  `${labels(p)[s.day]} ${tr(s.period)} required staff`,
                                )}
                                type="number"
                                min="0"
                                max="30"
                                value={
                                  Number.isFinite(s.required) ? s.required : ""
                                }
                                onChange={(e) =>
                                  update({
                                    ...p,
                                    shifts: p.shifts.map((x, j) =>
                                      j === i
                                        ? {
                                            ...x,
                                            required:
                                              e.target.value === ""
                                                ? NaN
                                                : Number(e.target.value),
                                          }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {tab === "Analytics" &&
                (stats ? (
                  <>
                    {metrics}
                    <div className="analytics-grid">
                      <div className="panel chart-panel">
                        <h3>{tr("Labor cost by day")}</h3>
                        <p>{tr("Actual assignment costs · USD")}</p>
                        <div className="bar-chart">
                          {stats.daily.map((cost, i) => (
                            <div className="bar-column" key={i}>
                              <span>{tr(money(cost))}</span>
                              <div className="bar-track">
                                <div
                                  className="bar"
                                  style={{
                                    height: `${Math.max(1, (cost / Math.max(...stats.daily, 1)) * 100)}%`,
                                  }}
                                  title={tr(`${labels(p)[i]}: ${money(cost)}`)}
                                  tabIndex={0}
                                />
                              </div>
                              <small>
                                {tr(
                                  formatDay(
                                    language,
                                    dateFor(p.startDate, i),
                                    "weekday",
                                  ),
                                )}
                              </small>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="panel chart-panel">
                        <h3>{tr("Employee utilization")}</h3>
                        <p>
                          {tr("Assigned hours as a share of weekly limits")}
                        </p>
                        {p.employees.map((e) => (
                          <div className="util-row" key={e.id}>
                            <div>
                              <strong>{e.name}</strong>
                              <span>
                                {tr(number(stats.hours[e.id]))}
                                {tr(" / ")}
                                {tr(number(e.maxHours))}
                                {tr("h ·")}{" "}
                                {tr(
                                  e.maxHours
                                    ? Math.round(
                                        (stats.hours[e.id] / e.maxHours) * 100,
                                      )
                                    : 0,
                                )}
                                {tr("%")}
                              </span>
                            </div>
                            <div className="util-track">
                              <i
                                style={{
                                  width: `${Math.min(100, e.maxHours ? (stats.hours[e.id] / e.maxHours) * 100 : 0)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <ChartNoAxesCombined size={36} />
                    <h3>{tr("Your next decision, backed by numbers.")}</h3>
                    <p>
                      {tr(
                        "Generate a schedule to explore labor costs, coverage, and team utilization.",
                      )}
                    </p>
                    {action}
                  </div>
                ))}
            </>
          )}
          {page === "Guide" && (
            <div className="guide">
              <div className="source-callout">
                <div>
                  <strong>{tr("Take OptiFlow with you.")}</strong>
                  <p>
                    {tr(
                      "Complete Next.js source, Python backend, tests, and local setup guide.",
                    )}
                  </p>
                </div>
                <a className="btn" href="/optiflow-source.zip" download>
                  <Download size={16} />
                  {tr("Download source")}
                </a>
              </div>
              <div className="panel">
                <span className="badge teal">{tr("THE MODEL")}</span>
                <h2>{tr("Real optimization. Transparent assumptions.")}</h2>
                <p>
                  {tr(
                    "OptiFlow assigns employees to shifts using binary decision variables x[e,s]. Assignment cost is hourly wage × shift duration. The objective is to minimize total labor cost.",
                  )}
                </p>
                <pre>
                  {tr("minimize Σ employee,shift wage[e] × hours[s] × x[e,s]")}
                </pre>
                <h3>{tr("Every generated schedule must satisfy")}</h3>
                <ul>
                  <li>
                    {tr(
                      "Staffing: assigned employees ≥ required employees for every shift.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "Availability: an employee can only work an available shift.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "Weekly hours: assigned duration ≤ each employee’s weekly maximum.",
                    )}
                  </li>
                  <li>
                    {tr("Conflicts: employees cannot work overlapping shifts.")}
                  </li>
                  <li>
                    {tr(
                      "Assignments are binary: an employee is assigned once or not at all.",
                    )}
                  </li>
                </ul>
                <p>
                  {tr(
                    "The hosted demo uses GLPK’s mixed-integer branch-and-bound solver in a Web Worker. It reports “Optimal” only when the solver proves optimality with zero requested relative gap. The local Python backend uses OR-Tools CP-SAT. Both use integer minutes and integer wage cents to preserve input precision.",
                  )}
                </p>
                <p>
                  {tr(
                    "All results are independently checked against hard constraints. Manual edits immediately recalculate the constraints and metrics; optimality is no longer claimed. Editing model inputs clears the previous solution.",
                  )}
                </p>
              </div>
              <div className="panel">
                <h2>{tr("Prototype boundaries")}</h2>
                <ul>
                  <li>
                    {tr(
                      "One seven-day period, two same-day shifts per day, up to 30 employees. Overnight shifts are not supported.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "20-second solver limit. A feasible result is not necessarily optimal. Larger problems may require more time.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "No break, rest-day, overtime, skill, fairness, preference, or jurisdiction-specific employment rules.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "Browser-local storage only. No accounts, shared database, or cross-device synchronization.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "Costs are in USD. No financial savings are claimed without a comparable baseline.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "Fictional demonstration data only. This prototype does not claim employment-law compliance.",
                    )}
                  </li>
                </ul>
              </div>
              <div className="panel">
                <h2>{tr("The road ahead")}</h2>
                <div className="roadmap">
                  <div>
                    <span>{tr("01 / FOUNDATION")}</span>
                    <h3>{tr("Production scheduling")}</h3>
                    <p>
                      {tr(
                        "PostgreSQL, tenant isolation, sign-in, permissions, audit trails, background solve jobs, and operational monitoring.",
                      )}
                    </p>
                  </div>
                  <div>
                    <span>{tr("02 / REAL-WORLD CONSTRAINTS")}</span>
                    <h3>{tr("More useful schedules")}</h3>
                    <p>
                      {tr(
                        "Skills, preferences, overtime, breaks, time zones, labor-rule validation, and explainable infeasibility.",
                      )}
                    </p>
                  </div>
                  <div>
                    <span>{tr("03 / PLATFORM")}</span>
                    <h3>{tr("A connected decision toolkit")}</h3>
                    <p>
                      {tr(
                        "Business-system integrations, validated scenario comparisons, and four additional optimization modules.",
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="app-footer">
            <span>
              <span className="dot" />
              {tr("All changes stay in this browser")}
            </span>
            <span>{tr("OptiFlow v0.2 · Built for better decisions")}</span>
          </div>
        </main>
      </div>
      {editShift !== null && result && (
        <div className="modal-backdrop" onClick={() => setEditShift(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={tr("Edit shift assignments")}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditShift(null);
            }}
          >
            <button
              className="modal-close icon-btn"
              aria-label={tr("Close assignment editor")}
              onClick={() => setEditShift(null)}
              autoFocus
            >
              <X size={20} />
            </button>
            <span className="eyebrow">{tr("MANUAL ADJUSTMENT")}</span>
            <h2>
              {tr(labels(p)[p.shifts[editShift].day])}
              {tr(" ·")} {tr(p.shifts[editShift].period)}
            </h2>
            <p>
              {tr(p.shifts[editShift].start)}
              {tr("–")}
              {tr(p.shifts[editShift].end)}
              {tr(" ·")} {tr(p.shifts[editShift].required)}
              {tr(" employees required")}
            </p>
            <div className="assignment-options">
              {p.employees.map((e) => (
                <label key={e.id}>
                  <input
                    type="checkbox"
                    checked={
                      result.assignments[editShift]?.includes(e.id) || false
                    }
                    onChange={() => assignment(e.id)}
                  />
                  <span className="avatar">{initials(e.name)}</span>
                  <div>
                    <strong>{e.name}</strong>
                    <small>
                      {tr(money(e.wage))}
                      {tr("/hr ·")}{" "}
                      {tr(
                        e.availability[editShift] ? "Available" : "Unavailable",
                      )}{" "}
                      {tr("· ")}
                      {tr(number(stats?.hours[e.id] || 0))}
                      {tr("/")}
                      {tr(number(e.maxHours))}
                      {tr("h")}
                    </small>
                  </div>
                </label>
              ))}
            </div>
            {stats?.violations.length ? (
              <div className="notice error">
                <AlertCircle size={18} />
                <span>
                  {tr(stats.violations.length)}
                  {tr(
                    " constraint violation(s). Close this panel to review the full warnings.",
                  )}
                </span>
              </div>
            ) : (
              <div className="notice success">
                <CheckCircle2 size={18} />
                {tr("All hard constraints satisfied.")}
              </div>
            )}
            <button
              className="btn primary full"
              onClick={() => setEditShift(null)}
            >
              {tr("Done")}
            </button>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {tr(toast)}
        </div>
      )}
    </div>
  );
}

function FileImportSummary({
  imported,
  tr,
}: {
  imported: SavedImport | null;
  tr: (s: string) => string;
}) {
  return (
    <div>
      <strong>{tr("Imported data · no optimization run")}</strong>
      <small>
        {imported
          ? `${imported.data.employees.length} ${tr("Employees")} · ${imported.data.availability.length} ${tr("Availability windows")} · ${imported.data.shifts.length} ${tr("Shift requirements")}`
          : tr("No saved import yet.")}
      </small>
    </div>
  );
}
