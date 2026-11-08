import { describe, expect, it } from "vitest";
import { createSurfaceProjector, geographicUV } from "./earth-surface";

describe("Earth geographic registration", () => {
  it("maps geographic landmarks to the uploaded equirectangular texture", () => {
    expect(geographicUV(0, 0)).toEqual([0.5, 0.5]);
    expect(geographicUV(180, 90)).toEqual([0, 0]);
    expect(geographicUV(-180, -90)).toEqual([0, 1]);
  });
  it("places overlays on the actual UV-warped surface rather than an ideal sphere", () => {
    const project = createSurfaceProjector([2, 0, 1, 4, 0, 1, 2, 2, 1], [0.4, 0.4, 0.6, 0.4, 0.4, 0.6], [0, 1, 2]);
    const point = project(-18, 9);
    expect(point[0]).toBeCloseTo(2.5);
    expect(point[1]).toBeCloseTo(0.5);
    expect(point[2]).toBeCloseTo(1);
  });
});