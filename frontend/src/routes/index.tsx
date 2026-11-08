import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Bug } from "lucide-react";
import { GlobeMap, type GlobeHandle, type GlobeOutbreak } from "@/components/GlobeMap";
import { SearchForm, type SearchValues } from "@/components/SearchForm";
import { Dashboard } from "@/components/Dashboard";
import { getDestinationReport } from "@/data/service";
import type { DestinationReport } from "@/data/types";
import { Button } from "@/components/ui/button";

const GlassEarth = lazy(() => import("@/components/GlassEarth").then((module) => ({ default: module.GlassEarth })));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BugVoyage — Know before you go" },
      { name: "description", content: "Spin the globe, pick a destination and dates, and see health advisories, seasonal risks and a packing checklist." },
      { property: "og:title", content: "BugVoyage — Know before you go" },
      { property: "og:description", content: "Travel health prep on an interactive 3D globe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const globe = useRef<GlobeHandle>(null);
  const request = useRef(0);
  const [phase, setPhase] = useState<"search" | "flying" | "results">("search");
  const [search, setSearch] = useState<SearchValues | null>(null);
  const [report, setReport] = useState<DestinationReport | null>(null);
  const [selectedDiseaseId, setSelectedDiseaseId] = useState<string | null>(null);
  const [earthStyle, setEarthStyle] = useState<"glass" | "original">("glass");

  function go(v: SearchValues) {
    setSearch(v);
    setReport(null);
    setSelectedDiseaseId(null);
    setPhase("flying");
    globe.current?.flyTo(v.destination.coords, v.destination.zoom, () => setPhase("results"));
    const id = ++request.current;
    getDestinationReport(v.destination, v.depart, v.ret)
      .then((r) => { if (id === request.current) setReport(r); })
      .catch(() => { if (id === request.current) setReport(null); });
  }
  function back() {
    request.current++;
    setPhase("search");
    setReport(null);
    setSelectedDiseaseId(null);
    globe.current?.reset();
  }

  const globeOutbreaks: GlobeOutbreak[] = useMemo(() => {
    if (!report) return [];
    const byId = new Map(report.diseases.map((d) => [d.id, d]));
    return report.outbreaks.map((o) => ({
      ...o,
      level: byId.get(o.diseaseId)?.activityLevel ?? "unknown",
      diseaseName: byId.get(o.diseaseId)?.name ?? o.diseaseId,
    }));
  }, [report]);

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {earthStyle === "glass" ? <Suspense fallback={<div className="globe-bg absolute inset-0" />}>
        <GlassEarth ref={globe} outbreaks={globeOutbreaks} selectedDiseaseId={selectedDiseaseId} selectedDestinationId={search && phase !== "search" ? search.destination.id : null} onSelectDisease={setSelectedDiseaseId} onError={() => { if (phase === "flying") setPhase("results"); }} />
      </Suspense> : <GlobeMap ref={globe} outbreaks={globeOutbreaks} selectedDiseaseId={selectedDiseaseId} selectedDestinationId={search && phase !== "search" ? search.destination.id : null} onSelectDisease={setSelectedDiseaseId} />}
      <div className="pointer-events-none absolute inset-0">
        <header className="pointer-events-auto absolute left-4 top-4 flex items-center gap-2 no-print md:left-6 md:top-6">
          <span className="logo-mark"><Bug className="size-4" /></span>
          <span className="font-display text-lg font-semibold tracking-tight">BugVoyage</span>
        </header>
        <div className="glass-solid pointer-events-auto absolute right-4 top-4 z-30 flex gap-1 rounded-lg p-1 no-print" role="group" aria-label="Earth style">
          <Button size="sm" variant={earthStyle === "glass" ? "secondary" : "ghost"} aria-pressed={earthStyle === "glass"} onClick={() => { setEarthStyle("glass"); if (phase === "flying") setPhase("results"); }}>Glass</Button>
          <Button size="sm" variant={earthStyle === "original" ? "secondary" : "ghost"} aria-pressed={earthStyle === "original"} onClick={() => { setEarthStyle("original"); if (phase === "flying") setPhase("results"); }}>Original</Button>
        </div>
        <SearchForm onSubmit={go} hidden={phase !== "search"} />
        {search && report && (
          <Dashboard
            {...search}
            report={report}
            visible={phase === "results"}
            onBack={back}
            selectedDiseaseId={selectedDiseaseId}
            onSelectDisease={setSelectedDiseaseId}
          />
        )}
      </div>
    </main>
  );
}
