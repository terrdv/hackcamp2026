// MapLibre layers for the globe's countries, per MAP_STYLE (src/lib/map-config.ts). GlobeMap adds the imagery source,
// the activity circles (always last, so on top) and the interaction; everything that differs between styles is here.
//
// Shared sources (filled by GlobeMap once public/world/countries.json loads):
//   world       every country outline (simplified Natural Earth 50m), property d = destination id
//   world-grid  the global degree grid clipped to every country (src/lib/world-grid.ts)
//   country     the selected country's detailed outline (public/shapes/<id>.json)
// Hologram adds:
//   world-lines / country-lines   the same outlines as lines, minus the ±180° cut (no fake border through Chukotka)
//   graticule   the same degree grid over the whole globe, oceans included
//   particles   sparse ocean dots (HOLOGRAM_PARTICLES)

import { COUNTRY_STYLE, GRID_LOD, HOLOGRAM, rgba } from "./globe-style";
import { HOLOGRAM_PARTICLES, type MapStyleName } from "./map-config";

type Layer = Record<string, unknown>;
type OpacityProp = readonly [layer: string, prop: "fill-opacity" | "line-opacity"];

export interface CountryLayers {
  /** Extra sources beyond earth/outbreaks/country/world/world-grid. */
  sources: Record<string, unknown>;
  /** Layers drawn under the imagery (e.g. a tint colour showing through it). */
  below: Layer[];
  earthPaint: Record<string, unknown>;
  /** Layers between the imagery and the activity circles. */
  layers: Layer[];
  /** CSS class on the globe wrapper. */
  wrapperClass: string;
  /** Draw the cyan rim glow around the globe (hologram). */
  rim: boolean;
  /** MapLibre sky (globe atmosphere), or undefined for none. */
  sky?: Record<string, unknown>;
  /** Selected-state layers whose opacity fades 0 -> 1 (grid handled via selectedGridOpacity). */
  selectedFade: readonly OpacityProp[];
  selectedGrid: string;
  /** Selected glow that breathes slowly (hologram), or null. */
  pulsedGlow: OpacityProp | null;
  /** Default outline layers hidden under the selected country, which draws its own detailed outline. */
  hideUnderSelection: string[];
  /** Hover layers, filtered to the hovered country. */
  hover: { plain: string[]; grids: string[] };
  /** Hover layers that fade in (hologram); null = instant (classic). */
  hoverFade: readonly OpacityProp[] | null;
}

export const NONE = "\u0000"; // matches no destination id
export const byDestination = (id: string | null) => ["==", ["get", "d"], id ?? NONE];
export const notDestination = (id: string | null) => ["!=", ["coalesce", ["get", "d"], ""], id ?? NONE];
/** Skip the grid on countries too small on screen to show it (tiny islands, microstates). */
export const GRID_BIG_ENOUGH = [">=", ["zoom"], ["get", "mz"]];

/** Level of detail: 4° lines always, 2° then 1° lines fade in as the map zooms in; times `t` (fade). */
export const gridLodOpacity = (t = 1) => [
  "interpolate", ["linear"], ["zoom"],
  GRID_LOD.twoDegree.from, ["match", ["get", "s"], 4, t, 0],
  GRID_LOD.twoDegree.to, ["match", ["get", "s"], 1, 0, t],
  GRID_LOD.oneDegree.from, ["match", ["get", "s"], 1, 0, t],
  GRID_LOD.oneDegree.to, t,
];
/** Selected grid: 2° when zoomed far out, 1° otherwise, times the selection fade `t` (zoom must stay top-level). */
export const selectedGridOpacity = (t: number) => [
  "interpolate", ["linear"], ["zoom"],
  GRID_LOD.selectedOneDegree.from, ["match", ["get", "s"], 1, 0, t],
  GRID_LOD.selectedOneDegree.to, t,
];
const instant = { duration: 0 };
const round = { "line-join": "round", "line-cap": "round" };
const hit: Layer = { id: "world-hit", type: "fill", source: "world", paint: { "fill-color": "#000000", "fill-opacity": 0 } };

