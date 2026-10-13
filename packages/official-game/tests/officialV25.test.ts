import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadCollectionCatalog,
  loadGameData,
  loadQuestCatalog,
  loadWorldData,
  resolveDataDir,
  type WorldResourceSource,
} from "@dib/gamedata";
import {
  WorldTripParty,
  DungeonRuntimeController,
  GuildQuestRuntime,
  baseStat,
  jobXpForLevel,
  type PlayerMonsterInstance,
} from "@dib/engine";
import {
  AuthoritativeGameService,
  GameServiceError,
  InMemoryAuthoritativeSlotStore,
  ReducerFaultError,
} from "@dib/game-service";
import {
  GAME_PROTOCOL_VERSION,
  OFFICIAL_GAME_V25_SIMULATION_VERSION,
  type GameCommandEnvelopeV1,
  type LogicPackDescriptorV1,
} from "@dib/game-protocol";
import { PlayerProfile, minimumHeroTotalForLevel, sourceNewGameProfileDefaults } from "@dib/player-domain";
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
  migrateOfficialGameV24ToV25,
  parseOfficialGameStateV12,
  validateOfficialCollectionCatalog,
  validateOfficialGameSupport,
  type OfficialGameStateV1,
  type OfficialGameStateV24,
} from "../src/index.js";

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
const logicPackId = `logic-v1:${"7".repeat(64)}` as const;
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
const legacy = new OfficialGameReducer({
  data, world, worlds: allWorlds, resources: source, quests, startTownId: "First_City", support,
  random: () => 0,
});
// Built exactly as apps/game-server/src/cli.ts builds the production chain.
const v24 = new OfficialGameV24Reducer(new OfficialGameV23Reducer(new OfficialGameV22Reducer(
  new OfficialGameV21Reducer(new OfficialGameV20Reducer(new OfficialGameV19Reducer(
    new OfficialGameV18Reducer(new OfficialGameV17Reducer(new OfficialGameV16Reducer(
      new OfficialGameV15Reducer(new OfficialGameV12Reducer(legacy, v12Support), pack12),
      pack15), pack16), pack17), pack18), pack19), pack20), pack21), pack22), pack23);
const v25 = new OfficialGameV25Reducer(v24, pack24);

type Versioned = { readonly reducer: OfficialGameV24Reducer | OfficialGameV25Reducer; readonly pack: LogicPackDescriptorV1 };
const V24: Versioned = { reducer: v24, pack: pack24 };
const V25: Versioned = { reducer: v25, pack: pack25 };

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

