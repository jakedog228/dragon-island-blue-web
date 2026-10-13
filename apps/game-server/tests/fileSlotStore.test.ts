import { findPresentationLeaks } from "@dib/logic-pack";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
import {
  loadGameData,
  loadQuestCatalog,
  loadWorldData,
  resolveDataDir,
  type WorldResourceSource,
} from "@dib/gamedata";
import {
  DungeonRuntimeController,
  GuildQuestRuntime,
  WorldTripParty,
} from "../../../packages/engine/src/index.js";
import {
  GAME_PROTOCOL_VERSION,
  GameCommandResultV1Schema,
  OfficialGameCommandResultV12Schema,
  OfficialGameCommandResultV13Schema,
  OfficialGameCommandResultV14Schema,
  OfficialGameCommandResultV15Schema,
  OfficialGameCommandResultV16Schema,
  OfficialGameCommandResultV17Schema,
  OfficialGameCommandResultV18Schema,
  OfficialGameCommandResultV19Schema,
  OfficialGameCommandResultV20Schema,
  OfficialGameCommandResultV21Schema,
  OfficialGameCommandResultV22Schema,
  OfficialGameCommandResultV23Schema,
  OfficialGameCommandResultV24Schema,
  OfficialGameCommandResultV25Schema,
  OfficialGameCommandResultV26Schema,
  OfficialGameProjectionV12Schema,
  OfficialGameProjectionV13Schema,
  OfficialGameProjectionV14Schema,
  OfficialGameProjectionV15Schema,
  OfficialGameProjectionV16Schema,
  OfficialGameProjectionV17Schema,
  OfficialGameProjectionV18Schema,
  OfficialGameProjectionV19Schema,
  OfficialGameProjectionV20Schema,
  OfficialGameProjectionV21Schema,
  OfficialGameProjectionV22Schema,
  OfficialGameProjectionV23Schema,
  OfficialGameProjectionV24Schema,
  OfficialGameProjectionV25Schema,
  OfficialGameProjectionV26Schema,
  OFFICIAL_GAME_V11_SIMULATION_VERSION,
  OFFICIAL_GAME_V12_SIMULATION_VERSION,
  OFFICIAL_GAME_V18_SIMULATION_VERSION,
  OFFICIAL_GAME_V19_SIMULATION_VERSION,
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
  OFFICIAL_GAME_V21_SIMULATION_VERSION,
  OFFICIAL_GAME_V22_SIMULATION_VERSION,
  OFFICIAL_GAME_V23_SIMULATION_VERSION,
  OFFICIAL_GAME_V24_SIMULATION_VERSION,
  OFFICIAL_GAME_V25_SIMULATION_VERSION,
  OFFICIAL_GAME_V26_SIMULATION_VERSION,
  OFFICIAL_GAME_V13_SIMULATION_VERSION,
  SlotProjectionV1Schema,
  type GameCommandEnvelopeV1,
  type LogicPackDescriptorV1,
  type OfficialGameProjectionBodyV13,
  type OfficialGameProjectionBodyV14,
  type OfficialGameProjectionBodyV15,
  type OfficialGameProjectionBodyV16,
  type OfficialGameProjectionBodyV17,
  type OfficialGameProjectionBodyV18,
  type OfficialGameProjectionBodyV19,
  type OfficialGameProjectionBodyV20,
  type OfficialGameProjectionBodyV21,
  type OfficialGameProjectionBodyV22,
  type OfficialGameProjectionBodyV23,
  type OfficialGameProjectionBodyV24,
  type OfficialGameProjectionBodyV25,
  type OfficialGameProjectionBodyV26,
} from "@dib/game-protocol";
import {
  AuthoritativeGameService,
  InMemoryAuthoritativeSlotStore,
  type GameCommandReducer,
} from "@dib/game-service";
import {
  PlayerProfile,
  sourceNewGameProfileDefaults,
} from "../../../packages/player-domain/src/index.js";
import {
  createOfficialLogicPackDescriptor,
  createOfficialGameV12LogicPackDescriptor,
  createOfficialGameV12Support,
  createOfficialGameV13LogicPackDescriptor,
  createOfficialGameV14LogicPackDescriptor,
  createOfficialGameV15LogicPackDescriptor,
  createOfficialGameV16LogicPackDescriptor,
  createOfficialGameV17LogicPackDescriptor,
  createOfficialGameV18LogicPackDescriptor,
  createOfficialGameV19LogicPackDescriptor,
  createOfficialGameV20LogicPackDescriptor,
  createOfficialGameV21LogicPackDescriptor,
  createOfficialGameV22LogicPackDescriptor,
  createOfficialGameV23LogicPackDescriptor,
  createOfficialGameV24LogicPackDescriptor,
  createOfficialGameV25LogicPackDescriptor,
  createOfficialGameV26LogicPackDescriptor,
  migrateOfficialGameV11ToV12,
  migrateOfficialGameV12ToV13,
  migrateOfficialGameV13ToV14,
  migrateOfficialGameV14ToV15,
  migrateOfficialGameV15ToV16,
  migrateOfficialGameV16ToV17,
  migrateOfficialGameV17ToV18,
  migrateOfficialGameV18ToV19,
  migrateOfficialGameV19ToV20,
  migrateOfficialGameV20ToV21,
  migrateOfficialGameV21ToV22,
  migrateOfficialGameV22ToV23,
  migrateOfficialGameV23ToV24,
  migrateOfficialGameV24ToV25,
  migrateOfficialGameV25ToV26,
  OfficialGameReducer,
  OfficialGameV12Reducer,
  OfficialGameV13Reducer,
  OfficialGameV14Reducer,
  OfficialGameV15Reducer,
  OfficialGameV16Reducer,
  OfficialGameV17Reducer,
  OfficialGameV18Reducer,
  OfficialGameV19Reducer,
  OfficialGameV20Reducer,
  OfficialGameV21Reducer,
  OfficialGameV22Reducer,
  OfficialGameV23Reducer,
  OfficialGameV24Reducer,
  OfficialGameV25Reducer,
  OfficialGameV26Reducer,
  parseOfficialGameStateV1,
  parseOfficialGameStateV12,
  parseOfficialGameStateV13,
  parseOfficialGameStateV14,
  parseOfficialGameStateV15,
  parseOfficialGameStateV16,
  parseOfficialGameStateV17,
  parseOfficialGameStateV18,
  parseOfficialGameStateV19,
  parseOfficialGameStateV20,
  parseOfficialGameStateV21,
  parseOfficialGameStateV22,
  parseOfficialGameStateV23,
  parseOfficialGameStateV24,
  parseOfficialGameStateV25,
  parseOfficialGameStateV26,
  validateOfficialGameSupport,
  type OfficialGameStateV1,
  type OfficialGameProjectionBodyV12,
  type OfficialGameStateV12,
  type OfficialGameStateV13,
  type OfficialGameStateV14,
  type OfficialGameStateV15,
  type OfficialGameStateV16,
  type OfficialGameStateV17,
  type OfficialGameStateV18,
  type OfficialGameStateV19,
  type OfficialGameStateV20,
  type OfficialGameStateV21,
  type OfficialGameStateV22,
  type OfficialGameStateV23,
  type OfficialGameStateV24,
  type OfficialGameStateV25,
  type OfficialGameStateV26,
} from "@dib/official-game";
import {
  FileAuthoritativeSlotStore,
  legacySimulationMigration,
} from "../src/fileSlotStore.js";

interface State { readonly poi: string }

const playerId = "d".repeat(64);
const pack: LogicPackDescriptorV1 = {
  logicPackId: `logic-v1:${"e".repeat(64)}`,
  simulationVersion: "official-game-v11",
  trustTier: "official",
  capabilities: {
    slot: true,
    world: true,
    battle: false,
    capture: false,
    spirit: false,
    party: false,
    economy: false,
    dungeon: false,
    quests: false,
    plot: false,
    tournaments: false,
    commandTypes: ["slot.create", "world.navigate"],
  },
};
const reducer: GameCommandReducer<State> = {
  apply(context, command) {
    const poi = command.type === "world.navigate" ? command.targetPoiId : "Town";
    return {
      state: { poi },
      projection: {
        player: {
          heroLevel: 1,
          heroTotalHighestLevels: 1,
          silver: 0,
          gold: 0,
          captureCards: { 1: 0, 2: 0, 3: 0 },
          party: [],
          battingOrderSize: 6,
          battingOrderIds: [],
          ownedSoulStones: [],
          highestCapturedLevels: {},
          learnedCombineRecipes: [],
          tutorialFlags: [],
          catchQuestsDone: [],
          items: {},
          spirit: { energy: 0, savedXp: {}, usedThisTrip: [] },
        },
        location: { kind: "world", worldId: "World", poiId: poi },
        decision: {
          type: "world.ready",
          decisionId: `decision-${context.previousRevision + 1}`,
          selectablePoiIds: ["Town", "Forest"],
        },
      },
      events: command.type === "slot.create"
        ? [{ type: "slot.created" }]
        : [{ type: "world.arrived", worldId: "World", poiId: poi, movement: "walk", randomDraws: [] }],
    };
  },
};

const officialDataDirectory = resolveDataDir();
const officialResources: WorldResourceSource = {
  has: (path) => path.endsWith(".plist")
    ? existsSync(join(officialDataDirectory, `${path.slice(0, -6)}.json`)) || /-hd\.plist$/.test(path)
    : true,
  plist: (path) => JSON.parse(readFileSync(
    join(officialDataDirectory, `${path.slice(0, -6)}.json`),
    "utf8",
  )) as unknown,
};
const officialData = loadGameData();
const officialWorld = loadWorldData(
  officialResources,
  "World_1-1",
  new Set(officialData.allMonsters().map(({ shortType }) => shortType)),
);
const officialQuests = loadQuestCatalog(officialResources);
const officialSupport = validateOfficialGameSupport({
  data: officialData,
  world: officialWorld,
  resources: officialResources,
  quests: officialQuests,
  startTownId: "First_City",
});
const officialPack = createOfficialLogicPackDescriptor(
  `logic-v1:${"f".repeat(64)}`,
  officialSupport,
);
const officialReducer = new OfficialGameReducer({
  data: officialData,
  world: officialWorld,
  resources: officialResources,
  quests: officialQuests,
  startTownId: "First_City",
  support: officialSupport,
  random: () => 0,
});
const officialV12Support = createOfficialGameV12Support({ support: officialSupport });
const officialV12Pack = createOfficialGameV12LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV12Reducer = new OfficialGameV12Reducer(officialReducer, officialV12Support);
const officialV13Pack = createOfficialGameV13LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV13Reducer = new OfficialGameV13Reducer(officialV12Reducer, officialV12Pack);
const officialV14Pack = createOfficialGameV14LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV14Reducer = new OfficialGameV14Reducer(officialV12Reducer, officialV12Pack);
const officialV15Pack = createOfficialGameV15LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV15Reducer = new OfficialGameV15Reducer(officialV12Reducer, officialV12Pack);
const officialV16Pack = createOfficialGameV16LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV16Reducer = new OfficialGameV16Reducer(officialV15Reducer, officialV15Pack);
const officialV17Pack = createOfficialGameV17LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV17Reducer = new OfficialGameV17Reducer(officialV16Reducer, officialV16Pack);
const officialV18Pack = createOfficialGameV18LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV18Reducer = new OfficialGameV18Reducer(officialV17Reducer, officialV17Pack);
const officialV19Pack = createOfficialGameV19LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV19Reducer = new OfficialGameV19Reducer(officialV18Reducer, officialV18Pack);
const officialV20Pack = createOfficialGameV20LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV20Reducer = new OfficialGameV20Reducer(officialV19Reducer, officialV19Pack);
const officialV21Pack = createOfficialGameV21LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV21Reducer = new OfficialGameV21Reducer(officialV20Reducer, officialV20Pack);
const officialV22Pack = createOfficialGameV22LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV22Reducer = new OfficialGameV22Reducer(officialV21Reducer, officialV21Pack);
const officialV23Pack = createOfficialGameV23LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV23Reducer = new OfficialGameV23Reducer(officialV22Reducer, officialV22Pack);
const officialV24Pack = createOfficialGameV24LogicPackDescriptor(
  officialPack.logicPackId,
  officialV12Support,
);
const officialV24Reducer = new OfficialGameV24Reducer(officialV23Reducer, officialV23Pack);
const officialV25Pack = createOfficialGameV25LogicPackDescriptor(officialPack.logicPackId, officialV12Support);
const officialV25Reducer = new OfficialGameV25Reducer(officialV24Reducer, officialV24Pack);
const officialV26Pack = createOfficialGameV26LogicPackDescriptor(officialPack.logicPackId, officialV12Support);
const officialV26Reducer = new OfficialGameV26Reducer(officialData, officialV25Reducer, officialV25Pack);

