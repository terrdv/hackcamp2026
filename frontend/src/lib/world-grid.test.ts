import { describe, expect, it } from "vitest";
import type { FeatureCollection, MultiPolygon, Position } from "geojson";
import {
  buildGraticule,
  buildWorldGrid,
  clipPolygon,
  levelOf,
  oceanParticles,
  outlineLines,
  zoomForSpan,
  type CountryProps,
} from "./world-grid";

const box = (x0: number, y0: number, x1: number, y1: number): Position[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const all = (m: Map<number, Position[][]>) => [...m.values()].flat();

describe("levelOf", () => {
  it("tags each line with its coarsest level", () => {
    expect([0, 1, 2, 3, 4, -2, -4, -3].map(levelOf)).toEqual([4, 1, 2, 1, 4, 2, 4, 1]);
  });
});

describe("clipPolygon", () => {
  it("clips whole-degree lines to the polygon", () => {
    const segs = all(clipPolygon([box(0.5, 0.5, 3.5, 2.5)]));
    // Parallels at 1° and 2°, meridians at 1°, 2°, 3°.
    expect(segs).toHaveLength(5);
    expect(segs).toContainEqual([
      [0.5, 1],
      [3.5, 1],
    ]);
    expect(segs).toContainEqual([
      [2, 0.5],
      [2, 2.5],
    ]);
  });

  it("leaves holes empty", () => {
    const segs = all(clipPolygon([box(0, 0, 4, 4), box(1.5, 1.5, 2.5, 2.5)]));
    const row2 = segs.filter((s) => s[0]![1] === 2 && s[1]![1] === 2);
    expect(row2).toEqual([
      [
        [0, 2],
        [1.5, 2],
      ],
      [
        [2.5, 2],
        [4, 2],
      ],
    ]);
  });

  it("never draws the antimeridian or wraps across it", () => {
    const east = all(clipPolygon([box(178.2, 60.5, 180, 62.5)]));
    const west = all(clipPolygon([box(-180, 60.5, -178.2, 62.5)]));
    for (const seg of [...east, ...west]) {
      for (const [x] of seg) expect(Math.abs(x!)).toBeLessThanOrEqual(180);
      expect(Math.abs(seg[0]![0]! - seg[1]![0]!)).toBeLessThan(2); // no segment spans the globe
    }
    expect(east.some((s) => s[0]![0] === 180 && s[1]![0] === 180)).toBe(false);
  });
});

describe("buildWorldGrid", () => {
  it("groups segments per country and level, and gates small countries by zoom", () => {
    const countries: FeatureCollection<MultiPolygon, CountryProps> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { k: "BIG", d: "big", span: 8 },
          geometry: { type: "MultiPolygon", coordinates: [[box(0.5, 0.5, 8.5, 8.5)]] },
        },
        {
          type: "Feature",
          properties: { k: "VAT", span: 0.01 },
          geometry: { type: "MultiPolygon", coordinates: [[box(12.45, 41.9, 12.46, 41.91)]] },
        },
      ],
    };
    const grid = buildWorldGrid(countries);
    expect(grid.features.map((f) => [f.properties.k, f.properties.s])).toEqual([
      ["BIG", 4],
      ["BIG", 2],
      ["BIG", 1],
    ]);
    expect(grid.features[0]!.properties.d).toBe("big");
    expect(zoomForSpan(8)).toBeLessThan(zoomForSpan(0.5));
  });
});

describe("buildGraticule", () => {
  it("covers the globe with the same whole-degree lines, never on the antimeridian", () => {
    const g = buildGraticule();
    const lines = g.features.flatMap((f) => f.geometry.coordinates);
    const meridians = lines.filter((l) => l[0]![0] === l[1]![0] && l.length === 2);
    expect(meridians).toHaveLength(359); // -179..179
    expect(meridians.some((l) => Math.abs(l[0]![0]!) === 180)).toBe(false);
    const parallels = lines.filter((l) => l.length > 2);
    expect(parallels).toHaveLength(161); // -80..80
    const level4 = g.features.find((f) => f.properties.s === 4)!.geometry.coordinates;
    expect(
      level4.every((l) => l.every(([x, y]) => (l.length > 2 ? y! % 4 === 0 : x! % 4 === 0))),
    ).toBe(true);
  });
});

describe("oceanParticles", () => {
  it("places the requested number of points off land, deterministically", () => {
    const land: FeatureCollection<MultiPolygon, CountryProps> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { k: "BIG", span: 360 },
          geometry: { type: "MultiPolygon", coordinates: [[box(-180, -60, 0, 60)]] },
        },
      ],
    };
    const a = oceanParticles(land, 50);
    expect(a.features).toHaveLength(50);
    expect(a.features.every((f) => f.geometry.coordinates[0]! > 0)).toBe(true);
    expect(oceanParticles(land, 50)).toEqual(a);
  });
});

describe("outlineLines", () => {
  it("drops edges along the antimeridian cut but keeps the real coastline", () => {
    // East half of a country split at 180° (like Chukotka): its right edge is the cut, not a border.
    const lines = outlineLines([[box(175, 64, 180, 68)]]);
    const edges = lines.flatMap((l) => l.slice(1).map((b, i) => [l[i]!, b]));
    expect(edges).toHaveLength(3);
    expect(edges.some(([a, b]) => a?.[0] === 180 && b?.[0] === 180)).toBe(false);
  });

  it("keeps an ordinary ring whole", () => {
    expect(outlineLines([[box(0, 0, 1, 1)]])).toEqual([box(0, 0, 1, 1)]);
  });
});
