// Splits the streamed Brief Explanation (streamBriefExplanation: headline line, blank line, summary) into its two
// parts. Works on partial text while it streams: until the first line break everything is the headline.

export interface Explanation {
  headline: string;
  summary: string;
}

// Models sometimes add a label or markdown despite the prompt; drop it so it never shows.
const tidy = (s: string) =>
  s
    .replace(/^\s*(#+\s*|\*\*|__)/, "")
    .replace(/(\*\*|__)\s*$/, "")
    .replace(/^\s*(headline|summary)\s*:\s*/i, "")
    .replace(/^["“]|["”]$/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function splitExplanation(text: string): Explanation {
  const body = text.replace(/^\s+/, "");
  const nl = body.indexOf("\n");
  if (nl === -1) return { headline: tidy(body), summary: "" };
  return { headline: tidy(body.slice(0, nl)), summary: tidy(body.slice(nl + 1)) };
}
