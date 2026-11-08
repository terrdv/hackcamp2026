import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { GlobeMap, type GlobeHandle, type GlobeOutbreak } from "@/components/GlobeMap";
import { SearchForm, type SearchValues } from "@/components/SearchForm";
import { Dashboard } from "@/components/Dashboard";
import { getDestinationReport } from "@/data/service";
import type { DestinationReport } from "@/data/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PreZero — Know before you go" },
      { name: "description", content: "Spin the globe, pick a destination and dates, and see health advisories, seasonal risks and a packing checklist." },
      { property: "og:title", content: "PreZero — Know before you go" },
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
      <GlobeMap ref={globe} outbreaks={globeOutbreaks} selectedDiseaseId={selectedDiseaseId} selectedDestinationId={search && phase !== "search" ? search.destination.id : null} onSelectDisease={setSelectedDiseaseId} />
      <div className="pointer-events-none absolute inset-0">
        <header className="pointer-events-auto absolute left-4 top-4 flex items-center gap-2 no-print md:left-6 md:top-6">
          <img src="/prezero-mark.svg" alt="" width={34} height={34} />
          <span className="font-display text-2xl font-semibold tracking-tight" style={{ color: "#F3F0E8" }}>PreZero</span>
        </header>
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
