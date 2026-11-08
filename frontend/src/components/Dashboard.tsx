import { useMemo, useState } from "react";
import {
  ArrowLeft, BarChart3, Bug, CalendarDays, Check, ClipboardList, ExternalLink, Info,
  LineChart as LineChartIcon, Minus, Printer, TrendingDown, TrendingUp,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Destination } from "@/data/destinations";
import type { DestinationReport, Disease, Trend } from "@/data/types";

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

const CATEGORY_LABELS = { "before-departure": "Before you leave", precaution: "Health precautions", packing: "Pack these" } as const;

function PrepChecklist({ report, onSelectDisease }: { report: DestinationReport; onSelectDisease: (id: string) => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setDone((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const groups = (["before-departure", "precaution", "packing"] as const).map((c) => ({
    category: c,
    items: report.recommendations.filter((r) => r.category === c),
  }));
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{done.size} of {report.recommendations.length} done</p>
        <button type="button" onClick={() => window.print()} className="btn-ghost no-print"><Printer className="size-3.5" /> Print list</button>
      </div>
      {groups.map((g) => g.items.length > 0 && (
        <div key={g.category} className="mb-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{CATEGORY_LABELS[g.category]}</p>
          <ul className="grid gap-1.5">
            {g.items.map((r) => (
              <li key={r.id} className="card-soft !p-2.5">
                <label className="check-row !p-0">
                  <input type="checkbox" className="sr-only" checked={done.has(r.id)} onChange={() => toggle(r.id)} />
                  <span className={`check-box ${done.has(r.id) ? "is-on" : ""}`}>{done.has(r.id) && <Check className="size-3" />}</span>
                  <span className={done.has(r.id) ? "text-muted-foreground line-through" : ""}>{r.title}</span>
                </label>
                <p className="mt-1 pl-7 text-xs text-muted-foreground">{r.explanation}</p>
                {r.relatedDiseaseIds[0] && (
                  <button type="button" onClick={() => onSelectDisease(r.relatedDiseaseIds[0]!)} className="link mt-1 ml-7 inline-block text-xs no-print">
                    View supporting data
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
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
            {report.isDemo
              ? <div className="mock-badge">Demo data — illustrative only, not live or current health information.</div>
              : <p className="text-xs text-muted-foreground">Surveillance data from WHO and OpenDengue. Describes disease activity at the destination, not your personal risk.</p>}
            <p className="mt-4 text-sm leading-relaxed">{d.overview}</p>
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
            <h3 className="mt-6 mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <ExternalLink className="size-4 text-accent" />Official sources
            </h3>
            <ul className="grid gap-1.5 text-sm">{d.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="link">{s.label} ↗</a></li>)}</ul>
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
            <PrepChecklist key={d.id + depart} report={report} onSelectDisease={showDisease} />
          </div>
        )}
      </div>
    </aside>
  );
}
