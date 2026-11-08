import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { ActivityLevel, OutbreakObservation } from "@/data/types";
import { getCountryShape, loadCountryShape } from "@/data/countryShapes";
import { loadWorld } from "@/data/worldShapes";
import { outlineLines } from "@/lib/world-grid";
import { HOLOGRAM, SELECT_FADE_MS } from "@/lib/globe-style";
import {
  GRID_BIG_ENOUGH,
  byDestination,
  countryLayers,
  gridLodOpacity,
  notDestination,
  selectedGridOpacity,
} from "@/lib/globe-layers";
import { HOLOGRAM_SELECTED_PULSE, MAP_STYLE } from "@/lib/map-config";
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
  /** Country drawn as selected while no destination is open (e.g. picked in the search form). */
  highlightedCountryId?: string | null;
  onSelectDisease?: (diseaseId: string) => void;
  /** A country with data was clicked on the globe. */
  onSelectCountry?: (destinationId: string) => void;
}

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

// Same rounding for an open line (an outline cut at the antimeridian): interior corners only, ends stay put.
function smoothLine(line: number[][]): number[][] {
  const first = line[0];
  const last = line[line.length - 1];
  if (!first || !last) return line;
  if (first[0] === last[0] && first[1] === last[1]) return smoothRing(line);
  if (line.length < 3) return line;
  const out: number[][] = [first];
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i]!;
    const [bx, by] = line[i + 1]!;
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    if (i > 0) out.push([ax * 0.85 + bx * 0.15, ay * 0.85 + by * 0.15]);
    if (i + 2 < line.length) out.push([ax * 0.15 + bx * 0.85, ay * 0.15 + by * 0.85]);
  }
  out.push(last);
  return out;
}

// Country borders, grids and highlight layers for the chosen look (src/lib/map-config.ts -> src/lib/globe-layers.ts).
const LAYERS = countryLayers(MAP_STYLE);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

const WORLD = { center: [10, 20] as [number, number], zoom: 3.5 };

// MapLibre paint colors must be hex/rgba (no oklch); these match the --sev-* tokens in styles.css.
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function markerColors() {
  return { elevated: "#e06454", moderate: "#e5b45a", low: "#4ec9a0", unknown: "#8a96a3" };
}

