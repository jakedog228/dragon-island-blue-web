import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { BattleSession, mulberry32, type TeamMemberSetup } from "@dib/engine";
import { applyPlayerBattleBonuses, PlayerProfile } from "@dib/player-domain";

const gd = loadGameData();

function session(playerTeam: TeamMemberSetup[]): BattleSession {
  return new BattleSession(
    gd,
    [playerTeam, [{ shortType: "SnowCub", level: 10 }]],
    mulberry32(0x4845524f),
  );
}

describe("persisted Hero progression in combat", () => {
  it("changes the friendly Living's actual effective stats while leaving the enemy untouched", () => {
    const profile = new PlayerProfile({
      heroLevel: 3,
      monsterPartyLevels: [10],
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
    });
    profile.incrementSkill("Attack");
    profile.increaseLicenseAfterChallenge({
      type: "Apprentice",
      heroLevelRequired: 3,
      completedQuestsRequired: 5,
      battingOrderSize: 7,
      gemSlots: 1,
    });
    const gem = profile.inventory.addGem({
      definitionPath: "Gems.RandomNovice",
      level: 10,
      quality: 0,
      slot: 0,
      enabledStats: ["Attack"],
    });
    profile.equipGem(gem.id);

    const setup: TeamMemberSetup[] = [{ shortType: "FireCub", level: 10 }];
    const baseline = session(setup);
    const boosted = session(applyPlayerBattleBonuses(setup, profile));
    const friendlyId = "t0m0:FireCub";
    const enemyId = "t1m0:SnowCub";

    expect(boosted.effectiveStatsOf(friendlyId).Attack)
      .toBe(baseline.effectiveStatsOf(friendlyId).Attack + profile.playerStatBonus("Attack"));
    expect(boosted.effectiveStatsOf(enemyId)).toEqual(baseline.effectiveStatsOf(enemyId));
  });
});
