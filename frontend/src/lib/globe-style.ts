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

/** Unselected → selected fade. */
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
