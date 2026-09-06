import { describe, expect, it } from "vitest";
import {
  jobCanLevelUp,
  jobLevelAfterAward,
  jobXpCostOfNextLevel,
  jobXpForLevel,
  monsterXpAward,
  xpAwardPerParticipant,
} from "../src/xp.js";

describe("source-faithful Monster XP rewards", () => {
  it("matches real-ARM anchors across both high-level tails and star factors", () => {
    const expected: Record<number, readonly number[]> = {
      43: [34_751, 36_400, 37_223, 38_049, 39_696],
      53: [56_605, 59_292, 60_633, 61_979, 64_661],
      59: [75_857, 79_457, 81_254, 83_058, 86_652],
      70: [129_741, 135_899, 138_973, 142_057, 148_204],
      71: [415_904, 441_802, 454_931, 468_098, 494_840],
      100: [459_113, 488_256, 503_042, 517_877, 548_038],
    };
    const stars = [1, 2, 2.5, 3, 4];
    for (const [levelText, awards] of Object.entries(expected)) {
      const level = Number(levelText);
      expect(stars.map((rarity) => monsterXpAward(level, rarity, level))).toEqual(awards);
    }
  });

  it("applies the receiver+10 cap before selecting a tail", () => {
    expect(monsterXpAward(100, 2, 33)).toBe(36_400); // effective level 43
    expect(monsterXpAward(100, 2, 61)).toBe(441_802); // effective level 71
    expect(monsterXpAward(30, 2, 2)).toBe(monsterXpAward(12, 2, 2));
  });
});

describe("source-faithful BattleNode XP aggregation", () => {
  it("covers both >20 ratio branches with float32 averaging and final ceilf division", () => {
    expect(xpAwardPerParticipant([40, 46], [{ level: 53, stars: 2 }])).toBe(36_541);
    expect(xpAwardPerParticipant([50, 50], [{ level: 43, stars: 2 }])).toBe(14_847);
  });

  it("skips noReward enemies and applies the breeder multiplier before division", () => {
    const twoMembers = [43, 43];
    const twoEnemies = [
      { level: 53, stars: 2 },
      { level: 43, stars: 1 },
    ];
    expect(xpAwardPerParticipant(twoMembers, twoEnemies)).toBe(53_916);
    expect(xpAwardPerParticipant(twoMembers, twoEnemies, 1.5)).toBe(80_874);
    expect(xpAwardPerParticipant(twoMembers, twoEnemies, 1.1)).toBe(59_308);

    expect(
      xpAwardPerParticipant(
        [40, 43, 46],
        [
          { level: 53, stars: 2.5 },
          { level: 43, stars: 3 },
          { level: 59, stars: 1, noReward: true },
        ],
        1.1,
      ),
    ).toBe(41_354);
    expect(xpAwardPerParticipant([1], [{ level: 1, stars: 2, noReward: true }])).toBe(0);
  });

  it("fails loudly for impossible aggregation inputs", () => {
    expect(() => xpAwardPerParticipant([], [])).toThrow(/at least one participating/);
    expect(() => xpAwardPerParticipant([1], [], Number.NaN)).toThrow(/breeder XP bonus/);
    expect(() => xpAwardPerParticipant([1], [], -1)).toThrow(/breeder XP bonus/);
  });
});

describe("source-faithful Job cumulative XP curve", () => {
  it("matches the full-ARM curve at low, tail, and cap-adjacent levels", () => {
    expect(jobXpForLevel(1, 1)).toBe(0);
    expect(jobXpForLevel(2, 1)).toBe(100);
    expect(jobXpForLevel(12, 1)).toBe(34_811);
    expect(jobXpForLevel(20, 1)).toBe(313_017);
    expect(jobXpForLevel(21, 1)).toBe(378_750);
    expect(jobXpForLevel(70, 1)).toBe(19_397_778);
    expect(jobXpForLevel(71, 1)).toBe(20_608_596);
    expect(jobXpForLevel(100, 1)).toBe(115_122_762);
    expect(jobXpForLevel(149, 1)).toBe(2_013_357_038);
  });

  it("narrows xpPenalty through the source float32 input ABI", () => {
    expect(jobXpForLevel(20, 1.5)).toBe(469_526);
    expect(jobXpForLevel(70, 1.5)).toBe(29_096_698);
    expect(jobXpForLevel(149, 1.5)).toBe(3_020_038_773);
    expect(jobXpForLevel(20, 1.25)).toBe(391_272);
  });

  it("derives next-level cost and repeated level-ups from cumulative thresholds", () => {
    expect(jobXpCostOfNextLevel(12, 1)).toBe(14_797);
    expect(jobCanLevelUp(1, 100, 1)).toBe(true);
    expect(jobCanLevelUp(1, 99, 1)).toBe(false);
    expect(jobLevelAfterAward(2, jobXpForLevel(12, 1), 1)).toBe(12);
    expect(jobLevelAfterAward(2, jobXpForLevel(12, 1) - 1, 1)).toBe(11);
    expect(jobLevelAfterAward(1, Number.MAX_SAFE_INTEGER, 1)).toBe(150);
  });
});
