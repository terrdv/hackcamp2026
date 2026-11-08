import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, BarChart3, Bug, CalendarDays, ChevronRight, ClipboardList, ExternalLink, Info,
  LineChart as LineChartIcon, Minus, TrendingDown, TrendingUp,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Destination } from "@/data/destinations";
import type { ActivityLevel, DestinationReport, Disease, Trend } from "@/data/types";
import { getRiskBriefing, type RiskBriefing } from "@/data/briefing.functions";
import { buildPreparations, notableDiseases } from "@/data/preparations";

const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtMonth = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });

const SEV_CLASS: Record<string, string> = { low: "sev-low", moderate: "sev-moderate", elevated: "sev-high", unknown: "sev-unknown" };

function TrendBadge({ trend }: { trend: Trend }) {
  if (trend === "unknown") return null; // no trend shown rather than "No trend data"
  const Icon = trend === "increasing" ? TrendingUp : trend === "decreasing" ? TrendingDown : Minus;
  return (
    <span className={`trend trend-${trend}`}>
      <Icon className="size-3.5" /> {trend}
    </span>
  );
}

function DiseaseCard({ d, selected, demo, onSelect }: { d: Disease; selected: boolean; demo: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={`card-soft card-selectable text-left ${selected ? "is-selected" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium">{d.name}</h4>
        <span className={`sev ${SEV_CLASS[d.activityLevel]}`}>{d.activityLevel}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <TrendBadge trend={d.trend} />
        {d.latestCases != null && (
          <span className="font-semibold">{d.latestCases.toLocaleString()} cases <span className="font-normal text-muted-foreground">({d.reportingPeriod})</span></span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{d.source}{demo ? " · illustrative classification" : ""}</p>
    </button>
  );
}

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "0.75rem",
  fontSize: "0.8rem",
  color: "var(--foreground)",
} as const;

function ActivityChart({ report, disease }: { report: DestinationReport; disease: Disease | null }) {
  const data = useMemo(
    () => (disease ? report.timeSeries.filter((p) => p.diseaseId === disease.id) : []),
    [report, disease],
  );
  if (!disease || data.length === 0) {
    return <div className="card-soft grid h-48 place-items-center text-sm text-muted-foreground">No historical reports available for this disease yet.</div>;
  }
  return (
    <div className="card-soft">
      <p className="mb-1 text-sm font-medium">{disease.name} — reported cases by month</p>
      <p className="mb-3 text-xs text-muted-foreground">Source: {disease.source} · {report.isDemo ? "last 12 months (demo data)" : "monthly reports up to the latest available month"}</p>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtMonth(String(l))} formatter={(v) => [Number(v).toLocaleString(), "cases"]} />
            <Line type="monotone" dataKey="cases" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 2.5, fill: "var(--accent)" }} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ComparisonChart({ report, selectedId, onSelect }: { report: DestinationReport; selectedId: string | null; onSelect: (id: string) => void }) {
  const data = report.diseases.filter((d) => d.latestCases != null);
  if (data.length === 0) return null;
  return (
    <div className="card-soft">
      <p className="mb-1 text-sm font-medium">Reported cases by disease</p>
      <p className="mb-3 text-xs text-muted-foreground">{report.isDemo ? `Same destination and reporting period (${data[0]?.reportingPeriod}); counts are illustrative.` : "Latest month reported for each disease. Periods and counting methods differ between sources."}</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval={0} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [Number(v).toLocaleString(), "cases"]} />
            <Bar dataKey="latestCases" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(entry) => { const id = (entry as unknown as Disease | undefined)?.id; if (id) onSelect(id); }}>
              {data.map((d) => (
                <Cell key={d.id} fill={d.id === selectedId ? "var(--accent)" : "var(--primary)"} fillOpacity={d.id === selectedId ? 1 : 0.55} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Click a bar to focus that disease.</p>
    </div>
  );
}

function PrepareList({ report, briefing }: { report: DestinationReport; briefing: BriefingState }) {
  if (notableDiseases(report.diseases).length === 0) {
    return (
      <div className="prep-empty">
        <p className="text-sm">Nothing to prepare for :) Pack your clothes and enjoy the trip</p>
      </div>
    );
  }
  if (briefing.status === "loading") {
    return (
      <ul className="grid gap-2" aria-busy="true" aria-label="Loading preparations">
        {[0, 1, 2].map((i) => (
          <li key={i} className="card-soft grid gap-1.5"><div className="ai-shimmer h-4 w-1/2" /><div className="ai-shimmer h-3 w-11/12" /></li>
        ))}
      </ul>
    );
  }
  const items = briefing.status === "ready" ? buildPreparations(report.diseases, briefing.data) : [];
  if (items.length === 0) {
    return <p className="card-soft text-sm text-muted-foreground">Preparation advice is unavailable right now. Check the official sources on the Overview tab before you go.</p>;
  }
  return (
    <ul className="grid gap-2">
      {items.map((p) => (
        <li key={p.key} className="card-soft">
          <p className="font-medium leading-snug">{p.title}</p>
          {p.detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.detail}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">For:</span>
            {p.diseases.map((x) => <span key={x.id} className={`dtag ${SEV_CLASS[x.level]}`}>{x.name}</span>)}
          </div>
        </li>
      ))}
    </ul>
  );
}

// Fallback wording used until (or if) the explanation arrives. Levels themselves always come from the data.
const LEVEL_MEANING: Partial<Record<ActivityLevel, string>> = {
  elevated: "Higher activity than usual for your dates. Take precautions seriously.",
  moderate: "Some activity reported. Standard precautions are worthwhile.",
};

type BriefingState = { status: "idle" | "loading" | "error" } | { status: "ready"; data: RiskBriefing };

// One LLM call per trip, shared by the Overview and Prepare tabs: cache the promise by destination + dates.
const briefingCache = new Map<string, Promise<RiskBriefing>>();
const BRIEFING_TIMEOUT_MS = 45_000;

function fetchBriefing(country: string, depart: string, ret: string, report: DestinationReport) {
  const key = `${report.destinationId}|${depart}|${ret}`;
  let p = briefingCache.get(key);
  if (!p) {
    const call = getRiskBriefing({
      data: {
        country,
        depart,
        ret,
        diseases: report.diseases.map((x) => ({
          id: x.id, name: x.name, level: x.activityLevel, trend: x.trend,
          latestCases: x.latestCases, reportingPeriod: x.reportingPeriod, description: x.description,
        })),
      },
    });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AI briefing timed out")), BRIEFING_TIMEOUT_MS));
    p = Promise.race([call, timeout]);
    p.catch(() => briefingCache.delete(key)); // let a later visit retry
    briefingCache.set(key, p);
  }
  return p;
}

function useBriefing(country: string, depart: string, ret: string, report: DestinationReport): BriefingState {
  const [state, setState] = useState<BriefingState>({ status: "idle" });
  useEffect(() => {
    if (report.isDemo || report.diseases.length === 0) return setState({ status: "idle" });
    let live = true;
    setState({ status: "loading" });
    fetchBriefing(country, depart, ret, report)
      .then((data) => live && setState({ status: "ready", data }))
      .catch((err) => {
        console.warn("AI briefing unavailable", err);
        if (live) setState({ status: "error" });
      });
    return () => { live = false; };
  }, [country, depart, ret, report]);
  return state;
}

function Overview({
  destination: d, report, briefing, onSelectDisease,
}: {
  destination: Destination;
  report: DestinationReport;
  briefing: BriefingState;
  onSelectDisease: (id: string) => void;
}) {
  const ai = briefing.status === "ready" ? briefing.data : null;
  const aiById = new Map(ai?.risks.map((r) => [r.id, r]) ?? []);

  const notable = notableDiseases(report.diseases);

  return (
    <>
      {report.isDemo && <div className="mock-badge mb-3">Demo data — illustrative only, not live or current health information.</div>}

      {/* Brief explanation: generated with Databricks ai_query (briefing.functions.ts) */}
      {briefing.status !== "idle" && (
        <div className="card-soft" aria-live="polite" aria-busy={briefing.status === "loading"}>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <Info className="size-4 text-accent" />Brief Explanation
          </h3>
          {briefing.status === "loading" && (
            <div className="grid gap-1.5" aria-label="Generating briefing">
              <div className="ai-shimmer h-4 w-4/5" /><div className="ai-shimmer h-3 w-full" /><div className="ai-shimmer h-3 w-11/12" />
            </div>
          )}
          {briefing.status === "error" && <p className="text-xs text-muted-foreground">The explanation is unavailable right now. The risk levels below come straight from the surveillance data.</p>}
          {ai && (
            <>
              <p className="font-medium leading-snug">{ai.headline}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{ai.summary}</p>
            </>
          )}
        </div>
      )}

      {/* Risk breakdown: moderate and elevated only (low/unknown stay on the Diseases tab) */}
      <h3 className={`${briefing.status === "idle" ? "" : "mt-5 "}mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground`}>
        <AlertTriangle className="size-4 text-accent" />Risks for your dates
      </h3>
      {notable.length === 0 ? (
        <p className="card-soft text-sm text-muted-foreground">No notable disease risks for your dates.</p>
      ) : (
        <ul className="grid gap-1.5">
          {notable.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => onSelectDisease(x.id)} className={`risk-row risk-${SEV_CLASS[x.activityLevel]}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{x.name}</span>
                  <span className="flex items-center gap-2">
                    <TrendBadge trend={x.trend} />
                    <span className={`sev ${SEV_CLASS[x.activityLevel]}`}>{x.activityLevel}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{aiById.get(x.id)?.meaning || LEVEL_MEANING[x.activityLevel]}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="card-soft !p-3">
          <p className="text-lg font-semibold">{report.diseases.length}</p>
          <p className="text-xs text-muted-foreground">health concerns tracked</p>
        </div>
        <div className="card-soft !p-3">
          <p className="text-lg font-semibold">{fmt(report.surveillanceDate)}</p>
          <p className="text-xs text-muted-foreground">latest surveillance report</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{d.overview} Levels describe disease activity at the destination, not your personal risk.</p>

      <h3 className="mt-5 mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <ExternalLink className="size-4 text-accent" />Official sources
      </h3>
      <ul className="grid gap-1.5 text-sm">{d.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="link">{s.label} ↗</a></li>)}</ul>
    </>
  );
}

