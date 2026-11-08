// Data model for destination health reports.
// Shapes mirror what a future surveillance backend (e.g. Databricks) could return,
// so the mock service can later be swapped for real HTTP calls without touching components.

export type ActivityLevel = "low" | "moderate" | "elevated" | "unknown";
export type Trend = "increasing" | "stable" | "decreasing" | "unknown";

export interface Disease {
  id: string;
  name: string;
  description: string;
  activityLevel: ActivityLevel;
  trend: Trend;
  latestCases: number | null;
  reportingPeriod: string;
  source: string;
}

export interface OutbreakObservation {
  id: string;
  diseaseId: string;
  locationName: string;
  latitude: number;
  longitude: number;
  cases: number;
  reportDate: string;
  source: string;
}

export interface TimeSeriesPoint {
  diseaseId: string;
  date: string; // ISO month, e.g. "2026-03"
  cases: number;
}

export type RecommendationCategory = "packing" | "precaution" | "before-departure";

export interface TravelRecommendation {
  id: string;
  title: string;
  category: RecommendationCategory;
  explanation: string;
  relatedDiseaseIds: string[];
}

export interface DestinationReport {
  destinationId: string;
  surveillanceDate: string; // latest reporting date in the dataset
  diseases: Disease[];
  outbreaks: OutbreakObservation[];
  timeSeries: TimeSeriesPoint[];
  recommendations: TravelRecommendation[];
}