function winBattle(version: Versioned, started: ReturnType<typeof apply>) {
  let current = started;
  const events = [...started.events];
  for (let turn = 0; turn < 200 && current.state.location.kind === "battle"; turn += 1) {
    const decision = current.projection.decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no player decision");
    const choice = decision.choices.find(({ blockedReasonId }) => blockedReasonId === undefined);
    if (choice === undefined) throw new Error("fixture has no usable ability");
    const targetIds = choice.target.kind === "self"
      ? []
      : choice.target.kind === "allEnemies" ? [...decision.enemyTargetIds]
        : choice.target.kind === "allFriends" ? [...decision.friendlyTargetIds]
          : choice.target.kind === "enemies" ? decision.enemyTargetIds.slice(0, choice.target.count)
            : choice.target.kind === "friends" ? decision.friendlyTargetIds.slice(0, choice.target.count)
              : [...decision.enemyTargetIds.slice(0, 1)];
    current = apply(version, current.state, {
      type: "battle.chooseAbility", battleId: decision.battleId, actorId: decision.actorId,
      slot: choice.slot, targetIds,
    });
    events.push(...current.events);
  }
  if (current.state.location.kind === "battle") throw new Error("fixture battle did not end");
  return { ...current, events };
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

describe("C1: TreasureData Gem route rewards (all installed versions)", () => {
  const grandmaster = { kind: "gem", level: 200, quality: 1, slot: 3, enabledStats: ["Attack", "Defense"] } as const;

  it.each([["v24", V24], ["v25", V25]] as const)(
    "%s battle commands proceed and settle a slot-3 level-200 Gem at victory",
    (_label, version) => {
      const state = worldBattleWithRewards([grandmaster, { kind: "silver", amount: 7 }]);
      const firstDecision = version.reducer.projectPersistedState(state).decision;
      expect(firstDecision.type).toBe("battle.playerTurn");
      const won = winBattle(version, { state, projection: version.reducer.projectPersistedState(state), events: [] } as never);
      expect(won.events).toContainEqual(expect.objectContaining({
        type: "battle.rewardsGranted",
        rewards: expect.arrayContaining([{ ...grandmaster, enabledStats: [...grandmaster.enabledStats] }]),
      }));
      const gems = won.projection.player.inventory?.looseItems.filter((item) => item.kind === "gem") ?? [];
      expect(gems).toContainEqual(expect.objectContaining({ level: 200, slot: 3, quality: 1 }));
    },
  );

  it("rejects a Gem the generator cannot produce with a typed, non-retryable error before RNG", () => {

    const state = worldBattleWithRewards([{ ...grandmaster, level: 30 }]);
    const decision = v25.projectPersistedState(state).decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no decision");
    let caught: unknown;
    try {
      apply(V25, state, { type: "battle.delay", battleId: decision.battleId, actorId: decision.actorId });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(GameServiceError);
    expect(caught).toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
    expect((caught as GameServiceError).options.retryable ?? false).toBe(false);
  });
});

describe("M3: canonical Soul Stone ids", () => {
  const A = { element: "Fire", level: 4 } as const;
  const B = { element: "Water", level: 7 } as const;

  async function seeded(state: OfficialGameStateV24) {
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV24, ReturnType<OfficialGameV24Reducer["projectPersistedState"]>>();
    const updatedAt = "2026-10-06T00:00:00.000Z";
    await store.transact("p", "slot-1", async () => ({
      record: Object.freeze({
        playerId: "p", slotId: "slot-1", logicPackId, simulationVersion: pack24.simulationVersion,
        revision: 1, eventCursor: 0, updatedAt, state, receipts: new Map(),
        projection: { slotId: "slot-1", revision: 1, updatedAt, logicPackId,
          simulationVersion: pack24.simulationVersion, trustTier: "official", ...v24.projectPersistedState(state) } as never,
      }),
      value: undefined,
    }));
    return new AuthoritativeGameService({
      pack: pack24, reducer: v24, store, validateRecord: (record) => v24.validatePersistedRecord(record),
    });
  }

  it("commits a mid-pool insert under the production v24 service and republishes positional ids", async () => {
    const state = strongState({ kind: "town", worldId: "World_1-1", townId: "First_City" }, {}, [A, B]);
    const service = await seeded(state);
    const before = await service.bootstrap("p", "slot-1");
    expect(before.player.ownedSoulStones.map(({ stoneId }) => stoneId)).toEqual(["soul-stone-1", "soul-stone-2"]);
    const result = await service.execute("p", "slot-1", {
      protocolVersion: GAME_PROTOCOL_VERSION, commandId: "cmd_insert_first_stone_01", expectedRevision: 1,
      command: { type: "party.insertSoulStone", instanceId: "m1", stoneId: "soul-stone-1" },
    });
    expect(result.projection.player.ownedSoulStones).toEqual([
      expect.objectContaining({ stoneId: "soul-stone-1", element: "Water", level: 7 }),
    ]);
    expect(result.projection.player.party.find(({ instanceId }) => instanceId === "m1")?.soulStone)
      .toMatchObject({ element: "Fire", level: 4 });
  });

  it("keeps every committed projection byte-identical: restored live tokens are already positional", () => {
    const state = strongState({ kind: "town", worldId: "World_1-1", townId: "First_City" }, {},
      [A, B, { element: "Life", level: 3 }]);
    const restoredTokens = WorldTripParty.fromStateSnapshot(data, state.party)
      .ownedSoulStoneEntries().map(({ token }) => token);
    expect(v24.projectPersistedState(state).player.ownedSoulStones.map(({ stoneId }) => stoneId))
      .toEqual(restoredTokens);
  });
});

describe("M7: reducer faults are certain non-commits", () => {
  it("reports an unexpected reducer exception as non-retryable INTERNAL without writing", async () => {
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV24, never>();
    const service = new AuthoritativeGameService({
      pack: pack25,
      store,
      reducer: { apply: () => { throw new Error("defect"); } },
    });
    const rejected = service.execute("p", "slot-1", {
      protocolVersion: GAME_PROTOCOL_VERSION, commandId: "cmd_reducer_fault_0001", expectedRevision: 0,
      command: { type: "slot.create", starterElement: "Water" },
    });
    await expect(rejected).rejects.toBeInstanceOf(ReducerFaultError);
    await expect(rejected).rejects.toMatchObject({ code: "INTERNAL", options: { retryable: false } });
    expect(await store.read("p", "slot-1")).toBeUndefined();
  });
});

describe("official-game-v25 source story rules", () => {
  it("is a distinct current identity with the unchanged v24 command allowlist", () => {
    expect(pack25.simulationVersion).toBe(OFFICIAL_GAME_V25_SIMULATION_VERSION);
    expect(pack25.capabilities.commandTypes).toEqual(pack24.capabilities.commandTypes);
    // The full shipped install (dungeons, Warp Gate, Tournaments, Collection) advertises 45 types.
    expect(pack25.capabilities.commandTypes).toHaveLength(45);
  });

  it("records the Apprentice license start and win chats in v25 only", () => {
    const town = strongState({ kind: "town", worldId: "World_1-2", townId: "Capital_City" }, { finishedQuests: 5 });
    for (const [version, recorded] of [[V24, false], [V25, true]] as const) {
      const started = apply(version, town, { type: "arena.startLicenseChallenge" });
      expect(started.state.quests.dialogsSeen.includes("Harald")).toBe(recorded);
      const won = winBattle(version, started);
      expect(won.state.profile).toMatchObject({ licenseType: "Apprentice" });
      expect(won.state.quests.dialogsSeen.includes("HaraldDefeated")).toBe(recorded);
      expect(won.projection.quests?.dialogsSeen.includes("HaraldDefeated")).toBe(recorded);
    }
  });

  it.each([["v24", V24, 0], ["v25", V25, 1]] as const)(
    "%s counts a committed enemy death before an Arena Escape only under source story rules",
    (_name, version, expectedKills) => {
      const town = strongState({ kind: "town", worldId: "World_1-2", townId: "Capital_City" }, { finishedQuests: 5 });
      const ready = { ...town,
        party: { ...town.party, monsters: [member("m1", "Cockatrice", 100)] },
        quests: { ...town.quests, activeQuestNames: ["Defeat20Monsters"], finishedQuestNames: quests.definitions.filter(({ name }) => name !== "Defeat20Monsters").slice(0, 5).map(({ name }) => name), progressByQuestName: {} },
      };
      let current = apply(version, ready, { type: "arena.startLicenseChallenge" });
      const decision = current.projection.decision;
      if (decision.type !== "battle.playerTurn") throw new Error("Arena fixture has no player turn");
      const attack = decision.choices.find((choice) => choice.slot === "usable1");
      if (attack === undefined) throw new Error("Arena fixture has no Attack");
      current = apply(version, current.state, { type: "battle.chooseAbility", battleId: decision.battleId,
        actorId: decision.actorId, slot: attack.slot, targetIds: [decision.enemyTargetIds[0]!] });
      expect(current.state.quests.progressByQuestName["Defeat20Monsters"]?.["quantity"] ?? 0).toBe(expectedKills);
      const next = current.projection.decision;
      if (next.type !== "battle.playerTurn") throw new Error("Arena fixture ended before Escape");
      current = apply(version, current.state, { type: "battle.chooseAbility", battleId: next.battleId,
        actorId: next.actorId, slot: "usable2", targetIds: [] });
      expect(current.state.battle).toBeUndefined();
      expect(current.state.quests.progressByQuestName["Defeat20Monsters"]?.["quantity"] ?? 0).toBe(expectedKills);
    },
  );

  it.each([["v24", V24, false], ["v25", V25, true]] as const)(
    "%s records Caius start and victory chats only under source story rules",
    (_name, version, recorded) => {
      const initial = strongState({ kind: "world", worldId: "World_4-1", poiId: "Dungeon_14" });
      const base = { ...initial,
        party: { ...initial.party, monsters: initial.party.monsters.map((monster) => member(monster.instanceId, "UltimateDragon", 150)) },
        quests: { ...initial.quests, activeQuestNames: ["FinalBattle"] },
      };
      const runtime = new GuildQuestRuntime(quests, base.quests);
      const run = DungeonRuntimeController.enter({
        resources: source, monsterTypes: [...shortTypes], runSeed: 3, legacyDungeonGenerationSemantics: true,
        isCompletionSet: (key) => runtime.hasCompletedFixedEncounter(key),
        isQuestUsable: (key) => runtime.canUseQuestKey(key),
        isMonsterRegistered: () => false, isCatchQuestDone: () => false,
      }, { typeName: "Dungeon", sourceFile: "Dungeon_14.plist", floor: 6 });
      run.session.enterCurrentRoom();
      const target = run.session.state.rooms.find((room) => room.encounter?.kind === "fixed" && room.encounter.startEvent !== undefined);
      if (target?.encounter === undefined) throw new Error("Caius fixture has no boss room");
      const start = run.session.currentRoom.id;
      const previous = new Map<string, string | undefined>([[start, undefined]]);
      const queue = [start];
      while (queue.length && !previous.has(target.id)) {
        const nextRoomId = queue.shift();
        const room = run.session.state.rooms.find(({ id }) => id === nextRoomId)!;
        for (const link of room.links) if (!previous.has(link.targetRoomId)) {
          previous.set(link.targetRoomId, room.id); queue.push(link.targetRoomId);
        }
      }
      const path: string[] = [];
      for (let id = target.id; id !== start;) {
        path.push(id);
        const parent = previous.get(id);
        if (parent === undefined) throw new Error("Caius fixture is disconnected");
        id = parent;
      }
      for (const id of path.reverse()) {
        for (const action of run.session.moveToRoom(id).actions) {
          if (action.kind === "encounter" && action.encounter.id !== target.encounter.id) {
            run.resolveEncounter(action.encounter, "victory");
          }
        }
      }
      const ready = { ...base,
        location: { kind: "dungeon" as const, dungeonId: run.session.snapshot().definitionId, floor: 6, roomId: target.id },
        dungeon: { schemaVersion: 1 as const, run: run.snapshot(), worldId: "World_4-1", entrancePoiId: "Dungeon_14" },
      };
      const started = apply(version, ready, { type: "dungeon.selectRoom", roomId: target.id });
      expect(started.state.quests.dialogsSeen.includes("Caius")).toBe(recorded);
      const won = winBattle(version, started);
      expect(won.state.quests.completedFixedEncounterKeys).toContain("FinalBattle6");
      expect(won.state.quests.dialogsSeen.includes("CaiusDefeated")).toBe(recorded);
    },
  );

  it("gates the Relic zone change on CaiusDefeated in v25 without consuming anything", () => {
    const beach = strongState({ kind: "world", worldId: "World_4-4", poiId: "4-4_Beach_2" });
    expect(() => apply(V25, beach, { type: "world.activateZone", zoneId: "4-4_Beach_2" }))
      .toThrow(expect.objectContaining({ code: "ACTION_NOT_ALLOWED" }));
    // v24 stays immutable: it never read the condition.
    expect(apply(V24, beach, { type: "world.activateZone", zoneId: "4-4_Beach_2" }).state.dungeon).toBeDefined();
    const met = { ...beach, quests: { ...beach.quests, dialogsSeen: ["CaiusDefeated"] } };
    expect(apply(V25, met, { type: "world.activateZone", zoneId: "4-4_Beach_2" }).state.dungeon).toBeDefined();
  });

  it("Tournament exit re-enters the same town through committed intents and advances one day", () => {
    const town = strongState({ kind: "town", worldId: "World_1-2", townId: "Capital_City" }, { finishedQuests: 5 });
    const injured = { ...town, party: { ...town.party, monsters: town.party.monsters.map((monster) => ({ ...monster, currentHp: 1 })) } };
    const left = apply(V25, injured, { type: "world.leaveTown" });
    expect(left.state.world?.dayNumber).toBe(town.world?.dayNumber);
    const entered = apply(V25, left.state, { type: "world.selectCurrentPoi" });
    expect(entered.state.location).toEqual(town.location);
    expect(entered.state.world?.dayNumber).toBe(town.world!.dayNumber + 1);
    expect(entered.state.party.monsters.every((monster) => monster.currentHp > 1)).toBe(true);
  });

  it("accepts Drop Quests with no active quest in v25 and keeps the v24 rejection", () => {
    const town = strongState({ kind: "town", worldId: "World_1-1", townId: "First_City" });
    const guild = { ...town, quests: { ...town.quests, dialogsSeen: ["LeslieSaved"] } };
    expect(() => apply(V24, guild, { type: "quest.dropAll" }))
      .toThrow(expect.objectContaining({ code: "ACTION_NOT_ALLOWED" }));
    const dropped = apply(V25, guild, { type: "quest.dropAll" });
    expect(dropped.events).toEqual([{ type: "quest.droppedAll" }]);
    expect(dropped.state.quests.activeQuestNames).toEqual([]);
  });
});

describe("v24 -> v25 migration", () => {
  it("adds only the license and completed dungeon fixed-encounter chats that durable state proves", () => {
    const town = strongState({ kind: "town", worldId: "World_1-2", townId: "Capital_City" }, { licenseType: "Apprentice" });
    const prior = {
      ...town,
      quests: {
        ...town.quests,
        dialogsSeen: ["LeslieSaved"],
        // FinalBattle6 is Dungeon_14 floor 6 (Caius); KiyoUnique is a world key and adds nothing.
        completedFixedEncounterKeys: ["FinalBattle6", "KiyoUnique"],
      },
    };
    const migrated = migrateOfficialGameV24ToV25({
      data, quests, worlds: allWorlds, state: prior, context: { dungeonResources: source },
    });
    expect(migrated.quests.dialogsSeen).toEqual(
      ["Caius", "CaiusDefeated", "Harald", "HaraldDefeated", "LeslieSaved"]);
    const { quests: _priorQuests, ...priorRest } = prior;
    const { quests: _migratedQuests, ...migratedRest } = migrated;
    expect(migratedRest).toEqual(priorRest);
    expect(migrated.quests.completedFixedEncounterKeys).toEqual(prior.quests.completedFixedEncounterKeys);
    expect(v25.projectPersistedState(migrated).quests?.dialogsSeen).toContain("HaraldDefeated");
  });

  it("is a pure namespace copy for a slot with nothing to repair", () => {
    const town = strongState({ kind: "town", worldId: "World_1-1", townId: "First_City" });
    expect(migrateOfficialGameV24ToV25({
      data, quests, worlds: allWorlds, state: town, context: { dungeonResources: source },
    })).toEqual(town);
  });
});
