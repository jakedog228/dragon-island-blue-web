import { describe, expect, it } from "vitest";
import { DungeonSnapshotCompatibilityError } from "@dib/engine";
import { recoverIncompatibleLocalDungeonSave } from "../src/dungeon/localDungeonSaveRecovery.js";
import type { PlayerGameStateSnapshot } from "../src/player/gameState.js";

function activeDungeonSave(): PlayerGameStateSnapshot {
  return {
    schemaVersion: 1,
    player: {
      schemaVersion: 1,
      profile: { schemaVersion: 1 } as never,
      party: { kind: "world-trip-party", members: [] } as never,
    },
    quests: { schemaVersion: 1 } as never,
    world: {
      schemaVersion: 1,
      worldName: "Alvalon",
      currentPoiName: "NorthCave",
      refresh: { occurrenceByPoi: {}, completedPois: [] },
      poiWins: {},
      everCompletedPois: [],
      lastTownName: "Alvalon",
    },
    dungeon: { schemaVersion: 1 } as never,
    pendingBattleRewardKeys: { "treasure-1": "reward-1" },
  };
}

describe("local dungeon save recovery", () => {
  it("abandons only an incompatible active dungeon and its pending reward handoff", () => {
    const save = activeDungeonSave();
    const recovery = recoverIncompatibleLocalDungeonSave(
      save,
      new DungeonSnapshotCompatibilityError("Dungeon snapshot current room is missing"),
    );

    expect(recovery?.detail).toBe("Dungeon snapshot current room is missing");
    expect(recovery?.state).toEqual({
      schemaVersion: 1,
      player: save.player,
      quests: save.quests,
      world: save.world,
    });
    expect(save.dungeon).toBeDefined();
    expect(save.pendingBattleRewardKeys).toEqual({ "treasure-1": "reward-1" });
  });

  it("does not hide unrelated restore failures or alter saves outside a dungeon", () => {
    const save = activeDungeonSave();
    expect(recoverIncompatibleLocalDungeonSave(save, new Error("archive sprite is missing")))
      .toBeUndefined();

    const { dungeon: _dungeon, ...outsideDungeon } = save;
    expect(recoverIncompatibleLocalDungeonSave(
      outsideDungeon,
      new DungeonSnapshotCompatibilityError("Dungeon snapshot current room is missing"),
    )).toBeUndefined();
  });
});
