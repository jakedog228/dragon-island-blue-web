

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import {
  loadCollectionCatalog,
  loadGameData,
  loadQuestCatalog,
  loadWorldData,
  resolveDataDir,
  type WorldResourceSource,
} from "../../packages/gamedata/src/index.ts";
import {
  WorldTripParty,
  baseStat,
  restoreBattleReplay,
  jobXpForLevel,
  type PlayerMonsterInstance,
  type BattleReplaySnapshotV1,
} from "../../packages/engine/src/index.ts";
import {
  type GameCommandEnvelopeV1,
  type LogicPackDescriptorV1,
} from "../../packages/game-protocol/src/index.ts";
import { PlayerProfile, minimumHeroTotalForLevel, sourceNewGameProfileDefaults } from "../../packages/player-domain/src/index.ts";
import {
  OfficialGameReducer,
  OfficialGameV12Reducer,
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
  OfficialGameV27Reducer,
  createOfficialGameV27LogicPackDescriptor,
  createOfficialGameV26LogicPackDescriptor,
  createOfficialGameV12LogicPackDescriptor,
  createOfficialGameV12Support,
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
  migrateOfficialGameV23ToV24,
  parseOfficialGameStateV12,
  validateOfficialCollectionCatalog,
  validateOfficialGameSupport,
  type OfficialGameStateV1,
  type OfficialGameStateV24,
} from "../../packages/official-game/src/index.ts";

const data = loadGameData();
const dataDirectory = resolveDataDir();
const source: WorldResourceSource = {
  has: (path) => path.endsWith(".plist")
    ? existsSync(resolve(dataDirectory, `${path.slice(0, -6)}.json`)) || /-hd\.plist$/.test(path)
    : true,
  plist: (path) => JSON.parse(readFileSync(
    resolve(dataDirectory, `${path.slice(0, -6)}.json`),
    "utf8",
  )) as unknown,
};
const shortTypes = new Set(data.allMonsters().map(({ shortType }) => shortType));
const world = loadWorldData(source, "World_1-1", shortTypes);
const allWorlds = Object.keys(source.plist("Worlds.plist") as Record<string, unknown>)
  .sort()
  .map((name) => name === world.name ? world : loadWorldData(source, name, shortTypes));
const quests = loadQuestCatalog(source);
const support = validateOfficialGameSupport({
  data, world, worlds: allWorlds, resources: source, quests, startTownId: "First_City",
});
const v12Support = createOfficialGameV12Support({
  support,
  collectionCatalog: validateOfficialCollectionCatalog(loadCollectionCatalog(source, data), data, support),
});
const api = new URL(process.env.DIB_CAPTURE_FIXTURE_API ?? "http://127.0.0.1:8788");
assert(["127.0.0.1", "localhost", "[::1]"].includes(api.hostname), "Fixture requires a loopback API");
const readinessResponse = await fetch(new URL("/api/game/readiness", api));
assert(readinessResponse.ok, "Isolated API is not ready");
const readiness = await readinessResponse.json();
const logicPackId = readiness.installedLogicPackIds[0] as `logic-v1:${string}`;
const pack12 = createOfficialGameV12LogicPackDescriptor(logicPackId, v12Support);
const pack15 = createOfficialGameV15LogicPackDescriptor(logicPackId, v12Support);
const pack16 = createOfficialGameV16LogicPackDescriptor(logicPackId, v12Support);
const pack17 = createOfficialGameV17LogicPackDescriptor(logicPackId, v12Support);
const pack18 = createOfficialGameV18LogicPackDescriptor(logicPackId, v12Support);
const pack19 = createOfficialGameV19LogicPackDescriptor(logicPackId, v12Support);
const pack20 = createOfficialGameV20LogicPackDescriptor(logicPackId, v12Support);
const pack21 = createOfficialGameV21LogicPackDescriptor(logicPackId, v12Support);
const pack22 = createOfficialGameV22LogicPackDescriptor(logicPackId, v12Support);
const pack23 = createOfficialGameV23LogicPackDescriptor(logicPackId, v12Support);
const pack24 = createOfficialGameV24LogicPackDescriptor(logicPackId, v12Support);
const pack25 = createOfficialGameV25LogicPackDescriptor(logicPackId, v12Support);
let randomSource = () => 0;
const legacy = new OfficialGameReducer({
  data, world, worlds: allWorlds, resources: source, quests, startTownId: "First_City", support,
  random: () => randomSource(),
});
// Built exactly as apps/game-server/src/cli.ts builds the production chain.
const v24 = new OfficialGameV24Reducer(new OfficialGameV23Reducer(new OfficialGameV22Reducer(
  new OfficialGameV21Reducer(new OfficialGameV20Reducer(new OfficialGameV19Reducer(
    new OfficialGameV18Reducer(new OfficialGameV17Reducer(new OfficialGameV16Reducer(
      new OfficialGameV15Reducer(new OfficialGameV12Reducer(legacy, v12Support), pack12),
      pack15), pack16), pack17), pack18), pack19), pack20), pack21), pack22), pack23);
