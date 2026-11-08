// Ranked, accent-insensitive destination search for the landing-page autocomplete.
//
// Ranking (higher first): exact name > exact alias/code > name starts with query > a word in the name starts
// with it > alias starts with it > a word in an alias starts with it > name contains it > alias contains it.
// Short codes ("VN", "VNM", "USA", "UK") only match exactly, so typing "v" doesn't list every country with a V code.

import type { Destination } from "@/data/destinations";

export interface SearchHit {
  destination: Destination;
  score: number;
  /** The alternate name that matched, when the match was not on the display name (e.g. "Viet Nam"). */
  matchedAlias: string | null;
}

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const isCode = (alias: string) => /^[A-Z]{2,3}$/.test(alias.replace(/\s/g, ""));

// Words in formal names ("Independent State of Papua New Guinea") that shouldn't trigger a word-start match.
const FORMAL_WORDS = new Set([
  "independent",
  "state",
  "states",
  "republic",
  "kingdom",
  "democratic",
  "people",
  "peoples",
  "federal",
  "federation",
  "federated",
  "islamic",
  "socialist",
  "commonwealth",
  "plurinational",
  "bolivarian",
  "of",
  "the",
  "and",
  "grand",
  "duchy",
  "principality",
  "union",
  "sultanate",
  "emirate",
  "co",
  "operative",
  "arab",
]);

function scoreText(text: string, q: string, isAlias: boolean): number {
  const t = normalize(text);
  if (!t) return 0;
  if (t === q) return isAlias ? 95 : 100;
  if (isAlias && isCode(text)) return 0; // codes: exact only
  // for alternate names, ignore formal words ("Independent State of …") in partial matches
  const words = t.split(" ").filter((w) => !(isAlias && FORMAL_WORDS.has(w)));
  if (words.join(" ").startsWith(q)) return isAlias ? 60 : 80;
  if (words.some((w) => w.startsWith(q))) return isAlias ? 50 : 70;
  if (q.length >= 3 && words.join(" ").includes(q)) return isAlias ? 30 : 40;
  return 0;
}

export function searchDestinations(
  list: readonly Destination[],
  query: string,
  limit = 8,
): SearchHit[] {
  const q = normalize(query);
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const d of list) {
    const nameScore = scoreText(d.name, q, false);
    let aliasScore = 0;
    let alias: string | null = null;
    for (const a of d.aliases) {
      const sc = scoreText(a, q, true);
      if (sc > aliasScore) {
        aliasScore = sc;
        alias = a;
      }
    }
    const best = Math.max(nameScore, aliasScore);
    // Only show which alternate name matched when the display name itself didn't match.
    const matchedAlias = nameScore >= 70 ? null : aliasScore > nameScore ? alias : null;
    if (best > 0) hits.push({ destination: d, score: best, matchedAlias });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.destination.name.length - b.destination.name.length ||
      a.destination.name.localeCompare(b.destination.name),
  );
  return hits.slice(0, limit);
}

/** Split a label around the first case-insensitive occurrence of the query, for highlighting. */
export function highlightParts(label: string, query: string): [string, string, string] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const i = label.toLowerCase().indexOf(q);
  return i < 0
    ? null
    : [label.slice(0, i), label.slice(i, i + q.length), label.slice(i + q.length)];
}
