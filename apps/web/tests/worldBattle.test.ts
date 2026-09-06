import { describe, expect, it } from "vitest";
import type { GeneratedWorldEncounter } from "@dib/engine";
import { battleMusicRole, DEMO_ENCOUNTER } from "../src/battle/encounter.js";
import {
  buildWorldBattle,
  withWorldBattleSaveMePolicy,
  type WorldBattleSaveMeContext,
} from "../src/world/worldBattle.js";

function fixed(): GeneratedWorldEncounter {
  return {
    kind: "fixed",
    poiName: "FelixField",
    forced: false,
    tableKey: "1",
    poiWinsBeforeEncounter: 0,
    challengeLevel: 20,
    completionKey: "FelixFinal",
    questKey: "LiberateTownsQuest",
    battleRewardKey: "RewardFelixFinalBattle",
    monsters: [{
      type: "BlackDragon",
      level: 20,
      extraLivingArguments: {
        boss: true,
        displayName: "Fafnir",
        capturable: true,
        rendererData: { class: "CCSprite", spriteFile: "BlackDragon.png" },
      },
    }],
    breeder: {
      type: "Normal",
      arguments: { stats: { Attack: 0, Defense: -10, MaxHP: 500, Speed: 25 }, xpBonus: 3 },
    },
    startEvent: {
      className: "ChatGameFlowEvent",
      chat: {
        name: "Felix",
        alwaysShow: true,
        imageFile: "nobleboy.png",
        messageKeys: [],
      },
    },
    rewards: [{ kind: "silver", amount: 100 }],
  };
}

describe("world fixed battle boundary", () => {
  it("retains completion/quest/chat/reward identity and applies breeder last", () => {
    const built = buildWorldBattle(
      fixed(),
      "FieldCombat-hd",
      [{ shortType: "Slime", level: 5 }],
    );
    expect(built.encounter).toMatchObject({
      backgroundKey: "FieldCombat-hd",
      blockSaveMe: false,
      questKey: "LiberateTownsQuest",
      uniqueKey: "FelixFinal",
      breederXpBonus: 3,
      startChat: { name: "Felix", imageFile: "nobleboy.png" },
      enemyTeam: [{
        shortType: "BlackDragon",
        level: 20,
        boss: true,
        displayName: "Fafnir",
        capturable: false,
        flatStatBonuses: { MaxHP: 500, Speed: 25 },
      }],
    });
    expect(built.rewardKey).toBe("RewardFelixFinalBattle");
    expect(built.rewards).toEqual([{ kind: "silver", amount: 100 }]);
    expect(battleMusicRole(built.encounter.breederXpBonus)).toEqual({
      category: "BossBattle",
      trackCount: 5,
    });
  });

  it("allows Save Me for local and Official base-world/Tournament encounters", () => {
    const encounter = buildWorldBattle(
      fixed(),
      "FieldCombat-hd",
      [{ shortType: "Slime", level: 5 }],
    ).encounter;
    const cases: ReadonlyArray<readonly [WorldBattleSaveMeContext, boolean]> = [
      [{ owner: "world", authority: "local" }, false],
      [{ owner: "tournament", authority: "local" }, false],
      [{ owner: "arena", authority: "local" }, true],
      [{ owner: "direct-demo", authority: "local" }, true],
      [{ owner: "world", authority: "official" }, false],
      [{ owner: "tournament", authority: "official" }, false],
      [{ owner: "arena", authority: "official" }, true],
      [{ owner: "reconnect", authority: "official" }, false],
    ];

    for (const [context, blockSaveMe] of cases) {
      expect(withWorldBattleSaveMePolicy(encounter, context).blockSaveMe).toBe(blockSaveMe);
    }
    expect(DEMO_ENCOUNTER.blockSaveMe).toBe(true);
  });

  it("uses questKey as the source reward fallback and leaves questless fights repeatable", () => {
    const { battleRewardKey: _battleRewardKey, ...withoutBattleRewardKey } = fixed();
    const questReward = buildWorldBattle(
      withoutBattleRewardKey,
      "FieldCombat-hd",
      [{ shortType: "Slime", level: 5 }],
    );
    expect(questReward.rewardKey).toBe("LiberateTownsQuest");

    const {
      completionKey: _completionKey,
      questKey: _questKey,
      breeder: _breeder,
      ...repeatableEncounter
    } = withoutBattleRewardKey;
    const repeatable = buildWorldBattle(
      repeatableEncounter,
      "FieldCombat-hd",
      [{ shortType: "Slime", level: 5 }],
    );
    expect(repeatable.rewardKey).toBeUndefined();
    expect(repeatable.encounter.enemyTeam[0]?.capturable).toBe(true);
    expect(battleMusicRole(repeatable.encounter.breederXpBonus)).toEqual({
      category: "Battle",
      trackCount: 7,
    });
  });

  it("selects music from breeder presence rather than the independent Living.boss flag", () => {
    const breederWithoutBoss: GeneratedWorldEncounter = {
      ...fixed(),
      monsters: [{ type: "BlackDragon", level: 20 }],
      breeder: {
        type: "Normal",
        arguments: { stats: { MaxHP: 100 } },
      },
    };
    const built = buildWorldBattle(
      breederWithoutBoss,
      "FieldCombat-hd",
      [{ shortType: "Slime", level: 5 }],
    );
    expect(built.encounter.breederXpBonus).toBe(1);
    expect(built.encounter.enemyTeam[0]?.boss).toBeUndefined();
    expect(battleMusicRole(built.encounter.breederXpBonus)).toEqual({
      category: "BossBattle",
      trackCount: 5,
    });
    expect(battleMusicRole(0)).toEqual({ category: "BossBattle", trackCount: 5 });

    const { breeder: _breeder, ...bossWithoutBreeder } = fixed();
    const ordinary = buildWorldBattle(
      bossWithoutBreeder,
      "FieldCombat-hd",
      [{ shortType: "Slime", level: 5 }],
    );
    expect(ordinary.encounter.enemyTeam[0]?.boss).toBe(true);
    expect(ordinary.encounter.breederXpBonus).toBeUndefined();
    expect(battleMusicRole(ordinary.encounter.breederXpBonus)).toEqual({
      category: "Battle",
      trackCount: 7,
    });
  });
});
