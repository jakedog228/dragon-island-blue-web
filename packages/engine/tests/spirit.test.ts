import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import {
  HERO_SPIRIT_MAX_ENERGY,
  addSpiritEnergy,
  isSpiritEnergyFull,
  spiritCombatLevel,
  spiritEnergyGainForLevelRatio,
  spiritGradeForXp,
  spiritSavedXpForTierLevel,
  spiritSavedXpForUnlockedTierLevel,
  spiritTierLevelForXp,
} from "../src/spirit.js";

const gd = loadGameData();

describe("hero spirit progression", () => {
  it("pins every grade boundary from F- through S", () => {
    const boundaries = [
      [0, "F-"], [99, "F-"], [100, "F"], [399, "F"], [400, "F+"], [599, "F+"],
      [600, "E-"], [799, "E-"], [800, "E"], [999, "E"], [1000, "E+"], [1199, "E+"],
      [1200, "D-"], [1800, "C-"], [2400, "B-"], [3000, "A-"], [3400, "A+"],
      [3599, "A+"], [3600, "S"], [99999, "S"],
    ] as const;
    for (const [xp, grade] of boundaries) expect(spiritGradeForXp(xp)).toBe(grade);
  });

  it("round-trips every config tier through its minimum saved XP", () => {
    for (let tier = 0; tier < 19; tier++) {
      expect(spiritTierLevelForXp(spiritSavedXpForTierLevel(tier))).toBe(tier);
    }
    expect(() => spiritSavedXpForTierLevel(19)).toThrow(/0 to 18/);
    expect(spiritSavedXpForUnlockedTierLevel(0)).toBe(1);
    expect(spiritSavedXpForUnlockedTierLevel(1)).toBe(100);
  });

  it("converts summon bonus plus saved XP into the ordinary combat level", () => {
    expect(spiritCombatLevel(gd.monsterByShortType("Resistance"), 0)).toBe(12);
    expect(spiritCombatLevel(gd.monsterByShortType("Fire"), 0)).toBe(19);
    expect(spiritCombatLevel(gd.monsterByShortType("Divine"), 0)).toBe(94);
    expect(spiritCombatLevel(gd.monsterByShortType("Time"), 0)).toBe(100);
    expect(spiritCombatLevel(gd.monsterByShortType("Shenron"), 0)).toBe(100);
    expect(spiritCombatLevel(gd.monsterByShortType("Resistance"), 600)).toBe(18);
    expect(() => spiritCombatLevel(gd.monsterByShortType("FireCub"), 0)).toThrow(/not a summon spirit/);
  });
});

describe("hero spirit readiness", () => {
  it("adds trunc(10*ratio), clamped to 1..10", () => {
    expect(spiritEnergyGainForLevelRatio(0)).toBe(1);
    expect(spiritEnergyGainForLevelRatio(0.19)).toBe(1);
    expect(spiritEnergyGainForLevelRatio(0.2)).toBe(2);
    expect(spiritEnergyGainForLevelRatio(0.99)).toBe(9);
    expect(spiritEnergyGainForLevelRatio(1)).toBe(10);
    expect(spiritEnergyGainForLevelRatio(8)).toBe(10);
  });

  it("saturates at the source max of 100", () => {
    expect(addSpiritEnergy(0, 1)).toBe(10);
    expect(addSpiritEnergy(96, 0.2)).toBe(98);
    expect(addSpiritEnergy(98, 1)).toBe(HERO_SPIRIT_MAX_ENERGY);
    expect(isSpiritEnergyFull(100 - 0.000001)).toBe(true);
    expect(isSpiritEnergyFull(100 - 0.0001)).toBe(false);
  });
});
