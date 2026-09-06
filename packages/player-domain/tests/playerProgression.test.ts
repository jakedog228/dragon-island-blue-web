import { describe, expect, it } from "vitest";
import { applyPlayerBattleBonuses } from "../src/battlePlayerState.js";
import { PlayerProfile } from "../src/playerProfile.js";

function profile(heroLevel = 3): PlayerProfile {
  return new PlayerProfile({
    heroLevel,
    monsterPartyLevels: [1],
    silver: 0,
    gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  });
}

describe("PlayerProfile character progression", () => {
  it("starts level one with one free point and applies source stat weights", () => {
    const player = profile(1);
    expect(player.skillPointsAvailable).toBe(1);
    expect(player.incrementSkill("Defense")).toBe(true);
    expect(player.skillPointsAvailable).toBe(0);
    expect(player.playerStatBonus("Defense")).toBe(1.5);
    expect(player.incrementSkill("Attack")).toBe(false);
    expect(player.decrementSkill("Defense")).toBe(true);
    expect(player.playerStatBonus("Defense")).toBe(0);
  });

  it("qualifies only for the immediate license by hero and completed-quest thresholds", () => {
    let battingOrderSize = 5;
    const player = new PlayerProfile({
      heroLevel: 3,
      monsterPartyLevels: [1],
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
    }, {
      monsters: () => [{ shortType: "FireCub", level: 1 }],
      setBattingOrderSize: (size) => { battingOrderSize = size; },
    });
    const apprentice = {
      type: "Apprentice" as const,
      heroLevelRequired: 3,
      completedQuestsRequired: 5,
      battingOrderSize: 7,
      gemSlots: 1,
    };
    expect(player.licenseQualification(apprentice, 4)).toMatchObject({
      nextType: "Apprentice",
      qualifies: false,
    });
    expect(player.licenseQualification(apprentice, 5)).toMatchObject({
      nextType: "Apprentice",
      qualifies: true,
    });
    expect(player.increaseLicenseAfterChallenge(apprentice)).toBe("Apprentice");


    expect(battingOrderSize).toBe(8);
    expect(() => player.increaseLicenseAfterChallenge(apprentice)).toThrow(/cannot increase/);
  });

  it("persists skills and license through schema v5", () => {
    const player = profile(3);
    player.incrementSkill("Attack");
    player.incrementSkill("Resist");
    player.increaseLicenseAfterChallenge({
      type: "Apprentice",
      heroLevelRequired: 3,
      completedQuestsRequired: 5,
      battingOrderSize: 7,
      gemSlots: 1,
    });
    const restored = PlayerProfile.fromStateSnapshot(player.stateSnapshot(), [1]);
    expect(restored.licenseType).toBe("Apprentice");
    expect(restored.skillValue("Attack")).toBe(1);
    expect(restored.skillValue("Resist")).toBe(1);
    expect(restored.skillPointsAvailable).toBe(1);
  });

  it("projects skill and equipped-Gem providers into friendly battle bonuses", () => {
    const player = profile(3);
    player.incrementSkill("Defense");
    player.increaseLicenseAfterChallenge({
      type: "Apprentice",
      heroLevelRequired: 3,
      completedQuestsRequired: 5,
      battingOrderSize: 7,
      gemSlots: 1,
    });
    const gem = player.inventory.addGem({
      definitionPath: "Gems.RandomNovice",
      level: 10,
      quality: 0,
      slot: 0,
      enabledStats: ["Defense"],
    });
    player.equipGem(gem.id);
    expect(player.battleStatBonuses()).toMatchObject({ Defense: 16.5 });
    // The providers become the member's own permanent buff children; a Breeder's flat creation
    // bonus is a separate accumulator term and is left alone.
    expect(applyPlayerBattleBonuses([
      { shortType: "FireCub", level: 10, flatStatBonuses: { Defense: 2 } },
    ], player)).toEqual([
      {
        shortType: "FireCub",
        level: 10,
        flatStatBonuses: { Defense: 2 },
        playerBuffs: { Defense: 16.5 },
      },
    ]);


    expect(() => applyPlayerBattleBonuses(
      [{ shortType: "FireCub", level: 10, playerBuffs: { Defense: 16.5 } }],
      player,
    )).toThrow(/already carries player buffs/);
  });
});

describe("PlayerProfile Golden Egg reward level", () => {
  function profileWithBench(levels: readonly number[]): PlayerProfile {
    return new PlayerProfile({
      heroLevel: 20,
      monsterPartyLevels: [...levels],
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
    }, {
      monsters: () => levels.map((level, slot) => ({ shortType: `Bench${slot}`, level })),
    });
  }

  it("reports the second-highest bench level, never the maximum", () => {


    const single = profileWithBench([80]);
    expect(single.goldEggMonsterLevel()).toBe(1);
    expect(single.capturePartyLevel()).toBe(80);

    const mixed = profileWithBench([80, 60, 20]);
    expect(mixed.goldEggMonsterLevel()).toBe(60);
    expect(mixed.capturePartyLevel()).toBe(80);

    // Strict `>` comparisons let tied maxima occupy both ranks.
    expect(profileWithBench([80, 80]).goldEggMonsterLevel()).toBe(80);
    expect(profileWithBench([20, 80]).goldEggMonsterLevel()).toBe(20);
  });
});