const v25 = new OfficialGameV25Reducer(v24, pack24);
const pack26 = createOfficialGameV26LogicPackDescriptor(logicPackId, v12Support);
const v26 = new OfficialGameV26Reducer(data, v25, pack25);
const pack27 = createOfficialGameV27LogicPackDescriptor(logicPackId, v12Support);
const v27 = new OfficialGameV27Reducer(v26, pack26);

type Versioned = { readonly reducer: OfficialGameV24Reducer | OfficialGameV25Reducer | OfficialGameV26Reducer | OfficialGameV27Reducer; readonly pack: LogicPackDescriptorV1 };
const V24: Versioned = { reducer: v24, pack: pack24 };

function apply(version: Versioned, state: OfficialGameStateV24, command: GameCommandEnvelopeV1["command"]) {
  return version.reducer.apply({
    playerId: "v25-player",
    slotId: "slot-1",
    pack: version.pack,
    state,
    previousRevision: 1,
    now: "2026-10-06T00:00:00.000Z",
  }, command);
}

function member(instanceId: string, shortType: string, level: number): PlayerMonsterInstance {
  return {
    instanceId,
    shortType,
    level,
    cumulativeXp: jobXpForLevel(level, data.jobXpPenalty(shortType)),
    currentHp: baseStat(data.monsterByShortType(shortType), "MaxHP", level),
  };
}

function legacyCreate(): OfficialGameStateV1 {
  return legacy.apply({
    playerId: "v25-player", slotId: "slot-1", pack: createOfficialGameV12LogicPackDescriptor(
      logicPackId, v12Support) as never, state: undefined, previousRevision: 0,
    now: "2026-10-06T00:00:00.000Z",
  } as never, { type: "slot.create", starterElement: "Water" }).state;
}

/** Same shape-preserving path every installed slot takes into the v24 namespace. */
function asV24(state: OfficialGameStateV1): OfficialGameStateV24 {
  return migrateOfficialGameV23ToV24({
    data, quests, context: { dungeonResources: source },
    state: parseOfficialGameStateV12(data, quests, {
      ...state, collectionClaims: { schemaVersion: 1, claimedGoalIds: [] }, nextContinuationSequence: 1,
    }, { dungeonResources: source }),
  });
}

function strongState(
  location: Extract<OfficialGameStateV1["location"], { readonly kind: "town" | "world" }>,
  overrides: { readonly licenseType?: "Apprentice"; readonly finishedQuests?: number } = {},
  stones: readonly { element: "Fire" | "Water" | "Life"; level: number }[] = [],
): OfficialGameStateV24 {
  const created = legacyCreate();
  const members = [member("m1", "BlueBabyDragon", 100), member("m2", "BlueBabyDragon", 100),
    member("m3", "BlueBabyDragon", 100), member("m4", "FireCub", 5)];
  const party = new WorldTripParty(data, members, 6, stones);
  const profile = new PlayerProfile({
    ...sourceNewGameProfileDefaults("BlueBabyDragon"),
    heroLevel: 3,
    heroTotalHighestLevels: minimumHeroTotalForLevel(3),
    monsterPartyLevels: members.map(({ level }) => level),
    ...(overrides.licenseType === undefined ? {} : { licenseType: overrides.licenseType }),
  }, party);
  const worldId = location.worldId;
  const poiId = location.kind === "town" ? location.townId : location.poiId;
  return asV24({
    ...created,
    profile: profile.stateSnapshot(),
    party: party.stateSnapshot(),
    quests: {
      ...created.quests,
      finishedQuestNames: quests.definitions.slice(0, overrides.finishedQuests ?? 0).map(({ name }) => name),
    },
    location,
    world: { ...created.world!, worldId, currentPoiId: poiId,
      ...(location.kind === "town" ? { lastTownId: poiId, visitedTownIds: [...new Set([...created.world!.visitedTownIds, poiId])].sort() } : {}) },
  });
}

function worldBattleWithRewards(rewards: OfficialGameStateV24["battle"] extends infer B
  ? B extends { readonly encounter: { readonly rewards: infer R } } ? R : never : never) {
  const ready = strongState({ kind: "world", worldId: "World_1-1", poiId: "1-1_Field_2" });
  const started = apply(V24, {
    ...ready,
    world: {
      ...ready.world!,
      completedPoiIds: ["First_City", "1-1_Turtorial_Hut_1", "1-1_Field_1", "1-1_Field_2"],
      everCompletedPoiIds: ["First_City", "1-1_Turtorial_Hut_1", "1-1_Field_1", "1-1_Field_2"],
      poiWins: { ...ready.world!.poiWins, "1-1_Turtorial_Hut_1": 1, "1-1_Field_1": 1, "1-1_Field_2": 1 },
    },
  }, { type: "world.navigate", targetPoiId: "1-1_Field_3" });
  const battle = started.state.battle;
  if (battle?.encounter.kind !== "world") throw new Error("fixture did not start a world battle");
  return { ...started.state, battle: { ...battle, encounter: { ...battle.encounter, rewards } } };
}

