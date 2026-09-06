import { describe, expect, it } from "vitest";
import {
  formatAwardXp,
  jobCanLevelUp,
  jobLevelAfterAward,
  jobXpCostOfNextLevel,
  jobXpForLevel,
  monsterXpAward,
  xpAwardLayoutMetrics,
  xpAwardPerParticipant,
} from "../src/battle/postBattleMath.js";

describe("post-battle XP math", () => {
  it("reproduces Monster's 2.5-power award curve and receiver+10 cap", () => {
    expect(monsterXpAward(1, 2, 1)).toBe(51);
    expect(monsterXpAward(2, 2, 2)).toBe(82);
    expect(monsterXpAward(30, 2, 2)).toBe(monsterXpAward(12, 2, 2));
  });

  it("matches the Unicorn-emulation ground-truth anchors (xp-emulation-results.json)", () => {



    expect(monsterXpAward(1, 1, 1)).toBe(51);
    expect(monsterXpAward(2, 1, 2)).toBe(80);
    expect(monsterXpAward(5, 2, 5)).toBe(413);
    expect(monsterXpAward(12, 2.5, 12)).toBe(3412);
    expect(monsterXpAward(20, 3, 20)).toBe(12_388);
    expect(monsterXpAward(50, 2.5, 50)).toBe(52_377); // pow-base clamp 20 + 1.05^30 tail
    expect(monsterXpAward(100, 3, 50)).toBe(87_211); // receiver+10 cap -> awardLevel 60, 1.05^40
  });

  it("uses dead enemies, the participant mean, and ceil division", () => {
    const defeated = [2, 2.5, 4, 3, 3, 3.5].map((stars) => ({ level: 12, stars }));
    expect(xpAwardPerParticipant([12, 12, 12], defeated)).toBe(6973);
    expect(xpAwardPerParticipant([1], [{ level: 1, stars: 2, noReward: true }])).toBe(0);
  });

  it("regresses the level-12 to level-112 post-battle blowup", () => {
    const defeated = [2, 2.5, 4, 3, 3, 3.5].map((stars) => ({ level: 12, stars }));
    const award = xpAwardPerParticipant([12, 12, 12], defeated);
    const cumulativeXp = jobXpForLevel(12, 1) + award;

    expect(award).toBe(6973);
    expect(cumulativeXp).toBeLessThan(jobXpForLevel(13, 1));
    expect(jobLevelAfterAward(12, cumulativeXp, 1)).toBe(12);
  });

  it("reproduces Job's cumulative level curve and next-level delta", () => {
    expect(jobXpForLevel(1, 1)).toBe(0);
    expect(jobXpForLevel(2, 1)).toBe(100);
    expect(jobXpForLevel(12, 1)).toBe(34_811);
    expect(jobXpCostOfNextLevel(12, 1)).toBe(14_797);
  });

  it("models canLevelUp's 149 cap and cumulative-xp threshold (@ 0x80780)", () => {
    expect(jobCanLevelUp(1, 100, 1)).toBe(true); // exactly at xpForLevel(2)
    expect(jobCanLevelUp(1, 99, 1)).toBe(false);
    expect(jobCanLevelUp(150, Number.MAX_SAFE_INTEGER, 1)).toBe(false); // level <= 149 gate
    expect(jobCanLevelUp(149, Number.MAX_SAFE_INTEGER, 1)).toBe(true);
  });

  it("runs the outer while(canLevelUp) loop to the exact cumulative boundary", () => {
    // Battle Jobs spawn at their boundary: cumulative = xpForLevel(start) + award.
    expect(jobLevelAfterAward(2, jobXpForLevel(12, 1), 1)).toBe(12); // exactly at level 12's threshold
    expect(jobLevelAfterAward(2, jobXpForLevel(12, 1) - 1, 1)).toBe(11);
    expect(jobLevelAfterAward(5, jobXpForLevel(5, 1), 1)).toBe(5); // zero award = no level-up
    expect(jobLevelAfterAward(1, Number.MAX_SAFE_INTEGER, 1)).toBe(150); // cap
  });

  it("formats the shipped AwardXPKey and fails on schema drift", () => {
    expect(formatAwardXp("Your monsters have earned %d XP!", 51)).toBe(
      "Your monsters have earned 51 XP!",
    );
    expect(() => formatAwardXp("missing", 51)).toThrow(/%d/);
  });
});

