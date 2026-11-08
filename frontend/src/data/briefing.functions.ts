// TanStack Start server functions that ask a Databricks-hosted LLM to explain a destination report in plain language.
// The model only rewrites the facts we pass it; activity levels shown in the UI always come from the data.
//   streamBriefExplanation  headline + summary for the Overview, streamed from the model serving endpoint
//   getRiskBriefing         per-disease meaning + "Do" actions (Overview rows, Prepare tab), structured JSON via
//                           the ai_query() SQL function

import { createServerFn } from "@tanstack/react-start";
import type { ActivityLevel, Trend } from "./types";

export const BRIEFING_MODEL = "databricks-meta-llama-3-3-70b-instruct";

export interface BriefingDisease {
  id: string;
  name: string;
  level: ActivityLevel;
  trend: Trend;
  latestCases: number | null;
  reportingPeriod: string;
  description: string;
}

export interface BriefingRequest {
  country: string;
  depart: string;
  ret: string;
  diseases: BriefingDisease[];
}

export const ACTION_TOPICS = [
  "mosquito_bites",
  "vaccination",
  "medication",
  "food_water",
  "hand_hygiene",
  "respiratory",
  "animal_contact",
  "other",
] as const;
export type ActionTopic = (typeof ACTION_TOPICS)[number];

/** One "Do" precaution for a disease. The same precaution for several diseases shares topic + title wording. */
export interface BriefingAction {
  topic: ActionTopic;
  title: string;
  detail: string;
}

export interface RiskBriefing {
  risks: { id: string; meaning: string; actions: BriefingAction[] }[];
  model: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEVELS = new Set(["low", "moderate", "elevated", "unknown"]);
const TRENDS = new Set(["increasing", "stable", "decreasing", "unknown"]);
const clip = (v: unknown, n: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .slice(0, n);

const RESPONSE_FORMAT =
  "STRUCT<briefing:STRUCT<risks:ARRAY<STRUCT<id:STRING, meaning:STRING, actions:ARRAY<STRUCT<topic:STRING, title:STRING, detail:STRING>>>>>>";

const RULES =
  "Rules: do not invent numbers, dates, regions or diseases that are not in the facts. Do not change any activity level. Describe disease activity at the destination, not personal medical risk. Never diagnose; where vaccines or medication are relevant, say to check with a doctor or travel clinic. Be calm and factual, not alarming.";

function intro(d: BriefingRequest): string {
  const facts = d.diseases
    .map(
      (x) =>
        `- id=${x.id} | ${x.name} | activity level for the trip: ${x.level} | trend: ${x.trend}` +
        (x.latestCases != null
          ? ` | latest reported cases: ${x.latestCases} (${x.reportingPeriod})`
          : "") +
        ` | how the level is measured: ${x.description}`,
    )
    .join("\n");
  return `You are a travel health assistant writing for an ordinary traveller (not a clinician).
Trip: ${d.country}, ${d.depart} to ${d.ret}.

Surveillance facts for this destination (the ONLY facts you may use):
${facts}`;
}

/** Headline + summary, as plain text so it can be shown while it streams. */
function explanationPrompt(d: BriefingRequest): string {
  return `${intro(d)}

Write a short briefing as plain text (no markdown, no labels, no quotes):
- First line: the headline, one sentence (max 14 words) naming the biggest concern(s) for this trip, or saying activity is generally low.
- Then one blank line.
- Then the summary: 2-3 short sentences on what this means for these travel dates: which diseases matter most and why (level, trend, case counts if given), and the single most important thing to prepare. No filler about data sources or measurement methods.

${RULES}`;
}

/** Per-disease meaning + actions, as JSON. */
function risksPrompt(d: BriefingRequest): string {
  return `${intro(d)}

Write JSON:
- risks: one entry per disease above, using its exact id, ordered most to least concerning. "meaning" = one plain sentence on what the level means for this traveller. "actions" = 1 to 3 concrete, practical precautions for this disease, most important first (e.g. insect repellent, check vaccination status, food and water hygiene, hand hygiene). Each action has:
  - topic: exactly one of ${ACTION_TOPICS.join(", ")}
  - title: a short imperative phrase, max 6 words (e.g. "Use insect repellent")
  - detail: one plain sentence explaining it for this trip
  When the same precaution applies to several diseases, repeat it for each of them with the same topic and the same title wording.

${RULES}`;
}

function validate(d: BriefingRequest): BriefingRequest {
  if (!ISO_DATE.test(d.depart) || !ISO_DATE.test(d.ret))
    throw new Error("dates must be YYYY-MM-DD");
  if (!Array.isArray(d.diseases) || d.diseases.length === 0)
    throw new Error("no diseases to brief");
  return {
    country: clip(d.country, 80),
    depart: d.depart,
    ret: d.ret,
    diseases: d.diseases.slice(0, 12).map((x) => ({
      id: clip(x.id, 40),
      name: clip(x.name, 40),
      level: (LEVELS.has(x.level) ? x.level : "unknown") as ActivityLevel,
      trend: (TRENDS.has(x.trend) ? x.trend : "unknown") as Trend,
      latestCases: Number.isFinite(x.latestCases) ? Math.round(Number(x.latestCases)) : null,
      reportingPeriod: clip(x.reportingPeriod, 20),
      description: clip(x.description, 200),
    })),
  };
}

/** Streams the Overview's headline, a blank line, then the summary (split with splitExplanation). */
export const streamBriefExplanation = createServerFn({ method: "POST" })
  .inputValidator(validate)
  .handler(async ({ data }): Promise<ReadableStream<string>> => {
    const { streamChat } = await import("@/server/databricks.server");
    return streamChat(BRIEFING_MODEL, [{ role: "user", content: explanationPrompt(data) }], {
      maxTokens: 220,
    });
  });

export const getRiskBriefing = createServerFn({ method: "POST" })
  .inputValidator(validate)
  .handler(async ({ data }): Promise<RiskBriefing> => {
    const { query } = await import("@/server/databricks.server");
    const rows = await query<{ out: string | null }>(
      `SELECT ai_query('${BRIEFING_MODEL}', :prompt, responseFormat => '${RESPONSE_FORMAT}') AS out`,
      [{ name: "prompt", value: risksPrompt(data) }],
    );
    const raw = rows[0]?.out;
    if (!raw) throw new Error("AI briefing returned no output");
    const parsed = JSON.parse(raw) as Partial<RiskBriefing> & { briefing?: Partial<RiskBriefing> };
    const b = parsed.briefing ?? parsed;
    const ids = new Set(data.diseases.map((x) => x.id));
    return {
      risks: (b.risks ?? [])
        .filter((r) => r && ids.has(r.id))
        .map((r) => ({
          id: r.id,
          meaning: clip(r.meaning, 300),
          actions: (Array.isArray(r.actions) ? r.actions : [])
            .filter((a) => a && a.title)
            .slice(0, 3)
            .map((a) => ({
              topic: (ACTION_TOPICS as readonly string[]).includes(a.topic) ? a.topic : "other",
              title: clip(a.title, 80),
              detail: clip(a.detail, 300),
            })),
        })),
      model: BRIEFING_MODEL,
    };
  });
