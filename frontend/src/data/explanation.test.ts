import { describe, expect, it } from "vitest";
import { splitExplanation } from "./explanation";

describe("splitExplanation", () => {
  it("splits the headline line from the summary", () => {
    expect(
      splitExplanation("Dengue is the main concern\n\nDengue is elevated. Use repellent."),
    ).toEqual({
      headline: "Dengue is the main concern",
      summary: "Dengue is elevated. Use repellent.",
    });
  });

  it("treats partial text before the first line break as the headline", () => {
    expect(splitExplanation("Dengue is the")).toEqual({ headline: "Dengue is the", summary: "" });
    expect(splitExplanation("Dengue is the main concern\n")).toEqual({
      headline: "Dengue is the main concern",
      summary: "",
    });
  });

  it("drops labels, markdown and quotes the model may add", () => {
    expect(
      splitExplanation('**Headline: "Low activity for your trip"**\nSummary: All levels are low.'),
    ).toEqual({
      headline: "Low activity for your trip",
      summary: "All levels are low.",
    });
  });

  it("joins a summary that spans several lines", () => {
    expect(splitExplanation("Head\n\nOne.\nTwo.").summary).toBe("One. Two.");
  });
});
