// Country border + grid styling for the globe, in one place. MapLibre paint values must be hex/rgba (no CSS vars or
// oklch), so these are plain constants. Only slate and teal are used here: red, amber and green mean risk levels
// and stay exclusive to the activity circles and their legend.

export const SLATE_300 = "#CBD5E1";
export const SLATE_400 = "#94A3B8";
export const TEAL_300 = "#5EEAD4";
export const TEAL_400 = "#2DD4BF";

/** Paint values per country state. Opacity is the colour's alpha; width is in px. */
export const COUNTRY_STYLE = {
  unselected: {
    border: { color: SLATE_300, opacity: 0.3, width: 0.75 },
    grid: { color: SLATE_400, opacity: 0.08, width: 0.5 },
  },
  hover: {
    border: { color: TEAL_300, opacity: 0.55, width: 1 },
    grid: { color: TEAL_300, opacity: 0.14, width: 0.5 },
  },
  selected: {
    border: { color: TEAL_300, opacity: 1, width: 1.75 },
    glow: { color: TEAL_400, opacity: 0.35, width: 7, blur: 4 },
    grid: { color: TEAL_300, opacity: 0.28, width: 0.75 },
    fill: { color: TEAL_400, opacity: 0.06 },
  },
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Hologram style (MAP_STYLE = 'hologram'): ice-blue glowing outlines over darkened, navy-tinted imagery.
// Cyan/blue for every country, brand teal only for the selected one; still no red, amber or green.
export const NAVY_950 = "#0B1B33";
export const SKY_400 = "#38BDF8";
export const SKY_300 = "#7DD3FC";
export const CYAN_300 = "#67E8F9";
export const CYAN_50 = "#E0F7FF";

export const HOLOGRAM = {
  /** Imagery is drawn at `imageryOpacity` over a navy background, i.e. a navy tint of (1 - imageryOpacity). */
  base: {
    tint: NAVY_950,
    imageryOpacity: 0.55,
    saturation: -0.35,
    brightnessMax: 0.9,
    contrast: 0.1,
  },
  /** Rim glow around the globe edge: `.globe-rim` in styles.css (box-shadow on a 1000px circle scaled to the globe). */
  atmosphere: { color: SKY_400, opacity: 0.35, blurPx: 24, spreadPx: 4 },
  /** Lat/long grid over the whole globe, oceans included. */
  oceanGrid: { color: SKY_400, opacity: 0.12, width: 0.75 },
  default: {
    border: { color: SKY_300, opacity: 0.45, width: 0.75 },
    glow: { color: SKY_400, opacity: 0.15, width: 3.5, blur: 2 },
    grid: { color: SKY_300, opacity: 0.16, width: 0.75 }, // land grid, a step brighter than the ocean grid
  },
  hover: {
    border: { color: CYAN_50, opacity: 0.9, width: 1.25 },
    glow: { color: CYAN_300, opacity: 0.35, width: 6, blur: 3 },
    grid: { color: SKY_300, opacity: 0.3, width: 0.75 },
    fill: { color: CYAN_300, opacity: 0.05 },
  },
  selected: {
    border: { color: TEAL_300, opacity: 1, width: 2 },
    glow: { color: TEAL_400, opacity: 0.45, width: 9, blur: 5 },
    grid: { color: TEAL_300, opacity: 0.3, width: 0.75 },
    fill: { color: TEAL_400, opacity: 0.08 },
    /** Breathing glow: opacity multiplier swings between `min` and 1 every `periodMs`. */
    pulse: { periodMs: 2600, min: 0.7 },
  },
  /** Sparse static dots over the oceans (HOLOGRAM_PARTICLES). Kept under the activity circles. */
  particles: { color: SKY_300, opacity: 0.55, radius: 1.4, blur: 0.5, count: 160 },
} as const;

/** Default → hover → selected fades. */
export const SELECT_FADE_MS = 200;

/**
 * Grid level of detail by map zoom (spacings from src/lib/world-grid.ts): 4° lines always, 2° lines fade in, then
 * 1° lines. The selected country shows the 1° grid (the original selected-country density) from zoom 3.
 */
export const GRID_LOD = {
  twoDegree: { from: 4.75, to: 5.25 },
  oneDegree: { from: 5.75, to: 6.25 },
  /** Selected country: 2° below this range (1° cells would be < ~10 px, e.g. Russia, Canada), 1° above it. */
  selectedOneDegree: { from: 2.75, to: 3 },
} as const;

/** "#RRGGBB" + alpha -> "rgba(r, g, b, a)". */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
