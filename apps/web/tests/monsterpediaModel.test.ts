import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import type { MonsterpediaProfileView } from "../src/world/monsterpediaModel.js";
import {
  buildMonsterpediaCategory,
  canSatisfyCombineRecipe,
  combineIngredientCandidates,
  completeListPageStart,
  formatMonsterpediaText,
  monsterpediaCompletionPercent,
  monsterpediaEntriesPerPage,
  monsterpediaInspectionLevel,
  monsterpediaIngredientVisualState,
  monsterpediaPageCount,
} from "../src/world/monsterpediaModel.js";

const gd = loadGameData();

function profile(options: {
  levels?: Readonly<Record<string, number>>;
  recipes?: readonly string[];
  spiritXp?: Readonly<Record<string, number>>;
} = {}): MonsterpediaProfileView {
  const levels = options.levels ?? { FireCub: 7, SnowCub: 3 };
  const recipes = new Set(options.recipes ?? ["Carnoraptor"]);
  return {
    highestRegisteredLevel: (shortType) => levels[shortType] ?? 0,
    hasCombineRecipe: (shortType) => recipes.has(shortType),
    hasTutorialFlag: () => false,
    claimTutorialFlag: () => false,
    spiritSnapshot: () => ({
      spirits: Object.entries(options.spiritXp ?? {}).map(([shortType, savedXp]) => ({
        shortType,
        savedXp,
      })),
    }),
  };
}

