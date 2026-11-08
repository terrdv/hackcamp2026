// Globe look. 'classic' is the original style (git tag map-classic-v1): faint slate borders, teal selected country.
// 'hologram' is the glowing digital-earth style. Colours and widths for both live in src/lib/globe-style.ts.
export type MapStyleName = "hologram" | "classic";
export const MAP_STYLE: MapStyleName = "classic";

/** Hologram only: sparse static light dots over the oceans (HOLOGRAM.particles). Small and under the activity circles;
 *  set to false if they compete with them. */
export const HOLOGRAM_PARTICLES = true;

/** Hologram only: slow breathing glow on the selected country's outline. */
export const HOLOGRAM_SELECTED_PULSE = true;
