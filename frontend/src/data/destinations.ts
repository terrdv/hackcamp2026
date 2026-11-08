// MOCK DATA — illustrative only, not live or current outbreak information.
// Shape is intended to be replaced by an external health data API later.

export type Severity = "low" | "moderate" | "high";

export interface Advisory {
  disease: string;
  severity: Severity;
  summary: string;
  months?: number[]; // 1-12, months of elevated risk
}

export interface Destination {
  id: string;
  iso3: string; // matches location_iso3 in the Databricks gold tables
  name: string;
  region: string;
  coords: [number, number]; // [lng, lat]
  zoom: number;
  overview: string;
  advisories: Advisory[];
  seasonal: { months: number[]; title: string; text: string }[];
  prevention: string[];
  packing: string[];
  sources: { label: string; url: string }[];
}

const commonSources = [
  { label: "CDC Travelers' Health", url: "https://wwwnc.cdc.gov/travel" },
  { label: "WHO International Travel & Health", url: "https://www.who.int/health-topics/travel-and-health" },
];

// Destinations added with the live pipeline carry no hand-written advice; their content comes from the data.
const SURVEILLANCE_OVERVIEW =
  "Disease activity for this destination comes from WHO and OpenDengue surveillance data, compared with what is normal there for your travel dates. Always check official travel health advice before you go.";