describe("MonsterpediaBookData projection", () => {
  it("applies NSString width and escaped-percent formatting", () => {
    expect(formatMonsterpediaText("Found %d%%", 8)).toBe("Found 8%");
    expect(formatMonsterpediaText("Pg %d/%d", 1, 28)).toBe("Pg 1/28");
    expect(formatMonsterpediaText("%3d)%@", 7, "Cub")).toBe("  7)Cub");
    expect(() => formatMonsterpediaText("%d/%d", 1)).toThrow(/missing argument/);
  });

  it("projects source evolution-chain groups and keeps Complete List flat/index-sorted", () => {
    const p = profile();
    const mine = buildMonsterpediaCategory(gd, p, 0);
    expect(mine).toHaveLength(2);
    expect(mine.map((entry) => entry.monster.shortType)).toEqual(["SnowCub", "FireCub"]);
    expect(
      mine.find((entry) => entry.monster.shortType === "FireCub")?.chain.map(
        (monster) => monster.shortType,
      ),
    ).toEqual(["FireCub"]);
    expect(buildMonsterpediaCategory(gd, p, 1)).toHaveLength(12);
    expect(buildMonsterpediaCategory(gd, p, 2)).toHaveLength(23);
    expect(buildMonsterpediaCategory(gd, p, 3)).toHaveLength(4);
    expect(buildMonsterpediaCategory(gd, p, 4)).toHaveLength(4);
    const complete = buildMonsterpediaCategory(gd, p, 5);
    expect(complete).toHaveLength(224);
    expect(complete.map((entry) => entry.monster.index)).toEqual(
      [...complete].map((entry) => entry.monster.index).sort((a, b) => a - b),
    );
  });

  it("renders every card with the shared GameData book ordinal, never the authored key", () => {
    // The projection itself is owned and anchored by @dib/gamedata (`buildMonsterBookIndex`).
    const p = profile({ levels: { Slime: 4, Shenron: 1 } });
    const complete = buildMonsterpediaCategory(gd, p, 5);
    for (const entry of complete) {
      expect(entry.ordinal).toBe(gd.monsterBookIndex(entry.monster.shortType));
    }
    expect(complete.find((entry) => entry.monster.shortType === "Slime")?.ordinal).toBe(45);
    for (const category of [0, 1, 2, 3, 4] as const) {
      for (const entry of buildMonsterpediaCategory(gd, p, category)) {
        expect(entry.ordinal).toBe(gd.monsterBookIndex(entry.monster.shortType));
      }
    }
  });

  it("uses four recipes per page and six entries for every ordinary category", () => {
    expect(monsterpediaEntriesPerPage(2)).toBe(4);
    for (const category of [0, 1, 3, 4, 5] as const) {
      expect(monsterpediaEntriesPerPage(category)).toBe(6);
    }
    expect(monsterpediaPageCount(23, 2)).toBe(6);
    expect(monsterpediaPageCount(2, 0)).toBe(1);
  });

  it("derives Summon visibility from nonzero saved spirit XP", () => {
    const summon = gd.allMonsters().find((monster) => monster.category === "Summon");
    expect(summon).toBeDefined();
    const hidden = buildMonsterpediaCategory(
      gd,
      profile({ spiritXp: { [summon!.shortType]: 0 } }),
      1,
    ).find((candidate) => candidate.monster.shortType === summon!.shortType);
    expect(hidden).toMatchObject({ known: false });
    expect(hidden!.highestLevel).toBeGreaterThanOrEqual(1);
    const tierZeroProfile = profile({ spiritXp: { [summon!.shortType]: 0 } });
    expect(monsterpediaInspectionLevel(hidden!.monster, tierZeroProfile)).toBeUndefined();
    const hiddenCompleteEntry = buildMonsterpediaCategory(
      gd,
      tierZeroProfile,
      5,
    ).find((candidate) => candidate.monster.shortType === summon!.shortType);
    expect(hiddenCompleteEntry).toMatchObject({ known: false });
    expect(monsterpediaInspectionLevel(hiddenCompleteEntry!.monster, tierZeroProfile))
      .toBeUndefined();
    const ownedProfile = profile({ spiritXp: { [summon!.shortType]: 1 } });
    const visible = buildMonsterpediaCategory(
      gd,
      ownedProfile,
      1,
    ).find((candidate) => candidate.monster.shortType === summon!.shortType);
    expect(visible).toMatchObject({ known: true });
    expect(visible!.highestLevel).toBeGreaterThan(0);
    expect(monsterpediaInspectionLevel(visible!.monster, ownedProfile)).toBe(visible!.highestLevel);
  });

  it("trims unseen tails, selects the last found member, and separates recipes from discovery", () => {
    const evolved = buildMonsterpediaCategory(
      gd,
      profile({ levels: { FireCub: 7, FireTiger: 12 } }),
      0,
    );
    expect(evolved).toHaveLength(1);
    expect(evolved[0]).toMatchObject({
      monster: { shortType: "FireTiger" },
      known: true,
      highestLevel: 12,
    });
    expect(evolved[0]!.chain.map((monster) => monster.shortType)).toEqual([
      "FireCub",
      "FireTiger",
    ]);

    const p = profile();
    const normal = buildMonsterpediaCategory(gd, p, 0);
    expect(normal.find((entry) => entry.monster.shortType === "FireCub")).toMatchObject({
      known: true,
      highestLevel: 7,
    });
    expect(monsterpediaCompletionPercent(1, 6)).toBe(17);
    const recipes = buildMonsterpediaCategory(gd, p, 2);
    expect(recipes.find((entry) => entry.monster.shortType === "Carnoraptor")).toMatchObject({
      kind: "recipe",
      known: false,
      recipeKnown: true,
      highestLevel: 0,
      recipe: { ingredients: ["Bitewing", "Wolf"] },
    });
  });

  it("matches every authored recipe to the category-2 root/index pass", () => {
    const projected = buildMonsterpediaCategory(gd, profile(), 2);
    expect(
      projected.map((entry) => entry.monster.shortType),
    ).toEqual(gd.allCombineRecipes().map((recipe) => recipe.resultShortType));
    expect(projected.map((entry) => entry.monster.index)).toEqual(
      [...projected].map((entry) => entry.monster.index).sort((left, right) => left - right),
    );
  });

  it("keeps a descendant-discovered recipe card separate from root inspection ownership", () => {
    const recipe = gd.allCombineRecipes().find(
      (candidate) => gd.evolveChainOf(candidate.resultShortType).length > 1,
    );
    expect(recipe).toBeDefined();
    const chain = gd.evolveChainOf(recipe!.resultShortType);
    const descendant = chain[1]!;
    const descendantProfile = profile({
      levels: { [descendant]: 9 },
      recipes: [recipe!.resultShortType],
    });
    const entry = buildMonsterpediaCategory(gd, descendantProfile, 2).find(
      (candidate) => candidate.monster.shortType === recipe!.resultShortType,
    );
    expect(entry).toMatchObject({
      kind: "recipe",
      monster: { shortType: recipe!.resultShortType },
      known: true,
      highestLevel: 0,
    });
    expect(monsterpediaInspectionLevel(entry!.monster, descendantProfile)).toBeUndefined();
  });
});