function validOfficialDungeonState(): OfficialGameStateV1 {
  const entrance = officialWorld.pointsOfInterest.find((poi) => poi.zoneChange?.kind === "dungeon");
  if (entrance?.zoneChange?.kind !== "dungeon") throw new Error("official fixture has no dungeon entrance");
  const created = officialReducer.apply({
    playerId,
    slotId: "slot-1",
    pack: officialPack,
    state: undefined,
    previousRevision: 0,
    now: "2026-08-02T00:00:00.000Z",
  }, { type: "slot.create", starterElement: "Water" });
  const outside: OfficialGameStateV1 = {
    ...created.state,
    location: { kind: "world", worldId: officialWorld.name, poiId: entrance.name },
    world: { ...created.state.world!, worldId: officialWorld.name, currentPoiId: entrance.name },
  };
  const entered = officialReducer.apply({
    playerId,
    slotId: "slot-1",
    pack: officialPack,
    state: outside,
    previousRevision: 1,
    now: "2026-08-02T00:00:00.000Z",
  }, { type: "world.activateZone", zoneId: entrance.name });
  if (entered.state.dungeon === undefined) throw new Error("official fixture did not enter a dungeon");
  return entered.state;
}

function activeWorldMigrationState(): OfficialGameStateV1 {
  const created = officialReducer.apply({
    playerId,
    slotId: "slot-1",
    pack: officialPack,
    state: undefined,
    previousRevision: 0,
    now: "2026-08-04T00:00:00.000Z",
  }, { type: "slot.create", starterElement: "Water" });
  const party = new WorldTripParty(officialData, [
    ...["world-migration-1", "world-migration-2", "world-migration-3"].map((instanceId) => ({
      instanceId,
      shortType: "BlueBabyDragon",
      level: 1,
      cumulativeXp: 0,
      currentHp: 33,
    })),
  ], 6);
  const profile = new PlayerProfile({
    ...sourceNewGameProfileDefaults("BlueBabyDragon"),
    monsterPartyLevels: [1, 1, 1],
  }, party);
  const ready: OfficialGameStateV1 = {
    ...created.state,
    profile: profile.stateSnapshot(),
    party: party.stateSnapshot(),
    location: { kind: "world", worldId: officialWorld.name, poiId: "1-1_Field_2" },
    world: {
      ...created.state.world!,
      currentPoiId: "1-1_Field_2",
      completedPoiIds: [
        "First_City",
        "1-1_Turtorial_Hut_1",
        "1-1_Field_1",
        "1-1_Field_2",
      ],
      everCompletedPoiIds: [
        "First_City",
        "1-1_Turtorial_Hut_1",
        "1-1_Field_1",
        "1-1_Field_2",
      ],
    },
  };
  const started = officialReducer.apply({
    playerId,
    slotId: "slot-1",
    pack: officialPack,
    state: ready,
    previousRevision: 1,
    now: "2026-08-04T00:00:00.000Z",
  }, { type: "world.navigate", targetPoiId: "1-1_Field_3" });
  if (started.state.battle === undefined) throw new Error("migration fixture did not start a world battle");
  return {
    ...started.state,
    nextMonsterSequence: 137,
    nextBattleSequence: 241,
  };
}

function activeDungeonMigrationState(): OfficialGameStateV1 {
  const entered = validOfficialDungeonState();
  if (entered.dungeon === undefined || entered.world === undefined) {
    throw new Error("migration fixture has no dungeon state");
  }
  const party = WorldTripParty.fromStateSnapshot(officialData, entered.party);
  const profile = PlayerProfile.fromStateSnapshot(
    entered.profile,
    party.monsters().map(({ level }) => level),
    party,
  );
  const questRuntime = new GuildQuestRuntime(officialQuests, entered.quests);
  const run = DungeonRuntimeController.restore({
    resources: officialResources,
    monsterTypes: officialData.allMonsters().map(({ shortType }) => shortType),
    legacyDungeonGenerationSemantics: true,
    isCompletionSet: (key) => questRuntime.hasCompletedFixedEncounter(key),
    isQuestUsable: (key) => questRuntime.canUseQuestKey(key),
    isMonsterRegistered: (shortType) => profile.highestRegisteredLevel(shortType) > 0,
    isCatchQuestDone: (instanceName) => profile.hasCompletedCatchQuest(instanceName),
    runSeed: 0,
  }, entered.dungeon.run);
  const currentRoomId = run.session.currentRoom.id;
  const target = run.session.state.rooms.find((room) =>
    room.id !== currentRoomId && room.encounter !== undefined);
  if (target?.encounter === undefined) throw new Error("migration fixture has no dungeon encounter");
  const previous = new Map<string, string | undefined>([[currentRoomId, undefined]]);
  const queue = [currentRoomId];
  while (queue.length > 0 && !previous.has(target.id)) {
    const roomId = queue.shift()!;
    const room = run.session.state.rooms.find(({ id }) => id === roomId)!;
    for (const link of room.links) {
      if (previous.has(link.targetRoomId)) continue;
      previous.set(link.targetRoomId, roomId);
      queue.push(link.targetRoomId);
    }
  }
  if (!previous.has(target.id)) throw new Error("migration fixture dungeon path is unreachable");
  const path: string[] = [];
  for (let roomId = target.id; roomId !== currentRoomId;) {
    path.push(roomId);
    const prior = previous.get(roomId);
    if (prior === undefined) throw new Error("migration fixture dungeon path is incomplete");
    roomId = prior;
  }
  for (const roomId of path.reverse()) {
    const movement = run.session.moveToRoom(roomId);
    for (const action of movement.actions) {
      if (action.kind === "encounter" && action.encounter.id !== target.encounter.id) {
        run.resolveEncounter(action.encounter, "victory");
      }
    }
  }
  const ready: OfficialGameStateV1 = {
    ...entered,
    location: {
      kind: "dungeon",
      dungeonId: run.session.snapshot().definitionId,
      floor: run.route.floor,
      roomId: run.session.currentRoom.id,
    },
    dungeon: {
      ...entered.dungeon,
      run: run.snapshot(),
    },
  };
  const started = officialReducer.apply({
    playerId,
    slotId: "slot-1",
    pack: officialPack,
    state: ready,
    previousRevision: 1,
    now: "2026-08-04T00:00:00.000Z",
  }, { type: "dungeon.selectRoom", roomId: target.id });
  if (started.state.battle === undefined || started.state.dungeon === undefined) {
    throw new Error("migration fixture did not start a dungeon battle");
  }
  return {
    ...started.state,
    nextMonsterSequence: 139,
    nextBattleSequence: 243,
  };
}

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function parseState(value: unknown): State {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { poi?: unknown }).poi !== "string"
  ) {
    throw new Error("invalid test state");
  }
  return { poi: (value as { poi: string }).poi };
}

function storeOptions(directory: string) {
  return {
    dataDirectory: directory,
    logicPackId: pack.logicPackId,
    simulationVersion: pack.simulationVersion,
    worldId: "World",
    parseState,
  };
}

function officialV12Store(directory: string, removePath?: typeof rm): FileAuthoritativeSlotStore<
  OfficialGameStateV12,
  OfficialGameProjectionBodyV12
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV12Pack.logicPackId,
    simulationVersion: officialV12Pack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV12(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV12Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV12Schema.parse(value),
    validateRecord: (record) => officialV12Reducer.validatePersistedRecord(record),
    ...(removePath === undefined ? {} : { removePath }),
    legacyMigrations: [
      legacySimulationMigration({
        sourceSimulationVersion: OFFICIAL_GAME_V11_SIMULATION_VERSION,
        parseSourceProjection: (value) => SlotProjectionV1Schema.parse(value),
        parseSourceCommandResult: (value) => GameCommandResultV1Schema.parse(value),
        migrate: ({ state, projection }) => {
          const migratedState = migrateOfficialGameV11ToV12({
            data: officialData,
            quests: officialQuests,
            state,
            projection,
            context: { dungeonResources: officialResources },
          });
          return {
            state: migratedState,
            projection: officialV12Reducer.projectPersistedState(migratedState),
          };
        },
      }),
    ],
  });
}

/** A v13-only writer, used to lay down a genuine v13 source file for the v13 -> v14 upgrade. */
function officialV13Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV13,
  OfficialGameProjectionBodyV13
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV13Pack.logicPackId,
    simulationVersion: officialV13Pack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV13(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV13Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV13Schema.parse(value),
    validateRecord: (record) => officialV13Reducer.validatePersistedRecord(record),
  });
}

/**
 * The installed generation, wired exactly as `cli.ts` wires it: every legacy source declares the
 * projection and receipt shapes it was actually written in. A shared v11 parser here would reject
 * the `collectionClaims` sibling that v12 and v13 both persist, which is precisely how live
 * accounts were locked out of login.
 */
function officialV14Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV14,
  OfficialGameProjectionBodyV14
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV14Pack.logicPackId,
    simulationVersion: officialV14Pack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV14(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV14Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV14Schema.parse(value),
    validateRecord: (record) => officialV14Reducer.validatePersistedRecord(record),
    // Immutable generations coexist. Match the CLI's chronological declaration/newest-first
    // lookup policy so a later v13 fork outranks the stale v12 file it was migrated from.
    legacyMigrations: [
      legacySimulationMigration({
        sourceSimulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
        parseSourceProjection: (value) => OfficialGameProjectionV12Schema.parse(value),
        parseSourceCommandResult: (value) => OfficialGameCommandResultV12Schema.parse(value),
        migrate: ({ state }) => {
          const migratedState = migrateOfficialGameV13ToV14({
            data: officialData,
            quests: officialQuests,
            state: migrateOfficialGameV12ToV13({
              data: officialData,
              quests: officialQuests,
              state,
              context: { dungeonResources: officialResources },
            }),
            context: { dungeonResources: officialResources },
          });
          return {
            state: migratedState,
            projection: officialV14Reducer.projectPersistedState(migratedState),
          };
        },
      }),
      legacySimulationMigration({
        sourceSimulationVersion: OFFICIAL_GAME_V13_SIMULATION_VERSION,
        parseSourceProjection: (value) => OfficialGameProjectionV13Schema.parse(value),
        parseSourceCommandResult: (value) => OfficialGameCommandResultV13Schema.parse(value),
        migrate: ({ state }) => {
          const migratedState = migrateOfficialGameV13ToV14({
            data: officialData,
            quests: officialQuests,
            state,
            context: { dungeonResources: officialResources },
          });
          return {
            state: migratedState,
            projection: officialV14Reducer.projectPersistedState(migratedState),
          };
        },
      }),
    ].reverse(),
  });
}

