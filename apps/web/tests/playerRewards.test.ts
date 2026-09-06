import { describe, expect, it } from "vitest";
import { PlayerProfile } from "../src/player/playerProfile.js";
import { applyPlayerRewards } from "../src/player/rewards.js";

function profile(): PlayerProfile {
  return new PlayerProfile({
    heroLevel: 1,
    heroTotalHighestLevels: 0,
    monsterPartyLevels: [1],
    silver: 0,
    gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  });
}

describe("shared player reward application", () => {
  it("preserves the source totem first-pickup +1 XP and repeat +100 XP branches", () => {
    const p = profile();
    expect(
      applyPlayerRewards(p, [{ kind: "spiritTotem", shortType: "Fire" }])[0],
    ).toMatchObject({ firstTime: true, savedXpAfter: 1 });
    expect(
      applyPlayerRewards(p, [{ kind: "spiritTotem", shortType: "Fire" }])[0],
    ).toMatchObject({ firstTime: false, savedXpAfter: 101 });
  });

  it("makes recipes idempotent and persists native Gem identity descriptors without loss", () => {
    const p = profile();
    const first = applyPlayerRewards(p, [
      { kind: "recipe", combineName: "Alpha" },
      { kind: "gem", level: 63, quality: 1, slot: 2, enabledStats: ["Defense", "Magic"] },
    ]);
    const second = applyPlayerRewards(p, [
      { kind: "recipe", combineName: "Alpha" },
    ]);
    expect(first[0]).toMatchObject({ newlyLearned: true });
    expect(second[0]).toMatchObject({ newlyLearned: false });
    expect(
      p.itemCount("GemLevel:63:Quality:1:Slot:2:Stats:Defense,Magic"),
    ).toBe(1);
    expect(
      PlayerProfile.fromStateSnapshot(p.stateSnapshot(), [1]).itemCount(
        "GemLevel:63:Quality:1:Slot:2:Stats:Defense,Magic",
      ),
    ).toBe(1);
  });

  it("fails closed when destroy-on-pickup eggs bypass their hatch flow", () => {
    const p = profile();
    expect(() => applyPlayerRewards(p, [{ kind: "egg" }])).toThrow(/egg hatch/);
    expect(() => applyPlayerRewards(p, [{ kind: "monsterEgg" }])).toThrow(/egg hatch/);
    expect(() => applyPlayerRewards(p, [{
      kind: "repeatEgg",
      definitionPath: "DestroyOnPickup.RepeatEgg",
      instanceName: "RepeatEgg",
      numRepeats: 2,
    }])).toThrow(/egg hatch/);
  });

  it("persists arbitrary Items.plist class-Item rewards as grouped usable inventory", () => {
    const p = profile();
    expect(applyPlayerRewards(p, [{
      kind: "usable",
      definitionPath: "Usables.ModHealingCard",
      instanceName: "ModHealingCard",
      level: 4,
    }])[0]).toMatchObject({
      kind: "usable",
      definitionPath: "Usables.ModHealingCard",
      instanceName: "ModHealingCard",
      level: 4,
    });
    expect(p.inventory.usableGroups()).toEqual([expect.objectContaining({
      instanceName: "ModHealingCard",
      count: 1,
    })]);
    expect(PlayerProfile.fromStateSnapshot(p.stateSnapshot(), [1]).inventory.usableGroups())
      .toEqual([expect.objectContaining({ instanceName: "ModHealingCard", count: 1 })]);
  });

  it("requires and reports the durable party destination for MonsterJoin rewards", () => {
    const p = profile();
    expect(() => applyPlayerRewards(
      p,
      [{ kind: "monsterJoin", shortType: "Wolf", jobLevel: 2 }],
    )).toThrow(/durable world-party destination/);
    expect(applyPlayerRewards(
      p,
      [{ kind: "monsterJoin", shortType: "Wolf", jobLevel: 2 }],
      { addMonsterJoin: (shortType, jobLevel) => ({
        instanceId: `${shortType}-${jobLevel}`,
      }) },
    )).toEqual([{
      kind: "monsterJoin",
      shortType: "Wolf",
      jobLevel: 2,
      instanceId: "Wolf-2",
    }]);
  });
});
