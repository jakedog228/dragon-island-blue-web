import { describe, expect, it } from "vitest";
import { summarizeSaveSlot } from "../src/player/saveSlotPreview.js";
import type { PlayerGameStateSnapshot } from "../src/player/gameState.js";

function standalone(heroLevel: number, levels: number[]): PlayerGameStateSnapshot {
  return {
    schemaVersion: 1,
    player: {
      schemaVersion: 1,
      profile: { schemaVersion: 1, heroLevel } as never,
      party: { kind: "standalone-levels", levels },
    },
  };
}

describe("summarizeSaveSlot", () => {
  it("reads hero level and party spread from a standalone profile", () => {
    expect(summarizeSaveSlot(standalone(9, [4, 12, 7]))).toEqual({
      heroLevel: 9,
      partySize: 3,
      partyTopLevel: 12,
    });
  });

  it("prefers the v2 hero level and surfaces world/POI when present", () => {
    const state: PlayerGameStateSnapshot = {
      schemaVersion: 1,
      player: {
        schemaVersion: 1,
        profile: { schemaVersion: 2, hero: { level: 20, totalHighestLevels: 999 } } as never,
        party: {
          kind: "world-trip-party",
          battingOrderSize: 2,
          monsters: [{ level: 15 }, { level: 18 }] as never,
        },
      },
      world: {
        schemaVersion: 1,
        worldName: "CinderHarbor",
        currentPoiName: "Ember Docks",
        refresh: { occurrenceByPoi: {}, completedPois: [] },
        poiWins: {},
        everCompletedPois: [],
      },
    };
    expect(summarizeSaveSlot(state)).toEqual({
      heroLevel: 20,
      partySize: 2,
      partyTopLevel: 18,
      worldName: "CinderHarbor",
      currentPoiName: "Ember Docks",
    });
  });

  it("reads the structured hero level from a schema-3 recipe profile", () => {
    const state = standalone(9, [4, 12, 7]);
    const schema3: PlayerGameStateSnapshot = {
      ...state,
      player: {
        ...state.player,
        profile: {
          schemaVersion: 3,
          hero: { level: 11, totalHighestLevels: 180 },
          learnedCombineRecipes: ["Carnoraptor"],
        } as never,
      },
    };
    expect(summarizeSaveSlot(schema3)).toMatchObject({
      heroLevel: 11,
      partySize: 3,
      partyTopLevel: 12,
    });
  });
});