export const destinations: Destination[] = [
  {
    id: "japan",
    iso3: "JPN",
    name: "Japan",
    region: "East Asia",
    coords: [138.25, 36.2],
    zoom: 4.6,
    overview:
      "Japan has a high standard of public health. Most travelers need only routine vaccines, with some seasonal and rural considerations.",
    advisories: [
      { disease: "Seasonal influenza", severity: "moderate", summary: "Peaks in winter months; crowded transit increases exposure.", months: [12, 1, 2, 3] },
      { disease: "Japanese encephalitis", severity: "low", summary: "Rare; mainly relevant for long rural stays during summer.", months: [6, 7, 8, 9] },
      { disease: "Heat illness", severity: "moderate", summary: "Hot, humid summers can cause heat exhaustion.", months: [7, 8] },
    ],
    seasonal: [
      { months: [12, 1, 2], title: "Winter", text: "Flu season. Cold, dry air in the north and mountains." },
      { months: [6, 7], title: "Rainy season", text: "Tsuyu brings humidity and mosquitoes." },
      { months: [7, 8, 9], title: "Summer heat", text: "Very hot and humid; typhoon risk late summer." },
    ],
    prevention: ["Stay up to date on routine vaccines", "Hydrate frequently in summer", "Wear a mask on crowded transit if unwell", "Discuss JE vaccine for extended rural stays"],
    packing: ["Hand sanitizer", "Face masks", "Insect repellent", "Reusable water bottle", "Sunscreen SPF 50", "Basic first-aid kit"],
    sources: [...commonSources, { label: "Japan National Tourism Organization – Safety", url: "https://www.japan.travel/en/plan/safety-tips/" }],
  },
  {
    id: "thailand",
    iso3: "THA",
    name: "Thailand",
    region: "Southeast Asia",
    coords: [100.99, 15.87],
    zoom: 5,
    overview:
      "Tropical climate with mosquito-borne illness risk year-round, peaking in the rainy season. Food and water precautions are recommended.",
    advisories: [
      { disease: "Dengue", severity: "high", summary: "Mosquito-borne; risk rises sharply in rainy season.", months: [6, 7, 8, 9, 10] },
      { disease: "Travelers' diarrhea", severity: "moderate", summary: "Common; choose freshly cooked food and sealed water." },
      { disease: "Rabies", severity: "low", summary: "Avoid contact with dogs, monkeys and other animals." },
      { disease: "Malaria", severity: "low", summary: "Limited to some forested border areas." },
    ],
    seasonal: [
      { months: [3, 4, 5], title: "Hot season", text: "Extreme heat; dehydration risk." },
      { months: [6, 7, 8, 9, 10], title: "Rainy season", text: "Peak mosquito activity and dengue transmission." },
      { months: [11, 12, 1, 2], title: "Cool season", text: "Drier and more comfortable; still use repellent." },
    ],
    prevention: ["Use DEET or picaridin repellent day and night", "Drink bottled or treated water", "Consider hepatitis A and typhoid vaccines", "Avoid touching stray animals"],
    packing: ["Insect repellent (DEET 30%+)", "Oral rehydration salts", "Lightweight long sleeves", "Sunscreen", "Anti-diarrheal medication", "Water purification tablets"],
    sources: [...commonSources],
  },
  {
    id: "brazil",
    iso3: "BRA",
    name: "Brazil",
    region: "South America",
    coords: [-51.93, -14.24],
    zoom: 3.6,
    overview:
      "Large, diverse country with regional differences. Yellow fever vaccination is recommended for many areas, and mosquito protection is important.",
    advisories: [
      { disease: "Yellow fever", severity: "high", summary: "Vaccination recommended for many regions; check your itinerary." },
      { disease: "Dengue & chikungunya", severity: "high", summary: "Mosquito-borne; higher in the warm rainy months.", months: [1, 2, 3, 4, 5] },
      { disease: "Zika", severity: "moderate", summary: "Pregnant travelers should consult a doctor before travel." },
      { disease: "Sun & heat", severity: "moderate", summary: "Strong UV, especially on the coast." },
    ],
    seasonal: [
      { months: [12, 1, 2, 3], title: "Summer & Carnival", text: "Hot, rainy and crowded; mosquito risk peaks." },
      { months: [6, 7, 8], title: "Dry winter", text: "Milder in the south; lower mosquito activity in many areas." },
    ],
    prevention: ["Get yellow fever vaccine at least 10 days before travel", "Use repellent and sleep under screens", "Practice food and water hygiene", "Seek shade at midday"],
    packing: ["Yellow fever certificate", "Insect repellent", "Permethrin-treated clothing", "High-SPF sunscreen", "Wide-brimmed hat", "First-aid kit"],
    sources: [...commonSources, { label: "PAHO – Yellow Fever", url: "https://www.paho.org/en/topics/yellow-fever" }],
  },
  {
    id: "vietnam",
    iso3: "VNM",
    name: "Vietnam",
    region: "Southeast Asia",
    coords: [106.3, 16.2],
    zoom: 4.8,
    overview: SURVEILLANCE_OVERVIEW,
    advisories: [],
    seasonal: [],
    prevention: [],
    packing: [],
    sources: [...commonSources, { label: "Government of Canada – Vietnam travel advice", url: "https://travel.gc.ca/destinations/vietnam" }],
  },
  {
    id: "philippines",
    iso3: "PHL",
    name: "Philippines",
    region: "Southeast Asia",
    coords: [122.0, 12.5],
    zoom: 4.8,
    overview: SURVEILLANCE_OVERVIEW,
    advisories: [],
    seasonal: [],
    prevention: [],
    packing: [],
    sources: [...commonSources, { label: "Government of Canada – Philippines travel advice", url: "https://travel.gc.ca/destinations/philippines" }],
  },
  {
    id: "india",
    iso3: "IND",
    name: "India",
    region: "South Asia",
    coords: [79.0, 22.0],
    zoom: 3.8,
    overview: SURVEILLANCE_OVERVIEW,
    advisories: [],
    seasonal: [],
    prevention: [],
    packing: [],
    sources: [...commonSources, { label: "Government of Canada – India travel advice", url: "https://travel.gc.ca/destinations/india" }],
  },
  {
    id: "china",
    iso3: "CHN",
    name: "China",
    region: "East Asia",
    coords: [104.2, 35.9],
    zoom: 3.2,
    overview: SURVEILLANCE_OVERVIEW,
    advisories: [],
    seasonal: [],
    prevention: [],
    packing: [],
    sources: [...commonSources, { label: "Government of Canada – China travel advice", url: "https://travel.gc.ca/destinations/china" }],
  },
  {
    id: "mexico",
    iso3: "MEX",
    name: "Mexico",
    region: "North America",
    coords: [-102.5, 23.6],
    zoom: 4.0,
    overview: SURVEILLANCE_OVERVIEW,
    advisories: [],
    seasonal: [],
    prevention: [],
    packing: [],
    sources: [...commonSources, { label: "Government of Canada – Mexico travel advice", url: "https://travel.gc.ca/destinations/mexico" }],
  },
];

export function monthsBetween(start: string, end: string): number[] {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const out = new Set<number>();
  const d = new Date(s.getFullYear(), s.getMonth(), 1);
  while (d <= e && out.size < 12) {
    out.add(d.getMonth() + 1);
    d.setMonth(d.getMonth() + 1);
  }
  return [...out];
}

export function validateDates(depart: string, ret: string, today = new Date()): string | null {
  if (!depart || !ret) return "Please choose both dates.";
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(depart + "T00:00:00");
  const r = new Date(ret + "T00:00:00");
  if (d < t) return "Departure can't be in the past.";
  if (r < d) return "Return must be on or after departure.";
  return null;
}
