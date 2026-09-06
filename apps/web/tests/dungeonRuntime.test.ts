import { describe, expect, it } from "vitest";
import type { DungeonDefinition } from "@dib/gamedata/dungeon";
import type { DungeonSession } from "@dib/engine/dungeon";
import {
  DungeonRuntimeController,
  dungeonCaptureInstanceId,
  dungeonTerminalFlowIdentity,
  type DungeonTerminalPreparation,
  parseDungeonRunSnapshot,
  type DungeonRunSnapshot,
} from "@dib/engine/dungeon-runtime";

function flow(floor: number, id: string) {
  return dungeonTerminalFlowIdentity(
    { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor },
    id,
  );
}

function minimalSnapshot() {
  const route = { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 };
  const session = {
    schemaVersion: 1 as const,
    definitionId: "Test:Dungeon_Test.plist:TestDungeon",
    floor: 1,
    seed: 55,
    currentRoomId: "room-0",
    exploredRoomIds: ["room-0"],
    clearedEncounterIds: [],
    collectedTreasureIds: [],
    registeredWaypointFloors: [],
    completedKeys: [],
    catchTypes: [],
    catchRewardCollected: false,
  };
  return {
    schemaVersion: 1 as const,
    runSeed: 8,
    captureSerial: 0,
    current: { route, session },
    cachedFloors: [{ route: { ...route }, session: { ...session } }],
    registeredWaypoints: [],
    completedKeys: [],
    catchTypes: [],
    completedCatchQuestInstances: [],
    catchRewardCollected: false,
  };
}

function enterSaveMeEncounter(run: DungeonRuntimeController) {
  const encounterRoom = run.session.state.rooms.find((room) => room.encounter?.monsters.length === 3)!;
  const prior = run.session.state.rooms.find((room) =>
    room.links.some((link) => link.targetRoomId === encounterRoom.id))!;
  walkTo(run.session, (room) => room.id === prior.id);
  run.session.moveToRoom(encounterRoom.id);
  return run.session.currentRoom.encounter!;
}

function definition(floor: number): DungeonDefinition {
  return {
    typeName: "Test", sourceFile: "Dungeon_Test.plist", instanceName: "TestDungeon", startFloor: floor,
    mustClearFloor: false,
    presentation: { typeName: "Test", atlasNames: ["Test"], floorFrameFormat: "floor%d.png", floorFrameCount: 1,
      wallFrameFormat: "walls%d_%dx%d.png", wallFrameCount: 1, wallItemCount: 0,
      doorFrameFormat: "door%d.png", doorFrameCount: 1, northDoorFrame: "north.png", combatBackgroundFile: "CaveCombat.png",
      chestFrame: "chest.png", portalFrame: "portal.png", stairsUpFrame: "stairsUp.png", stairsDownFrame: "stairsDown.png" },
    creation: { lastFloor: 5, density: 1, roomsMin: 6, roomsMax: 6, retryChance: .3, doorCycleAttempts: 0,
      nonHallwaysNeeded: 0, waypointEvery: 1, monsterLevelBase: 1, monsterLevelFloorScalor: 1,
      defaultItemSpawnChance: .25, roomChoiceBiasClass: "DefaultRoomChoiceBias", roomChoiceBiasDirection: { x: 0, y: 0 },
      roomChoiceBiasRandom: false,
      roomTemplates: [{ key: "2x2", width: 2, height: 2, frequency: 1, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } }] },
    floorPopulations: [{ sourceFloor: 1, zoneChanges: [{ kind: "stairsDown", sourceType: "Down" }, { kind: "stairsUp", sourceType: "Up" }] }],
  };
}

function saveMeDefinition(floor: number): DungeonDefinition {
  const source = definition(floor);
  const population = source.floorPopulations[0]!;
  const fixed = {
    sourceIndex: 0,
    exactFloor: 1,
    chanceToAppear: 1,
    uniqueKey: "save-me",
    monsters: [],
  };
  return {
    ...source,
    catchQuest: {
      challengeLevel: 1,
      types: ["Bat", "Slime"],
      treasureData: { levelScalor: 1, items: [{ kind: "silver", levelScalor: 1 }] },
    },
    floorPopulations: [{
      ...population,
      monsterPopulator: {
        className: "DefaultMonsterPopulator",
        minMonstersPerPack: 1,
        maxMonstersPerPack: 1,
        levelScalor: 1,
        density: 1,
        types: [{ type: "Bat", chance: 100 }],
        fixedEncounters: [{
          ...fixed,
          monsters: [
            { type: "Bat", levelScalor: 1 },
            { type: "Slime", levelScalor: 1 },
            { type: "Bat", levelScalor: 1 },
          ],
        }],
      },
    }],
  };
}

function walkTo(session: DungeonSession, predicate: (room: DungeonSession["state"]["rooms"][number]) => boolean): void {
  // A real run enters its start room before it can move (`DungeonNode.prepareStart` ->
  // `enterCurrentRoom`). Fixtures that walk from the start need that too: when the target is the
  // start room itself the path below is empty, and the room would otherwise stay unexplored.
  session.enterCurrentRoom();
  const floor = session.state; const target = floor.rooms.find(predicate)!;
  const queue = [floor.currentRoomId];
  const prev = new Map<string, string>();
  while (queue.length) { const id = queue.shift()!; if (id === target.id) break;
    const room = floor.rooms.find((item) => item.id === id)!;
    for (const link of room.links) { const next = link.targetRoomId;
      if (next !== floor.currentRoomId && !prev.has(next)) { prev.set(next, id); queue.push(next); }
    }
  }
  const path: string[] = [];
  for (let id = target.id; id !== floor.currentRoomId;) { path.push(id); id = prev.get(id)!; }
  for (const id of path.reverse()) session.moveToRoom(id);
}

