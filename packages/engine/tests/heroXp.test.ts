import { describe, expect, it } from "vitest";
import { heroLevelForXp, heroXpForLevel, heroXpPercent } from "../src/heroXp.js";

describe("HeroData saved highest-level XP", () => {
  it("round-trips exact source thresholds", () => {
    expect([1, 2, 5, 12].map(heroXpForLevel)).toEqual([0, 8, 68, 515]);
  });

  it("reaches a level only once its threshold is passed", () => {


    for (const level of [2, 12, 40]) {
      const threshold = heroXpForLevel(level);
      expect(heroLevelForXp(threshold - 1)).toBe(level - 1);
      expect(heroLevelForXp(threshold)).toBe(level - 1);
      expect(heroLevelForXp(threshold + 1)).toBe(level);
    }

    expect(heroLevelForXp(0)).toBe(1);
  });

  it("matches the boundary a real save records", () => {
    // savefile2.bak: collection total 8, stored lastSavedLevel 1, and xpForLevel(2) is exactly 8.
    expect(heroXpForLevel(2)).toBe(8);
    expect(heroLevelForXp(8)).toBe(1);
  });

  it("derives level changes from newly registered highest levels", () => {
    expect(heroLevelForXp(514)).toBe(11);
    expect(heroLevelForXp(515)).toBe(11);
    expect(heroLevelForXp(516)).toBe(12);
    expect(heroXpPercent(12, 567)).toBeCloseTo(0.5);
  });

  it("fills the bar completely on the threshold rather than rolling over", () => {
    const next = heroXpForLevel(13);
    expect(heroLevelForXp(next)).toBe(12);
    expect(heroXpPercent(12, next)).toBe(1);
  });
});
