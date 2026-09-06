import { describe, expect, it } from "vitest";
import type { MonsterDef } from "@dib/gamedata";
import { baseStat } from "@dib/engine";
import { levelUpPages, statBonusPage } from "../src/battle/levelUpText.js";

// Minimal shipped-shape strings (values verbatim from extracted/data/LocalizableStrings.json).
const strings = {
  MonsterLevelUpKey: "Monsters Have Leveled Up!",
  LevelUpTextKey: "%@ is now level %d!",
  LearnAbilityTextKey: "Learned %@",
  StatMaxHPInfoTitleKey: "Max HP",
  StatAttackInfoTitleKey: "Attack",
  StatMagicInfoTitleKey: "Magic",
  StatSpeedInfoTitleKey: "Speed",
  StatDefenseInfoTitleKey: "Defense",
  StatResistInfoTitleKey: "Resist",
} as const;

const monster: MonsterDef = {
  path: "Test.Sparkeon",
  shortType: "Sparkeon",
  category: "Normal",
  element: "Fire",
  index: 1,
  quality: 1,
  eggUnlockQuality: 1, // loader-materialized native default (omitted key copies `quality`)
  stars: 2,
  rootStats: { Attack: 6, Defense: 4, Magic: 3, MaxHP: 20, Resist: 2, Speed: 5 },
  unarmedAttackType: "Bite",
};

describe("statBonusPage (outputTextFromIncreasingLevel step 2)", () => {
  it("lists every changed stat as '+N Name' joined with ', ' in stat-index order 0..5", () => {
    const page = statBonusPage(strings, monster, 5, 6);
    expect(page).not.toBeNull();
    const expected = (["MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist"] as const)
      .map((stat) => ({ stat, delta: baseStat(monster, stat, 6) - baseStat(monster, stat, 5) }))
      .filter(({ delta }) => delta !== 0)
      .map(({ stat, delta }) => `+${delta} ${strings[`Stat${stat}InfoTitleKey`]}`)
      .join(", ");
    expect(page).toBe(expected);
    // Every rootStat here is >= 1, so per-level growth always moves every stat.
    expect(page).toContain("Max HP");
    expect(page).toContain("Resist");
  });

  it("returns null when no cached stat value changes", () => {
    // Level clamp: 150 -> 151 is the same effective level, so all six stats are unchanged.
    expect(statBonusPage(strings, monster, 150, 151)).toBeNull();
  });
});

describe("levelUpPages (performAwardLogic's flattened page queue)", () => {
  it("returns [] when nothing leveled (no header page)", () => {
    expect(
      levelUpPages(strings, [
        { monster, displayName: "Sparkeon", startLevel: 5, endLevel: 5 },
      ]),
    ).toEqual([]);
  });

  it("prepends the MonsterLevelUpKey header and emits per-level pages with the NEW level", () => {
    const pages = levelUpPages(strings, [
      { monster, displayName: "Sparkeon", startLevel: 5, endLevel: 7 },
    ]);
    expect(pages[0]).toBe("Monsters Have Leveled Up!");
    expect(pages[1]).toBe("Sparkeon is now level 6!");
    expect(pages[2]).toBe(statBonusPage(strings, monster, 5, 6));
    expect(pages[3]).toBe("Sparkeon is now level 7!");
    expect(pages[4]).toBe(statBonusPage(strings, monster, 6, 7));
    expect(pages).toHaveLength(5);
  });

  it("flattens multiple monsters into ONE queue in entry order (not one popup each)", () => {
    const pages = levelUpPages(strings, [
      { monster, displayName: "Sparkeon", startLevel: 5, endLevel: 6 },
      { monster, displayName: "Mossy Turt", startLevel: 3, endLevel: 4 },
    ]);
    expect(pages[0]).toBe("Monsters Have Leveled Up!");
    expect(pages[1]).toBe("Sparkeon is now level 6!");
    expect(pages[3]).toBe("Mossy Turt is now level 4!");
  });

  it("emits one 'Learned %@' page per ability newly present after the level step", () => {
    const abilityNamesAtLevel = (level: number): readonly string[] =>
      level >= 6 ? ["Bite", "Thunder Claw"] : ["Bite"];
    const pages = levelUpPages(strings, [
      { monster, displayName: "Sparkeon", startLevel: 5, endLevel: 6, abilityNamesAtLevel },
    ]);
    expect(pages).toContain("Learned Thunder Claw");
    expect(pages.filter((p) => p.startsWith("Learned"))).toHaveLength(1);
  });

  it("fails loud on a level regression", () => {
    expect(() =>
      levelUpPages(strings, [{ monster, displayName: "X", startLevel: 5, endLevel: 4 }]),
    ).toThrow(/lost levels/);
  });
});
