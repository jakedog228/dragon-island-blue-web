import { describe, expect, it } from "vitest";
import {
  parsePlayerGameStateSnapshot,
  restoreWorldTripSharedState,
  snapshotWorldProgress,
} from "../src/player/gameState.js";

describe("modular world save state", () => {
  function minimalState(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      player: {
        schemaVersion: 1,
        profile: { schemaVersion: 3 },
        party: { kind: "standalone-levels", levels: [1] },
      },
    };
  }

  it("validates and clones the complete outer save tree before domain normalization", () => {
    const malformed: Array<[string, (state: Record<string, unknown>) => void]> = [
      ["null prototype", (state) => {
        const player = Object.create(null) as Record<string, unknown>;
        Object.assign(player, state.player);
        state.player = player;
      }],
      ["symbol", (state) => {
        Object.defineProperty(state, Symbol("save"), { value: 1, enumerable: true });
      }],
      ["accessor", (state) => {
        Object.defineProperty(state, "world", { get: () => undefined, enumerable: true });
      }],
      ["non-enumerable", (state) => {
        Object.defineProperty(state.player!, "hidden", { value: 1, enumerable: false });
      }],
      ["cycle", (state) => {
        const profile = state.player as Record<string, unknown>;
        profile.profile = { cycle: profile };
      }],
      ["non-finite", (state) => {
        (state.player as Record<string, unknown>).profile = { gold: Number.NaN };
      }],
      ["sparse array", (state) => {
        (state.player as Record<string, unknown>).party = {
          kind: "standalone-levels",
          levels: Object.assign([], { 1: 2, length: 2 }),
        };
      }],
      ["array extra key", (state) => {
        const levels = [1] as number[] & { extra?: number };
        levels.extra = 2;
        (state.player as Record<string, unknown>).party = { kind: "standalone-levels", levels };
      }],
      ["custom array prototype", (state) => {
        const levels = [1];
        Object.setPrototypeOf(levels, { custom: true });
        (state.player as Record<string, unknown>).party = { kind: "standalone-levels", levels };
      }],
    ];

    for (const [label, mutate] of malformed) {
      const state = minimalState();
      mutate(state);
      expect(() => parsePlayerGameStateSnapshot(state), label).toThrow();
    }
  });

  it("rejects unknown root and nested own keys in versioned local envelopes", () => {
    const root = minimalState();
    expect(() => parsePlayerGameStateSnapshot({ ...root, unexpected: true })).toThrow(/unknown field/);
    expect(() => parsePlayerGameStateSnapshot({
      ...root,
      player: { ...(root.player as Record<string, unknown>), unexpected: true },
    })).toThrow(/unknown field/);
    expect(() => parsePlayerGameStateSnapshot({
      ...root,
      world: {
        schemaVersion: 1,
        worldName: "World",
        currentPoiName: "Field",
        refresh: { occurrenceByPoi: {}, completedPois: [] },
        poiWins: {},
        everCompletedPois: [],
        unexpected: true,
      },
    })).toThrow(/unknown field/);
  });

  it.each(["player", "world", "quests", "pendingBattleRewardKeys", "dungeon"] as const)(
    "rejects a non-JSON value anywhere in %s",
    (domain) => {
      const state = minimalState();
      if (domain === "player") {
        (state.player as Record<string, unknown>).profile = { nested: Infinity };
      } else if (domain === "world") {
        state.world = { nested: Infinity };
      } else if (domain === "quests") {
        state.quests = { nested: Infinity };
      } else if (domain === "pendingBattleRewardKeys") {
        state.pendingBattleRewardKeys = { reward: Infinity };
      } else {
        state.dungeon = { nested: Infinity };
      }
      expect(() => parsePlayerGameStateSnapshot(state), domain).toThrow(/JSON-safe|object|schema|state/);
    },
  );

  it("round-trips local pending battle-reward bookkeeping and rejects malformed identities", () => {
    const state = {
      schemaVersion: 1 as const,
      player: {
        schemaVersion: 1 as const,
        profile: { schemaVersion: 3 as const },
        party: { kind: "standalone-levels" as const, levels: [1] },
      },
      pendingBattleRewardKeys: { "treasure-1": "reward-1" },
    };

    expect(parsePlayerGameStateSnapshot(state).pendingBattleRewardKeys).toEqual(
      state.pendingBattleRewardKeys,
    );
    expect(() => parsePlayerGameStateSnapshot({
      ...state,
      pendingBattleRewardKeys: { "": "reward-1" },
    })).toThrow(/pending battle reward/);
  });

  it("round-trips refresh caches separately from permanent completion registration", () => {
    const shared = {
      occurrenceThisRefresh: new Map([["Forest", false], ["Field", true]]),
      completedThisRefresh: new Set(["Field"]),
      poiWins: new Map([["Field", 2]]),
      everCompletedPois: new Set(["Tutorial"]),
      notifiedCompletedPois: new Set<string>(),
      dayNumber: 7,
    };
    const snapshot = snapshotWorldProgress(
      "World_1-1",
      "Field",
      shared,
      ["Tutorial"],
      "First_City",
      ["First_City"],
    );
    expect(snapshot).toEqual({
      schemaVersion: 2,
      worldName: "World_1-1",
      currentPoiName: "Field",
      refresh: {
        occurrenceByPoi: { Field: true, Forest: false },
        completedPois: ["Field"],
      },
      poiWins: { Field: 2 },
      dayNumber: 7,
      everCompletedPois: ["Field", "Tutorial"],
      lastTownName: "First_City",
      visitedTownNames: ["First_City"],
    });
    expect(restoreWorldTripSharedState(snapshot)).toEqual(shared);
  });

  it("restores pre-day schema-1 saves at the shipped day-one default", () => {
    const restored = restoreWorldTripSharedState({
      schemaVersion: 1,
      worldName: "World_1-1",
      currentPoiName: "Field",
      refresh: { occurrenceByPoi: {}, completedPois: [] },
      poiWins: {},
      everCompletedPois: [],
    });
    expect(restored.dayNumber).toBe(1);
  });

  it("accepts legacy saves without lastTown and rejects malformed saved town identifiers", () => {
    const legacy = {
      schemaVersion: 1 as const,
      worldName: "World_1-1",
      currentPoiName: "Field",
      refresh: { occurrenceByPoi: {}, completedPois: [] },
      poiWins: {},
      everCompletedPois: [],
    };
    expect(restoreWorldTripSharedState(legacy).dayNumber).toBe(1);
    expect(() => restoreWorldTripSharedState({ ...legacy, lastTownName: "" }))
      .toThrow(/lastTownName/);
  });

  it("accepts nested profile schemas 3..8 and still rejects unknown profile schemas", () => {
    const schema3 = {
      schemaVersion: 1,
      player: {
        schemaVersion: 1,
        profile: {
          schemaVersion: 3,
          hero: { level: 2, totalHighestLevels: 10 },
          silver: 0,
          gold: 0,
          captureCards: { 1: 0, 2: 0, 3: 0 },
          highestCapturedLevels: {},
          learnedCombineRecipes: ["Carnoraptor"],
          spiritEnergy: 0,
          spiritSavedXp: {},
          spiritsUsedThisTrip: [],
        },
        party: { kind: "standalone-levels", levels: [1] },
      },
    };
    expect(parsePlayerGameStateSnapshot(schema3).player.profile.schemaVersion).toBe(3);
    expect(parsePlayerGameStateSnapshot({
      ...schema3,
      player: {
        ...schema3.player,
        profile: {
          ...schema3.player.profile,
          schemaVersion: 4,
          tutorialFlags: ["FirstMonsterpedia"],
        },
      },
    }).player.profile.schemaVersion).toBe(4);
    expect(parsePlayerGameStateSnapshot({
      ...schema3,
      player: {
        ...schema3.player,
        profile: { ...schema3.player.profile, schemaVersion: 5 },
      },
    }).player.profile.schemaVersion).toBe(5);
    expect(parsePlayerGameStateSnapshot({
      ...schema3,
      player: {
        ...schema3.player,
        profile: { ...schema3.player.profile, schemaVersion: 6 },
      },
    }).player.profile.schemaVersion).toBe(6);
    expect(parsePlayerGameStateSnapshot({
      ...schema3,
      player: {
        ...schema3.player,
        profile: { ...schema3.player.profile, schemaVersion: 7 },
      },
    }).player.profile.schemaVersion).toBe(7);
    expect(parsePlayerGameStateSnapshot({
      ...schema3,
      player: {
        ...schema3.player,
        profile: { ...schema3.player.profile, schemaVersion: 8 },
      },
    }).player.profile.schemaVersion).toBe(8);
    expect(() => parsePlayerGameStateSnapshot({
      ...schema3,
      player: {
        ...schema3.player,
        profile: { ...schema3.player.profile, schemaVersion: 9 },
      },
    })).toThrow(/unsupported profile schema/);
  });

  it("accepts runtime schema 2 only with sorted unique Collection claim IDs", () => {
    const base = {
      schemaVersion: 1,
      player: {
        schemaVersion: 2,
        profile: {
          schemaVersion: 6,
          hero: { level: 2, totalHighestLevels: 10 },
          silver: 0,
          gold: 0,
          captureCards: { 1: 0, 2: 0, 3: 0 },
          highestCapturedLevels: {},
          learnedCombineRecipes: [],
          spiritEnergy: 0,
          spiritSavedXp: {},
          spiritsUsedThisTrip: [],
          tutorialFlags: [],
        },
        party: { kind: "standalone-levels", levels: [1] },
        claimedCollectionGoalIds: [
          "CollectionQuestCollector",
          "CollectionQuestUsualSuspects",
        ],
      },
    };

    expect(parsePlayerGameStateSnapshot(base).player).toEqual(base.player);
    expect(() => parsePlayerGameStateSnapshot({
      ...base,
      player: {
        ...base.player,
        claimedCollectionGoalIds: [
          "CollectionQuestUsualSuspects",
          "CollectionQuestCollector",
        ],
      },
    })).toThrow(/sorted and unique/);
    expect(() => parsePlayerGameStateSnapshot({
      ...base,
      player: {
        ...base.player,
        claimedCollectionGoalIds: [
          "CollectionQuestCollector",
          "CollectionQuestCollector",
        ],
      },
    })).toThrow(/duplicate/);
    expect(() => parsePlayerGameStateSnapshot({
      ...base,
      player: { ...base.player, claimedCollectionGoalIds: [""] },
    })).toThrow(/non-empty string/);
    expect(() => parsePlayerGameStateSnapshot({
      ...base,
      player: { ...base.player, claimedCollectionGoalIds: undefined },
    })).toThrow(/claimedCollectionGoalIds/);
  });

  it("requires schema-2 visited towns to be sorted and unique", () => {
    const base = {
      schemaVersion: 2 as const,
      worldName: "World_1-1",
      currentPoiName: "First_City",
      refresh: { occurrenceByPoi: {}, completedPois: [] },
      poiWins: {},
      dayNumber: 2,
      everCompletedPois: ["First_City"],
      lastTownName: "First_City",
      visitedTownNames: ["First_City"],
    };
    expect(restoreWorldTripSharedState(base).dayNumber).toBe(2);
    expect(() => restoreWorldTripSharedState({
      ...base,
      visitedTownNames: ["Later_City", "First_City"],
    })).toThrow(/unique/);
    expect(() => restoreWorldTripSharedState({
      ...base,
      visitedTownNames: ["First_City", "First_City"],
    })).toThrow(/unique/);
  });

  it("migrates legacy saves without Guild quests and validates the nested quest schema when present", () => {
    const legacy = {
      schemaVersion: 1,
      player: {
        schemaVersion: 1,
        profile: {
          schemaVersion: 4,
          hero: { level: 2, totalHighestLevels: 10 },
          silver: 0,
          gold: 0,
          captureCards: { 1: 0, 2: 0, 3: 0 },
          highestCapturedLevels: {},
          learnedCombineRecipes: [],
          spiritEnergy: 0,
          spiritSavedXp: {},
          spiritsUsedThisTrip: [],
          tutorialFlags: [],
        },
        party: { kind: "standalone-levels", levels: [1] },
      },
    };
    expect(parsePlayerGameStateSnapshot(legacy).quests).toBeUndefined();
    const quests = {
      schemaVersion: 1 as const,
      activeQuestNames: ["BeatRigel"],
      finishedQuestNames: ["MacworldCatch"],
      progressByQuestName: { BeatRigel: { quantity: 0 } },
      dialogsSeen: ["LeslieSaved"],
      completedFixedEncounterKeys: ["TutorialBattle"],
      receivedBattleRewardKeys: ["TutorialReward"],
    };
    expect(parsePlayerGameStateSnapshot({ ...legacy, quests }).quests).toEqual(quests);
    expect(() => parsePlayerGameStateSnapshot({
      ...legacy,
      quests: { ...quests, activeQuestNames: ["BeatRigel", "BeatRigel"] },
    })).toThrow(/activeQuestNames contains duplicates/);
  });

  it("normalizes legacy dungeon caches at the outer save boundary", () => {
    const route = { typeName: "Cave", sourceFile: "Dungeon_Test.plist", floor: 1 };
    const session = {
      schemaVersion: 1, definitionId: "Cave:Dungeon_Test.plist:Test", floor: 1, seed: 55,
      currentRoomId: "room-0", exploredRoomIds: ["room-0"], clearedEncounterIds: [],
      collectedTreasureIds: [], registeredWaypointFloors: [1], completedKeys: [], catchTypes: [],
      catchRewardCollected: false,
    };
    const state = {
      schemaVersion: 1,
      player: {
        schemaVersion: 1,
        profile: {
          schemaVersion: 3, hero: { level: 2, totalHighestLevels: 10 }, silver: 0, gold: 0,
          captureCards: { 1: 0, 2: 0, 3: 0 }, highestCapturedLevels: {}, learnedCombineRecipes: [],
          spiritEnergy: 0, spiritSavedXp: {}, spiritsUsedThisTrip: [],
        },
        party: { kind: "world-trip-party", members: [] },
      },
      world: {
        schemaVersion: 1, worldName: "World_1-1", currentPoiName: "Cave",
        refresh: { occurrenceByPoi: {}, completedPois: [] }, poiWins: {}, everCompletedPois: [],
      },
      dungeon: {
        schemaVersion: 1, current: { route, session }, cachedFloors: [{ route, session }],
        registeredWaypointFloors: [1], completedKeys: [], catchTypes: [], catchRewardCollected: false,
      },
    };
    const parsed = parsePlayerGameStateSnapshot(state);
    expect(parsed.dungeon?.runSeed).toBe(55);
    expect(parsed.dungeon?.registeredWaypoints).toEqual([{ route }]);
  });

  it("requires a world-trip save and strict cache consistency for active dungeons", () => {
    const route = { typeName: "Cave", sourceFile: "Dungeon_Test.plist", floor: 1 };
    const session = {
      schemaVersion: 1, definitionId: "Cave:Dungeon_Test.plist:Test", floor: 1, seed: 55,
      currentRoomId: "room-0", exploredRoomIds: ["room-0"], clearedEncounterIds: [],
      collectedTreasureIds: [], registeredWaypointFloors: [], completedKeys: [], catchTypes: [],
      catchRewardCollected: false,
    };
    const base = {
      schemaVersion: 1,
      player: {
        schemaVersion: 1,
        profile: { schemaVersion: 3 },
        party: { kind: "world-trip-party", members: [] },
      },
      world: {
        schemaVersion: 1, worldName: "World_1-1", currentPoiName: "Cave",
        refresh: { occurrenceByPoi: {}, completedPois: [] }, poiWins: {}, everCompletedPois: [],
      },
      dungeon: {
        schemaVersion: 1, runSeed: 8, current: { route, session }, cachedFloors: [],
        registeredWaypoints: [], completedKeys: [], catchTypes: [], catchRewardCollected: false,
      },
    };
    expect(() => parsePlayerGameStateSnapshot(base)).toThrow(/current floor is absent/);
    expect(() => parsePlayerGameStateSnapshot({
      ...base,
      dungeon: { ...base.dungeon, cachedFloors: [{ route, session }] },
      player: { ...base.player, party: { kind: "standalone-levels", levels: [1] } },
    })).toThrow(/world-trip player/);
  });

});
