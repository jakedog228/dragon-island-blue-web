import { describe, expect, it } from "vitest";
import { loadRawJson, resolveDataDir } from "../src/rawLoad.js";
import {
  completeSourceTutorialCatalog,
  loadSourceTutorialTopics,
  sourceTutorialTopic,
} from "../src/tutorials.js";
import type { DungeonResourceSource } from "../src/dungeon.js";

const source = (plot: unknown): DungeonResourceSource => ({
  has: (path) => path === "Plot.plist",
  plist: (path) => {
    if (path !== "Plot.plist") throw new Error(`unexpected resource ${path}`);
    return plot;
  },
});

describe("source tutorial catalog", () => {
  it("preserves every shipped Plot page chain in numbered menu order", () => {
    const plot = loadRawJson(resolveDataDir(), "Plot.json");
    const topics = loadSourceTutorialTopics(source(plot));
    expect(completeSourceTutorialCatalog(topics)).toBe(true);
    expect(topics.map(({ key }) => key)).toEqual([
      "Tutorial0", "Tutorial1", "Tutorial2", "Tutorial3", "Tutorial4",
      "Tutorial5", "Tutorial6", "Tutorial7", "Tutorial8",
    ]);
    expect(sourceTutorialTopic(topics, "Tutorial4")?.images).toEqual([
      "monsterChange1.png",
      "monsterChange2.png",
    ]);
    expect(sourceTutorialTopic(topics, "Tutorial5")?.images).toEqual([
      "soulStoneTutorial1.png",
      "soulStoneTutorial2.png",
      "soulStoneTutorial3.png",
    ]);
  });

  it("leaves unrelated independently-authored Plot keys outside the fixed source capability", () => {
    const topics = loadSourceTutorialTopics(source({
      TutorialBattle: {
        class: "PlotGameFlowEvent",
        continueButton: true,
        image: "tutorial_battle.png",
      },
    }));
    expect(topics).toEqual([]);
    expect(completeSourceTutorialCatalog(topics)).toBe(false);
  });

  it("fails loudly when a numbered source topic drifts from continue-page structure", () => {
    expect(() => loadSourceTutorialTopics(source({
      Tutorial4: {
        class: "PlotGameFlowEvent",
        continueButton: false,
        image: "monsterChange1.png",
      },
    }))).toThrow(/Tutorial4\.continueButton must be true/);
  });
});
