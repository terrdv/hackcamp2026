import { describe, expect, it } from "vitest";
import {
  buildReport,
  diseaseLevel,
  toActivityLevel,
  tripMonths,
  type OutlookRow,
  type ReportInput,
} from "./report-mapping";

const seasonal = (month: number, level: string): OutlookRow => ({
  disease: "dengue",
  row_type: "seasonal",
  month,
  level,
  based_on: "seasonal",
  data_as_of: "2025-03-01",
  source: "OpenDengue",
});

describe("level mapping", () => {
  it("maps every pipeline vocabulary and never turns missing data into low", () => {
    expect(toActivityLevel("peak")).toBe("elevated");
    expect(toActivityLevel("higher_than_usual")).toBe("moderate");
    expect(toActivityLevel("not_reported")).toBe("low");
    expect(toActivityLevel("insufficient_data")).toBe("unknown");
    expect(toActivityLevel(null)).toBe("unknown");
  });

  it("covers trip months across a year end", () => {
    expect(tripMonths("2026-11-20", "2027-02-03")).toEqual([11, 12, 1, 2]);
  });

  it("takes the highest seasonal level in the trip window and ignores unknown months", () => {
    const rows = [
      seasonal(1, "low"),
      seasonal(2, "peak"),
      seasonal(3, "unknown"),
      seasonal(6, "peak"),
    ];
    expect(diseaseLevel(rows, "2027-01-05", "2027-01-20", "2026-11-07")).toBe("low");
    expect(diseaseLevel(rows, "2027-01-05", "2027-03-20", "2026-11-07")).toBe("elevated");
    expect(diseaseLevel(rows, "2027-03-01", "2027-03-20", "2026-11-07")).toBe("unknown");
  });

  it("uses real-time influenza only for near departures with fresh data", () => {
    const rows: OutlookRow[] = [
      {
        disease: "influenza",
        row_type: "seasonal",
        month: 11,
        level: "low",
        based_on: "seasonal",
        data_as_of: null,
        source: null,
      },
      {
        disease: "influenza",
        row_type: "realtime",
        month: null,
        level: "much_higher",
        based_on: "realtime",
        data_as_of: "2026-10-26",
        source: null,
      },
    ];
    expect(diseaseLevel(rows, "2026-11-20", "2026-11-30", "2026-11-07")).toBe("elevated");
    expect(diseaseLevel(rows, "2026-12-20", "2026-12-30", "2026-11-07")).toBe("unknown"); // seasonal, no December row
    expect(diseaseLevel(rows, "2026-11-20", "2026-11-30", "2026-12-15")).toBe("low"); // stale real-time -> seasonal
  });
});

describe("buildReport", () => {
  const input: ReportInput = {
    destinationId: "brazil",
    iso3: "BRA",
    countryName: "Brazil",
    start: "2027-01-05",
    end: "2027-01-20",
    today: "2026-11-07",
    outlook: [
      seasonal(1, "peak"),
      {
        ...seasonal(1, "low"),
        disease: "measles",
        row_type: "recent_activity",
        month: null,
        level: "circulating",
      },
    ],
    trends: [
      {
        disease: "dengue",
        metric: "reported_cases",
        latest_period: "2024-12-01",
        latest_cases: 145821.6,
        trend: "unknown",
        source: "OpenDengue V1.3",
        data_as_of: "2024-12-28",
      },
    ],
    monthly: [
      { disease: "dengue", period_start: "2024-11-01", cases: 100.4 },
      { disease: "dengue", period_start: "2024-12-01", cases: null },
      { disease: "typhoid", period_start: "2024-12-01", cases: 3 },
    ],
    points: [
      {
        point_id: "dengue:BRA:SAO PAULO",
        disease: "dengue",
        admin1: "Sao Paulo",
        point_type: "admin1",
        latitude: -22.2,
        longitude: -48.5,
        cases: 10,
        period_start: "2024-12-01",
        source: "OpenDengue V1.3",
      },
      {
        point_id: "measles:BRA:national",
        disease: "measles",
        admin1: null,
        point_type: "national",
        latitude: -12,
        longitude: -49,
        cases: 5,
        period_start: "2026-09-01",
        source: "WHO",
      },
      {
        point_id: "dengue:BRA:national",
        disease: "dengue",
        admin1: null,
        point_type: "national",
        latitude: -12,
        longitude: -49,
        cases: null,
        period_start: "2024-12-01",
        source: "WHO",
      },
    ],
  };
  const r = buildReport(input);

  it("builds disease cards with mapped levels, rounded counts and the reporting month", () => {
    const dengue = r.diseases.find((d) => d.id === "bra-dengue");
    expect(dengue).toMatchObject({
      name: "Dengue",
      activityLevel: "elevated",
      trend: "unknown",
      latestCases: 145822,
      reportingPeriod: "Dec 2024",
    });
    const measles = r.diseases.find((d) => d.id === "bra-measles");
    expect(measles).toMatchObject({
      activityLevel: "moderate",
      latestCases: null,
      trend: "unknown",
    });
  });

  it("drops null months and diseases without a card from the chart", () => {
    expect(r.timeSeries).toEqual([{ diseaseId: "bra-dengue", date: "2024-11", cases: 100 }]);
  });

  it("names map points and skips points without a count", () => {
    expect(r.outbreaks.map((o) => o.locationName)).toEqual(["Sao Paulo", "Brazil (national)"]);
    expect(r.outbreaks[0]).toMatchObject({ latitude: -22.2, longitude: -48.5 });
    expect(r.recommendations).toEqual([]);
    expect(r.surveillanceDate).toBe("2025-03-01");
  });
});