// ---------------------------------------------------------------------------------------------------------------
// Classic (tag map-classic-v1): unchanged layer ids and paint.
function classic(): CountryLayers {
  const S = COUNTRY_STYLE;
  return {
    sources: {},
    below: [],
    earthPaint: { "raster-fade-duration": 0, "raster-saturation": 0, "raster-brightness-max": 1, "raster-contrast": 0 },
    wrapperClass: "",
    rim: false,
    layers: [
      // Selected tint sits directly on the imagery, under every line.
      {
        id: "sel-fill",
        type: "fill",
        source: "country",
        paint: {
          "fill-color": rgba(S.selected.fill.color, S.selected.fill.opacity),
          "fill-opacity": 0,
          "fill-opacity-transition": instant,
        },
      },
      // Every country: faint grid + border.
      {
        id: "world-grid-base",
        type: "line",
        source: "world-grid",
        filter: GRID_BIG_ENOUGH,
        paint: {
          "line-color": rgba(S.unselected.grid.color, S.unselected.grid.opacity),
          "line-width": S.unselected.grid.width,
          "line-opacity": gridLodOpacity(),
        },
      },
      {
        id: "world-grid-hover",
        type: "line",
        source: "world-grid",
        filter: ["all", byDestination(null), GRID_BIG_ENOUGH],
        paint: {
          "line-color": rgba(S.hover.grid.color, S.hover.grid.opacity),
          "line-width": S.hover.grid.width,
          "line-opacity": gridLodOpacity(),
        },
      },
      {
        id: "world-border-base",
        type: "line",
        source: "world",
        layout: { "line-join": "round" },
        paint: {
          "line-color": rgba(S.unselected.border.color, S.unselected.border.opacity),
          "line-width": S.unselected.border.width,
        },
      },
      {
        id: "world-border-hover",
        type: "line",
        source: "world",
        filter: byDestination(null),
        layout: { "line-join": "round" },
        paint: {
          "line-color": rgba(S.hover.border.color, S.hover.border.opacity),
          "line-width": S.hover.border.width,
        },
      },
      // Invisible fill used only for hover and click hit-testing.
      hit,
      // Selected country: full 1° grid, soft glow, bright border (detailed outline from public/shapes).
      {
        id: "sel-grid",
        type: "line",
        source: "world-grid",
        filter: byDestination(null),
        paint: {
          "line-color": rgba(S.selected.grid.color, S.selected.grid.opacity),
          "line-width": S.selected.grid.width,
          "line-opacity": selectedGridOpacity(0),
          "line-opacity-transition": instant,
        },
      },
      {
        id: "sel-glow",
        type: "line",
        source: "country",
        layout: round,
        paint: {
          "line-color": rgba(S.selected.glow.color, S.selected.glow.opacity),
          "line-width": S.selected.glow.width,
          "line-blur": S.selected.glow.blur,
          "line-opacity": 0,
          "line-opacity-transition": instant,
        },
      },
      {
        id: "sel-border",
        type: "line",
        source: "country",
        layout: round,
        paint: {
          "line-color": rgba(S.selected.border.color, S.selected.border.opacity),
          "line-width": S.selected.border.width,
          "line-opacity": 0,
          "line-opacity-transition": instant,
        },
      },
    ],
    selectedFade: [
      ["sel-fill", "fill-opacity"],
      ["sel-glow", "line-opacity"],
      ["sel-border", "line-opacity"],
    ],
    selectedGrid: "sel-grid",
    pulsedGlow: null,
    hideUnderSelection: ["world-border-base"],
    hover: { plain: ["world-border-hover"], grids: ["world-grid-hover"] },
    hoverFade: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hologram: darkened navy-tinted imagery, whole-globe grid, glowing ice-blue outlines on every country.
function hologram(): CountryLayers {
  const H = HOLOGRAM;
  const line = (
    id: string,
    source: string,
    style: { color: string; opacity: number; width: number; blur?: number },
    extra: Layer = {},
    opacity: unknown = 1,
  ): Layer => ({
    id,
    type: "line",
    source,
    layout: round,
    paint: {
      "line-color": rgba(style.color, style.opacity),
      "line-width": style.width,
      ...(style.blur ? { "line-blur": style.blur } : {}),
      "line-opacity": opacity,
      "line-opacity-transition": instant,
    },
    ...extra,
  });
  const fill = (id: string, source: string, style: { color: string; opacity: number }, extra: Layer = {}): Layer => ({
    id,
    type: "fill",
    source,
    paint: { "fill-color": rgba(style.color, style.opacity), "fill-opacity": 0, "fill-opacity-transition": instant },
    ...extra,
  });
  const grid = (id: string, style: { color: string; opacity: number; width: number }, filter: unknown): Layer => ({
    id,
    type: "line",
    source: "world-grid",
    filter,
    paint: {
      "line-color": rgba(style.color, style.opacity),
      "line-width": style.width,
      "line-opacity": gridLodOpacity(),
      "line-opacity-transition": instant,
    },
  });
  const hoverFilter = byDestination(null);
  return {
    sources: {
      "world-lines": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      "country-lines": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      graticule: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      ...(HOLOGRAM_PARTICLES ? { particles: { type: "geojson", data: { type: "FeatureCollection", features: [] } } } : {}),
    },
    // The navy background shows through the semi-transparent imagery: a deep-blue tint without a second pass.
    below: [{ id: "holo-tint", type: "background", paint: { "background-color": H.base.tint } }],
    earthPaint: {
      "raster-fade-duration": 0,
      "raster-opacity": H.base.imageryOpacity,
      "raster-saturation": H.base.saturation,
      "raster-brightness-max": H.base.brightnessMax,
      "raster-contrast": H.base.contrast,
    },
    wrapperClass: "globe-holo",
    rim: true,
    layers: [
      // Whole-globe grid (oceans included), then fills.
      {
        id: "holo-graticule",
        type: "line",
        source: "graticule",
        paint: {
          "line-color": rgba(H.oceanGrid.color, H.oceanGrid.opacity),
          "line-width": H.oceanGrid.width,
          "line-opacity": gridLodOpacity(),
        },
      },
      ...(HOLOGRAM_PARTICLES
        ? [
            {
              id: "holo-particles",
              type: "circle",
              source: "particles",
              paint: {
                "circle-color": H.particles.color,
                "circle-opacity": H.particles.opacity,
                "circle-radius": ["*", H.particles.radius, ["get", "r"]],
                "circle-blur": H.particles.blur,
                "circle-pitch-alignment": "map",
              },
            },
          ]
        : []),
      fill("holo-sel-fill", "country", H.selected.fill),
      fill("holo-hover-fill", "world", H.hover.fill, { filter: hoverFilter }),
      // Land grid: same lines as the ocean grid, a step brighter inside countries.
      grid("holo-grid", H.default.grid, GRID_BIG_ENOUGH),
      grid("holo-grid-hover", H.hover.grid, ["all", hoverFilter, GRID_BIG_ENOUGH]),
      // Default outline on every country: soft wide glow under a thin ice-blue line.
      line("holo-border-glow", "world-lines", H.default.glow),
      line("holo-border", "world-lines", H.default.border),
      // Hover: brighter, whiter, wider glow.
      line("holo-hover-glow", "world-lines", H.hover.glow, { filter: hoverFilter }, 0),
      line("holo-hover-border", "world-lines", H.hover.border, { filter: hoverFilter }, 0),
      hit,
      // Selected: brand teal, strongest glow (detailed outline from public/shapes).
      {
        id: "holo-sel-grid",
        type: "line",
        source: "world-grid",
        filter: byDestination(null),
        paint: {
          "line-color": rgba(H.selected.grid.color, H.selected.grid.opacity),
          "line-width": H.selected.grid.width,
          "line-opacity": selectedGridOpacity(0),
          "line-opacity-transition": instant,
        },
      },
      line("holo-sel-glow", "country-lines", H.selected.glow, {}, 0),
      line("holo-sel-border", "country-lines", H.selected.border, {}, 0),
    ],
    selectedFade: [
      ["holo-sel-fill", "fill-opacity"],
      ["holo-sel-border", "line-opacity"],
    ],
    selectedGrid: "holo-sel-grid",
    pulsedGlow: ["holo-sel-glow", "line-opacity"],
    hideUnderSelection: ["holo-border", "holo-border-glow"],
    hover: { plain: ["holo-hover-fill", "holo-hover-glow", "holo-hover-border"], grids: ["holo-grid-hover"] },
    hoverFade: [
      ["holo-hover-fill", "fill-opacity"],
      ["holo-hover-glow", "line-opacity"],
      ["holo-hover-border", "line-opacity"],
    ],
  };
}

export function countryLayers(style: MapStyleName): CountryLayers {
  return style === "classic" ? classic() : hologram();
}
