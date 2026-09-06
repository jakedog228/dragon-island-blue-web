import { describe, expect, it } from "vitest";
import type { DungeonDefinition } from "@dib/gamedata/dungeon";
import {
  DungeonSession,
  DungeonSnapshotCompatibilityError,
  type DungeonMonster,
} from "../src/dungeon.js";
import { touchHleArc4Random } from "../src/rng.js";
import {
  DungeonRuntimeController,
  type DungeonRunSnapshot,
} from "../src/dungeonRuntime.js";

const dungeonDefinition = (): DungeonDefinition => ({
  typeName: "Test",
  sourceFile: "Dungeon_Test.plist",
  instanceName: "TestDungeon",
  startFloor: 1,
  mustClearFloor: true,
  presentation: {
    typeName: "Test",
    atlasNames: ["TestDungeonRoomFrames"],
    floorFrameFormat: "floor%d.png",
    floorFrameCount: 1,
    wallFrameFormat: "walls%d_%dx%d.png",
    wallFrameCount: 1,
    wallItemCount: 0,
    doorFrameFormat: "door%d.png",
    doorFrameCount: 1,
    northDoorFrame: "northDoor.png",
    combatBackgroundFile: "CaveCombat.png",
    chestFrame: "chest.png",
    portalFrame: "portal.png",
    stairsUpFrame: "stairsUp.png",
    stairsDownFrame: "stairsDown.png",
  },
  creation: {
    lastFloor: 5,
    density: 3,
    roomsMin: 8,
    roomsMax: 8,
    retryChance: 0.3,
    doorCycleAttempts: 1,
    nonHallwaysNeeded: 1,
    waypointEvery: 1,
    monsterLevelBase: 18,
    monsterLevelFloorScalor: 2,
    defaultItemSpawnChance: 0.25,
    roomChoiceBiasClass: "DefaultRoomChoiceBias",
    roomChoiceBiasDirection: { x: 0, y: 0 },
    roomChoiceBiasRandom: false,
    roomTemplates: [{
      key: "2x2",
      width: 2,
      height: 2,
      frequency: 10,
      rotations: [0],
      rendererClass: "RoomNode",
      anchor: { x: 0, y: 0 },
    }],
  },
  catchQuest: {
    challengeLevel: 1,
    types: ["Bat"],
    treasureData: { levelScalor: 1, items: [{ kind: "silver", levelScalor: 1 }] },
  },
  floorPopulations: [{
    sourceFloor: 1,
    monsterPopulator: {
      className: "DefaultMonsterPopulator",
      minMonstersPerPack: 1,
      maxMonstersPerPack: 1,
      levelScalor: 1,
      density: 1,
      types: [{ type: "Slime", chance: 100 }],
      fixedEncounters: [{
        sourceIndex: 0,
        exactFloor: 1,
        chanceToAppear: 1,
        uniqueKey: "fixed-save-me",
        monsters: [
          {
            type: "Bat",
            levelScalor: 1,
            extraLivingArguments: { boss: true, nested: [{ value: 2 }, null] },
          },
          { type: "Slime", levelScalor: 1 },
          { type: "Bat", levelScalor: 1 },
        ],
      }],
    },
    treasurePopulator: {
      className: "DefaultTreasurePopulator",
      unguardedTreasureChance: 0,
      treasureData: { levelScalor: 1, items: [{ kind: "silver", chance: 1, levelScalor: 1 }] },
    },
    zoneChanges: [
      { kind: "stairsDown", sourceType: "Down" },
      { kind: "stairsUp", sourceType: "Up" },
    ],
  }],
});

const route = { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 } as const;

function context(
  overrides: Partial<Parameters<typeof DungeonRuntimeController.enter>[0]> = {},
) {
  return {
    resources: { has: () => false, plist: () => undefined },
    monsterTypes: ["Slime", "Bat"],
    runSeed: 0x517a,
    seedFor: ({ floor }: { floor: number }) => 9000 + floor,
    definitionFor: () => dungeonDefinition(),
    ...overrides,
  };
}

function walkTo(session: DungeonSession, targetRoomId: string): void {
  const floor = session.state;
  const queue = [floor.currentRoomId];
  const previous = new Map<string, string>();
  while (queue.length > 0) {
    const roomId = queue.shift()!;
    if (roomId === targetRoomId) break;
    const room = floor.rooms.find((entry) => entry.id === roomId)!;
    for (const link of room.links) {
      if (link.targetRoomId === floor.currentRoomId || previous.has(link.targetRoomId)) continue;
      previous.set(link.targetRoomId, roomId);
      queue.push(link.targetRoomId);
    }
  }
  const path: string[] = [];
  for (let roomId = targetRoomId; roomId !== floor.currentRoomId;) {
    path.push(roomId);
    roomId = previous.get(roomId)!;
  }
  for (const roomId of path.reverse()) session.moveToRoom(roomId);
}

