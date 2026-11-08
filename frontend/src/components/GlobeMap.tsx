import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { ActivityLevel, OutbreakObservation } from "@/data/types";
import { getCountryShape, loadCountryShape } from "@/data/countryShapes";
import { destinations } from "@/data/destinations";

export interface GlobeHandle {
  flyTo: (coords: [number, number], zoom: number, onDone?: () => void) => void;
  reset: () => void;
}

export interface GlobeOutbreak extends OutbreakObservation {
  level: ActivityLevel;
  diseaseName: string;
}

interface GlobeMapProps {
  outbreaks?: GlobeOutbreak[];
  selectedDiseaseId?: string | null;
  selectedDestinationId?: string | null;
  onSelectDisease?: (diseaseId: string) => void;
}

// Turquoise highlight for the selected country (hex: MapLibre can't parse oklch).
const COUNTRY_LINE = "#46e0c6";
const COUNTRY_GROOVE = "rgba(5, 28, 27, 0.8)";

function searchPadding() {
  // Move the camera's visual center toward the bottom; keep destination cameras unchanged.
  return { top: Math.round(window.innerHeight * 0.9), bottom: 0, left: 0, right: 0 };
}

// Gently round coarse outline corners without changing the overall silhouette.
function smoothRing(ring: number[][]): number[][] {
  const vertices = ring.slice(0, -1);
  if (vertices.length < 3) return ring;
  const rounded: number[][] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (!a || !b) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    rounded.push([ax * 0.85 + bx * 0.15, ay * 0.85 + by * 0.15]);
    rounded.push([ax * 0.15 + bx * 0.85, ay * 0.15 + by * 0.85]);
  }
  const first = rounded[0];
  if (first) rounded.push([...first]);
  return rounded;
}

// Thin grid pattern painted over the selected country's land.
function makeGridPattern() {
  const size = 12;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Unable to create the country grid texture");
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(120, 240, 220, 0.8)";
  ctx.shadowColor = COUNTRY_LINE;
  ctx.shadowBlur = 3;
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, size);
  ctx.moveTo(0, 0.5);
  ctx.lineTo(size, 0.5);
  // Repeat the edges so the glow remains seamless across pattern cells.
  ctx.moveTo(size + 0.5, 0);
  ctx.lineTo(size + 0.5, size);
  ctx.moveTo(0, size + 0.5);
  ctx.lineTo(size, size + 0.5);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

const WORLD = { center: [10, 20] as [number, number], zoom: 3.5 };

// MapLibre paint colors must be hex/rgba (no oklch); these match the --sev-* tokens in styles.css.
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function markerColors() {
  return { elevated: "#e06454", moderate: "#e5b45a", low: "#4ec9a0", unknown: "#8a96a3" };
}