describe("post-battle XP layout", () => {
  it("uses the source two-column phone layout through twelve entries", () => {





    expect(xpAwardLayoutMetrics(3, 480, 320, "iphone")).toEqual({
      columns: 2,
      rows: 2,
      cellWidth: 163.5,
      cellHeight: 95,
      barMaxWidth: 50,
      itemGap: 2,
      boxGap: 5,
      headingFontSize: 16,
      gridShiftX: 20,
    });
    expect(xpAwardLayoutMetrics(12, 480, 320, "iphone").columns).toBe(2);
    expect(xpAwardLayoutMetrics(12, 480, 320, "iphone").cellWidth).toBeCloseTo(163.5);
    expect(xpAwardLayoutMetrics(12, 480, 320, "iphone").cellHeight).toBeCloseTo(30.333333);
  });

  it("still splits a single participant across two columns, leaving one empty", () => {
    // A brand-new save fights its first battle with ONE party monster. `sub_65ae0` appends every
    // column array before it reads the item count, so the split is `[[entry], []]` and the grid
    // Box carries a real (empty) second column — the same shape the spirit menu shows for one
    // captured spirit. The column count is NOT reduced to fit, so the cell/bar budget is the
    // two-column one and the card keeps the empty column's width and gap.
    expect(xpAwardLayoutMetrics(1, 480, 320, "iphone")).toEqual({
      columns: 2,
      rows: 1,
      cellWidth: 163.5,
      cellHeight: 192,
      barMaxWidth: 50,
      itemGap: 2,
      boxGap: 5,
      headingFontSize: 16,
      gridShiftX: 20,
    });
  });

  it("switches to three columns above twelve entries and re-splits the same width budget", () => {
    const metrics = xpAwardLayoutMetrics(13, 480, 320, "iphone");
    expect(metrics.columns).toBe(3);
    expect(metrics.rows).toBe(5);
    // (432 - 3*(100/3) - 5*2) / 3
    expect(metrics.cellWidth).toBeCloseTo(107.333333);
    expect(metrics.cellHeight).toBeCloseTo(36.8);
    expect(metrics.barMaxWidth).toBeCloseTo(100 / 3);
  });

  it("keeps the 5/10 width reservation distinct from Box.init's bare 5pt gap on iPad", () => {
    // The two facts coincide at 5 on iPhone and diverge natively (10 vs 5), so they normalize to
    // 5 and 2.5 here. Encoding them as one variable is exactly the conflation this asserts against.
    const metrics = xpAwardLayoutMetrics(3, 512, 384, "ipad");
    expect(metrics.itemGap).toBe(1);
    expect(metrics.boxGap).toBe(2.5);
    expect(metrics.headingFontSize).toBe(12);
    expect(metrics.barMaxWidth).toBe(50);
    // (512*0.9 - 100 - 5*(2-1)) / 2 — the reservation term is 5, NOT boxGap's 2.5.
    expect(metrics.cellWidth).toBeCloseTo(177.9);
    expect(metrics.cellHeight).toBeCloseTo(114.7);

    const thirteen = xpAwardLayoutMetrics(13, 512, 384, "ipad");
    expect(thirteen.cellWidth).toBeCloseTo(116.933333);
    expect(thirteen.cellHeight).toBeCloseTo(45.28);
  });

  it("splits the whole 0.9 width band across cells, bars and reservations", () => {
    for (const [count, w, h, mode] of [
      [3, 480, 320, "iphone"],
      [13, 480, 320, "iphone"],
      [3, 512, 384, "ipad"],
      [13, 512, 384, "ipad"],
    ] as const) {
      const m = xpAwardLayoutMetrics(count, w, h, mode);
      // idiom(5,10) normalizes to 5 in BOTH modes (5/1 and 10/2) — unlike boxGap's bare 5.
      const reservation = 5;
      expect(
        m.columns * m.cellWidth + m.columns * m.barMaxWidth + (m.columns - 1) * reservation,
      ).toBeCloseTo(w * 0.9);
    }
  });
});
