import { describe, expect, it, vi } from "vitest";
import {
  GAME_PROTOCOL_VERSION,
  type GameCommandEnvelopeV1,
  type GameCommandResultV1,
  type LogicPackDescriptorV1,
  type OfficialGameProjectionV13,
  type SlotProjectionV1,
} from "@dib/game-protocol";
import {
  OfficialAuthoritySaveStore,
  projectionToGameState,
} from "../src/authority/officialAuthoritySaveStore.js";
import type { GameAuthority } from "../src/authority/gameAuthorityClient.js";

const pack: LogicPackDescriptorV1 = {
  logicPackId: `logic-v1:${"d".repeat(64)}`,
  simulationVersion: "official-game-v9",
  trustTier: "official",
  capabilities: {
    slot: true, world: true, battle: true, capture: true, spirit: true, party: true,
    economy: true, dungeon: false, quests: true, plot: false, tournaments: false,
    commandTypes: ["slot.create", "quest.accept", "quest.claim", "quest.dropAll"],
  },
};

function projection(revision = 4): SlotProjectionV1 {
  return {
    slotId: "slot-1",
    revision,
    logicPackId: pack.logicPackId,
    simulationVersion: pack.simulationVersion,
    trustTier: "official",
    player: {
      heroLevel: 3,
      heroTotalHighestLevels: 7,
      silver: 90,
      gold: 4,
      captureCards: { 1: 2, 2: 0, 3: 0 },
      party: [{
        instanceId: "monster-1",
        shortType: "BlueBabyDragon",
        level: 3,
        cumulativeXp: 12,
        hp: 8,
        maxHp: 10,
      }],
      battingOrderSize: 6,
      battingOrderIds: ["monster-1"],
      ownedSoulStones: [],
      highestCapturedLevels: { BlueBabyDragon: 3 },
      learnedCombineRecipes: [],
      tutorialFlags: ["intro"],
      catchQuestsDone: [],
      items: { Egg: 1 },
      spirit: { energy: 10, savedXp: {}, usedThisTrip: [] },
    },
    location: { kind: "world", worldId: "World_1-1", poiId: "First_City" },
    decision: {
      type: "world.ready",
      decisionId: "world-First_City",
      selectablePoiIds: ["First_City"],
    },
    world: {
      worldId: "World_1-1",
      currentPoiId: "First_City",
      lastTownId: "First_City",
      dayNumber: 2,
      poiStates: { First_City: 2 },
      selectablePoiIds: ["First_City"],
      occurrenceByPoi: {},
      completedPoiIds: [],
      poiWins: {},
      everCompletedPoiIds: [],
    },
    quests: {
      activeQuestNames: ["MacworldCatch"],
      finishedQuestNames: [],
      progressByQuestName: { MacworldCatch: { quantity: 1 } },
      dialogsSeen: ["LeslieSaved"],
      completedFixedEncounterKeys: ["Fixed1"],
      receivedBattleRewardKeys: ["Reward1"],
    },
  };
}

function authority(initial: SlotProjectionV1): GameAuthority & {
  command: ReturnType<typeof vi.fn>;
  deleteSlot: ReturnType<typeof vi.fn>;
} {
  let current = initial;
  const command = vi.fn(async (_slot: string, envelope: GameCommandEnvelopeV1) => {
    current = { ...current, revision: envelope.expectedRevision + 1 };
    return {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: envelope.commandId,
      previousRevision: envelope.expectedRevision,
      revision: envelope.expectedRevision + 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" }],
      projection: current,
      idempotentReplay: false,
    } satisfies GameCommandResultV1;
  });
  const deleteSlot = vi.fn(async () => {});
  return {
    trustTier: "official",
    pack,
    slots: [{
      slotId: "slot-1",
      revision: initial.revision,
      updatedAt: "2026-07-28T12:00:00.000Z",
      logicPackId: pack.logicPackId,
      simulationVersion: pack.simulationVersion,
      trustTier: "official",
      activeDomain: "world",
    }],
    bootstrap: async () => current,
    command,
    deleteSlot,
    refreshSlots: async () => [],
    close: async () => {},
  };
}