describe("Monsterpedia combine ingredient identity", () => {
  const wolfGod = gd.combineRecipe("WolfGod");
  const bench = [
    { instanceId: "thunder-1", shortType: "ThunderWolf" },
    { instanceId: "thunder-2", shortType: "ThunderWolf" },
    { instanceId: "other", shortType: "FireCub" },
  ];

  it("requires two distinct objects for the sole same-species shipped recipe", () => {
    expect(wolfGod.ingredients).toEqual(["ThunderWolf", "ThunderWolf"]);
    expect(canSatisfyCombineRecipe(bench, wolfGod)).toBe(true);
    expect(canSatisfyCombineRecipe(bench.slice(0, 1), wolfGod)).toBe(false);
    expect(combineIngredientCandidates(bench, "ThunderWolf", new Set(["thunder-1"]))).toEqual([
      "thunder-2",
    ]);
  });

  it("keeps explicitly unlocked tier-zero Fate visible at the positive-XP sentinel", () => {
    const fate = gd.monsterByShortType("Fate");
    const fateProfile = profile({ spiritXp: { Fate: 1 } });
    const entry = buildMonsterpediaCategory(gd, fateProfile, 1)
      .find((candidate) => candidate.monster.shortType === "Fate");
    expect(entry).toMatchObject({ known: true, highestLevel: 23, ordinal: 195 });
    expect(monsterpediaInspectionLevel(fate, fateProfile)).toBe(23);
  });

  it("keeps recipe knowledge, persistent registration, and live ownership independent", () => {
    expect(monsterpediaIngredientVisualState(false, false, false)).toEqual({
      identity: "unknown",
      tint: "color",
      pulse: false,
    });
    expect(monsterpediaIngredientVisualState(true, false, false)).toEqual({
      identity: "known",
      tint: "black",
      pulse: false,
    });
    expect(monsterpediaIngredientVisualState(true, false, true)).toEqual({
      identity: "known",
      tint: "black",
      pulse: true,
    });
    expect(monsterpediaIngredientVisualState(true, true, false)).toEqual({
      identity: "known",
      tint: "color",
      pulse: false,
    });
    expect(monsterpediaIngredientVisualState(true, true, true)).toEqual({
      identity: "known",
      tint: "color",
      pulse: true,
    });
  });
});

describe("Monsterpedia Complete List selection", () => {
  it("moves by the idiom-specific page capacity and preserves the source backward-wrap quirk", () => {
    expect(completeListPageStart(0, 224, 22, 1)).toBe(22);
    expect(completeListPageStart(22, 224, 22, -1)).toBe(0);
    expect(completeListPageStart(0, 224, 22, -1)).toBe(198);
    expect(completeListPageStart(198, 224, 22, 1)).toBe(220);
    expect(completeListPageStart(220, 224, 22, 1)).toBe(0);

    expect(completeListPageStart(0, 224, 45, 1)).toBe(45);
    expect(completeListPageStart(0, 224, 45, -1)).toBe(135);
    expect(completeListPageStart(180, 224, 45, 1)).toBe(0);
  });
});
