import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { BattleCore } from "../src/core.js";
import { battleLivingId, type TeamMemberSetup } from "../src/events.js";
import { mulberry32 } from "../src/rng.js";

const gd = loadGameData();

function coreWith(player: TeamMemberSetup): BattleCore {
  return new BattleCore(
    gd,
    [[player], [{ shortType: "SnowCub", level: 10 }]],
    mulberry32(7),
    { fightingGroupSize: 1 },
  );
}

describe("fixed-encounter breeder stat bonuses", () => {
  it("adds flat creation-time stats and spawns at the increased full MaxHP", () => {
    const base = coreWith({ shortType: "FireCub", level: 10 });
    const boosted = coreWith({
      shortType: "FireCub",
      level: 10,
      flatStatBonuses: { MaxHP: 500, Attack: 25, Speed: -3 },
    });
    const id = battleLivingId(0, 0, "FireCub");

    expect(boosted.maxHpOf(id)).toBe(base.maxHpOf(id) + 500);
    expect(boosted.hpOf(id)).toBe(boosted.maxHpOf(id));
    expect(boosted.effectiveStatsOf(id).Attack).toBe(base.effectiveStatsOf(id).Attack + 25);
    expect(boosted.effectiveStatsOf(id).Speed).toBe(base.effectiveStatsOf(id).Speed - 3);
  });

  it("retains fractional provider bonuses until Living's final stat round", () => {
    const base = coreWith({ shortType: "FireCub", level: 10 });
    const boosted = coreWith({
      shortType: "FireCub",
      level: 10,
      flatStatBonuses: { MaxHP: 1.5 },
    });
    const id = battleLivingId(0, 0, "FireCub");
    expect(boosted.maxHpOf(id)).toBe(base.maxHpOf(id) + 2);
  });
});