function officialV15Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV15,
  OfficialGameProjectionBodyV15
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV15Pack.logicPackId,
    simulationVersion: officialV15Pack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV15(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV15Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV15Schema.parse(value),
    validateRecord: (record) => officialV15Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: officialV14Pack.simulationVersion,
      parseSourceProjection: (value) => OfficialGameProjectionV14Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV14Schema.parse(value),
      migrate: ({ state, updatedAt, lastLocationCommand }) => {
        const migratedState = migrateOfficialGameV14ToV15({
          data: officialData,
          quests: officialQuests,
          state,
          updatedAt,
          ...(lastLocationCommand === undefined ? {} : { lastLocationCommand }),
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV15Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV16Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV16,
  OfficialGameProjectionBodyV16
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV16Pack.logicPackId,
    simulationVersion: officialV16Pack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV16(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV16Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV16Schema.parse(value),
    validateRecord: (record) => officialV16Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: officialV15Pack.simulationVersion,
      parseSourceProjection: (value) => OfficialGameProjectionV15Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV15Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV15ToV16({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV16Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV17Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV17,
  OfficialGameProjectionBodyV17
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV17Pack.logicPackId,
    simulationVersion: officialV17Pack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV17(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV17Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV17Schema.parse(value),
    validateRecord: (record) => officialV17Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: officialV16Pack.simulationVersion,
      parseSourceProjection: (value) => OfficialGameProjectionV16Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV16Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV16ToV17({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV17Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV18Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV18,
  OfficialGameProjectionBodyV18
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV18Pack.logicPackId,
    simulationVersion: officialV18Pack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV18(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV18Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV18Schema.parse(value),
    validateRecord: (record) => officialV18Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: officialV17Pack.simulationVersion,
      parseSourceProjection: (value) => OfficialGameProjectionV17Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV17Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV17ToV18({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV18Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV19Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV19,
  OfficialGameProjectionBodyV19
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV19Pack.logicPackId,
    simulationVersion: officialV19Pack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV19(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV19Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV19Schema.parse(value),
    validateRecord: (record) => officialV19Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: officialV18Pack.simulationVersion,
      parseSourceProjection: (value) => OfficialGameProjectionV18Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV18Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV18ToV19({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV19Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV20Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV20,
  OfficialGameProjectionBodyV20
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV20Pack.logicPackId,
    simulationVersion: OFFICIAL_GAME_V20_SIMULATION_VERSION,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV20(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV20Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV20Schema.parse(value),
    validateRecord: (record) => officialV20Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: OFFICIAL_GAME_V19_SIMULATION_VERSION,
      parseSourceProjection: (value) => OfficialGameProjectionV19Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV19Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV19ToV20({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV20Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV21Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV21,
  OfficialGameProjectionBodyV21
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV21Pack.logicPackId,
    simulationVersion: OFFICIAL_GAME_V21_SIMULATION_VERSION,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV21(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV21Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV21Schema.parse(value),
    validateRecord: (record) => officialV21Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: OFFICIAL_GAME_V20_SIMULATION_VERSION,
      parseSourceProjection: (value) => OfficialGameProjectionV20Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV20Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV20ToV21({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV21Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV22Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV22,
  OfficialGameProjectionBodyV22
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV22Pack.logicPackId,
    simulationVersion: OFFICIAL_GAME_V22_SIMULATION_VERSION,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV22(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV22Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV22Schema.parse(value),
    validateRecord: (record) => officialV22Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: OFFICIAL_GAME_V21_SIMULATION_VERSION,
      parseSourceProjection: (value) => OfficialGameProjectionV21Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV21Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV21ToV22({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV22Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}
function officialV23Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV23,
  OfficialGameProjectionBodyV23
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV23Pack.logicPackId,
    simulationVersion: OFFICIAL_GAME_V23_SIMULATION_VERSION,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV23(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV23Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV23Schema.parse(value),
    validateRecord: (record) => officialV23Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: OFFICIAL_GAME_V22_SIMULATION_VERSION,
      parseSourceProjection: (value) => OfficialGameProjectionV22Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV22Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV22ToV23({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV23Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV24Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV24,
  OfficialGameProjectionBodyV24
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV24Pack.logicPackId,
    simulationVersion: OFFICIAL_GAME_V24_SIMULATION_VERSION,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV24(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV24Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV24Schema.parse(value),
    validateRecord: (record) => officialV24Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: OFFICIAL_GAME_V23_SIMULATION_VERSION,
      parseSourceProjection: (value) => OfficialGameProjectionV23Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV23Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV23ToV24({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV24Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV25Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV25,
  OfficialGameProjectionBodyV25
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV25Pack.logicPackId,
    simulationVersion: OFFICIAL_GAME_V25_SIMULATION_VERSION,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV25(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV25Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV25Schema.parse(value),
    validateRecord: (record) => officialV25Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: OFFICIAL_GAME_V24_SIMULATION_VERSION,
      parseSourceProjection: (value) => OfficialGameProjectionV24Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV24Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV24ToV25({
          worlds: [officialWorld],
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV25Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV26Store(directory: string): FileAuthoritativeSlotStore<
  OfficialGameStateV26,
  OfficialGameProjectionBodyV26
> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialV26Pack.logicPackId,
    simulationVersion: OFFICIAL_GAME_V26_SIMULATION_VERSION,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV26(officialData, officialQuests, value, {
      dungeonResources: officialResources,
    }),
    parseProjection: (value) => OfficialGameProjectionV26Schema.parse(value),
    parseCommandResult: (value) => OfficialGameCommandResultV26Schema.parse(value),
    validateRecord: (record) => officialV26Reducer.validatePersistedRecord(record),
    legacyMigrations: [legacySimulationMigration({
      sourceSimulationVersion: OFFICIAL_GAME_V25_SIMULATION_VERSION,
      parseSourceProjection: (value) => OfficialGameProjectionV25Schema.parse(value),
      parseSourceCommandResult: (value) => OfficialGameCommandResultV25Schema.parse(value),
      migrate: ({ state }) => {
        const migratedState = migrateOfficialGameV25ToV26({
          data: officialData,
          quests: officialQuests,
          state,
          context: { dungeonResources: officialResources },
        });
        return {
          state: migratedState,
          projection: officialV26Reducer.projectPersistedState(migratedState),
        };
      },
    })],
  });
}

function officialV11Store(directory: string): FileAuthoritativeSlotStore<OfficialGameStateV1> {
  return new FileAuthoritativeSlotStore({
    dataDirectory: directory,
    logicPackId: officialPack.logicPackId,
    simulationVersion: officialPack.simulationVersion,
    worldId: officialWorld.name,
    parseState: (value) => parseOfficialGameStateV1(
      officialData,
      officialQuests,
      value,
      { dungeonResources: officialResources },
    ),
    validateRecord: (record) => officialReducer.validatePersistedRecord(record),
  });
}

function command(
  commandId: string,
  expectedRevision: number,
  body: GameCommandEnvelopeV1["command"],
  expectedDecisionId?: string,
): GameCommandEnvelopeV1 {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    commandId,
    expectedRevision,
    ...(expectedDecisionId === undefined ? {} : { expectedDecisionId }),
    command: body,
  };
}

describe("restart-safe authoritative slot files", () => {
  it("stores immutable results in sidecars and leaves an idempotent replay entirely read-only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-v2-"));
    directories.push(directory);
    const service = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
      now: () => 123_456_000,
    });
    const create = command("command_create_v2_0001", 0, {
      type: "slot.create",
      starterElement: "Water",
    });
    const committed = await service.execute(playerId, "slot-1", create);
    const path = await findSlotFile(directory);
    const snapshot = JSON.parse(await readFile(path, "utf8")) as {
      schemaVersion: number;
      receipts: Array<Record<string, unknown>>;
    };
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.receipts).toHaveLength(1);
    expect(snapshot.receipts[0]).toMatchObject({
      commandId: create.commandId,
      canonicalEnvelope: expect.any(String),
      resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(snapshot.receipts[0]).not.toHaveProperty("result");
    const sidecars = await readdir(receiptDirectoryForSlot(path));
    expect(sidecars).toHaveLength(1);

    const beforeSnapshot = await readFile(path, "utf8");
    const beforeFingerprint = await stat(path, { bigint: true });
    await expect(service.execute(playerId, "slot-1", create))
      .resolves.toEqual({ ...committed, idempotentReplay: true });
    const afterFingerprint = await stat(path, { bigint: true });
    expect(await readFile(path, "utf8")).toBe(beforeSnapshot);
    expect(afterFingerprint.mtimeNs).toBe(beforeFingerprint.mtimeNs);
    expect(await readdir(receiptDirectoryForSlot(path))).toEqual(sidecars);
  });

  it("cold-loads concurrent receipt histories within one process-wide file-handle budget", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-read-budget-"));
    directories.push(directory);
    const store = new FileAuthoritativeSlotStore(storeOptions(directory));
    const service = new AuthoritativeGameService({ pack, reducer, store });
    for (const slot of ["slot-1", "slot-2"] as const) {
      await service.execute(playerId, slot, command(`budget_create_${slot}`, 0,
        { type: "slot.create", starterElement: "Water" }));
      for (let revision = 1; revision <= 24; revision++) {
        await service.execute(playerId, slot, command(`budget_move_${slot}_${revision}`, revision,
          { type: "world.navigate", targetPoiId: "Forest" }, `decision-${revision}`));
      }
    }
    const original = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).readFile;
    let active = 0, peak = 0, reads = 0;
    vi.mocked(readFile).mockImplementation((async (...args: Parameters<typeof readFile>) => {
      if (!String(args[0]).endsWith(".receipt")) return original(...args);
      reads++;
      peak = Math.max(peak, ++active);
      try {
        if (active > 8) throw Object.assign(new Error("fixture file handle budget exhausted"), { code: "EMFILE" });
        await new Promise(resolve => setTimeout(resolve, 2));
        return await original(...args);
      } finally { active--; }
    }) as typeof readFile);
    try {
      const cold = new FileAuthoritativeSlotStore(storeOptions(directory));
      const loaded = await Promise.all([cold.read(playerId, "slot-1"), cold.read(playerId, "slot-2")]);
      expect(loaded.map(record => record?.receipts.size)).toEqual([25, 25]);
      expect(reads).toBe(50);
      expect(peak).toBeLessThanOrEqual(8);
      expect(active).toBe(0);
    } finally { vi.mocked(readFile).mockImplementation(original); }
  });

  it("fails closed when a v2 receipt sidecar no longer matches the snapshot digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-v2-digest-"));
    directories.push(directory);
    const service = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
    });
    await service.execute(playerId, "slot-1", command("command_create_v2_digest", 0, {
      type: "slot.create",
      starterElement: "Water",
    }));
    const path = await findSlotFile(directory);
    const { sidecar, sidecarPath } = await readFirstReceiptSidecar(path);
    (sidecar.result as { revision: number }).revision = 99;
    await writeFile(sidecarPath, JSON.stringify(sidecar), "utf8");
    const restarted = new FileAuthoritativeSlotStore(storeOptions(directory));
    await expect(restarted.read(playerId, "slot-1"))
      .rejects.toThrow(/sidecar digest disagrees/);
  });

  it("materializes an existing monolithic v1 slot into v2 on its next mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-v1-upgrade-"));
    directories.push(directory);
    const initial = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
    });
    await initial.execute(playerId, "slot-1", command("command_create_v1_upgrade", 0, {
      type: "slot.create",
      starterElement: "Water",
    }));
    const path = await findSlotFile(directory);
    const v2 = JSON.parse(await readFile(path, "utf8")) as {
      schemaVersion: number;
      receipts: Array<{
        commandId: string;
        canonicalEnvelope: string;
        resultSha256: string;
      }>;
      [key: string]: unknown;
    };
    const { sidecar } = await readFirstReceiptSidecar(path);
    const [reference] = v2.receipts;
    if (reference === undefined) throw new Error("v2 fixture receipt missing");
    await writeFile(path, JSON.stringify({
      ...v2,
      schemaVersion: 1,
      receipts: [{
        commandId: reference.commandId,
        canonicalEnvelope: reference.canonicalEnvelope,
        result: sidecar.result,
      }],
    }), "utf8");
    await rm(receiptDirectoryForSlot(path), { recursive: true });

    const restarted = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
    });
    await restarted.execute(
      playerId,
      "slot-1",
      command(
        "command_move_v1_upgrade",
        1,
        { type: "world.navigate", targetPoiId: "Forest" },
        "decision-1",
      ),
    );
    const upgraded = JSON.parse(await readFile(path, "utf8")) as {
      schemaVersion: number;
      receipts: readonly unknown[];
    };
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.receipts).toHaveLength(2);
    expect(await readdir(receiptDirectoryForSlot(path))).toHaveLength(2);
  });

  it("restores state and exact idempotency receipts after service restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-"));
    directories.push(directory);
    const makeService = () => new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
      now: () => 123_456_000,
    });
    const create = command("command_create_0001", 0, {
      type: "slot.create",
      starterElement: "Water",
    });
    const first = await makeService().execute(playerId, "slot-1", create);
    const restarted = makeService();
    const replay = await restarted.execute(playerId, "slot-1", create);
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    const moved = await restarted.execute(
      playerId,
      "slot-1",
      command(
        "command_move_forest1",
        1,
        { type: "world.navigate", targetPoiId: "Forest" },
        "decision-1",
      ),
    );
    expect(moved.projection).toMatchObject({
      revision: 2,
      location: { kind: "world", poiId: "Forest" },
    });
  });

  it("fails loudly instead of bootstrapping a tampered projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-"));
    directories.push(directory);
    const service = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
    });
    await service.execute(playerId, "slot-1", command("command_create_0001", 0, {
      type: "slot.create",
      starterElement: "Water",
    }));
    const path = await findSlotFile(directory);
    const file = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    (file["projection"] as { revision: number }).revision = 999;
    await writeFile(path, JSON.stringify(file), "utf8");
    await expect(service.bootstrap(playerId, "slot-1")).rejects.toThrow(
      /projection does not match/,
    );
  });

  it("rejects unknown keys in file envelopes and receipt entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-"));
    directories.push(directory);
    const service = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
    });
    await service.execute(playerId, "slot-1", command("command_create_0001", 0, {
      type: "slot.create",
      starterElement: "Water",
    }));
    const path = await findSlotFile(directory);
    const file = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    file.unexpected = true;
    await writeFile(path, JSON.stringify(file), "utf8");
    const store = new FileAuthoritativeSlotStore(storeOptions(directory));
    await expect(store.read(playerId, "slot-1")).rejects.toThrow(/unknown file envelope field/);

    delete file.unexpected;
    const receipts = file.receipts as Array<Record<string, unknown>>;
    receipts[0]!.unexpected = true;
    await writeFile(path, JSON.stringify(file), "utf8");
    await expect(store.read(playerId, "slot-1"))
      .rejects.toThrow(/unknown command receipt reference field/);
  });

  it("runs the installed semantic validator while reading a persisted slot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-"));
    directories.push(directory);
    const service = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
    });
    const create = command("command_create_0001", 0, {
      type: "slot.create",
      starterElement: "Water",
    });
    await service.execute(playerId, "slot-1", create);
    const path = await findSlotFile(directory);
    const file = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    (file["state"] as { poi: string }).poi = "ForeignPoi";
    await writeFile(path, JSON.stringify(file), "utf8");

    const guardedStore = new FileAuthoritativeSlotStore({
      ...storeOptions(directory),
      validateRecord: ({ state }) => {
        if (state.poi === "ForeignPoi") throw new Error("installed definitions reject the state");
      },
    });
    await expect(guardedStore.read(playerId, "slot-1")).rejects.toMatchObject({
      code: "STATE_CORRUPT",
    });
  });

  it("admits a semantically restored Official dungeon file and fails closed without resources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-official-store-"));
    directories.push(directory);
    const state = validOfficialDungeonState();
    const projection = SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 1,
      updatedAt: "2026-08-02T00:00:00.000Z",
      logicPackId: officialPack.logicPackId,
      simulationVersion: officialPack.simulationVersion,
      trustTier: "official",
      ...officialReducer.projectPersistedState(state),
    });
    const makeStore = (withResources: boolean) => new FileAuthoritativeSlotStore({
      dataDirectory: directory,
      logicPackId: officialPack.logicPackId,
      simulationVersion: officialPack.simulationVersion,
      worldId: officialWorld.name,
      parseState: (value) => parseOfficialGameStateV1(
        officialData,
        officialQuests,
        value,
        withResources ? { dungeonResources: officialResources } : {},
      ),
      validateRecord: (record) => officialReducer.validatePersistedRecord(record),
    });
    const seedService = new AuthoritativeGameService({
      pack: officialPack,
      reducer: officialReducer,
      store: makeStore(true),
    });
    await seedService.execute(playerId, "slot-1", command("official_create_0001", 0, {
      type: "slot.create",
      starterElement: "Water",
    }));
    const path = await findSlotFile(directory);
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      playerId,
      slotId: "slot-1",
      logicPackId: officialPack.logicPackId,
      simulationVersion: officialPack.simulationVersion,
      revision: 1,
      eventCursor: 1,
      updatedAt: "2026-08-02T00:00:00.000Z",
      state,
      projection,
      receipts: [],
    }), "utf8");

    const validService = new AuthoritativeGameService({
      pack: officialPack,
      reducer: officialReducer,
      store: makeStore(true),
      now: () => Date.parse("2026-08-02T00:00:00.000Z"),
    });
    await expect(validService.bootstrap(playerId, "slot-1")).resolves.toMatchObject({
      location: { kind: "dungeon" },
      dungeon: { worldId: officialWorld.name, entrancePoiId: state.world!.currentPoiId },
    });

    const unavailableService = new AuthoritativeGameService({
      pack: officialPack,
      reducer: officialReducer,
      store: makeStore(false),
    });
    await expect(unavailableService.bootstrap(playerId, "slot-1")).rejects.toMatchObject({
      code: "STATE_CORRUPT",
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ receipts: [] });
  });

  it("isolates the same player and slot across configured worlds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-"));
    directories.push(directory);
    const first = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
    });
    await first.execute(playerId, "slot-1", command("command_create_0001", 0, {
      type: "slot.create",
      starterElement: "Water",
    }));
    const otherWorld = new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore({
        ...storeOptions(directory),
        worldId: "World_2",
      }),
    });
    await expect(otherWorld.bootstrap(playerId, "slot-1"))
      .rejects.toMatchObject({ code: "SLOT_NOT_FOUND" });
  });

  it("reads a legacy slot and copies it into the namespace without deleting the legacy file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-"));
    directories.push(directory);
    const makeService = () => new AuthoritativeGameService({
      pack,
      reducer,
      store: new FileAuthoritativeSlotStore(storeOptions(directory)),
    });
    const created = await makeService().execute(
      playerId,
      "slot-1",
      command("command_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const namespaced = await findSlotFile(directory);
    const legacy = join(directory, "players", playerId, "slot-1.json");
    await mkdir(join(directory, "players", playerId), { recursive: true });
    await writeFile(legacy, await readFile(namespaced, "utf8"), "utf8");
    await cp(receiptDirectoryForSlot(namespaced), receiptDirectoryForSlot(legacy), { recursive: true });
    await rm(namespaced);
    await rm(receiptDirectoryForSlot(namespaced), { recursive: true });

    await makeService().execute(
      playerId,
      "slot-1",
      command(
        "command_move_forest1",
        created.revision,
        { type: "world.navigate", targetPoiId: "Forest" },
        "decision-1",
      ),
    );
    expect(await readFile(legacy, "utf8")).toContain('"revision":1');
    expect(await findSlotFile(join(directory, "authoritative-slots"))).not.toBe(legacy);
  });

  it("upgrades an explicit prior simulation without rewriting its source file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-store-"));
    directories.push(directory);
    const sourceSimulationVersion = "file-store-test-v0";
    // The service intentionally admits only installed Official generations. Build a valid v11
    // record through that boundary, then place an equivalent historical record in the synthetic
    // namespace this storage-only migration test owns.
    const sourceMemory = new InMemoryAuthoritativeSlotStore<State>();
    const sourceService = new AuthoritativeGameService({
      pack,
      reducer,
      store: sourceMemory,
    });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("legacy_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    await sourceService.execute(
      playerId,
      "slot-1",
      command(
        "legacy_move_forest01",
        1,
        { type: "world.navigate", targetPoiId: "Forest" },
        "decision-1",
      ),
    );
    const sourceRecord = await sourceMemory.read(playerId, "slot-1");
    if (sourceRecord === undefined) throw new Error("source record was not created");
    const sourceStore = new FileAuthoritativeSlotStore<State>({
      ...storeOptions(directory),
      simulationVersion: sourceSimulationVersion,
    });
    await sourceStore.transact(playerId, "slot-1", async () => ({
      record: {
        ...sourceRecord,
        simulationVersion: sourceSimulationVersion,
        projection: {
          ...sourceRecord.projection,
          simulationVersion: sourceSimulationVersion,
        },
        receipts: new Map([...sourceRecord.receipts].map(([commandId, receipt]) => [
          commandId,
          {
            ...receipt,
            result: {
              ...receipt.result,
              projection: {
                ...receipt.result.projection,
                simulationVersion: sourceSimulationVersion,
              },
            },
          },
        ])),
      },
      value: undefined,
    }));
    const sourcePath = await findSlotFile(directory);
    expect(await readFile(sourcePath, "utf8")).toContain(`"${sourceSimulationVersion}"`);

    let observedLocationCommand: string | undefined;
    const migratedStore = new FileAuthoritativeSlotStore({
      ...storeOptions(directory),
      legacyMigrations: [
        legacySimulationMigration({
          sourceSimulationVersion: "file-store-test-missing",
          parseSourceProjection: (value) => SlotProjectionV1Schema.parse(value),
          parseSourceCommandResult: (value) => GameCommandResultV1Schema.parse(value),
          migrate: () => {
            throw new Error("missing migration source must not run");
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion,
          parseSourceProjection: (value) => SlotProjectionV1Schema.parse(value),
          parseSourceCommandResult: (value) => GameCommandResultV1Schema.parse(value),
          migrate: ({ state, projection, lastLocationCommand }) => {
            observedLocationCommand = lastLocationCommand?.type;
            const {
              slotId: _slotId,
              revision: _revision,
              updatedAt: _updatedAt,
              logicPackId: _logicPackId,
              simulationVersion: _simulationVersion,
              trustTier: _trustTier,
              ...body
            } = projection;
            return { state: parseState(state), projection: body };
          },
        }),
      ],
    });
    const migratedService = new AuthoritativeGameService({
      pack,
      reducer,
      store: migratedStore,
    });
    const bootstrap = await migratedService.bootstrap(playerId, "slot-1");
    expect(bootstrap).toMatchObject({
      revision: 2,
      simulationVersion: pack.simulationVersion,
      location: { kind: "world", poiId: "Forest" },
    });
    expect(observedLocationCommand).toBe("world.navigate");
    expect(await readFile(sourcePath, "utf8")).toContain(`"${sourceSimulationVersion}"`);

    await migratedService.execute(
      playerId,
      "slot-1",
      command(
        "migrated_move_town1",
        2,
        { type: "world.navigate", targetPoiId: "Town" },
        "decision-2",
      ),
    );
    expect(await readFile(sourcePath, "utf8")).toContain('"revision":2');
    const slotFiles = await findAllSlotFiles(join(directory, "authoritative-slots"));
    expect(slotFiles).toHaveLength(2);
    expect(slotFiles).toContain(sourcePath);
  });
});

