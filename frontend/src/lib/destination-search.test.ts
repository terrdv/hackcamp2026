import { describe, expect, it } from "vitest";
import { destinations } from "@/data/destinations";
import { highlightParts, normalize, searchDestinations } from "./destination-search";

const names = (q: string) => searchDestinations(destinations, q).map((h) => h.destination.name);

describe("destination search", () => {
  it("lists every generated destination with a unique id and an outline-sized zoom", () => {
    expect(destinations.length).toBeGreaterThan(150);
    expect(new Set(destinations.map((d) => d.id)).size).toBe(destinations.length);
    expect(destinations.every((d) => d.zoom >= 2.5 && d.zoom <= 6.5)).toBe(true);
  });

  it("ranks prefix matches on the display name first", () => {
    expect(names("viet")[0]).toBe("Vietnam");
    expect(names("bra")[0]).toBe("Brazil");
    expect(names("japan")).toEqual(["Japan"]);
  });

  it("matches alternate names and exact codes, ignoring accents and case", () => {
    expect(names("Viet Nam")[0]).toBe("Vietnam");
    expect(names("usa")[0]).toBe("United States of America");
    expect(names("VNM")[0]).toBe("Vietnam");
    expect(normalize("Côte d'Ivoire")).toBe("cote d ivoire");
    expect(searchDestinations(destinations, "Viet Nam")[0]?.matchedAlias).toMatch(/Viet Nam/);
  });

  it("does not match short codes by prefix, and returns nothing for an empty query", () => {
    expect(
      names("v").every(
        (n) =>
          normalize(n)
            .split(" ")
            .some((w) => w.startsWith("v")) || n === "Vietnam",
      ),
    ).toBe(true);
    expect(names("   ")).toEqual([]);
    expect(names("zzzz")).toEqual([]);
  });

  it("prefers the name over a matching code and ignores formal words like 'Independent State of'", () => {
    const india = searchDestinations(destinations, "ind")[0];
    expect(india?.destination.name).toBe("India");
    expect(india?.matchedAlias).toBeNull();
    expect(names("ind")).not.toContain("Papua New Guinea");
  });

  it("caps the list and highlights the matched part of the name", () => {
    expect(searchDestinations(destinations, "a").length).toBeLessThanOrEqual(8);
    expect(highlightParts("Vietnam", "nam")).toEqual(["Viet", "nam", ""]);
    expect(highlightParts("Vietnam", "xyz")).toBeNull();
  });
});
