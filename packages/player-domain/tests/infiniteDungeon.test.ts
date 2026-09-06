import { describe, expect, it } from "vitest";
import {
  PlayerProfile,
  battingOrderSizeFor,
  infiniteDungeonFloorEntry,
  isInfiniteDungeonInstance,
  nextInfiniteDungeonUnlockFloor,
} from "../src/playerProfile.js";

function profile(): PlayerProfile {
  return new PlayerProfile({
    heroLevel: 1,
    monsterPartyLevels: [1],
    silver: 0,
    gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  });
}

describe("Infinite Dungeon unlock threshold", () => {
  it("is the next multiple of ten strictly above the stored floor", () => {

    expect(nextInfiniteDungeonUnlockFloor(0)).toBe(10);
    expect(nextInfiniteDungeonUnlockFloor(1)).toBe(10);
    expect(nextInfiniteDungeonUnlockFloor(9)).toBe(10);
    // The threshold floor itself is the reward floor, so reaching 10 moves the target to 20.
    expect(nextInfiniteDungeonUnlockFloor(10)).toBe(20);
    expect(nextInfiniteDungeonUnlockFloor(29)).toBe(30);
    expect(nextInfiniteDungeonUnlockFloor(210)).toBe(220);
  });

  it("rejects an unstorable property value", () => {
    expect(() => nextInfiniteDungeonUnlockFloor(-1)).toThrow(/invalid highest level/);
    expect(() => nextInfiniteDungeonUnlockFloor(1.5)).toThrow(/invalid highest level/);
  });
});

describe("Infinite Dungeon instance test", () => {
  it("matches only the two shipped Abyss instances", () => {
    // Dungeon_15.plist floors 1..210, Dungeon_15b.plist floors 211..999.
    expect(isInfiniteDungeonInstance("Volcano")).toBe(true);
    expect(isInfiniteDungeonInstance("VolcanoB")).toBe(true);
    expect(isInfiniteDungeonInstance("NorthCave")).toBe(false);
    expect(isInfiniteDungeonInstance("volcano")).toBe(false);
    expect(isInfiniteDungeonInstance("VolcanoC")).toBe(false);
  });
});

describe("Infinite Dungeon floor entry", () => {
  it("decides a fresh profile's first floor without unlocking anything", () => {
    expect(infiniteDungeonFloorEntry(0, 1)).toEqual({
      previousHighest: 0,
      highestLevel: 1,
      leaderboardScore: 1,
      firstThreshold: 10,
      nextThreshold: 10,
      updated: true,
      unlocked: false,
    });
  });

  it("unlocks on the threshold floor itself (`cmp r4,r10 / blt` is not a strict test)", () => {
    const entry = infiniteDungeonFloorEntry(9, 10);
    expect(entry.unlocked).toBe(true);
    expect(entry.nextThreshold).toBe(20);
  });

  it("fires exactly once across a jump of several decades", () => {


    const entry = infiniteDungeonFloorEntry(1, 211);
    expect(entry).toEqual({
      previousHighest: 1,
      highestLevel: 211,
      leaderboardScore: 211,
      firstThreshold: 10,
      nextThreshold: 220,
      updated: true,
      unlocked: true,
    });
  });

  it("writes nothing on a shallower re-entry but still reports the banked score", () => {


    expect(infiniteDungeonFloorEntry(211, 2)).toEqual({
      previousHighest: 211,
      highestLevel: 211,
      leaderboardScore: 211,
      firstThreshold: 220,
      nextThreshold: 220,
      updated: false,
      unlocked: false,
    });

    expect(infiniteDungeonFloorEntry(211, 211).updated).toBe(false);
  });

  it("deepens without unlocking between thresholds", () => {
    const entry = infiniteDungeonFloorEntry(211, 212);
    expect(entry.updated).toBe(true);
    expect(entry.unlocked).toBe(false);
    expect(entry.nextThreshold).toBe(220);
  });

  it("rejects inputs no dungeon route could produce", () => {
    expect(() => infiniteDungeonFloorEntry(-1, 1)).toThrow(/invalid highest level/);
    expect(() => infiniteDungeonFloorEntry(0, 0)).toThrow(/invalid floor/);
    expect(() => infiniteDungeonFloorEntry(0, 1.5)).toThrow(/invalid floor/);
  });
});

describe("PlayerProfile Infinite Dungeon property", () => {
  it("reads 0 for a property dictionary that never had the key", () => {
    const player = profile();
    expect(player.infiniteDungeonHighestLevel).toBe(0);
    expect(player.nextInfiniteDungeonUnlockFloor()).toBe(10);
  });

  it("applies the write only on a strictly deeper floor and grows the batting order by /10", () => {
    const player = profile();
    let changes = 0;
    player.setChangeListener(() => { changes += 1; });

    expect(player.recordInfiniteDungeonFloor(9).updated).toBe(true);
    expect(player.infiniteDungeonHighestLevel).toBe(9);
    expect(changes).toBe(1);


    expect(player.recordInfiniteDungeonFloor(3).updated).toBe(false);
    expect(player.infiniteDungeonHighestLevel).toBe(9);
    expect(changes).toBe(1);

    expect(player.recordInfiniteDungeonFloor(30).unlocked).toBe(true);
    expect(player.infiniteDungeonHighestLevel).toBe(30);
    expect(player.nextInfiniteDungeonUnlockFloor()).toBe(40);
    expect(changes).toBe(2);


    expect(battingOrderSizeFor(5, 1, { infiniteDungeonHighestLevel: 30 })).toBe(8);
  });

  it("rejects a floor outside the dungeon's own numbering", () => {
    expect(() => profile().recordInfiniteDungeonFloor(0)).toThrow(/invalid infinite dungeon floor/);
  });

  it("round-trips the property through the v8 state snapshot", () => {
    const player = profile();
    player.recordInfiniteDungeonFloor(212);
    const snapshot = player.stateSnapshot();
    expect(snapshot.schemaVersion).toBe(8);
    expect(snapshot.infiniteDungeonHighestLevel).toBe(212);

    const restored = PlayerProfile.fromStateSnapshot(snapshot, [1]);
    expect(restored.infiniteDungeonHighestLevel).toBe(212);
    expect(restored.nextInfiniteDungeonUnlockFloor()).toBe(220);
    expect(restored.stateSnapshot()).toEqual(snapshot);
  });

  it("reads 0 for a pre-v8 snapshot, which had no key to carry", () => {
    const player = profile();
    player.recordInfiniteDungeonFloor(42);
    const { infiniteDungeonHighestLevel: _dropped, ...rest } = player.stateSnapshot();
    const legacy = { ...rest, schemaVersion: 7 as const };
    expect(PlayerProfile.fromStateSnapshot(legacy, [1]).infiniteDungeonHighestLevel).toBe(0);
  });
});