function enterFixedEncounter(run: DungeonRuntimeController) {
  const room = run.session.state.rooms.find((entry) => entry.encounter?.monsters.length === 3)!;
  const previous = run.session.state.rooms.find((entry) =>
    entry.links.some((link) => link.targetRoomId === room.id))!;
  walkTo(run.session, previous.id);
  run.session.moveToRoom(room.id);
  return { room, encounter: run.session.currentRoom.encounter! };
}

function legacySnapshot(
  currentPreviousRoomId?: string,
  cachedPreviousRoomId?: string,
): DungeonRunSnapshot {
  const floor = (floorNumber: number, previousRoomId?: string) => ({
    schemaVersion: 1 as const,
    definitionId: "Test:Dungeon_Test.plist:TestDungeon",
    floor: floorNumber,
    seed: floorNumber,
    currentRoomId: "room-0",
    ...(previousRoomId === undefined ? {} : { previousRoomId }),
    exploredRoomIds: ["room-0", "room-1"],
    clearedEncounterIds: [],
    collectedTreasureIds: [],
    registeredWaypointFloors: [],
    completedKeys: [],
    catchTypes: [],
    catchRewardCollected: false,
  });
  const current = { route, session: floor(1, currentPreviousRoomId) };
  const cached = { route: { ...route, floor: 2 }, session: floor(2, cachedPreviousRoomId) };
  return {
    schemaVersion: 1,
    runSeed: 4,
    captureSerial: 0,
    terminalFlowSerial: 0,
    current,
    cachedFloors: [current, cached],
    registeredWaypoints: [],
    completedKeys: [],
    catchTypes: [],
    completedCatchQuestInstances: [],
    catchRewardCollected: false,
  };
}

