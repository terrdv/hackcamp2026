// Builds the Prepare tab from the per-disease "Do" advice in the risk briefing (briefing.functions.ts).
// Pure functions only, so the merge rules are unit-tested (preparations.test.ts).
//
// Rules:
//   - Only diseases that are moderate or elevated for the trip contribute (same filter as Overview's risk list).
//   - Elevated diseases come first, then moderate; within a level the report's disease order is kept.
//   - Advice that repeats across diseases is shown once, tagged with every disease it applies to.
//   - At most MAX_PREPARATIONS items.

import type { BriefingAction, RiskBriefing } from "./briefing.functions";
import type { ActivityLevel, Disease } from "./types";

export const MAX_PREPARATIONS = 6;

const NOTABLE_RANK: Partial<Record<ActivityLevel, number>> = { elevated: 2, moderate: 1 };

export interface Preparation {
  key: string;
  title: string;
  detail: string;
  diseases: { id: string; name: string; level: ActivityLevel }[];
}

/** Moderate and elevated diseases, elevated first, report order kept within a level. */
export function notableDiseases(diseases: Disease[]): Disease[] {
  return diseases
    .map((d, i) => ({ d, i, r: NOTABLE_RANK[d.activityLevel] ?? 0 }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.d);
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "to",
  "your",
  "you",
  "for",
  "and",
  "or",
  "of",
  "on",
  "in",
  "with",
  "against",
  "before",
  "about",
  "get",
  "take",
  "use",
]);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/(ing|es|s)$/, "")) // crude stemming: "repellents" ~ "repellent"
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Same or very similar advice: identical wording, or the same topic with mostly overlapping title words. */
export function isSameAdvice(a: BriefingAction, b: BriefingAction): boolean {
  const wa = words(a.title);
  const wb = words(b.title);
  if ([...wa].join(" ") === [...wb].join(" ")) return true;
  if (a.topic !== b.topic) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 && shared / union >= 0.5; // "Use insect repellent" ~ "Apply insect repellent"
}

export function buildPreparations(diseases: Disease[], briefing: RiskBriefing): Preparation[] {
  const actionsById = new Map(briefing.risks.map((r) => [r.id, r.actions]));
  const items: (Preparation & { action: BriefingAction })[] = [];
  for (const d of notableDiseases(diseases)) {
    for (const action of actionsById.get(d.id) ?? []) {
      const tag = { id: d.id, name: d.name, level: d.activityLevel };
      const match = items.find((it) => isSameAdvice(it.action, action));
      if (match) {
        if (!match.diseases.some((x) => x.id === d.id)) match.diseases.push(tag);
      } else {
        items.push({
          key: `${d.id}:${items.length}`,
          title: action.title,
          detail: action.detail,
          diseases: [tag],
          action,
        });
      }
    }
  }
  return items.slice(0, MAX_PREPARATIONS).map(({ action: _action, ...p }) => p);
}