function overCapCaptureState(sourceJobLevels: boolean): OfficialGameStateV24 {
  const state = worldBattleWithRewards([]);
  if (state.battle!.encounter.kind !== "world") throw new Error("expected world fixture");
  const oldGenerated=state.battle!.encounter.generated;
  const encounter = { ...state.battle!.encounter, generated: { kind: "ordinary" as const,
    poiName:oldGenerated.poiName, forced:true, tableKey:oldGenerated.tableKey,
    poiWinsBeforeEncounter:oldGenerated.poiWinsBeforeEncounter, challengeLevel:151,
    monsters: [{ type: "Centurion", level: 151 }],
  } };
  const party = new WorldTripParty(data, [member("m1", "FireTiger", 150)], 6);
  const profile = new PlayerProfile({ ...sourceNewGameProfileDefaults("FireTiger"),
    heroLevel: 50, heroTotalHighestLevels: minimumHeroTotalForLevel(50), monsterPartyLevels: [150],
    captureCards: { 1: 0, 2: 0, 3: 1 },
  }, party);
  const pending: BattleReplaySnapshotV1 = { schemaVersion: 1, randomDraws: [], commands: [],
    teams: [[{ shortType: "FireTiger", level: 150, sourceInstanceId: "m1" }], [{ shortType: "Centurion", level: 151, currentHp: 1 }]],
    options: { silver: profile.snapshot().silver, ...(sourceJobLevels ? { sourceJobLevels: true } : {}) },
  };
  const opening = restoreBattleReplay(data, pending, { randomSource: () => 0 });
  assert.equal(opening.step.type,"awaitingPlayer");
  assert.equal(opening.session.captureChanceOf("t1m0:Centurion",3,150),1,"Fixture must not depend on a lucky capture roll");
  return { ...state, party: party.stateSnapshot(), profile: profile.stateSnapshot(),
    battle: { ...state.battle!, encounter, replay: { ...pending, randomDraws: opening.randomDraws! } } };
}

// Isolated trusted operator fixture. Never writes to campaign namespaces.
import { FileAuthoritativeSlotStore } from '../../apps/game-server/src/fileSlotStore.ts';
import { loginTokenPlayerId } from '../../apps/game-server/src/invites.ts';
import { OfficialGameProjectionV27Schema, OfficialGameCommandResultV27Schema } from '../../packages/game-protocol/src/index.ts';
import { parseOfficialGameStateV27 } from '../../packages/official-game/src/index.ts';
assert(process.env.DIB_CAPTURE_FIXTURE_DIR, "Set DIB_CAPTURE_FIXTURE_DIR to the isolated server directory");
const directory=resolve(process.env.DIB_CAPTURE_FIXTURE_DIR);
const outputRoot=resolve(import.meta.dirname, "../../output");
const outputRelative=relative(outputRoot,directory);
assert(outputRelative && !outputRelative.startsWith("..") && !isAbsolute(outputRelative), "Fixture directory must be inside repository output/");
const token=readFileSync(process.env.DIB_TEST_AUTH_FILE ?? resolve(directory,'fixture-token.txt'),'utf8').trim();
const secret=readFileSync(resolve(directory,'authority-secret.txt'),'utf8').trim();
const playerId=loginTokenPlayerId(secret,token);
const state=overCapCaptureState(true), projection=v27.projectPersistedState(state);
const store=new FileAuthoritativeSlotStore({ dataDirectory:resolve(directory,'api-data'),logicPackId,
 simulationVersion:pack27.simulationVersion,worldId:world.name,
 parseState:value=>parseOfficialGameStateV27(data,quests,value,{dungeonResources:source}),
 parseProjection:value=>OfficialGameProjectionV27Schema.parse(value),
 parseCommandResult:value=>OfficialGameCommandResultV27Schema.parse(value),
 validateRecord:record=>v27.validatePersistedRecord(record as never) });
parseOfficialGameStateV27(data,quests,state,{dungeonResources:source});
if (!process.argv.includes('--write')) {
 console.log('Fixture validated (dry run). Pass --write to create an empty isolated slot.');
} else await store.transact(playerId,'slot-1',async current=>{
 if(current)throw new Error('Refusing to replace any existing slot, including an unplayed fixture');
 const updatedAt=new Date().toISOString();
 return {record:{playerId,slotId:'slot-1',logicPackId,simulationVersion:pack27.simulationVersion,
 revision:1,eventCursor:0,updatedAt,state,receipts:new Map(),projection:{...projection,slotId:'slot-1',revision:1,updatedAt,
 logicPackId,simulationVersion:pack27.simulationVersion,trustTier:'official'}},value:undefined};
});
if(process.argv.includes('--write')) console.log('Isolated v27 fixture created; requested151, constructed150; no campaign credit');