describe("DungeonRuntimeController terminal settlement", () => {
  it("settles the entered fixed encounter after its external completion gate flips", async () => {
    let completionSet = false;
    const event4: Array<readonly number[]> = [];
    const run = DungeonRuntimeController.enter(context({
      isCompletionSet: () => completionSet,
      onDungeonRoomRosterUpdated: (_instance, _floor, counts) => {
        event4.push([...counts]);
      },
    }), route);
    const { room, encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    completionSet = true;
    let persisted: DungeonRunSnapshot | undefined;
    let persistenceCalls = 0;

    const resolution = await run.settleEncounterTerminal(
      encounter,
      flow,
      "victory",
      [],
      ["Bat"],
      async (snapshot) => {
        persistenceCalls += 1;
        persisted = snapshot;
      },
    );

    expect(persistenceCalls).toBe(1);
    expect(event4).toHaveLength(1);
    const roomIndex = run.session.state.rooms.findIndex((entry) => entry.id === room.id);
    expect(event4[0]![roomIndex]).toBe(0);
    expect(resolution.entryActions.some((action) => action.kind === "treasure")).toBe(true);
    expect(run.catchQuestProgress()).toMatchObject({ captured: ["Bat"], complete: true });
    expect(run.session.currentRoom.encounter?.monsters).toEqual([]);
    expect(run.snapshot().current.session.clearedEncounterIds).toContain(encounter.id);
    expect(run.snapshot().current.session.encounterRosters).toEqual([]);

    const restored = DungeonRuntimeController.restore(context({
      isCompletionSet: () => true,
    }), persisted);
    expect(restored.session.state.rooms.find((entry) => entry.id === room.id)?.encounter?.monsters)
      .toEqual([]);
    expect(restored.session.currentRoom.id).toBe(room.id);
    expect(restored.session.enterCurrentRoom().some((action) => action.kind === "treasure")).toBe(true);
  });

  it("can consume an already-owned guarded treasure on the prospective terminal session", async () => {
    const run = DungeonRuntimeController.enter(context(), route);
    const { encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    let persisted: DungeonRunSnapshot | undefined;

    const resolution = await run.settleEncounterTerminal(
      encounter,
      flow,
      "victory",
      [],
      [],
      async (snapshot) => { persisted = snapshot; },
      (plan) => {
        const treasure = plan.entryActions.find((action) => action.kind === "treasure");
        expect(treasure?.kind).toBe("treasure");
        plan.consumeTreasure(treasure!.treasure.id);
      },
    );

    expect(resolution.entryActions.some((action) => action.kind === "treasure")).toBe(false);
    expect(persisted!.current.session.collectedTreasureIds).toHaveLength(1);
    const restored = DungeonRuntimeController.restore(context(), persisted);
    expect(restored.session.enterCurrentRoom().some((action) => action.kind === "treasure")).toBe(false);
  });

  it("freezes an omitted fixed encounter without reintroducing it when the gate later opens", () => {
    let completionSet = true;
    const run = DungeonRuntimeController.enter(context({
      isCompletionSet: () => completionSet,
    }), route);
    expect(run.session.state.rooms.some((room) => room.encounter?.kind === "fixed")).toBe(false);
    const saved = run.snapshot();
    completionSet = false;

    const restored = DungeonRuntimeController.restore(context({
      isCompletionSet: () => completionSet,
    }), saved);
    expect(restored.session.state.rooms.some((room) => room.encounter?.kind === "fixed")).toBe(false);
  });
});

describe("DungeonRuntimeController transaction boundaries", () => {
  it("rolls back a throwing hook commit before assigning the runtime and retries cleanly", () => {
    let failCommit = true;
    let rollbackCalls = 0;
    const run = DungeonRuntimeController.enter(context({
      onDungeonRoomRosterUpdated: () => ({
        rollback: () => { rollbackCalls += 1; },
        commit: () => {
          if (failCommit) throw new Error("hook commit rejected");
        },
      }),
    }), route);
    const { encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    const survivor = encounter.monsters[0]!;
    const before = run.snapshot();

    expect(() => run.synchronizeEncounterRoomRoster(encounter, flow, [survivor]))
      .toThrow("hook commit rejected");
    expect(run.snapshot()).toEqual(before);
    expect(rollbackCalls).toBe(1);

    failCommit = false;
    expect(run.synchronizeEncounterRoomRoster(encounter, flow, [survivor])).toBe(true);
    expect(run.session.currentRoom.encounter?.monsters).toEqual([survivor]);
  });

  it("keeps runtime/cache unchanged when persistence rejects and the hook rollback throws", async () => {
    let failRollback = true;
    const run = DungeonRuntimeController.enter(context({
      onDungeonRoomRosterUpdated: () => ({
        rollback: () => {
          if (failRollback) throw new Error("hook rollback rejected");
        },
      }),
    }), route);
    const { encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    const before = run.snapshot();

    await expect(run.settleEncounterTerminal(
      encounter,
      flow,
      "retreat",
      encounter.monsters.slice(1),
      [],
      async () => { throw new Error("persistence rejected"); },
    )).rejects.toBeInstanceOf(AggregateError);
    expect(run.snapshot()).toEqual(before);

    failRollback = false;
    await run.settleEncounterTerminal(
      encounter,
      flow,
      "retreat",
      encounter.monsters.slice(1),
      [],
      async () => undefined,
    );
    expect(run.session.currentRoom.id).not.toBe(encounter.id);
  });

  it("does not invoke a mutable restoration context after a prepare failure", async () => {
    let throwFromDefinition = false;
    const run = DungeonRuntimeController.enter(context({
      definitionFor: () => {
        if (throwFromDefinition) throw new Error("live restoration context used");
        return dungeonDefinition();
      },
      onDungeonRoomRosterUpdated: () => {
        throw new Error("hook prepare rejected");
      },
    }), route);
    const { encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    const before = run.snapshot();
    throwFromDefinition = true;

    await expect(run.settleEncounterTerminal(
      encounter,
      flow,
      "retreat",
      encounter.monsters.slice(1),
      [],
      async () => undefined,
    )).rejects.toThrow("hook prepare rejected");
    expect(run.snapshot()).toEqual(before);
  });

  it("rolls back registered terminal preparation when preparation throws", async () => {
    let rollbackCalls = 0;
    const run = DungeonRuntimeController.enter(context(), route);
    const { encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    const before = run.snapshot();

    await expect(run.settleEncounterTerminal(
      encounter,
      flow,
      "retreat",
      encounter.monsters.slice(1),
      [],
      async () => undefined,
      (preparation) => {
        preparation.registerRollback(() => { rollbackCalls += 1; });
        throw new Error("terminal preparation rejected");
      },
    )).rejects.toThrow("terminal preparation rejected");

    expect(rollbackCalls).toBe(1);
    expect(run.snapshot()).toEqual(before);
  });

  it("rolls back a throwing hook prepare through the registered rollback exactly once", async () => {
    let rollbackCalls = 0;
    const run = DungeonRuntimeController.enter(context({
      onDungeonRoomRosterUpdated: (_instance, _floor, _counts, _flow, registerRollback) => {
        registerRollback(() => { rollbackCalls += 1; });
        throw new Error("hook prepare rejected");
      },
    }), route);
    const { encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    const before = run.snapshot();

    await expect(run.settleEncounterTerminal(
      encounter,
      flow,
      "retreat",
      encounter.monsters.slice(1),
      [],
      async () => undefined,
    )).rejects.toThrow("hook prepare rejected");

    expect(rollbackCalls).toBe(1);
    expect(run.snapshot()).toEqual(before);
  });

  it("accepts the application hook before persistence and never calls it after persistence", async () => {
    let persistenceResolved = false;
    let acceptedCalls = 0;
    let rollbackCalls = 0;
    const run = DungeonRuntimeController.enter(context({
      onDungeonRoomRosterUpdated: () => ({
        rollback: () => { rollbackCalls += 1; },
        commit: () => {
          if (persistenceResolved) throw new Error("post-persist callback reached");
          acceptedCalls += 1;
        },
      }),
    }), route);
    const { encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);

    await run.settleEncounterTerminal(
      encounter,
      flow,
      "retreat",
      encounter.monsters.slice(1),
      [],
      async () => { persistenceResolved = true; },
    );

    expect(acceptedCalls).toBe(1);
    expect(rollbackCalls).toBe(0);
  });

  it("retries after persistence rejects following pre-persist hook acceptance", async () => {
    let rejectPersistence = true;
    let acceptedCalls = 0;
    let rollbackCalls = 0;
    const run = DungeonRuntimeController.enter(context({
      onDungeonRoomRosterUpdated: () => ({
        rollback: () => { rollbackCalls += 1; },
        commit: () => { acceptedCalls += 1; },
      }),
    }), route);
    const { encounter } = enterFixedEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    const survivor = encounter.monsters.slice(1);
    const before = run.snapshot();

    await expect(run.settleEncounterTerminal(
      encounter,
      flow,
      "retreat",
      survivor,
      [],
      async () => {
        if (rejectPersistence) {
          rejectPersistence = false;
          throw new Error("persistence rejected");
        }
      },
    )).rejects.toThrow("persistence rejected");
    expect(run.snapshot()).toEqual(before);
    expect({ acceptedCalls, rollbackCalls }).toEqual({ acceptedCalls: 1, rollbackCalls: 1 });

    await run.settleEncounterTerminal(
      encounter,
      flow,
      "retreat",
      survivor,
      [],
      async () => undefined,
    );
    expect({ acceptedCalls, rollbackCalls }).toEqual({ acceptedCalls: 2, rollbackCalls: 1 });
  });

  it("rolls back a pre-battle flow from its exact working copy without regenerating", () => {
    let throwFromDefinition = false;
    const run = DungeonRuntimeController.enter(context({
      definitionFor: () => {
        if (throwFromDefinition) throw new Error("live restoration context used");
        return dungeonDefinition();
      },
    }), route);
    const before = run.snapshot();
    const flow = run.allocateTerminalFlowIdentity("encounter-fixed-0");
    throwFromDefinition = true;

    run.rollbackUncommittedTerminalFlow(flow, before);

    expect(run.snapshot()).toEqual(before);
    expect(run.allocateTerminalFlowIdentity("encounter-fixed-0").id).toContain("-1-");
  });
});

describe("legacy dungeon topology migration", () => {
  it("restores native-id offline saves written by the pre-correction generator", () => {
    const historicalContext = context({ legacyDungeonGenerationSemantics: true });
    const historical = DungeonRuntimeController.enter(historicalContext, route);
    const saved = historical.snapshot();
    const historicalRoomIds = historical.session.state.rooms.map(({ id }) => id);
    const historicalSession = {
      ...saved.current.session,
      exploredRoomIds: historicalRoomIds,
    };
    const historicalSave: DungeonRunSnapshot = {
      ...saved,
      current: { ...saved.current, session: historicalSession },
      cachedFloors: saved.cachedFloors.map((entry) =>
        entry.route.typeName === saved.current.route.typeName &&
        entry.route.sourceFile === saved.current.route.sourceFile &&
        entry.route.floor === saved.current.route.floor
          ? { ...entry, session: historicalSession }
          : entry),
    };

    expect(() => DungeonRuntimeController.restore(context(), historicalSave))
      .toThrow(/dungeon (snapshot|room)/i);

    const restored = DungeonRuntimeController.restore(
      context({ allowLegacyDungeonGenerationRestore: true }),
      historicalSave,
    );
    expect(restored.restoredLegacyGeneration).toBe(true);
    expect(restored.migratedLegacyTopology).toBe(false);
    expect(restored.session.state.rooms.map(({ id }) => id)).toEqual(historicalRoomIds);
    expect(restored.snapshot().current.session.exploredRoomIds).toEqual(historicalRoomIds);

    const corruptSession = {
      ...historicalSession,
      exploredRoomIds: ["Cave.Missing-{999, 999}"],
    };
    const corrupt = {
      ...historicalSave,
      current: { ...historicalSave.current, session: corruptSession },
      cachedFloors: historicalSave.cachedFloors.map((entry) =>
        entry.route.typeName === historicalSave.current.route.typeName &&
        entry.route.sourceFile === historicalSave.current.route.sourceFile &&
        entry.route.floor === historicalSave.current.route.floor
          ? { ...entry, session: corruptSession }
          : entry),
    };
    let restoreError: unknown;
    try {
      DungeonRuntimeController.restore(
        context({ allowLegacyDungeonGenerationRestore: true }),
        corrupt,
      );
    } catch (error) {
      restoreError = error;
    }
    expect(restoreError).toBeInstanceOf(DungeonSnapshotCompatibilityError);
    expect((restoreError as Error).message).toMatch(/dungeon snapshot current room is missing/i);
  });

  it("validates current and cached previousRoomId before discarding legacy geometry", () => {
    const missing = legacySnapshot("missing-room");
    expect(() => DungeonRuntimeController.restore(context(), missing)).toThrow(/previous room missing-room/);

    const unexplored = legacySnapshot("room-2");
    expect(() => DungeonRuntimeController.restore(context(), unexplored)).toThrow(/missing|unsupported|not explored/);

    const currentRoom = legacySnapshot("room-0");
    expect(() => DungeonRuntimeController.restore(context(), currentRoom)).toThrow(/differ from current/);

    const cachedMissing = legacySnapshot(undefined, "missing-room");
    expect(() => DungeonRuntimeController.restore(context(), cachedMissing)).toThrow(/previous room missing-room/);

    const cachedUnexplored = legacySnapshot(undefined, "room-2");
    expect(() => DungeonRuntimeController.restore(context(), cachedUnexplored)).toThrow(/missing|unsupported|not explored/);

    const cachedCurrent = legacySnapshot(undefined, "room-0");
    expect(() => DungeonRuntimeController.restore(context(), cachedCurrent)).toThrow(/differ from current/);
  });

  it("preserves legacy migration with a valid previous room and with the documented omission", () => {
    const valid = DungeonRuntimeController.restore(context(), legacySnapshot("room-1", "room-1"));
    expect(valid.migratedLegacyTopology).toBe(true);

    const omitted = DungeonRuntimeController.restore(context(), legacySnapshot());
    expect(omitted.migratedLegacyTopology).toBe(true);
  });

  it.each([
    ["cleared encounters", { clearedEncounterIds: ["legacy-encounter"] }],
    ["collected treasure", { collectedTreasureIds: ["legacy-treasure"] }],
    ["empty encounter roster", { encounterRosters: [] }],
    ["generation decisions", { generationGateDecisions: [] }],
    ["discarded waypoint state", { registeredWaypointFloors: [1] }],
    ["unverified catch progress", { catchTypes: ["Bat"] }],
    ["unverified floor completion", { completedKeys: ["legacy-completion"] }],
    ["conflicting catch reward", { catchRewardCollected: true }],
  ] as const)("rejects %s on the current legacy floor instead of discarding it", (_name, change) => {
    const base = legacySnapshot();
    const currentSession = { ...base.current.session, ...change };
    const value = {
      ...base,
      current: { ...base.current, session: currentSession },
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 1
        ? { ...entry, session: { ...currentSession } }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), value)).toThrow(/legacy.*(cannot|unsupported|discard|verify)/i);
  });

  it.each([
    ["cleared encounters", { clearedEncounterIds: ["legacy-encounter"] }],
    ["collected treasure", { collectedTreasureIds: ["legacy-treasure"] }],
    ["empty encounter roster", { encounterRosters: [] }],
    ["generation decisions", { generationGateDecisions: [] }],
    ["unverified catch progress", { catchTypes: ["Bat"] }],
    ["unverified floor completion", { completedKeys: ["legacy-completion"] }],
    ["conflicting catch reward", { catchRewardCollected: true }],
  ] as const)("rejects %s on a cached legacy floor before migration", (_name, change) => {
    const base = legacySnapshot();
    const value = {
      ...base,
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 2
        ? { ...entry, session: { ...entry.session, ...change } }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), value)).toThrow(/legacy.*(cannot|unsupported|discard|verify)/i);
  });

  it("rejects contradictory legacy floor progress and impossible current/cache room state", () => {
    const base = legacySnapshot();
    const contradictory = {
      ...base,
      current: {
        ...base.current,
        session: { ...base.current.session, completedKeys: ["not-run-level"] },
      },
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 1
        ? { ...entry, session: { ...entry.session, completedKeys: ["not-run-level"] } }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), contradictory)).toThrow(/legacy.*(run-level|discard|verify)/i);

    const cachedImpossible = {
      ...base,
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 2
        ? {
            ...entry,
            session: { ...entry.session, currentRoomId: "room-2", exploredRoomIds: ["room-0"] },
          }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), cachedImpossible)).toThrow(/legacy.*(current|explored|unsupported)/i);

    const currentImpossibleSession = {
      ...base.current.session,
      currentRoomId: "room-2",
      exploredRoomIds: ["room-0"],
    };
    const currentImpossible = {
      ...base,
      current: { ...base.current, session: currentImpossibleSession },
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 1
        ? { ...entry, session: { ...currentImpossibleSession } }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), currentImpossible)).toThrow(/legacy.*(current|explored|unsupported)/i);

    const currentFloorMismatchSession = { ...base.current.session, floor: 2 };
    const currentFloorMismatch = {
      ...base,
      current: { ...base.current, session: currentFloorMismatchSession },
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 1
        ? { ...entry, session: { ...entry.session, floor: 2 } }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), currentFloorMismatch))
      .toThrow(/floor.*mismatch/i);

    const cachedFloorMismatch = {
      ...base,
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 2
        ? { ...entry, session: { ...entry.session, floor: 1 } }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), cachedFloorMismatch))
      .toThrow(/floor.*mismatch/i);

    const explicitConflict = {
      ...base,
      current: {
        ...base.current,
        session: {
          ...base.current.session,
          clearedEncounterIds: ["legacy-encounter"],
          encounterRosters: [],
        },
      },
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 1
        ? {
            ...entry,
            session: {
              ...entry.session,
              clearedEncounterIds: ["legacy-encounter"],
              encounterRosters: [],
            },
          }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), explicitConflict)).toThrow(/legacy.*(cleared|roster|verify)/i);
  });

  it("validates every legacy floor definition and preserves proven cached waypoints", () => {
    const base = legacySnapshot();
    const current = {
      ...base.current,
      session: { ...base.current.session, registeredWaypointFloors: [1] },
    };
    const cached = base.cachedFloors.map((entry) => entry.route.floor === 2
      ? { ...entry, session: { ...entry.session, registeredWaypointFloors: [2] } }
      : entry);
    const legacy = {
      ...base,
      current,
      cachedFloors: [current, ...cached.filter((entry) => entry.route.floor !== 1)],
      registeredWaypoints: [
        { route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 } },
        { route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 2 } },
      ],
    };

    const restored = DungeonRuntimeController.restore(context(), legacy);
    expect(restored.availableWaypoints()).toEqual([
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 2 },
    ]);
    const canonical = restored.snapshot();
    expect(canonical.current.session.currentRoomId).not.toMatch(/^room-/);
    expect(() => DungeonRuntimeController.restore(context(), JSON.parse(JSON.stringify(canonical)))).not.toThrow();
    expect(DungeonRuntimeController.restore(context(), canonical).availableWaypoints())
      .toEqual(restored.availableWaypoints());

    const currentMismatchSession = {
      ...base.current.session,
      definitionId: "Test:Dungeon_Test.plist:ForeignDungeon",
    };
    const currentMismatch = {
      ...base,
      current: { ...base.current, session: currentMismatchSession },
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 1
        ? { ...entry, session: { ...currentMismatchSession } }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), currentMismatch))
      .toThrow(/definition mismatch/);

    const cachedMismatch = {
      ...base,
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 2
        ? {
            ...entry,
            session: { ...entry.session, definitionId: "Test:Dungeon_Test.plist:ForeignDungeon" },
          }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context(), cachedMismatch))
      .toThrow(/definition mismatch/);
  });

  it("rejects legacy catch reward and instance contradictions on current and cached floors", () => {
    const base = legacySnapshot();
    const currentCompleted = {
      ...base,
      completedCatchQuestInstances: ["TestDungeon"],
    };
    expect(() => DungeonRuntimeController.restore(context(), currentCompleted))
      .toThrow(/legacy.*catch.*(reward|instance)|catch.*instance/i);

    const missingInstance = {
      ...base,
      current: {
        ...base.current,
        session: { ...base.current.session, catchRewardCollected: true },
      },
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 1
        ? { ...entry, session: { ...entry.session, catchRewardCollected: true } }
        : entry),
      catchRewardCollected: true,
    };
    expect(() => DungeonRuntimeController.restore(context(), missingInstance))
      .toThrow(/legacy.*catch.*(reward|instance)|catch.*instance/i);

    const cachedReward = {
      ...base,
      current: {
        ...base.current,
        session: { ...base.current.session, catchRewardCollected: true },
      },
      cachedFloors: base.cachedFloors.map((entry) =>
        entry.route.floor === 1
          ? { ...entry, session: { ...entry.session, catchRewardCollected: true } }
          : { ...entry, session: { ...entry.session, catchRewardCollected: true } }),
      completedCatchQuestInstances: ["TestDungeon"],
      catchRewardCollected: true,
    };
    expect(DungeonRuntimeController.restore(context(), cachedReward).snapshot())
      .toMatchObject({ catchRewardCollected: true, completedCatchQuestInstances: ["TestDungeon"] });

    const otherDefinition = { ...dungeonDefinition(), instanceName: "OtherDungeon" };
    const crossDefinition = {
      ...base,
      cachedFloors: base.cachedFloors.map((entry) => entry.route.floor === 2
        ? {
            ...entry,
            session: {
              ...entry.session,
              definitionId: "Test:Dungeon_Test.plist:OtherDungeon",
              catchRewardCollected: true,
            },
          }
        : entry),
      completedCatchQuestInstances: ["OtherDungeon"],
      catchRewardCollected: false,
    };
    const crossRestored = DungeonRuntimeController.restore(context({
      definitionFor: (candidate) => candidate.floor === 2 ? otherDefinition : dungeonDefinition(),
    }), crossDefinition);
    expect(crossRestored.snapshot()).toMatchObject({
      catchRewardCollected: false,
      completedCatchQuestInstances: ["OtherDungeon"],
    });

    const unknownInstance = {
      ...base,
      completedCatchQuestInstances: ["ForeignDungeon"],
    };
    expect(() => DungeonRuntimeController.restore(context(), unknownInstance))
      .toThrow(/legacy.*catch.*instance|catch.*instance/i);
  });
});