export const GlobeMap = forwardRef<GlobeHandle, GlobeMapProps>(function GlobeMap(
  {
    outbreaks = [],
    selectedDiseaseId = null,
    selectedDestinationId = null,
    highlightedCountryId = null,
    onSelectDisease,
    onSelectCountry,
  },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const rim = useRef<HTMLDivElement>(null);
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const zoomLimits = useRef({ min: 0, max: 22 });
  const ready = useRef(false);
  const onSelectRef = useRef(onSelectDisease);
  onSelectRef.current = onSelectDisease;
  const onSelectCountryRef = useRef(onSelectCountry);
  onSelectCountryRef.current = onSelectCountry;
  const highlightId = selectedDestinationId ?? highlightedCountryId;
  const dataRef = useRef({ outbreaks, selectedDiseaseId, selectedDestinationId, highlightId });
  dataRef.current = { outbreaks, selectedDiseaseId, selectedDestinationId, highlightId };
  // Selection fade (value 0..1, also scales the pulsing glow) and hover fade, animated with requestAnimationFrame.
  const fade = useRef({ frame: 0, hoverFrame: 0, value: 0, pulse: 1, shownFor: null as string | null });

  function setSearchZoom(m: import("maplibre-gl").Map, locked: boolean) {
    // Camera bounds also cover pinch, double-click and keyboard zoom while
    // leaving drag and touch rotation enabled.
    m.setMinZoom(locked ? WORLD.zoom : zoomLimits.current.min);
    m.setMaxZoom(locked ? WORLD.zoom : zoomLimits.current.max);
  }

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

  function setSelectedOpacity(m: import("maplibre-gl").Map, value: number) {
    fade.current.value = value;
    for (const [layer, prop] of LAYERS.selectedFade) m.setPaintProperty(layer, prop, value);
    m.setPaintProperty(LAYERS.selectedGrid, "line-opacity", selectedGridOpacity(value) as never);
    if (LAYERS.pulsedGlow) m.setPaintProperty(LAYERS.pulsedGlow[0], LAYERS.pulsedGlow[1], value * fade.current.pulse);
  }

  // Unselected -> selected: fade the selected layers in (instant with reduced motion).
  function fadeInSelection(m: import("maplibre-gl").Map) {
    cancelAnimationFrame(fade.current.frame);
    const start = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      const t = reduce ? 1 : Math.min(1, (performance.now() - start) / SELECT_FADE_MS);
      setSelectedOpacity(m, easeOut(t));
      if (t < 1) fade.current.frame = requestAnimationFrame(step);
    };
    step();
  }

  function applyCountry(m: import("maplibre-gl").Map) {
    const id = dataRef.current.highlightId;
    const shape = getCountryShape(id);
    const src = m.getSource("country") as import("maplibre-gl").GeoJSONSource | undefined;
    const lines = m.getSource("country-lines") as import("maplibre-gl").GeoJSONSource | undefined;
    m.setFilter(LAYERS.selectedGrid, byDestination(shape ? id : null) as never);
    // The selected country draws its own detailed outline; hide the simplified one under it to avoid a double line.
    for (const layer of LAYERS.hideUnderSelection) m.setFilter(layer, notDestination(shape ? id : null) as never);
    if (!shape) {
      src?.setData({ type: "FeatureCollection", features: [] });
      lines?.setData({ type: "FeatureCollection", features: [] });
      fade.current.shownFor = null;
      return;
    }
    if (fade.current.shownFor !== id) {
      fade.current.shownFor = id;
      setSelectedOpacity(m, 0);
      fadeInSelection(m);
    }
    const feature = shape as Feature<Polygon | MultiPolygon>;
    const geometry = feature.geometry;
    const polygons = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).map((polygon) =>
      polygon.map((ring) => smoothRing(smoothRing(ring))),
    );
    src?.setData({
      ...feature,
      geometry: geometry.type === "Polygon"
        ? { ...geometry, coordinates: polygons[0]! }
        : { ...geometry, coordinates: polygons },
    });
    // Outline without the antimeridian cut (hologram line layers): cut the raw outline first, then round it, so
    // no rounded corner leaves a stub along the cut.
    if (lines) {
      const raw = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
      const outline = outlineLines(raw).map((l) => smoothLine(smoothLine(l)));
      lines.setData({ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: outline } });
    }
  }

  useImperativeHandle(ref, () => ({
    flyTo(coords, zoom, onDone) {
      const m = map.current;
      let done = false;
      const finish = () => { if (!done) { done = true; onDone?.(); } };
      setTimeout(finish, 3600);
      if (!m) return;
      setSearchZoom(m, false);
      container.current?.classList.remove("globe-search-canvas");
      m.resize();
      m.once("moveend", finish);
      m.flyTo({ center: coords, zoom, duration: 3200, curve: 1.6, essential: true, padding: { right: window.innerWidth > 900 ? 420 : 0, left: 0, top: 0, bottom: 0 } });
    },
    reset() {
      container.current?.classList.add("globe-search-canvas");
      map.current?.resize();
      map.current?.jumpTo({ ...WORLD, padding: searchPadding() });
      if (map.current) setSearchZoom(map.current, true);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    let pulseTimer: ReturnType<typeof setInterval> | undefined;
    let glowTimer: ReturnType<typeof setInterval> | undefined;
    const fadeState = fade.current;
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
          ...(LAYERS.sky ? { sky: LAYERS.sky } : {}),
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
            world: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "world-grid": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            ...LAYERS.sources,
          },
          layers: [
            ...LAYERS.below,
            { id: "earth", type: "raster", source: "earth", paint: LAYERS.earthPaint },
            ...LAYERS.layers,
            // Activity circles always render above every border and grid layer.
            {
              id: "outbreak-halo",
              type: "circle",
              source: "outbreaks",
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["get", "cases"], 0, 12, 500, 20, 2000, 30, 8000, 40],
                "circle-color": ["match", ["get", "level"], "elevated", colors.elevated, "moderate", colors.moderate, "low", colors.low, colors.unknown],
                "circle-opacity": 0.3,
                "circle-blur": 0.8,
                "circle-radius-transition": { duration: 0 },
                "circle-opacity-transition": { duration: 0 },
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
                "circle-radius-transition": { duration: 0 },
                "circle-opacity-transition": { duration: 0 },
                "circle-stroke-width": 0,
              },
            },
          ],
        } as never,
      });

      zoomLimits.current = { min: m.getMinZoom(), max: m.getMaxZoom() };
      setSearchZoom(m, !dataRef.current.selectedDestinationId);
      m.setPadding(searchPadding());
      m.on("load", () => {
        ready.current = true;
        void loadWorld().then((world) => {
          if (!world || map.current !== m) return;
          (m.getSource("world") as import("maplibre-gl").GeoJSONSource).setData(world.countries);
          (m.getSource("world-grid") as import("maplibre-gl").GeoJSONSource).setData(world.grid);
          (m.getSource("world-lines") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(world.outlines);
          (m.getSource("graticule") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(world.graticule);
          (m.getSource("particles") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(world.particles);
        });
        container.current?.setAttribute("data-globe-ready", "true");
        applyOutbreaks(m);
        applyCountry(m);
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          pulseTimer = setInterval(() => {
            const { outbreaks: observations, selectedDestinationId: destinationId, selectedDiseaseId: diseaseId } = dataRef.current;
            if (document.hidden || !destinationId || !observations.some((o) => !diseaseId || o.diseaseId === diseaseId)) return;
            // Contract both edges inward, then expand the glow back outward.
            // Apply the same scale to every dot to preserve relative case sizes.
            const light = (1 - Math.cos(performance.now() / 2200 * Math.PI * 2)) / 2;
            const scale = 0.55 + light * 1.25;
            const coreScale = 0.72 + light * 0.28;
            m.setPaintProperty("outbreak-halo", "circle-radius", [
              "interpolate", ["linear"], ["get", "cases"],
              0, 12 * scale, 500, 20 * scale, 2000, 30 * scale, 8000, 40 * scale,
            ]);
            m.setPaintProperty("outbreak-halo", "circle-opacity", 0.25 + light * 0.45);
            m.setPaintProperty("outbreak-dots", "circle-radius", [
              "interpolate", ["linear"], ["get", "cases"],
              0, 5 * coreScale, 500, 9 * coreScale, 2000, 13 * coreScale, 8000, 18 * coreScale,
            ]);
            m.setPaintProperty("outbreak-dots", "circle-opacity", 0.72 + light * 0.28);
          }, 50);
        }
        // Hologram: the selected country's glow breathes slowly (small opacity swing, ~20 updates/s).
        if (LAYERS.pulsedGlow && HOLOGRAM_SELECTED_PULSE && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const [glowLayer, glowProp] = LAYERS.pulsedGlow;
          const { periodMs, min } = HOLOGRAM.selected.pulse;
          glowTimer = setInterval(() => {
            if (document.hidden || !fade.current.shownFor) return;
            const wave = (1 + Math.cos((performance.now() / periodMs) * Math.PI * 2)) / 2;
            fade.current.pulse = min + (1 - min) * wave;
            m.setPaintProperty(glowLayer, glowProp, fade.current.value * fade.current.pulse);
          }, 50);
        }
        const destination = destinations.find((d) => d.id === dataRef.current.selectedDestinationId);
        if (destination) {
          setSearchZoom(m, false);
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
      // Country hover (desktop) + click to select. Activity circles take precedence over the country under them.
      const pick = (point: import("maplibre-gl").PointLike) => {
        const hits = m.queryRenderedFeatures(point, { layers: ["outbreak-dots", "world-hit"] });
        if (hits.some((f) => f.layer.id === "outbreak-dots")) return { dot: true, country: null };
        const d = hits.find((f) => f.layer.id === "world-hit")?.properties?.["d"] as string | undefined;
        return { dot: false, country: d && d !== dataRef.current.highlightId ? d : null };
      };
      const canHover = window.matchMedia("(hover: hover)").matches;
      let hovered: string | null = null;
      const setHoverOpacity = (t: number) => {
        for (const [layer, prop] of LAYERS.hoverFade ?? []) m.setPaintProperty(layer, prop, t);
        for (const layer of LAYERS.hover.grids) m.setPaintProperty(layer, "line-opacity", gridLodOpacity(t) as never);
      };
      const setHover = (id: string | null) => {
        if (id === hovered) return;
        hovered = id;
        for (const layer of LAYERS.hover.plain) m.setFilter(layer, byDestination(id) as never);
        for (const layer of LAYERS.hover.grids) m.setFilter(layer, ["all", byDestination(id), GRID_BIG_ENOUGH] as never);
        if (!LAYERS.hoverFade || !id) return;
        // Default -> hover: fade the hover layers in.
        cancelAnimationFrame(fade.current.hoverFrame);
        const start = performance.now();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const step = () => {
          const t = reduce ? 1 : Math.min(1, (performance.now() - start) / SELECT_FADE_MS);
          setHoverOpacity(easeOut(t));
          if (t < 1) fade.current.hoverFrame = requestAnimationFrame(step);
        };
        step();
      };
      m.on("mousemove", (e) => {
        const { dot, country } = pick(e.point);
        m.getCanvas().style.cursor = dot || country ? "pointer" : "";
        if (canHover) setHover(country);
      });
      m.on("mouseout", () => {
        setHover(null);
        m.getCanvas().style.cursor = "";
      });
      m.on("click", (e) => {
        const { country } = pick(e.point);
        if (!country) return;
        setHover(null);
        onSelectCountryRef.current?.(country);
      });

      map.current = m;
      // Hologram rim glow: keep the circle behind the canvas on the globe's on-screen disc. The camera looks at the
      // globe's centre, so that projects to the map centre. The visible edge is where points along a great circle
      // from the centre reach their furthest on-screen distance (perspective makes it a little under 90°).
      if (LAYERS.rim) {
        const toRad = Math.PI / 180;
        const placeRim = () => {
          const el = rim.current;
          if (!el) return;
          const c = m.getCenter();
          const p0 = m.project(c);
          const phi = c.lat * toRad;
          let r = 0;
          for (let deg = 50; deg <= 90; deg += 2) {
            const t = deg * toRad; // due east along a great circle
            const lat = Math.asin(Math.sin(phi) * Math.cos(t));
            const lng = c.lng + Math.atan2(Math.sin(t) * Math.cos(phi), Math.cos(t) - Math.sin(phi) * Math.sin(lat)) / toRad;
            const p = m.project([lng, lat / toRad]);
            r = Math.max(r, Math.hypot(p.x - p0.x, p.y - p0.y));
          }
          el.style.transform = `translate(${p0.x - r}px, ${p0.y - r}px) scale(${r / 500})`;
        };
        m.on("move", placeRim);
        m.on("resize", placeRim);
        m.once("load", placeRim);
      }
      // Dev-only handle for inspecting layers from the browser console.
      if (import.meta.env.DEV) (window as unknown as { __globe?: unknown }).__globe = m;
      const resizeSearch = () => {
        if (container.current?.classList.contains("globe-search-canvas") && !m.isMoving()) m.setPadding(searchPadding());
      };
      m.on("resize", resizeSearch);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(fadeState.frame);
      cancelAnimationFrame(fadeState.hoverFrame);
      if (pulseTimer !== undefined) clearInterval(pulseTimer);
      if (glowTimer !== undefined) clearInterval(glowTimer);
      ready.current = false;
      map.current?.remove();
      map.current = null;
    };
    // Create the map once; data changes are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push outbreak data + disease filter into the map whenever they change.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    applyOutbreaks(m);
    applyCountry(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outbreaks, selectedDiseaseId, highlightId]);

  // Detailed outlines are fetched on demand; draw the selected country once its outline arrives.
  useEffect(() => {
    if (!highlightId) return;
    void loadCountryShape(highlightId).then(() => {
      const m = map.current;
      if (m && ready.current && dataRef.current.highlightId === highlightId) applyCountry(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId]);

  return (
    <div className={`globe-bg absolute inset-0 ${selectedDestinationId ? "" : "globe-search"} ${LAYERS.wrapperClass}`}>
      {LAYERS.rim && <div ref={rim} className="globe-rim" aria-hidden="true" />}
      <div ref={container} className="h-full w-full" />
      {outbreaks.length > 0 && (
        <div className="glass pointer-events-auto absolute bottom-4 left-4 z-10 rounded-2xl px-4 py-3 text-xs">
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