describe("OfficialAuthoritySaveStore", () => {
  it("projects an authoritative slot into the existing read-only startup shape", async () => {
    const remote = authority(projection());
    const store = new OfficialAuthoritySaveStore(remote);
    const state = await store.loadSlotState("slot-1");
    expect(state?.player.profile).toMatchObject({
      hero: { level: 3, totalHighestLevels: 7 },
      silver: 90,
      tutorialFlags: ["intro"],
      dungeonItems: { Egg: 1 },
    });
    expect(state?.player.party).toMatchObject({
      kind: "world-trip-party",
      battingOrderSize: 6,
      monsters: [{ instanceId: "monster-1", cumulativeXp: 12, currentHp: 8 }],
    });
    expect(state?.world).toMatchObject({ dayNumber: 2, lastTownName: "First_City" });
    expect(state?.quests).toEqual({
      schemaVersion: 1,
      activeQuestNames: ["MacworldCatch"],
      finishedQuestNames: [],
      progressByQuestName: { MacworldCatch: { quantity: 1 } },
      dialogsSeen: ["LeslieSaved"],
      completedFixedEncounterKeys: ["Fixed1"],
      receivedBattleRewardKeys: ["Reward1"],
    });
  });

  it("never uploads a client-authored snapshot through the save compatibility surface", async () => {
    const remote = authority(projection());
    const store = new OfficialAuthoritySaveStore(remote);
    const state = await store.loadSlotState("slot-1");
    const session = store.open("slot-1");
    await session.save(state!);
    await session.flush();
    expect(remote.command).not.toHaveBeenCalled();
  });

  it("preserves the authoritative dungeon run for startup scene restoration", async () => {
    const base = projection();
    const route = { typeName: "Cave", sourceFile: "Dungeon_1.plist", floor: 1 };
    const session = {
      schemaVersion: 1 as const,
      definitionId: "Cave:Dungeon_1.plist:NorthCave",
      floor: 1,
      seed: 7,
      currentRoomId: "Room-{0, 0}",
      exploredRoomIds: ["Room-{0, 0}"],
      clearedEncounterIds: [],
      collectedTreasureIds: [],
      registeredWaypointFloors: [],
      completedKeys: [],
      catchTypes: [],
      catchRewardCollected: false,
    };
    const run = {
      schemaVersion: 1 as const,
      runSeed: 5,
      captureSerial: 0,
      terminalFlowSerial: 0,
      current: { route, session },
      cachedFloors: [{ route, session }],
      registeredWaypoints: [],
      completedKeys: [],
      catchTypes: [],
      completedCatchQuestInstances: [],
      catchRewardCollected: false,
    };
    const remote = authority({
      ...base,
      location: {
        kind: "dungeon",
        dungeonId: session.definitionId,
        floor: 1,
        roomId: session.currentRoomId,
      },
      decision: {
        type: "dungeon.ready",
        decisionId: "dungeon-Room",
        selectableRoomIds: [session.currentRoomId],
        activatableZoneIds: [],
      },
      dungeon: {
        run,
        worldId: "World_1-1",
        entrancePoiId: "Dungeon_1",
      },
    });
    const state = await new OfficialAuthoritySaveStore(remote).loadSlotState("slot-1");
    expect(state?.dungeon).toEqual(run);
  });

  it("restores the authority's Collection claims so a claimed goal cannot be claimed twice", async () => {
    // v13 narrowed the battle view's scene field and the Egg continuation's phasing, so neither
    // historical shape can ride the spread. The fixture sets neither.
    const { battle: _v11Battle, pendingEgg: _v11PendingEgg, ...base } = projection();
    const claimed: OfficialGameProjectionV13 = {
      ...base,
      simulationVersion: "official-game-v13",
      updatedAt: "2026-07-28T12:00:00.000Z",
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: ["CollectionQuestBase", "CollectionQuestCollector"],
      },
    };

    expect(projectionToGameState(claimed).player).toMatchObject({
      schemaVersion: 2,
      claimedCollectionGoalIds: ["CollectionQuestBase", "CollectionQuestCollector"],
    });
    // A v11 projection has no Collection domain at all, so it restores the empty set schema 1
    // already gave it — not a claim the authority never committed.
    expect(projectionToGameState(projection()).player).toMatchObject({
      schemaVersion: 2,
      claimedCollectionGoalIds: [],
    });
  });

  it("tracks coordinator commits without exposing server-side slot deletion", async () => {
    const remote = authority(projection());
    const store = new OfficialAuthoritySaveStore(remote);
    await store.loadSlotState("slot-1");
    await store.coordinator("slot-1").submit({
      type: "slot.create",
      starterElement: "Water",
    });
    expect("deleteSlot" in store).toBe(false);
    expect(remote.deleteSlot).not.toHaveBeenCalled();
  });
});