export const GlobeMap = forwardRef<GlobeHandle, GlobeMapProps>(function GlobeMap(
  { outbreaks = [], selectedDiseaseId = null, selectedDestinationId = null, onSelectDisease },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const ready = useRef(false);
  const onSelectRef = useRef(onSelectDisease);
  onSelectRef.current = onSelectDisease;
  const dataRef = useRef({ outbreaks, selectedDiseaseId, selectedDestinationId });
  dataRef.current = { outbreaks, selectedDiseaseId, selectedDestinationId };

  function applyOutbreaks(m: import("maplibre-gl").Map) {
    const { outbreaks: obs, selectedDiseaseId: sel } = dataRef.current;
    const visible = sel ? obs.filter((o) => o.diseaseId === sel) : obs;
    const src = m.getSource("outbreaks") as import("maplibre-gl").GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: visible.map((o) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [o.longitude, o.latitude] },
        properties: { ...o },
      })),
    });
  }

  function applyCountry(m: import("maplibre-gl").Map) {
    const id = dataRef.current.selectedDestinationId;
    const shape = getCountryShape(id);
    const src = m.getSource("country") as import("maplibre-gl").GeoJSONSource | undefined;
    if (!shape) {
      src?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const feature = shape as Feature<Polygon | MultiPolygon>;
    const geometry = feature.geometry;
    src?.setData({
      ...feature,
      geometry: geometry.type === "Polygon"
        ? { ...geometry, coordinates: geometry.coordinates.map((ring) => smoothRing(smoothRing(ring))) }
        : { ...geometry, coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => smoothRing(smoothRing(ring)))) },
    });
  }

  useImperativeHandle(ref, () => ({
    flyTo(coords, zoom, onDone) {
      const m = map.current;
      let done = false;
      const finish = () => { if (!done) { done = true; onDone?.(); } };
      setTimeout(finish, 3600);
      if (!m) return;
      container.current?.classList.remove("globe-search-canvas");
      m.resize();
      m.once("moveend", finish);
      m.flyTo({ center: coords, zoom, duration: 3200, curve: 1.6, essential: true, padding: { right: window.innerWidth > 900 ? 420 : 0, left: 0, top: 0, bottom: 0 } });
    },
    reset() {
      container.current?.classList.add("globe-search-canvas");
      map.current?.resize();
      map.current?.jumpTo({ ...WORLD, padding: searchPadding() });
    },
  }));

  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then((mod) => {
      const maplibregl = ("Map" in mod && mod.Map ? mod : (mod as unknown as { default: typeof mod }).default) as typeof mod;
      if (cancelled || !container.current) return;
      maplibregl.setWorkerUrl(workerUrl);
      const colors = markerColors();
      container.current.classList.add("globe-search-canvas");
      const m = new maplibregl.Map({
        container: container.current,
        center: WORLD.center,
        zoom: WORLD.zoom,
        attributionControl: { compact: true },
        style: {
          version: 8,
          projection: { type: "globe" },
          sources: {
            earth: {
              type: "raster",
              tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
              tileSize: 256,
              maxzoom: 8,
              attribution: "Imagery © Esri",
            },
            outbreaks: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            country: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            {
              id: "earth",
              type: "raster",
              source: "earth",
              paint: {
                "raster-fade-duration": 0,
                "raster-saturation": 0,
                "raster-brightness-max": 1,
                "raster-contrast": 0,
              },
            },
            {
              id: "country-grid",
              type: "fill",
              source: "country",
              paint: { "fill-pattern": "country-grid-img", "fill-opacity": 0.8 },
            },
            {
              id: "country-glow-outer",
              type: "line",
              source: "country",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": COUNTRY_LINE,
                "line-width": 12,
                "line-blur": 6,
                "line-opacity": 0.6,
              },
            },
            {
              id: "country-glow",
              type: "line",
              source: "country",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": COUNTRY_LINE,
                "line-width": 5,
                "line-blur": 2,
                "line-opacity": 0.85,
              },
            },
            {
              id: "country-groove",
              type: "line",
              source: "country",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": COUNTRY_GROOVE, "line-width": 2.5, "line-blur": 0.5 },
            },
            {
              id: "country-border",
              type: "line",
              source: "country",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": COUNTRY_LINE, "line-width": 0.9, "line-opacity": 1, "line-blur": 0.2 },
            },
            {
              id: "outbreak-halo",
              type: "circle",
              source: "outbreaks",
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["get", "cases"], 0, 12, 500, 20, 2000, 30, 8000, 40],
                "circle-color": ["match", ["get", "level"], "elevated", colors.elevated, "moderate", colors.moderate, "low", colors.low, colors.unknown],
                "circle-opacity": 0.18,
              },
            },
            {
              id: "outbreak-dots",
              type: "circle",
              source: "outbreaks",
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["get", "cases"], 0, 5, 500, 9, 2000, 13, 8000, 18],
                "circle-color": ["match", ["get", "level"], "elevated", colors.elevated, "moderate", colors.moderate, "low", colors.low, colors.unknown],
                "circle-opacity": 0.9,
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "rgba(255, 255, 255, 0.6)",
              },
            },
          ],
        } as never,
      });

      m.setPadding(searchPadding());
      m.on("load", () => {
        ready.current = true;
        if (!m.hasImage("country-grid-img")) m.addImage("country-grid-img", makeGridPattern());
        container.current?.setAttribute("data-globe-ready", "true");
        applyOutbreaks(m);
        applyCountry(m);
        const destination = destinations.find((d) => d.id === dataRef.current.selectedDestinationId);
        if (destination) {
          container.current?.classList.remove("globe-search-canvas");
          m.resize();
          m.jumpTo({ center: destination.coords, zoom: destination.zoom, padding: { right: window.innerWidth > 900 ? 420 : 0, left: 0, top: 0, bottom: 0 } });
        }
      });

      m.on("click", "outbreak-dots", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as unknown as GlobeOutbreak;
        onSelectRef.current?.(p.diseaseId);
        new maplibregl.Popup({ closeButton: false, className: "globe-popup", maxWidth: "260px" })
          .setLngLat([p.longitude, p.latitude])
          .setHTML(
            `<div class="globe-popup-inner">` +
            `<strong>${esc(p.locationName)}</strong>` +
            `<span>${esc(p.diseaseName)} — ${Number(p.cases).toLocaleString()} reported in ${esc(String(p.reportDate).slice(0, 7))}</span>` +
            `<em>${esc(p.source)}</em>` +
            `</div>`,
          )
          .addTo(m);
      });
      m.on("mouseenter", "outbreak-dots", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "outbreak-dots", () => { m.getCanvas().style.cursor = ""; });

      map.current = m;
      const resizeSearch = () => {
        if (container.current?.classList.contains("globe-search-canvas") && !m.isMoving()) m.setPadding(searchPadding());
      };
      m.on("resize", resizeSearch);
    });
    return () => {
      cancelled = true;
      ready.current = false;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Push outbreak data + disease filter into the map whenever they change.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    applyOutbreaks(m);
    applyCountry(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outbreaks, selectedDiseaseId, selectedDestinationId]);

  // Outlines are fetched on demand; draw the selected country once its outline arrives.
  useEffect(() => {
    if (!selectedDestinationId) return;
    void loadCountryShape(selectedDestinationId).then(() => {
      const m = map.current;
      if (m && ready.current && dataRef.current.selectedDestinationId === selectedDestinationId) applyCountry(m);
    });
  }, [selectedDestinationId]);

  return (
    <div className={`globe-bg absolute inset-0 ${selectedDestinationId ? "" : "globe-search"}`}>
      <div ref={container} className="h-full w-full" />
      {outbreaks.length > 0 && (
        <div className="glass-solid pointer-events-auto absolute bottom-4 left-4 z-10 rounded-2xl px-4 py-3 text-xs">
          <p className="mb-2 font-semibold uppercase tracking-widest text-muted-foreground">Reported activity</p>
          <div className="grid gap-1.5">
            <span className="flex items-center gap-2"><span className="legend-dot legend-dot-elevated" /> Elevated</span>
            <span className="flex items-center gap-2"><span className="legend-dot legend-dot-moderate" /> Moderate</span>
            <span className="flex items-center gap-2"><span className="legend-dot legend-dot-low" /> Low</span>
          </div>
          <p className="mt-2 text-muted-foreground">Circle size ≈ latest monthly count</p>
        </div>
      )}
    </div>
  );
});
