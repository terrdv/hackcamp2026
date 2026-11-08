import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { GlobeMap, type GlobeHandle, type GlobeOutbreak } from "@/components/GlobeMap";
import { SearchForm, type ExternalPick, type SearchValues } from "@/components/SearchForm";
import { Dashboard } from "@/components/Dashboard";
import { destinations, type Destination } from "@/data/destinations";
import { getDestinationReport } from "@/data/service";
import type { DestinationReport } from "@/data/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PreZero — Plan your travel safely" },
      { name: "description", content: "Spin the globe, pick a destination and dates, and see health advisories, seasonal risks and a packing checklist." },
      { property: "og:title", content: "PreZero — Plan your travel safely" },
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
  const [phase, setPhase] = useState<"intro" | "search" | "flying" | "results">("intro");
  const [search, setSearch] = useState<SearchValues | null>(null);
  const [report, setReport] = useState<DestinationReport | null>(null);
  const [selectedDiseaseId, setSelectedDiseaseId] = useState<string | null>(null);
  const [formDestination, setFormDestination] = useState<Destination | null>(null);
  const [pick, setPick] = useState<ExternalPick | null>(null);

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
  // A country clicked on the globe: same as choosing it in the search, keeping the trip dates.
  function selectCountry(id: string) {
    const destination = destinations.find((d) => d.id === id);
    if (!destination) return;
    if (phase === "results" && search) go({ ...search, destination });
    else if (phase === "search") setPick({ destination, seq: Date.now() });
  }
  // Landing call to action: zoom the globe out and down into the existing search view while the form fades in.
  function enterSearch() {
    setPhase("search");
    globe.current?.enterSearch?.();
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
      <GlobeMap
        ref={globe}
        outbreaks={globeOutbreaks}
        selectedDiseaseId={selectedDiseaseId}
        selectedDestinationId={search && phase !== "search" ? search.destination.id : null}
        highlightedCountryId={phase === "search" ? (formDestination?.id ?? null) : null}
        intro={phase === "intro"}
        onSelectDisease={setSelectedDiseaseId}
        onSelectCountry={selectCountry}
      />
      <div className="pointer-events-none absolute inset-0">
        <header className="pointer-events-auto absolute left-4 top-4 z-20 no-print md:left-6 md:top-6">
          <a href="/" aria-label="PreZero — back to landing page" className="flex items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
            <img src="/prezero-mark.svg" alt="" width={34} height={34} />
            <span className="font-display text-2xl font-semibold tracking-tight" style={{ color: "#F3F0E8" }}>PreZero</span>
          </a>
        </header>
        <div
          className={`overlay-fade pointer-events-none absolute inset-0 flex flex-col items-center justify-end px-6 pb-14 text-center md:pb-20 ${phase === "intro" ? "" : "is-hidden"}`}
          aria-hidden={phase !== "intro"}
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/95 via-black/65 to-transparent" />
          <div className="pointer-events-auto relative z-10 flex flex-col items-center">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-muted-foreground">
              Travel health intelligence
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-foreground drop-shadow-[0_2px_24px_rgba(0,0,0,0.7)] md:text-6xl">
              PreZero
            </h1>
            <p className="mt-3 max-w-md text-sm text-muted-foreground md:text-base">
              Stop the outbreak before Patient Zero:
              <br />Find outbreaks, seasonal health risks and what to pack
              <br />for the country you're visiting.
            </p>
            <button
              type="button"
              onClick={enterSearch}
              className="btn-hero mt-8"
              tabIndex={phase === "intro" ? 0 : -1}
            >
              Select your destination
              <ArrowRight className="size-5" />
            </button>
          </div>
        </div>
        <SearchForm onSubmit={go} hidden={phase !== "search"} pick={pick} onDestinationChange={setFormDestination} />
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