type TabId = "overview" | "diseases" | "charts" | "prepare";

const TABS: { id: TabId; label: string; icon: typeof Bug }[] = [
  { id: "overview", label: "Overview", icon: Info },
  { id: "diseases", label: "Diseases", icon: Bug },
  { id: "charts", label: "Charts", icon: LineChartIcon },
  { id: "prepare", label: "Prepare", icon: ClipboardList },
];

export function Dashboard({
  destination: d, depart, ret, report, visible, onBack, selectedDiseaseId, onSelectDisease,
}: {
  destination: Destination;
  depart: string;
  ret: string;
  report: DestinationReport;
  visible: boolean;
  onBack: () => void;
  selectedDiseaseId: string | null;
  onSelectDisease: (id: string | null) => void;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const selected = report.diseases.find((x) => x.id === selectedDiseaseId) ?? report.diseases[0] ?? null;

  const briefing = useBriefing(d.name, depart, ret, report);

  const showDisease = (id: string) => {
    onSelectDisease(id);
    setTab("diseases");
  };

  return (
    <aside className={`panel-slide glass-solid pointer-events-auto absolute inset-x-3 bottom-3 top-[40vh] flex flex-col overflow-hidden rounded-3xl p-6 md:inset-x-auto md:right-4 md:top-4 md:bottom-4 md:w-[440px] ${visible ? "is-visible" : ""}`}>
      <div className="shrink-0">
        <button onClick={onBack} className="btn-ghost no-print"><ArrowLeft className="size-4" /> New search</button>
        <p className="mt-4 text-xs uppercase tracking-widest text-accent">{d.region}</p>
        <h2 className="font-display text-3xl font-semibold">{d.name}</h2>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarDays className="size-4" />{fmt(depart)} – {fmt(ret)}</p>
        <div role="tablist" aria-label="Report sections" className="tab-bar no-print mt-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`tab-btn ${tab === t.id ? "is-active" : ""}`}
            >
              <t.icon className="size-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === "overview" && (
          <div role="tabpanel" className="tab-panel">
            <Overview destination={d} report={report} briefing={briefing} onSelectDisease={showDisease} />
          </div>
        )}

        {tab === "diseases" && (
          <div role="tabpanel" className="tab-panel">
            {report.diseases.length === 0 && (
              <p className="card-soft text-sm text-muted-foreground">
                No disease has current, comparable data for this destination and these dates. Check official travel health advice before you go.
              </p>
            )}
            <div className="grid gap-2">
              {report.diseases.map((x) => (
                <DiseaseCard key={x.id} d={x} demo={!!report.isDemo} selected={selected?.id === x.id} onSelect={() => onSelectDisease(x.id === selectedDiseaseId ? null : x.id)} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Select a card to filter the globe markers and charts.</p>
          </div>
        )}

        {tab === "charts" && (
          <div role="tabpanel" className="tab-panel grid gap-4">
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <LineChartIcon className="size-4 text-accent" />Activity over time
              </h3>
              <ActivityChart report={report} disease={selected} />
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <BarChart3 className="size-4 text-accent" />Disease comparison
              </h3>
              <ComparisonChart report={report} selectedId={selected?.id ?? null} onSelect={onSelectDisease} />
            </div>
          </div>
        )}

        {tab === "prepare" && (
          <div role="tabpanel" className="tab-panel">
            <PrepareList report={report} briefing={briefing} />
          </div>
        )}
      </div>
    </aside>
  );
}