describe("Task 6 immutable official v11 to v12 file migration", () => {
  it.each([
    "source projection slotId",
    "source projection revision",
    "source projection updatedAt",
    "source projection trustTier",
    "source projection logicPackId",
    "source projection simulationVersion",
  ] as const)(
    "rejects inconsistent %s before migration without creating a target or changing the source",
    async (field) => {
      const directory = await mkdtemp(join(tmpdir(), "dib-game-v12-source-integrity-"));
      directories.push(directory);
      const sourceService = new AuthoritativeGameService({
        pack: officialPack,
        reducer: officialReducer,
        store: officialV11Store(directory),
      });
      await sourceService.execute(
        playerId,
        "slot-1",
        command(`v11_source_integrity_${field.replace(/[^A-Za-z0-9_-]/g, "_")}`, 0, {
          type: "slot.create",
          starterElement: "Water",
        }),
      );
      const sourcePath = await findSlotFile(directory);
      const file = JSON.parse(await readFile(sourcePath, "utf8")) as {
        projection: Record<string, unknown>;
      };
      switch (field) {
        case "source projection slotId":
          file.projection.slotId = "slot-2";
          break;
        case "source projection revision":
          file.projection.revision = 99;
          break;
        case "source projection updatedAt":
          delete file.projection.updatedAt;
          break;
        case "source projection trustTier":
          delete file.projection.trustTier;
          break;
        case "source projection logicPackId":
          file.projection.logicPackId = `logic-v1:${"a".repeat(64)}`;
          break;
        case "source projection simulationVersion":
          file.projection.simulationVersion = "official-game-v10";
          break;
      }
      await writeFile(sourcePath, JSON.stringify(file), "utf8");
      const untouched = await readFile(sourcePath, "utf8");
      const targetService = new AuthoritativeGameService<
        OfficialGameStateV12,
        OfficialGameProjectionBodyV12
      >({ pack: officialV12Pack, reducer: officialV12Reducer, store: officialV12Store(directory) });

      await expect(targetService.bootstrap(playerId, "slot-1")).rejects.toMatchObject({
        code: "STATE_CORRUPT",
      });
      expect(await readFile(sourcePath, "utf8")).toBe(untouched);
      expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);
    },
  );

  it.each([
    "slotId",
    "revision",
    "logicPackId",
    "simulationVersion",
  ] as const)(
    "rejects a legacy receipt result projection %s mismatch atomically",
    async (field) => {
      const directory = await mkdtemp(join(tmpdir(), "dib-game-v12-receipt-integrity-"));
      directories.push(directory);
      const sourceService = new AuthoritativeGameService({
        pack: officialPack,
        reducer: officialReducer,
        store: officialV11Store(directory),
      });
      await sourceService.execute(
        playerId,
        "slot-1",
        command(`v11_receipt_integrity_create_${field}`, 0, {
          type: "slot.create",
          starterElement: "Water",
        }),
      );
      const sourcePath = await findSlotFile(directory);
      const { file, sidecar, sidecarPath } = await readFirstReceiptSidecar(sourcePath);
      const receiptProjection = (sidecar.result as { projection: Record<string, unknown> }).projection;
      if (field === "slotId") receiptProjection.slotId = "slot-2";
      else if (field === "revision") receiptProjection.revision = 99;
      else if (field === "logicPackId") receiptProjection.logicPackId = `logic-v1:${"a".repeat(64)}`;
      else receiptProjection.simulationVersion = "official-game-v10";
      await writeFile(sidecarPath, JSON.stringify(sidecar), "utf8");
      file.receipts[0]!.resultSha256 = sha256Json(sidecar.result);
      await writeFile(sourcePath, JSON.stringify(file), "utf8");
      const untouched = await readFile(sourcePath, "utf8");
      const targetService = new AuthoritativeGameService<
        OfficialGameStateV12,
        OfficialGameProjectionBodyV12
      >({ pack: officialV12Pack, reducer: officialV12Reducer, store: officialV12Store(directory) });

      await expect(targetService.bootstrap(playerId, "slot-1")).rejects.toMatchObject({
        code: "STATE_CORRUPT",
      });
      expect(await readFile(sourcePath, "utf8")).toBe(untouched);
      expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);
    },
  );

  it.each(["slot-unknown", "..\\escape", "..\\..\\outside"] as const)(
    "rejects a direct store caller runtime slot ID %s before any path effect",
    async (runtimeSlotId) => {
      const directory = await mkdtemp(join(tmpdir(), "dib-game-store-slot-id-"));
      directories.push(directory);
      const outsidePath = runtimeSlotId === "..\\..\\outside"
        ? join(directory, "outside.json")
        : join(directory, "players", "escape.json");
      await mkdir(join(directory, "players"), { recursive: true });
      await writeFile(outsidePath, "sentinel", "utf8");
      const store = new FileAuthoritativeSlotStore(storeOptions(directory));
      await expect(store.read(playerId, runtimeSlotId as never)).rejects.toThrow(
        /invalid authoritative slot ID/i,
      );
      let operationCalled = false;
      await expect(store.transact(playerId, runtimeSlotId as never, async () => {
        operationCalled = true;
        return { record: undefined, value: undefined };
      })).rejects.toThrow(/invalid authoritative slot ID/i);
      expect(operationCalled).toBe(false);
      expect(await readFile(outsidePath, "utf8")).toBe("sentinel");
      expect(await findAllSlotFiles(directory)).toEqual([]);
    },
  );

  it.each([
    ["active world battle", activeWorldMigrationState, {}],
    ["active dungeon battle", activeDungeonMigrationState, { dungeonResources: officialResources }],
  ] as const)(
    "boots an exact %s migration view twice from fresh stores before mutation",
    async (_label, makeState, context) => {
      const directory = await mkdtemp(join(tmpdir(), "dib-game-v12-active-migration-"));
      directories.push(directory);
      const sourceState = makeState();
      expect(sourceState.battle).toBeDefined();
      if (_label === "active dungeon battle") expect(sourceState.dungeon).toBeDefined();
      const sourceService = new AuthoritativeGameService({
        pack: officialPack,
        reducer: officialReducer,
        store: officialV11Store(directory),
      });
      await sourceService.execute(
        playerId,
        "slot-1",
        command(`v11_active_${_label.replace(/[^A-Za-z0-9]/g, "_")}`, 0, {
          type: "slot.create",
          starterElement: "Water",
        }),
      );
      const sourceStore = officialV11Store(directory);
      let expectedState: OfficialGameStateV12 | undefined;
      await sourceStore.transact(playerId, "slot-1", async (current) => {
        if (current === undefined) throw new Error("active migration source was not created");
        const projection = SlotProjectionV1Schema.parse({
          ...current.projection,
          ...officialReducer.projectPersistedState(sourceState),
        });
        officialReducer.validatePersistedRecord({ state: sourceState, projection });
        expectedState = migrateOfficialGameV11ToV12({
          data: officialData,
          quests: officialQuests,
          state: sourceState,
          projection,
          context,
        });
        return {
          record: Object.freeze({
            ...current,
            state: sourceState,
            projection,
            receipts: new Map(),
          }),
          value: undefined,
        };
      });
      const sourcePath = await findSlotFile(directory);
      const sourceBytes = await readFile(sourcePath, "utf8");

      const firstStore = officialV12Store(directory);
      const firstService = new AuthoritativeGameService<
        OfficialGameStateV12,
        OfficialGameProjectionBodyV12
      >({ pack: officialV12Pack, reducer: officialV12Reducer, store: firstStore });
      const random = vi.spyOn(Math, "random");
      const first = await firstService.bootstrap(playerId, "slot-1");
      const secondService = new AuthoritativeGameService<
        OfficialGameStateV12,
        OfficialGameProjectionBodyV12
      >({ pack: officialV12Pack, reducer: officialV12Reducer, store: officialV12Store(directory) });
      const second = await secondService.bootstrap(playerId, "slot-1");
      expect(second).toEqual(first);
      expect(random).not.toHaveBeenCalled();
      random.mockRestore();

      const migrated = await firstStore.read(playerId, "slot-1");
      expect(expectedState).toBeDefined();
      expect(migrated?.state).toEqual(expectedState);
      expect(migrated?.state.battle).toEqual(sourceState.battle);
      expect(migrated?.state.nextMonsterSequence).toBe(sourceState.nextMonsterSequence);
      expect(migrated?.state.nextBattleSequence).toBe(sourceState.nextBattleSequence);
      if (_label === "active dungeon battle") {
        expect(migrated?.state.dungeon).toEqual(sourceState.dungeon);
      }
      expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
      expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);
    },
  );

  it("serves repeatable migration views, materializes atomically, discards old receipts, and survives replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v12-migration-"));
    directories.push(directory);
    const sourceService = new AuthoritativeGameService({
      pack: officialPack,
      reducer: officialReducer,
      store: officialV11Store(directory),
    });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v11_migration_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV12Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({
      pack: officialV12Pack,
      reducer: officialV12Reducer,
      store: targetStore,
      validateRecord: (record) => officialV12Reducer.validatePersistedRecord(record),
    });
    const first = await targetService.bootstrap(playerId, "slot-1");
    const second = await targetService.bootstrap(playerId, "slot-1");
    expect(second).toEqual(first);
    const view = await targetStore.read(playerId, "slot-1");
    expect(view?.simulationVersion).toBe(officialV12Pack.simulationVersion);
    expect(view?.state.collectionClaims).toEqual({ schemaVersion: 1, claimedGoalIds: [] });
    expect(view?.state.pendingEgg).toBeUndefined();
    expect(view?.state.pendingDefeat).toBeUndefined();
    expect(view?.receipts.size).toBe(0);
    expect(await findAllSlotFiles(directory)).toHaveLength(1);

    const expectedDecisionId = first.decision.type === "none"
      ? undefined
      : first.decision.decisionId;
    await expect(targetService.execute(
      playerId,
      "slot-1",
      command(
        "v12_migration_failure_0001",
        1,
        { type: "world.navigate", targetPoiId: "NotARealPoi" },
        expectedDecisionId,
      ),
    )).rejects.toThrow();
    expect(await findAllSlotFiles(directory)).toHaveLength(1);

    const materializingCommand = command(
      "v12_migration_leave_0001",
      1,
      { type: "world.leaveTown" },
      expectedDecisionId,
    );
    const committed = await targetService.execute(playerId, "slot-1", materializingCommand);
    expect(committed.revision).toBe(2);
    expect(committed.projection.simulationVersion).toBe(officialV12Pack.simulationVersion);
    expect(await findAllSlotFiles(directory)).toHaveLength(2);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    const materialized = await targetStore.read(playerId, "slot-1");
    expect(materialized?.receipts.size).toBe(1);
    expect(materialized?.receipts.has("v11_migration_create_0001")).toBe(false);
    expect(materialized?.receipts.has("v12_migration_leave_0001")).toBe(true);

    const restartedStore = officialV12Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({ pack: officialV12Pack, reducer: officialV12Reducer, store: restartedStore });
    const replay = await restartedService.execute(playerId, "slot-1", materializingCommand);
    expect(replay).toEqual({ ...committed, idempotentReplay: true });

    let attemptedCurrentRemoval = false;
    const currentPath = (await findAllSlotFiles(directory)).find((candidate) => candidate !== sourcePath);
    if (currentPath === undefined) throw new Error("materialized v12 file missing");
    const failingRemove = (async (target: Parameters<typeof rm>[0], options?: Parameters<typeof rm>[1]) => {
      const resolvedTarget = resolve(String(target));
      if (resolvedTarget === resolve(currentPath)) attemptedCurrentRemoval = true;
      if (resolvedTarget === resolve(sourcePath)) throw new Error("injected legacy cleanup failure");
      await rm(target, options);
    }) as typeof rm;
    const failingDelete = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({
      pack: officialV12Pack,
      reducer: officialV12Reducer,
      store: officialV12Store(directory, failingRemove),
    });
    await expect(failingDelete.deleteSlot(playerId, "slot-1", 2))
      .rejects.toThrow(/injected legacy cleanup failure/);
    expect(attemptedCurrentRemoval).toBe(false);
    expect((await new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({ pack: officialV12Pack, reducer: officialV12Reducer, store: officialV12Store(directory) })
      .bootstrap(playerId, "slot-1")).revision).toBe(2);

    const deleting = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({ pack: officialV12Pack, reducer: officialV12Reducer, store: officialV12Store(directory) });
    await deleting.deleteSlot(playerId, "slot-1", 2);
    await expect(new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({ pack: officialV12Pack, reducer: officialV12Reducer, store: officialV12Store(directory) })
      .bootstrap(playerId, "slot-1")).rejects.toMatchObject({ code: "SLOT_NOT_FOUND" });
  });

  it.each([
    {
      label: "v12",
      sourcePack: () => officialV12Pack,
      sourceReducer: () => officialV12Reducer,
      sourceStore: officialV12Store,
    },
    {
      label: "v13",
      sourcePack: () => officialV13Pack,
      sourceReducer: () => officialV13Reducer,
      sourceStore: officialV13Store,
    },
  ])(
    "upgrades an official $label slot whose projection carries collectionClaims",
    async ({ label, sourcePack, sourceReducer, sourceStore }) => {
      const directory = await mkdtemp(join(tmpdir(), `dib-game-${label}-to-v14-`));
      directories.push(directory);
      const sourceService = new AuthoritativeGameService<
        OfficialGameStateV12 | OfficialGameStateV13,
        OfficialGameProjectionBodyV12 | OfficialGameProjectionBodyV13
      >({
        pack: sourcePack(),
        reducer: sourceReducer() as GameCommandReducer<
          OfficialGameStateV12 | OfficialGameStateV13,
          OfficialGameProjectionBodyV12 | OfficialGameProjectionBodyV13
        >,
        store: sourceStore(directory) as never,
      });
      await sourceService.execute(
        playerId,
        "slot-1",
        command(`${label}_claims_create_01`, 0, { type: "slot.create", starterElement: "Water" }),
      );
      const sourcePath = await findSlotFile(directory);
      const sourceBytes = await readFile(sourcePath, "utf8");
      const sourceFile = JSON.parse(sourceBytes) as {
        readonly projection: Record<string, unknown>;
        readonly receipts: readonly unknown[];
      };
      // The regression only bites when the source projection actually carries the sibling the
      // frozen v11 schema rejects, and only reaches the receipt parser when a receipt exists.
      expect(sourceFile.projection.collectionClaims).toBeDefined();
      expect(SlotProjectionV1Schema.safeParse(sourceFile.projection).success).toBe(false);
      expect(sourceFile.receipts).toHaveLength(1);

      const targetStore = officialV14Store(directory);
      const targetService = new AuthoritativeGameService<
        OfficialGameStateV14,
        OfficialGameProjectionBodyV14
      >({ pack: officialV14Pack, reducer: officialV14Reducer, store: targetStore });

      const bootstrap = await targetService.bootstrap(playerId, "slot-1");
      expect(bootstrap.simulationVersion).toBe(officialV14Pack.simulationVersion);
      const view = await targetStore.read(playerId, "slot-1");
      expect(view?.simulationVersion).toBe(officialV14Pack.simulationVersion);
      expect(view?.state.collectionClaims).toEqual({ schemaVersion: 1, claimedGoalIds: [] });
      // Listing is what login performs, and it is where the unreadable slot presented itself.
      await expect(targetStore.list(playerId)).resolves.toHaveLength(1);
      expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
      expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);
    },
  );

  it("chooses the newest trustworthy generation when multiple migration sources coexist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-coexisting-generations-"));
    directories.push(directory);
    const v12Service = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({ pack: officialV12Pack, reducer: officialV12Reducer, store: officialV12Store(directory) });
    await v12Service.execute(
      playerId,
      "slot-1",
      command("coexist_v12_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );

    const v13Service = new AuthoritativeGameService<
      OfficialGameStateV13,
      OfficialGameProjectionBodyV13
    >({ pack: officialV13Pack, reducer: officialV13Reducer, store: officialV13Store(directory) });
    const createdV13 = await v13Service.execute(
      playerId,
      "slot-1",
      command("coexist_v13_create_0001", 0, { type: "slot.create", starterElement: "Fire" }),
    );
    const decisionId = createdV13.projection.decision.type === "none"
      ? undefined
      : createdV13.projection.decision.decisionId;
    await v13Service.execute(
      playerId,
      "slot-1",
      command("coexist_v13_leave_0001", 1, { type: "world.leaveTown" }, decisionId),
    );
    expect(await findAllSlotFiles(directory)).toHaveLength(2);

    const targetStore = officialV14Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV14,
      OfficialGameProjectionBodyV14
    >({ pack: officialV14Pack, reducer: officialV14Reducer, store: targetStore });
    const projection = await targetService.bootstrap(playerId, "slot-1");
    expect(projection.revision).toBe(2);
    expect(projection.location.kind).toBe("world");
    expect((await targetStore.read(playerId, "slot-1"))?.revision).toBe(2);
  });

  it.each([
    { label: "at town", leaveTown: false },
    { label: "just after world.leaveTown", leaveTown: true },
  ])("repairs depleted v14 parties $label during the v15 file migration", async ({ label, leaveTown }) => {
    const directory = await mkdtemp(join(tmpdir(), `dib-game-v14-to-v15-${label.replaceAll(" ", "-")}-`));
    directories.push(directory);
    const sourceStore = officialV14Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV14,
      OfficialGameProjectionBodyV14
    >({ pack: officialV14Pack, reducer: officialV14Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v14_v15_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    await sourceStore.transact(playerId, "slot-1", async (current) => {
      if (current === undefined) throw new Error("v14-to-v15 fixture was not created");
      const depleted = parseOfficialGameStateV14(officialData, officialQuests, {
        ...current.state,
        party: {
          ...current.state.party,
          monsters: current.state.party.monsters.map((monster) => ({ ...monster, currentHp: 0 })),
        },
      }, { dungeonResources: officialResources });
      const projection = OfficialGameProjectionV14Schema.parse({
        ...current.projection,
        ...officialV14Reducer.projectPersistedState(depleted),
      });
      return {
        record: Object.freeze({ ...current, state: depleted, projection }),
        value: undefined,
      };
    });
    if (leaveTown) {
      const current = await sourceStore.read(playerId, "slot-1");
      if (current === undefined) throw new Error("v14-to-v15 fixture disappeared");
      const decisionId = current.projection.decision.type === "none"
        ? undefined
        : current.projection.decision.decisionId;
      await sourceService.execute(
        playerId,
        "slot-1",
        command("v14_v15_leave_0001", current.revision, { type: "world.leaveTown" }, decisionId),
      );
    }
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV15Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV15,
      OfficialGameProjectionBodyV15
    >({ pack: officialV15Pack, reducer: officialV15Reducer, store: targetStore });
    const projection = await targetService.bootstrap(playerId, "slot-1");
    const migrated = await targetStore.read(playerId, "slot-1");

    expect(projection.simulationVersion).toBe(officialV15Pack.simulationVersion);
    expect(migrated?.state.party.monsters.every(({ currentHp }) => currentHp > 0)).toBe(true);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);
  });

  it("migrates a persisted v15 slot to the v16 lifecycle-chat projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v15-to-v16-"));
    directories.push(directory);
    const sourceStore = officialV15Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV15,
      OfficialGameProjectionBodyV15
    >({ pack: officialV15Pack, reducer: officialV15Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v15_v16_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV16Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV16,
      OfficialGameProjectionBodyV16
    >({ pack: officialV16Pack, reducer: officialV16Reducer, store: targetStore });
    const projection = await targetService.bootstrap(playerId, "slot-1");
    const migrated = await targetStore.read(playerId, "slot-1");

    expect(projection.simulationVersion).toBe(officialV16Pack.simulationVersion);
    expect(migrated?.simulationVersion).toBe(officialV16Pack.simulationVersion);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);
  });

  it("migrates v16 to v17 without fabricating a battle return", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v16-to-v17-"));
    directories.push(directory);
    const sourceStore = officialV16Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV16,
      OfficialGameProjectionBodyV16
    >({ pack: officialV16Pack, reducer: officialV16Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v16_v17_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV17Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV17,
      OfficialGameProjectionBodyV17
    >({ pack: officialV17Pack, reducer: officialV17Reducer, store: targetStore });
    const projection = OfficialGameProjectionV17Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );

    expect(projection.simulationVersion).toBe(officialV17Pack.simulationVersion);
    expect(projection.dungeonBattleReturn).toBeUndefined();
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);
  });

  it("migrates v17 to v18 without replaying town or dungeon return side effects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v17-to-v18-"));
    directories.push(directory);
    const sourceStore = officialV17Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV17,
      OfficialGameProjectionBodyV17
    >({ pack: officialV17Pack, reducer: officialV17Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v17_v18_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v17-to-v18 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV18Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV18,
      OfficialGameProjectionBodyV18
    >({ pack: officialV18Pack, reducer: officialV18Reducer, store: targetStore });
    const projection = OfficialGameProjectionV18Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const migrated = await targetStore.read(playerId, "slot-1");

    expect(projection.simulationVersion).toBe(officialV18Pack.simulationVersion);
    expect(migrated?.state).toEqual(before.state);
    expect(migrated?.projection.location).toEqual(before.projection.location);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);
  });

  it("migrates v18 to shape-preserving v19 and survives a fresh restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v18-to-v19-"));
    directories.push(directory);
    const sourceStore = officialV18Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV18,
      OfficialGameProjectionBodyV18
    >({ pack: officialV18Pack, reducer: officialV18Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v18_v19_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v18-to-v19 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV19Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV19,
      OfficialGameProjectionBodyV19
    >({ pack: officialV19Pack, reducer: officialV19Reducer, store: targetStore });
    const projection = OfficialGameProjectionV19Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const migrated = await targetStore.read(playerId, "slot-1");
    if (migrated === undefined) throw new Error("v18-to-v19 migration did not persist a record");

    expect(projection.simulationVersion).toBe(officialV19Pack.simulationVersion);
    expect(migrated.state).toEqual(before.state);
    expect(migrated.projection.location).toEqual(before.projection.location);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);

    const restartedStore = officialV19Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV19,
      OfficialGameProjectionBodyV19
    >({ pack: officialV19Pack, reducer: officialV19Reducer, store: restartedStore });
    expect(await restartedService.bootstrap(playerId, "slot-1")).toEqual(projection);
  });

  it("migrates a file-backed v19 slot to v20 without replaying Save Me or town side effects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v19-to-v20-"));
    directories.push(directory);
    const sourceStore = officialV19Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV19,
      OfficialGameProjectionBodyV19
    >({ pack: officialV19Pack, reducer: officialV19Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v19_v20_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v19-to-v20 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV20Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV20,
      OfficialGameProjectionBodyV20
    >({ pack: officialV20Pack, reducer: officialV20Reducer, store: targetStore });
    const projection = OfficialGameProjectionV20Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const migrated = await targetStore.read(playerId, "slot-1");
    if (migrated === undefined) throw new Error("v19-to-v20 migration did not persist a record");

    expect(projection.simulationVersion).toBe(OFFICIAL_GAME_V20_SIMULATION_VERSION);
    expect(migrated.simulationVersion).toBe(OFFICIAL_GAME_V20_SIMULATION_VERSION);
    expect(migrated.state).toEqual(before.state);
    expect(migrated.projection.location).toEqual(before.projection.location);
    expect(migrated.receipts.size).toBe(0);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);

    const restartedStore = officialV20Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV20,
      OfficialGameProjectionBodyV20
    >({ pack: officialV20Pack, reducer: officialV20Reducer, store: restartedStore });
    expect(await restartedService.bootstrap(playerId, "slot-1")).toEqual(projection);
  });

  it("migrates a file-backed v20 slot to v21 without replaying Arena recovery or town side effects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v20-to-v21-"));
    directories.push(directory);
    const sourceStore = officialV20Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV20,
      OfficialGameProjectionBodyV20
    >({ pack: officialV20Pack, reducer: officialV20Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v20_v21_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v20-to-v21 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV21Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV21,
      OfficialGameProjectionBodyV21
    >({ pack: officialV21Pack, reducer: officialV21Reducer, store: targetStore });
    const projection = OfficialGameProjectionV21Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const migrated = await targetStore.read(playerId, "slot-1");
    if (migrated === undefined) throw new Error("v20-to-v21 migration did not persist a record");

    expect(projection.simulationVersion).toBe(OFFICIAL_GAME_V21_SIMULATION_VERSION);
    expect(migrated.simulationVersion).toBe(OFFICIAL_GAME_V21_SIMULATION_VERSION);
    expect(migrated.state).toEqual(before.state);
    expect(migrated.projection.location).toEqual(before.projection.location);
    expect(migrated.receipts.size).toBe(0);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);

    const restartedStore = officialV21Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV21,
      OfficialGameProjectionBodyV21
    >({ pack: officialV21Pack, reducer: officialV21Reducer, store: restartedStore });
    expect(await restartedService.bootstrap(playerId, "slot-1")).toEqual(projection);
  });

  it("migrates a file-backed v21 slot to v22 without replaying Save Me settlement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v21-to-v22-"));
    directories.push(directory);
    const sourceStore = officialV21Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV21,
      OfficialGameProjectionBodyV21
    >({ pack: officialV21Pack, reducer: officialV21Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v21_v22_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v21-to-v22 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV22Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV22,
      OfficialGameProjectionBodyV22
    >({ pack: officialV22Pack, reducer: officialV22Reducer, store: targetStore });
    const projection = OfficialGameProjectionV22Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const migrated = await targetStore.read(playerId, "slot-1");
    if (migrated === undefined) throw new Error("v21-to-v22 migration did not persist a record");

    expect(projection.simulationVersion).toBe(OFFICIAL_GAME_V22_SIMULATION_VERSION);
    expect(migrated.simulationVersion).toBe(OFFICIAL_GAME_V22_SIMULATION_VERSION);
    expect(migrated.state).toEqual(before.state);
    expect(migrated.projection.location).toEqual(before.projection.location);
    expect(migrated.receipts.size).toBe(0);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);

    const restartedStore = officialV22Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV22,
      OfficialGameProjectionBodyV22
    >({ pack: officialV22Pack, reducer: officialV22Reducer, store: restartedStore });
    expect(await restartedService.bootstrap(playerId, "slot-1")).toEqual(projection);
  });

  it("migrates a file-backed v22 slot to v23 without replaying Egg settlement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v22-to-v23-"));
    directories.push(directory);
    const sourceStore = officialV22Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV22,
      OfficialGameProjectionBodyV22
    >({ pack: officialV22Pack, reducer: officialV22Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v22_v23_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v22-to-v23 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV23Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV23,
      OfficialGameProjectionBodyV23
    >({ pack: officialV23Pack, reducer: officialV23Reducer, store: targetStore });
    const projection = OfficialGameProjectionV23Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const migrated = await targetStore.read(playerId, "slot-1");
    if (migrated === undefined) throw new Error("v22-to-v23 migration did not persist a record");

    expect(projection.simulationVersion).toBe(OFFICIAL_GAME_V23_SIMULATION_VERSION);
    expect(migrated.simulationVersion).toBe(OFFICIAL_GAME_V23_SIMULATION_VERSION);
    expect(migrated.state).toEqual(before.state);
    expect(migrated.projection.location).toEqual(before.projection.location);
    expect(migrated.receipts.size).toBe(0);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);

    const restartedStore = officialV23Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV23,
      OfficialGameProjectionBodyV23
    >({ pack: officialV23Pack, reducer: officialV23Reducer, store: restartedStore });
    expect(await restartedService.bootstrap(playerId, "slot-1")).toEqual(projection);
  });

  it.each([false, true])("migrates a file-backed v23 slot to v24 (active battle: %s) and replays receipts after restart", async (activeBattle) => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v23-to-v24-"));
    directories.push(directory);
    const sourceStore = officialV23Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV23,
      OfficialGameProjectionBodyV23
    >({ pack: officialV23Pack, reducer: officialV23Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v23_v24_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    if (activeBattle) {
      const state = parseOfficialGameStateV23(officialData, officialQuests, {
        ...activeWorldMigrationState(), collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
        nextContinuationSequence: 1,
      }, { dungeonResources: officialResources });
      await sourceStore.transact(playerId, "slot-1", async (record) => {
        if (record === undefined) throw new Error("missing source slot");
        return { record: { ...record, state, receipts: new Map(), projection: {
          ...record.projection, ...officialV23Reducer.projectPersistedState(state),
        } }, value: undefined };
      });
    }
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v23-to-v24 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV24Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV24,
      OfficialGameProjectionBodyV24
    >({ pack: officialV24Pack, reducer: officialV24Reducer, store: targetStore });
    const projection = OfficialGameProjectionV24Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const migrated = await targetStore.read(playerId, "slot-1");
    if (migrated === undefined) throw new Error("v23-to-v24 migration did not persist a record");

    expect(projection.simulationVersion).toBe(OFFICIAL_GAME_V24_SIMULATION_VERSION);
    expect(migrated.simulationVersion).toBe(OFFICIAL_GAME_V24_SIMULATION_VERSION);
    expect(migrated.state).toEqual(before.state);
    if (activeBattle) {
      expect(projection.battle?.fixedEncounter?.source.kind).toBe("world");
      expect(projection.battle?.commands).toEqual(before.projection.battle?.commands);
      expect(projection.battle?.randomDraws).toEqual(before.projection.battle?.randomDraws);
      expect(findPresentationLeaks(projection)).toEqual([]);
    }

    expect(migrated.projection.location).toEqual(before.projection.location);
    expect(migrated.receipts.size).toBe(0);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);

    const restartedStore = officialV24Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV24,
      OfficialGameProjectionBodyV24
    >({ pack: officialV24Pack, reducer: officialV24Reducer, store: restartedStore });
    expect(await restartedService.bootstrap(playerId, "slot-1")).toEqual(projection);
    const request = command("v24_tutorial_0001", projection.revision,
      { type: "player.claimTutorialFlag", flag: "Tutorial0" }, projection.decision.type === "none" ? undefined : projection.decision.decisionId);
    const result = await restartedService.execute(playerId, "slot-1", request);
    expect(await restartedService.execute(playerId, "slot-1", request)).toEqual({ ...result, idempotentReplay: true });
    const finalService = new AuthoritativeGameService<OfficialGameStateV24, OfficialGameProjectionBodyV24>({
      pack: officialV24Pack, reducer: officialV24Reducer, store: officialV24Store(directory),
    });
    expect(await finalService.execute(playerId, "slot-1", request)).toEqual({ ...result, idempotentReplay: true });
  });

  it.each([false, true])("migrates a file-backed v24 slot to v25 (active battle: %s) and replays receipts after restart", async (activeBattle) => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v24-to-v25-"));
    directories.push(directory);
    const sourceStore = officialV24Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV24,
      OfficialGameProjectionBodyV24
    >({ pack: officialV24Pack, reducer: officialV24Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v24_v25_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    if (activeBattle) {
      const state = parseOfficialGameStateV24(officialData, officialQuests, {
        ...activeWorldMigrationState(), collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
        nextContinuationSequence: 1,
      }, { dungeonResources: officialResources });
      await sourceStore.transact(playerId, "slot-1", async (record) => {
        if (record === undefined) throw new Error("missing source slot");
        return { record: { ...record, state, receipts: new Map(), projection: {
          ...record.projection, ...officialV24Reducer.projectPersistedState(state),
        } }, value: undefined };
      });
    }
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v24-to-v25 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV25Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV25,
      OfficialGameProjectionBodyV25
    >({ pack: officialV25Pack, reducer: officialV25Reducer, store: targetStore });
    const projection = OfficialGameProjectionV25Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const migrated = await targetStore.read(playerId, "slot-1");
    if (migrated === undefined) throw new Error("v24-to-v25 migration did not persist a record");

    expect(projection.simulationVersion).toBe(OFFICIAL_GAME_V25_SIMULATION_VERSION);
    expect(migrated.simulationVersion).toBe(OFFICIAL_GAME_V25_SIMULATION_VERSION);
    expect(migrated.state).toEqual(before.state);
    if (activeBattle) {
      expect(projection.battle?.fixedEncounter?.source.kind).toBe("world");
      expect(projection.battle?.commands).toEqual(before.projection.battle?.commands);
      expect(projection.battle?.randomDraws).toEqual(before.projection.battle?.randomDraws);
      expect(findPresentationLeaks(projection)).toEqual([]);
    }

    expect(migrated.projection.location).toEqual(before.projection.location);
    expect(migrated.receipts.size).toBe(0);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);

    const restartedStore = officialV25Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV25,
      OfficialGameProjectionBodyV25
    >({ pack: officialV25Pack, reducer: officialV25Reducer, store: restartedStore });
    expect(await restartedService.bootstrap(playerId, "slot-1")).toEqual(projection);
    const request = command("v25_tutorial_0001", projection.revision,
      { type: "player.claimTutorialFlag", flag: "Tutorial0" }, projection.decision.type === "none" ? undefined : projection.decision.decisionId);
    const result = await restartedService.execute(playerId, "slot-1", request);
    expect(await restartedService.execute(playerId, "slot-1", request)).toEqual({ ...result, idempotentReplay: true });
    const finalService = new AuthoritativeGameService<OfficialGameStateV25, OfficialGameProjectionBodyV25>({
      pack: officialV25Pack, reducer: officialV25Reducer, store: officialV25Store(directory),
    });
    expect(await finalService.execute(playerId, "slot-1", request)).toEqual({ ...result, idempotentReplay: true });
  });

  it.each([false, true])("migrates a file-backed v25 slot to v26 (active battle: %s) and replays receipts after restart", async (activeBattle) => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v25-to-v26-"));
    directories.push(directory);
    const sourceStore = officialV25Store(directory);
    const sourceService = new AuthoritativeGameService<
      OfficialGameStateV25,
      OfficialGameProjectionBodyV25
    >({ pack: officialV25Pack, reducer: officialV25Reducer, store: sourceStore });
    await sourceService.execute(
      playerId,
      "slot-1",
      command("v25_v26_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    if (activeBattle) {
      const state = parseOfficialGameStateV25(officialData, officialQuests, {
        ...activeWorldMigrationState(), collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
        nextContinuationSequence: 1,
      }, { dungeonResources: officialResources });
      await sourceStore.transact(playerId, "slot-1", async (record) => {
        if (record === undefined) throw new Error("missing source slot");
        return { record: { ...record, state, receipts: new Map(), projection: {
          ...record.projection, ...officialV25Reducer.projectPersistedState(state),
        } }, value: undefined };
      });
    }
    const before = await sourceStore.read(playerId, "slot-1");
    if (before === undefined) throw new Error("v25-to-v26 fixture was not stored");
    const sourcePath = await findSlotFile(directory);
    const sourceBytes = await readFile(sourcePath, "utf8");

    const targetStore = officialV26Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV26,
      OfficialGameProjectionBodyV26
    >({ pack: officialV26Pack, reducer: officialV26Reducer, store: targetStore });
    const projection = OfficialGameProjectionV26Schema.parse(
      await targetService.bootstrap(playerId, "slot-1"),
    );
    const receiptReads = () => vi.mocked(readFile).mock.calls.filter(call => String(call[0]).endsWith(".receipt")).length;
    const coldReads = receiptReads();
    expect(await targetService.bootstrap(playerId, "slot-1")).toEqual(projection);
    expect(receiptReads()).toBe(coldReads);
    const migrated = await targetStore.read(playerId, "slot-1");
    if (migrated === undefined) throw new Error("v25-to-v26 migration did not persist a record");

    expect(projection.simulationVersion).toBe(OFFICIAL_GAME_V26_SIMULATION_VERSION);
    expect(migrated.simulationVersion).toBe(OFFICIAL_GAME_V26_SIMULATION_VERSION);
    expect(migrated.state).toEqual(before.state);
    if (activeBattle) {
      expect(projection.battle?.fixedEncounter?.source.kind).toBe("world");
      expect(projection.battle?.commands).toEqual(before.projection.battle?.commands);
      expect(projection.battle?.randomDraws).toEqual(before.projection.battle?.randomDraws);
      expect(findPresentationLeaks(projection)).toEqual([]);
    }

    expect(migrated.projection.location).toEqual(before.projection.location);
    expect(migrated.receipts.size).toBe(0);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
    expect(await findAllSlotFiles(directory)).toEqual([sourcePath]);

    const restartedStore = officialV26Store(directory);
    const restartedService = new AuthoritativeGameService<
      OfficialGameStateV26,
      OfficialGameProjectionBodyV26
    >({ pack: officialV26Pack, reducer: officialV26Reducer, store: restartedStore });
    expect(await restartedService.bootstrap(playerId, "slot-1")).toEqual(projection);
    const request = command("v26_tutorial_0001", projection.revision,
      { type: "player.claimTutorialFlag", flag: "Tutorial0" }, projection.decision.type === "none" ? undefined : projection.decision.decisionId);
    const result = await restartedService.execute(playerId, "slot-1", request);
    expect(await restartedService.execute(playerId, "slot-1", request)).toEqual({ ...result, idempotentReplay: true });
    const finalService = new AuthoritativeGameService<OfficialGameStateV26, OfficialGameProjectionBodyV26>({
      pack: officialV26Pack, reducer: officialV26Reducer, store: officialV26Store(directory),
    });
    expect(await finalService.execute(playerId, "slot-1", request)).toEqual({ ...result, idempotentReplay: true });
  });

  it("restores a committed v17 dungeon handoff, clears it once, and replays after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v17-handoff-restart-"));
    directories.push(directory);
    const v12 = parseOfficialGameStateV12(officialData, officialQuests, {
      ...validOfficialDungeonState(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: officialResources });
    const v13 = migrateOfficialGameV12ToV13({
      data: officialData,
      quests: officialQuests,
      state: v12,
      context: { dungeonResources: officialResources },
    });
    const v14 = migrateOfficialGameV13ToV14({
      data: officialData,
      quests: officialQuests,
      state: v13,
      context: { dungeonResources: officialResources },
    });
    const v15 = migrateOfficialGameV14ToV15({
      data: officialData,
      quests: officialQuests,
      state: v14,
      updatedAt: "2026-08-10T00:00:00.000Z",
      context: { dungeonResources: officialResources },
    });
    const v16 = migrateOfficialGameV15ToV16({
      data: officialData,
      quests: officialQuests,
      state: v15,
      context: { dungeonResources: officialResources },
    });
    const migrated = migrateOfficialGameV16ToV17({
      data: officialData,
      quests: officialQuests,
      state: v16,
      context: { dungeonResources: officialResources },
    });
    if (migrated.location.kind !== "dungeon" || migrated.dungeon === undefined) {
      throw new Error("v17 restart fixture has no retained dungeon");
    }
    const state = parseOfficialGameStateV17(officialData, officialQuests, {
      ...migrated,
      dungeonBattleReturn: {
        schemaVersion: 1,
        battleId: "battle-restart-1",
        outcome: "retreat",
        dungeonId: migrated.location.dungeonId,
        floor: migrated.location.floor,
        roomId: migrated.location.roomId,
        catchTypesBeforeBattle: [...migrated.dungeon.run.catchTypes].sort(),
      },
    }, { dungeonResources: officialResources });
    const updatedAt = "2026-08-10T00:00:00.000Z";
    const projection = OfficialGameProjectionV17Schema.parse({
      slotId: "slot-1",
      revision: 1,
      updatedAt,
      logicPackId: officialV17Pack.logicPackId,
      simulationVersion: officialV17Pack.simulationVersion,
      trustTier: "official",
      ...officialV17Reducer.projectPersistedState(state),
    });
    const store = officialV17Store(directory);
    await store.transact(playerId, "slot-1", async () => ({
      record: Object.freeze({
        playerId,
        slotId: "slot-1" as const,
        logicPackId: officialV17Pack.logicPackId,
        simulationVersion: officialV17Pack.simulationVersion,
        revision: 1,
        eventCursor: 0,
        updatedAt,
        state,
        projection,
        receipts: new Map(),
      }),
      value: undefined,
    }));
    const restartedStore = officialV17Store(directory);
    const restarted = new AuthoritativeGameService<
      OfficialGameStateV17,
      OfficialGameProjectionBodyV17
    >({ pack: officialV17Pack, reducer: officialV17Reducer, store: restartedStore });
    const restored = OfficialGameProjectionV17Schema.parse(
      await restarted.bootstrap(playerId, "slot-1"),
    );
    expect(restored.dungeonBattleReturn).toEqual(projection.dungeonBattleReturn);

    const clearingCommand = command("v17_handoff_clear_0001", 1, {
      type: "player.claimTutorialFlag",
      flag: "Tutorial0",
    }, restored.decision.type === "none" ? undefined : restored.decision.decisionId);
    const cleared = await restarted.execute(playerId, "slot-1", clearingCommand);
    const clearedProjection = OfficialGameProjectionV17Schema.parse(cleared.projection);
    expect(clearedProjection.dungeonBattleReturn).toBeUndefined();

    const replayService = new AuthoritativeGameService<
      OfficialGameStateV17,
      OfficialGameProjectionBodyV17
    >({ pack: officialV17Pack, reducer: officialV17Reducer, store: officialV17Store(directory) });
    expect(await replayService.execute(playerId, "slot-1", clearingCommand)).toEqual({
      ...cleared,
      idempotentReplay: true,
    });
  });

  it("serializes two pre-mutation commands against one migration view", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-game-v12-concurrent-migration-"));
    directories.push(directory);
    const concurrentPlayer = "e".repeat(64);
    const sourceService = new AuthoritativeGameService({
      pack: officialPack,
      reducer: officialReducer,
      store: officialV11Store(directory),
    });
    await sourceService.execute(
      concurrentPlayer,
      "slot-1",
      command("v11_concurrent_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const targetStore = officialV12Store(directory);
    const targetService = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({ pack: officialV12Pack, reducer: officialV12Reducer, store: targetStore });
    const view = await targetService.bootstrap(concurrentPlayer, "slot-1");
    const expectedDecisionId = view.decision.type === "none" ? undefined : view.decision.decisionId;
    const sameCommand = command(
      "v12_concurrent_leave_0001",
      1,
      { type: "world.leaveTown" },
      expectedDecisionId,
    );
    const results = await Promise.all([
      targetService.execute(concurrentPlayer, "slot-1", sameCommand),
      targetService.execute(concurrentPlayer, "slot-1", sameCommand),
    ]);
    expect(results.map((result) => result.revision)).toEqual([2, 2]);
    expect(results.filter((result) => result.idempotentReplay)).toHaveLength(1);
    expect((await targetStore.read(concurrentPlayer, "slot-1"))?.receipts.size).toBe(1);
  });

  it.each(["state", "projection"] as const)(
    "rejects a legacy pending Egg in the current v11 %s with SIMULATION_VERSION_UNAVAILABLE",
    async (location) => {
      const directory = await mkdtemp(join(tmpdir(), "dib-game-v12-pending-egg-"));
      directories.push(directory);
      const sourceService = new AuthoritativeGameService({
        pack: officialPack,
        reducer: officialReducer,
        store: officialV11Store(directory),
      });
      await sourceService.execute(
        playerId,
        "slot-1",
        command(`v11_pending_${location}_create`, 0, {
          type: "slot.create",
          starterElement: "Water",
        }),
      );
      const sourcePath = await findSlotFile(directory);
      const file = JSON.parse(await readFile(sourcePath, "utf8")) as {
        state: Record<string, unknown>;
        projection: Record<string, unknown>;
      };
      if (location === "state") {
        file.state.pendingEgg = { schemaVersion: 1, kind: "silver" };
      } else {
        file.projection.pendingEgg = { schemaVersion: 1, kind: "gold" };
        file.projection.decision = { type: "none" };
      }
      await writeFile(sourcePath, JSON.stringify(file), "utf8");
      const untouched = await readFile(sourcePath, "utf8");
      const targetService = new AuthoritativeGameService<
        OfficialGameStateV12,
        OfficialGameProjectionBodyV12
      >({ pack: officialV12Pack, reducer: officialV12Reducer, store: officialV12Store(directory) });
      await expect(targetService.bootstrap(playerId, "slot-1")).rejects.toMatchObject({
        code: "SIMULATION_VERSION_UNAVAILABLE",
      });
      expect(await readFile(sourcePath, "utf8")).toBe(untouched);
      expect(await findAllSlotFiles(directory)).toHaveLength(1);
    },
  );
});

async function findSlotFile(directory: string): Promise<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      try {
        return await findSlotFile(path);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "slot file not found") throw error;
      }
    } else if (entry.name === "slot-1.json") {
      return path;
    }
  }
  throw new Error("slot file not found");
}

async function findAllSlotFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await findAllSlotFiles(path));
    else if (entry.name === "slot-1.json") output.push(path);
  }
  return output;
}

function receiptDirectoryForSlot(slotPath: string): string {
  return `${slotPath.slice(0, -".json".length)}.receipts`;
}

async function readFirstReceiptSidecar(slotPath: string): Promise<{
  file: { receipts: Array<{ resultSha256: string }> };
  sidecar: { result: unknown };
  sidecarPath: string;
}> {
  const file = JSON.parse(await readFile(slotPath, "utf8")) as {
    receipts: Array<{ resultSha256: string }>;
  };
  const names = await readdir(receiptDirectoryForSlot(slotPath));
  const name = names.find((candidate) => candidate.endsWith(".receipt"));
  if (name === undefined) throw new Error("receipt sidecar not found");
  const sidecarPath = join(receiptDirectoryForSlot(slotPath), name);
  const sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as { result: unknown };
  return { file, sidecar, sidecarPath };
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