describe("DungeonRuntimeController cache and navigation", () => {
  it("claims the non-permanent floor presence once per cached floor and not across restore", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined }, monsterTypes: ["Slime"],
      runSeed: 0x1233,
      definitionFor: ({ floor }: { floor: number }) => definition(floor),
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    );
    expect(run.claimCurrentFloorPresence()).toBe(true);
    expect(run.claimCurrentFloorPresence()).toBe(false);
    const restored = DungeonRuntimeController.restore(
      context,
      JSON.parse(JSON.stringify(run.snapshot())),
    );
    expect(restored.claimCurrentFloorPresence()).toBe(true);
  });

  it("caches floors, carries waypoint state, and restores a JSON-safe run snapshot", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined }, monsterTypes: ["Slime"],
      runSeed: 0x1234,
      seedFor: ({ floor }: { floor: number }) => 1000 + floor,
      definitionFor: ({ floor }: { floor: number }) => definition(floor),
    };
    const run = DungeonRuntimeController.enter(context, { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 });
    walkTo(run.session, (room) => room.waypoint); run.registerWaypoint();
    walkTo(run.session, (room) => room.zones.some((zone) => zone.change.kind === "stairsDown"));
    const down = run.session.currentRoom.zones.find((zone) => zone.change.kind === "stairsDown")!;
    expect(run.activateZone(down.id)).toMatchObject({ kind: "floor", route: { floor: 2 }, restoredFromCache: false });
    expect(run.session.currentRoom.zones.some((zone) => zone.change.kind === "stairsUp")).toBe(true);
    walkTo(run.session, (room) => room.waypoint); run.registerWaypoint();
    expect(run.availableWaypointFloors()).toEqual([1, 2]);
    expect(run.travelToWaypoint(1)).toBe(true);
    expect(run.session.currentRoom.waypoint).toBe(true);
    const snapshot = JSON.parse(JSON.stringify(run.snapshot()));
    const restored = DungeonRuntimeController.restore(context, snapshot);
    expect(snapshot.runSeed).toBe(0x1234);
    expect(snapshot.captureSerial).toBe(0);
    expect(snapshot.registeredWaypoints.map((waypoint: { route: { floor: number } }) => waypoint.route.floor)).toEqual([1, 2]);
    expect(restored.route.floor).toBe(1);
    expect(restored.availableWaypointFloors()).toEqual([1, 2]);
    expect(restored.snapshot()).toEqual(run.snapshot());
  });

  it("rejects an invalid previous room on both the current and cached floor", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime"],
      runSeed: 0x1235,
      seedFor: ({ floor }: { floor: number }) => 2000 + floor,
      definitionFor: ({ floor }: { floor: number }) => definition(floor),
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    );
    walkTo(run.session, (room) => room.waypoint);
    run.registerWaypoint();
    walkTo(run.session, (room) => room.zones.some((zone) => zone.change.kind === "stairsDown"));
    const down = run.session.currentRoom.zones.find((zone) => zone.change.kind === "stairsDown")!;
    expect(run.activateZone(down.id)).toMatchObject({ kind: "floor", route: { floor: 2 } });
    walkTo(run.session, (room) => room.waypoint);
    run.registerWaypoint();
    expect(run.travelToWaypoint(1)).toBe(true);
    const saved = structuredClone(run.snapshot());
    const currentInvalid = {
      ...saved,
      current: {
        ...saved.current,
        session: {
          ...saved.current.session,
          previousRoomId: saved.current.session.currentRoomId,
        },
      },
      cachedFloors: saved.cachedFloors.map((entry) => entry.route.floor === saved.current.route.floor
        ? {
            ...entry,
            session: {
              ...entry.session,
              previousRoomId: saved.current.session.currentRoomId,
            },
          }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context, currentInvalid))
      .toThrow(/previous room .* differ from current room/);

    const cachedInvalid = structuredClone(saved);
    const floorTwo = cachedInvalid.cachedFloors.find((entry) => entry.route.floor === 2);
    expect(floorTwo).toBeDefined();
    const cachedWithInvalidPrevious = {
      ...cachedInvalid,
      cachedFloors: cachedInvalid.cachedFloors.map((entry) => entry === floorTwo
        ? {
            ...entry,
            session: {
              ...entry.session,
              previousRoomId: entry.session.currentRoomId,
            },
          }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context, cachedWithInvalidPrevious))
      .toThrow(/previous room .* differ from current room/);
  });

  it("semantically validates a foreign roster on a cached authoritative floor", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1236,
      seedFor: ({ floor }: { floor: number }) => 2100 + floor,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    walkTo(run.session, (room) => room.zones.some((zone) => zone.change.kind === "stairsDown"));
    const down = run.session.currentRoom.zones.find((zone) => zone.change.kind === "stairsDown")!;
    expect(run.activateZone(down.id)).toMatchObject({ kind: "floor", route: { floor: 2 } });
    const cachedEncounter = run.session.state.rooms.find((room) => room.encounter !== undefined)?.encounter;
    expect(cachedEncounter).toBeDefined();
    walkTo(run.session, (room) => room.zones.some((zone) => zone.change.kind === "stairsUp"));
    const up = run.session.currentRoom.zones.find((zone) => zone.change.kind === "stairsUp")!;
    expect(run.activateZone(up.id)).toMatchObject({ kind: "floor", route: { floor: 1 } });
    const saved = run.snapshot();
    const cached = saved.cachedFloors.find((entry) => entry.route.floor === 2)!;
    const foreign = {
      ...saved,
      cachedFloors: saved.cachedFloors.map((entry) => entry === cached
        ? {
            ...entry,
            session: {
              ...entry.session,
              encounterRosters: [{
                encounterId: cachedEncounter!.id,
                monsters: [{ type: "not-installed", level: 1 }],
              }],
            },
          }
        : entry),
    };
    expect(() => DungeonRuntimeController.restore(context, foreign))
      .toThrow(/ordered subsequence|monster type not-installed|Dungeon snapshot/);
  });

  it("persists a synchronized survivor roster through run restore and cached-floor round trips", () => {
    const rosterEvents: Array<{ instanceName: string; floor: number; counts: readonly number[] }> = [];
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1237,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
      onDungeonRoomRosterUpdated: (instanceName: string, floor: number, counts: readonly number[]) => {
        rosterEvents.push({ instanceName, floor, counts });
      },
    };
    const route = { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 };
    const run = DungeonRuntimeController.enter(context, route);
    walkTo(run.session, (room) => room.waypoint);
    run.registerWaypoint();
    const encounterRoom = run.session.state.rooms.find((room) => room.encounter?.monsters.length === 3)!;
    const prior = run.session.state.rooms.find((room) =>
      room.links.some((link) => link.targetRoomId === encounterRoom.id))!;
    walkTo(run.session, (room) => room.id === prior.id);
    run.session.moveToRoom(encounterRoom.id);
    const encounter = run.session.currentRoom.encounter!;
    const survivor = encounter.monsters[1]!;
    expect(run.synchronizeEncounterRoomRoster(encounter, flow(1, "flow-1"), [survivor])).toBe(true);
    expect(() => run.synchronizeEncounterRoomRoster(encounter, flow(1, "flow-1"), [])).toThrow(/conflicts/);
    expect(rosterEvents).toHaveLength(1);
    expect(rosterEvents[0]).toMatchObject({ instanceName: "TestDungeon", floor: 1 });

    const saved = run.snapshot();
    const roster = saved.current.session.encounterRosters![0]!;
    expect(() => parseDungeonRunSnapshot({
      ...saved,
      current: {
        ...saved.current,
        session: { ...saved.current.session, encounterRosters: [roster, roster] },
      },
    })).toThrow(/duplicate encounter/);

    const restored = DungeonRuntimeController.restore(context, JSON.parse(JSON.stringify(saved)));
    expect(restored.session.currentRoom.encounter?.monsters).toEqual([survivor]);

    const legacy = JSON.parse(JSON.stringify(saved)) as {
      current: { session: { encounterRosters?: unknown } };
      cachedFloors: Array<{ session: { encounterRosters?: unknown } }>;
    };
    delete legacy.current.session.encounterRosters;
    for (const cached of legacy.cachedFloors) delete cached.session.encounterRosters;
    const legacyRestored = DungeonRuntimeController.restore(context, legacy);
    expect(legacyRestored.session.currentRoom.encounter?.monsters).toHaveLength(3);

    walkTo(restored.session, (room) => room.zones.some((zone) => zone.change.kind === "stairsDown"));
    const down = restored.session.currentRoom.zones.find((zone) => zone.change.kind === "stairsDown")!;
    expect(restored.activateZone(down.id)).toMatchObject({ kind: "floor", route: { floor: 2 } });
    expect(restored.travelToWaypoint(1)).toBe(true);
    expect(restored.session.state.rooms.find((room) => room.encounter?.id === encounter.id)
      ?.encounter?.monsters).toEqual([survivor]);
  });

  it("allows a smaller roster in a later terminal flow across retreat and JSON restore", () => {
    const events: readonly number[][] = [];
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1250,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
      onDungeonRoomRosterUpdated: (_instance: string, _floor: number, counts: readonly number[]) => {
        (events as number[][]).push([...counts]);
      },
    };
    const route = { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 };
    const run = DungeonRuntimeController.enter(context, route);
    const encounter = enterSaveMeEncounter(run);
    const first = encounter.monsters.slice(1);
    const second = [first[1]!];
    const firstFlow = run.allocateTerminalFlowIdentity(encounter.id);
    expect(run.synchronizeEncounterRoomRoster(encounter, firstFlow, first)).toBe(true);
    run.resolveEncounter(encounter, "retreat");
    expect(run.reenterFromWorld(route)).toBe(true);
    const reentered = run.session.state.rooms.find((room) => room.encounter?.id === encounter.id)
      ?.encounter!;
    const secondFlow = run.allocateTerminalFlowIdentity(reentered.id);
    expect(run.synchronizeEncounterRoomRoster(reentered, secondFlow, second)).toBe(true);
    run.resolveEncounter(reentered, "retreat");

    const saved = run.snapshot();
    expect(saved.terminalFlowSerial).toBe(2);
    const restored = DungeonRuntimeController.restore(context, JSON.parse(JSON.stringify(saved)));
    expect(restored.session.state.rooms.find((room) => room.encounter?.id === encounter.id)
      ?.encounter?.monsters).toEqual(second);
    expect(events).toHaveLength(2);
    expect(restored.synchronizeEncounterRoomRoster(
      reentered,
      secondFlow,
      second,
    )).toBe(false);
    expect(restored.allocateTerminalFlowIdentity(encounter.id).id).toContain("-3-");
  });

  it("clears the reduced roster marker on a later empty-roster victory", () => {
    const events: readonly number[][] = [];
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1251,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
      onDungeonRoomRosterUpdated: (_instance: string, _floor: number, counts: readonly number[]) => {
        (events as number[][]).push([...counts]);
      },
    };
    const route = { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 };
    const run = DungeonRuntimeController.enter(context, route);
    const encounter = enterSaveMeEncounter(run);
    const firstFlow = run.allocateTerminalFlowIdentity(encounter.id);
    expect(run.synchronizeEncounterRoomRoster(encounter, firstFlow, encounter.monsters.slice(1))).toBe(true);
    run.resolveEncounter(encounter, "retreat");
    expect(run.reenterFromWorld(route)).toBe(true);
    const reentered = run.session.state.rooms.find((room) => room.encounter?.id === encounter.id)
      ?.encounter!;
    const secondFlow = run.allocateTerminalFlowIdentity(reentered.id);
    expect(run.synchronizeEncounterRoomRoster(reentered, secondFlow, [])).toBe(true);
    run.resolveEncounter(reentered, "victory");
    expect(events).toHaveLength(2);
    const saved = run.snapshot();
    expect(saved.current.session.clearedEncounterIds).toContain(encounter.id);
    expect(saved.current.session.encounterRosters).toEqual([]);
    expect(DungeonRuntimeController.restore(context, JSON.parse(JSON.stringify(saved)))
      .session.state.rooms.find((room) => room.encounter?.id === encounter.id)
      ?.encounter?.monsters).toEqual([]);
  });

  it("emits unchanged rosters for a new flow and rejects same-flow changes, expansion, and reorder", () => {
    const events: readonly number[][] = [];
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1252,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
      onDungeonRoomRosterUpdated: (_instance: string, _floor: number, counts: readonly number[]) => {
        (events as number[][]).push([...counts]);
      },
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounter = enterSaveMeEncounter(run);
    const roster = encounter.monsters.slice(0, 2);
    const firstFlow = run.allocateTerminalFlowIdentity(encounter.id);
    expect(run.synchronizeEncounterRoomRoster(encounter, firstFlow, roster)).toBe(true);
    expect(run.synchronizeEncounterRoomRoster(encounter, firstFlow, roster)).toBe(false);
    expect(() => run.synchronizeEncounterRoomRoster(encounter, firstFlow, [])).toThrow(/conflicts/);
    const secondFlow = run.allocateTerminalFlowIdentity(encounter.id);
    expect(run.synchronizeEncounterRoomRoster(encounter, secondFlow, roster)).toBe(true);
    expect(() => run.synchronizeEncounterRoomRoster(
      encounter,
      run.allocateTerminalFlowIdentity(encounter.id),
      encounter.monsters,
    )).toThrow(/synchronized state/);
    expect(() => run.synchronizeEncounterRoomRoster(
      encounter,
      run.allocateTerminalFlowIdentity(encounter.id),
      [roster[1]!, roster[0]!],
    )).toThrow(/synchronized state/);
    expect(events).toHaveLength(2);
  });

  it("does not let a flow from another route consume a repeated encounter id", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1253,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounter = enterSaveMeEncounter(run);
    const foreignRouteFlow = run.allocateTerminalFlowIdentity(encounter.id);
    run.reenterFromWorld({ typeName: "Other", sourceFile: "Dungeon_Test.plist", floor: 1 });
    const otherEncounter = enterSaveMeEncounter(run);
    expect(() => run.synchronizeEncounterRoomRoster(otherEncounter, foreignRouteFlow, [])).toThrow(/does not own current route/);
  });

  it("does not record captured enemies on defeat or retreat resolution", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1238,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    );
    const encounterRoom = run.session.state.rooms.find((room) => room.encounter?.monsters.length === 3)!;
    const prior = run.session.state.rooms.find((room) =>
      room.links.some((link) => link.targetRoomId === encounterRoom.id))!;
    walkTo(run.session, (room) => room.id === prior.id);
    run.session.moveToRoom(encounterRoom.id);
    const encounter = run.session.currentRoom.encounter!;
    expect(() => run.resolveEncounter(encounter, "defeat", ["Bat"])).toThrow(/only on victory/);
    run.resolveEncounter(encounter, "defeat");
    run.resolveEncounter(encounter, "retreat");
    expect(run.session.currentRoom.id).toBe(prior.id);
    expect(run.catchQuestProgress()).toMatchObject({ captured: [], complete: false });
  });

  it("retries a quest notification after session mutation and never re-notifies a persisted roster", () => {
    let fail = true;
    const notifications: number[][] = [];
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1239,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
      onDungeonRoomRosterUpdated: (_instanceName: string, _floor: number, counts: readonly number[]) => {
        if (fail) {
          fail = false;
          throw new Error("quest projection unavailable");
        }
        notifications.push([...counts]);
      },
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounterRoom = run.session.state.rooms.find((room) => room.encounter?.monsters.length === 3)!;
    const prior = run.session.state.rooms.find((room) =>
      room.links.some((link) => link.targetRoomId === encounterRoom.id))!;
    walkTo(run.session, (room) => room.id === prior.id);
    run.session.moveToRoom(encounterRoom.id);
    const encounter = run.session.currentRoom.encounter!;
    const survivor = encounter.monsters[0]!;

    expect(() => run.synchronizeEncounterRoomRoster(encounter, flow(1, "flow-1"), [survivor]))
      .toThrow("quest projection unavailable");
    expect(run.session.currentRoom.encounter?.monsters).toHaveLength(3);
    expect(run.snapshot().current.session.encounterRosters).toEqual([]);
    expect(run.synchronizeEncounterRoomRoster(encounter, flow(1, "flow-1"), [survivor])).toBe(true);
    expect(notifications).toHaveLength(1);

    const saved = JSON.parse(JSON.stringify(run.snapshot()));
    const restoredNotifications: number[][] = [];
    const restored = DungeonRuntimeController.restore({
      ...context,
      onDungeonRoomRosterUpdated: (_instanceName: string, _floor: number, counts: readonly number[]) => {
        restoredNotifications.push([...counts]);
      },
    }, saved);
    expect(restored.synchronizeEncounterRoomRoster(encounter, flow(1, "flow-1"), [survivor])).toBe(false);
    expect(restoredNotifications).toEqual([]);
  });

  it("keeps the full local terminal transaction retryable when staged checkpoint persistence rejects", async () => {
    let fail = true;
    let questCommitted = false;
    const callbackCalls: string[] = [];
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1242,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
      onDungeonRoomRosterUpdated: () => {
        questCommitted = true;
        callbackCalls.push("event-4");
        return {
          rollback: () => { questCommitted = false; },
          commit: () => { callbackCalls.push("commit"); },
        };
      },
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounter = enterSaveMeEncounter(run);
    const survivor = encounter.monsters[0]!;
    const terminalFlow = run.allocateTerminalFlowIdentity(encounter.id);
    const before = run.snapshot();
    const persistedSnapshots: DungeonRunSnapshot[] = [];
    const checkpoint = async (snapshot: DungeonRunSnapshot): Promise<void> => {
      persistedSnapshots.push(snapshot);
      if (fail) {
        fail = false;
        throw new Error("checkpoint rejected");
      }
    };

    await expect(run.settleEncounterTerminal(
      encounter,
      terminalFlow,
      "retreat",
      [survivor],
      [],
      checkpoint,
    )).rejects.toThrow("checkpoint rejected");
    expect(run.snapshot()).toEqual(before);
    expect(run.session.currentRoom.encounter?.monsters).toHaveLength(3);
    expect(questCommitted).toBe(false);
    expect(callbackCalls).toEqual(["event-4", "commit"]);

    const resolution = await run.settleEncounterTerminal(
      encounter,
      terminalFlow,
      "retreat",
      [survivor],
      [],
      checkpoint,
    );
    expect(resolution.outcome).toBe("retreat");
    expect(run.session.currentRoom.id).not.toBe(encounter.id);
    expect(run.snapshot().current.session.encounterRosters?.[0]?.monsters).toEqual([survivor]);
    expect(questCommitted).toBe(true);
    expect(callbackCalls).toEqual(["event-4", "commit", "event-4", "commit"]);
    expect(persistedSnapshots).toHaveLength(2);
    expect(persistedSnapshots[1]!.current.session.encounterRosters?.[0]?.monsters)
      .toEqual([survivor]);
  });

  it("keeps Save Me roster loss and capture serial staged until the retrying terminal save commits", async () => {
    let reject = true;
    let persistCalls = 0;
    let event4Attempts = 0;
    let committedEvent4 = 0;
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1244,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
      onDungeonRoomRosterUpdated: () => {
        event4Attempts += 1;
        return {
          rollback: () => { committedEvent4 -= 1; },
          commit: () => { committedEvent4 += 1; },
        };
      },
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounter = enterSaveMeEncounter(run);
    const survivor = encounter.monsters[0]!;
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    const before = run.snapshot();
    const persisted: DungeonRunSnapshot[] = [];
    const persist = async (snapshot: DungeonRunSnapshot): Promise<void> => {
      persistCalls += 1;
      persisted.push(snapshot);
      if (reject) {
        reject = false;
        throw new Error("terminal save rejected");
      }
    };
    await expect(run.settleEncounterTerminal(
      encounter, flow, "retreat", [survivor], [], persist,
    )).rejects.toThrow("terminal save rejected");
    expect(run.snapshot()).toEqual(before);
    expect(run.session.currentRoom.encounter?.monsters).toHaveLength(3);
    expect(run.snapshot().captureSerial).toBe(0);
    expect(committedEvent4).toBe(0);

    const resolution = await run.settleEncounterTerminal(
      encounter, flow, "retreat", [survivor], [], persist,
    );
    expect(resolution.outcome).toBe("retreat");
    expect(persistCalls).toBe(2);
    expect(event4Attempts).toBe(2);
    expect(committedEvent4).toBe(1);
    expect(run.snapshot().captureSerial).toBe(0);
    expect(persisted[1]!.captureSerial).toBe(0);
  });

  it("stages a captured-monster serial in the same accepted terminal snapshot", async () => {
    let reject = true;
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1245,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounter = enterSaveMeEncounter(run);
    const flow = run.allocateTerminalFlowIdentity(encounter.id);
    const before = run.snapshot();
    const persist = async (): Promise<void> => {
      if (reject) {
        reject = false;
        throw new Error("capture terminal save rejected");
      }
    };
    const prepare = (preparation: DungeonTerminalPreparation): void => {
      preparation.setCaptureSerial(before.captureSerial + 1);
    };
    await expect(run.settleEncounterTerminal(
      encounter, flow, "victory", [], ["Bat"], persist, prepare,
    )).rejects.toThrow("capture terminal save rejected");
    expect(run.snapshot()).toEqual(before);
    expect(run.snapshot().captureSerial).toBe(0);

    await run.settleEncounterTerminal(
      encounter, flow, "victory", [], ["Bat"], persist, prepare,
    );
    expect(run.snapshot().captureSerial).toBe(1);
    const control = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const controlEncounter = enterSaveMeEncounter(control);
    const controlId = control.nextCaptureInstanceId(controlEncounter.id, "Bat");
    expect(dungeonCaptureInstanceId(
      run.runSeed, run.route, encounter.id, run.snapshot().captureSerial, "Bat",
    )).toBe(controlId);
  });

  it("can roll back a local terminal identity when its pre-battle checkpoint rejects", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1243,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounter = enterSaveMeEncounter(run);
    const before = run.snapshot();
    const flow = run.allocateTerminalFlowIdentity(encounter.id);

    run.rollbackUncommittedTerminalFlow(flow, before);

    expect(run.snapshot()).toEqual(before);
    expect(run.allocateTerminalFlowIdentity(encounter.id).id).toContain("-1-");
  });

  it("projects victory roster notification before clearing and serializes no conflicting roster", () => {
    const notifications: readonly number[][] = [];
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1240,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
      onDungeonRoomRosterUpdated: (_instanceName: string, _floor: number, counts: readonly number[]) => {
        (notifications as number[][]).push([...counts]);
      },
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounterRoom = run.session.state.rooms.find((room) => room.encounter !== undefined)!;
    const prior = run.session.state.rooms.find((room) =>
      room.links.some((link) => link.targetRoomId === encounterRoom.id))!;
    walkTo(run.session, (room) => room.id === prior.id);
    run.session.moveToRoom(encounterRoom.id);
    const encounter = run.session.currentRoom.encounter!;
    const remainingBefore = run.session.remainingEncounterCount();
    expect(run.synchronizeEncounterRoomRoster(encounter, flow(1, "flow-1"), [])).toBe(true);
    expect(notifications).toHaveLength(1);
    const roomIndex = run.session.state.rooms.findIndex((room) => room.id === encounterRoom.id);
    expect(notifications[0]![roomIndex]).toBe(0);

    run.resolveEncounter(encounter, "victory");
    const saved = run.snapshot();
    expect(saved.current.session.clearedEncounterIds).toContain(encounter.id);
    expect(saved.current.session.encounterRosters).toEqual([]);
    expect(run.session.remainingEncounterCount()).toBe(remainingBefore - 1);
    const restored = DungeonRuntimeController.restore(context, JSON.parse(JSON.stringify(saved)));
    expect(restored.session.state.rooms.find((room) => room.id === encounterRoom.id)
      ?.encounter?.monsters).toEqual([]);
  });

  it("rejects fabricated roster tuples, unknown fields, non-JSON values, and cleared/unexplored entries", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      runSeed: 0x1241,
      definitionFor: ({ floor }: { floor: number }) => saveMeDefinition(floor),
    };
    const run = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const encounterRoom = run.session.state.rooms.find((room) => room.encounter !== undefined)!;
    const prior = run.session.state.rooms.find((room) =>
      room.links.some((link) => link.targetRoomId === encounterRoom.id))!;
    walkTo(run.session, (room) => room.id === prior.id);
    run.session.moveToRoom(encounterRoom.id);
    const encounter = run.session.currentRoom.encounter!;
    const survivor = encounter.monsters[0]!;
    expect(run.synchronizeEncounterRoomRoster(encounter, flow(1, "flow-1"), [survivor])).toBe(true);
    const saved = run.snapshot();
    const roster = saved.current.session.encounterRosters![0]!;
    const replaceSession = (session: typeof saved.current.session, nextRosters: unknown) => ({
      ...session,
      encounterRosters: nextRosters,
    });
    const replaceEverywhere = (nextRosters: unknown, session = saved.current.session) => ({
      ...saved,
      current: { ...saved.current, session: replaceSession(session, nextRosters) },
      cachedFloors: saved.cachedFloors.map((entry) =>
        entry.route.floor === saved.current.route.floor
          ? { ...entry, session: replaceSession(entry.session, nextRosters) }
          : entry),
    });

    expect(() => DungeonRuntimeController.restore(context, replaceEverywhere([{
      encounterId: roster.encounterId,
      monsters: [{ ...survivor, type: "Fabricated" }],
    }]))).toThrow(/not an ordered subsequence/);
    expect(() => parseDungeonRunSnapshot(replaceEverywhere([{
      ...roster,
      extra: true,
    }]))).toThrow(/unknown field/);
    expect(() => parseDungeonRunSnapshot(replaceEverywhere([{
      encounterId: roster.encounterId,
      monsters: [{ ...survivor, extraLivingArguments: { bad: NaN } }],
    }]))).toThrow(/JSON-safe/);

    const cleared = DungeonRuntimeController.restore(context, saved);
    cleared.resolveEncounter(encounter, "victory");
    const clearedSnapshot = cleared.snapshot();
    const clearedRoster = { encounterId: encounter.id, monsters: [] };
    const clearedConflict = {
      ...clearedSnapshot,
      current: {
        ...clearedSnapshot.current,
        session: { ...clearedSnapshot.current.session, encounterRosters: [clearedRoster] },
      },
      cachedFloors: clearedSnapshot.cachedFloors.map((entry) =>
        entry.route.floor === clearedSnapshot.current.route.floor
          ? { ...entry, session: { ...entry.session, encounterRosters: [clearedRoster] } }
          : entry),
    };
    expect(() => DungeonRuntimeController.restore(context, clearedConflict)).toThrow(/cleared/);

    const unexplored = DungeonRuntimeController.enter(context, {
      typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1,
    });
    const hidden = unexplored.session.state.rooms.find((room) => room.encounter !== undefined && !room.explored)!;
    const hiddenRoster = { encounterId: hidden.encounter!.id, monsters: [] };
    const hiddenSnapshot = unexplored.snapshot();
    const hiddenConflict = {
      ...hiddenSnapshot,
      current: {
        ...hiddenSnapshot.current,
        session: { ...hiddenSnapshot.current.session, encounterRosters: [hiddenRoster] },
      },
      cachedFloors: hiddenSnapshot.cachedFloors.map((entry) =>
        entry.route.floor === hiddenSnapshot.current.route.floor
          ? { ...entry, session: { ...entry.session, encounterRosters: [hiddenRoster] } }
          : entry),
    };
    expect(() => DungeonRuntimeController.restore(context, hiddenConflict)).toThrow(/unexplored/);
  });

  it("seeds durable waypoints independently of the cache and materializes an uncached floor", () => {
    const discoveries = new Map([["TestDungeon", [2]]]);
    const registered: Array<{ instanceName: string; floor: number }> = [];
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime"],
      runSeed: 0x1235,
      seedFor: ({ floor }: { floor: number }) => 2000 + floor,
      definitionFor: ({ floor }: { floor: number }) => definition(floor),
      waypointFloorsForDungeon: (instanceName: string) => discoveries.get(instanceName) ?? [],
      onWaypointRegistered: (instanceName: string, floor: number) => {
        registered.push({ instanceName, floor });
      },
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    );

    expect(run.availableWaypointFloors()).toEqual([2]);
    const beforeTravel = JSON.parse(JSON.stringify(run.snapshot()));
    expect(beforeTravel.cachedFloors.map((entry: { route: { floor: number } }) => entry.route.floor))
      .toEqual([1]);
    expect(parseDungeonRunSnapshot(beforeTravel).registeredWaypoints)
      .toEqual([{ route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 2 } }]);

    expect(run.travelToWaypoint(2)).toBe(false);
    expect(run.route.floor).toBe(2);
    expect(run.session.currentRoom.waypoint).toBe(true);
    expect(run.session.state.seed).toBe(2002);
    expect(registered).toEqual([]);
  });

  it("re-enters an overworld-exited dungeon through the retained floor cache", () => {
    const entranceDefinition: DungeonDefinition = {
      ...definition(1),
      floorPopulations: [{
        sourceFloor: 1,
        zoneChanges: [{
          kind: "worldExit",
          sourceType: "DungeonExit",
          instanceName: "NorthCaveEntrance",
          targetZoneChange: "NorthCave",
          targetWorld: "SouthernAlvalon",
        }],
      }],
    };
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime"],
      runSeed: 0x1236,
      seedFor: () => 8675309,
      definitionFor: () => entranceDefinition,
    };
    const route = {
      typeName: "Test",
      sourceFile: "Dungeon_Test.plist",
      floor: 1,
      entryZoneName: "NorthCaveEntrance",
    };
    const run = DungeonRuntimeController.enter(context, route);
    walkTo(run.session, (room) => room.waypoint);
    run.registerWaypoint();
    const beforeExit = run.snapshot();
    const layout = run.session.state.rooms.map((room) => ({
      id: room.id,
      links: room.links.map((link) => link.targetRoomId),
    }));

    expect(run.reenterFromWorld(route)).toBe(true);
    const afterReentry = run.snapshot();
    expect(afterReentry.current.session.seed).toBe(beforeExit.current.session.seed);
    expect(run.session.state.rooms.map((room) => ({
      id: room.id,
      links: room.links.map((link) => link.targetRoomId),
    }))).toEqual(layout);
    expect(afterReentry.current.session.exploredRoomIds)
      .toEqual(beforeExit.current.session.exploredRoomIds);
    expect(run.session.currentRoom.zones)
      .toContainEqual(expect.objectContaining({
        change: expect.objectContaining({ kind: "worldExit", instanceName: "NorthCaveEntrance" }),
      }));
    expect(run.availableWaypointFloors()).toEqual([1]);
  });

  it("persists monotonic route-aware capture ids across save restoration", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined }, monsterTypes: ["Slime"],
      runSeed: 0x45,
      definitionFor: ({ floor }: { floor: number }) => definition(floor),
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    );
    const first = run.nextCaptureInstanceId("encounter-pack-0", "Slime");
    const restored = DungeonRuntimeController.restore(context, JSON.parse(JSON.stringify(run.snapshot())));
    const second = restored.nextCaptureInstanceId("encounter-pack-0", "Slime");
    expect(first).toContain("-1-Slime");
    expect(second).toContain("-2-Slime");
    expect(second).not.toBe(first);
  });

  it("rejects stale scene-bound zone input and can roll back a failed route replacement", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined }, monsterTypes: ["Slime"],
      runSeed: 0x1235,
      seedFor: ({ floor }: { floor: number }) => 2000 + floor,
      definitionFor: ({ floor }: { floor: number }) => definition(floor),
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    );
    walkTo(run.session, (room) => room.zones.some((zone) => zone.change.kind === "stairsDown"));
    const sceneSession = run.session;
    const sceneRoute = run.route;
    const sceneDefinition = run.definition;
    const down = sceneSession.currentRoom.zones.find((zone) => zone.change.kind === "stairsDown")!;
    expect(run.activateZoneForSession(sceneSession, down.id))
      .toMatchObject({ kind: "floor", route: { floor: 2 } });
    expect(run.session).not.toBe(sceneSession);

    const switched = run.snapshot();
    expect(run.activateZoneForSession(sceneSession, down.id)).toBeUndefined();
    expect(run.snapshot()).toEqual(switched);

    run.rollbackToScene(sceneRoute, sceneDefinition, sceneSession);
    expect(run.route).toEqual(sceneRoute);
    expect(run.session).toBe(sceneSession);
    expect(run.activateZoneForSession(sceneSession, down.id))
      .toMatchObject({ kind: "floor", route: { floor: 2 }, restoredFromCache: true });
  });

  it("regenerates obsolete room-N floor geometry instead of failing login restore", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime"],
      runSeed: 0x451,
      definitionFor: ({ floor }: { floor: number }) => definition(floor),
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    );
    const current = run.snapshot();
    const {
      encounterRosters: _encounterRosters,
      generationGateDecisions: _generationGateDecisions,
      ...legacySessionBase
    } = current.current.session;
    const legacySession = {
      ...legacySessionBase,
      currentRoomId: "room-0",
      exploredRoomIds: ["room-0"],
      clearedEncounterIds: [],
      collectedTreasureIds: [],
    };
    const legacy = {
      ...current,
      captureSerial: 17,
      completedKeys: ["legacy-completion"],
      catchTypes: ["Slime"],
      current: { ...current.current, session: legacySession },
      cachedFloors: current.cachedFloors.map((entry) =>
        entry.route.typeName === current.current.route.typeName &&
        entry.route.sourceFile === current.current.route.sourceFile &&
        entry.route.floor === current.current.route.floor
          ? { ...entry, session: legacySession }
          : entry),
    };
    const restored = DungeonRuntimeController.restore(context, legacy);
    expect(restored.migratedLegacyTopology).toBe(true);
    expect(restored.session.state.currentRoomId).toMatch(/^2x2-\{-?\d+, -?\d+\}$/);
    expect(restored.session.state.currentRoomId).not.toBe("room-0");
    expect(restored.snapshot()).toMatchObject({
      captureSerial: 17,
      completedKeys: ["legacy-completion"],
      catchTypes: ["Slime"],
    });
  });

  it("seeds catch progress from the owned collection and claims only through the display path", () => {
    const questDefinition: DungeonDefinition = {
      ...definition(1),
      catchQuest: {
        challengeLevel: 3,
        types: ["Slime", "Bat"],
        treasureData: {
          levelScalor: 1,
          items: [{ kind: "silver", levelScalor: 1 }],
        },
      },
    };
    const run = DungeonRuntimeController.enter({
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      isMonsterRegistered: (type) => type === "Slime",
      runSeed: 0x46,
      definitionFor: () => questDefinition,
    }, { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 });
    expect(run.catchQuestProgress()).toMatchObject({
      captured: ["Slime"],
      complete: false,
      rewardCollected: false,
    });
    expect(run.takeChangedCatchQuestProgress()?.captured).toEqual(["Slime"]);
    expect(run.takeChangedCatchQuestProgress()).toBeUndefined();
    expect(run.session.recordCapturedMonster("Bat")).toEqual([]);
    expect(run.catchQuestProgress()).toMatchObject({ complete: true, rewardCollected: false });
    expect(run.claimCatchQuestReward().length).toBeGreaterThan(0);
    expect(run.catchQuestProgress()).toMatchObject({ rewardCollected: true });
    expect(run.claimCatchQuestReward()).toEqual([]);
  });

  it("preserves transient catch and floor-presence presentation across authoritative adoption", () => {
    const questDefinition: DungeonDefinition = {
      ...definition(1),
      catchQuest: {
        challengeLevel: 3,
        types: ["Slime", "Bat"],
        treasureData: {
          levelScalor: 1,
          items: [{ kind: "silver", levelScalor: 1 }],
        },
      },
    };
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime", "Bat"],
      isMonsterRegistered: (type: string) => type === "Slime",
      runSeed: 0x146,
      definitionFor: () => questDefinition,
    };
    const route = { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 };
    const beforeAdoption = DungeonRuntimeController.enter(context, route);
    expect(beforeAdoption.takeChangedCatchQuestProgress()?.captured).toEqual(["Slime"]);
    expect(beforeAdoption.claimCurrentFloorPresence()).toBe(true);
    expect(beforeAdoption.claimCurrentFloorPresence()).toBe(false);

    const afterAdoption = DungeonRuntimeController.restore(context, beforeAdoption.snapshot());
    afterAdoption.inheritTransientPresentationState(beforeAdoption);
    expect(afterAdoption.takeChangedCatchQuestProgress()).toBeUndefined();
    expect(afterAdoption.claimCurrentFloorPresence()).toBe(false);

    afterAdoption.session.recordCapturedMonster("Bat");
    expect(afterAdoption.takeChangedCatchQuestProgress()).toMatchObject({
      captured: ["Slime", "Bat"],
      complete: true,
    });

    const terminalReload = DungeonRuntimeController.restore(context, afterAdoption.snapshot());
    terminalReload.seedCurrentCatchQuestPresentation(["Slime"]);
    expect(terminalReload.takeChangedCatchQuestProgress()).toMatchObject({
      captured: ["Slime", "Bat"],
      complete: true,
    });
    expect(terminalReload.takeChangedCatchQuestProgress()).toBeUndefined();
  });

  it("keeps claimed challenges keyed by dungeon instance across cached routes", () => {
    const quest = (instanceName: string, sourceFile: string): DungeonDefinition => ({
      ...definition(1),
      sourceFile,
      instanceName,
      catchQuest: {
        challengeLevel: 3,
        types: ["Slime"],
        treasureData: {
          levelScalor: 1,
          items: [{ kind: "silver", levelScalor: 1 }],
        },
      },
    });
    const definitions = new Map([
      ["Dungeon_A.plist", quest("A", "Dungeon_A.plist")],
      ["Dungeon_B.plist", quest("B", "Dungeon_B.plist")],
    ]);
    const context = {
      resources: { has: () => false, plist: () => undefined },
      monsterTypes: ["Slime"],
      isMonsterRegistered: () => true,
      runSeed: 0x47,
      definitionFor: ({ sourceFile }: { sourceFile: string }) => definitions.get(sourceFile)!,
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_A.plist", floor: 1 },
    );
    expect(run.catchQuestProgress()).toMatchObject({ complete: true, rewardCollected: false });
    expect(run.claimCatchQuestReward().length).toBeGreaterThan(0);

    expect(run.reenterFromWorld({
      typeName: "Test",
      sourceFile: "Dungeon_B.plist",
      floor: 1,
    })).toBe(false);
    expect(run.catchQuestProgress()).toMatchObject({ complete: true, rewardCollected: false });
    expect(run.claimCatchQuestReward().length).toBeGreaterThan(0);

    expect(run.reenterFromWorld({
      typeName: "Test",
      sourceFile: "Dungeon_A.plist",
      floor: 1,
    })).toBe(true);
    expect(run.catchQuestProgress()).toMatchObject({ complete: true, rewardCollected: true });
    expect(run.snapshot().completedCatchQuestInstances).toEqual(["A", "B"]);
  });

  it("lands linked dungeons at the authored target zone even when the destination floor is cached", () => {
    const linked = (typeName: string, sourceFile: string, instanceName: string, target: {
      typeName: string; sourceFile: string; instanceName: string;
    }): DungeonDefinition => ({
      ...definition(1), typeName, sourceFile, instanceName,
      floorPopulations: [{ sourceFloor: 1, zoneChanges: [{
        kind: "dungeonExit", sourceType: "DungeonExit", instanceName: `exit-${instanceName}`,
        targetZoneChange: `exit-${target.instanceName}`, dungeonType: target.typeName,
        dungeonFile: target.sourceFile, dungeonLevel: 1,
      }] }],
    });
    const a = { typeName: "Cave", sourceFile: "Dungeon_A.plist", instanceName: "A" };
    const b = { typeName: "Water", sourceFile: "Dungeon_B.plist", instanceName: "B" };
    const definitions = new Map([
      [`${a.typeName}:${a.sourceFile}`, linked(a.typeName, a.sourceFile, a.instanceName, b)],
      [`${b.typeName}:${b.sourceFile}`, linked(b.typeName, b.sourceFile, b.instanceName, a)],
    ]);
    const run = DungeonRuntimeController.enter({
      resources: { has: () => false, plist: () => undefined }, monsterTypes: ["Slime"],
      runSeed: 9,
      definitionFor: (route) => definitions.get(`${route.typeName}:${route.sourceFile}`)!,
    }, { typeName: a.typeName, sourceFile: a.sourceFile, floor: 1 });
    walkTo(run.session, (room) => room.zones.some((zone) => zone.change.kind === "dungeonExit"));
    const toB = run.session.currentRoom.zones[0]!;
    expect(run.activateZone(toB.id)).toMatchObject({ kind: "dungeon", route: { typeName: "Water" } });
    expect(run.session.currentRoom.zones[0]?.change).toMatchObject({ instanceName: "exit-B" });
    const toA = run.session.currentRoom.zones[0]!;
    expect(run.activateZone(toA.id)).toMatchObject({ kind: "dungeon", restoredFromCache: true });
    expect(run.session.currentRoom.zones[0]?.change).toMatchObject({ instanceName: "exit-A" });
  });

  it("keeps same-numbered waypoints distinct across linked dungeons", () => {
    const linked = (typeName: string, sourceFile: string, instanceName: string, target: {
      typeName: string; sourceFile: string; instanceName: string;
    }): DungeonDefinition => ({
      ...definition(1), typeName, sourceFile, instanceName,
      floorPopulations: [{ sourceFloor: 1, zoneChanges: [{
        kind: "dungeonExit", sourceType: "DungeonExit", instanceName: `exit-${instanceName}`,
        targetZoneChange: `exit-${target.instanceName}`, dungeonType: target.typeName,
        dungeonFile: target.sourceFile, dungeonLevel: 1,
      }] }],
    });
    const a = { typeName: "Cave", sourceFile: "Dungeon_A.plist", instanceName: "A" };
    const b = { typeName: "Water", sourceFile: "Dungeon_B.plist", instanceName: "B" };
    const definitions = new Map([
      [`${a.typeName}:${a.sourceFile}`, linked(a.typeName, a.sourceFile, a.instanceName, b)],
      [`${b.typeName}:${b.sourceFile}`, linked(b.typeName, b.sourceFile, b.instanceName, a)],
    ]);
    const run = DungeonRuntimeController.enter({
      resources: { has: () => false, plist: () => undefined }, monsterTypes: ["Slime"],
      runSeed: 91,
      definitionFor: (route) => definitions.get(`${route.typeName}:${route.sourceFile}`)!,
    }, { typeName: a.typeName, sourceFile: a.sourceFile, floor: 1 });

    walkTo(run.session, (room) => room.waypoint);
    run.registerWaypoint();
    walkTo(run.session, (room) => room.zones.some((zone) => zone.change.kind === "dungeonExit"));
    run.activateZone(run.session.currentRoom.zones[0]!.id);
    walkTo(run.session, (room) => room.waypoint);
    run.registerWaypoint();

    expect(run.availableWaypoints()).toEqual([
      { typeName: "Cave", sourceFile: "Dungeon_A.plist", floor: 1 },
      { typeName: "Water", sourceFile: "Dungeon_B.plist", floor: 1 },
    ]);
    expect(run.availableWaypointFloors()).toEqual([1]);
    expect(run.travelToWaypoint({ typeName: "Cave", sourceFile: "Dungeon_A.plist", floor: 1 })).toBe(true);
    expect(run.route.typeName).toBe("Cave");
    expect(run.session.currentRoom.waypoint).toBe(true);
    expect(run.travelToWaypoint({ typeName: "Water", sourceFile: "Dungeon_B.plist", floor: 1 })).toBe(true);
    expect(run.route.typeName).toBe("Water");
  });

  it("validates route-aware snapshots, permits durable uncached waypoints, and migrates floor-only form", () => {
    const context = {
      resources: { has: () => false, plist: () => undefined }, monsterTypes: ["Slime"],
      runSeed: 77, definitionFor: ({ floor }: { floor: number }) => definition(floor),
    };
    const run = DungeonRuntimeController.enter(
      context,
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    );
    walkTo(run.session, (room) => room.waypoint);
    run.registerWaypoint();
    const snapshot = JSON.parse(JSON.stringify(run.snapshot()));

    expect(() => parseDungeonRunSnapshot({
      ...snapshot,
      cachedFloors: [...snapshot.cachedFloors, snapshot.cachedFloors[0]],
    })).toThrow(/duplicate cached floor/);
    expect(parseDungeonRunSnapshot({
      ...snapshot,
      registeredWaypoints: [{ route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 5 } }],
    }).registeredWaypoints).toEqual([{
      route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 5 },
    }]);

    const {
      runSeed: _ignoredRunSeed,
      captureSerial: _ignoredCaptureSerial,
      registeredWaypoints: _ignoredWaypoints,
      ...legacy
    } = snapshot;
    const migrated = parseDungeonRunSnapshot({ ...legacy, registeredWaypointFloors: [1] });
    expect(migrated.runSeed).toBe(snapshot.current.session.seed);
    expect(migrated.captureSerial).toBe(0);
    expect(migrated.registeredWaypoints).toEqual([{
      route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    }]);
  });

  it("strictly validates the dungeon-run graph without normalizing away fields or cycles", () => {
    const base = minimalSnapshot();
    expect(() => parseDungeonRunSnapshot({ ...base, extra: true })).toThrow(/unknown field/);
    expect(() => parseDungeonRunSnapshot({
      ...base,
      current: { ...base.current, route: { ...base.current.route, extra: true } },
    })).toThrow(/unknown field/);
    expect(() => parseDungeonRunSnapshot({
      ...base,
      current: { ...base.current, session: { ...base.current.session, extra: true } },
    })).toThrow(/unknown field/);

    const symbolOuter = { ...base } as Record<PropertyKey, unknown>;
    Object.defineProperty(symbolOuter, Symbol("unknown"), { value: true });
    expect(() => parseDungeonRunSnapshot(symbolOuter)).toThrow(/symbol/);

    const inherited = Object.create({ extra: true }) as Record<string, unknown>;
    Object.assign(inherited, base);
    expect(() => parseDungeonRunSnapshot(inherited)).toThrow(/ordinary object/);
    const customPrototype = { ...base };
    Object.setPrototypeOf(customPrototype, { custom: true });
    expect(() => parseDungeonRunSnapshot(customPrototype)).toThrow(/ordinary object/);

    const cycle = { ...base } as { current?: unknown };
    cycle.current = cycle;
    expect(() => parseDungeonRunSnapshot(cycle)).toThrow(/cycle/);

    const extraArray = { ...base, cachedFloors: [...base.cachedFloors] };
    Object.defineProperty(extraArray.cachedFloors, "extra", { value: true });
    expect(() => parseDungeonRunSnapshot(extraArray)).toThrow(/extra keys/);

    expect(() => parseDungeonRunSnapshot({
      ...base,
      current: { ...base.current, route: { ...base.current.route, entryZoneName: "Start" } },
    })).toThrow(/disagrees/);
    expect(() => parseDungeonRunSnapshot({
      ...base,
      cachedFloors: [{
        ...base.cachedFloors[0],
        session: { ...base.cachedFloors[0]!.session, currentRoomId: "other-room" },
      }],
    })).toThrow(/disagrees/);

    const extraLivingArguments = {
      boss: true,
      displayName: "shipped",
      rendererData: { spriteFile: "Dragon.png", nested: [null, { value: 2 }] },
    };
    const withOpaque = minimalSnapshot();
    const opaqueSession = {
      ...withOpaque.current.session,
      exploredRoomIds: ["room-0"],
      encounterRosters: [{
        encounterId: "encounter-1",
        terminalFlowId: "flow-1",
        monsters: [{ type: "Dragon", level: 3, extraLivingArguments }],
      }],
    };
    const parsed = parseDungeonRunSnapshot({
      ...withOpaque,
      current: { ...withOpaque.current, session: opaqueSession },
      cachedFloors: [{ ...withOpaque.cachedFloors[0], session: { ...opaqueSession } }],
    });
    expect(parsed.current.session.encounterRosters?.[0]?.monsters[0]?.extraLivingArguments)
      .toEqual(extraLivingArguments);

    const nonFinite = minimalSnapshot();
    (nonFinite.current.session as { seed: number }).seed = Number.NaN;
    expect(() => parseDungeonRunSnapshot(nonFinite)).toThrow(/JSON-safe/);
    const functionValue = minimalSnapshot() as { current: { session: Record<string, unknown> } };
    functionValue.current.session.bad = () => undefined;
    expect(() => parseDungeonRunSnapshot(functionValue)).toThrow(/JSON-safe/);
  });

});