describe("direct dungeon roster JSON boundaries", () => {
  it("accepts ordinary nested shipped-style JSON and rejects malformed direct prepare inputs", () => {
    const session = DungeonSession.create(dungeonDefinition(), 1, 0x5151, { monsterTypes: ["Slime", "Bat"] });
    const room = session.state.rooms.find((entry) => entry.encounter?.monsters.length === 3)!;
    const previous = session.state.rooms.find((entry) =>
      entry.links.some((link) => link.targetRoomId === room.id))!;
    walkTo(session, previous.id);
    session.moveToRoom(room.id);
    const encounter = session.currentRoom.encounter!;
    const validMonster = encounter.monsters[0]! satisfies DungeonMonster;
    expect(session.prepareEncounterRoomRoster(encounter.id, "flow-valid", [validMonster]).changed).toBe(true);

    const malformed = [
      Object.assign([], [validMonster], { extra: true }),
      Object.assign([validMonster], { [Symbol("extra")]: true }),
      (() => { const value = [validMonster] as DungeonMonster[]; delete value[0]; return value; })(),
      (() => { const value = [validMonster] as DungeonMonster[]; Object.setPrototypeOf(value, {}); return value; })(),
      (() => {
        const value = { ...validMonster };
        Object.setPrototypeOf(value, null);
        return [value];
      })(),
      (() => {
        const value = { ...validMonster };
        Object.defineProperty(value, "extra", { value: true, enumerable: false });
        return [value];
      })(),
      (() => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        return [{ ...validMonster, extraLivingArguments: cycle }];
      })(),
      [{ ...validMonster, extraLivingArguments: { value: Number.NaN } }],
    ];
    for (const value of malformed) {
      expect(() => session.prepareEncounterRoomRoster(encounter.id, `flow-${malformed.indexOf(value)}`, value))
        .toThrow(/ordinary|symbol|extra|holes|cycle|JSON-safe|enumerable/);
    }
  });

  it("applies the same strict tree boundary to direct restore inputs", () => {
    const session = DungeonSession.create(dungeonDefinition(), 1, 0x5152, { monsterTypes: ["Slime", "Bat"] });
    const room = session.state.rooms.find((entry) => entry.encounter?.monsters.length === 3)!;
    const previous = session.state.rooms.find((entry) =>
      entry.links.some((link) => link.targetRoomId === room.id))!;
    walkTo(session, previous.id);
    session.moveToRoom(room.id);
    const encounter = session.currentRoom.encounter!;
    const { previousRoomId: _previousRoomId, ...base } = session.snapshot();
    const roster = { encounterId: encounter.id, monsters: [encounter.monsters[0]!] };
    const badSnapshots: unknown[] = [
      { ...base, encounterRosters: [roster, roster] },
      { ...base, encounterRosters: Object.assign([roster], { extra: true }) },
      (() => {
        const value = { ...base, encounterRosters: [roster] } as Record<PropertyKey, unknown>;
        Object.defineProperty(value, Symbol("extra"), { value: true });
        return value;
      })(),
      (() => {
        const value = { ...base, encounterRosters: [roster] } as Record<string, unknown>;
        Object.setPrototypeOf(value, { bad: true });
        return value;
      })(),
      (() => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        return { ...base, encounterRosters: [{ ...roster, monsters: [{
          ...encounter.monsters[0]!, extraLivingArguments: cycle,
        }] }] };
      })(),
    ];
    for (const value of badSnapshots) {
      expect(() => DungeonSession.restore(dungeonDefinition(), value as never, {
        monsterTypes: ["Slime", "Bat"],
      })).toThrow(/duplicate|extra|symbol|ordinary|cycle|JSON-safe/);
    }
  });

  // The Fidelity Lab substitutes one shared, ever-advancing TouchHLE stream for the seed-derived
  // generator so the port draws exactly what the emulator draws. Every regeneration of an already
  // generated floor -- the constructor's own run-progress overlay, a cached floor, a reload --
  // must still reproduce that floor, or the saved room identities validate against a different
  // graph and dungeon entry fails with "Dungeon snapshot current room is missing".
  describe("Fidelity Lab shared TouchHLE stream", () => {
    it("enters a dungeon and regenerates the identical floor", () => {
      const fidelityRng = touchHleArc4Random(0, 0);
      const run = DungeonRuntimeController.enter(context({ fidelityRng }), route);
      const floor = run.session.state;
      expect(floor.rooms.length).toBeGreaterThan(0);

      const regenerated = DungeonSession.restore(dungeonDefinition(), run.session.snapshot(), {
        monsterTypes: ["Slime", "Bat"],
        fidelityRng,
      });
      expect(regenerated.state.rooms.map((room) => room.id)).toEqual(floor.rooms.map((room) => room.id));
      expect(regenerated.currentRoom.id).toBe(floor.currentRoomId);
    });

    it("keeps the shared stream on the emulator's draw sequence across regenerations", () => {
      const fidelityRng = touchHleArc4Random(0, 0);
      const run = DungeonRuntimeController.enter(context({ fidelityRng }), route);
      // The constructor already regenerated this floor once for its run-progress overlay.
      const afterEntry = fidelityRng.cursor;
      expect(afterEntry).toBeGreaterThan(0);

      DungeonSession.restore(dungeonDefinition(), run.session.snapshot(), {
        monsterTypes: ["Slime", "Bat"],
        fidelityRng,
      });
      // A replayed floor consumes no draw the emulator never made.
      expect(fidelityRng.cursor).toBe(afterEntry);

      // A floor this stream has not generated before still advances it.
      DungeonSession.create(dungeonDefinition(), 2, 9002, {
        monsterTypes: ["Slime", "Bat"],
        fidelityRng,
      });
      expect(fidelityRng.cursor).toBeGreaterThan(afterEntry);
    });

    it("rejects a debug stream that cannot be forked", () => {
      const unforkable = { next: () => 0.5, intBelow: (n: number) => n - 1, chance: () => true };
      expect(() => DungeonSession.create(dungeonDefinition(), 1, 9001, {
        monsterTypes: ["Slime", "Bat"],
        fidelityRng: unforkable,
      })).toThrow(/forkable/i);
    });
  });
});
