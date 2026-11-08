import { describe, expect, it } from "vitest";
import { buildPreparations, notableDiseases, MAX_PREPARATIONS } from "./preparations";
import type { BriefingAction, RiskBriefing } from "./briefing.functions";
import type { ActivityLevel, Disease } from "./types";

const disease = (id: string, activityLevel: ActivityLevel): Disease => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  description: "",
  activityLevel,
  trend: "unknown",
  latestCases: null,
  reportingPeriod: "",
  source: "",
});
const act = (topic: BriefingAction["topic"], title: string): BriefingAction => ({
  topic,
  title,
  detail: `${title}.`,
});
const briefing = (risks: Record<string, BriefingAction[]>): RiskBriefing => ({
  model: "m",
  risks: Object.entries(risks).map(([id, actions]) => ({ id, meaning: "", actions })),
});

describe("notableDiseases", () => {
  it("keeps moderate and elevated only, elevated first, report order within a level", () => {
    const ds = [
      disease("flu", "low"),
      disease("malaria", "moderate"),
      disease("typhoid", "moderate"),
      disease("dengue", "elevated"),
      disease("x", "unknown"),
    ];
    expect(notableDiseases(ds).map((d) => d.id)).toEqual(["dengue", "malaria", "typhoid"]);
  });
});

describe("buildPreparations", () => {
  const ds = [disease("malaria", "moderate"), disease("dengue", "elevated"), disease("flu", "low")];

  it("merges the same advice across diseases and tags both", () => {
    const out = buildPreparations(
      ds,
      briefing({
        dengue: [act("mosquito_bites", "Use insect repellent")],
        malaria: [
          act("mosquito_bites", "Use insect repellents"),
          act("medication", "Ask about antimalarial medication"),
        ],
        flu: [act("vaccination", "Get a flu shot")],
      }),
    );
    expect(out.map((p) => p.title)).toEqual([
      "Use insect repellent",
      "Ask about antimalarial medication",
    ]);
    expect(out[0]!.diseases.map((d) => d.name)).toEqual(["Dengue", "Malaria"]);
  });

  it("merges close rewordings within a topic", () => {
    const out = buildPreparations(
      ds,
      briefing({
        dengue: [act("mosquito_bites", "Use insect repellent")],
        malaria: [act("mosquito_bites", "Apply insect repellent")],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.diseases.map((d) => d.id)).toEqual(["dengue", "malaria"]);
  });

  it("keeps different advice with the same topic apart", () => {
    const out = buildPreparations(
      ds,
      briefing({
        dengue: [
          act("mosquito_bites", "Use insect repellent"),
          act("mosquito_bites", "Wear long sleeves"),
        ],
      }),
    );
    expect(out).toHaveLength(2);
  });

  it("ignores low and unknown diseases and returns nothing when none are notable", () => {
    const out = buildPreparations(
      [disease("flu", "low")],
      briefing({ flu: [act("vaccination", "Get a flu shot")] }),
    );
    expect(out).toEqual([]);
  });

  it("caps the list and fills it from elevated diseases first", () => {
    const many = (p: string) =>
      Array.from({ length: 3 }, (_, i) => act("other", `${p} ${["boots", "hats", "maps"][i]}`));
    const out = buildPreparations(
      [disease("a", "moderate"), disease("b", "moderate"), disease("c", "elevated")],
      briefing({ a: many("alpha"), b: many("bravo"), c: many("charlie") }),
    );
    expect(out).toHaveLength(MAX_PREPARATIONS);
    expect(out.slice(0, 3).every((p) => p.diseases[0]!.id === "c")).toBe(true);
  });
});
