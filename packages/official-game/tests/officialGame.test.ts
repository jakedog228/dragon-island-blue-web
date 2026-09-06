import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadGameData,
  loadCollectionCatalog,
  loadDungeonData,
  loadQuestCatalog,
  loadWorldData,
  resolveDataDir,
  type WorldResourceSource,
  type CollectionGoalDefinition,
  type GameData,
} from "@dib/gamedata";
import {
  WorldTripParty,
  DungeonRuntimeController,
  GuildQuestRuntime,
  canOfferSaveMe,
  baseStat,
  generateTournamentPrize,
  emptyGuildQuestStateSnapshot,
  heroXpForLevel,
  jobXpForLevel,
  replayableRng,
  restoreBattleReplay,
  type DungeonRouteDescriptor,
  type PlayerMonsterInstance,
  type TeamMemberSetup,
} from "@dib/engine";
import {
  AuthoritativeGameService,
  InMemoryAuthoritativeSlotStore,
} from "@dib/game-service";
import { findPresentationLeaks, isMechanicalLogicPath } from "@dib/logic-pack";
import {
  GAME_PROTOCOL_VERSION,
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
  OFFICIAL_GAME_V21_SIMULATION_VERSION,
  OFFICIAL_GAME_V22_SIMULATION_VERSION,
  OfficialGameCommandResultV20Schema,
  OfficialGameCommandResultV21Schema,
  OfficialGameCommandResultV22Schema,
  OfficialGameProjectionV17Schema,
  OfficialGameProjectionV18Schema,
  OfficialGameProjectionV19Schema,
  OfficialGameProjectionV20Schema,
  OfficialGameProjectionV21Schema,
  OfficialGameProjectionV22Schema,
  SlotProjectionV1Schema,
  type GameCommandEnvelopeV1,
  type LogicPackDescriptorV1,
  type OfficialGameProjectionBodyV14,
  type OfficialGameProjectionBodyV19,
  type OfficialGameProjectionBodyV20,
  type OfficialGameProjectionBodyV21,
  type OfficialGameProjectionBodyV22,
  type SlotProjectionV1,
} from "@dib/game-protocol";
import {
  PlayerProfile,
  battingOrderSizeFor,
  minimumHeroTotalForLevel,
  sourceNewGameProfileDefaults,
} from "@dib/player-domain";
import {
  createInitialOfficialWorldState,
  createOfficialLogicPackDescriptor,
  createOfficialGameV12LogicPackDescriptor,
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
  createOfficialGameV12Support,
  deriveOfficialDungeonTerminalSurvivors,
  OfficialGameV12Aggregate,
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
  OfficialGameReducer,
  allocateOfficialContinuationIdentity,
  assertOfficialGameV12CommandAdmitted,
  cloneOfficialGameStateV12,
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
  parseOfficialGameProjectionV12,
  parseOfficialGameStateV11,
  parseOfficialGameStateV1,
  parseOfficialGameStateV12,
  parseOfficialGameStateV14,
  parseOfficialGameStateV17,
  parseOfficialGameStateV19,
  parseOfficialGameStateV20,
  parseOfficialGameStateV21,
  parseOfficialGameStateV22,
  projectOfficialGameStateV12,
  splitPendingEggReward,
  validateOfficialCollectionCatalog,
  type OfficialEggContinuation,
  type OfficialEggPrize,
  type OfficialGameProjectionBodyV12,
  type OfficialGameStateV12,
  type OfficialGameStateV14,
  type OfficialGameStateV17,
  type OfficialGameStateV18,
  type OfficialGameStateV19,
  type OfficialGameStateV20,
  type OfficialGameStateV21,
  type OfficialGameStateV22,
  type OfficialGameSupportReport,
  type OfficialGameStateV1,
  type OfficialReduceContext,
  validateOfficialGameSupport,
} from "../src/index.js";

const data = loadGameData();
const dataDirectory = resolveDataDir();
const source: WorldResourceSource = {
  has: (path) => path.endsWith(".plist")
    ? existsSync(resolve(dataDirectory, `${path.slice(0, -6)}.json`)) ||
      /-hd\.plist$/.test(path)
    : true,
  plist: (path) => JSON.parse(readFileSync(
    resolve(dataDirectory, `${path.slice(0, -6)}.json`),
    "utf8",
  )) as unknown,
};
const world = loadWorldData(
  source,
  "World_1-1",
  new Set(data.allMonsters().map((monster) => monster.shortType)),
);
const quests = loadQuestCatalog(source);
const support = validateOfficialGameSupport({ data, world, quests, startTownId: "First_City" });
const reducer = new OfficialGameReducer({
  data,
  world,
  quests,
  startTownId: "First_City",
  support,
  random: () => 0,
});
const pack: LogicPackDescriptorV1 = createOfficialLogicPackDescriptor(
  `logic-v1:${"a".repeat(64)}`,
  support,
);

const allWorlds = Object.keys(source.plist("Worlds.plist") as Record<string, unknown>)
  .sort()
  .map((name) => name === world.name
    ? world
    : loadWorldData(
        source,
        name,
        new Set(data.allMonsters().map((monster) => monster.shortType)),
      ));
const completeSupport = validateOfficialGameSupport({
  data,
  world,
  worlds: allWorlds,
  resources: source,
  quests,
  startTownId: "First_City",
});

const completeCollectionCatalog = loadCollectionCatalog(source, data);
const completeCollectionProof = validateOfficialCollectionCatalog(
  completeCollectionCatalog,
  data,
  completeSupport,
);
const completePack = createOfficialLogicPackDescriptor(
  `logic-v1:${"c".repeat(64)}`,
  completeSupport,
);
const completeV12Support = createOfficialGameV12Support({
  support: completeSupport,
  collectionCatalog: completeCollectionProof,
});
const completeV12Pack: LogicPackDescriptorV1 = createOfficialGameV12LogicPackDescriptor(
  `logic-v1:${"d".repeat(64)}`,
  completeV12Support,
);
const completeV14Pack: LogicPackDescriptorV1 = createOfficialGameV14LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV15Pack: LogicPackDescriptorV1 = createOfficialGameV15LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV16Pack: LogicPackDescriptorV1 = createOfficialGameV16LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV17Pack: LogicPackDescriptorV1 = createOfficialGameV17LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV18Pack: LogicPackDescriptorV1 = createOfficialGameV18LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV19Pack: LogicPackDescriptorV1 = createOfficialGameV19LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV20Pack: LogicPackDescriptorV1 = createOfficialGameV20LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV21Pack: LogicPackDescriptorV1 = createOfficialGameV21LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV22Pack: LogicPackDescriptorV1 = createOfficialGameV22LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeV23Pack: LogicPackDescriptorV1 = createOfficialGameV23LogicPackDescriptor(
  completeV12Pack.logicPackId,
  completeV12Support,
);
const completeReducer = new OfficialGameReducer({
  data,
  world,
  worlds: allWorlds,
  resources: source,
  quests,
  startTownId: "First_City",
  support: completeSupport,
  random: () => 0,
});

function reduce(
  state: OfficialGameStateV1 | undefined,
  command: GameCommandEnvelopeV1["command"],
) {
  return reduceWith(completeReducer, state, command);
}

function reduceWith(
  gameReducer: OfficialGameReducer,
  state: OfficialGameStateV1 | undefined,
  command: GameCommandEnvelopeV1["command"],
  pack: LogicPackDescriptorV1 = completePack,
) {
  return gameReducer.apply({
    playerId: "route-player",
    slotId: "slot-1",
    pack,
    state,
    previousRevision: state === undefined ? 0 : 1,
    now: "2026-07-29T00:00:00.000Z",
  }, command);
}

function envelope(
  commandId: string,
  expectedRevision: number,
  command: GameCommandEnvelopeV1["command"],
  expectedDecisionId?: string,
): GameCommandEnvelopeV1 {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    commandId,
    expectedRevision,
    ...(expectedDecisionId === undefined ? {} : { expectedDecisionId }),
    command,
  };
}

function service(): AuthoritativeGameService<OfficialGameStateV1> {
  return new AuthoritativeGameService({
    pack,
    store: new InMemoryAuthoritativeSlotStore(),
    reducer,
  });
}

function v12Service(random: () => number = () => 0): {
  readonly authority: AuthoritativeGameService<OfficialGameStateV12, OfficialGameProjectionBodyV12>;
  readonly store: InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>;
  readonly reducer: OfficialGameV12Reducer;
} {
  const store = new InMemoryAuthoritativeSlotStore<
    OfficialGameStateV12,
    OfficialGameProjectionBodyV12
  >();
  const legacy = new OfficialGameReducer({
    data,
    world,
    worlds: allWorlds,
    resources: source,
    quests,
    startTownId: "First_City",
    support: completeSupport,
    random,
  });
  const reducer = new OfficialGameV12Reducer(legacy, completeV12Support);
  const authority = new AuthoritativeGameService<
    OfficialGameStateV12,
    OfficialGameProjectionBodyV12
  >({
    pack: completeV12Pack,
    store,
    reducer,
    validateRecord: (record) => reducer.validatePersistedRecord(record),
  });
  return { authority, store, reducer };
}

function v12ServiceFor(
  legacy: OfficialGameReducer,
  support: ReturnType<typeof createOfficialGameV12Support>,
  pack: LogicPackDescriptorV1,
): {
  readonly authority: AuthoritativeGameService<OfficialGameStateV12, OfficialGameProjectionBodyV12>;
  readonly store: InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>;
  readonly reducer: OfficialGameV12Reducer;
} {
  const store = new InMemoryAuthoritativeSlotStore<
    OfficialGameStateV12,
    OfficialGameProjectionBodyV12
  >();
  const reducer = new OfficialGameV12Reducer(legacy, support);
  const authority = new AuthoritativeGameService<
    OfficialGameStateV12,
    OfficialGameProjectionBodyV12
  >({
    pack,
    store,
    reducer,
    validateRecord: (record) => reducer.validatePersistedRecord(record),
  });
  return { authority, store, reducer };
}

function v12Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV12Reducer {
  return new OfficialGameV12Reducer(legacy, support);
}

function v14Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV14Reducer {
  return new OfficialGameV14Reducer(
    new OfficialGameV12Reducer(legacy, support),
    completeV12Pack,
  );
}

function v15Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV15Reducer {
  return new OfficialGameV15Reducer(
    new OfficialGameV12Reducer(legacy, support),
    completeV12Pack,
  );
}

function v16Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV16Reducer {
  return new OfficialGameV16Reducer(v15Reducer(legacy, support), completeV15Pack);
}

function v17Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV17Reducer {
  return new OfficialGameV17Reducer(v16Reducer(legacy, support), completeV16Pack);
}

function v18Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV18Reducer {
  return new OfficialGameV18Reducer(v17Reducer(legacy, support), completeV17Pack);
}

function v19Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV19Reducer {
  return new OfficialGameV19Reducer(v18Reducer(legacy, support), completeV18Pack);
}

function v20Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV20Reducer {
  return new OfficialGameV20Reducer(v19Reducer(legacy, support), completeV19Pack);
}

function v21Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV21Reducer {
  return new OfficialGameV21Reducer(v20Reducer(legacy, support), completeV20Pack);
}

function v22Reducer(
  legacy: OfficialGameReducer = completeReducer,
  support: typeof completeV12Support = completeV12Support,
): OfficialGameV22Reducer {
  return new OfficialGameV22Reducer(v21Reducer(legacy, support), completeV21Pack);
}

function tournamentSaveMeV19State(): OfficialGameStateV19 {
  const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
  const arenaTown = arenaWorld.pointsOfInterest.find(({ name }) => name === "Capital_City")!;
  const party = new WorldTripParty(data, [{
    ...member("v20-tournament-save-me", "BlueBabyDragon", 1),
    currentHp: 1,
  }], 3);
  const profile = new PlayerProfile({
    ...sourceNewGameProfileDefaults("BlueBabyDragon"),
    heroLevel: 6,
    heroTotalHighestLevels: minimumHeroTotalForLevel(6),
    monsterPartyLevels: [1],
    gold: 100,
    tutorialFlags: ["SaveMe"],
  }, party);
  const initial: OfficialGameStateV1 = {
    schemaVersion: 1,
    profile: profile.stateSnapshot(),
    party: party.stateSnapshot(),
    quests: emptyGuildQuestStateSnapshot(),
    location: { kind: "town", worldId: arenaWorld.name, townId: arenaTown.name },
    world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
    nextMonsterSequence: 2,
    nextBattleSequence: 1,
  };
  const context = { dungeonResources: source } as const;
  const v12 = parseOfficialGameStateV12(data, quests, {
    ...initial,
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  }, context);
  const v13 = migrateOfficialGameV12ToV13({ data, quests, state: v12, context });
  const v14 = migrateOfficialGameV13ToV14({ data, quests, state: v13, context });
  const v15 = migrateOfficialGameV14ToV15({
    data, quests, state: v14, updatedAt: "2026-08-13T00:00:00.000Z", context,
  });
  const v16 = migrateOfficialGameV15ToV16({ data, quests, state: v15, context });
  const v17 = migrateOfficialGameV16ToV17({ data, quests, state: v16, context });
  const v18 = migrateOfficialGameV17ToV18({ data, quests, state: v17, context });
  return migrateOfficialGameV18ToV19({ data, quests, state: v18, context });
}

function customCollectionV12Fixture(
  collection: unknown,
  random: () => number = () => 0,
  packHex = "a",
): {
  readonly resources: WorldResourceSource;
  readonly support: ReturnType<typeof createOfficialGameV12Support>;
  readonly pack: LogicPackDescriptorV1;
  readonly reducer: OfficialGameV12Reducer;
  readonly legacy: OfficialGameReducer;
} {
  const resources: WorldResourceSource = {
    ...source,
    plist: (path) => path === "Collection.plist" ? collection : source.plist(path),
  };
  const customSupport = validateOfficialGameSupport({
    data,
    world,
    worlds: allWorlds,
    resources,
    quests,
    startTownId: "First_City",
  });
  const proof = validateOfficialCollectionCatalog(
    loadCollectionCatalog(resources, data),
    data,
    customSupport,
  );
  const support = createOfficialGameV12Support({
    support: customSupport,
    collectionCatalog: proof,
  });
  const legacy = new OfficialGameReducer({
    data,
    world,
    worlds: allWorlds,
    resources,
    quests,
    startTownId: "First_City",
    support: customSupport,
    random,
  });
  return {
    resources,
    support,
    pack: createOfficialGameV12LogicPackDescriptor(`logic-v1:${packHex.repeat(64)}`, support),
    reducer: new OfficialGameV12Reducer(legacy, support),
    legacy,
  };
}

function collectionGoalResource(
  key: string,
  monsters: readonly string[],
  treasureData: Record<string, unknown> = { items: [] },
): Record<string, unknown> {
  return {
    Base: [{ key, monsters: [...monsters], treasureData }],
  };
}

function serviceDecisionId(
  record: Awaited<ReturnType<InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>["read"]>>,
): string {
  if (record === undefined || !("decisionId" in record.projection.decision)) {
    throw new Error("service fixture has no authoritative decision");
  }
  return record.projection.decision.decisionId;
}

function serviceEggAwaitingPrize(prize: OfficialEggPrize): OfficialEggContinuation {
  return {
    schemaVersion: 1,
    continuationId: "continuation-service-egg",
    decisionId: "decision-service-egg",
    kind: "gold",
    origin: "quest",
    remainingRepeats: 1,
    phase: "awaiting-prize-resolution",
    providers: [prize],
    reel: [prize],
    previewMonsterShortTypes: prize.kind === "monster" ? [prize.shortType] : [],
    finalReelState: {
      elapsedSeconds: 1.5,
      index: 0,
      speed: 0,
      friction: 0,
      centerIndex: 0,
      stopped: true,
    },
    landedPrize: prize,
  };
}

function serviceEggAwaitingSpin(): OfficialEggContinuation {
  return {
    schemaVersion: 1,
    continuationId: "continuation-service-egg",
    decisionId: "decision-service-egg",
    kind: "gold",
    origin: "quest",
    remainingRepeats: 1,
    phase: "awaiting-spin",
  };
}

function serviceEggAwaitingRepeat(prize: OfficialEggPrize): OfficialEggContinuation {
  return {
    schemaVersion: 1,
    continuationId: "continuation-service-egg",
    decisionId: "decision-service-egg",
    kind: "gold",
    origin: "quest",
    remainingRepeats: 1,
    phase: "awaiting-repeat-or-finish",
    settledPrize: prize,
    resolution: { kind: "keep" },
  };
}

/**
 * These are strict union branch fixtures for continuation settlement tests, not claims that the
 * engine RNG emitted one representative of every kind. Every identity is independently tied to
 * the loaded catalog; provider selection remains an engine concern and is not exposed by proof.
 */
function closedUnionSettlementPrize(
  label: string,
  predicate: (prize: OfficialEggPrize) => boolean,
): OfficialEggPrize {
  const recipeName = data.allCombineRecipes().at(-1)?.resultShortType;
  const spiritName = data.allMonsters()
    .filter(({ category }) => category === "Summon")
    .at(-1)?.shortType;
  if (recipeName === undefined || spiritName === undefined) {
    throw new Error("loaded operator fixture lacks a recipe or Summon branch");
  }
  const candidates: readonly OfficialEggPrize[] = [
    { kind: "gold", amount: 50 },
    { kind: "gold", amount: 150 },
    { kind: "silver", amount: 500 },
    { kind: "silver", amount: 1_500 },
    { kind: "gem", level: 150, quality: 1, slot: 0, enabledStats: ["Attack", "Defense"] },
    { kind: "item", definitionPath: "Usables.CardSilver", level: 2 },
    { kind: "item", definitionPath: "Usables.CardGold", level: 3 },
    { kind: "recipe", combineName: recipeName },
    { kind: "spiritTotem", shortType: spiritName },
    { kind: "monster", shortType: "BlueBabyDragon", level: 1, prizeMonster: true },
  ];
  const prize = candidates.find(predicate);
  if (prize === undefined) throw new Error(`closed-union fixture has no ${label} branch`);
  return structuredClone(prize);
}

function closedUnionMonsterPrize(label: string): Extract<OfficialEggPrize, { readonly kind: "monster" }> {
  return closedUnionSettlementPrize(label, (prize) =>
    prize.kind === "monster" && prize.prizeMonster,
  ) as Extract<OfficialEggPrize, { readonly kind: "monster" }>;
}

const protocolGoldPrize = closedUnionSettlementPrize(
  "protocol gold",
  (prize): prize is Extract<OfficialEggPrize, { kind: "gold" }> =>
    prize.kind === "gold" && prize.amount === 50,
);

async function seedServiceV12PendingEgg(
  authority: AuthoritativeGameService<OfficialGameStateV12, OfficialGameProjectionBodyV12>,
  store: InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>,
  reducer: OfficialGameV12Reducer,
  prize: OfficialEggPrize,
  baseState?: OfficialGameStateV12,
  pendingEgg: OfficialEggContinuation = serviceEggAwaitingPrize(prize),
): Promise<void> {
  // This helper intentionally installs an in-progress continuation through strict v12
  // parse/restore. It proves continuation settlement/restart at the service boundary; it is not
  // corpus coverage and does not claim that a route bootstrap selected this prize.
  await authority.execute("service-player", "slot-1", envelope(
    "service-create-0001",
    0,
    { type: "slot.create", starterElement: "Water" },
  ));
  await store.transact("service-player", "slot-1", async (current) => {
    if (current === undefined) throw new Error("service fixture was not created");
    const nextState = parseOfficialGameStateV12(data, quests, {
      ...(baseState ?? current.state),
      pendingEgg,
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    const projectionBody = reducer.projectPersistedState(nextState);
    const projection = { ...current.projection, ...projectionBody };
    reducer.validatePersistedRecord({ state: nextState, projection });
    return {
      record: Object.freeze({ ...current, state: nextState, projection }),
      value: undefined,
    };
  });
}

function member(
  instanceId: string,
  shortType: string,
  level = 1,
  injury?: { injureTime: number; healTime: number },
): PlayerMonsterInstance {
  return {
    instanceId,
    shortType,
    level,
    cumulativeXp: jobXpForLevel(level, data.jobXpPenalty(shortType)),
    currentHp: baseStat(data.monsterByShortType(shortType), "MaxHP", level),
    ...injury,
  };
}

function partyState(): OfficialGameStateV1 {
  const recipe = data.allCombineRecipes()[0]!;
  const party = new WorldTripParty(data, [
    member("ingredient-1", recipe.ingredients[0]),
    member("ingredient-2", recipe.ingredients[1]),
    member("keeper", "BlueBabyDragon", 1, { injureTime: 100, healTime: 200 }),
  ], 2);
  const profile = new PlayerProfile({
    ...sourceNewGameProfileDefaults("BlueBabyDragon"),
    monsterPartyLevels: [1, 1, 1],
    learnedCombineRecipes: [recipe.resultShortType],
  }, party);
  return {
    schemaVersion: 1,
    profile: profile.stateSnapshot(),
    party: party.stateSnapshot(),
    quests: emptyGuildQuestStateSnapshot(),
    location: {
      kind: "town",
      worldId: world.name,
      townId: "First_City",
    },
    world: createInitialOfficialWorldState(world, "First_City"),
    nextMonsterSequence: 4,
    nextBattleSequence: 1,
  };
}

function partyStateV12Core(): Omit<OfficialGameStateV1, "pendingEgg"> {
  const { pendingEgg: _pendingEgg, ...core } = partyState();
  return core;
}

function firstDungeonEntrance(dungeonFile = "Dungeon_1.plist"): {
  readonly world: (typeof allWorlds)[number];
  readonly poi: (typeof allWorlds)[number]["pointsOfInterest"][number];
} {
  const entrance = allWorlds.flatMap((candidate) =>
    candidate.pointsOfInterest.map((poi) => ({ world: candidate, poi })))
    .find(({ poi }) => poi.zoneChange?.kind === "dungeon" &&
      poi.zoneChange.dungeonFile === dungeonFile);
  if (entrance === undefined) throw new Error("fixture has no dungeon entrance");
  return entrance;
}

interface OfficialDungeonFixtureAuthority {
  readonly resources: WorldResourceSource;
  readonly reducer: OfficialGameReducer;
  readonly pack: LogicPackDescriptorV1;
  readonly support?: OfficialGameSupportReport;
  readonly questKey?: string;
  readonly setInvalidTreasureReward?: (kind: "recipe" | "spiritTotem" | "monsterJoin") => void;
}

function officialDungeonBattleFixture(
  level = 100,
  encounterKind: "ordinary" | "fixed" | undefined = undefined,
  authority: OfficialDungeonFixtureAuthority = {
    resources: source,
    reducer: completeReducer,
    pack: completePack,
  },
  options: {
    readonly dungeonFile?: string;
    readonly dungeonRoute?: DungeonRouteDescriptor;
    readonly shortTypes?: readonly string[];
    readonly injuredLeader?: boolean;
    readonly injuredBench?: boolean;
    readonly fragileParty?: boolean;
    readonly soloParty?: boolean;
    readonly soulStoneMember?: string;
  } = {},
): {
  readonly ready: OfficialGameStateV1;
  readonly started: ReturnType<typeof reduce>;
  readonly entrance: ReturnType<typeof firstDungeonEntrance>;
  readonly encounterRoomId: string;
  readonly clearDungeonQuestName: string;
  readonly initialFloorSurvivorCount: number;
} {
  const entrance = firstDungeonEntrance(options.dungeonFile);
  const created = reduceWith(
    authority.reducer,
    undefined,
    { type: "slot.create", starterElement: "Water" },
    authority.pack,
  );
  const shortTypeAt = (index: number): string => options.shortTypes?.[index] ?? "BlueBabyDragon";
  const strongMembers: PlayerMonsterInstance[] = [
    member("dungeon-1", shortTypeAt(0), level),
    member("dungeon-2", shortTypeAt(1), level),
    member("dungeon-3", shortTypeAt(2), level),
  ];
  if (options.injuredLeader === true) {
    const leader = strongMembers[0]!;
    strongMembers[0] = {
      ...leader,
      currentHp: Math.max(1, Math.floor(baseStat(
        data.monsterByShortType(leader.shortType),
        "MaxHP",
        level,
      ) / 2)),
      injureTime: 2_000_000_000,
      healTime: 2_000_000_100,
    };
  }
  if (options.injuredBench === true) {
    const injured = member("dungeon-injured", shortTypeAt(3), level);
    strongMembers.push({
      ...injured,
      currentHp: Math.max(1, injured.currentHp - 1),
      injureTime: 2_000_000_000,
      healTime: 2_000_000_100,
    });
  }
  if (options.fragileParty === true) {
    for (const [index, strongMember] of strongMembers.entries()) {
      strongMembers[index] = { ...strongMember, currentHp: 1 };
    }
  }
  if (options.soloParty === true) strongMembers.splice(1);
  if (options.soulStoneMember !== undefined) {
    const index = strongMembers.findIndex(({ instanceId }) => instanceId === options.soulStoneMember);
    if (index < 0) throw new Error(`fixture has no Soul Stone member ${options.soulStoneMember}`);
    strongMembers[index] = {
      ...strongMembers[index]!,
      soulStone: { element: "Life", level: 3, sourceType: "FireCub" },
    };
  }
  const strongParty = new WorldTripParty(data, strongMembers, 6);
  const strongProfile = new PlayerProfile({
    ...sourceNewGameProfileDefaults("BlueBabyDragon"),
    monsterPartyLevels: strongMembers.map(({ level: memberLevel }) => memberLevel),
  }, strongParty);
  const outside: OfficialGameStateV1 = {
    ...created.state,
    profile: strongProfile.stateSnapshot(),
    party: strongParty.stateSnapshot(),
    location: { kind: "world", worldId: entrance.world.name, poiId: entrance.poi.name },
    world: {
      ...created.state.world!,
      worldId: entrance.world.name,
      currentPoiId: entrance.poi.name,
    },
  };
  const entered = reduceWith(
    authority.reducer,
    outside,
    { type: "world.activateZone", zoneId: entrance.poi.name },
    authority.pack,
  );
  if (entered.state.dungeon === undefined || entered.state.location.kind === "battle") {
    throw new Error("fixture entered a dungeon battle before the selected test room");
  }
  const enteredParty = WorldTripParty.fromStateSnapshot(data, entered.state.party);
  const enteredProfile = PlayerProfile.fromStateSnapshot(
    entered.state.profile,
    enteredParty.monsters().map(({ level }) => level),
    enteredParty,
  );
  const questStateForGeneration = authority.questKey === undefined
    ? entered.state.quests
    : {
        ...entered.state.quests,
        activeQuestNames: ["BeatRigel"],
        progressByQuestName: {},
      };
  const enteredQuests = new GuildQuestRuntime(quests, questStateForGeneration);
  const dungeonContext: Parameters<typeof DungeonRuntimeController.restore>[0] = {
    resources: authority.resources,
    monsterTypes: data.allMonsters().map(({ shortType }) => shortType),
    legacyDungeonGenerationSemantics: true,
    isCompletionSet: (key) => enteredQuests.hasCompletedFixedEncounter(key),
    isQuestUsable: (key) => enteredQuests.canUseQuestKey(key),
    isMonsterRegistered: (type) => enteredProfile.highestRegisteredLevel(type) > 0,
    isCatchQuestDone: (instanceName) => enteredProfile.hasCompletedCatchQuest(instanceName),
    runSeed: 0,
  };
  const run = options.dungeonRoute === undefined
    ? DungeonRuntimeController.restore(dungeonContext, entered.state.dungeon.run)
    : DungeonRuntimeController.enter(dungeonContext, options.dungeonRoute);
  // A live DungeonNode enters the positioned start room before accepting navigation. Keep the
  // fixture on that lifecycle too: otherwise the first move records an unexplored previous room,
  // producing a snapshot the authority correctly rejects before it can test the requested battle.
  run.session.enterCurrentRoom();
  const moveToRoom = (targetRoomId: string, preserveEncounterId?: string): void => {
    const currentRoomId = run.session.currentRoom.id;
    const priorByRoom = new Map<string, string | undefined>([[currentRoomId, undefined]]);
    const queue = [currentRoomId];
    while (queue.length > 0 && !priorByRoom.has(targetRoomId)) {
      const roomId = queue.shift()!;
      const room = run.session.state.rooms.find((candidate) => candidate.id === roomId)!;
      for (const link of room.links) {
        if (priorByRoom.has(link.targetRoomId)) continue;
        priorByRoom.set(link.targetRoomId, roomId);
        queue.push(link.targetRoomId);
      }
    }
    if (!priorByRoom.has(targetRoomId)) throw new Error("fixture dungeon target is unreachable");
    const path: string[] = [];
    for (let roomId = targetRoomId; roomId !== currentRoomId;) {
      path.push(roomId);
      const previous = priorByRoom.get(roomId);
      if (previous === undefined) throw new Error("fixture dungeon path lost its source");
      roomId = previous;
    }
    for (const roomId of path.reverse()) {
      const movement = run.session.moveToRoom(roomId);
      for (const action of movement.actions) {
        if (action.kind === "encounter" && action.encounter.id !== preserveEncounterId) {
          run.resolveEncounter(action.encounter, "victory");
        }
      }
    }
  };
  if (encounterKind === "fixed") {
    while (run.route.floor < 3) {
      const stairRoom = run.session.state.rooms.find((room) =>
        room.zones.some(({ change }) => change.kind === "stairsDown"));
      if (stairRoom === undefined) throw new Error("fixture has no dungeon stair-down room");
      moveToRoom(stairRoom.id);
      const stairZone = run.session.currentRoom.zones.find(({ change }) => change.kind === "stairsDown");
      if (stairZone === undefined) throw new Error("fixture has no active stair-down zone");
      run.activateZone(stairZone.id);
    }
  }
  const currentRoomId = run.session.currentRoom.id;
  const minimumMonsters = encounterKind === "fixed" ? 1 : 3;
  const target = run.session.state.rooms.find((room) =>
    room.id !== currentRoomId &&
    (encounterKind === undefined || room.encounter?.kind === encounterKind) &&
    (room.encounter?.monsters.length ?? 0) >= minimumMonsters);
  if (target?.encounter === undefined) {
    throw new Error("fixture has no multi-member dungeon encounter");
  }
  moveToRoom(target.id, target.encounter.id);
  const clearQuest = quests.definitions.find((candidate) =>
    candidate.className === "ClearDungeonQuest" &&
    candidate.type === run.definition.instanceName &&
    run.route.floor >= candidate.startFloor &&
    run.route.floor <= candidate.endFloor,
  );
  const questState = clearQuest === undefined
    ? questStateForGeneration
    : new GuildQuestRuntime(quests, {
        ...questStateForGeneration,
        activeQuestNames: [...new Set([
          ...questStateForGeneration.activeQuestNames,
          clearQuest.name,
        ])],
        progressByQuestName: {},
      }).stateSnapshot();
  const ready: OfficialGameStateV1 = {
    ...entered.state,
    quests: questState,
    location: {
      kind: "dungeon",
      dungeonId: run.session.snapshot().definitionId,
      floor: run.route.floor,
      roomId: run.session.currentRoom.id,
    },
    dungeon: {
      ...entered.state.dungeon,
      run: run.snapshot(),
    },
  };
  const started = reduceWith(
    authority.reducer,
    ready,
    { type: "dungeon.selectRoom", roomId: target.id },
    authority.pack,
  );
  if (started.state.battle?.encounter.kind !== "dungeon") {
    throw new Error("fixture did not start the selected dungeon battle");
  }
  return {
    ready,
    started,
    entrance,
    encounterRoomId: target.id,
    clearDungeonQuestName: clearQuest?.name ?? "",
    initialFloorSurvivorCount: run.session.survivingMonsterCountsByRoom().reduce(
      (total, count) => total + count,
      0,
    ),
  };
}

function legacySyntheticDungeonState(
  state: OfficialGameStateV1,
  keepBattle = false,
): OfficialGameStateV1 {
  if (state.dungeon === undefined) throw new Error("fixture has no dungeon state");
  const stripFloor = (session: typeof state.dungeon.run.current.session) => {
    const {
      previousRoomId: _previousRoomId,
      encounterRosters: _encounterRosters,
      generationGateDecisions: _generationGateDecisions,
      ...withoutNativeFields
    } = session;
    return {
      ...withoutNativeFields,
      currentRoomId: "room-0",
      exploredRoomIds: ["room-0"],
      clearedEncounterIds: [],
      collectedTreasureIds: [],
    };
  };
  const legacyCurrent = {
    ...state.dungeon.run.current,
    session: stripFloor(state.dungeon.run.current.session),
  };
  const legacyRun = {
    ...state.dungeon.run,
    current: legacyCurrent,
    cachedFloors: state.dungeon.run.cachedFloors.map((entry) =>
      entry.route.floor === legacyCurrent.route.floor
        ? legacyCurrent
        : { ...entry, session: stripFloor(entry.session) }),
  };
  const base = keepBattle
    ? state
    : (({ battle: _battle, ...withoutBattle }) => withoutBattle)(state);
  return {
    ...base,
    location: keepBattle
      ? state.location
      : {
          kind: "dungeon",
          worldId: state.dungeon.worldId,
          poiId: state.dungeon.entrancePoiId,
          dungeonId: legacyCurrent.session.definitionId,
          floor: legacyCurrent.route.floor,
          roomId: legacyCurrent.session.currentRoomId,
        },
    dungeon: { ...state.dungeon, run: legacyRun },
  } as OfficialGameStateV1;
}

function reduceOneDungeonEnemyAndRetreat(
  fixture: ReturnType<typeof officialDungeonBattleFixture>,
  gameReducer: OfficialGameReducer = completeReducer,
): ReturnType<typeof reduce> {
  let current = fixture.started;
  const startedBattle = current.state.battle;
  if (startedBattle?.encounter.kind !== "dungeon") throw new Error("fixture is not a dungeon battle");
  const initialCount = startedBattle.encounter.encounter.monsters.length;
  for (let turn = 0; turn < 20; turn += 1) {
    if (current.state.location.kind !== "battle" || current.state.battle === undefined) {
      throw new Error("fixture battle ended before retreat could be submitted");
    }
    const restored = restoreBattleReplay(data, current.state.battle.replay);
    const survivors = deriveOfficialDungeonTerminalSurvivors(
      current.state.battle.encounter.kind === "dungeon"
        ? current.state.battle.encounter.encounter
        : (() => { throw new Error("fixture is not a dungeon battle"); })(),
      current.state.battle.replay.teams[1],
      restored,
    );
    if (survivors.length < initialCount) {
      const decision = current.projection.decision;
      if (decision.type !== "battle.playerTurn") throw new Error("fixture has no retreat decision");
      return reduceWith(gameReducer, current.state, {
        type: "battle.retreat",
        battleId: decision.battleId,
        actorId: decision.actorId,
      });
    }
    const decision = current.projection.decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no player decision");
    const choice = decision.choices.find((candidate) =>
      candidate.blockedReasonId === undefined &&
      candidate.target.kind === "enemies" &&
      candidate.target.count === 1,
    );
    if (choice === undefined) throw new Error("fixture has no single-enemy ability");
    current = reduceWith(gameReducer, current.state, {
      type: "battle.chooseAbility",
      battleId: decision.battleId,
      actorId: decision.actorId,
      slot: choice.slot,
      targetIds: [decision.enemyTargetIds[0]!],
    });
  }
  throw new Error("fixture did not reduce an enemy roster before retreat");
}

function chooseOneDungeonAbility(
  current: ReturnType<typeof reduce>,
  gameReducer: OfficialGameReducer = completeReducer,
  pack: LogicPackDescriptorV1 = completePack,
): ReturnType<typeof reduce> {
  if (current.state.location.kind !== "battle" || current.state.battle === undefined) {
    throw new Error("fixture has no active battle ability");
  }
  const decision = current.projection.decision;
  if (decision.type !== "battle.playerTurn") throw new Error("fixture has no player decision");
  const choice = decision.choices.find(({ blockedReasonId }) => blockedReasonId === undefined);
  if (choice === undefined) throw new Error("fixture has no usable ability");
  const targetIds = choice.target.kind === "self"
    ? [decision.actorId]
    : choice.target.kind === "allEnemies"
      ? [...decision.enemyTargetIds]
      : choice.target.kind === "allFriends"
        ? [...decision.friendlyTargetIds]
        : choice.target.kind === "enemies"
          ? decision.enemyTargetIds.slice(0, choice.target.count)
          : choice.target.kind === "friends"
            ? decision.friendlyTargetIds.slice(0, choice.target.count)
            : [
                ...(choice.target.allEnemies
                  ? decision.enemyTargetIds
                  : decision.enemyTargetIds.slice(0, choice.target.enemyCount)),
                ...(choice.target.allFriends
                  ? decision.friendlyTargetIds
                  : decision.friendlyTargetIds.slice(0, choice.target.friendlyCount)),
              ];
  return reduceWith(gameReducer, current.state, {
    type: "battle.chooseAbility",
    battleId: decision.battleId,
    actorId: decision.actorId,
    slot: choice.slot,
    targetIds,
  }, pack);
}

function finishDungeonVictory(
  fixture: ReturnType<typeof officialDungeonBattleFixture>,
  gameReducer: OfficialGameReducer = completeReducer,
): ReturnType<typeof reduce> {
  return finishBattleVictory(fixture.started, gameReducer);
}

function finishBattleVictory(
  started: ReturnType<typeof reduce>,
  gameReducer: OfficialGameReducer = completeReducer,
  pack: LogicPackDescriptorV1 = completePack,
): ReturnType<typeof reduce> {
  let current = started;
  for (let turn = 0; turn < 200 && current.state.location.kind === "battle"; turn += 1) {
    current = chooseOneDungeonAbility(current, gameReducer, pack);
  }
  if (current.state.location.kind === "battle") throw new Error("fixture did not reach dungeon victory");
  return current;
}

function finishVersionedDungeonBattleVictory(
  authority: OfficialDungeonFixtureAuthority,
  fixture: ReturnType<typeof officialDungeonBattleFixture>,
  packHex = "e",
  version: "v15" | "v16" = "v16",
) {
  if (authority.support === undefined) throw new Error("battle fixture has no loaded support");
  const support = createOfficialGameV12Support({ support: authority.support });
  const pack = createOfficialGameV12LogicPackDescriptor(
    `logic-v1:${packHex.repeat(64).slice(0, 64)}`,
    support,
  );
  const reducer = new OfficialGameV12Reducer(authority.reducer, support);
  const initial = parseOfficialGameStateV12(data, quests, {
    ...fixture.started.state,
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  }, { dungeonResources: authority.resources });
  let current = { state: initial, projection: reducer.projectPersistedState(initial) };
  let events: ReturnType<OfficialGameV12Reducer["applyForV16"]>["events"] = [];
  for (let turn = 0; turn < 200 && current.state.location.kind === "battle"; turn += 1) {
    const decision = current.projection.decision;
    if (decision.type !== "battle.playerTurn") {
      throw new Error("fixture has no v16 battle player decision");
    }
    const choice = decision.choices.find(({ blockedReasonId }) => blockedReasonId === undefined);
    if (choice === undefined) throw new Error("fixture has no v16 usable battle ability");
    const targetIds = choice.target.kind === "self"
      ? [decision.actorId]
      : choice.target.kind === "allEnemies"
        ? [...decision.enemyTargetIds]
        : choice.target.kind === "allFriends"
          ? [...decision.friendlyTargetIds]
          : choice.target.kind === "enemies"
            ? decision.enemyTargetIds.slice(0, choice.target.count)
            : choice.target.kind === "friends"
              ? decision.friendlyTargetIds.slice(0, choice.target.count)
              : [
                  ...(choice.target.allEnemies
                    ? decision.enemyTargetIds
                    : decision.enemyTargetIds.slice(0, choice.target.enemyCount)),
                  ...(choice.target.allFriends
                    ? decision.friendlyTargetIds
                    : decision.friendlyTargetIds.slice(0, choice.target.friendlyCount)),
                ];
    const reduceBattle = version === "v16"
      ? reducer.applyForV16.bind(reducer)
      : reducer.applyForV15.bind(reducer);
    const reduced = reduceBattle({
      playerId: "dungeon-v16-route-player",
      slotId: "slot-1",
      pack,
      state: current.state,
      previousRevision: turn + 1,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.chooseAbility",
      battleId: decision.battleId,
      actorId: decision.actorId,
      slot: choice.slot,
      targetIds,
    });
    events = reduced.events;
    current = { state: reduced.state, projection: reduced.projection };
  }
  if (current.state.location.kind === "battle") {
    throw new Error("fixture did not reach v16 battle victory");
  }
  return { ...current, events, reducer, pack };
}

function applyV16DungeonCommand(
  fixture: ReturnType<typeof finishVersionedDungeonBattleVictory>,
  command: GameCommandEnvelopeV1["command"],
) {
  return fixture.reducer.applyForV16({
    playerId: "dungeon-v16-route-player",
    slotId: "slot-1",
    pack: fixture.pack,
    state: fixture.state,
    previousRevision: 201,
    now: "2026-07-29T00:00:00.000Z",
  }, command);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Minimal operator-content fixture: the shipped Dungeon_1 corpus has no Egg on these routes. */
function minimalOperatorEggContentAuthority(options: {
  readonly battleRewardKey?: string;
  readonly questKey?: string;
  readonly eggReward?: "egg" | "monsterEgg";
  readonly twoEggReward?: boolean;
  readonly treasureReward?: "egg" | "monsterEgg";
  readonly catchTwoEggReward?: boolean;
  readonly random?: () => number;
}): OfficialDungeonFixtureAuthority {
  let invalidTreasureReward: "recipe" | "spiritTotem" | "monsterJoin" | undefined;
  const resources: WorldResourceSource = {
    ...source,
    plist: (path) => {
      const value = structuredClone(source.plist(path));
      if (path !== "Dungeon_1.plist") return value;
      let foundConanBattle = false;
      const visit = (entry: unknown): void => {
        if (Array.isArray(entry)) {
          for (const child of entry) visit(child);
          return;
        }
        if (!isRecord(entry)) return;
        const record = entry;
        if ((options.treasureReward !== undefined || options.twoEggReward === true) &&
            record.class === "DefaultTreasurePopulator") {
          const argumentsValue = record.arguments;
          if (isRecord(argumentsValue)) {
            argumentsValue.treasureData = {
              items: options.twoEggReward === true
                ? [
                    { chance: 1, data: { type: "DestroyOnPickup.Egg" }, spawnType: "fixed" },
                    { chance: 1, data: { type: "DestroyOnPickup.MonsterEgg" }, spawnType: "fixed" },
                  ]
                : [{
                    chance: 1,
                    data: { type: options.treasureReward === "egg"
                      ? "DestroyOnPickup.Egg"
                      : "DestroyOnPickup.MonsterEgg" },
                    spawnType: "fixed",
                  }],
            };
          }
        }
        if (invalidTreasureReward !== undefined && record.class === "DefaultTreasurePopulator") {
          const argumentsValue = record.arguments;
          if (isRecord(argumentsValue)) {
            const invalidData = invalidTreasureReward === "recipe"
              ? { type: "DestroyOnPickup.Recipe", arguments: { combineName: "NotLoadedRecipe" } }
              : invalidTreasureReward === "spiritTotem"
                ? { type: "DestroyOnPickup.SpiritTotem", arguments: { shortType: "NotLoadedSummon" } }
                : { type: "DestroyOnPickup.MonsterJoin", arguments: { shortType: "NotLoadedMonster", jobLevel: 1 } };
            argumentsValue.treasureData = {
              items: [
                { chance: 1, data: invalidData, spawnType: "fixed" },
                { chance: 1, data: { type: "DestroyOnPickup.Egg" }, spawnType: "fixed" },
              ],
            };
          }
        }
        if (record.uniqueKey === "ConanBattle") {
          foundConanBattle = true;
          if (options.battleRewardKey === undefined) delete record.battleRewardKey;
          else record.battleRewardKey = options.battleRewardKey;
          if (options.questKey === undefined) delete record.questKey;
          else record.questKey = options.questKey;
          if (options.twoEggReward === true) {
            record.treasureData = {
              items: [
                { chance: 1, data: { type: "DestroyOnPickup.Egg" }, spawnType: "fixed" },
                { chance: 1, data: { type: "DestroyOnPickup.MonsterEgg" }, spawnType: "fixed" },
              ],
            };
          } else if (options.eggReward !== undefined) {
            record.treasureData = {
              items: [
                { chance: 1, spawnType: "silver" },
                {
                  chance: 1,
                  data: { type: options.eggReward === "egg"
                    ? "DestroyOnPickup.Egg"
                    : "DestroyOnPickup.MonsterEgg" },
                  spawnType: "fixed",
                },
              ],
            };
          }
        }
        if (options.catchTwoEggReward === true && isRecord(record.catchQuestData)) {
          record.catchQuestData.treasureData = {
            items: [
              { chance: 1, data: { type: "DestroyOnPickup.Egg" }, spawnType: "fixed" },
              { chance: 1, data: { type: "DestroyOnPickup.MonsterEgg" }, spawnType: "fixed" },
            ],
          };
        }
        for (const child of Object.values(record)) visit(child);
      };
      visit(value);
      if (!foundConanBattle) {
        throw new Error("authored ConanBattle encounter was not found in Dungeon_1.plist");
      }
      return value;
    },
  };
  const support = validateOfficialGameSupport({
    data,
    world,
    worlds: allWorlds,
    resources,
    quests,
    startTownId: "First_City",
  });
  const pack = createOfficialLogicPackDescriptor(`logic-v1:${"r".repeat(64)}`, support);
  return {
    resources,
    pack,
    support,
    reducer: new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources,
      quests,
      startTownId: "First_City",
      support,
      random: options.random ?? (() => 0),
    }),
    ...(options.questKey === undefined ? {} : { questKey: options.questKey }),
    setInvalidTreasureReward: (kind) => { invalidTreasureReward = kind; },
  };
}

function dungeonTreasureV12Fixture(
  authority: OfficialDungeonFixtureAuthority,
  packHex = "e",
): {
  readonly authority: OfficialDungeonFixtureAuthority & { readonly support: OfficialGameSupportReport };
  readonly support: ReturnType<typeof createOfficialGameV12Support>;
  readonly pack: LogicPackDescriptorV1;
  readonly reducer: OfficialGameV12Reducer;
  readonly state: OfficialGameStateV12;
  readonly treasureId: string;
} {
  const entrance = firstDungeonEntrance();
  const created = reduceWith(
    authority.reducer,
    undefined,
    { type: "slot.create", starterElement: "Water" },
    authority.pack,
  );
  const outside: OfficialGameStateV1 = {
    ...created.state,
    location: { kind: "world", worldId: entrance.world.name, poiId: entrance.poi.name },
    world: {
      ...created.state.world!,
      worldId: entrance.world.name,
      currentPoiId: entrance.poi.name,
    },
  };
  const entered = reduceWith(
    authority.reducer,
    outside,
    { type: "world.activateZone", zoneId: entrance.poi.name },
    authority.pack,
  );
  if (entered.state.dungeon === undefined) throw new Error("fixture did not enter a dungeon");
  const enteredParty = WorldTripParty.fromStateSnapshot(data, entered.state.party);
  const enteredProfile = PlayerProfile.fromStateSnapshot(
    entered.state.profile,
    enteredParty.monsters().map(({ level }) => level),
    enteredParty,
  );
  const enteredQuests = new GuildQuestRuntime(quests, entered.state.quests);
  const run = DungeonRuntimeController.restore({
    resources: authority.resources,
    monsterTypes: data.allMonsters().map(({ shortType }) => shortType),
    legacyDungeonGenerationSemantics: true,
    isCompletionSet: (key) => enteredQuests.hasCompletedFixedEncounter(key),
    isQuestUsable: (key) => enteredQuests.canUseQuestKey(key),
    isMonsterRegistered: (type) => enteredProfile.highestRegisteredLevel(type) > 0,
    isCatchQuestDone: (instanceName) => enteredProfile.hasCompletedCatchQuest(instanceName),
  }, entered.state.dungeon.run);
  const target = run.session.state.rooms.find((room) =>
    room.encounter?.treasure !== undefined || room.treasure !== undefined);
  if (target === undefined) throw new Error("fixture has no dungeon treasure");
  const previous = new Map<string, string | undefined>([[run.session.currentRoom.id, undefined]]);
  const queue = [run.session.currentRoom.id];
  while (queue.length > 0 && !previous.has(target.id)) {
    const roomId = queue.shift()!;
    const room = run.session.state.rooms.find(({ id }) => id === roomId)!;
    for (const link of room.links) {
      if (previous.has(link.targetRoomId)) continue;
      previous.set(link.targetRoomId, roomId);
      queue.push(link.targetRoomId);
    }
  }
  const path: string[] = [];
  for (let roomId = target.id; roomId !== run.session.currentRoom.id;) {
    path.push(roomId);
    const priorRoomId = previous.get(roomId);
    if (priorRoomId === undefined) throw new Error("fixture dungeon treasure path is unreachable");
    roomId = priorRoomId;
  }
  for (const roomId of path.reverse()) {
    const movement = run.session.moveToRoom(roomId);
    for (const action of movement.actions) {
      if (action.kind === "encounter") run.resolveEncounter(action.encounter, "victory");
    }
  }
  const treasure = run.session.currentRoom.encounter?.treasure ?? run.session.currentRoom.treasure;
  if (treasure === undefined) throw new Error("fixture did not reveal dungeon treasure");
  const ready: OfficialGameStateV1 = {
    ...entered.state,
    location: {
      kind: "dungeon",
      dungeonId: run.session.snapshot().definitionId,
      floor: run.route.floor,
      roomId: run.session.currentRoom.id,
    },
    dungeon: { ...entered.state.dungeon, run: run.snapshot() },
  };
  if (authority.support === undefined) throw new Error("treasure fixture has no loaded support");
  const support = createOfficialGameV12Support({ support: authority.support });
  const reducer = new OfficialGameV12Reducer(authority.reducer, support);
  return {
    authority: authority as OfficialDungeonFixtureAuthority & { readonly support: OfficialGameSupportReport },
    support,
    pack: createOfficialGameV12LogicPackDescriptor(`logic-v1:${packHex.repeat(64)}`, support),
    reducer,
    state: parseOfficialGameStateV12(data, quests, {
      ...ready,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: authority.resources }),
    treasureId: treasure.id,
  };
}

function finishDungeonDefeat(
  fixture: ReturnType<typeof officialDungeonBattleFixture>,
  gameReducer: OfficialGameReducer = completeReducer,
): ReturnType<typeof reduce> {
  let current = fixture.started;
  for (let turn = 0; turn < 500 && current.state.location.kind === "battle"; turn += 1) {
    const decision = current.projection.decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no defeat player decision");
    current = reduceWith(gameReducer, current.state, {
      type: "battle.delay",
      battleId: decision.battleId,
      actorId: decision.actorId,
    });
  }
  if (current.state.location.kind === "battle") throw new Error("fixture did not reach dungeon defeat");
  return current;
}

function finishV12DungeonDefeat(
  fixture: ReturnType<typeof officialDungeonBattleFixture>,
  profilePatch: Partial<OfficialGameStateV1["profile"]> = {},
): { readonly state: OfficialGameStateV12; readonly projection: OfficialGameProjectionBodyV12 } {
  const v12 = v12Reducer();
  let state = parseOfficialGameStateV12(data, quests, {
    ...fixture.started.state,
    profile: { ...fixture.started.state.profile, ...profilePatch },
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  }, { dungeonResources: source });
  // The fixture's source reducer already restored the initial turn with its committed replay
  // tape. Reuse that authoritative projection for the first command; subsequent projections
  // come from the v12 reducer itself.
  let projection = parseOfficialGameProjectionV12({
    ...fixture.started.projection,
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
  });
  for (let turn = 0; turn < 500 && projection.decision.type !== "battle.defeatRecovery"; turn += 1) {
    if (projection.decision.type !== "battle.playerTurn") {
      throw new Error(`v12 defeat fixture has no player decision at turn ${turn}`);
    }
    const reduced = v12.apply({
      playerId: "v12-defeat-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.delay",
      battleId: projection.decision.battleId,
      actorId: projection.decision.actorId,
    });
    state = reduced.state;
    projection = reduced.projection;
  }
  if (projection.decision.type !== "battle.defeatRecovery") {
    throw new Error("v12 defeat fixture did not reach a pending decision");
  }
  return { state, projection };
}

function finishV14DungeonDefeat(
  fixture: ReturnType<typeof officialDungeonBattleFixture>,
  profilePatch: Partial<OfficialGameStateV1["profile"]> = {},
): { readonly state: OfficialGameStateV14; readonly projection: OfficialGameProjectionBodyV12 } {
  const delegate = v12Reducer();
  let state = parseOfficialGameStateV12(data, quests, {
    ...fixture.started.state,
    profile: { ...fixture.started.state.profile, ...profilePatch },
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  }, { dungeonResources: source });
  let projection = parseOfficialGameProjectionV12({
    ...fixture.started.projection,
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
  });
  for (let turn = 0; turn < 500 && projection.decision.type !== "battle.defeatRecovery"; turn += 1) {
    if (projection.decision.type !== "battle.playerTurn") {
      throw new Error(`v14 defeat fixture has no player decision at turn ${turn}`);
    }
    const reduced = delegate.applyForV14({
      playerId: "v14-defeat-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.delay",
      battleId: projection.decision.battleId,
      actorId: projection.decision.actorId,
    });
    state = reduced.state;
    projection = reduced.projection;
  }
  if (projection.decision.type !== "battle.defeatRecovery") {
    throw new Error("v14 defeat fixture did not reach a pending decision");
  }
  return { state, projection };
}

/** Reproduce the partial-enemy-loss branch that plain delay-only defeat fixtures cannot reach.
 * The first server-owned capture removes one authored dungeon enemy; every later turn delays so
 * the party still loses and v14 must retain the untouched pre-battle room for Save Me. */
function finishV14DungeonDefeatAfterCapture(
  fixture: ReturnType<typeof officialDungeonBattleFixture>,
  profilePatch: Partial<OfficialGameStateV1["profile"]> = {},
): { readonly state: OfficialGameStateV14; readonly projection: OfficialGameProjectionBodyV12 } {
  const delegate = v12Reducer();
  let state = parseOfficialGameStateV12(data, quests, {
    ...fixture.started.state,
    profile: { ...fixture.started.state.profile, ...profilePatch },
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  }, { dungeonResources: source });
  let projection = parseOfficialGameProjectionV12({
    ...fixture.started.projection,
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
  });
  let captureAttempted = false;
  for (let turn = 0; turn < 500 && projection.decision.type !== "battle.defeatRecovery"; turn += 1) {
    if (projection.decision.type !== "battle.playerTurn") {
      throw new Error(`v14 partial-loss fixture has no player decision at turn ${turn}`);
    }
    const capture = captureAttempted ? undefined : projection.decision.captureTargets[0];
    const command: GameCommandEnvelopeV1["command"] = capture === undefined
      ? {
          type: "battle.delay",
          battleId: projection.decision.battleId,
          actorId: projection.decision.actorId,
        }
      : {
          type: "battle.attemptCapture",
          battleId: projection.decision.battleId,
          actorId: projection.decision.actorId,
          targetId: capture.targetId,
          cardLevel: capture.availableCardLevels[0]!,
        };
    const reduced = delegate.applyForV14({
      playerId: "v14-partial-loss-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: turn + 1,
      now: "2026-07-29T00:00:00.000Z",
    }, command);
    if (capture !== undefined) captureAttempted = true;
    state = reduced.state;
    projection = reduced.projection;
  }
  if (!captureAttempted || projection.decision.type !== "battle.defeatRecovery") {
    throw new Error("v14 partial-loss fixture did not reach a captured-enemy defeat");
  }
  return { state, projection };
}

function finishV17DungeonDefeatAfterCapture(
  fixture: ReturnType<typeof officialDungeonBattleFixture>,
  profilePatch: Partial<OfficialGameStateV1["profile"]> = {},
): {
  readonly state: OfficialGameStateV17;
  readonly projection: ReturnType<OfficialGameV17Reducer["projectPersistedState"]>;
} {
  const reducer = v17Reducer();
  let state = parseOfficialGameStateV17(data, quests, {
    ...fixture.started.state,
    profile: { ...fixture.started.state.profile, ...profilePatch },
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  }, { dungeonResources: source });
  let projection = reducer.projectPersistedState(state);
  let captureAttempted = false;
  for (let turn = 0; turn < 500 && projection.decision.type !== "battle.defeatRecovery"; turn += 1) {
    if (projection.decision.type !== "battle.playerTurn") {
      throw new Error(`v17 partial-loss fixture has no player decision at turn ${turn}`);
    }
    const capture = captureAttempted ? undefined : projection.decision.captureTargets[0];
    const command: GameCommandEnvelopeV1["command"] = capture === undefined
      ? {
          type: "battle.delay",
          battleId: projection.decision.battleId,
          actorId: projection.decision.actorId,
        }
      : {
          type: "battle.attemptCapture",
          battleId: projection.decision.battleId,
          actorId: projection.decision.actorId,
          targetId: capture.targetId,
          cardLevel: capture.availableCardLevels[0]!,
        };
    const reduced = reducer.apply({
      playerId: "v17-partial-loss-player",
      slotId: "slot-1",
      pack: completeV17Pack,
      state,
      previousRevision: turn + 1,
      now: "2026-08-11T00:00:00.000Z",
    }, command);
    if (capture !== undefined) captureAttempted = true;
    state = reduced.state;
    projection = reduced.projection;
  }
  if (!captureAttempted || projection.decision.type !== "battle.defeatRecovery") {
    throw new Error("v17 partial-loss fixture did not reach a captured-enemy defeat");
  }
  return { state, projection };
}

type OfficialDungeonEncounterRosters = NonNullable<
  NonNullable<OfficialGameStateV1["dungeon"]>["run"]["current"]["session"]["encounterRosters"]
>;

function withCurrentDungeonEncounterRosters(
  state: OfficialGameStateV14,
  encounterRosters: OfficialDungeonEncounterRosters,
): OfficialGameStateV14 {
  if (state.dungeon === undefined) throw new Error("dungeon roster fixture has no dungeon state");
  const currentRoute = state.dungeon.run.current.route;
  return {
    ...state,
    dungeon: {
      ...state.dungeon,
      run: {
        ...state.dungeon.run,
        current: {
          ...state.dungeon.run.current,
          session: {
            ...state.dungeon.run.current.session,
            encounterRosters: structuredClone(encounterRosters),
          },
        },
        cachedFloors: state.dungeon.run.cachedFloors.map((entry) =>
          entry.route.typeName === currentRoute.typeName &&
          entry.route.sourceFile === currentRoute.sourceFile &&
          entry.route.floor === currentRoute.floor
            ? {
                ...entry,
                session: { ...entry.session, encounterRosters: structuredClone(encounterRosters) },
              }
            : entry),
      },
    },
  };
}

async function installServiceV12State(
  authority: AuthoritativeGameService<OfficialGameStateV12, OfficialGameProjectionBodyV12>,
  store: InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>,
  reducer: OfficialGameV12Reducer,
  playerId: string,
  state: OfficialGameStateV12,
): Promise<void> {
  await authority.execute(playerId, "slot-1", envelope(
    `${playerId}-create`,
    0,
    { type: "slot.create", starterElement: "Water" },
  ));
  await store.transact(playerId, "slot-1", async (current) => {
    if (current === undefined) throw new Error("service v12 fixture was not created");
    const projection = {
      ...current.projection,
      ...reducer.projectPersistedState(state),
    };
    reducer.validatePersistedRecord({ state, projection });
    return {
      record: Object.freeze({ ...current, state, projection }),
      value: undefined,
    };
  });
}

async function runLiveV12ServiceDefeat(
  playerId: string,
  activeState: OfficialGameStateV1,
  profilePatch: Partial<OfficialGameStateV1["profile"]> = {},
  attemptCapture = false,
): Promise<{
  readonly v12: ReturnType<typeof v12Service>;
  readonly record: NonNullable<Awaited<ReturnType<ReturnType<typeof v12Service>["store"]["read"]>>>;
  readonly captureAttempted: boolean;
}> {
  const v12 = v12Service();
  const state = parseOfficialGameStateV12(data, quests, {
    ...activeState,
    profile: { ...activeState.profile, ...profilePatch },
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  }, { dungeonResources: source });
  await installServiceV12State(v12.authority, v12.store, v12.reducer, playerId, state);
  const initial = await v12.store.read(playerId, "slot-1");
  if (initial === undefined) throw new Error("live service defeat fixture was not stored");
  let current: NonNullable<typeof initial> = initial;
  let captureAttempted = false;
  for (let turn = 0; turn < 500 && current.projection.decision.type !== "battle.defeatRecovery"; turn += 1) {
    const decision = current.projection.decision;
    if (decision.type !== "battle.playerTurn") {
      throw new Error(`live service defeat fixture has no player decision at turn ${turn}`);
    }
    const capture = attemptCapture && !captureAttempted ? decision.captureTargets[0] : undefined;
    const command: GameCommandEnvelopeV1["command"] = capture === undefined
      ? {
          type: "battle.delay",
          battleId: decision.battleId,
          actorId: decision.actorId,
        }
      : {
          type: "battle.attemptCapture",
          battleId: decision.battleId,
          actorId: decision.actorId,
          targetId: capture.targetId,
          cardLevel: capture.availableCardLevels[0]!,
        };
    await v12.authority.execute(
      playerId,
      "slot-1",
      envelope(`live-defeat-${playerId}-${turn}`, current.revision, command, decision.decisionId),
    );
    if (capture !== undefined) captureAttempted = true;
    const next = await v12.store.read(playerId, "slot-1");
    if (next === undefined) throw new Error("live service defeat record disappeared");
    current = next;
  }
  if (current.projection.decision.type !== "battle.defeatRecovery") {
    throw new Error("live service defeat fixture did not reach a pending decision");
  }
  return { v12, record: current, captureAttempted };
}

function sourceArenaActiveBattle(): OfficialGameStateV1 {
  const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2");
  const arenaTown = arenaWorld?.pointsOfInterest.find(({ name }) => name === "Capital_City");
  if (arenaWorld === undefined || arenaTown === undefined) {
    throw new Error("source Arena fixture is incomplete");
  }
  const party = new WorldTripParty(data, [
    { ...member("arena-loss-1", "BlueBabyDragon", 100), currentHp: 1 },
    { ...member("arena-loss-2", "BlueBabyDragon", 100), currentHp: 1 },
    { ...member("arena-loss-3", "BlueBabyDragon", 100), currentHp: 1 },
  ], 5);
  const profile = new PlayerProfile({
    ...sourceNewGameProfileDefaults("BlueBabyDragon"),
    heroLevel: 3,
    heroTotalHighestLevels: minimumHeroTotalForLevel(3),
    monsterPartyLevels: [100, 100, 100],
  }, party);
  const initial: OfficialGameStateV1 = {
    schemaVersion: 1,
    profile: profile.stateSnapshot(),
    party: party.stateSnapshot(),
    quests: {
      ...emptyGuildQuestStateSnapshot(),
      finishedQuestNames: quests.definitions.slice(0, 5).map(({ name }) => name),
    },
    location: { kind: "town", worldId: arenaWorld.name, townId: arenaTown.name },
    world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
    nextMonsterSequence: 4,
    nextBattleSequence: 1,
  };
  const started = reduce(initial, { type: "arena.startLicenseChallenge" });
  if (started.state.battle?.origin.kind !== "arena") {
    throw new Error("source Arena command did not create an Arena battle");
  }
  return started.state;
}

function sourceWorldActiveBattle(): OfficialGameStateV1 {
  const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
  const party = new WorldTripParty(data, [
    member("world-loss-1", "BlueBabyDragon", 1),
    member("world-loss-2", "BlueBabyDragon", 1),
    member("world-loss-3", "BlueBabyDragon", 1),
  ], 6);
  const profile = new PlayerProfile({
    ...sourceNewGameProfileDefaults("BlueBabyDragon"),
    heroLevel: 6,
    heroTotalHighestLevels: minimumHeroTotalForLevel(6),
    monsterPartyLevels: [1, 1, 1],
  }, party);
  const ready: OfficialGameStateV1 = {
    ...created.state,
    profile: profile.stateSnapshot(),
    party: party.stateSnapshot(),
    location: { kind: "world", worldId: "World_1-1", poiId: "1-1_Field_2" },
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
      poiWins: {
        ...created.state.world!.poiWins,
        "1-1_Turtorial_Hut_1": 1,
        "1-1_Field_1": 1,
        "1-1_Field_2": 1,
      },
    },
  };
  const started = reduce(ready, { type: "world.navigate", targetPoiId: "1-1_Field_3" });
  if (started.state.battle?.origin.kind !== "world") {
    throw new Error("source world command did not create a world battle");
  }
  return started.state;
}

describe("official authoritative gameplay reducer", () => {
  it("strictly binds the complete loaded Collection catalog before advertising claims", () => {
    const strictValidator = validateOfficialCollectionCatalog as unknown as (
      catalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>,
      data: GameData,
      support: OfficialGameSupportReport,
    ) => ReturnType<typeof validateOfficialCollectionCatalog>;
    const catalog = loadCollectionCatalog(source, data);
    const proof = strictValidator(catalog, data, completeSupport);
    const supportWithCollection = createOfficialGameV12Support({
      support: completeSupport,
      commandTypes: ["collection.claim"],
      collectionCatalog: proof,
    });
    expect(supportWithCollection.commandTypes).toContain("collection.claim");
    const descriptor = createOfficialGameV12LogicPackDescriptor(
      `logic-v1:${"6".repeat(64)}`,
      supportWithCollection,
    );
    expect(descriptor.capabilities.commandTypes).toContain("collection.claim");

    const forged = structuredClone(proof);
    expect(() => createOfficialGameV12Support({
      support: completeSupport,
      commandTypes: ["collection.claim"],
      collectionCatalog: forged,
    })).toThrow(/catalog|proof|validated/i);
    const tampered = Object.create(proof) as Record<string, unknown>;
    Object.defineProperty(tampered, "goalIds", {
      value: [...proof.goalIds, "CollectionQuestTampered"],
      enumerable: true,
    });
    expect(() => createOfficialGameV12Support({
      support: completeSupport,
      commandTypes: ["collection.claim"],
      collectionCatalog: tampered as never,
    })).toThrow(/catalog|proof|validated/i);

    const partial = new Map(catalog);
    partial.delete("Base");
    expect(() => strictValidator(partial, data, completeSupport))
      .toThrow(/partial|match|catalog/i);
    const firstGoal = catalog.get("Base")?.[0];
    if (firstGoal === undefined) throw new Error("loaded Collection fixture has no Base goal");
    const malformed = new Map(catalog);
    malformed.set("Base", [{
      ...firstGoal,
      treasureData: undefined,
    } as unknown as CollectionGoalDefinition]);
    expect(() => strictValidator(malformed, data, completeSupport))
      .toThrow(/malformed|catalog/i);
    const crossSupportResources: WorldResourceSource = {
      ...source,
      plist: (path) => path === "Collection.plist"
        ? collectionGoalResource("CrossSupport", [])
        : source.plist(path),
    };
    const crossSupport = validateOfficialGameSupport({
      data,
      world,
      worlds: allWorlds,
      resources: crossSupportResources,
      quests,
      startTownId: "First_City",
    });
    expect(() => strictValidator(catalog, data, crossSupport))
      .toThrow(/partial|match|catalog/i);
  });

  it("claims an explicit-empty Collection goal atomically through the service-owned reward splitter", async () => {
    let rngCalls = 0;
    const fixture = customCollectionV12Fixture(collectionGoalResource(
      "EmptyMixed",
      [],
      {
        items: [
          { chance: 1, spawnType: "gold" },
          {
            chance: 1,
            spawnType: "fixed",
            data: {
              type: "DestroyOnPickup.MonsterJoin",
              arguments: { shortType: "BlueBabyDragon", jobLevel: 2 },
            },
          },
          { chance: 1, spawnType: "fixed", data: { type: "DestroyOnPickup.Egg" } },
        ],
      },
    ), () => {
      rngCalls += 1;
      return 0;
    }, "a");
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>();
    const service = new AuthoritativeGameService({
      pack: fixture.pack,
      store,
      reducer: fixture.reducer,
      validateRecord: (record) => fixture.reducer.validatePersistedRecord(record),
    });
    await service.execute("collection-player", "slot-1", envelope(
      "collection-create",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    const beforeClaim = await store.read("collection-player", "slot-1");
    if (beforeClaim === undefined) throw new Error("Collection slot was not created");
    rngCalls = 0;
    await expect(service.execute("collection-player", "slot-1", envelope(
      "collection-forged-outcome",
      beforeClaim.revision,
      {
        type: "collection.claim",
        goalId: "CollectionQuestEmptyMixed",
        price: 0,
        reward: { kind: "gold", amount: 999_999 },
        randomDraws: [1],
        instanceId: "caller-monster",
        timestamp: "caller-time",
      } as never,
    ))).rejects.toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
    expect(await store.read("collection-player", "slot-1")).toEqual(beforeClaim);
    expect(rngCalls).toBe(0);
    const claim = envelope("collection-claim", 1, {
      type: "collection.claim",
      goalId: "CollectionQuestEmptyMixed",
    });
    const result = await service.execute("collection-player", "slot-1", claim);
    expect(result.idempotentReplay).toBe(false);
    expect(result.projection.collectionClaims.claimedGoalIds).toEqual([
      "CollectionQuestEmptyMixed",
    ]);
    expect(result.projection.pendingEgg).toMatchObject({
      origin: "collection",
      phase: "awaiting-spin",
      remainingRepeats: 1,
    });
    expect(result.projection.player.gold).toBe(101);
    expect(result.projection.player.party).toContainEqual(expect.objectContaining({
      instanceId: "monster-2",
      shortType: "BlueBabyDragon",
      level: 2,
    }));
    expect((await store.read("collection-player", "slot-1"))?.state.profile.schemaVersion).toBe(8);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "quest.rewardClaimed",
      questId: "CollectionQuestEmptyMixed",
      rewards: [
        { kind: "gold", amount: 1 },
        { kind: "monsterJoin", shortType: "BlueBabyDragon", jobLevel: 2 },
        { kind: "egg" },
      ],
      randomDraws: [0, 0, 0],
    }));

    const replay = await service.execute("collection-player", "slot-1", claim);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.revision).toBe(result.revision);
    expect(replay.events).toEqual(result.events);
    expect(replay.projection).toEqual(result.projection);
    await expect(service.execute("collection-player", "slot-1", envelope(
      "collection-duplicate",
      result.revision,
      { type: "collection.claim", goalId: "CollectionQuestEmptyMixed" },
      "decisionId" in result.projection.decision
        ? result.projection.decision.decisionId
        : undefined,
    ))).rejects.toThrow(/pending Egg|phase/i);
  });

  it("reconnects and serializes concurrent non-Egg Collection claims at the service boundary", async () => {
    const fixture = customCollectionV12Fixture(collectionGoalResource(
      "Concurrent",
      [],
      { items: [{ chance: 1, spawnType: "gold" }] },
    ), () => 0, "5");
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>();
    const authority = new AuthoritativeGameService({
      pack: fixture.pack,
      store,
      reducer: fixture.reducer,
      validateRecord: (record) => fixture.reducer.validatePersistedRecord(record),
    });
    await authority.execute("collection-concurrent-player", "slot-1", envelope(
      "collection-concurrent-create",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    const before = await store.read("collection-concurrent-player", "slot-1");
    if (before === undefined) throw new Error("concurrent Collection fixture was not stored");
    const claim = envelope(
      "collection-concurrent-claim",
      before.revision,
      { type: "collection.claim", goalId: "CollectionQuestConcurrent" },
      "decisionId" in before.projection.decision ? before.projection.decision.decisionId : undefined,
    );
    const [first, second] = await Promise.all([
      authority.execute("collection-concurrent-player", "slot-1", claim),
      authority.execute("collection-concurrent-player", "slot-1", claim),
    ]);
    expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([false, true]);
    expect(first.projection.collectionClaims.claimedGoalIds).toEqual([
      "CollectionQuestConcurrent",
    ]);
    expect(first.projection.player.gold).toBe(101);

    const restarted = new AuthoritativeGameService({
      pack: fixture.pack,
      store,
      reducer: fixture.reducer,
      validateRecord: (record) => fixture.reducer.validatePersistedRecord(record),
    });
    expect(await restarted.bootstrap("collection-concurrent-player", "slot-1"))
      .toEqual(first.projection);
    await expect(restarted.execute("collection-concurrent-player", "slot-1", {
      ...claim,
      command: { type: "collection.claim", goalId: "CollectionQuestOther" },
    })).rejects.toMatchObject({ code: "COMMAND_DUPLICATE_MISMATCH" });
    const after = await store.read("collection-concurrent-player", "slot-1");
    expect(after?.state.collectionClaims.claimedGoalIds).toEqual([
      "CollectionQuestConcurrent",
    ]);
    expect(after?.state.profile.schemaVersion).toBe(8);
  });

  it("rejects a distinct concurrent Collection intent as a typed stale revision", async () => {
    let rngCalls = 0;
    const fixture = customCollectionV12Fixture(collectionGoalResource(
      "DistinctConcurrent",
      [],
      { items: [{ chance: 1, spawnType: "gold" }] },
    ), () => {
      rngCalls += 1;
      return 0;
    }, "8");
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>();
    const authority = new AuthoritativeGameService({
      pack: fixture.pack,
      store,
      reducer: fixture.reducer,
      validateRecord: (record) => fixture.reducer.validatePersistedRecord(record),
    });
    await authority.execute("collection-distinct-player", "slot-1", envelope(
      "collection-distinct-create",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    rngCalls = 0;
    const before = await store.read("collection-distinct-player", "slot-1");
    if (before === undefined) throw new Error("distinct Collection fixture was not stored");
    const decisionId = "decisionId" in before.projection.decision
      ? before.projection.decision.decisionId
      : undefined;
    const commands = ["collection-distinct-a", "collection-distinct-b"].map((commandId) =>
      envelope(commandId, before.revision, {
        type: "collection.claim",
        goalId: "CollectionQuestDistinctConcurrent",
      }, decisionId));
    const attempts = await Promise.allSettled(commands.map((command) =>
      authority.execute("collection-distinct-player", "slot-1", command)));
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt): attempt is PromiseRejectedResult =>
      attempt.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "REVISION_CONFLICT" });
    const after = await store.read("collection-distinct-player", "slot-1");
    expect(after?.state.collectionClaims.claimedGoalIds).toEqual([
      "CollectionQuestDistinctConcurrent",
    ]);
    expect(after?.state.profile.gold).toBe(101);
    expect(after?.state.nextMonsterSequence).toBe(before.state.nextMonsterSequence);
    expect(after?.receipts.size).toBe(before.receipts.size + 1);
    expect(after?.receipts.has("collection-distinct-a") || after?.receipts.has("collection-distinct-b"))
      .toBe(true);
    expect(rngCalls).toBe(1);
  });

  it("keeps unknown, incomplete, repeated, and exhausted Collection claims atomic", () => {
    let rngCalls = 0;
    const fixture = customCollectionV12Fixture(
      collectionGoalResource("Incomplete", ["Spikey"], {
        items: [{ chance: 1, spawnType: "fixed", data: { type: "DestroyOnPickup.Egg" } }],
      }),
      () => {
        rngCalls += 1;
        return 0;
      },
      "b",
    );
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: fixture.resources });
    const apply = (candidate: OfficialGameStateV12, goalId: string) => fixture.reducer.apply({
      playerId: "collection-atomic-player",
      slotId: "slot-1",
      pack: fixture.pack,
      state: candidate,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "collection.claim", goalId });
    const before = structuredClone(state);
    expect(() => apply(state, "CollectionQuestUnknown")).toThrow(/unknown/i);
    expect(state).toEqual(before);
    expect(() => apply(state, "CollectionQuestIncomplete")).toThrow(/incomplete/i);
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);

    const claimed = parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: ["CollectionQuestIncomplete"],
      },
    }, { dungeonResources: fixture.resources });
    const claimedBefore = structuredClone(claimed);
    expect(() => apply(claimed, "CollectionQuestIncomplete")).toThrow(/already claimed/i);
    expect(claimed).toEqual(claimedBefore);

    let exhaustedRngCalls = 0;
    const exhaustedFixture = customCollectionV12Fixture(collectionGoalResource(
      "Exhausted",
      [],
      {
        items: [{ chance: 1, spawnType: "fixed", data: {
          type: "DestroyOnPickup.MonsterJoin",
          arguments: { shortType: "BlueBabyDragon", jobLevel: 2 },
        } }],
      },
    ), () => {
      exhaustedRngCalls += 1;
      return 0;
    }, "c");
    const exhausted = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextMonsterSequence: Number.MAX_SAFE_INTEGER,
      nextContinuationSequence: 1,
    }, { dungeonResources: exhaustedFixture.resources });
    const exhaustedBefore = structuredClone(exhausted);
    expect(() => exhaustedFixture.reducer.apply({
      playerId: "collection-exhausted-player",
      slotId: "slot-1",
      pack: exhaustedFixture.pack,
      state: exhausted,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "collection.claim", goalId: "CollectionQuestExhausted" }))
      .toThrow(/sequence|exhaust/i);
    expect(exhausted).toEqual(exhaustedBefore);
    expect(exhaustedRngCalls).toBe(0);
  });

  it("rejects a Collection Egg at continuation exhaustion before consuming server RNG", () => {
    let rngCalls = 0;
    const fixture = customCollectionV12Fixture(collectionGoalResource(
      "ExhaustedEgg",
      [],
      { items: [{ chance: 1, spawnType: "fixed", data: { type: "DestroyOnPickup.Egg" } }] },
    ), () => {
      rngCalls += 1;
      return 0;
    }, "0");
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: Number.MAX_SAFE_INTEGER,
    }, { dungeonResources: fixture.resources });
    const before = structuredClone(state);
    expect(() => fixture.reducer.apply({
      playerId: "collection-continuation-exhausted-player",
      slotId: "slot-1",
      pack: fixture.pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "collection.claim", goalId: "CollectionQuestExhaustedEgg" }))
      .toThrow(/continuation|exhaust/i);
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);
  });

  it("keeps Collection invalid reward data out of v12 capability preflight", () => {
    let rngCalls = 0;
    expect(() => customCollectionV12Fixture(collectionGoalResource(
      "InvalidReward",
      [],
      { items: [{ chance: 1, spawnType: "invented" }] },
    ), () => {
      rngCalls += 1;
      return 0;
    }, "e")).toThrow(/unsupported|spawnType|reward|Collection/i);
    expect(rngCalls).toBe(0);
  });

  it.each([
    {
      label: "recipe",
      reward: {
        type: "DestroyOnPickup.Recipe",
        arguments: { combineName: "NotLoadedRecipe" },
      },
    },
    {
      label: "spirit totem",
      reward: {
        type: "DestroyOnPickup.SpiritTotem",
        arguments: { shortType: "BlueBabyDragon" },
      },
    },
    {
      label: "monster join",
      reward: {
        type: "DestroyOnPickup.MonsterJoin",
        arguments: { shortType: "BlueBabyDragon", jobLevel: 151 },
      },
    },
  ] as const)("rejects an invalid Collection $label before v12 advertisement, RNG, or state", ({ reward }) => {
    let rngCalls = 0;
    const resources: WorldResourceSource = {
      ...source,
      plist: (path) => path === "Collection.plist"
        ? collectionGoalResource("InvalidClosedReward", [], {
            items: [{ chance: 1, spawnType: "fixed", data: reward }],
          })
        : source.plist(path),
    };
    const customSupport = validateOfficialGameSupport({
      data,
      world,
      worlds: allWorlds,
      resources,
      quests,
      startTownId: "First_City",
    });
    let advertised = false;
    expect(() => {
      const catalog = loadCollectionCatalog(resources, data);
      const proof = validateOfficialCollectionCatalog(catalog, data, customSupport);
      advertised = true;
      createOfficialGameV12Support({
        support: customSupport,
        commandTypes: ["collection.claim"],
        collectionCatalog: proof,
      });
    }).toThrow(/recipe|Totem|Summon|monster|level|Collection|unsupported|loaded/i);
    expect(advertised).toBe(false);
    expect(rngCalls).toBe(0);
  });

  it("uses the shared source Save Me boundaries and claims the first eligible offer once", () => {
    const cases = [
      { label: "level 5", blockSaveMe: false, tutorialSeen: false, heroLevel: 5, gold: 100, expected: false },
      { label: "level 6 with 99 gold and unseen tutorial", blockSaveMe: false, tutorialSeen: false, heroLevel: 6, gold: 99, expected: false },
      { label: "level 6 with 100 gold and unseen tutorial", blockSaveMe: false, tutorialSeen: false, heroLevel: 6, gold: 100, expected: true },
      { label: "level 6 with seen tutorial and 99 gold", blockSaveMe: false, tutorialSeen: true, heroLevel: 6, gold: 99, expected: true },
      { label: "Arena", blockSaveMe: true, tutorialSeen: true, heroLevel: 6, gold: 100, expected: false },
      { label: "Volcano", blockSaveMe: true, tutorialSeen: true, heroLevel: 6, gold: 100, expected: false },
      { label: "VolcanoB", blockSaveMe: true, tutorialSeen: true, heroLevel: 6, gold: 100, expected: false },
      { label: "ordinary dungeon", blockSaveMe: false, tutorialSeen: true, heroLevel: 6, gold: 0, expected: true },
      { label: "ordinary world", blockSaveMe: false, tutorialSeen: true, heroLevel: 6, gold: 0, expected: true },
    ] as const;
    for (const candidate of cases) {
      expect(canOfferSaveMe(candidate), candidate.label).toBe(candidate.expected);
    }

    const terminal = finishV12DungeonDefeat(officialDungeonBattleFixture(1), {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: [],
    });
    expect(terminal.state.pendingDefeat).toMatchObject({
      battleId: terminal.state.battle?.battleId,
      decisionId: "decision-1",
      canSaveMe: true,
    });
    expect("tutorialFlags" in terminal.state.profile && terminal.state.profile.tutorialFlags)
      .toContain("SaveMe");
    const repeated = finishV12DungeonDefeat(officialDungeonBattleFixture(1), {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 0,
      tutorialFlags: ["SaveMe"],
    });
    expect("tutorialFlags" in repeated.state.profile && repeated.state.profile.tutorialFlags)
      .toEqual(["SaveMe"]);
  });

  it("owns a Volcano defeat that occurs entirely in dungeon battle-start opening events", () => {
    const fixture = officialDungeonBattleFixture(100, undefined, undefined, {
      dungeonFile: "Dungeon_15.plist",
      fragileParty: true,
      soloParty: true,
      dungeonRoute: {
        typeName: "Cave",
        sourceFile: "Dungeon_15b.plist",
        floor: 211,
        entryZoneName: "VolcanoPassageSwitchSouth",
      },
    });
    const ready = parseOfficialGameStateV12(data, quests, {
      ...fixture.ready,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    const delegate = v12Reducer();
    const terminal = delegate.applyForV16({
      playerId: "opening-dungeon-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: ready,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "dungeon.selectRoom",
      roomId: fixture.encounterRoomId,
    });
    const battle = terminal.state.battle;
    if (battle === undefined) throw new Error("opening dungeon defeat lost its battle");
    expect(battle.replay.options.blockCapture).toBe(true);
    const replay = restoreBattleReplay(data, battle.replay);
    expect(replay.step).toMatchObject({ type: "ended", report: { winner: 1 } });
    expect(replay.events.filter((event) => event.type === "damageDealt")).toHaveLength(1);
    expect(terminal.state.pendingDefeat).toMatchObject({
      battleId: battle.battleId,
      canSaveMe: false,
    });
    expect(terminal.projection.decision).toMatchObject({ type: "battle.defeatRecovery" });
    expect(terminal.state.dungeon).toBeDefined();
    expect(terminal.events.map(({ type }) => type).slice(-2))
      .toEqual(["battle.started", "battle.ended"]);

    const returned = delegate.applyForV16({
      playerId: "opening-dungeon-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: terminal.state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: battle.battleId,
      recovery: "return",
    });
    expect(returned.state.location.kind).toBe("town");
    expect(returned.state.pendingDefeat).toBeUndefined();
    expect(returned.state.battle).toBeUndefined();
    expect(returned.state.dungeon).toBeUndefined();
  });

  it("owns a Save Me decision when Tournament battle-start opening events defeat the party", () => {
    const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
    const arenaTown = arenaWorld.pointsOfInterest.find(({ name }) => name === "Capital_City")!;
    const party = new WorldTripParty(data, [{
      ...member("opening-tournament", "BlueBabyDragon", 1),
      currentHp: 1,
    }], 3);
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("BlueBabyDragon"),
      heroLevel: 6,
      heroTotalHighestLevels: minimumHeroTotalForLevel(6),
      monsterPartyLevels: [1],
      gold: 100,
      tutorialFlags: ["SaveMe"],
    }, party);
    const ready = parseOfficialGameStateV12(data, quests, {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: emptyGuildQuestStateSnapshot(),
      location: { kind: "town", worldId: arenaWorld.name, townId: arenaTown.name },
      world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
      nextMonsterSequence: 2,
      nextBattleSequence: 1,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    const progressBefore = "tournament" in ready.profile ? ready.profile.tournament : undefined;
    const delegate = v12Reducer();
    const terminal = delegate.applyForV16({
      playerId: "opening-tournament-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: ready,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "tournament.startBattle" });
    const battle = terminal.state.battle;
    if (battle === undefined) throw new Error("opening Tournament defeat lost its battle");
    const replay = restoreBattleReplay(data, battle.replay);
    expect(replay.step).toMatchObject({ type: "ended", report: { winner: 1 } });
    expect(terminal.state.pendingDefeat).toMatchObject({
      battleId: battle.battleId,
      canSaveMe: true,
    });
    expect(terminal.projection.decision).toMatchObject({ type: "battle.defeatRecovery" });
    expect("tournament" in terminal.state.profile ? terminal.state.profile.tournament : undefined)
      .toMatchObject({
        index: progressBefore?.index,
        round: progressBefore?.round,
        status: progressBefore?.status,
      });
    expect(terminal.events.map(({ type }) => type).slice(-2))
      .toEqual(["battle.started", "battle.ended"]);

    const restarted = delegate.applyForV16({
      playerId: "opening-tournament-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: terminal.state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: battle.battleId,
      recovery: "saveMe",
    });
    const restartedBattle = restarted.state.battle;
    if (restartedBattle === undefined || restarted.state.pendingDefeat === undefined) {
      throw new Error("opening Tournament Save Me restart lost its second defeat");
    }
    expect(restoreBattleReplay(data, restartedBattle.replay).step)
      .toMatchObject({ type: "ended", report: { winner: 1 } });
    expect(restarted.state.pendingDefeat.battleId).toBe(restartedBattle.battleId);
    expect(restarted.projection.decision).toMatchObject({ type: "battle.defeatRecovery" });
    expect(restarted.state.profile.gold).toBe(0);
    expect(restarted.events.map(({ type }) => type))
      .toEqual(["player.currencyChanged", "battle.started", "battle.ended"]);

    const returned = delegate.applyForV16({
      playerId: "opening-tournament-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: restarted.state,
      previousRevision: 3,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: restartedBattle.battleId,
      recovery: "return",
    });
    expect(returned.state.profile.gold).toBe(0);
    expect(returned.state.pendingDefeat).toBeUndefined();
    expect(returned.state.battle).toBeUndefined();
    expect(returned.events.filter((event) => event.type === "tournament.progressed"))
      .toHaveLength(1);
  });

  it.each([
    {
      label: "level 5, unseen tutorial, 100 gold",
      hero: 5,
      gold: 100,
      tutorialFlags: [] as readonly string[],
      expected: false,
      expectsTutorialClaim: false,
    },
    {
      label: "level 6, unseen tutorial, 99 gold",
      hero: 6,
      gold: 99,
      tutorialFlags: [] as readonly string[],
      expected: false,
      expectsTutorialClaim: false,
    },
    {
      label: "level 6, unseen tutorial, 100 gold",
      hero: 6,
      gold: 100,
      tutorialFlags: [] as readonly string[],
      expected: true,
      expectsTutorialClaim: true,
    },
    {
      label: "level 6, seen tutorial, 99 gold",
      hero: 6,
      gold: 99,
      tutorialFlags: ["SaveMe"] as readonly string[],
      expected: true,
      expectsTutorialClaim: false,
    },
  ] as const)("creates a real ordinary-dungeon defeat for $label", async ({
    hero,
    gold,
    tutorialFlags,
    expected,
    expectsTutorialClaim,
  }) => {
    const fixture = officialDungeonBattleFixture(1);
    const live = await runLiveV12ServiceDefeat(
      `defeat-matrix-${hero}-${gold}-${tutorialFlags.length}`,
      fixture.started.state,
      {
        hero: { level: hero, totalHighestLevels: minimumHeroTotalForLevel(hero) },
        gold,
        tutorialFlags,
      },
    );
    expect(live.record.state.pendingDefeat?.canSaveMe).toBe(expected);
    expect("tutorialFlags" in live.record.state.profile && live.record.state.profile.tutorialFlags).toEqual(
      expectsTutorialClaim ? ["SaveMe"] : tutorialFlags,
    );
    expect(live.record.state.location.kind).toBe("battle");
    expect(live.record.state.battle).toBeDefined();
    expect(live.record.state.dungeon).toBeDefined();
    live.v12.reducer.validatePersistedRecord(live.record);
  });

  it.each([
    {
      label: "Arena",
      active: sourceArenaActiveBattle,
      expected: false,
    },
    {
      label: "Volcano",
      active: () => officialDungeonBattleFixture(100, undefined, undefined, {
        dungeonFile: "Dungeon_15.plist",
        fragileParty: true,
      }).started.state,
      expected: false,
    },
    {
      label: "VolcanoB",
      active: () => officialDungeonBattleFixture(100, undefined, undefined, {
        dungeonFile: "Dungeon_15.plist",
        dungeonRoute: {
          typeName: "Cave",
          sourceFile: "Dungeon_15b.plist",
          floor: 211,
          entryZoneName: "VolcanoPassageSwitchSouth",
        },
      }).started.state,
      expected: false,
    },
    {
      label: "ordinary dungeon",
      active: () => officialDungeonBattleFixture(1).started.state,
      expected: true,
    },
    {
      label: "ordinary world",
      active: sourceWorldActiveBattle,
      expected: true,
    },
  ] as const)("creates a real $label terminal loss with source-derived Save Me blocking", async ({
    label,
    active,
    expected,
  }) => {
    const live = await runLiveV12ServiceDefeat(
      `defeat-route-${label.replaceAll(" ", "-")}`,
      active(),
      {
        hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
        gold: 100,
        tutorialFlags: ["SaveMe"],
      },
    );
    expect(live.record.state.pendingDefeat?.canSaveMe, label).toBe(expected);
    expect(live.record.state.location.kind).toBe("battle");
    expect(live.record.state.battle?.origin.kind).toBe(
      label === "Arena" ? "arena" : label === "ordinary world" ? "world" : "dungeon",
    );
    expect(live.record.state.pendingDefeat?.battleId).toBe(live.record.state.battle?.battleId);
    expect(live.record.state.dungeon === undefined).toBe(label === "Arena" || label === "ordinary world");
    const terminalEvents = [...live.record.receipts.values()].flatMap(({ result }) => result.events);
    expect(terminalEvents).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "defeat",
    }));
    expect(terminalEvents.filter((event) =>
      event.type === "battle.rewardsGranted" ||
      (event.type === "player.monsterAdded" && event.reason === "capture"),
    )).toEqual([]);
    live.v12.reducer.validatePersistedRecord(live.record);
  });

  it("creates the first eligible defeat through the service from a live battle and persists a valid projection", async () => {
    const fixture = officialDungeonBattleFixture(1);
    const v12 = v12Service();
    const liveState = parseOfficialGameStateV12(data, quests, {
      ...fixture.started.state,
      profile: {
        ...fixture.started.state.profile,
        hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
        gold: 100,
        tutorialFlags: [],
      },
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    await installServiceV12State(
      v12.authority,
      v12.store,
      v12.reducer,
      "first-defeat-service-player",
      liveState,
    );

    const initial = await v12.store.read("first-defeat-service-player", "slot-1");
    if (initial === undefined) throw new Error("live defeat service fixture was not stored");
    let current: NonNullable<typeof initial> = initial;
    for (let turn = 0; turn < 500 && current.projection.decision.type !== "battle.defeatRecovery"; turn += 1) {
      const decision = current.projection.decision;
      if (decision.type !== "battle.playerTurn") {
        throw new Error(`live defeat service fixture has no player decision at turn ${turn}`);
      }
      await v12.authority.execute(
        "first-defeat-service-player",
        "slot-1",
        envelope(
          `first-defeat-service-turn-${turn}`,
          current.revision,
          {
            type: "battle.delay",
            battleId: decision.battleId,
            actorId: decision.actorId,
          },
          decision.decisionId,
        ),
      );
      const next = await v12.store.read("first-defeat-service-player", "slot-1");
      if (next === undefined) throw new Error("live defeat service record disappeared");
      current = next;
    }
    expect(current.projection.decision.type).toBe("battle.defeatRecovery");
    expect(current.state.location.kind).toBe("battle");
    expect(current.state.battle).toBeDefined();
    expect(current.state.dungeon).toBeDefined();
    expect("tutorialFlags" in current.state.profile && current.state.profile.tutorialFlags)
      .toEqual(["SaveMe"]);
    expect(current.state.pendingDefeat).toEqual({
      schemaVersion: 1,
      kind: "defeat",
      decisionId: "decision-1",
      battleId: current.state.battle?.battleId,
      canSaveMe: true,
    });
    v12.reducer.validatePersistedRecord(current);
    const restarted = new AuthoritativeGameService({
      pack: completeV12Pack,
      store: v12.store,
      reducer: v12.reducer,
      validateRecord: (record) => v12.reducer.validatePersistedRecord(record),
    });
    expect(await restarted.bootstrap("first-defeat-service-player", "slot-1"))
      .toEqual(current.projection);
  });

  it("forfeits a live attempted capture and preserves an injured living member on ordinary return", async () => {
    const fixture = officialDungeonBattleFixture(1, undefined, undefined, { injuredBench: true });
    const live = await runLiveV12ServiceDefeat(
      "loss-fidelity-service-player",
      fixture.started.state,
      {
        hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
        gold: 0,
        tutorialFlags: ["SaveMe"],
      },
      true,
    );
    expect(live.captureAttempted).toBe(true);
    const pending = live.record;
    expect(pending.state.party.monsters).toHaveLength(fixture.started.state.party.monsters.length);
    expect(pending.state.profile.highestCapturedLevels)
      .toEqual(fixture.started.state.profile.highestCapturedLevels);
    const committedEvents = [...pending.receipts.values()].flatMap(({ result }) => result.events);
    expect(committedEvents.filter((event) =>
      event.type === "player.monsterAdded" && event.reason === "capture",
    )).toEqual([]);
    const injuredBefore = pending.state.party.monsters.find((monster) =>
      monster.instanceId === "dungeon-injured" && monster.currentHp > 0 &&
      monster.injureTime !== undefined && monster.healTime !== undefined);
    if (injuredBefore === undefined) {
      throw new Error("loss fixture did not retain a living injured durable member");
    }
    const pendingDefeat = pending.state.pendingDefeat;
    if (pendingDefeat === undefined) throw new Error("loss fixture has no pending defeat");
    const returned = await live.v12.authority.execute(
      "loss-fidelity-service-player",
      "slot-1",
      envelope(
        "loss-fidelity-return",
        pending.revision,
        {
          type: "battle.resolveDefeat",
          battleId: pendingDefeat.battleId,
          recovery: "return",
        },
        pendingDefeat.decisionId,
      ),
    );
    expect(returned.projection.location.kind).toBe("town");
    const after = await live.v12.store.read("loss-fidelity-service-player", "slot-1");
    if (after === undefined) throw new Error("loss-fidelity return record disappeared");
    const injuredAfter = after.state.party.monsters.find(({ instanceId }) =>
      instanceId === injuredBefore.instanceId);
    expect(injuredAfter).toMatchObject({
      instanceId: injuredBefore.instanceId,
      currentHp: injuredBefore.currentHp,
      injureTime: injuredBefore.injureTime,
      healTime: injuredBefore.healTime,
    });
    expect(after.state.battle).toBeUndefined();
    expect(after.state.dungeon).toBeUndefined();
    expect(after.state.pendingDefeat).toBeUndefined();
  });

  it("defers v12 defeat recovery until the exact battle decision is resolved", () => {
    const fixture = officialDungeonBattleFixture();
    const v12 = v12Reducer();
    const { state, projection } = finishV12DungeonDefeat(fixture);
    expect(projection.decision.type).toBe("battle.defeatRecovery");
    expect(state.location.kind).toBe("battle");
    expect(state.battle).toBeDefined();
    expect(state.pendingDefeat).toMatchObject({
      kind: "defeat",
      battleId: state.battle?.battleId,
    });
    const startedBattle = fixture.started.state.battle;
    if (startedBattle?.origin.kind !== "dungeon") {
      throw new Error("v12 defeat fixture has no dungeon battle origin");
    }
    const startedEncounterId = startedBattle.origin.encounterId;
    const pendingRoster = state.dungeon?.run.current.session.encounterRosters?.find(
      ({ encounterId }) => encounterId === startedEncounterId,
    );
    expect(pendingRoster).toEqual(expect.objectContaining({
      encounterId: startedEncounterId,
      terminalFlowId: expect.any(String),
    }));
    expect(state.dungeon?.run.current.session.clearedEncounterIds)
      .not.toContain(startedEncounterId);
    expect(state.party.monsters).toHaveLength(fixture.started.state.party.monsters.length);

    const returned = v12.apply({
      playerId: "v12-defeat-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: state.pendingDefeat!.battleId,
      recovery: "return",
    });
    expect(returned.state.location.kind).toBe("town");
    expect(returned.state.battle).toBeUndefined();
    expect(returned.state.dungeon).toBeUndefined();
    expect(returned.state.pendingDefeat).toBeUndefined();
    expect(returned.state.profile.gold).toBe(state.profile.gold);
    expect(returned.state.party.monsters.map(({ currentHp }) => currentHp))
      .toEqual(state.party.monsters.map(({ currentHp }) => currentHp));

  });

  it("resolves Save Me for a mixed durable party through shared recovery and normal return", () => {
    const expectedShortTypes = ["BlueBabyDragon", "RedBabyDragon", "Goblin", "Slime"] as const;
    const fixture = officialDungeonBattleFixture(100, undefined, undefined, {
      injuredBench: true,
      soulStoneMember: "dungeon-injured",
      shortTypes: expectedShortTypes,
    });
    const v12 = v12Reducer();
    const { state, projection } = finishV12DungeonDefeat(fixture, {
      hero: {
        level: 6,
        totalHighestLevels: minimumHeroTotalForLevel(6),
      },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    expect(projection.decision.type).toBe("battle.defeatRecovery");
    if (state.pendingDefeat?.canSaveMe !== true) throw new Error("mixed Save Me fixture is ineligible");

    const beforeParty = WorldTripParty.fromStateSnapshot(data, state.party);
    const before = beforeParty.monsters().map((monster) => ({
      instanceId: monster.instanceId,
      shortType: monster.shortType,
      level: monster.level,
      cumulativeXp: monster.cumulativeXp,
      currentHp: monster.currentHp,
      maxHp: beforeParty.maxHpOf(monster.instanceId),
      injureTime: monster.injureTime,
      healTime: monster.healTime,
      soulStone: monster.soulStone === undefined ? undefined : { ...monster.soulStone },
    }));
    expect(before.map(({ shortType }) => shortType)).toEqual(expectedShortTypes);
    expect(before.some(({ currentHp }) => currentHp === 0)).toBe(true);
    const injuredLiving = before.find(({ instanceId, currentHp, maxHp, injureTime, healTime, soulStone }) =>
      instanceId === "dungeon-injured" && currentHp > 0 && currentHp < maxHp &&
      injureTime !== undefined && healTime !== undefined && soulStone !== undefined);
    expect(injuredLiving).toMatchObject({
      instanceId: "dungeon-injured",
      currentHp: expect.any(Number),
      injureTime: expect.any(Number),
      healTime: expect.any(Number),
      soulStone: { element: "Life", level: 3, sourceType: "FireCub" },
    });
    if (injuredLiving === undefined) throw new Error("mixed Save Me fixture lost its stone-equipped injured member");
    const withoutStoneParty = WorldTripParty.fromStateSnapshot(data, {
      ...beforeParty.stateSnapshot(),
      monsters: beforeParty.monsters().map((monster) => {
        if (monster.instanceId !== injuredLiving.instanceId) return monster;
        const { soulStone: _soulStone, ...withoutStone } = monster;
        return withoutStone;
      }),
    });
    const maxHpWithoutStone = withoutStoneParty.maxHpOf(injuredLiving.instanceId);
    const maxHpWithStone = beforeParty.maxHpOf(injuredLiving.instanceId);
    expect(maxHpWithStone).toBe(injuredLiving.maxHp);
    expect(maxHpWithStone).toBeGreaterThan(maxHpWithoutStone);

    const saved = v12.apply({
      playerId: "v12-mixed-save-me-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: state.pendingDefeat.battleId,
      recovery: "saveMe",
    });
    const afterParty = WorldTripParty.fromStateSnapshot(data, saved.state.party);
    const after = afterParty.monsters();
    expect(after.map(({ instanceId, shortType, level, cumulativeXp, soulStone }) => ({
      instanceId,
      shortType,
      level,
      cumulativeXp,
      soulStone: soulStone === undefined ? undefined : { ...soulStone },
    }))).toEqual(before.map(({ instanceId, shortType, level, cumulativeXp, soulStone }) => ({
      instanceId,
      shortType,
      level,
      cumulativeXp,
      soulStone,
    })));
    expect(after.map(({ instanceId, currentHp, injureTime, healTime }) => ({
      instanceId,
      currentHp,
      injureTime,
      healTime,
      maxHp: afterParty.maxHpOf(instanceId),
    }))).toEqual(before.map(({ instanceId }) => ({
      instanceId,
      currentHp: afterParty.maxHpOf(instanceId),
      injureTime: undefined,
      healTime: undefined,
      maxHp: afterParty.maxHpOf(instanceId),
    })));
    const injuredLivingAfter = after.find(({ instanceId }) => instanceId === injuredLiving.instanceId);
    expect(injuredLivingAfter).toMatchObject({
      instanceId: injuredLiving.instanceId,
      currentHp: maxHpWithStone,
      soulStone: injuredLiving.soulStone,
    });
    expect(injuredLivingAfter?.injureTime).toBeUndefined();
    expect(injuredLivingAfter?.healTime).toBeUndefined();
    expect(afterParty.maxHpOf(injuredLiving.instanceId)).toBe(maxHpWithStone);
    expect(saved.state.profile.gold).toBe(0);
    expect(saved.events.filter((event) =>
      event.type === "player.currencyChanged" && event.currency === "gold" && event.delta === -100,
    )).toHaveLength(1);
    expect(saved.state.location.kind).toBe("town");
    expect(saved.state.battle).toBeUndefined();
    expect(saved.state.dungeon).toBeUndefined();
    expect(saved.state.pendingDefeat).toBeUndefined();
  });

  it("v14 spends Save Me once and replaces the lost dungeon battle without resolving the run", () => {
    const fixture = officialDungeonBattleFixture(100, undefined, undefined, {
      injuredBench: true,
    });
    const terminal = finishV14DungeonDefeat(fixture, {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    if (terminal.state.pendingDefeat?.canSaveMe !== true || terminal.state.battle === undefined) {
      throw new Error("v14 Save Me fixture is not eligible");
    }
    const lostBattle = terminal.state.battle;
    // v14 has not synchronized the terminal enemy roster or resolved the room yet. Those effects
    // belong to ordinary return and would make a restart lose the dungeon attempt.
    expect(terminal.state.dungeon).toEqual(fixture.started.state.dungeon);

    const saved = v14Reducer().apply({
      playerId: "v14-save-me-player",
      slotId: "slot-1",
      pack: completeV14Pack,
      state: terminal.state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: terminal.state.pendingDefeat.battleId,
      recovery: "saveMe",
    });

    expect(saved.state.location).toMatchObject({
      kind: "battle",
      battleId: `battle-${terminal.state.nextBattleSequence}`,
    });
    expect(saved.state.battle?.battleId).not.toBe(lostBattle.battleId);
    expect(saved.state.battle?.origin).toEqual(lostBattle.origin);
    expect(saved.state.battle?.encounter).toEqual(lostBattle.encounter);
    expect(saved.state.battle?.replay.teams[1]).toEqual(lostBattle.replay.teams[1]);
    expect(saved.state.battle?.replay.commands).toEqual([]);
    expect(saved.state.nextBattleSequence).toBe(terminal.state.nextBattleSequence + 1);
    expect(saved.state.pendingDefeat).toBeUndefined();
    expect(saved.state.dungeon).toEqual(terminal.state.dungeon);
    expect(saved.state.profile.gold).toBe(0);
    const healed = WorldTripParty.fromStateSnapshot(data, saved.state.party);
    expect(healed.monsters().every((monster) =>
      monster.currentHp === healed.maxHpOf(monster.instanceId) &&
      monster.injureTime === undefined &&
      monster.healTime === undefined)).toBe(true);
    expect(saved.events).toEqual([
      expect.objectContaining({
        type: "player.currencyChanged",
        currency: "gold",
        delta: -100,
        balance: 0,
      }),
      { type: "battle.started", battleId: saved.state.battle?.battleId },
    ]);
    expect(saved.projection.decision.type).toBe("battle.playerTurn");
  });

  it("v22 spends Save Me once and returns a lost dungeon battle through the source retreat path", () => {
    const fixture = officialDungeonBattleFixture(100, undefined, undefined, { injuredBench: true });
    const terminal = finishV14DungeonDefeat(fixture, {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    const context = { dungeonResources: source } as const;
    const v15 = migrateOfficialGameV14ToV15({
      data,
      quests,
      state: terminal.state,
      updatedAt: "2026-08-21T00:00:00.000Z",
      context,
    });
    const v16 = migrateOfficialGameV15ToV16({ data, quests, state: v15, context });
    const v17 = migrateOfficialGameV16ToV17({ data, quests, state: v16, context });
    const v18 = migrateOfficialGameV17ToV18({ data, quests, state: v17, context });
    const v19 = migrateOfficialGameV18ToV19({ data, quests, state: v18, context });
    const v20 = migrateOfficialGameV19ToV20({ data, quests, state: v19, context });
    const v21 = migrateOfficialGameV20ToV21({ data, quests, state: v20, context });
    const v22 = migrateOfficialGameV21ToV22({ data, quests, state: v21, context });
    const lostBattle = v22.battle;
    if (
      lostBattle?.origin.kind !== "dungeon" ||
      v22.pendingDefeat?.canSaveMe !== true ||
      v22.dungeon === undefined
    ) {
      throw new Error("v22 Save Me fixture is not an eligible dungeon defeat");
    }
    const encounterRoomId = v22.dungeon.run.current.session.currentRoomId;

    const saved = v22Reducer().apply({
      playerId: "v22-dungeon-save-me-player",
      slotId: "slot-1",
      pack: completeV22Pack,
      state: v22,
      previousRevision: 2,
      now: "2026-08-21T00:00:01.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: lostBattle.battleId,
      recovery: "saveMe",
    });

    expect(saved.state.location.kind).toBe("dungeon");
    expect(saved.state.location).not.toMatchObject({ roomId: encounterRoomId });
    expect(saved.state.battle).toBeUndefined();
    expect(saved.state.pendingDefeat).toBeUndefined();
    expect(saved.state.nextBattleSequence).toBe(v22.nextBattleSequence);
    expect(saved.state.profile.gold).toBe(0);
    expect(saved.state.dungeonBattleReturn).toMatchObject({
      battleId: lostBattle.battleId,
      outcome: "retreat",
    });
    expect(saved.events.some((event) => event.type === "battle.started")).toBe(false);
    expect(() => OfficialGameProjectionV22Schema.parse({
      slotId: "slot-1",
      revision: 3,
      updatedAt: "2026-08-21T00:00:01.000Z",
      logicPackId: completeV22Pack.logicPackId,
      simulationVersion: OFFICIAL_GAME_V22_SIMULATION_VERSION,
      trustTier: "official",
      ...saved.projection,
    })).not.toThrow();
  });

  it("v22 returns World Save Me to the source origin POI without minting a battle", async () => {
    const live = await runLiveV12ServiceDefeat(
      "v22-world-save-me-player",
      sourceWorldActiveBattle(),
      {
        hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
        gold: 100,
        tutorialFlags: ["SaveMe"],
      },
    );
    const context = { dungeonResources: source } as const;
    const v13 = migrateOfficialGameV12ToV13({
      data, quests, state: live.record.state, context,
    });
    const v14 = migrateOfficialGameV13ToV14({ data, quests, state: v13, context });
    const v15 = migrateOfficialGameV14ToV15({
      data,
      quests,
      state: v14,
      updatedAt: "2026-08-21T00:00:00.000Z",
      context,
    });
    const v16 = migrateOfficialGameV15ToV16({ data, quests, state: v15, context });
    const v17 = migrateOfficialGameV16ToV17({ data, quests, state: v16, context });
    const v18 = migrateOfficialGameV17ToV18({ data, quests, state: v17, context });
    const v19 = migrateOfficialGameV18ToV19({ data, quests, state: v18, context });
    const v20 = migrateOfficialGameV19ToV20({ data, quests, state: v19, context });
    const v21 = migrateOfficialGameV20ToV21({ data, quests, state: v20, context });
    const v22 = migrateOfficialGameV21ToV22({ data, quests, state: v21, context });
    const battle = v22.battle;
    if (battle?.origin.kind !== "world" || v22.pendingDefeat?.canSaveMe !== true) {
      throw new Error("v22 World Save Me fixture is not eligible");
    }

    const saved = v22Reducer().apply({
      playerId: "v22-world-save-me-player",
      slotId: "slot-1",
      pack: completeV22Pack,
      state: v22,
      previousRevision: 2,
      now: "2026-08-21T00:00:01.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: battle.battleId,
      recovery: "saveMe",
    });

    expect(saved.state.location).toEqual({
      kind: "world",
      worldId: battle.origin.worldId,
      poiId: battle.origin.poiId,
    });
    expect(saved.state.world?.currentPoiId).toBe(battle.origin.poiId);
    expect(saved.state.battle).toBeUndefined();
    expect(saved.state.pendingDefeat).toBeUndefined();
    expect(saved.state.dungeonBattleReturn).toBeUndefined();
    expect(saved.state.nextBattleSequence).toBe(v22.nextBattleSequence);
    expect(saved.events.some((event) => event.type === "battle.started")).toBe(false);
  });

  it("v14 retains and validates the untouched dungeon room after losing with an enemy removed", () => {
    const fixture = officialDungeonBattleFixture(1);
    const terminal = finishV14DungeonDefeatAfterCapture(fixture, {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    const battle = terminal.state.battle;
    if (
      battle?.origin.kind !== "dungeon" ||
      battle.encounter.kind !== "dungeon" ||
      terminal.state.pendingDefeat?.canSaveMe !== true
    ) {
      throw new Error("v14 partial-loss fixture is not an eligible dungeon defeat");
    }
    const encounter = battle.encounter.encounter;
    const encounterId = battle.origin.encounterId;
    const replay = restoreBattleReplay(data, battle.replay);
    const survivors = deriveOfficialDungeonTerminalSurvivors(
      encounter,
      battle.replay.teams[1],
      replay,
    );
    expect(survivors.length).toBeLessThan(encounter.monsters.length);
    expect(terminal.state.dungeon).toEqual(fixture.started.state.dungeon);

    expect(() => parseOfficialGameStateV14(
      data,
      quests,
      terminal.state,
      { dungeonResources: source },
    )).not.toThrow();
    expect(() => v14Reducer().projectPersistedState(terminal.state)).not.toThrow();
    // The immutable v12 contract remains strict: its terminal state must already contain the
    // survivor roster and must not silently accept v14's deferred room lifecycle.
    expect(() => parseOfficialGameStateV12(
      data,
      quests,
      terminal.state,
      { dungeonResources: source },
    )).toThrow(/retained roster disagrees with battle survivors/);

    const malformed = withCurrentDungeonEncounterRosters(terminal.state, [{
      encounterId,
      terminalFlowId: "forged-partial-loss",
      monsters: [],
    }]);
    expect(() => parseOfficialGameStateV14(
      data,
      quests,
      malformed,
      { dungeonResources: source },
    )).toThrow(/roster|survivor|encounter|terminal/i);

    const saved = v14Reducer().apply({
      playerId: "v14-partial-loss-player",
      slotId: "slot-1",
      pack: completeV14Pack,
      state: terminal.state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: terminal.state.pendingDefeat.battleId,
      recovery: "saveMe",
    });
    expect(saved.state.location.kind).toBe("battle");
    expect(saved.state.dungeon).toEqual(terminal.state.dungeon);
    expect(saved.state.battle?.replay.teams[1]).toEqual(battle.replay.teams[1]);
    expect(() => v14Reducer().projectPersistedState(saved.state)).not.toThrow();
  });

  it("v17 reaches defeat recovery after a terminal dungeon loss with an enemy removed", () => {
    const fixture = officialDungeonBattleFixture(1);
    const terminal = finishV17DungeonDefeatAfterCapture(fixture, {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    const battle = terminal.state.battle;
    if (battle?.origin.kind !== "dungeon" || battle.encounter.kind !== "dungeon") {
      throw new Error("v17 partial-loss fixture did not retain its dungeon battle");
    }
    const encounter = battle.encounter.encounter;
    const survivors = deriveOfficialDungeonTerminalSurvivors(
      encounter,
      battle.replay.teams[1],
      restoreBattleReplay(data, battle.replay),
    );
    expect(survivors.length).toBeLessThan(encounter.monsters.length);
    expect(terminal.state.dungeon).toEqual(fixture.started.state.dungeon);
    expect(terminal.projection.decision).toMatchObject({
      type: "battle.defeatRecovery",
      battleId: battle.battleId,
    });
    expect(() => parseOfficialGameStateV17(
      data,
      quests,
      terminal.state,
      { dungeonResources: source },
    )).not.toThrow();
    expect(() => v17Reducer().projectPersistedState(terminal.state)).not.toThrow();
  });

  it("v14 applies deferred defeat consequences only when ordinary return is chosen", () => {
    const fixture = officialDungeonBattleFixture();
    const terminal = finishV14DungeonDefeat(fixture, {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    if (terminal.state.pendingDefeat === undefined) throw new Error("v14 return fixture has no decision");
    expect(terminal.state.dungeon).toEqual(fixture.started.state.dungeon);

    const returned = v14Reducer().apply({
      playerId: "v14-return-player",
      slotId: "slot-1",
      pack: completeV14Pack,
      state: terminal.state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: terminal.state.pendingDefeat.battleId,
      recovery: "return",
    });
    expect(returned.state.location.kind).toBe("town");
    expect(returned.state.battle).toBeUndefined();
    expect(returned.state.dungeon).toBeUndefined();
    expect(returned.state.pendingDefeat).toBeUndefined();
    expect(returned.state.profile.gold).toBe(100);
    expect(returned.state.party.monsters.map(({ currentHp }) => currentHp))
      .toEqual(terminal.state.party.monsters.map(({ currentHp }) => currentHp));
  });

  it("v15 restores the full durable party on ordinary defeat return", () => {
    const fixture = officialDungeonBattleFixture(100, undefined, undefined, {
      injuredBench: true,
      soulStoneMember: "dungeon-injured",
      shortTypes: ["BlueBabyDragon", "RedBabyDragon", "Goblin", "Slime"],
    });
    const terminal = finishV14DungeonDefeat(fixture, {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    if (terminal.state.pendingDefeat === undefined) throw new Error("v15 return fixture has no decision");
    expect(terminal.state.party.monsters.some(({ currentHp }) => currentHp === 0)).toBe(true);
    const identitiesBefore = terminal.state.party.monsters.map((monster) => ({
      instanceId: monster.instanceId,
      shortType: monster.shortType,
      level: monster.level,
      cumulativeXp: monster.cumulativeXp,
      soulStone: monster.soulStone,
    }));
    const injuriesBefore = terminal.state.party.monsters.map(({ instanceId, injureTime, healTime }) => ({
      instanceId,
      injureTime,
      healTime,
    }));

    const returned = v15Reducer().apply({
      playerId: "v15-return-player",
      slotId: "slot-1",
      pack: completeV15Pack,
      state: terminal.state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: terminal.state.pendingDefeat.battleId,
      recovery: "return",
    });

    expect(returned.state.location.kind).toBe("town");
    expect(returned.state.battle).toBeUndefined();
    expect(returned.state.dungeon).toBeUndefined();
    expect(returned.state.pendingDefeat).toBeUndefined();
    expect(returned.state.profile.gold).toBe(100);
    expect(returned.state.party.monsters.map((monster) => ({
      instanceId: monster.instanceId,
      shortType: monster.shortType,
      level: monster.level,
      cumulativeXp: monster.cumulativeXp,
      soulStone: monster.soulStone,
    }))).toEqual(identitiesBefore);
    const restored = WorldTripParty.fromStateSnapshot(data, returned.state.party);
    const restoredProfile = PlayerProfile.fromStateSnapshot(
      returned.state.profile,
      restored.monsters().map(({ level }) => level),
      restored,
      {
        evolveChainOf: (shortType) => data.evolveChainOrUndefined(shortType),
        licenseBattingOrderSize: data.license(
          "licenseType" in returned.state.profile ? returned.state.profile.licenseType : "Novice",
        ).battingOrderSize,
      },
    );
    restored.setPlayerBuffSource(() => restoredProfile.battleStatBonuses());
    expect(restored.monsters().every((monster) =>
      monster.currentHp === restored.maxHpOf(monster.instanceId))).toBe(true);
    expect(restored.monsters().map(({ instanceId, injureTime, healTime }) => ({
      instanceId,
      injureTime,
      healTime,
    }))).toEqual(injuriesBefore);
  });

  it("v14 Save Me restarts the same Tournament opponent without advancing the bracket", () => {
    const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
    const arenaTown = arenaWorld.pointsOfInterest.find(({ name }) => name === "Capital_City")!;
    const party = new WorldTripParty(data, [
      member("v14-tournament-1", "BlueBabyDragon", 1),
      member("v14-tournament-2", "BlueBabyDragon", 1),
      member("v14-tournament-3", "BlueBabyDragon", 1),
    ], 3);
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("BlueBabyDragon"),
      heroLevel: 6,
      heroTotalHighestLevels: minimumHeroTotalForLevel(6),
      monsterPartyLevels: [1, 1, 1],
      gold: 100,
      tutorialFlags: ["SaveMe"],
    }, party);
    const initial: OfficialGameStateV1 = {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: emptyGuildQuestStateSnapshot(),
      location: { kind: "town", worldId: arenaWorld.name, townId: arenaTown.name },
      world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
      nextMonsterSequence: 4,
      nextBattleSequence: 1,
    };
    const started = reduce(initial, { type: "tournament.startBattle" });
    let state = parseOfficialGameStateV12(data, quests, {
      ...started.state,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    let projection = parseOfficialGameProjectionV12({
      ...started.projection,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    });
    const delegate = v12Reducer();
    for (let turn = 0; turn < 500 && projection.decision.type !== "battle.defeatRecovery"; turn += 1) {
      if (projection.decision.type !== "battle.playerTurn") {
        throw new Error(`v14 Tournament fixture has no player decision at turn ${turn}`);
      }
      const reduced = delegate.applyForV14({
        playerId: "v14-tournament-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, {
        type: "battle.delay",
        battleId: projection.decision.battleId,
        actorId: projection.decision.actorId,
      });
      state = reduced.state;
      projection = reduced.projection;
    }
    if (state.pendingDefeat?.canSaveMe !== true || state.battle === undefined) {
      throw new Error("v14 Tournament fixture did not reach an eligible defeat");
    }
    const progressBefore = "tournament" in state.profile ? state.profile.tournament : undefined;
    expect(progressBefore).toBeDefined();
    const opponentBefore = state.battle.replay.teams[1];
    const saved = v14Reducer().apply({
      playerId: "v14-tournament-player",
      slotId: "slot-1",
      pack: completeV14Pack,
      state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: state.pendingDefeat.battleId,
      recovery: "saveMe",
    });
    expect(saved.state.location.kind).toBe("battle");
    expect("tournament" in saved.state.profile ? saved.state.profile.tournament : undefined)
      .toEqual(progressBefore);
    expect(saved.state.battle?.origin).toEqual(state.battle.origin);
    expect(saved.state.battle?.replay.teams[1]).toEqual(opponentBefore);
    expect(saved.events).not.toContainEqual(expect.objectContaining({
      type: "tournament.progressed",
    }));
  });

  it("migrates v13 state into v14 without inventing a gameplay transition", () => {
    const terminal = finishV12DungeonDefeat(officialDungeonBattleFixture());
    const migrated = migrateOfficialGameV13ToV14({
      data,
      quests,
      state: terminal.state,
      context: { dungeonResources: source },
    });
    expect(migrated).toEqual(terminal.state);
    expect(migrated).not.toBe(terminal.state);
  });

  it("v14 Save Me restores a survivor-trimmed dungeon room migrated from v13", () => {
    const terminal = finishV14DungeonDefeatAfterCapture(officialDungeonBattleFixture(1), {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    const battle = terminal.state.battle;
    if (
      battle?.origin.kind !== "dungeon" ||
      battle.encounter.kind !== "dungeon" ||
      terminal.state.pendingDefeat?.canSaveMe !== true
    ) {
      throw new Error("migrated v13 partial-loss fixture is not eligible");
    }
    const encounter = battle.encounter.encounter;
    const encounterId = battle.origin.encounterId;
    const survivors = deriveOfficialDungeonTerminalSurvivors(
      encounter,
      battle.replay.teams[1],
      restoreBattleReplay(data, battle.replay),
    );
    const survivorRoster = [{
      encounterId,
      terminalFlowId: "legacy-v13-terminal-loss",
      monsters: survivors,
    }] satisfies OfficialDungeonEncounterRosters;
    const legacyTerminal = withCurrentDungeonEncounterRosters(terminal.state, survivorRoster);
    const exactV13State = parseOfficialGameStateV12(
      data,
      quests,
      legacyTerminal,
      { dungeonResources: source },
    );
    const migrated = migrateOfficialGameV13ToV14({
      data,
      quests,
      state: exactV13State,
      context: { dungeonResources: source },
    });
    expect(migrated).toEqual(exactV13State);

    const saved = v14Reducer().apply({
      playerId: "v14-migrated-partial-loss-player",
      slotId: "slot-1",
      pack: completeV14Pack,
      state: migrated,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: migrated.pendingDefeat!.battleId,
      recovery: "saveMe",
    });
    const restoredRoster = saved.state.dungeon?.run.current.session.encounterRosters?.find(
      (roster) => roster.encounterId === encounterId,
    );
    expect(restoredRoster).toEqual({
      encounterId,
      monsters: encounter.monsters,
    });
    expect(saved.state.battle?.replay.teams[1]).toEqual(battle.replay.teams[1]);
    expect(() => v14Reducer().projectPersistedState(saved.state)).not.toThrow();
  });

  it("repairs only provable v14 defeat-return states when migrating to v15", () => {
    const terminal = finishV14DungeonDefeat(officialDungeonBattleFixture(undefined, undefined, undefined, {
      injuredBench: true,
    }));
    if (terminal.state.pendingDefeat === undefined) throw new Error("v15 migration fixture has no decision");
    const returned = v14Reducer().apply({
      playerId: "v14-migration-player",
      slotId: "slot-1",
      pack: completeV14Pack,
      state: terminal.state,
      previousRevision: 2,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: terminal.state.pendingDefeat.battleId,
      recovery: "return",
    });
    expect(returned.state.party.monsters.some(({ currentHp }) => currentHp === 0)).toBe(true);

    const migratedTown = migrateOfficialGameV14ToV15({
      data,
      quests,
      state: returned.state,
      updatedAt: "2026-07-29T00:00:00.000Z",
      lastLocationCommand: {
        type: "battle.resolveDefeat",
        battleId: terminal.state.pendingDefeat.battleId,
        recovery: "return",
      },
      context: { dungeonResources: source },
    });
    expect(migratedTown.party.monsters.every(({ currentHp }) => currentHp > 0)).toBe(true);

    const leftTown = v14Reducer().apply({
      playerId: "v14-migration-player",
      slotId: "slot-1",
      pack: completeV14Pack,
      state: returned.state,
      previousRevision: 3,
      now: "2026-07-29T00:01:00.000Z",
    }, { type: "world.leaveTown" });
    expect(leftTown.state.party.monsters.some(({ currentHp }) => currentHp === 0)).toBe(true);
    const migratedDeparture = migrateOfficialGameV14ToV15({
      data,
      quests,
      state: leftTown.state,
      updatedAt: "2026-07-29T00:01:00.000Z",
      lastLocationCommand: { type: "world.leaveTown" },
      context: { dungeonResources: source },
    });
    expect(migratedDeparture.party.monsters.every(({ currentHp }) => currentHp > 0)).toBe(true);

    const migratedBattle = migrateOfficialGameV14ToV15({
      data,
      quests,
      state: terminal.state,
      updatedAt: "2026-07-29T00:00:00.000Z",
      context: { dungeonResources: source },
    });
    expect(migratedBattle).toEqual(terminal.state);
  });

  it("fails closed when a pending terminal defeat is not bound to its retained battle", () => {
    const terminal = finishV12DungeonDefeat(officialDungeonBattleFixture());
    const malformed = structuredClone(terminal.state) as unknown as {
      pendingDefeat: { battleId: string };
    };
    malformed.pendingDefeat.battleId = `${malformed.pendingDefeat.battleId}-foreign`;
    expect(() => parseOfficialGameStateV12(data, quests, malformed, { dungeonResources: source }))
      .toThrow(/pending|battle|terminal/i);
  });

  it.each([
    "pending battle binding",
    "terminal dungeon room envelope",
    "terminal dungeon roster",
    "dungeon encounter origin",
  ] as const)("rejects malformed persisted terminal defeat records: %s", (label) => {
    const terminal = finishV12DungeonDefeat(officialDungeonBattleFixture());
    const malformed = structuredClone(terminal.state) as unknown as {
      pendingDefeat: { battleId: string };
      battle: {
        origin: { kind: "dungeon"; encounterId: string };
      };
      dungeon: {
        run: {
          current: {
            session: {
              currentRoomId: string;
              exploredRoomIds: readonly string[];
              encounterRosters?: Array<{
                encounterId: string;
                monsters: unknown[];
              }>;
            };
          };
        };
      };
    };
    const session = malformed.dungeon.run.current.session;
    switch (label) {
      case "pending battle binding":
        malformed.pendingDefeat.battleId = `${malformed.pendingDefeat.battleId}-foreign`;
        break;
      case "terminal dungeon room envelope": {
        const alternateRoom = session.exploredRoomIds.find((id) => id !== session.currentRoomId);
        if (alternateRoom === undefined) throw new Error("terminal fixture has no alternate explored room");
        session.currentRoomId = alternateRoom;
        break;
      }
      case "terminal dungeon roster": {
        const storedRoster = session.encounterRosters?.find(({ encounterId }) =>
          encounterId === malformed.battle.origin.encounterId);
        if (storedRoster === undefined || storedRoster.monsters.length === 0) {
          throw new Error("terminal fixture has no non-empty retained enemy roster");
        }
        storedRoster.monsters = [];
        break;
      }
      case "dungeon encounter origin":
        malformed.battle.origin.encounterId = `${malformed.battle.origin.encounterId}-foreign`;
        break;
    }
    const raw = malformed as unknown as OfficialGameStateV12;
    expect(() => parseOfficialGameStateV12(data, quests, raw, { dungeonResources: source }))
      .toThrow(/dungeon|encounter|roster|room|battle|terminal/i);
  });

  it.each([
    "pending battle binding",
    "terminal dungeon room envelope",
    "terminal dungeon roster",
    "dungeon encounter origin",
  ] as const)("rejects malformed persisted terminal state with its retained valid projection: %s", async (label) => {
    const terminal = finishV12DungeonDefeat(officialDungeonBattleFixture());
    const v12 = v12Service();
    const playerId = `malformed-terminal-${label.replaceAll(" ", "-")}`;
    await installServiceV12State(
      v12.authority,
      v12.store,
      v12.reducer,
      playerId,
      terminal.state,
    );
    const persisted = await v12.store.read(playerId, "slot-1");
    if (persisted === undefined) throw new Error("legitimate terminal record was not persisted");
    const legitimateProjection = persisted.projection;
    const malformed = structuredClone(persisted.state) as unknown as {
      pendingDefeat: { battleId: string };
      battle: {
        origin: { kind: "dungeon"; encounterId: string };
      };
      dungeon: {
        run: {
          current: {
            session: {
              currentRoomId: string;
              exploredRoomIds: readonly string[];
              encounterRosters?: Array<{
                encounterId: string;
                monsters: unknown[];
              }>;
            };
          };
        };
      };
    };
    const session = malformed.dungeon.run.current.session;
    switch (label) {
      case "pending battle binding":
        malformed.pendingDefeat.battleId = `${malformed.pendingDefeat.battleId}-foreign`;
        break;
      case "terminal dungeon room envelope": {
        const alternateRoom = session.exploredRoomIds.find((id) => id !== session.currentRoomId);
        if (alternateRoom === undefined) throw new Error("terminal fixture has no alternate explored room");
        session.currentRoomId = alternateRoom;
        break;
      }
      case "terminal dungeon roster": {
        const storedRoster = session.encounterRosters?.find(({ encounterId }) =>
          encounterId === malformed.battle.origin.encounterId);
        if (storedRoster === undefined || storedRoster.monsters.length === 0) {
          throw new Error("terminal fixture has no non-empty retained enemy roster");
        }
        storedRoster.monsters = [];
        break;
      }
      case "dungeon encounter origin":
        malformed.battle.origin.encounterId = `${malformed.battle.origin.encounterId}-foreign`;
        break;
    }
    const malformedRecord = {
      ...persisted,
      state: malformed as unknown as OfficialGameStateV12,
      projection: legitimateProjection,
    };
    expect(malformedRecord.projection).toEqual(legitimateProjection);
    expect(() => v12.reducer.validatePersistedRecord(malformedRecord))
      .toThrow(/dungeon|encounter|roster|room|battle|terminal|state/i);
  });

  it("settles v12 defeat decisions through restart, replay, concurrency, and fund checks", async () => {
    const terminal = finishV12DungeonDefeat(officialDungeonBattleFixture());
    const first = v12Service();
    await installServiceV12State(
      first.authority,
      first.store,
      first.reducer,
      "defeat-service-player",
      terminal.state,
    );
    const pending = await first.store.read("defeat-service-player", "slot-1");
    if (pending === undefined || pending.state.pendingDefeat === undefined) {
      throw new Error("service defeat fixture was not stored");
    }
    const restarted = new AuthoritativeGameService({
      pack: completeV12Pack,
      store: first.store,
      reducer: first.reducer,
      validateRecord: (record) => first.reducer.validatePersistedRecord(record),
    });
    expect(await restarted.bootstrap("defeat-service-player", "slot-1"))
      .toEqual(pending.projection);
    const wrongBattle = envelope(
      "defeat-service-wrong-battle",
      pending.revision,
      {
        type: "battle.resolveDefeat",
        battleId: "battle-wrong",
        recovery: "return",
      },
      pending.state.pendingDefeat.decisionId,
    );
    await expect(restarted.execute("defeat-service-player", "slot-1", wrongBattle))
      .rejects.toMatchObject({ code: "ENTITY_NOT_FOUND" });
    expect(await first.store.read("defeat-service-player", "slot-1")).toEqual(pending);
    const ineligibleSaveMe = envelope(
      "defeat-service-ineligible-save-me",
      pending.revision,
      {
        type: "battle.resolveDefeat",
        battleId: pending.state.pendingDefeat.battleId,
        recovery: "saveMe",
      },
      pending.state.pendingDefeat.decisionId,
    );
    await expect(restarted.execute("defeat-service-player", "slot-1", ineligibleSaveMe))
      .rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
    expect(await first.store.read("defeat-service-player", "slot-1")).toEqual(pending);
    const staleDecision = envelope(
      "defeat-service-stale-decision",
      pending.revision,
      {
        type: "battle.resolveDefeat",
        battleId: pending.state.pendingDefeat.battleId,
        recovery: "return",
      },
      "decision-stale",
    );
    await expect(restarted.execute("defeat-service-player", "slot-1", staleDecision))
      .rejects.toMatchObject({ code: "DECISION_STALE" });
    expect(await first.store.read("defeat-service-player", "slot-1")).toEqual(pending);
    const resolveReturn = envelope(
      "defeat-service-return",
      pending.revision,
      {
        type: "battle.resolveDefeat",
        battleId: pending.state.pendingDefeat.battleId,
        recovery: "return",
      },
      pending.state.pendingDefeat.decisionId,
    );
    const [returnA, returnB] = await Promise.all([
      restarted.execute("defeat-service-player", "slot-1", resolveReturn),
      restarted.execute("defeat-service-player", "slot-1", resolveReturn),
    ]);
    expect([returnA.idempotentReplay, returnB.idempotentReplay].sort()).toEqual([false, true]);
    const returned = returnA.idempotentReplay ? returnB : returnA;
    expect(returned.projection.location.kind).toBe("town");
    expect(returned.projection.pendingDefeat).toBeUndefined();
    expect((await restarted.execute("defeat-service-player", "slot-1", resolveReturn)).projection)
      .toEqual(returned.projection);
    await expect(restarted.execute("defeat-service-player", "slot-1", {
      ...resolveReturn,
      command: {
        type: "battle.resolveDefeat",
        battleId: pending.state.pendingDefeat.battleId,
        recovery: "saveMe",
      },
    })).rejects.toMatchObject({ code: "COMMAND_DUPLICATE_MISMATCH" });

    const saveMeState = parseOfficialGameStateV12(data, quests, {
      ...terminal.state,
      profile: {
        ...terminal.state.profile,
        hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
        gold: 100,
        tutorialFlags: ["SaveMe"],
      },
      pendingDefeat: { ...terminal.state.pendingDefeat!, canSaveMe: true },
    }, { dungeonResources: source });
    const saveMe = v12Service();
    await installServiceV12State(
      saveMe.authority,
      saveMe.store,
      saveMe.reducer,
      "defeat-save-me-player",
      saveMeState,
    );
    const saveBefore = await saveMe.store.read("defeat-save-me-player", "slot-1");
    if (saveBefore === undefined || saveBefore.state.pendingDefeat === undefined) {
      throw new Error("Save Me service fixture was not stored");
    }
    const saved = await saveMe.authority.execute("defeat-save-me-player", "slot-1", envelope(
      "defeat-service-save-me",
      saveBefore.revision,
      {
        type: "battle.resolveDefeat",
        battleId: saveBefore.state.pendingDefeat.battleId,
        recovery: "saveMe",
      },
      saveBefore.state.pendingDefeat.decisionId,
    ));
    expect(saved.projection.location.kind).toBe("town");
    expect(saved.projection.player.gold).toBe(0);
    const savedRecord = await saveMe.store.read("defeat-save-me-player", "slot-1");
    if (savedRecord === undefined) throw new Error("Save Me service result was not stored");
    const savedParty = WorldTripParty.fromStateSnapshot(data, savedRecord.state.party);
    expect(savedParty.monsters().every((monster) =>
      monster.currentHp === savedParty.maxHpOf(monster.instanceId))).toBe(true);

    const insufficientState = parseOfficialGameStateV12(data, quests, {
      ...saveMeState,
      profile: { ...saveMeState.profile, gold: 99 },
    }, { dungeonResources: source });
    const insufficient = v12Service();
    await installServiceV12State(
      insufficient.authority,
      insufficient.store,
      insufficient.reducer,
      "defeat-insufficient-player",
      insufficientState,
    );
    const insufficientBefore = await insufficient.store.read("defeat-insufficient-player", "slot-1");
    if (insufficientBefore === undefined || insufficientBefore.state.pendingDefeat === undefined) {
      throw new Error("insufficient-funds service fixture was not stored");
    }
    await expect(insufficient.authority.execute(
      "defeat-insufficient-player",
      "slot-1",
      envelope(
        "defeat-service-insufficient",
        insufficientBefore.revision,
        {
          type: "battle.resolveDefeat",
          battleId: insufficientBefore.state.pendingDefeat.battleId,
          recovery: "saveMe",
        },
        insufficientBefore.state.pendingDefeat.decisionId,
      ),
    )).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await insufficient.store.read("defeat-insufficient-player", "slot-1"))
      .toEqual(insufficientBefore);
  });

  it("rejects a distinct concurrent Save Me intent without a second settlement", async () => {
    const terminal = finishV12DungeonDefeat(officialDungeonBattleFixture(1), {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    });
    const v12 = v12Service();
    await installServiceV12State(
      v12.authority,
      v12.store,
      v12.reducer,
      "defeat-distinct-player",
      terminal.state,
    );
    const before = await v12.store.read("defeat-distinct-player", "slot-1");
    if (before === undefined || before.state.pendingDefeat === undefined) {
      throw new Error("distinct defeat fixture was not stored");
    }
    const pending = before.state.pendingDefeat;
    const commands = ["defeat-distinct-a", "defeat-distinct-b"].map((commandId) =>
      envelope(commandId, before.revision, {
        type: "battle.resolveDefeat",
        battleId: pending.battleId,
        recovery: "saveMe",
      }, pending.decisionId));
    const attempts = await Promise.allSettled(commands.map((command) =>
      v12.authority.execute("defeat-distinct-player", "slot-1", command)));
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt): attempt is PromiseRejectedResult =>
      attempt.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "REVISION_CONFLICT" });
    const after = await v12.store.read("defeat-distinct-player", "slot-1");
    if (after === undefined) throw new Error("distinct defeat record disappeared");
    expect(after.state.pendingDefeat).toBeUndefined();
    expect(after.state.profile.gold).toBe(0);
    expect(after.receipts.size).toBe(before.receipts.size + 1);
    const committedEvents = [...after.receipts.values()].flatMap(({ result }) => result.events);
    expect(committedEvents.filter((event) =>
      event.type === "player.currencyChanged" && event.currency === "gold" && event.delta === -100,
    )).toHaveLength(1);
    expect(after.receipts.has("defeat-distinct-a") || after.receipts.has("defeat-distinct-b"))
      .toBe(true);
  });

  it("keeps a terminal defeat sequence exhaustion as a full service-record no-op", async () => {
    const fixture = officialDungeonBattleFixture();
    const v12 = v12Service();
    let state = parseOfficialGameStateV12(data, quests, {
      ...fixture.started.state,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    let projection = parseOfficialGameProjectionV12({
      ...fixture.started.projection,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    });
    let beforeTerminalState = state;
    let beforeTerminalProjection = projection;
    let terminalReached = false;
    for (let turn = 0; turn < 500; turn += 1) {
      if (projection.decision.type !== "battle.playerTurn") {
        throw new Error(`sequence fixture has no player decision at turn ${turn}`);
      }
      const reduced = v12.reducer.apply({
        playerId: "defeat-sequence-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, {
        type: "battle.delay",
        battleId: projection.decision.battleId,
        actorId: projection.decision.actorId,
      });
      if (reduced.projection.decision.type === "battle.defeatRecovery") {
        terminalReached = true;
        break;
      }
      state = reduced.state;
      projection = reduced.projection;
      beforeTerminalState = state;
      beforeTerminalProjection = projection;
    }
    expect(terminalReached).toBe(true);
    const exhaustedState = parseOfficialGameStateV12(data, quests, {
      ...beforeTerminalState,
      nextContinuationSequence: Number.MAX_SAFE_INTEGER,
    }, { dungeonResources: source });
    await installServiceV12State(
      v12.authority,
      v12.store,
      v12.reducer,
      "defeat-sequence-player",
      exhaustedState,
    );
    const before = await v12.store.read("defeat-sequence-player", "slot-1");
    if (before === undefined) throw new Error("sequence fixture was not stored");
    expect(before.projection.decision).toEqual(beforeTerminalProjection.decision);
    if (before.projection.decision.type !== "battle.playerTurn") {
      throw new Error("sequence fixture did not retain the final player decision");
    }
    await expect(v12.authority.execute(
      "defeat-sequence-player",
      "slot-1",
      envelope(
        "defeat-sequence-terminal",
        before.revision,
        {
          type: "battle.delay",
          battleId: before.projection.decision.battleId,
          actorId: before.projection.decision.actorId,
        },
        before.projection.decision.decisionId,
      ),
    )).rejects.toMatchObject({ message: expect.stringMatching(/continuation|exhausted|safe/i) });
    expect(await v12.store.read("defeat-sequence-player", "slot-1")).toEqual(before);
  });

  it("rejects unknown keys in versioned state envelopes while retaining canonical legacy omissions", () => {
    const base = partyState();
    expect(() => parseOfficialGameStateV1(data, quests, {
      ...base,
      unexpected: true,
    })).toThrow(/unknown field/);
    expect(() => parseOfficialGameStateV1(data, quests, {
      ...base,
      location: { ...base.location, unexpected: true },
    })).toThrow(/unknown field/);
    expect(() => parseOfficialGameStateV1(data, quests, {
      ...base,
      world: { ...base.world!, unexpected: true },
    })).toThrow(/unknown field/);
    const projection = reduce(undefined, { type: "slot.create", starterElement: "Water" }).projection;
    expect(SlotProjectionV1Schema.safeParse({ ...projection, unexpected: true }).success).toBe(false);
    expect(SlotProjectionV1Schema.safeParse({
      ...projection,
      player: { ...projection.player, unexpected: true },
    }).success).toBe(false);
    const { nextBattleSequence: _legacyNextBattleSequence, ...legacy } = base;
    expect(parseOfficialGameStateV1(data, quests, legacy)).toMatchObject({ nextBattleSequence: 1 });
  });

  it("admits Tutorial4 only when the installed source Plot and raster pages expose it", () => {
    expect(completeSupport.tutorialFlags).toContain("Tutorial4");
    expect(support.tutorialFlags).not.toContain("Tutorial4");
  });

  it("canonicalizes unordered plist room dictionaries before seeded dungeon generation", () => {
    const reorderedSource: WorldResourceSource = {
      ...source,
      plist: (path) => {
        const value = structuredClone(source.plist(path));
        if (path !== "Dungeons.plist") return value;
        const registry = value as Record<string, {
          creationData: { roomTypes: Record<string, unknown> };
        }>;
        const roomTypes = registry.Cave!.creationData.roomTypes;
        registry.Cave!.creationData.roomTypes = Object.fromEntries(
          Object.entries(roomTypes).reverse(),
        );
        return registry;
      },
    };
    const definition = loadDungeonData(
      reorderedSource,
      "Cave",
      "Dungeon_1.plist",
      1,
      new Set(data.allMonsters().map(({ shortType }) => shortType)),
    );
    const keys = definition.creation.roomTemplates.map(({ key }) => key);
    expect(keys).toEqual([...keys].sort());
  });

  it("bridges cross-world exits, dungeons, and direct Town Portal through server-owned state", () => {
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const crossExit = allWorlds.flatMap((candidate) =>
      candidate.pointsOfInterest.map((poi) => ({ world: candidate, poi })))
      .find(({ poi }) => poi.zoneChange?.kind === "world");
    if (crossExit === undefined) throw new Error("fixture has no cross-world exit");
    const crossState: OfficialGameStateV1 = {
      ...created.state,
      location: {
        kind: "world",
        worldId: crossExit.world.name,
        poiId: crossExit.poi.name,
      },
      world: {
        ...created.state.world!,
        worldId: crossExit.world.name,
        currentPoiId: crossExit.poi.name,
      },
    };
    const crossed = reduce(crossState, {
      type: "world.activateZone",
      zoneId: crossExit.poi.name,
    });
    expect(crossed.projection.location).toEqual({
      kind: "world",
      worldId: crossExit.poi.zoneChange!.targetWorld,
      poiId: crossExit.poi.zoneChange!.targetZoneChange,
    });

    const dungeonEntrance = allWorlds.flatMap((candidate) =>
      candidate.pointsOfInterest.map((poi) => ({ world: candidate, poi })))
      .find(({ poi }) => poi.zoneChange?.kind === "dungeon");
    if (dungeonEntrance === undefined) throw new Error("fixture has no dungeon entrance");
    const dungeonState: OfficialGameStateV1 = {
      ...created.state,
      location: {
        kind: "world",
        worldId: dungeonEntrance.world.name,
        poiId: dungeonEntrance.poi.name,
      },
      world: {
        ...created.state.world!,
        worldId: dungeonEntrance.world.name,
        currentPoiId: dungeonEntrance.poi.name,
      },
    };
    const entered = reduce(dungeonState, {
      type: "world.activateZone",
      zoneId: dungeonEntrance.poi.name,
    });
    expect(entered.projection.location.kind).toBe("dungeon");
    expect(entered.projection.dungeon?.run.current.session.currentRoomId).toBeTruthy();
    expect(entered.projection.decision.type).toBe("dungeon.ready");
    expect(() => SlotProjectionV1Schema.parse({
      ...entered.projection,
      slotId: "slot-1",
      revision: 1,
      updatedAt: "2026-07-29T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: completePack.simulationVersion,
      trustTier: "official",
    })).not.toThrow();
    if (entered.projection.decision.type !== "dungeon.ready") {
      throw new Error("dungeon decision missing");
    }
    const enteredSession = entered.projection.dungeon!.run.current.session;
    const adjacentRoomId = enteredSession.exploredRoomIds.find(
      (id) => id !== enteredSession.currentRoomId,
    );
    if (adjacentRoomId === undefined) {
      throw new Error("entered dungeon room did not materialize an adjacent room");
    }
    const traversed = reduce(entered.state, {
      type: "dungeon.selectRoom",
      roomId: adjacentRoomId,
    });
    expect(traversed.events).toContainEqual(expect.objectContaining({
      type: "dungeon.roomSelected",
      roomId: adjacentRoomId,
      transition: "door-walk",
    }));
    const selected = reduce(entered.state, {
      type: "dungeon.selectRoom",
      roomId: entered.projection.location.kind === "dungeon"
        ? entered.projection.location.roomId
        : "",
    });
    expect(selected.events).toContainEqual(expect.objectContaining({
      type: "dungeon.roomSelected",
      transition: "same-room",
    }));

    const returned = reduce({
      ...entered.state,
      world: {
        ...entered.state.world!,
        occurrenceByPoi: { Dungeon_1: true },
        completedPoiIds: ["Dungeon_1"],
      },
    }, { type: "world.useDirectTownReturn" });
    expect(returned.projection.location).toEqual({
      kind: "town",
      worldId: world.name,
      townId: "First_City",
    });
    expect(returned.projection.dungeon).toBeUndefined();
    expect(returned.state.dungeon).toBeUndefined();
    expect(returned.projection.world?.occurrenceByPoi).toEqual({});
    expect(returned.projection.world?.completedPoiIds).toEqual(["First_City"]);
  });

  it("keeps an exited dungeon private cache until the next town boundary", () => {
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const dungeonEntrance = allWorlds.flatMap((candidate) =>
      candidate.pointsOfInterest.map((poi) => ({ world: candidate, poi })))
      .find(({ poi }) => poi.zoneChange?.kind === "dungeon");
    if (dungeonEntrance === undefined) throw new Error("fixture has no dungeon entrance");
    const entered = reduce({
      ...created.state,
      location: {
        kind: "world",
        worldId: dungeonEntrance.world.name,
        poiId: dungeonEntrance.poi.name,
      },
      world: {
        ...created.state.world!,
        worldId: dungeonEntrance.world.name,
        currentPoiId: dungeonEntrance.poi.name,
      },
    }, {
      type: "world.activateZone",
      zoneId: dungeonEntrance.poi.name,
    });
    if (entered.state.dungeon === undefined) throw new Error("fixture did not enter a dungeon");

    const questRuntime = new GuildQuestRuntime(quests, entered.state.quests);
    const enteredParty = WorldTripParty.fromStateSnapshot(data, entered.state.party);
    const enteredProfile = PlayerProfile.fromStateSnapshot(
      entered.state.profile,
      enteredParty.monsters().map(({ level }) => level),
      enteredParty,
    );
    const runtime = DungeonRuntimeController.restore({
      resources: source,
      monsterTypes: data.allMonsters().map(({ shortType }) => shortType),
      legacyDungeonGenerationSemantics: true,
      isCompletionSet: (key) => questRuntime.hasCompletedFixedEncounter(key),
      isQuestUsable: (key) => questRuntime.canUseQuestKey(key),
      isMonsterRegistered: (type) => enteredProfile.highestRegisteredLevel(type) > 0,
      isCatchQuestDone: (instanceName) => enteredProfile.hasCompletedCatchQuest(instanceName),
    }, entered.state.dungeon.run);
    const exitRoom = runtime.session.state.rooms.find((room) =>
      room.zones.some(({ change }) => change.kind === "worldExit"));
    if (exitRoom === undefined) throw new Error("fixture dungeon has no world exit");

    const previous = new Map<string, string | undefined>([
      [runtime.session.currentRoom.id, undefined],
    ]);
    const queue = [runtime.session.currentRoom.id];
    while (queue.length > 0 && !previous.has(exitRoom.id)) {
      const roomId = queue.shift()!;
      const room = runtime.session.state.rooms.find(({ id }) => id === roomId)!;
      for (const link of room.links) {
        if (previous.has(link.targetRoomId)) continue;
        previous.set(link.targetRoomId, roomId);
        queue.push(link.targetRoomId);
      }
    }
    const path: string[] = [];
    for (let roomId = exitRoom.id; roomId !== runtime.session.currentRoom.id;) {
      path.push(roomId);
      const priorRoomId = previous.get(roomId);
      if (priorRoomId === undefined) throw new Error("fixture world exit is unreachable");
      roomId = priorRoomId;
    }
    for (const roomId of path.reverse()) {
      const movement = runtime.session.moveToRoom(roomId);
      for (const action of movement.actions) {
        if (action.kind === "encounter") runtime.resolveEncounter(action.encounter, "victory");
      }
    }
    const exitZone = runtime.session.currentRoom.zones.find(
      ({ change }) => change.kind === "worldExit",
    );
    if (exitZone === undefined) throw new Error("fixture did not reach its world exit");
    const beforeExit = runtime.snapshot();
    const activeAtExit: OfficialGameStateV1 = {
      ...entered.state,
      location: {
        kind: "dungeon",
        dungeonId: beforeExit.current.session.definitionId,
        floor: beforeExit.current.session.floor,
        roomId: beforeExit.current.session.currentRoomId,
      },
      dungeon: {
        ...entered.state.dungeon,
        run: beforeExit,
      },
    };

    const exited = reduce(activeAtExit, {
      type: "dungeon.activateZone",
      zoneId: exitZone.id,
    });
    expect(exited.projection.location.kind).toBe("world");
    expect(exited.projection.dungeon).toBeUndefined();
    expect(exited.state.dungeon?.run).toEqual(beforeExit);
    expect(parseOfficialGameStateV1(data, quests, structuredClone(exited.state), {
      dungeonResources: source,
    }))
      .toEqual(exited.state);

    if (exited.projection.location.kind !== "world") {
      throw new Error("fixture did not return to the world");
    }
    const reentered = reduce(exited.state, {
      type: "world.activateZone",
      zoneId: exited.projection.location.poiId,
    });
    expect(reentered.projection.location.kind).toBe("dungeon");
    expect(reentered.state.dungeon?.run.runSeed).toBe(beforeExit.runSeed);
    expect(reentered.state.dungeon?.run.current.session).toMatchObject({
      seed: beforeExit.current.session.seed,
      exploredRoomIds: beforeExit.current.session.exploredRoomIds,
      clearedEncounterIds: beforeExit.current.session.clearedEncounterIds,
      collectedTreasureIds: beforeExit.current.session.collectedTreasureIds,
    });

    const returned = reduce(exited.state, { type: "world.useDirectTownReturn" });
    expect(returned.projection.location.kind).toBe("town");
    expect(returned.state.dungeon).toBeUndefined();
  });

  it("enforces visited-town Warp Gate travel and commits the destination town transaction", () => {
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const warpReady: OfficialGameStateV1 = {
      ...created.state,
      world: {
        ...created.state.world!,
        visitedTownIds: ["Capital_City", "First_City"],
      },
    };
    const warped = reduce(warpReady, {
      type: "world.usePortal",
      destinationTownId: "Capital_City",
    });
    expect(warped.projection.location).toEqual({
      kind: "town",
      worldId: "World_1-2",
      townId: "Capital_City",
    });
    expect(warped.projection.world).toMatchObject({
      currentPoiId: "Capital_City",
      lastTownId: "Capital_City",
      dayNumber: 2,
      visitedTownIds: ["Capital_City", "First_City"],
    });
    expect(warped.events).toContainEqual(expect.objectContaining({
      type: "world.arrived",
      poiId: "Capital_City",
      movement: "teleport",
    }));

    expect(() => reduce(created.state, {
      type: "world.usePortal",
      destinationTownId: "Capital_City",
    })).toThrow(/has not been visited/);
  });

  it("keeps the shipped Liberate portal gate inert until Longdale's fixed battle is complete", () => {
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const longdaleWorld = allWorlds.find((candidate) => candidate.name === "World_3-3");
    if (longdaleWorld === undefined) throw new Error("shipped Longdale world is missing");
    const longdale = (options: {
      readonly completedBattle?: boolean;
      readonly active?: boolean;
      readonly completedQuest?: boolean;
    } = {}): OfficialGameStateV1 => {
      const completedQuest = options.completedQuest === true;
      const active = options.active ?? !completedQuest;
      const state: OfficialGameStateV1 = {
        ...created.state,
        quests: {
          ...created.state.quests,
          activeQuestNames: active ? ["LiberateTownsQuest"] : [],
          finishedQuestNames: completedQuest ? ["LiberateTownsQuest"] : [],
          completedFixedEncounterKeys: options.completedBattle === true
            ? ["RenderableLongdale_CityNameKey"]
            : [],
        },
        location: {
          kind: "town",
          worldId: longdaleWorld.name,
          townId: "Longdale_City",
        },
        world: {
          ...createInitialOfficialWorldState(longdaleWorld, "Longdale_City"),
          visitedTownIds: ["Longdale_City"],
        },
      };
      // Exercise the strict durable parser before the reducer restores the state.
      expect(parseOfficialGameStateV1(data, quests, structuredClone(state))).toEqual(state);
      return state;
    };

    const blocked = longdale();
    const blockedBefore = structuredClone(blocked);
    expect(() => reduce(blocked, {
      type: "world.usePortal",
      destinationTownId: "Longdale_City",
    })).toThrow(/Warp Gates are disabled/);
    expect(blocked).toEqual(blockedBefore);

    const unlocked = reduce(longdale({ completedBattle: true }), {
      type: "world.usePortal",
      destinationTownId: "Longdale_City",
    });
    expect(unlocked.projection.location).toEqual({
      kind: "town",
      worldId: "World_3-3",
      townId: "Longdale_City",
    });
    expect(unlocked.projection.world).toMatchObject({
      lastTownId: "Longdale_City",
      visitedTownIds: ["Longdale_City"],
    });

    const lockedDestination = longdale({ active: false });
    const lockedBefore = structuredClone(lockedDestination);
    expect(() => reduce(lockedDestination, {
      type: "world.usePortal",
      destinationTownId: "Secret_City",
    })).toThrow(/destination Secret_City is locked/);
    expect(lockedDestination).toEqual(lockedBefore);

    const unvisitedDestination = longdale({ completedQuest: true });
    const unvisitedBefore = structuredClone(unvisitedDestination);
    expect(() => reduce(unvisitedDestination, {
      type: "world.usePortal",
      destinationTownId: "Capital_City",
    })).toThrow(/destination Capital_City has not been visited/);
    expect(unvisitedDestination).toEqual(unvisitedBefore);
  });

  it("migrates v9 town history from installed completed town POIs", () => {
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const legacy = structuredClone(created.state) as unknown as {
      world: {
        visitedTownIds?: readonly string[];
        everCompletedPoiIds: readonly string[];
      };
    };
    delete legacy.world.visitedTownIds;
    legacy.world.everCompletedPoiIds = ["Capital_City", "First_City", "not-a-town"];
    const migrated = completeReducer.migrateV9State(legacy);
    expect(migrated.state.world?.visitedTownIds).toEqual(["Capital_City", "First_City"]);
    expect(migrated.projection.world?.visitedTownIds).toEqual(["Capital_City", "First_City"]);
  });

  it("banks the deepest Abyss floor on every entry point and announces only a deeper one", () => {
    const abyssEntrance = firstDungeonEntrance("Dungeon_15.plist");
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const outside = (state: OfficialGameStateV1): OfficialGameStateV1 => ({
      ...state,
      location: {
        kind: "world",
        worldId: abyssEntrance.world.name,
        poiId: abyssEntrance.poi.name,
      },
      world: {
        ...state.world!,
        worldId: abyssEntrance.world.name,
        currentPoiId: abyssEntrance.poi.name,
      },
    });



    const entered = reduce(outside(created.state), {
      type: "world.activateZone",
      zoneId: abyssEntrance.poi.name,
    });
    if (entered.state.dungeon === undefined) throw new Error("fixture did not enter the Abyss");
    if (entered.state.profile.schemaVersion !== 8) throw new Error("expected profile schema 8");
    expect(entered.state.profile.infiniteDungeonHighestLevel).toBe(1);
    expect(entered.projection.player.infiniteDungeonHighestLevel).toBe(1);
    expect(entered.events).toContainEqual(expect.objectContaining({
      type: "dungeon.infiniteFloorEntered",
      floor: 1,
      previousHighest: 0,
    }));




    const reentered = reduce(outside(entered.state), {
      type: "world.activateZone",
      zoneId: abyssEntrance.poi.name,
    });
    if (reentered.state.profile.schemaVersion !== 8) throw new Error("expected profile schema 8");
    expect(reentered.state.profile.infiniteDungeonHighestLevel).toBe(1);
    expect(reentered.events.map(({ type }) => type))
      .not.toContain("dungeon.infiniteFloorEntered");

    // A save whose player has already been deeper: entering floor 1 cannot shrink the property, and
    // the bench keeps the 21 extra slots `battingOrderSize` derives from 212/10.
    const deep = reduce(
      outside({
        ...entered.state,
        profile: { ...entered.state.profile, infiniteDungeonHighestLevel: 212 },
      }),
      { type: "world.activateZone", zoneId: abyssEntrance.poi.name },
    );
    if (deep.state.profile.schemaVersion !== 8) throw new Error("expected profile schema 8");
    expect(deep.state.profile.infiniteDungeonHighestLevel).toBe(212);
    expect(deep.events.map(({ type }) => type)).not.toContain("dungeon.infiniteFloorEntered");
    expect(deep.projection.player.battingOrderSize)
      .toBe(entered.projection.player.battingOrderSize + 21);
  });

  it("banks the stairs-down floor but not a room change within one", () => {
    const abyssEntrance = firstDungeonEntrance("Dungeon_15.plist");
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const entered = reduce({
      ...created.state,
      location: {
        kind: "world",
        worldId: abyssEntrance.world.name,
        poiId: abyssEntrance.poi.name,
      },
      world: {
        ...created.state.world!,
        worldId: abyssEntrance.world.name,
        currentPoiId: abyssEntrance.poi.name,
      },
    }, { type: "world.activateZone", zoneId: abyssEntrance.poi.name });
    if (entered.state.dungeon === undefined) throw new Error("fixture did not enter the Abyss");

    const questRuntime = new GuildQuestRuntime(quests, entered.state.quests);
    const enteredParty = WorldTripParty.fromStateSnapshot(data, entered.state.party);
    const enteredProfile = PlayerProfile.fromStateSnapshot(
      entered.state.profile,
      enteredParty.monsters().map(({ level }) => level),
      enteredParty,
    );
    const runtime = DungeonRuntimeController.restore({
      resources: source,
      monsterTypes: data.allMonsters().map(({ shortType }) => shortType),
      legacyDungeonGenerationSemantics: true,
      isCompletionSet: (key) => questRuntime.hasCompletedFixedEncounter(key),
      isQuestUsable: (key) => questRuntime.canUseQuestKey(key),
      isMonsterRegistered: (type) => enteredProfile.highestRegisteredLevel(type) > 0,
      isCatchQuestDone: (instanceName) => enteredProfile.hasCompletedCatchQuest(instanceName),
    }, entered.state.dungeon.run);

    const moveTo = (roomId: string): void => {
      const floor = runtime.session.state;
      const previous = new Map<string, string | undefined>([[floor.currentRoomId, undefined]]);
      const queue = [floor.currentRoomId];
      while (queue.length > 0 && !previous.has(roomId)) {
        const currentId = queue.shift()!;
        const current = floor.rooms.find((room) => room.id === currentId)!;
        for (const link of current.links) {
          if (previous.has(link.targetRoomId)) continue;
          previous.set(link.targetRoomId, currentId);
          queue.push(link.targetRoomId);
        }
      }
      const path: string[] = [];
      for (let currentId = roomId; currentId !== floor.currentRoomId;) {
        path.push(currentId);
        const priorId = previous.get(currentId);
        if (priorId === undefined) throw new Error(`fixture room ${roomId} is unreachable`);
        currentId = priorId;
      }
      for (const targetId of path.reverse()) {
        const movement = runtime.session.moveToRoom(targetId);
        for (const action of movement.actions) {
          if (action.kind === "encounter") runtime.resolveEncounter(action.encounter, "victory");
        }
      }
    };

    const stairsRoom = runtime.session.state.rooms.find((room) =>
      room.zones.some(({ change }) => change.kind === "stairsDown"));
    if (stairsRoom === undefined) throw new Error("Abyss floor 1 has no stairs down");
    moveTo(stairsRoom.id);
    const stairs = runtime.session.currentRoom.zones.find(
      ({ change }) => change.kind === "stairsDown",
    );
    if (stairs === undefined) throw new Error("fixture did not reach the Abyss stairs");

    const atStairs: OfficialGameStateV1 = {
      ...entered.state,
      location: {
        kind: "dungeon",
        dungeonId: runtime.session.snapshot().definitionId,
        floor: runtime.route.floor,
        roomId: runtime.session.currentRoom.id,
      },
      dungeon: { ...entered.state.dungeon, run: runtime.snapshot() },
    };


    const moved = reduce(atStairs, {
      type: "dungeon.selectRoom",
      roomId: runtime.session.currentRoom.id,
    });
    if (moved.state.profile.schemaVersion !== 8) throw new Error("expected profile schema 8");
    expect(moved.state.profile.infiniteDungeonHighestLevel).toBe(1);
    expect(moved.events.map(({ type }) => type)).not.toContain("dungeon.infiniteFloorEntered");

    const descended = reduce(atStairs, { type: "dungeon.activateZone", zoneId: stairs.id });
    if (descended.state.profile.schemaVersion !== 8) throw new Error("expected profile schema 8");
    expect(descended.state.profile.infiniteDungeonHighestLevel).toBe(2);
    expect(descended.projection.player.infiniteDungeonHighestLevel).toBe(2);
    expect(descended.events).toContainEqual(expect.objectContaining({
      type: "dungeon.infiniteFloorEntered",
      floor: 2,
      previousHighest: 1,
    }));
  });

  it("leaves an ordinary dungeon's entry out of the Abyss property entirely", () => {
    const northCave = firstDungeonEntrance("Dungeon_1.plist");
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const entered = reduce({
      ...created.state,
      location: { kind: "world", worldId: northCave.world.name, poiId: northCave.poi.name },
      world: {
        ...created.state.world!,
        worldId: northCave.world.name,
        currentPoiId: northCave.poi.name,
      },
    }, { type: "world.activateZone", zoneId: northCave.poi.name });
    if (entered.state.profile.schemaVersion !== 8) throw new Error("expected profile schema 8");
    // `Dungeon_1.plist` declares `instanceName: NorthCave`; only `Volcano`/`VolcanoB` are the Abyss.
    expect(entered.state.profile.infiniteDungeonHighestLevel).toBe(0);
    expect(entered.events.map(({ type }) => type))
      .not.toContain("dungeon.infiniteFloorEntered");
  });

  it("commits waypoint discovery and authoritatively materializes travel after cave re-entry", () => {
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const dungeonEntrance = allWorlds.flatMap((candidate) =>
      candidate.pointsOfInterest.map((poi) => ({ world: candidate, poi })))
      .find(({ poi }) =>
        poi.zoneChange?.kind === "dungeon" &&
        poi.zoneChange.dungeonFile === "Dungeon_1.plist");
    if (dungeonEntrance === undefined) throw new Error("fixture has no North Cave entrance");
    const entered = reduce({
      ...created.state,
      location: {
        kind: "world",
        worldId: dungeonEntrance.world.name,
        poiId: dungeonEntrance.poi.name,
      },
      world: {
        ...created.state.world!,
        worldId: dungeonEntrance.world.name,
        currentPoiId: dungeonEntrance.poi.name,
      },
    }, {
      type: "world.activateZone",
      zoneId: dungeonEntrance.poi.name,
    });
    if (entered.state.dungeon === undefined) throw new Error("fixture did not enter North Cave");

    const questRuntime = new GuildQuestRuntime(quests, entered.state.quests);
    const enteredParty = WorldTripParty.fromStateSnapshot(data, entered.state.party);
    const enteredProfile = PlayerProfile.fromStateSnapshot(
      entered.state.profile,
      enteredParty.monsters().map(({ level }) => level),
      enteredParty,
    );
    const runtime = DungeonRuntimeController.restore({
      resources: source,
      monsterTypes: data.allMonsters().map(({ shortType }) => shortType),
      legacyDungeonGenerationSemantics: true,
      isCompletionSet: (key) => questRuntime.hasCompletedFixedEncounter(key),
      isQuestUsable: (key) => questRuntime.canUseQuestKey(key),
      isMonsterRegistered: (type) => enteredProfile.highestRegisteredLevel(type) > 0,
      isCatchQuestDone: (instanceName) => enteredProfile.hasCompletedCatchQuest(instanceName),
    }, entered.state.dungeon.run);

    const moveTo = (roomId: string, includeTarget = true): void => {
      const floor = runtime.session.state;
      const previous = new Map<string, string | undefined>([[floor.currentRoomId, undefined]]);
      const queue = [floor.currentRoomId];
      while (queue.length > 0 && !previous.has(roomId)) {
        const currentId = queue.shift()!;
        const current = floor.rooms.find((room) => room.id === currentId)!;
        for (const link of current.links) {
          if (previous.has(link.targetRoomId)) continue;
          previous.set(link.targetRoomId, currentId);
          queue.push(link.targetRoomId);
        }
      }
      const path: string[] = [];
      for (let currentId = roomId; currentId !== floor.currentRoomId;) {
        path.push(currentId);
        const priorId = previous.get(currentId);
        if (priorId === undefined) throw new Error(`fixture room ${roomId} is unreachable`);
        currentId = priorId;
      }
      const traversed = includeTarget ? path.reverse() : path.reverse().slice(0, -1);
      for (const targetId of traversed) {
        const movement = runtime.session.moveToRoom(targetId);
        for (const action of movement.actions) {
          if (action.kind === "encounter") runtime.resolveEncounter(action.encounter, "victory");
        }
      }
    };

    const stairsRoom = runtime.session.state.rooms.find((room) =>
      room.zones.some(({ change }) => change.kind === "stairsDown"));
    if (stairsRoom === undefined) throw new Error("North Cave floor 1 has no stairs down");
    moveTo(stairsRoom.id);
    const stairs = runtime.session.currentRoom.zones.find(
      ({ change }) => change.kind === "stairsDown",
    );
    if (stairs === undefined) throw new Error("fixture did not reach North Cave stairs");
    runtime.activateZone(stairs.id);
    expect(runtime.route.floor).toBe(2);

    const waypointRoom = runtime.session.state.rooms.find((room) => room.waypoint);
    if (waypointRoom === undefined) throw new Error("North Cave floor 2 has no waypoint");
    if (waypointRoom.encounter !== undefined) {
      runtime.resolveEncounter(waypointRoom.encounter, "victory");
    }
    moveTo(waypointRoom.id, false);
    const beforeDiscovery: OfficialGameStateV1 = {
      ...entered.state,
      location: {
        kind: "dungeon",
        dungeonId: runtime.session.snapshot().definitionId,
        floor: runtime.route.floor,
        roomId: runtime.session.currentRoom.id,
      },
      dungeon: {
        ...entered.state.dungeon,
        run: runtime.snapshot(),
      },
    };
    const discovered = reduce(beforeDiscovery, {
      type: "dungeon.selectRoom",
      roomId: waypointRoom.id,
    });
    if (discovered.state.profile.schemaVersion !== 8) throw new Error("expected profile schema 8");
    expect(discovered.state.profile.dungeonWaypoints?.NorthCave).toEqual([2]);
    expect(discovered.projection.player.dungeonWaypoints?.NorthCave).toEqual([2]);

    const outside: OfficialGameStateV1 = {
      ...discovered.state,
      location: {
        kind: "world",
        worldId: dungeonEntrance.world.name,
        poiId: dungeonEntrance.poi.name,
      },
      world: {
        ...discovered.state.world!,
        worldId: dungeonEntrance.world.name,
        currentPoiId: dungeonEntrance.poi.name,
      },
    };
    const reentered = reduce(outside, {
      type: "world.activateZone",
      zoneId: dungeonEntrance.poi.name,
    });
    if (reentered.state.dungeon === undefined) throw new Error("fixture did not re-enter North Cave");
    expect(reentered.state.dungeon.run.current.route.floor).toBe(1);
    expect(reentered.state.dungeon.run.registeredWaypoints).toContainEqual({
      route: { typeName: "Cave", sourceFile: "Dungeon_1.plist", floor: 2 },
    });

    const withoutCachedWaypoint: OfficialGameStateV1 = {
      ...reentered.state,
      dungeon: {
        ...reentered.state.dungeon,
        run: {
          ...reentered.state.dungeon.run,
          cachedFloors: reentered.state.dungeon.run.cachedFloors.filter(
            ({ route }) => route.floor !== 2,
          ),
        },
      },
    };
    const travelled = reduce(withoutCachedWaypoint, {
      type: "dungeon.travelToWaypoint",
      floor: 2,
    });
    expect(travelled.projection.location).toMatchObject({
      kind: "dungeon",
      floor: 2,
    });
    expect(travelled.projection.dungeon?.run.current.session.registeredWaypointFloors)
      .toEqual([2]);
    expect(travelled.events).toContainEqual(expect.objectContaining({
      type: "dungeon.waypointTravelled",
      floor: 2,
      restoredFromCache: false,
    }));
  });

  it("fails closed when a registered dungeon challenge reaches an unimplemented egg hatch", () => {
    const candidate = allWorlds.flatMap((candidateWorld) =>
      candidateWorld.pointsOfInterest.map((poi) => ({ world: candidateWorld, poi })))
      .map((entry) => {
        const change = entry.poi.zoneChange;
        if (
          change?.kind !== "dungeon" ||
          change.dungeon === undefined ||
          change.dungeonFile === undefined
        ) return undefined;
        return {
          ...entry,
          definition: loadDungeonData(
            source,
            change.dungeon,
            change.dungeonFile,
            change.dungeonLevel ?? 1,
            new Set(data.allMonsters().map(({ shortType }) => shortType)),
          ),
        };
      })
      .find((entry) => entry?.definition.catchQuest !== undefined);
    if (candidate?.definition.catchQuest === undefined) {
      throw new Error("fixture has no dungeon catch challenge");
    }
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const collectionParty = WorldTripParty.fromStateSnapshot(data, created.state.party);
    const collectionProfile = PlayerProfile.fromStateSnapshot(
      created.state.profile,
      collectionParty.monsters().map(({ level }) => level),
      collectionParty,
    );
    for (const type of candidate.definition.catchQuest.types) {
      collectionProfile.recordCapturedMonster(type, 1);
    }
    const entered = reduce({
      ...created.state,
      profile: collectionProfile.stateSnapshot(),
      location: {
        kind: "world",
        worldId: candidate.world.name,
        poiId: candidate.poi.name,
      },
      world: {
        ...created.state.world!,
        worldId: candidate.world.name,
        currentPoiId: candidate.poi.name,
      },
    }, {
      type: "world.activateZone",
      zoneId: candidate.poi.name,
    });
    expect(entered.projection.decision.type).toBe("dungeon.ready");

    expect(() => reduce(entered.state, { type: "dungeon.claimCatchReward" }))
      .toThrow(/destroy-on-pickup.*egg hatch/);
    expect(entered.projection.player.catchQuestsDone)
      .not.toContain(candidate.definition.instanceName);
  });

  it("routes a source dungeon Catch Egg through the v12 aggregate and commits catch completion", () => {
    const candidate = allWorlds.flatMap((candidateWorld) =>
      candidateWorld.pointsOfInterest.map((poi) => ({ world: candidateWorld, poi })))
      .map((entry) => {
        const change = entry.poi.zoneChange;
        if (change?.kind !== "dungeon" || change.dungeon === undefined || change.dungeonFile === undefined) {
          return undefined;
        }
        return {
          ...entry,
          definition: loadDungeonData(
            source,
            change.dungeon,
            change.dungeonFile,
            change.dungeonLevel ?? 1,
            new Set(data.allMonsters().map(({ shortType }) => shortType)),
          ),
        };
      })
      .find((entry) => entry?.definition.catchQuest !== undefined);
    if (candidate?.definition.catchQuest === undefined) {
      throw new Error("fixture has no dungeon catch challenge");
    }
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const collectionParty = WorldTripParty.fromStateSnapshot(data, created.state.party);
    const collectionProfile = PlayerProfile.fromStateSnapshot(
      created.state.profile,
      collectionParty.monsters().map(({ level }) => level),
      collectionParty,
    );
    for (const type of candidate.definition.catchQuest.types) collectionProfile.recordCapturedMonster(type, 1);
    const entered = reduce({
      ...created.state,
      profile: collectionProfile.stateSnapshot(),
      location: { kind: "world", worldId: candidate.world.name, poiId: candidate.poi.name },
      world: {
        ...created.state.world!,
        worldId: candidate.world.name,
        currentPoiId: candidate.poi.name,
      },
    }, { type: "world.activateZone", zoneId: candidate.poi.name });
    const v12State = parseOfficialGameStateV12(data, quests, {
      ...entered.state,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    const result = v12Reducer().apply({
      playerId: "dungeon-catch-route-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: v12State,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "dungeon.claimCatchReward" });
    expect(result.state.pendingEgg).toMatchObject({
      origin: "dungeonCatch",
      remainingRepeats: 1,
      phase: "awaiting-spin",
    });
    expect(result.state.nextContinuationSequence).toBe(2);
    expect(result.projection.player.catchQuestsDone).toContain(candidate.definition.instanceName);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "dungeon.catchRewardClaimed",
      dungeonId: result.state.dungeon?.run.current.session.definitionId,
    }));
  });

  it("routes a guarded dungeon battle Egg only when v16 Take All opens its treasure", () => {
    const authority = minimalOperatorEggContentAuthority({
      battleRewardKey: "v12-battle-egg",
      eggReward: "monsterEgg",
    });
    const fixture = officialDungeonBattleFixture(100, "fixed", authority);
    const encounter = fixture.started.state.battle?.encounter;
    if (encounter?.kind !== "dungeon") throw new Error("fixture has no dungeon battle encounter");
    const treasureId = encounter.encounter.treasure?.id;
    if (treasureId === undefined) throw new Error("fixture has no guarded dungeon treasure");
    const silverReward = encounter.rewards.find((reward) => reward.kind === "silver");
    expect(silverReward).toBeDefined();
    const victory = finishVersionedDungeonBattleVictory(authority, fixture);
    expect(victory.state.pendingEgg).toBeUndefined();
    expect(victory.state.nextContinuationSequence).toBe(1);
    expect(victory.state.quests.receivedBattleRewardKeys).not.toContain("v12-battle-egg");
    expect(victory.state.profile.silver).toBe(fixture.started.state.profile.silver);
    expect(victory.events).not.toContainEqual(expect.objectContaining({
      type: "battle.rewardsGranted",
    }));

    const claimed = applyV16DungeonCommand(
      victory,
      { type: "dungeon.openTreasure", treasureId },
    );
    expect(claimed.state.pendingEgg).toMatchObject({
      origin: "dungeonTreasure",
      remainingRepeats: 1,
      phase: "awaiting-spin",
    });
    expect(claimed.state.nextContinuationSequence).toBe(2);
    expect(claimed.state.quests.receivedBattleRewardKeys).toContain("v12-battle-egg");
    expect(claimed.state.profile.silver).toBe(
      fixture.started.state.profile.silver +
      (silverReward?.kind === "silver" ? silverReward.amount : 0),
    );
    expect(claimed.events).toContainEqual(expect.objectContaining({
      type: "dungeon.treasureClaimed",
      treasureId,
    }));
  });

  it("routes a minimal operator-content dungeon treasure Egg through the v12 aggregate and consumes the treasure", () => {
    const authority = minimalOperatorEggContentAuthority({ treasureReward: "egg" });
    const entrance = firstDungeonEntrance();
    const created = reduceWith(
      authority.reducer,
      undefined,
      { type: "slot.create", starterElement: "Water" },
      authority.pack,
    );
    const outside: OfficialGameStateV1 = {
      ...created.state,
      location: { kind: "world", worldId: entrance.world.name, poiId: entrance.poi.name },
      world: {
        ...created.state.world!,
        worldId: entrance.world.name,
        currentPoiId: entrance.poi.name,
      },
    };
    const entered = reduceWith(
      authority.reducer,
      outside,
      { type: "world.activateZone", zoneId: entrance.poi.name },
      authority.pack,
    );
    if (entered.state.dungeon === undefined) throw new Error("fixture did not enter a dungeon");
    const enteredParty = WorldTripParty.fromStateSnapshot(data, entered.state.party);
    const enteredProfile = PlayerProfile.fromStateSnapshot(
      entered.state.profile,
      enteredParty.monsters().map(({ level }) => level),
      enteredParty,
    );
    const enteredQuests = new GuildQuestRuntime(quests, entered.state.quests);
    const run = DungeonRuntimeController.restore({
      resources: authority.resources,
      monsterTypes: data.allMonsters().map(({ shortType }) => shortType),
      legacyDungeonGenerationSemantics: true,
      isCompletionSet: (key) => enteredQuests.hasCompletedFixedEncounter(key),
      isQuestUsable: (key) => enteredQuests.canUseQuestKey(key),
      isMonsterRegistered: (type) => enteredProfile.highestRegisteredLevel(type) > 0,
      isCatchQuestDone: (instanceName) => enteredProfile.hasCompletedCatchQuest(instanceName),
    }, entered.state.dungeon.run);
    const target = run.session.state.rooms.find((room) =>
      room.encounter?.treasure !== undefined || room.treasure !== undefined);
    if (target === undefined) throw new Error("fixture has no dungeon treasure");
    const previous = new Map<string, string | undefined>([[run.session.currentRoom.id, undefined]]);
    const queue = [run.session.currentRoom.id];
    while (queue.length > 0 && !previous.has(target.id)) {
      const roomId = queue.shift()!;
      const room = run.session.state.rooms.find(({ id }) => id === roomId)!;
      for (const link of room.links) {
        if (previous.has(link.targetRoomId)) continue;
        previous.set(link.targetRoomId, roomId);
        queue.push(link.targetRoomId);
      }
    }
    const path: string[] = [];
    for (let roomId = target.id; roomId !== run.session.currentRoom.id;) {
      path.push(roomId);
      const priorRoomId = previous.get(roomId);
      if (priorRoomId === undefined) throw new Error("fixture dungeon treasure path is unreachable");
      roomId = priorRoomId;
    }
    for (const roomId of path.reverse()) {
      const movement = run.session.moveToRoom(roomId);
      for (const action of movement.actions) {
        if (action.kind === "encounter") run.resolveEncounter(action.encounter, "victory");
      }
    }
    const treasure = run.session.currentRoom.encounter?.treasure ?? run.session.currentRoom.treasure;
    if (treasure === undefined) throw new Error("fixture did not reveal dungeon treasure");
    const ready: OfficialGameStateV1 = {
      ...entered.state,
      location: {
        kind: "dungeon",
        dungeonId: run.session.snapshot().definitionId,
        floor: run.route.floor,
        roomId: run.session.currentRoom.id,
      },
      dungeon: { ...entered.state.dungeon, run: run.snapshot() },
    };
    const initial = parseOfficialGameStateV12(data, quests, {
      ...ready,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: authority.resources });
    if (authority.support === undefined) throw new Error("treasure fixture has no loaded support");
    const support = authority.support;
    const treasureV12Support = createOfficialGameV12Support({ support });
    const v12 = new OfficialGameV12Reducer(authority.reducer, treasureV12Support);
    const result = v12.apply({
      playerId: "dungeon-treasure-route-player",
      slotId: "slot-1",
      pack: createOfficialGameV12LogicPackDescriptor(
        `logic-v1:${"f".repeat(64)}`,
        treasureV12Support,
      ),
      state: initial,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "dungeon.openTreasure", treasureId: treasure.id });
    expect(result.state.pendingEgg).toMatchObject({
      origin: "dungeonTreasure",
      remainingRepeats: 1,
      phase: "awaiting-spin",
    });
    expect(result.state.nextContinuationSequence).toBe(2);
    expect(result.state.dungeon?.run.current.session.collectedTreasureIds).toContain(treasure.id);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "dungeon.treasureClaimed",
      treasureId: treasure.id,
    }));
  });

  it("creates the source starter and economy from player intent, with a server-owned identity", async () => {
    const result = await service().execute(
      "player-a",
      "slot-1",
      envelope("command_create_0001", 0, {
        type: "slot.create",
        starterElement: "Fire",
      }),
    );
    expect(result.projection).toMatchObject({
      revision: 1,
      location: {
        kind: "town",
        worldId: world.name,
        townId: "First_City",
      },
      player: {
        heroLevel: 1,
        silver: 1_000,
        gold: 100,
        captureCards: { 1: 2, 2: 0, 3: 0 },
        battingOrderIds: ["monster-1"],
        party: [{
          instanceId: "monster-1",
          shortType: "RedBabyDragon",
          level: 1,
        }],
      },
    });
    expect(result.events).toContainEqual({
      seq: 2,
      type: "player.monsterAdded",
      instanceId: "monster-1",
      monsterTypeId: "RedBabyDragon",
      level: 1,
      reason: "starter",
    });
  });

  it("owns character skill and Gem inventory mutations in Official town play", () => {
    const initial = partyState();
    const party = WorldTripParty.fromStateSnapshot(data, initial.party);
    const profile = PlayerProfile.fromStateSnapshot(
      initial.profile,
      party.monsters().map(({ level }) => level),
      party,
    );
    profile.increaseLicenseAfterChallenge(data.license("Apprentice"));
    const gem = profile.inventory.addGem({
      definitionPath: "Gems.RandomNovice",
      level: 7,
      quality: 0,
      slot: 0,
      enabledStats: ["Attack"],
    });
    const ready = { ...initial, profile: profile.stateSnapshot() };

    const skilled = reduce(ready, { type: "player.incrementSkill", stat: "Attack" });
    expect(skilled.projection.player.skillPoints?.Attack).toBe(1);
    const equipped = reduce(skilled.state, { type: "player.equipGem", itemId: gem.id });
    expect(equipped.projection.player.inventory?.equippedGems[0]?.id).toBe(gem.id);
    const equippedDrop = reduce(
      equipped.state,
      { type: "player.dropInventoryItem", itemId: gem.id },
    );
    expect(equippedDrop.projection.player.inventory?.equippedGems[0]?.id).toBe(gem.id);
    const unequipped = reduce(
      equippedDrop.state,
      { type: "player.unequipGem", itemId: gem.id },
    );
    expect(unequipped.projection.player.inventory?.looseItems)
      .toContainEqual(expect.objectContaining({ id: gem.id }));
    const dropped = reduce(
      unequipped.state,
      { type: "player.dropInventoryItem", itemId: gem.id },
    );
    expect(dropped.projection.player.inventory?.looseItems)
      .not.toContainEqual(expect.objectContaining({ id: gem.id }));
  });

  it("derives store price, reward identity, and Gem rolls on the server", () => {
    const card = reduce(partyState(), {
      type: "store.purchase",
      stockId: "card-1",
      quantity: 1,
    });
    expect(card.projection.player.silver).toBe(950);
    expect(card.projection.player.captureCards[1]).toBe(3);
    expect(card.events).toContainEqual(expect.objectContaining({
      type: "store.purchased",
      stockId: "card-1",
      quantity: 1,
      currency: "silver",
      spent: 50,
      balance: 950,
      randomDraws: [],
    }));
    const cardEvent = card.events.find((event) => event.type === "store.purchased");
    expect(cardEvent).toEqual(expect.objectContaining({
      receivedItems: [{
        kind: "usable",
        definitionPath: "Usables.Card",
        instanceName: "Card",
        level: 1,
      }],
    }));

    const gem = reduce(card.state, {
      type: "store.purchase",
      stockId: "gem-novice-glow",
      quantity: 1,
    });
    expect(gem.projection.player.silver).toBe(750);
    expect(gem.projection.player.inventory?.looseItems)
      .toContainEqual(expect.objectContaining({
        kind: "gem",
        definitionPath: "Gems.RandomNovice",
        level: 10,
        quality: 1,
        slot: 0,
      }));
    expect(gem.events).toContainEqual(expect.objectContaining({
      type: "store.purchased",
      stockId: "gem-novice-glow",
      randomDraws: expect.any(Array),
      receivedItems: [expect.objectContaining({
        kind: "gem",
        definitionPath: "Gems.RandomNovice",
        level: 10,
        quality: 1,
        slot: 0,
        enabledStats: expect.any(Array),
      })],
    }));
  });

  it("fails closed for an unfunded v11 Store Egg before affordability and preserves the service record", async () => {
    let rngCalls = 0;
    const legacyReducer = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngCalls += 1;
        return 0;
      },
    });
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV1>();
    const authority = new AuthoritativeGameService<OfficialGameStateV1>({
      pack,
      reducer: legacyReducer,
      store,
      validateRecord: (record) => legacyReducer.validatePersistedRecord(record),
    });
    await authority.execute("v11-egg-player", "slot-1", envelope(
      "v11-egg-create-0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    await store.transact("v11-egg-player", "slot-1", async (record) => {
      if (record === undefined) throw new Error("v11 Egg Store record was not created");
      const state = {
        ...record.state,
        profile: { ...record.state.profile, gold: 0 },
      } satisfies OfficialGameStateV1;
      return {
        record: {
          ...record,
          state,
          projection: { ...record.projection, ...legacyReducer.projectPersistedState(state) },
        },
        value: undefined,
      };
    });
    rngCalls = 0;
    const before = await store.read("v11-egg-player", "slot-1");
    if (before === undefined) throw new Error("v11 Egg Store record was not stored");
    const beforeClone = structuredClone(before);
    await expect(authority.execute(
      "v11-egg-player",
      "slot-1",
      envelope(
        "v11-egg-purchase-0001",
        before.revision,
        { type: "store.purchase", stockId: "egg", quantity: 1 },
      ),
    )).rejects.toMatchObject({
      code: "CAPABILITY_UNSUPPORTED",
      message: expect.stringMatching(/Egg|SlotMachine|authoritative/i),
    });
    const after = await store.read("v11-egg-player", "slot-1");
    expect(after).toEqual(beforeClone);
    expect(after?.state.profile.gold).toBe(0);
    expect(after?.state.nextMonsterSequence).toBe(beforeClone.state.nextMonsterSequence);
    expect(after?.state.nextBattleSequence).toBe(beforeClone.state.nextBattleSequence);
    expect(after?.revision).toBe(beforeClone.revision);
    expect(after?.eventCursor).toBe(beforeClone.eventCursor);
    expect(after?.receipts).toEqual(beforeClone.receipts);
    expect(after?.projection).toEqual(beforeClone.projection);
    expect(rngCalls).toBe(0);
  });

  it("resolves spirit totem stock from the Summon set and types every bad stock ID", () => {



    const funded = partyState();
    const totem = reduce(
      { ...funded, profile: { ...funded.profile, gold: 500 } },
      { type: "store.purchase", stockId: "totem-Fire", quantity: 1 },
    );
    expect(totem.projection.player.spirit.savedXp["Fire"]).toBeGreaterThan(0);
    expect(totem.events).toContainEqual(expect.objectContaining({
      type: "store.purchased",
      stockId: "totem-Fire",
      currency: "gold",
      spent: 250,
    }));

    for (const stockId of ["totem-BlueDragon", "totem-Nope", "recipe-Nope", "iap-gold-1", "nope"]) {
      expect(() => reduce(partyState(), { type: "store.purchase", stockId, quantity: 1 }))
        .toThrow(expect.objectContaining({ code: "ENTITY_NOT_FOUND" }));
    }
  });

  it("rejects a forged retreat from a no-retreat battle before RNG or persistence", async () => {
    let rngCalls = 0;
    const v12 = v12Service(() => {
      rngCalls += 1;
      return 0;
    });
    const state = parseOfficialGameStateV12(data, quests, {
      ...sourceArenaActiveBattle(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    });
    const playerId = "forged-arena-retreat-player";
    await installServiceV12State(v12.authority, v12.store, v12.reducer, playerId, state);
    const before = await v12.store.read(playerId, "slot-1");
    if (before === undefined) throw new Error("forged Arena retreat fixture was not stored");
    const decision = before.projection.decision;
    if (decision.type !== "battle.playerTurn") {
      throw new Error("forged Arena retreat fixture has no player decision");
    }
    expect(decision.canRetreat).toBe(false);
    const callsBefore = rngCalls;

    await expect(v12.authority.execute(
      playerId,
      "slot-1",
      envelope(
        "forged-arena-retreat-0001",
        before.revision,
        {
          type: "battle.retreat",
          battleId: decision.battleId,
          actorId: decision.actorId,
        },
        decision.decisionId,
      ),
    )).rejects.toMatchObject({
      code: "ACTION_NOT_ALLOWED",
      message: "retreat is not allowed for this battle",
    });

    const after = await v12.store.read(playerId, "slot-1");
    expect(after).toEqual(before);
    expect(after?.revision).toBe(before.revision);
    expect(after?.receipts).toEqual(before.receipts);
    expect(rngCalls).toBe(callsBefore);
  });

  it("derives and settles license challenges entirely from authoritative Arena state", () => {
    const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
    const arenaTown = arenaWorld.pointsOfInterest.find(
      ({ name }) => name === "Capital_City",
    )!;
    expect(arenaTown.town?.buildings).toContainEqual(expect.objectContaining({
      className: "ArenaMenuItem",
    }));
    const party = new WorldTripParty(data, [
      member("arena-1", "BlueBabyDragon", 100),
      member("arena-2", "BlueBabyDragon", 100),
      member("arena-3", "BlueBabyDragon", 100),
      member("arena-4", "BlueBabyDragon", 100),
      member("arena-5", "BlueBabyDragon", 100),
    ], 5);
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("BlueBabyDragon"),
      heroLevel: 3,
      heroTotalHighestLevels: minimumHeroTotalForLevel(3),
      monsterPartyLevels: [100, 100, 100, 100, 100],
    }, party);
    profile.incrementSkill("Defense");
    const initial: OfficialGameStateV1 = {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: {
        ...emptyGuildQuestStateSnapshot(),
        finishedQuestNames: quests.definitions.slice(0, 5).map(({ name }) => name),
      },
      location: {
        kind: "town",
        worldId: arenaWorld.name,
        townId: arenaTown.name,
      },
      world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
      nextMonsterSequence: 4,
      nextBattleSequence: 1,
    };
    let result = reduce(initial, { type: "arena.startLicenseChallenge" });
    expect(result.state.battle?.origin).toEqual({
      kind: "arena",
      worldId: arenaWorld.name,
      townId: arenaTown.name,
      licenseType: "Apprentice",
    });
    // The historical v11/v12 wire still requires a `backgroundKey` string, but the authority no
    // longer holds a shipped background name to put there, so it emits the semantic scene identity.
    // The installed v13 wire drops the field and sends `scene` instead.
    expect(result.projection.battle).toMatchObject({
      backgroundKey: "scene:arena",
      allowRetreat: false,
    });


    expect(result.projection.battle?.teams[0][0]?.playerBuffs?.Defense).toBe(1.5);
    for (let turn = 0; turn < 1_000 && result.state.location.kind === "battle"; turn += 1) {
      const decision = result.projection.decision;
      if (decision.type !== "battle.playerTurn") {
        throw new Error(`Arena challenge has no player decision at turn ${turn}`);
      }
      const choice = decision.choices.find(({ blockedReasonId }) =>
        blockedReasonId === undefined)!;
      const targetIds = choice.target.kind === "enemies"
        ? decision.enemyTargetIds.slice(0, choice.target.count)
        : choice.target.kind === "friends"
          ? decision.friendlyTargetIds.slice(0, choice.target.count)
          : choice.target.kind === "mixed"
            ? [
                ...decision.enemyTargetIds.slice(0, choice.target.enemyCount),
                ...decision.friendlyTargetIds.slice(0, choice.target.friendlyCount),
              ]
            : [];
      result = reduce(result.state, {
        type: "battle.chooseAbility",
        battleId: decision.battleId,
        actorId: decision.actorId,
        slot: choice.slot,
        targetIds,
      });
    }



    expect(result.projection.location).toEqual({
      kind: "world",
      worldId: arenaWorld.name,
      poiId: arenaTown.name,
    });
    expect(result.projection.player.licenseType).toBe("Apprentice");

    expect(result.projection.player.battingOrderSize).toBe(battingOrderSizeFor(
      data.license("Apprentice").battingOrderSize,
      result.projection.player.heroLevel,
    ));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "victory",
    }));
  });

  it("starts Tournament rounds from server-owned progress and server commit time", () => {
    const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
    const arenaTown = arenaWorld.pointsOfInterest.find(
      ({ name }) => name === "Capital_City",
    )!;
    const party = new WorldTripParty(data, [
      member("tournament-1", "BlueBabyDragon", 100),
      member("tournament-2", "BlueBabyDragon", 100),
      member("tournament-3", "BlueBabyDragon", 100),
    ], 3);
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("BlueBabyDragon"),
      monsterPartyLevels: [100, 100, 100],
    }, party);
    const initial: OfficialGameStateV1 = {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: emptyGuildQuestStateSnapshot(),
      location: { kind: "town", worldId: arenaWorld.name, townId: arenaTown.name },
      world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
      nextMonsterSequence: 4,
      nextBattleSequence: 1,
    };
    const result = reduce(initial, { type: "tournament.startBattle" });
    expect(result.state.battle?.origin).toEqual({
      kind: "tournament",
      worldId: arenaWorld.name,
      townId: arenaTown.name,
      tournamentIndex: 0,
      round: 0,
    });
    expect(result.projection.player.tournament).toMatchObject({
      index: 0,
      round: 0,
      status: 0,
      timeLast: Date.parse("2026-07-29T00:00:00.000Z") / 1_000,
    });
    expect(result.events).toContainEqual({
      type: "tournament.battleStarted",
      tournamentIndex: 0,
      round: 0,
    });
    expect(() => reduce({
      ...initial,
      profile: result.state.profile,
    }, { type: "tournament.startBattle" })).toThrow(/cooldown/i);
  });

  it("starts Tournament rounds through the installed v17 and pending v18 validators", () => {
    const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
    const arenaTown = arenaWorld.pointsOfInterest.find(
      ({ name }) => name === "Capital_City",
    )!;
    const party = new WorldTripParty(data, [
      member("tournament-v17-1", "BlueBabyDragon", 100),
      member("tournament-v17-2", "BlueBabyDragon", 100),
      member("tournament-v17-3", "BlueBabyDragon", 100),
    ], 3);
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("BlueBabyDragon"),
      monsterPartyLevels: [100, 100, 100],
    }, party);
    const legacy: OfficialGameStateV1 = {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: emptyGuildQuestStateSnapshot(),
      location: { kind: "town", worldId: arenaWorld.name, townId: arenaTown.name },
      world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
      nextMonsterSequence: 4,
      nextBattleSequence: 1,
    };
    const context = { dungeonResources: source } as const;
    const v12 = parseOfficialGameStateV12(data, quests, {
      ...legacy,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, context);
    const v13 = migrateOfficialGameV12ToV13({ data, quests, state: v12, context });
    const v14 = migrateOfficialGameV13ToV14({ data, quests, state: v13, context });
    const v15 = migrateOfficialGameV14ToV15({
      data,
      quests,
      state: v14,
      updatedAt: "2026-08-12T00:00:00.000Z",
      context,
    });
    const v16 = migrateOfficialGameV15ToV16({ data, quests, state: v15, context });
    const initial = migrateOfficialGameV16ToV17({ data, quests, state: v16, context });
    const installed = v17Reducer();
    const result = installed.apply({
      playerId: "tournament-v17-player",
      slotId: "slot-1",
      pack: completeV17Pack,
      state: initial,
      previousRevision: 1,
      now: "2026-08-12T00:00:00.123Z",
    }, { type: "tournament.startBattle" });
    const projection = OfficialGameProjectionV17Schema.parse({
      ...result.projection,
      slotId: "slot-1",
      revision: 2,
      updatedAt: "2026-08-12T00:00:00.000Z",
      logicPackId: completeV17Pack.logicPackId,
      simulationVersion: completeV17Pack.simulationVersion,
      trustTier: "official",
    });

    expect(result.state.battle?.origin).toMatchObject({ kind: "tournament", round: 0 });
    expect(result.projection.player.tournament?.timeLast).toBe(
      Date.parse("2026-08-12T00:00:00.000Z") / 1_000,
    );
    expect(() => installed.validatePersistedRecord({ state: result.state, projection })).not.toThrow();

    const initialV18 = migrateOfficialGameV17ToV18({
      data,
      quests,
      state: initial,
      context,
    });
    const installedV18 = v18Reducer();
    const resultV18 = installedV18.apply({
      playerId: "tournament-v18-player",
      slotId: "slot-1",
      pack: completeV18Pack,
      state: initialV18,
      previousRevision: 1,
      now: "2026-08-12T00:00:00.987Z",
    }, { type: "tournament.startBattle" });
    const projectionV18 = OfficialGameProjectionV18Schema.parse({
      ...resultV18.projection,
      slotId: "slot-1",
      revision: 2,
      updatedAt: "2026-08-12T00:00:00.987Z",
      logicPackId: completeV18Pack.logicPackId,
      simulationVersion: completeV18Pack.simulationVersion,
      trustTier: "official",
    });

    expect(resultV18.projection.player.tournament?.timeLast).toBe(
      Date.parse("2026-08-12T00:00:00.000Z") / 1_000,
    );
    expect(() => installedV18.validatePersistedRecord({
      state: resultV18.state,
      projection: projectionV18,
    })).not.toThrow();
  });

  it("v19 settles a replayed Utility.Escape as a Tournament retreat without progress or timeLast writes", async () => {
    const tournamentWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
    const tournamentTown = tournamentWorld.pointsOfInterest.find(
      ({ name }) => name === "Capital_City",
    )!;
    const party = new WorldTripParty(data, [
      member("tournament-escape-1", "Cockatrice", 100),
      member("tournament-escape-2", "Cockatrice", 100),
      member("tournament-escape-3", "Cockatrice", 100),
    ], 3);
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("Cockatrice"),
      monsterPartyLevels: [100, 100, 100],
      spiritReadiness: 1,
    }, party);
    const legacy: OfficialGameStateV1 = {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: emptyGuildQuestStateSnapshot(),
      location: { kind: "town", worldId: tournamentWorld.name, townId: tournamentTown.name },
      world: createInitialOfficialWorldState(tournamentWorld, tournamentTown.name),
      nextMonsterSequence: 4,
      nextBattleSequence: 1,
    };
    const context = { dungeonResources: source } as const;
    const v12 = parseOfficialGameStateV12(data, quests, {
      ...legacy,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, context);
    const v13 = migrateOfficialGameV12ToV13({ data, quests, state: v12, context });
    const v14 = migrateOfficialGameV13ToV14({ data, quests, state: v13, context });
    const v15 = migrateOfficialGameV14ToV15({
      data, quests, state: v14, updatedAt: "2026-08-12T00:00:00.000Z", context,
    });
    const v16 = migrateOfficialGameV15ToV16({ data, quests, state: v15, context });
    const v17 = migrateOfficialGameV16ToV17({ data, quests, state: v16, context });
    const v18Initial = migrateOfficialGameV17ToV18({ data, quests, state: v17, context });
    const v19Initial = migrateOfficialGameV18ToV19({
      data, quests, state: v18Initial, context,
    });

    const v19 = v19Reducer();
    let v19Result = v19.apply({
      playerId: "tournament-escape-v19",
      slotId: "slot-1",
      pack: completeV19Pack,
      state: v19Initial,
      previousRevision: 1,
      now: "2026-08-12T00:00:00.000Z",
    }, { type: "tournament.startBattle" });
    const tournamentProfile = (state: OfficialGameStateV19): Extract<
      typeof state.profile,
      { readonly tournament: unknown }
    > => {
      if (!("tournament" in state.profile)) {
        throw new Error("Tournament Escape fixture did not restore a schema-8 tournament profile");
      }
      return state.profile as Extract<typeof state.profile, { readonly tournament: unknown }>;
    };
    const tournamentBeforeEscape = structuredClone(tournamentProfile(v19Result.state).tournament);
    let escaped = false;
    for (let turn = 0; turn < 200 && !escaped; turn += 1) {
      const decision = v19Result.projection.decision;
      if (decision.type !== "battle.playerTurn") {
        throw new Error(`Tournament Escape fixture has no player turn at ${turn}`);
      }
      const escape = decision.choices.find((choice) => choice.abilityId === "Utility.Escape");
      const command = escape === undefined
        ? {
            type: "battle.delay" as const,
            battleId: decision.battleId,
            actorId: decision.actorId,
          }
        : {
            type: "battle.chooseAbility" as const,
            battleId: decision.battleId,
            actorId: decision.actorId,
            slot: escape.slot,
            targetIds: [],
          };
      if (escape !== undefined) {
        const replayBeforeForgedRetreat = structuredClone(v19Result.state.battle?.replay);
        expect(() => v19.apply({
          playerId: "tournament-escape-v19",
          slotId: "slot-1",
          pack: completeV19Pack,
          state: v19Result.state,
          previousRevision: 2,
          now: "2026-08-12T00:00:01.000Z",
        }, {
          type: "battle.retreat",
          battleId: decision.battleId,
          actorId: decision.actorId,
        })).toThrow(/retreat is not allowed/i);
        expect(v19Result.state.battle?.replay).toEqual(replayBeforeForgedRetreat);
      }
      v19Result = v19.apply({
        playerId: "tournament-escape-v19",
        slotId: "slot-1",
        pack: completeV19Pack,
        state: v19Result.state,
        previousRevision: 2,
        now: "2026-08-12T00:00:02.000Z",
      }, command);
      escaped = v19Result.state.location.kind === "town";
    }
    expect(escaped).toBe(true);
    expect(v19Result.state.battle).toBeUndefined();
    expect(v19Result.state.location).toEqual({
      kind: "town",
      worldId: tournamentWorld.name,
      townId: tournamentTown.name,
    });
    expect(tournamentProfile(v19Result.state).tournament).toEqual(tournamentBeforeEscape);
    expect(v19Result.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "retreat",
    }));
    expect(v19Result.events.some((event) => event.type === "tournament.progressed")).toBe(false);

    // v18 receives the same replay-derived Utility.Escape but retains the historical fail-closed
    // terminal branch; this is an explicit regression guard, not a command-shape shortcut.
    const v18 = v18Reducer();
    let v18Result = v18.apply({
      playerId: "tournament-escape-v18",
      slotId: "slot-1",
      pack: completeV18Pack,
      state: v18Initial,
      previousRevision: 1,
      now: "2026-08-12T00:00:00.000Z",
    }, { type: "tournament.startBattle" });
    for (let turn = 0; turn < 200; turn += 1) {
      const decision = v18Result.projection.decision;
      if (decision.type !== "battle.playerTurn") {
        throw new Error(`v18 Tournament Escape fixture has no player turn at ${turn}`);
      }
      const escape = decision.choices.find((choice) => choice.abilityId === "Utility.Escape");
      if (escape !== undefined) {
        expect(() => v18.apply({
          playerId: "tournament-escape-v18",
          slotId: "slot-1",
          pack: completeV18Pack,
          state: v18Result.state,
          previousRevision: 2,
          now: "2026-08-12T00:00:02.000Z",
        }, {
          type: "battle.chooseAbility",
          battleId: decision.battleId,
          actorId: decision.actorId,
          slot: escape.slot,
          targetIds: [],
        })).toThrow(/Tournament battle cannot retreat/i);
        break;
      }
      v18Result = v18.apply({
        playerId: "tournament-escape-v18",
        slotId: "slot-1",
        pack: completeV18Pack,
        state: v18Result.state,
        previousRevision: 2,
        now: "2026-08-12T00:00:02.000Z",
      }, {
        type: "battle.delay",
        battleId: decision.battleId,
        actorId: decision.actorId,
      });
    }

    // Exercise the same path through the authoritative command loop. A pure reducer proof cannot
    // establish receipt replay, serialized retries, or restart/readback of the committed retreat.
    const servicePlayer = "tournament-escape-v19-service";
    const serviceSlot = "slot-1" as const;
    const serviceStore = new InMemoryAuthoritativeSlotStore<
      OfficialGameStateV19,
      OfficialGameProjectionBodyV19
    >();
    const serviceReducer = v19Reducer();
    const serviceNow = Date.parse("2026-08-12T00:00:00.000Z");
    const serviceUpdatedAt = new Date(serviceNow).toISOString();
    const serviceProjection = OfficialGameProjectionV19Schema.parse({
      slotId: serviceSlot,
      revision: 1,
      updatedAt: serviceUpdatedAt,
      logicPackId: completeV19Pack.logicPackId,
      simulationVersion: completeV19Pack.simulationVersion,
      trustTier: "official",
      ...serviceReducer.projectPersistedState(v19Initial),
    });
    await serviceStore.transact(servicePlayer, serviceSlot, async (record) => {
      if (record !== undefined) throw new Error("service Tournament Escape seed already exists");
      return {
        record: {
          playerId: servicePlayer,
          slotId: serviceSlot,
          logicPackId: completeV19Pack.logicPackId,
          simulationVersion: completeV19Pack.simulationVersion,
          revision: 1,
          eventCursor: 0,
          updatedAt: serviceUpdatedAt,
          state: v19Initial,
          projection: serviceProjection,
          receipts: new Map(),
        },
        value: undefined,
      };
    });
    const authority = new AuthoritativeGameService<
      OfficialGameStateV19,
      OfficialGameProjectionBodyV19
    >({
      pack: completeV19Pack,
      reducer: serviceReducer,
      store: serviceStore,
      now: () => serviceNow,
      validateRecord: (record) => serviceReducer.validatePersistedRecord(record),
    });
    const startCommand = envelope(
      "tournament-escape-service-start-0001",
      1,
      { type: "tournament.startBattle" },
    );
    const started = await authority.execute(servicePlayer, serviceSlot, startCommand);
    expect(started.idempotentReplay).toBe(false);
    expect(started.projection.player.tournament?.timeLast).toBe(serviceNow / 1_000);
    const startedAgain = await authority.execute(servicePlayer, serviceSlot, startCommand);
    expect(startedAgain.idempotentReplay).toBe(true);
    expect(startedAgain.projection).toEqual(started.projection);
    expect(startedAgain.events).toEqual(started.events);

    let serviceResult = started;
    let escapeCommand: GameCommandEnvelopeV1 | undefined;
    for (let turn = 0; turn < 200; turn += 1) {
      const decision = serviceResult.projection.decision;
      if (decision.type !== "battle.playerTurn") {
        throw new Error(`service Tournament Escape fixture has no player turn at ${turn}`);
      }
      const escape = decision.choices.find((choice) => choice.abilityId === "Utility.Escape");
      const currentRevision = serviceResult.projection.revision;
      const command = escape === undefined
        ? {
            type: "battle.delay" as const,
            battleId: decision.battleId,
            actorId: decision.actorId,
          }
        : {
            type: "battle.chooseAbility" as const,
            battleId: decision.battleId,
            actorId: decision.actorId,
            slot: escape.slot,
            targetIds: [],
          };
      const nextCommand = envelope(
        `tournament-escape-service-turn-${turn.toString().padStart(3, "0")}`,
        currentRevision,
        command,
        decision.decisionId,
      );
      if (escape !== undefined) {
        escapeCommand = nextCommand;
        const beforeForgedRetreat = structuredClone(await serviceStore.read(servicePlayer, serviceSlot));
        if (beforeForgedRetreat === undefined) throw new Error("service Tournament Escape record disappeared");
        await expect(authority.execute(servicePlayer, serviceSlot, envelope(
          "tournament-escape-service-forged-retreat-0001",
          currentRevision,
          {
            type: "battle.retreat",
            battleId: decision.battleId,
            actorId: decision.actorId,
          },
          decision.decisionId,
        ))).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
        expect(await serviceStore.read(servicePlayer, serviceSlot)).toEqual(beforeForgedRetreat);
      }
      serviceResult = await authority.execute(servicePlayer, serviceSlot, nextCommand);
      if (escape !== undefined) break;
    }
    if (escapeCommand === undefined) throw new Error("service Tournament Escape never exposed Utility.Escape");
    expect(serviceResult.projection.location).toEqual({
      kind: "town",
      worldId: tournamentWorld.name,
      townId: tournamentTown.name,
    });
    expect(serviceResult.projection.battle).toBeUndefined();
    expect(serviceResult.projection.player.tournament)
      .toEqual(started.projection.player.tournament);
    expect(serviceResult.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "retreat",
    }));
    expect(serviceResult.events.some((event) => event.type === "tournament.progressed")).toBe(false);
    const serviceEscapeReplay = await authority.execute(servicePlayer, serviceSlot, escapeCommand);
    expect(serviceEscapeReplay.idempotentReplay).toBe(true);
    expect(serviceEscapeReplay.projection).toEqual(serviceResult.projection);

    const restartedAuthority = new AuthoritativeGameService<
      OfficialGameStateV19,
      OfficialGameProjectionBodyV19
    >({
      pack: completeV19Pack,
      reducer: serviceReducer,
      store: serviceStore,
      now: () => serviceNow,
      validateRecord: (record) => serviceReducer.validatePersistedRecord(record),
    });
    expect(await restartedAuthority.bootstrap(servicePlayer, serviceSlot))
      .toEqual(serviceResult.projection);
    const restartedEscapeReplay = await restartedAuthority.execute(
      servicePlayer,
      serviceSlot,
      escapeCommand,
    );
    expect(restartedEscapeReplay.idempotentReplay).toBe(true);
    const beforeCooldown = await serviceStore.read(servicePlayer, serviceSlot);
    if (beforeCooldown === undefined) throw new Error("service Tournament Escape record was not readable after restart");
    await expect(restartedAuthority.execute(servicePlayer, serviceSlot, envelope(
      "tournament-escape-service-immediate-start-0001",
      beforeCooldown.revision,
      { type: "tournament.startBattle" },
    ))).rejects.toMatchObject({
      code: "ACTION_NOT_ALLOWED",
      message: expect.stringMatching(/cooldown/i),
    });
    expect(await serviceStore.read(servicePlayer, serviceSlot)).toEqual(beforeCooldown);
  });

  it("v21 commits Arena Escape recovery without loss, town entry, or a permanently stuck slot", async () => {
    const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
    const arenaTown = arenaWorld.pointsOfInterest.find(
      ({ name }) => name === "Capital_City",
    )!;
    const party = new WorldTripParty(data, [
      member("arena-escape-1", "Cockatrice", 100),
      member("arena-escape-2", "Cockatrice", 100),
      member("arena-escape-3", "Cockatrice", 100),
    ], 5);
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("Cockatrice"),
      heroLevel: 3,
      heroTotalHighestLevels: minimumHeroTotalForLevel(3),
      monsterPartyLevels: [100, 100, 100],
      spiritReadiness: 1,
    }, party);
    const legacy: OfficialGameStateV1 = {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: {
        ...emptyGuildQuestStateSnapshot(),
        finishedQuestNames: quests.definitions.slice(0, 5).map(({ name }) => name),
      },
      location: { kind: "town", worldId: arenaWorld.name, townId: arenaTown.name },
      world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
      nextMonsterSequence: 4,
      nextBattleSequence: 1,
    };
    const parseContext = { dungeonResources: source } as const;
    const v12 = parseOfficialGameStateV12(data, quests, {
      ...legacy,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, parseContext);
    const v13 = migrateOfficialGameV12ToV13({ data, quests, state: v12, context: parseContext });
    const v14 = migrateOfficialGameV13ToV14({ data, quests, state: v13, context: parseContext });
    const v15 = migrateOfficialGameV14ToV15({
      data, quests, state: v14, updatedAt: "2026-08-14T00:00:00.000Z", context: parseContext,
    });
    const v16 = migrateOfficialGameV15ToV16({ data, quests, state: v15, context: parseContext });
    const v17 = migrateOfficialGameV16ToV17({ data, quests, state: v16, context: parseContext });
    const v18 = migrateOfficialGameV17ToV18({ data, quests, state: v17, context: parseContext });
    const v19 = migrateOfficialGameV18ToV19({ data, quests, state: v18, context: parseContext });
    const v20 = migrateOfficialGameV19ToV20({ data, quests, state: v19, context: parseContext });
    const initial = migrateOfficialGameV20ToV21({
      data, quests, state: v20, context: parseContext,
    });
    expect(initial).toEqual(v20);
    expect(initial).not.toBe(v20);
    expect(parseOfficialGameStateV21(data, quests, initial, parseContext)).toEqual(initial);

    const reducer = v21Reducer();
    const store = new InMemoryAuthoritativeSlotStore<
      OfficialGameStateV21,
      OfficialGameProjectionBodyV21
    >();
    const playerId = "arena-escape-v21-service";
    const slotId = "slot-1" as const;
    const nowMs = Date.parse("2026-08-14T00:00:00.000Z");
    const initialProjection = OfficialGameProjectionV21Schema.parse({
      slotId,
      revision: 1,
      updatedAt: new Date(nowMs).toISOString(),
      logicPackId: completeV21Pack.logicPackId,
      simulationVersion: OFFICIAL_GAME_V21_SIMULATION_VERSION,
      trustTier: "official",
      ...reducer.projectPersistedState(initial),
    });
    await store.transact(playerId, slotId, async (current) => {
      if (current !== undefined) throw new Error("v21 Arena Escape seed already exists");
      return {
        record: {
          playerId,
          slotId,
          logicPackId: completeV21Pack.logicPackId,
          simulationVersion: completeV21Pack.simulationVersion,
          revision: 1,
          eventCursor: 0,
          updatedAt: new Date(nowMs).toISOString(),
          state: initial,
          projection: initialProjection,
          receipts: new Map(),
        },
        value: undefined,
      };
    });
    const makeAuthority = () => new AuthoritativeGameService<
      OfficialGameStateV21,
      OfficialGameProjectionBodyV21
    >({
      pack: completeV21Pack,
      store,
      reducer,
      now: () => nowMs,
      validateRecord: (record) => reducer.validatePersistedRecord(record),
    });
    const authority = makeAuthority();
    let result = await authority.execute(playerId, slotId, envelope(
      "arena-escape-v21-start-0001",
      1,
      { type: "arena.startLicenseChallenge" },
    ));
    const startedBattle = result.projection.battle;
    if (startedBattle === undefined) throw new Error("v21 Arena Escape did not start a battle");
    const licenseBefore = result.projection.player.licenseType;
    const recordAfterStart = await store.read(playerId, slotId);
    if (recordAfterStart?.state.world === undefined) {
      throw new Error("v21 Arena Escape lost its source world state");
    }
    const worldBefore = structuredClone(recordAfterStart.state.world);
    const partyBefore = structuredClone(recordAfterStart.state.party);
    let escapeEnvelope: GameCommandEnvelopeV1 | undefined;
    for (let turn = 0; turn < 200 && result.projection.location.kind === "battle"; turn += 1) {
      const decision = result.projection.decision;
      if (decision.type !== "battle.playerTurn") {
        throw new Error(`v21 Arena Escape has no player decision at ${turn}`);
      }
      const escape = decision.choices.find(({ abilityId }) => abilityId === "Utility.Escape");
      const command = escape === undefined
        ? { type: "battle.delay" as const, battleId: decision.battleId, actorId: decision.actorId }
        : {
            type: "battle.chooseAbility" as const,
            battleId: decision.battleId,
            actorId: decision.actorId,
            slot: escape.slot,
            targetIds: [],
          };
      const commandEnvelope = envelope(
        `arena-escape-v21-turn-${String(turn).padStart(4, "0")}`,
        result.revision,
        command,
        decision.decisionId,
      );
      if (escape !== undefined) {
        const beforeForged = await store.read(playerId, slotId);
        await expect(authority.execute(playerId, slotId, envelope(
          "arena-escape-v21-forged-retreat-0001",
          result.revision,
          { type: "battle.retreat", battleId: decision.battleId, actorId: decision.actorId },
          decision.decisionId,
        ))).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
        expect(await store.read(playerId, slotId)).toEqual(beforeForged);
        escapeEnvelope = commandEnvelope;
      }
      result = await authority.execute(playerId, slotId, commandEnvelope);
    }
    if (escapeEnvelope === undefined) throw new Error("v21 Arena Escape never exposed Utility.Escape");
    expect(result.projection.location).toEqual({
      kind: "town",
      worldId: arenaWorld.name,
      townId: arenaTown.name,
    });
    expect(result.projection.battle).toBeUndefined();
    expect(result.projection.player.licenseType).toBe(licenseBefore);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      battleId: startedBattle.battleId,
      outcome: "retreat",
    }));
    expect(result.events.some((event) =>
      event.type === "world.arrived" || event.type === "tournament.progressed")).toBe(false);
    const committed = await store.read(playerId, slotId);
    if (committed === undefined) throw new Error("v21 Arena Escape record disappeared");
    expect(committed.state.world).toEqual(worldBefore);
    expect(committed.state.party).toEqual(partyBefore);
    expect(committed.state.battle).toBeUndefined();
    expect(committed.state.pendingDefeat).toBeUndefined();

    const replay = await authority.execute(playerId, slotId, escapeEnvelope);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.projection).toEqual(result.projection);
    const restarted = makeAuthority();
    expect(await restarted.bootstrap(playerId, slotId)).toEqual(result.projection);
    expect((await restarted.execute(playerId, slotId, escapeEnvelope)).idempotentReplay).toBe(true);
    expect(() => OfficialGameCommandResultV21Schema.parse(result)).not.toThrow();

    // v20 remains immutable and rejects the identical replay-derived terminal.
    const historical = v20Reducer();
    let historicalResult = historical.apply({
      playerId: "arena-escape-v20",
      slotId,
      pack: completeV20Pack,
      state: v20,
      previousRevision: 1,
      now: "2026-08-14T00:00:00.000Z",
    }, { type: "arena.startLicenseChallenge" });
    let historicalRejectedEscape = false;
    for (let turn = 0; turn < 200; turn += 1) {
      const decision = historicalResult.projection.decision;
      if (decision.type !== "battle.playerTurn") break;
      const escape = decision.choices.find(({ abilityId }) => abilityId === "Utility.Escape");
      if (escape !== undefined) {
        expect(() => historical.apply({
          playerId: "arena-escape-v20",
          slotId,
          pack: completeV20Pack,
          state: historicalResult.state,
          previousRevision: 2,
          now: "2026-08-14T00:00:01.000Z",
        }, {
          type: "battle.chooseAbility",
          battleId: decision.battleId,
          actorId: decision.actorId,
          slot: escape.slot,
          targetIds: [],
        })).toThrow(/Arena battle cannot retreat/i);
        historicalRejectedEscape = true;
        break;
      }
      historicalResult = historical.apply({
        playerId: "arena-escape-v20",
        slotId,
        pack: completeV20Pack,
        state: historicalResult.state,
        previousRevision: 2,
        now: "2026-08-14T00:00:01.000Z",
      }, { type: "battle.delay", battleId: decision.battleId, actorId: decision.actorId });
    }
    expect(historicalRejectedEscape).toBe(true);
  });

  it("v20 settles Tournament Save Me through town without replacing the battle or progressing the bracket", () => {
    const initialV19 = tournamentSaveMeV19State();
    const migrated = migrateOfficialGameV19ToV20({
      data,
      quests,
      state: initialV19,
      context: { dungeonResources: source },
    });
    expect(migrated).toEqual(initialV19);
    expect(migrated).not.toBe(initialV19);

    const reducer = v20Reducer();
    const started = reducer.apply({
      playerId: "tournament-save-me-v20",
      slotId: "slot-1",
      pack: completeV20Pack,
      state: migrated,
      previousRevision: 1,
      now: "2026-08-13T00:00:00.000Z",
    }, { type: "tournament.startBattle" });
    const battle = started.state.battle;
    if (battle === undefined || started.state.pendingDefeat === undefined) {
      throw new Error("v20 Tournament Save Me fixture did not produce a terminal defeat");
    }
    const tournamentBefore = "tournament" in started.state.profile
      ? structuredClone(started.state.profile.tournament)
      : undefined;
    if (tournamentBefore === undefined || started.state.world === undefined) {
      throw new Error("v20 Tournament Save Me fixture lost its tournament/world state");
    }
    const dayBefore = started.state.world.dayNumber;
    const nextBattleBefore = started.state.nextBattleSequence;

    const saved = reducer.apply({
      playerId: "tournament-save-me-v20",
      slotId: "slot-1",
      pack: completeV20Pack,
      state: started.state,
      previousRevision: 2,
      now: "2026-08-13T00:00:01.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: battle.battleId,
      recovery: "saveMe",
    });

    expect(saved.state.location).toEqual({
      kind: "town",
      worldId: battle.origin.kind === "tournament" ? battle.origin.worldId : "",
      townId: battle.origin.kind === "tournament" ? battle.origin.townId : "",
    });
    expect(saved.state.battle).toBeUndefined();
    expect(saved.state.pendingDefeat).toBeUndefined();
    expect(saved.state.dungeon).toBeUndefined();
    expect(saved.state.nextBattleSequence).toBe(nextBattleBefore);
    expect("tournament" in saved.state.profile ? saved.state.profile.tournament : undefined)
      .toEqual(tournamentBefore);
    expect(saved.state.profile.gold).toBe(0);
    const recoveredParty = WorldTripParty.fromStateSnapshot(data, saved.state.party);
    expect(recoveredParty.monsters().every((monster) =>
      monster.currentHp === recoveredParty.maxHpOf(monster.instanceId) &&
      monster.injureTime === undefined && monster.healTime === undefined)).toBe(true);
    expect(saved.events.filter((event) =>
      event.type === "player.currencyChanged" && event.currency === "gold" && event.delta === -100,
    )).toHaveLength(1);
    expect(saved.events.some((event) => event.type === "tournament.progressed")).toBe(false);
    expect(saved.events.some((event) => event.type === "battle.started")).toBe(false);
    expect(saved.events.some((event) => event.type === "battle.ended")).toBe(false);
    expect(saved.state.world).toMatchObject({
      currentPoiId: battle.origin.kind === "tournament" ? battle.origin.townId : "",
      lastTownId: battle.origin.kind === "tournament" ? battle.origin.townId : "",
      dayNumber: dayBefore + 1,
    });
    expect(saved.state.world?.visitedTownIds).toContain(
      battle.origin.kind === "tournament" ? battle.origin.townId : "",
    );
    expect(() => reducer.validatePersistedRecord({
      state: saved.state,
      projection: {
        slotId: "slot-1",
        revision: 3,
        updatedAt: "2026-08-13T00:00:01.000Z",
        logicPackId: completeV20Pack.logicPackId,
        simulationVersion: OFFICIAL_GAME_V20_SIMULATION_VERSION,
        trustTier: "official",
        ...saved.projection,
      },
    })).not.toThrow();
    expect(() => reducer.apply({
      playerId: "tournament-save-me-v20",
      slotId: "slot-1",
      pack: completeV20Pack,
      state: saved.state,
      previousRevision: 3,
      now: "2026-08-13T00:00:02.000Z",
    }, { type: "tournament.startBattle" })).toThrow(/cooldown/i);
  });

  it("keeps v19 Tournament Save Me's historical replacement-battle behavior", () => {
    const initial = tournamentSaveMeV19State();
    const reducer = v19Reducer();
    const started = reducer.apply({
      playerId: "tournament-save-me-v19",
      slotId: "slot-1",
      pack: completeV19Pack,
      state: initial,
      previousRevision: 1,
      now: "2026-08-13T00:00:00.000Z",
    }, { type: "tournament.startBattle" });
    const lostBattle = started.state.battle;
    if (lostBattle === undefined || started.state.pendingDefeat === undefined) {
      throw new Error("v19 Tournament Save Me fixture did not produce a terminal defeat");
    }
    const saved = reducer.apply({
      playerId: "tournament-save-me-v19",
      slotId: "slot-1",
      pack: completeV19Pack,
      state: started.state,
      previousRevision: 2,
      now: "2026-08-13T00:00:01.000Z",
    }, {
      type: "battle.resolveDefeat",
      battleId: lostBattle.battleId,
      recovery: "saveMe",
    });
    expect(saved.state.location.kind).toBe("battle");
    expect(saved.state.battle?.battleId).not.toBe(lostBattle.battleId);
    expect(saved.state.battle?.origin).toEqual(lostBattle.origin);
    expect(saved.state.pendingDefeat).toMatchObject({
      battleId: saved.state.battle?.battleId,
      canSaveMe: true,
    });
    expect(saved.state.profile.gold).toBe(0);
    expect(saved.events).toContainEqual(expect.objectContaining({
      type: "battle.started",
      battleId: saved.state.battle?.battleId,
    }));
    expect(saved.events.some((event) => event.type === "tournament.progressed")).toBe(false);
  });

  it("v20 Tournament Save Me is idempotent across a lost response and service restart", async () => {
    const initial = tournamentSaveMeV19State();
    const reducer = v20Reducer();
    const store = new InMemoryAuthoritativeSlotStore<
      OfficialGameStateV20,
      OfficialGameProjectionBodyV20
    >();
    const playerId = "tournament-save-me-v20-service";
    const slotId = "slot-1" as const;
    const nowMs = Date.parse("2026-08-13T00:00:00.000Z");
    const projection = OfficialGameProjectionV20Schema.parse({
      slotId,
      revision: 1,
      updatedAt: new Date(nowMs).toISOString(),
      logicPackId: completeV20Pack.logicPackId,
      simulationVersion: OFFICIAL_GAME_V20_SIMULATION_VERSION,
      trustTier: "official",
      ...reducer.projectPersistedState(initial),
    });
    await store.transact(playerId, slotId, async (current) => {
      if (current !== undefined) throw new Error("v20 Save Me service seed already exists");
      return {
        record: {
          playerId,
          slotId,
          logicPackId: completeV20Pack.logicPackId,
          simulationVersion: completeV20Pack.simulationVersion,
          revision: 1,
          eventCursor: 0,
          updatedAt: new Date(nowMs).toISOString(),
          state: initial,
          projection,
          receipts: new Map(),
        },
        value: undefined,
      };
    });
    const makeAuthority = () => new AuthoritativeGameService<
      OfficialGameStateV20,
      OfficialGameProjectionBodyV20
    >({
      pack: completeV20Pack,
      store,
      reducer,
      now: () => nowMs,
      validateRecord: (record) => reducer.validatePersistedRecord(record),
    });
    const authority = makeAuthority();
    const started = await authority.execute(playerId, slotId, envelope(
      "v20-save-me-service-start-0001",
      1,
      { type: "tournament.startBattle" },
    ));
    expect(started.projection.decision.type).toBe("battle.defeatRecovery");
    if (started.projection.pendingDefeat === undefined) {
      throw new Error("v20 Save Me service did not persist its defeat offer");
    }
    const saveCommand = envelope(
      "v20-save-me-service-save-0001",
      started.revision,
      {
        type: "battle.resolveDefeat",
        battleId: started.projection.pendingDefeat.battleId,
        recovery: "saveMe",
      },
      started.projection.pendingDefeat.decisionId,
    );
    const saved = await authority.execute(playerId, slotId, saveCommand);
    expect(saved.idempotentReplay).toBe(false);
    expect(saved.projection.location.kind).toBe("town");
    expect(saved.projection.battle).toBeUndefined();
    expect(saved.projection.pendingDefeat).toBeUndefined();
    expect(saved.projection.player.gold).toBe(0);

    // Model a response lost after commit: the same command is retried against the live service,
    // then against a freshly constructed service over the same store.
    const replay = await authority.execute(playerId, slotId, saveCommand);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.projection).toEqual(saved.projection);
    expect(replay.events).toEqual(saved.events);
    const restarted = makeAuthority();
    expect(await restarted.bootstrap(playerId, slotId)).toEqual(saved.projection);
    const restartedReplay = await restarted.execute(playerId, slotId, saveCommand);
    expect(restartedReplay.idempotentReplay).toBe(true);
    expect(restartedReplay.projection).toEqual(saved.projection);

    const record = await store.read(playerId, slotId);
    if (record === undefined) throw new Error("v20 Save Me service record disappeared");
    const debitEvents = [...record.receipts.values()].flatMap(({ result }) => result.events)
      .filter((event) =>
        event.type === "player.currencyChanged" && event.currency === "gold" && event.delta === -100,
      );
    expect(debitEvents).toHaveLength(1);
    expect(record.state.profile.gold).toBe(0);
    expect(record.state.location.kind).toBe("town");
    expect(record.state.battle).toBeUndefined();
    expect(record.state.pendingDefeat).toBeUndefined();
  });

  it("preserves the installed v11 Tournament Egg settlement branch", () => {
    const initial = reduce(undefined, {
      type: "slot.create",
      starterElement: "Water",
    });
    const pending: OfficialGameStateV1 = {
      ...initial.state,
      ...(initial.state.pendingEgg === undefined ? {} : {}),
      pendingEgg: { schemaVersion: 1, kind: "silver" },
      nextMonsterSequence: 5,
    };
    const settled = reduce(pending, { type: "tournament.settlePrize" });
    expect(settled.state.pendingEgg).toBeUndefined();
    expect(settled.projection.player.tournament).toMatchObject({
      index: 0,
      round: 0,
      status: 0,
    });
    expect(() => reduce({
      ...settled.state,
      nextMonsterSequence: 5,
    }, { type: "tournament.settlePrize" })).toThrow(/pending Tournament Egg/i);
  });

  it("defers guarded dungeon rewards to Take All with key precedence and exact-once settlement", () => {
    const authoredAuthority = minimalOperatorEggContentAuthority({
      battleRewardKey: "authored-terminal-key",
      questKey: "RigelBattle",
    });
    const authoredFixture = officialDungeonBattleFixture(100, "fixed", authoredAuthority);
    const authoredStarted = authoredFixture.started;
    const authoredEncounter = authoredStarted.state.battle?.encounter;
    if (authoredEncounter?.kind !== "dungeon") throw new Error("authored fixture has no dungeon encounter");
    expect(authoredEncounter.encounter).toMatchObject({
      battleRewardKey: "authored-terminal-key",
      questKey: "RigelBattle",
    });
    const authoredRewards = authoredEncounter.rewards;
    expect(authoredRewards.length).toBeGreaterThan(0);
    const authoredTreasureId = authoredEncounter.encounter.treasure?.id;
    if (authoredTreasureId === undefined) throw new Error("authored fixture has no guarded treasure");
    const authoredSilver = authoredRewards.reduce(
      (total, reward) => total + (reward.kind === "silver" ? reward.amount : 0),
      0,
    );
    const authoredVictory = finishVersionedDungeonBattleVictory(
      authoredAuthority,
      authoredFixture,
      "01",
    );
    expect(authoredVictory.state.location.kind).toBe("dungeon");
    expect(authoredVictory.state.battle).toBeUndefined();
    expect(authoredVictory.events.filter((event) => event.type === "battle.rewardsGranted"))
      .toEqual([]);
    expect(authoredVictory.state.profile.silver).toBe(authoredStarted.state.profile.silver);
    expect(authoredVictory.state.quests.receivedBattleRewardKeys).not.toContain("authored-terminal-key");
    expect(authoredVictory.state.dungeon?.run.current.session.collectedTreasureIds)
      .not.toContain(authoredTreasureId);

    const authoredClaim = applyV16DungeonCommand(
      authoredVictory,
      { type: "dungeon.openTreasure", treasureId: authoredTreasureId },
    );
    expect(authoredClaim.state.profile.silver)
      .toBe(authoredStarted.state.profile.silver + authoredSilver);
    expect(authoredClaim.state.quests.receivedBattleRewardKeys).toContain("authored-terminal-key");
    expect(authoredClaim.state.quests.receivedBattleRewardKeys).not.toContain("RigelBattle");
    expect(authoredClaim.state.dungeon?.run.current.session.collectedTreasureIds)
      .toContain(authoredTreasureId);

    const fallbackAuthority = minimalOperatorEggContentAuthority({ questKey: "RigelBattle" });
    const fallbackFixture = officialDungeonBattleFixture(100, "fixed", fallbackAuthority);
    const fallbackStarted = fallbackFixture.started;
    const fallbackEncounter = fallbackStarted.state.battle?.encounter;
    if (fallbackEncounter?.kind !== "dungeon") throw new Error("fallback fixture has no dungeon encounter");
    expect(fallbackEncounter.encounter).not.toHaveProperty("battleRewardKey");
    expect(fallbackEncounter.encounter.questKey).toBe("RigelBattle");
    const fallbackTreasureId = fallbackEncounter.encounter.treasure?.id;
    if (fallbackTreasureId === undefined) throw new Error("fallback fixture has no guarded treasure");
    const fallbackVictory = finishVersionedDungeonBattleVictory(
      fallbackAuthority,
      fallbackFixture,
      "02",
    );
    expect(fallbackVictory.events.filter((event) => event.type === "battle.rewardsGranted"))
      .toEqual([]);
    expect(fallbackVictory.state.quests.receivedBattleRewardKeys).not.toContain("RigelBattle");
    const fallbackClaim = applyV16DungeonCommand(
      fallbackVictory,
      { type: "dungeon.openTreasure", treasureId: fallbackTreasureId },
    );
    expect(fallbackClaim.state.quests.receivedBattleRewardKeys).toContain("RigelBattle");

    const duplicateAuthority = minimalOperatorEggContentAuthority({
      battleRewardKey: "authored-terminal-key",
      questKey: "RigelBattle",
    });
    const duplicateFixture = officialDungeonBattleFixture(100, "fixed", duplicateAuthority);
    const duplicateStarted = {
      ...duplicateFixture.started,
      state: {
        ...duplicateFixture.started.state,
        quests: {
          ...duplicateFixture.started.state.quests,
          receivedBattleRewardKeys: ["authored-terminal-key"],
        },
      },
    };
    const duplicateEncounter = duplicateStarted.state.battle?.encounter;
    if (duplicateEncounter?.kind !== "dungeon" || duplicateEncounter.encounter.treasure === undefined) {
      throw new Error("duplicate fixture has no guarded treasure");
    }
    const duplicateVictory = finishVersionedDungeonBattleVictory(
      duplicateAuthority,
      { ...duplicateFixture, started: duplicateStarted },
      "03",
    );
    const duplicateClaim = applyV16DungeonCommand(
      duplicateVictory,
      {
        type: "dungeon.openTreasure",
        treasureId: duplicateEncounter.encounter.treasure.id,
      },
    );
    expect(duplicateClaim.state.profile.silver).toBe(duplicateVictory.state.profile.silver);
    expect(duplicateClaim.state.quests.receivedBattleRewardKeys).toEqual(["authored-terminal-key"]);
    expect(duplicateClaim.state.dungeon?.run.current.session.collectedTreasureIds)
      .toContain(duplicateEncounter.encounter.treasure.id);

    const ordinaryAuthority = minimalOperatorEggContentAuthority({});
    const ordinaryFixture = officialDungeonBattleFixture(100, "fixed", ordinaryAuthority);
    const ordinaryEncounter = ordinaryFixture.started.state.battle?.encounter;
    if (ordinaryEncounter?.kind !== "dungeon" || ordinaryEncounter.encounter.treasure === undefined) {
      throw new Error("ordinary fixture has no guarded treasure");
    }
    const ordinaryTreasureId = ordinaryEncounter.encounter.treasure.id;
    expect(ordinaryEncounter.encounter).not.toHaveProperty("battleRewardKey");
    expect(ordinaryEncounter.encounter).not.toHaveProperty("questKey");
    expect(ordinaryEncounter.rewards.length).toBeGreaterThan(0);
    const ordinaryVictory = finishVersionedDungeonBattleVictory(
      ordinaryAuthority,
      ordinaryFixture,
      "04",
    );
    expect(ordinaryVictory.events.filter((event) => event.type === "battle.rewardsGranted"))
      .toEqual([]);
    const ordinaryClaim = applyV16DungeonCommand(
      ordinaryVictory,
      {
        type: "dungeon.openTreasure",
        treasureId: ordinaryTreasureId,
      },
    );
    expect(() => applyV16DungeonCommand(
      { ...ordinaryVictory, state: ordinaryClaim.state, projection: ordinaryClaim.projection }, {
        type: "dungeon.openTreasure",
        treasureId: ordinaryTreasureId,
      },
    )).toThrowError(expect.objectContaining({ code: "ACTION_NOT_ALLOWED" }));
    expect(ordinaryClaim.state.profile).not.toEqual(ordinaryVictory.state.profile);
  });

  it("keeps v15 settlement immutable and migrates its cleared chest without a second grant", () => {
    const authority = minimalOperatorEggContentAuthority({});
    const fixture = officialDungeonBattleFixture(100, "fixed", authority);
    const encounter = fixture.started.state.battle?.encounter;
    if (encounter?.kind !== "dungeon" || encounter.encounter.treasure === undefined) {
      throw new Error("v15 fixture has no guarded treasure");
    }
    const treasureId = encounter.encounter.treasure.id;
    const victory = finishVersionedDungeonBattleVictory(authority, fixture, "05", "v15");
    expect(victory.events).toContainEqual(expect.objectContaining({
      type: "battle.rewardsGranted",
    }));
    expect(victory.state.profile).not.toEqual(fixture.started.state.profile);
    expect(victory.state.dungeon?.run.current.session.collectedTreasureIds)
      .not.toContain(treasureId);

    const migrated = migrateOfficialGameV15ToV16({
      data,
      quests,
      state: victory.state,
      context: { dungeonResources: authority.resources },
    });
    expect(migrated.dungeon?.run.current.session.collectedTreasureIds)
      .toContain(treasureId);
    expect(() => applyV16DungeonCommand(
      {
        ...victory,
        state: migrated,
        projection: victory.reducer.projectPersistedState(migrated),
      },
      {
        type: "dungeon.openTreasure",
        treasureId,
      },
    )).toThrowError(expect.objectContaining({ code: "ACTION_NOT_ALLOWED" }));
  });

  it("migrates a v15 cleared chest after the player has moved to another room", () => {
    const authority = minimalOperatorEggContentAuthority({});
    const fixture = officialDungeonBattleFixture(100, "fixed", authority);
    const encounter = fixture.started.state.battle?.encounter;
    if (encounter?.kind !== "dungeon" || encounter.encounter.treasure === undefined) {
      throw new Error("v15 fixture has no guarded treasure");
    }
    const treasureId = encounter.encounter.treasure.id;
    const victory = finishVersionedDungeonBattleVictory(authority, fixture, "06", "v15");
    const previousRoomId = victory.state.dungeon?.run.current.session.previousRoomId;
    if (previousRoomId === undefined) throw new Error("v15 victory has no return room");
    const moved = victory.reducer.applyForV15({
      playerId: "dungeon-v16-route-player",
      slotId: "slot-1",
      pack: victory.pack,
      state: victory.state,
      previousRevision: 201,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "dungeon.selectRoom",
      roomId: previousRoomId,
    });
    expect(moved.state.dungeon?.run.current.session.currentRoomId).toBe(previousRoomId);
    expect(moved.state.dungeon?.run.current.session.collectedTreasureIds).not.toContain(treasureId);

    const migrated = migrateOfficialGameV15ToV16({
      data,
      quests,
      state: moved.state,
      context: { dungeonResources: authority.resources },
    });
    expect(migrated.dungeon?.run.current.session.collectedTreasureIds).toContain(treasureId);
    expect(() => victory.reducer.applyForV16({
      playerId: "dungeon-v16-route-player",
      slotId: "slot-1",
      pack: victory.pack,
      state: migrated,
      previousRevision: 202,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "dungeon.openTreasure",
      treasureId,
    })).toThrowError(expect.objectContaining({ code: "ACTION_NOT_ALLOWED" }));
    const returned = victory.reducer.applyForV16({
      playerId: "dungeon-v16-route-player",
      slotId: "slot-1",
      pack: victory.pack,
      state: migrated,
      previousRevision: 202,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "dungeon.selectRoom",
      roomId: fixture.encounterRoomId,
    });
    expect(() => victory.reducer.applyForV16({
      playerId: "dungeon-v16-route-player",
      slotId: "slot-1",
      pack: victory.pack,
      state: returned.state,
      previousRevision: 203,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "dungeon.openTreasure",
      treasureId,
    })).toThrowError(expect.objectContaining({ code: "ACTION_NOT_ALLOWED" }));
    expect(returned.state.profile).toEqual(migrated.profile);
    expect(returned.state.party).toEqual(migrated.party);
  });

  it("repairs v15 settled chests on non-current cached floors", () => {
    const authority = minimalOperatorEggContentAuthority({});
    const fixture = officialDungeonBattleFixture(100, "fixed", authority);
    const encounter = fixture.started.state.battle?.encounter;
    if (encounter?.kind !== "dungeon" || encounter.encounter.treasure === undefined) {
      throw new Error("v15 fixture has no guarded treasure");
    }
    const victory = finishVersionedDungeonBattleVictory(authority, fixture, "07", "v15");
    const dungeon = victory.state.dungeon;
    if (dungeon === undefined || victory.state.location.kind !== "dungeon") {
      throw new Error("v15 victory did not return to its dungeon");
    }
    const settledRoute = dungeon.run.current.route;
    const otherFloor = dungeon.run.cachedFloors.find(({ route }) =>
      route.typeName === settledRoute.typeName &&
      route.sourceFile === settledRoute.sourceFile &&
      route.floor !== settledRoute.floor,
    );
    if (otherFloor === undefined) throw new Error("fixture has no earlier cached floor");
    const stateWithOtherCurrent = {
      ...victory.state,
      location: {
        kind: "dungeon" as const,
        dungeonId: otherFloor.session.definitionId,
        floor: otherFloor.route.floor,
        roomId: otherFloor.session.currentRoomId,
      },
      dungeon: {
        ...dungeon,
        run: { ...dungeon.run, current: otherFloor },
      },
    };

    const migrated = migrateOfficialGameV15ToV16({
      data,
      quests,
      state: stateWithOtherCurrent,
      context: { dungeonResources: authority.resources },
    });
    const repairedFloor = migrated.dungeon?.run.cachedFloors.find(({ route }) =>
      route.typeName === settledRoute.typeName &&
      route.sourceFile === settledRoute.sourceFile &&
      route.floor === settledRoute.floor,
    );
    expect(migrated.dungeon?.run.current.route.floor).toBe(otherFloor.route.floor);
    expect(repairedFloor?.session.collectedTreasureIds)
      .toContain(encounter.encounter.treasure.id);
  });

  it("charges v16 spirit energy from the committed opening battle prefix while freezing v15", () => {
    const fixture = officialDungeonBattleFixture(1);
    const ready = parseOfficialGameStateV12(data, quests, {
      ...fixture.ready,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    const command = {
      type: "dungeon.selectRoom" as const,
      roomId: fixture.encounterRoomId,
    };
    const context = {
      playerId: "spirit-opening-player",
      slotId: "slot-1" as const,
      state: ready,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    };
    const v16 = v16Reducer().apply({ ...context, pack: completeV16Pack }, command);
    const replay = restoreBattleReplay(data, v16.state.battle!.replay);
    const damage = replay.events.filter((event) => event.type === "damageDealt");
    expect(damage.length).toBeGreaterThan(0);

    const expectedParty = WorldTripParty.fromStateSnapshot(data, ready.party);
    const expectedProfile = PlayerProfile.fromStateSnapshot(
      ready.profile,
      expectedParty.monsters().map(({ level }) => level),
      expectedParty,
    );
    for (const event of damage) {
      if (replay.session.teamOf(event.source) === 0) {
        expectedProfile.chargeSpiritForDealtDamage(
          replay.session.levelOf(event.source),
          replay.session.levelOf(event.target),
        );
      }
      if (replay.session.teamOf(event.target) === 0) {
        expectedProfile.chargeSpiritForTakenDamage(
          replay.session.levelOf(event.target),
          replay.session.levelOf(event.source),
        );
      }
    }
    expect(v16.state.profile.spiritEnergy).toBe(expectedProfile.stateSnapshot().spiritEnergy);
    expect(v16.state.profile.spiritEnergy).toBeGreaterThan(ready.profile.spiritEnergy);

    const v15 = v15Reducer().apply({ ...context, pack: completeV15Pack }, command);
    expect(v15.state.profile.spiritEnergy).toBe(ready.profile.spiritEnergy);
  });

  it("enables native sparse dungeon-populator inheritance in v16 while freezing v15", () => {
    const route: DungeonRouteDescriptor = {
      typeName: "Cave",
      sourceFile: "Dungeon_1.plist",
      floor: 4,
    };
    const monsterTypes = data.allMonsters().map(({ shortType }) => shortType);
    let selected: {
      readonly run: DungeonRuntimeController;
      readonly path: readonly string[];
      readonly treasureId: string;
    } | undefined;
    for (let runSeed = 0; runSeed < 512 && selected === undefined; runSeed += 1) {
      const context = {
        resources: source,
        monsterTypes,
        runSeed,
        legacyDungeonGenerationSemantics: true,
      };
      const entered = DungeonRuntimeController.enter(context, route);
      entered.session.enterCurrentRoom();
      const run = DungeonRuntimeController.restore(context, entered.snapshot());
      const startId = run.session.currentRoom.id;
      const previous = new Map<string, string | undefined>([[startId, undefined]]);
      const queue = [startId];
      let target: (typeof run.session.state.rooms)[number] | undefined;
      while (queue.length > 0 && target === undefined) {
        const roomId = queue.shift()!;
        const room = run.session.state.rooms.find(({ id }) => id === roomId)!;
        if (room.treasure !== undefined && room.encounter === undefined) {
          target = room;
          break;
        }
        for (const link of room.links) {
          const next = run.session.state.rooms.find(({ id }) => id === link.targetRoomId)!;
          if (previous.has(next.id) || next.encounter !== undefined) continue;
          previous.set(next.id, room.id);
          queue.push(next.id);
        }
      }
      if (target === undefined || target.treasure === undefined) continue;
      const path: string[] = [];
      for (let roomId = target.id; roomId !== startId;) {
        path.push(roomId);
        const priorRoomId = previous.get(roomId);
        if (priorRoomId === undefined) throw new Error("sparse-populator fixture path is broken");
        roomId = priorRoomId;
      }
      selected = { run, path: path.reverse(), treasureId: target.treasure.id };
    }
    if (selected === undefined) throw new Error("no reachable North Cave floor-4 ordinary treasure fixture");

    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const entrance = firstDungeonEntrance();
    const core: OfficialGameStateV1 = {
      ...created.state,
      location: {
        kind: "dungeon",
        dungeonId: selected.run.session.snapshot().definitionId,
        floor: route.floor,
        roomId: selected.run.session.currentRoom.id,
      },
      dungeon: {
        schemaVersion: 1,
        run: selected.run.snapshot(),
        worldId: entrance.world.name,
        entrancePoiId: entrance.poi.name,
      },
    };
    const initial = parseOfficialGameStateV12(data, quests, {
      ...core,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
    const versioned = v12Reducer();
    const applyPath = (version: "v15" | "v16"): OfficialGameStateV12 => {
      let state = initial;
      for (const [index, roomId] of selected!.path.entries()) {
        const apply = version === "v16"
          ? versioned.applyForV16.bind(versioned)
          : versioned.applyForV15.bind(versioned);
        state = apply({
          playerId: `sparse-populator-${version}`,
          slotId: "slot-1",
          pack: completeV12Pack,
          state,
          previousRevision: index + 1,
          now: "2026-08-09T00:00:00.000Z",
        }, { type: "dungeon.selectRoom", roomId }).state;
      }
      return state;
    };
    const v15 = applyPath("v15");
    const v16 = applyPath("v16");
    expect(() => versioned.applyForV15({
      playerId: "sparse-populator-v15",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: v15,
      previousRevision: selected.path.length + 1,
      now: "2026-08-09T00:00:00.000Z",
    }, { type: "dungeon.openTreasure", treasureId: selected.treasureId })).toThrow(/missing|treasure/i);
    const claimed = versioned.applyForV16({
      playerId: "sparse-populator-v16",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: v16,
      previousRevision: selected.path.length + 1,
      now: "2026-08-09T00:00:00.000Z",
    }, { type: "dungeon.openTreasure", treasureId: selected.treasureId });
    expect(claimed.events).toContainEqual(expect.objectContaining({
      type: "dungeon.treasureClaimed",
      treasureId: selected.treasureId,
    }));
    expect(() => versioned.projectPersistedStateForV16(claimed.state)).not.toThrow();
  });

  it("commits and discloses the first Enya fight's authored gem reward", () => {
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const strongParty = new WorldTripParty(
      data,
      [member("monster-1", "BlueBabyDragon", 50)],
      6,
    );
    const strongProfile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("BlueBabyDragon"),
      monsterPartyLevels: [50],
    }, strongParty);
    const enyaReady: OfficialGameStateV1 = {
      ...created.state,
      profile: strongProfile.stateSnapshot(),
      party: strongParty.stateSnapshot(),
      location: { kind: "world", worldId: "World_1-1", poiId: "1-1_Field_2" },
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
        poiWins: {
          ...created.state.world!.poiWins,
          "1-1_Turtorial_Hut_1": 1,
          "1-1_Field_1": 1,
          "1-1_Field_2": 1,
        },
      },
    };
    let current = reduce(enyaReady, {
      type: "world.navigate",
      targetPoiId: "1-1_Field_3",
    });
    expect(current.state.battle?.encounter.kind).toBe("world");
    if (current.state.battle?.encounter.kind !== "world") {
      throw new Error("Enya navigation did not start a world battle");
    }
    expect(current.state.battle.encounter.generated.startEvent?.chat.name).toBe("Enya");
    expect(current.state.battle.encounter.rewards).toEqual([
      expect.objectContaining({ kind: "gem", level: 7 }),
    ]);

    for (let turn = 0; current.projection.location.kind === "battle" && turn < 100; turn++) {
      const decision = current.projection.decision;
      if (decision.type !== "battle.playerTurn") throw new Error("Enya battle decision missing");
      const choice = decision.choices.find(({ abilityId, blockedReasonId }) =>
        abilityId === "Offensive.Attack" && blockedReasonId === undefined) ??
        decision.choices.find(({ blockedReasonId }) => blockedReasonId === undefined);
      if (choice === undefined) throw new Error("Enya battle has no usable ability");
      const targetIds = choice.target.kind === "self"
        ? [decision.actorId]
        : choice.target.kind === "allEnemies"
          ? [...decision.enemyTargetIds]
          : choice.target.kind === "allFriends"
            ? [...decision.friendlyTargetIds]
            : choice.target.kind === "enemies"
              ? decision.enemyTargetIds.slice(0, choice.target.count)
              : choice.target.kind === "friends"
                ? decision.friendlyTargetIds.slice(0, choice.target.count)
                : [
                    ...(choice.target.allEnemies
                      ? decision.enemyTargetIds
                      : decision.enemyTargetIds.slice(0, choice.target.enemyCount)),
                    ...(choice.target.allFriends
                      ? decision.friendlyTargetIds
                      : decision.friendlyTargetIds.slice(0, choice.target.friendlyCount)),
                  ];
      current = reduce(current.state, {
        type: "battle.chooseAbility",
        battleId: decision.battleId,
        actorId: decision.actorId,
        slot: choice.slot,
        targetIds,
      });
    }
    expect(current.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "victory",
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      type: "battle.rewardsGranted",
      rewards: [expect.objectContaining({ kind: "gem", level: 7 })],
    }));
    expect(Object.keys(current.projection.player.items)).toHaveLength(1);
  });

  it("clears the previous day's flag caches after an authoritative combat defeat", () => {
    const created = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    const dungeonEntrance = allWorlds.flatMap((candidate) =>
      candidate.pointsOfInterest.map((poi) => ({ world: candidate, poi })))
      .find(({ poi }) => poi.zoneChange?.kind === "dungeon");
    if (dungeonEntrance === undefined) throw new Error("fixture has no dungeon entrance");
    const enteredDungeon = reduce({
      ...created.state,
      location: {
        kind: "world",
        worldId: dungeonEntrance.world.name,
        poiId: dungeonEntrance.poi.name,
      },
      world: {
        ...created.state.world!,
        worldId: dungeonEntrance.world.name,
        currentPoiId: dungeonEntrance.poi.name,
      },
    }, {
      type: "world.activateZone",
      zoneId: dungeonEntrance.poi.name,
    });
    if (enteredDungeon.state.dungeon === undefined) {
      throw new Error("defeat fixture did not create a private dungeon cache");
    }
    const enyaReady: OfficialGameStateV1 = {
      ...created.state,
      dungeon: enteredDungeon.state.dungeon,
      location: { kind: "world", worldId: "World_1-1", poiId: "1-1_Field_2" },
      world: {
        ...created.state.world!,
        currentPoiId: "1-1_Field_2",
        occurrenceByPoi: { "1-1_Field_2": true },
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
        poiWins: {
          ...created.state.world!.poiWins,
          "1-1_Turtorial_Hut_1": 1,
          "1-1_Field_1": 1,
          "1-1_Field_2": 1,
        },
      },
    };
    const entered = reduce(enyaReady, {
      type: "world.navigate",
      targetPoiId: "1-1_Field_3",
    });
    if (entered.state.battle === undefined) throw new Error("defeat fixture battle is missing");
    let state: OfficialGameStateV1 = {
      ...entered.state,
      world: {
        ...entered.state.world!,
        occurrenceByPoi: { "1-1_Field_2": true, "1-1_Field_3": true },
        completedPoiIds: ["1-1_Field_1", "1-1_Field_2"],
      },
    };
    let decision = entered.projection.decision;
    let result = entered;
    for (let turn = 0; state.location.kind === "battle" && turn < 100; turn++) {
      if (decision.type !== "battle.playerTurn") throw new Error("defeat fixture decision missing");
      result = reduce(state, {
        type: "battle.delay",
        battleId: decision.battleId,
        actorId: decision.actorId,
      });
      state = result.state;
      decision = result.projection.decision;
    }
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "defeat",
    }));
    expect(result.projection.location).toEqual({
      kind: "town",
      worldId: "World_1-1",
      townId: "First_City",
    });
    expect(result.projection.world?.dayNumber).toBe(2);
    expect(result.projection.world?.occurrenceByPoi).toEqual({});
    expect(result.projection.world?.completedPoiIds).toEqual(["First_City"]);
    expect(result.state.dungeon).toBeUndefined();
  });

  it("derives dungeon survivors from initial construction positions and excludes created enemies", () => {
    const encounter = {
      id: "encounter-authoritative",
      monsters: [
        { type: "Goblin", level: 3 },
        { type: "Slime", level: 4, extraLivingArguments: { boss: false } },
      ],
    } as const;
    const restored = {
      session: {
        activeIdsOf: (team: 0 | 1) => team === 1
          ? ["t1m0:Goblin", "t1m2:Slime"]
          : [],
        benchIdsOf: (team: 0 | 1) => team === 1 ? ["t1m1:Slime"] : [],
      },
    } as unknown as Parameters<typeof deriveOfficialDungeonTerminalSurvivors>[2];

    expect(deriveOfficialDungeonTerminalSurvivors(
      encounter,
      [
        { shortType: "Goblin", level: 3 },
        { shortType: "Slime", level: 4 },
      ],
      restored,
    )).toEqual([...encounter.monsters]);
    expect(() => deriveOfficialDungeonTerminalSurvivors(
      encounter,
      [{ shortType: "Slime", level: 4 }],
      restored,
    )).toThrow(/team lengths disagree/);
    expect(() => deriveOfficialDungeonTerminalSurvivors(
      encounter,
      [
        { shortType: "Slime", level: 4 },
        { shortType: "Goblin", level: 3 },
      ],
      restored,
    )).toThrow(/construction position 0/);
  });

  it("settles Official dungeon retreat before navigation, persists survivors, and narrows them again on re-entry", () => {
    const fixture = officialDungeonBattleFixture();
    const retreated = reduceOneDungeonEnemyAndRetreat(fixture);
    const startedBattle = fixture.started.state.battle;
    if (startedBattle?.encounter.kind !== "dungeon" || startedBattle.origin.kind !== "dungeon") {
      throw new Error("fixture is not a dungeon battle");
    }
    const encounterId = startedBattle.origin.encounterId;
    const encounterRoster = retreated.state.dungeon?.run.current.session.encounterRosters?.find(
      ({ encounterId: candidate }) => candidate === encounterId,
    );
    expect(encounterRoster).toBeDefined();
    expect(encounterRoster!.monsters.length).toBeLessThan(
      startedBattle.encounter.encounter.monsters.length,
    );
    expect(retreated.projection.location.kind).toBe("dungeon");
    expect(retreated.projection.location).not.toMatchObject({ roomId: fixture.encounterRoomId });
    const progress = retreated.projection.quests?.progressByQuestName[fixture.clearDungeonQuestName];
    expect(progress?.[`monstersLeftOnFloor:${retreated.state.dungeon!.run.current.session.floor}`])
      .toBe(fixture.initialFloorSurvivorCount - (
        startedBattle.encounter.encounter.monsters.length - encounterRoster!.monsters.length
      ));

    const outside: OfficialGameStateV1 = {
      ...retreated.state,
      location: {
        kind: "world",
        worldId: fixture.entrance.world.name,
        poiId: fixture.entrance.poi.name,
      },
      world: {
        ...retreated.state.world!,
        worldId: fixture.entrance.world.name,
        currentPoiId: fixture.entrance.poi.name,
      },
    };
    const reentered = reduce(outside, {
      type: "world.activateZone",
      zoneId: fixture.entrance.poi.name,
    });
    expect(reentered.projection.location.kind).toBe("dungeon");
    const nextBattle = reduce(reentered.state, {
      type: "dungeon.selectRoom",
      roomId: fixture.encounterRoomId,
    });
    expect(nextBattle.state.battle?.battleId).not.toBe(fixture.started.state.battle?.battleId);
    expect(nextBattle.state.battle?.encounter.kind).toBe("dungeon");
    if (nextBattle.state.battle?.encounter.kind !== "dungeon") {
      throw new Error("re-entry did not start the reduced dungeon encounter");
    }
    expect(nextBattle.state.battle.encounter.encounter.monsters.length)
      .toBe(encounterRoster!.monsters.length);

    const secondRetreat = reduceOneDungeonEnemyAndRetreat({ ...fixture, started: nextBattle });
    const nextEncounterId = nextBattle.state.battle?.origin.kind === "dungeon"
      ? nextBattle.state.battle.origin.encounterId
      : "";
    const secondRoster = secondRetreat.state.dungeon?.run.current.session.encounterRosters?.find(
      ({ encounterId: candidate }) => candidate === nextEncounterId,
    );
    expect(secondRoster?.monsters.length).toBeLessThan(encounterRoster!.monsters.length);
  });

  it("synchronizes Official dungeon victory before clearing and awards no client-authored captures", () => {
    const fixture = officialDungeonBattleFixture();
    const victory = finishDungeonVictory(fixture);
    expect(victory.projection.location.kind).toBe("dungeon");
    expect(victory.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "victory",
    }));
    const battle = fixture.started.state.battle!;
    if (battle.origin.kind !== "dungeon" || battle.encounter.kind !== "dungeon") {
      throw new Error("fixture is not a dungeon battle");
    }
    const current = victory.state.dungeon!.run.current.session;
    expect(current.clearedEncounterIds).toContain(battle.origin.encounterId);
    expect(current.encounterRosters ?? []).not.toContainEqual(
      expect.objectContaining({ encounterId: battle.origin.encounterId }),
    );
    expect(victory.events.filter((event) =>
      event.type === "player.monsterAdded" && event.reason === "capture",
    )).toEqual([]);
    const progress = victory.projection.quests?.progressByQuestName[fixture.clearDungeonQuestName];
    expect(progress?.[`monstersLeftOnFloor:${current.floor}`]).toBe(
      fixture.initialFloorSurvivorCount - battle.encounter.encounter.monsters.length,
    );
    expect(() => SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 1,
      updatedAt: "2026-07-29T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: completePack.simulationVersion,
      trustTier: "official",
      ...victory.projection,
    })).not.toThrow();
  });

  it("emits the victory event-4 projection after battle win work and before dungeon clear", () => {
    const event4Inputs: Array<{
      types: string[];
      instanceName: string;
      floor: number;
      survivingMonstersByRoom: readonly number[];
    }> = [];
    const orderedReducer = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => 0,
      beforeDungeonRoomRosterUpdated: (events, update) => {
        event4Inputs.push({ types: events.map((event) => event.type), ...update });
      },
    });
    const fixture = officialDungeonBattleFixture();
    let result = fixture.started;
    for (let turn = 0; turn < 200 && result.state.location.kind === "battle"; turn += 1) {
      result = chooseOneDungeonAbility(result, orderedReducer);
    }
    if (result.state.location.kind === "battle") throw new Error("fixture did not reach victory");

    expect(event4Inputs).toHaveLength(1);
    const beforeEvent4 = event4Inputs[0]!;
    expect(beforeEvent4.types).toContain("battle.ended");
    expect(beforeEvent4.instanceName)
      .toBe(result.state.dungeon!.run.current.session.definitionId.split(":")[2]);
    expect(beforeEvent4.survivingMonstersByRoom.every((count) => Number.isSafeInteger(count) && count >= 0))
      .toBe(true);
    const progress = result.projection.quests?.progressByQuestName[fixture.clearDungeonQuestName];
    expect(progress?.[`monstersLeftOnFloor:${result.state.dungeon!.run.current.session.floor}`])
      .toBe(beforeEvent4.survivingMonstersByRoom.reduce((sum, count) => sum + count, 0));
    expect(result.state.dungeon).toBeDefined();
    expect(result.state.dungeon!.run.current.session.clearedEncounterIds.length).toBeGreaterThan(0);
    expect(result.projection.location.kind).toBe("dungeon");
  });

  it("settles a fixed encounter after event 9 changes its gate and before event 4 commits the roster", () => {
    const fixture = officialDungeonBattleFixture(100, "fixed");
    const startedBattle = fixture.started.state.battle;
    if (startedBattle?.origin.kind !== "dungeon" || startedBattle.encounter.kind !== "dungeon") {
      throw new Error("fixed fixture did not start a dungeon battle");
    }
    const completionKey = startedBattle.encounter.encounter.completionKey;
    if (completionKey === undefined) throw new Error("fixed fixture has no completion key");
    let event4Proof: {
      readonly eventTypes: readonly string[];
      readonly completedKeys: readonly string[];
    } | undefined;
    const orderedReducer = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => 0,
      beforeDungeonRoomRosterUpdated: (events, update) => {
        event4Proof = {
          eventTypes: events.map((event) => event.type),
          completedKeys: update.completedFixedEncounterKeys,
        };
      },
    });
    const result = finishDungeonVictory(fixture, orderedReducer);
    expect(event4Proof).toBeDefined();
    expect(event4Proof!.completedKeys).toContain(completionKey);
    expect(event4Proof!.eventTypes).toContain("battle.ended");
    expect(result.state.quests.completedFixedEncounterKeys).toContain(completionKey);
    expect(result.state.dungeon?.run.current.session.clearedEncounterIds)
      .toContain(startedBattle.origin.encounterId);
    expect(result.state.dungeon?.run.current.session.encounterRosters ?? [])
      .not.toContainEqual(expect.objectContaining({ encounterId: startedBattle.origin.encounterId }));
    expect(result.events.filter((event) =>
      event.type === "player.monsterAdded" && event.reason === "capture",
    )).toEqual([]);
    const projection = SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 2,
      updatedAt: "2026-07-29T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: completePack.simulationVersion,
      trustTier: "official",
      ...result.projection,
    });
    expect(() => orderedReducer.validatePersistedRecord({ state: result.state, projection }))
      .not.toThrow();
  });

  it("keeps event-4 before final dungeon navigation for victory, retreat, and defeat", () => {
    for (const outcome of ["victory", "retreat", "defeat"] as const) {
      const event4Inputs: Array<{ readonly types: readonly string[] }> = [];
      const orderedReducer = new OfficialGameReducer({
        data,
        world,
        worlds: allWorlds,
        resources: source,
        quests,
        startTownId: "First_City",
        support: completeSupport,
        random: () => 0,
        beforeDungeonRoomRosterUpdated: (events) => {
          event4Inputs.push({ types: events.map((event) => event.type) });
        },
      });
      const fixture = officialDungeonBattleFixture();
      const result = outcome === "victory"
        ? finishDungeonVictory(fixture, orderedReducer)
        : outcome === "retreat"
          ? reduceOneDungeonEnemyAndRetreat(fixture, orderedReducer)
          : finishDungeonDefeat(fixture, orderedReducer);

      expect(event4Inputs).toHaveLength(1);
      expect(event4Inputs[0]!.types).toContain("battle.ended");
      if (outcome === "defeat") {
        expect(result.projection.location.kind).toBe("town");
        expect(result.state.dungeon).toBeUndefined();
      } else {
        expect(result.projection.location.kind).toBe("dungeon");
        expect(result.state.dungeon).toBeDefined();
      }
    }
  });

  it("synchronizes Official dungeon defeat before town return, clears the run, and never awards captures", () => {
    const fixture = officialDungeonBattleFixture(1);
    const defeat = finishDungeonDefeat(fixture);
    expect(defeat.projection.location).toEqual({
      kind: "town",
      worldId: fixture.entrance.world.name,
      townId: "First_City",
    });
    expect(defeat.state.dungeon).toBeUndefined();
    expect(defeat.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "defeat",
    }));
    expect(defeat.events.filter((event) =>
      event.type === "player.monsterAdded" && event.reason === "capture",
    )).toEqual([]);
    expect(defeat.projection.quests?.progressByQuestName[fixture.clearDungeonQuestName])
      .toEqual({});
  });

  it("canonicalizes legacy Official dungeon runs before projection schema parsing", () => {
    const fixture = officialDungeonBattleFixture();
    const legacy = structuredClone(fixture.started.state) as unknown as {
      dungeon: { run: { terminalFlowSerial?: number } };
    } & OfficialGameStateV1;
    const legacyRun = legacy.dungeon!.run as unknown as Record<string, unknown>;
    delete legacyRun.terminalFlowSerial;

    const parsed = parseOfficialGameStateV1(data, quests, legacy, { dungeonResources: source });
    expect(parsed.dungeon?.run.terminalFlowSerial).toBe(0);
    expect(() => SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 1,
      updatedAt: "2026-07-29T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: completePack.simulationVersion,
      trustTier: "official",
      ...fixture.started.projection,
      dungeon: fixture.started.projection.dungeon === undefined
        ? undefined
        : { ...fixture.started.projection.dungeon, run: parsed.dungeon!.run },
    })).not.toThrow();
    const legacyProjection = structuredClone(fixture.started.projection) as unknown as {
      dungeon?: { run: { terminalFlowSerial?: number } };
    };
    delete legacyProjection.dungeon?.run.terminalFlowSerial;
    expect(() => SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 1,
      updatedAt: "2026-07-29T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: completePack.simulationVersion,
      trustTier: "official",
      ...legacyProjection,
    })).not.toThrow();
  });

  it("canonicalizes a non-battle synthetic dungeon state and preserves its private envelope", () => {
    const fixture = officialDungeonBattleFixture();
    const legacy = legacySyntheticDungeonState(fixture.started.state);
    const parsed = parseOfficialGameStateV1(data, quests, legacy, { dungeonResources: source });
    if (parsed.dungeon === undefined || parsed.location.kind !== "dungeon") {
      throw new Error("legacy fixture did not retain its dungeon state");
    }

    expect(parsed.dungeon.worldId).toBe(legacy.dungeon!.worldId);
    expect(parsed.dungeon.entrancePoiId).toBe(legacy.dungeon!.entrancePoiId);
    expect(parsed.dungeon.run.current.session.currentRoomId).not.toMatch(/^room-/);
    expect(parsed.location).toEqual({
      kind: "dungeon",
      dungeonId: parsed.dungeon.run.current.session.definitionId,
      floor: parsed.dungeon.run.current.session.floor,
      roomId: parsed.dungeon.run.current.session.currentRoomId,
    });
    expect(parsed.dungeon.run.completedKeys).toEqual(legacy.dungeon!.run.completedKeys);
    expect(parsed.dungeon.run.catchTypes).toEqual(legacy.dungeon!.run.catchTypes);

    const projected = completeReducer.projectPersistedState(parsed);
    expect(projected.location).toEqual(parsed.location);
    expect(projected.dungeon?.run.current.session.currentRoomId)
      .toBe(parsed.dungeon.run.current.session.currentRoomId);
    const reparsed = parseOfficialGameStateV1(data, quests, parsed, { dungeonResources: source });
    expect(reparsed).toEqual(parsed);
  });

  it("rejects an active dungeon battle whose synthetic room cannot be correlated", () => {
    const fixture = officialDungeonBattleFixture();
    const legacyBattle = legacySyntheticDungeonState(fixture.started.state, true);
    expect(() => parseOfficialGameStateV1(data, quests, legacyBattle, { dungeonResources: source }))
      .toThrow(/legacy.*battle|synthetic.*battle|correlat/i);
  });

  it("rejects an unmappable legacy dungeon location envelope", () => {
    const fixture = officialDungeonBattleFixture();
    const legacy = legacySyntheticDungeonState(fixture.started.state);
    if (legacy.location.kind !== "dungeon") throw new Error("legacy fixture is not in a dungeon");
    const invalid = {
      ...legacy,
      location: { ...legacy.location, floor: legacy.location.floor + 1 },
    } satisfies OfficialGameStateV1;
    expect(() => parseOfficialGameStateV1(data, quests, invalid, { dungeonResources: source }))
      .toThrow(/dungeon.*envelope|floor|location/i);
  });

  it("fails closed when a dungeon state is parsed without installed authoritative resources", () => {
    const fixture = officialDungeonBattleFixture();

    expect(() => parseOfficialGameStateV1(data, quests, fixture.started.state))
      .toThrow(/authoritative dungeon resources are unavailable/);

    const nonDungeon = reduce(undefined, { type: "slot.create", starterElement: "Water" });
    expect(() => parseOfficialGameStateV1(data, quests, nonDungeon.state)).not.toThrow();
  });

  it("rejects a dungeon battle whose origin, current encounter, or replay team is foreign", () => {
    const fixture = officialDungeonBattleFixture();
    const battle = fixture.started.state.battle!;
    if (battle.origin.kind !== "dungeon" || battle.encounter.kind !== "dungeon") {
      throw new Error("fixture is not a dungeon battle");
    }

    const foreignOrigin = {
      ...fixture.started.state,
      battle: {
        ...battle,
        origin: { ...battle.origin, encounterId: `${battle.origin.encounterId}-foreign` },
      },
    } as OfficialGameStateV1;
    expect(() => parseOfficialGameStateV1(data, quests, foreignOrigin, { dungeonResources: source }))
      .toThrow(/origin.*encounter|current room encounter/);

    const foreignEncounter = {
      ...fixture.started.state,
      battle: {
        ...battle,
        encounter: {
          ...battle.encounter,
          encounter: {
            ...battle.encounter.encounter,
            monsters: [...battle.encounter.encounter.monsters].reverse(),
          },
        },
      },
    } as OfficialGameStateV1;
    expect(() => parseOfficialGameStateV1(data, quests, foreignEncounter, { dungeonResources: source }))
      .toThrow(/current encounter|replay.*construction|encounter tuple/);

    const foreignReplay = structuredClone(fixture.started.state) as OfficialGameStateV1;
    const enemy = foreignReplay.battle!.replay.teams[1][0]!;
    (foreignReplay.battle!.replay.teams[1] as TeamMemberSetup[])[0] = {
      ...enemy,
      level: enemy.level + 1,
    };
    expect(() => parseOfficialGameStateV1(data, quests, foreignReplay, { dungeonResources: source }))
      .toThrow(/replay.*construction|enemy team/);
  });

  it("does not commit a receipt when an Official command starts from an invalid dungeon state", async () => {
    const fixture = officialDungeonBattleFixture();
    const decision = fixture.started.projection.decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no battle decision");
    const battle = fixture.started.state.battle!;
    if (battle.origin.kind !== "dungeon") throw new Error("fixture has no dungeon origin");
    const invalidState = {
      ...fixture.started.state,
      battle: {
        ...battle,
        origin: { ...battle.origin, encounterId: `${battle.origin.encounterId}-foreign` },
      },
    } as OfficialGameStateV1;
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV1>();
    const projection = SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 1,
      updatedAt: "2026-07-29T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: completePack.simulationVersion,
      trustTier: "official",
      ...fixture.started.projection,
    });
    await store.transact("route-player", "slot-1", async () => ({
      record: {
        playerId: "route-player",
        slotId: "slot-1" as const,
        logicPackId: completePack.logicPackId,
        simulationVersion: completePack.simulationVersion,
        revision: 1,
        eventCursor: fixture.started.events.length,
        updatedAt: "2026-07-29T00:00:00.000Z",
        state: invalidState,
        projection,
        receipts: new Map(),
      },
      value: undefined,
    }));
    const authority = new AuthoritativeGameService({
      pack: completePack,
      reducer: completeReducer,
      store,
      validateRecord: (record) => completeReducer.validatePersistedRecord(record),
    });

    await expect(authority.execute("route-player", "slot-1", envelope(
      "invalid_dungeon_command",
      1,
      { type: "battle.delay", battleId: decision.battleId, actorId: decision.actorId },
      decision.decisionId,
    ))).rejects.toMatchObject({ code: "STATE_CORRUPT" });
    expect((await store.read("route-player", "slot-1"))!.receipts.size).toBe(0);
  });

  it("does not return an old receipt when a legacy dungeon battle is unmappable", async () => {
    const fixture = officialDungeonBattleFixture();
    const decision = fixture.started.projection.decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no battle decision");
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV1>();
    const projection = SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 1,
      updatedAt: "2026-07-29T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: completePack.simulationVersion,
      trustTier: "official",
      ...fixture.started.projection,
    });
    await store.transact("route-player", "slot-1", async () => ({
      record: {
        playerId: "route-player",
        slotId: "slot-1" as const,
        logicPackId: completePack.logicPackId,
        simulationVersion: completePack.simulationVersion,
        revision: 1,
        eventCursor: fixture.started.events.length,
        updatedAt: "2026-07-29T00:00:00.000Z",
        state: fixture.started.state,
        projection,
        receipts: new Map(),
      },
      value: undefined,
    }));
    const authority = new AuthoritativeGameService({
      pack: completePack,
      reducer: completeReducer,
      store,
      validateRecord: (record) => completeReducer.validatePersistedRecord(record),
    });
    const oldEnvelope = envelope(
      "legacy_unmappable_receipt",
      1,
      { type: "battle.delay", battleId: decision.battleId, actorId: decision.actorId },
      decision.decisionId,
    );
    await authority.execute("route-player", "slot-1", oldEnvelope);

    const legacyBattle = legacySyntheticDungeonState(fixture.started.state, true);
    await store.transact("route-player", "slot-1", async (current) => {
      if (current === undefined) throw new Error("receipt seed was not committed");
      return {
        record: { ...current, state: legacyBattle },
        value: undefined,
      };
    });
    await expect(authority.execute("route-player", "slot-1", oldEnvelope))
      .rejects.toMatchObject({ code: "STATE_CORRUPT" });
    expect((await store.read("route-player", "slot-1"))!.receipts.has(oldEnvelope.commandId)).toBe(true);
  });

  it("rejects semantically foreign dungeon rosters before Official projection or command execution", () => {
    const fixture = officialDungeonBattleFixture();
    const originalRun = fixture.started.state.dungeon!.run;
    const encounterId = fixture.started.state.battle!.origin.kind === "dungeon"
      ? fixture.started.state.battle!.origin.encounterId
      : (() => { throw new Error("fixture is not a dungeon battle"); })();
    const foreignRoster = {
      encounterId,
      monsters: [{ type: "Dragon", level: 1 }],
    };
    const foreignCurrent = {
      ...originalRun.current,
      session: { ...originalRun.current.session, encounterRosters: [foreignRoster] },
    };
    const foreignRun = {
      ...originalRun,
      current: foreignCurrent,
      cachedFloors: originalRun.cachedFloors.map((entry) =>
        entry.route.floor === originalRun.current.route.floor
          ? { ...entry, session: foreignCurrent.session }
          : entry),
    };
    const foreignState = {
      ...fixture.started.state,
      dungeon: { ...fixture.started.state.dungeon!, run: foreignRun },
    } as OfficialGameStateV1;

    expect(() => parseOfficialGameStateV1(
      data,
      quests,
      foreignState,
      { dungeonResources: source },
    )).toThrow(/ordered subsequence|current room|Dungeon snapshot/);

    const structurallyDivergent = {
      ...foreignRun,
      cachedFloors: originalRun.cachedFloors,
    };
    expect(() => parseOfficialGameStateV1(data, quests, {
      ...fixture.started.state,
      dungeon: { ...fixture.started.state.dungeon!, run: structurallyDivergent },
    }, { dungeonResources: source })).toThrow(/disagrees/);

    const foreignCachedRun = {
      ...originalRun,
      cachedFloors: originalRun.cachedFloors.map((entry) =>
        entry.route.floor === originalRun.current.route.floor
          ? { ...entry, session: foreignCurrent.session }
          : entry),
    };
    expect(() => parseOfficialGameStateV1(data, quests, {
      ...fixture.started.state,
      dungeon: { ...fixture.started.state.dungeon!, run: foreignCachedRun },
    }, { dungeonResources: source })).toThrow(/disagrees|ordered subsequence|current room|Dungeon snapshot/);

    const decision = fixture.started.projection.decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no battle decision");
    expect(() => completeReducer.apply({
      playerId: "route-player",
      slotId: "slot-1",
      pack: completePack,
      state: foreignState,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "battle.delay",
      battleId: decision.battleId,
      actorId: decision.actorId,
    })).toThrow(/STATE_CORRUPT|ordered subsequence|Dungeon snapshot/);
  });

  it("keeps dungeon event-4 settlement before navigation and rolls back on an injected event-4 failure", () => {
    const fixture = officialDungeonBattleFixture();
    const decision = fixture.started.projection.decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no battle decision");
    const retreat: GameCommandEnvelopeV1["command"] = {
      type: "battle.retreat",
      battleId: decision.battleId,
      actorId: decision.actorId,
    };
    const before = structuredClone(fixture.started.state);
    let fail = true;
    const reducerWithFailure = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => 0,
      beforeDungeonRoomRosterUpdated: () => {
        if (fail) {
          fail = false;
          throw new Error("event-4 callback rejected");
        }
      },
    });
    const context = {
      playerId: "route-player",
      slotId: "slot-1" as const,
      pack: completePack,
      state: fixture.started.state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    };
    expect(() => reducerWithFailure.apply(context, retreat)).toThrow("event-4 callback rejected");
    expect(fixture.started.state).toEqual(before);

    const committed = reducerWithFailure.apply(context, retreat);
    const ended = committed.events.findIndex((event) => event.type === "battle.ended");
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(committed.state.location.kind).toBe("dungeon");
    expect(committed.state.dungeon?.run.current.session.encounterRosters?.[0]?.monsters)
      .toBeDefined();
  });

  it("returns the exact committed dungeon receipt on command-id retry without rerunning terminal settlement", async () => {
    const fixture = officialDungeonBattleFixture();
    const decision = fixture.started.projection.decision;
    if (decision.type !== "battle.playerTurn") throw new Error("fixture has no battle decision");
    const retreat = envelope("dungeon_terminal_retry", 1, {
      type: "battle.retreat",
      battleId: decision.battleId,
      actorId: decision.actorId,
    }, decision.decisionId);
    const seededStore = new InMemoryAuthoritativeSlotStore<OfficialGameStateV1>();
    const projection = SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 1,
      updatedAt: "2026-07-29T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: completePack.simulationVersion,
      trustTier: "official",
      ...fixture.started.projection,
    });
    await seededStore.transact("route-player", "slot-1", async () => ({
      record: {
        playerId: "route-player",
        slotId: "slot-1" as const,
        logicPackId: completePack.logicPackId,
        simulationVersion: completePack.simulationVersion,
        revision: 1,
        eventCursor: fixture.started.events.length,
        updatedAt: "2026-07-29T00:00:00.000Z",
        state: fixture.started.state,
        projection,
        receipts: new Map(),
      },
      value: undefined,
    }));
    let terminalSettlements = 0;
    const observedReducer = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => 0,
      beforeDungeonRoomRosterUpdated: () => { terminalSettlements += 1; },
    });
    const authority = new AuthoritativeGameService({
      pack: completePack,
      reducer: observedReducer,
      store: seededStore,
      validateRecord: (record) => observedReducer.validatePersistedRecord(record),
    });
    const first = await authority.execute("route-player", "slot-1", retreat);
    const replay = await authority.execute("route-player", "slot-1", retreat);
    expect(terminalSettlements).toBe(1);
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    const mismatch = structuredClone(retreat) as typeof retreat;
    (mismatch.command as { actorId?: string }).actorId = "different-actor";
    await expect(authority.execute("route-player", "slot-1", mismatch))
      .rejects.toMatchObject({ code: "COMMAND_DUPLICATE_MISMATCH" });
  });

  it("persists tutorial acknowledgements before presentation can resume", async () => {
    const authority = service();
    await authority.execute(
      "player-a",
      "slot-1",
      envelope("command_create_0001", 0, {
        type: "slot.create",
        starterElement: "Water",
      }),
    );
    const claimed = await authority.execute(
      "player-a",
      "slot-1",
      envelope("command_tutorial_0001", 1, {
        type: "player.claimTutorialFlag",
        flag: "Tutorial0",
      }),
    );
    expect(claimed.projection.player.tutorialFlags).toContain("Tutorial0");
    expect(claimed.events).toContainEqual({
      seq: 3,
      type: "player.tutorialFlagClaimed",
      flag: "Tutorial0",
    });
    await expect(authority.execute(
      "player-a",
      "slot-1",
      envelope("command_tutorial_0002", 2, {
        type: "player.claimTutorialFlag",
        flag: "Tutorial0",
      }),
    )).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
    await expect(authority.execute(
      "player-a",
      "slot-1",
      envelope("command_tutorial_0003", 2, {
        type: "player.claimTutorialFlag",
        flag: "callerInventedFlag",
      }),
    )).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
    expect((await authority.bootstrap("player-a", "slot-1")).revision).toBe(2);
  });

  it("commits an actual return to Corova as day 2 before another town departure", async () => {
    const authority = service();
    const created = await authority.execute(
      "day-two-player",
      "slot-1",
      envelope("day_two_create_001", 0, {
        type: "slot.create",
        starterElement: "Water",
      }),
    );
    const intro = await authority.execute(
      "day-two-player",
      "slot-1",
      envelope("day_two_dialog_001", created.revision, {
        type: "player.claimDialog",
        dialogId: "LeslieIntro1",
      }),
    );
    const left = await authority.execute(
      "day-two-player",
      "slot-1",
      envelope("day_two_leave_0001", intro.revision, { type: "world.leaveTown" }),
    );
    const hut = await authority.execute(
      "day-two-player",
      "slot-1",
      envelope(
        "day_two_hut_move01",
        left.revision,
        { type: "world.navigate", targetPoiId: "1-1_Turtorial_Hut_1" },
        "world-First_City",
      ),
    );
    const returned = await authority.execute(
      "day-two-player",
      "slot-1",
      envelope(
        "day_two_town_move1",
        hut.revision,
        { type: "world.navigate", targetPoiId: "First_City" },
        "world-1-1_Turtorial_Hut_1",
      ),
    );
    expect(returned.projection).toMatchObject({
      location: { kind: "town", worldId: world.name, townId: "First_City" },
      world: { currentPoiId: "First_City", lastTownId: "First_City", dayNumber: 2 },
    });
    const leftAgain = await authority.execute(
      "day-two-player",
      "slot-1",
      envelope("day_two_leave_0002", returned.revision, { type: "world.leaveTown" }),
    );
    expect(leftAgain.projection.location).toEqual({
      kind: "world",
      worldId: world.name,
      poiId: "First_City",
    });
  });

  it("upgrades the broken v2 Corova arrival without mistaking a deliberate departure", () => {
    const sourceState = partyState();
    const { quests: _omitted, ...legacyBase } = sourceState;
    const legacy = {
      ...legacyBase,
      location: {
        kind: "world" as const,
        worldId: world.name,
        poiId: "First_City",
      },
      world: {
        ...sourceState.world!,
        currentPoiId: "First_City",
        dayNumber: 1,
        completedPoiIds: ["1-1_Field_1", "1-1_Turtorial_Hut_1", "First_City"],
        poiWins: { "1-1_Field_1": 1 },
        everCompletedPoiIds: ["1-1_Field_1", "1-1_Turtorial_Hut_1", "First_City"],
      },
    };
    const migrated = reducer.migrateV2State(legacy, {
      updatedAt: new Date(250_000).toISOString(),
      lastLocationCommand: { type: "world.navigate", targetPoiId: "First_City" },
    });
    expect(migrated.state.location).toEqual({
      kind: "town",
      worldId: world.name,
      townId: "First_City",
    });
    expect(migrated.state.world?.dayNumber).toBe(2);
    expect(migrated.state.quests.dialogsSeen).toEqual(
      expect.arrayContaining(["Leslie", "LeslieSaved"]),
    );
    expect(migrated.projection.quests?.dialogsSeen).toContain("LeslieSaved");
    for (const monster of migrated.projection.player.party) {
      expect(monster.hp).toBe(monster.maxHp);
    }

    const departed = reducer.migrateV2State(legacy, {
      updatedAt: new Date(250_000).toISOString(),
      lastLocationCommand: { type: "world.leaveTown" },
    });
    expect(departed.state.location).toEqual(legacy.location);
    expect(departed.state.world?.dayNumber).toBe(1);
  });

  it("binds capability preflight to the exact installed data and world objects", () => {
    expect(() => new OfficialGameReducer({
      data,
      world: structuredClone(world),
      quests,
      startTownId: "First_City",
      support,
      random: () => 0,
    })).toThrow(/support report does not match/);
    expect(() => createOfficialLogicPackDescriptor(
      `logic-v1:${"b".repeat(64)}`,
      {
        worldId: world.name,
        worldIds: [world.name],
        dungeonIds: [],
        startTownId: "First_City",
        commandTypes: [],
        tutorialFlags: [],
        questIds: [],
      },
    )).toThrow(/not produced by validateOfficialGameSupport/);
  });

  it("advertises the installed v11 Tournament authority and legacy settlement command", () => {
    expect(completePack.simulationVersion).toBe("official-game-v11");
    expect(completePack.capabilities.tournaments).toBe(true);
    expect(completePack.capabilities.commandTypes).toContain("tournament.startBattle");
    expect(completePack.capabilities.commandTypes).toContain("tournament.claimPrize");
    expect(completePack.capabilities.commandTypes).toContain("tournament.settlePrize");
  });

  it("disables Tournament authority and command types when no tournaments are authored", () => {
    const noTournamentData = Object.create(data, {
      allTournaments: { value: () => [] },
    }) as typeof data;
    const noTournamentSupport = validateOfficialGameSupport({
      data: noTournamentData,
      world,
      worlds: allWorlds,
      quests,
      startTownId: "First_City",
    });
    const noTournamentPack = createOfficialLogicPackDescriptor(
      `logic-v1:${"d".repeat(64)}`,
      noTournamentSupport,
    );
    expect(noTournamentPack.capabilities.tournaments).toBe(false);
    expect(noTournamentPack.capabilities.commandTypes).not.toContain("tournament.startBattle");
    expect(noTournamentPack.capabilities.commandTypes).not.toContain("tournament.claimPrize");
    expect(noTournamentPack.capabilities.commandTypes).not.toContain("tournament.settlePrize");
  });

  it("rejects a fabricated party member atomically without advancing revision", async () => {
    const authority = service();
    await authority.execute(
      "player-a",
      "slot-1",
      envelope("command_create_0001", 0, {
        type: "slot.create",
        starterElement: "Water",
      }),
    );
    await expect(authority.execute(
      "player-a",
      "slot-1",
      envelope("command_order_bad01", 1, {
        type: "party.commitBattingPriority",
        activeInstanceIds: ["invented-monster"],
      }),
    )).rejects.toMatchObject({ code: "ENTITY_NOT_FOUND" });
    expect((await authority.bootstrap("player-a", "slot-1")).revision).toBe(1);
  });

  it("derives combine result identity and recipe ingredients on the server", () => {
    const state = partyState();
    const recipe = data.allCombineRecipes()[0]!;
    const reduced = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state,
      previousRevision: 9,
      now: new Date(150_000).toISOString(),
    }, {
      type: "party.combine",
      resultTypeId: recipe.resultShortType,
      firstInstanceId: "ingredient-1",
      secondInstanceId: "ingredient-2",
    });
    expect(reduced.state.nextMonsterSequence).toBe(5);
    expect(reduced.projection.player.party).toEqual(expect.arrayContaining([
      expect.objectContaining({
        instanceId: "monster-4",
        shortType: recipe.resultShortType,
        level: 1,
      }),
    ]));
    expect(reduced.events.at(-1)).toMatchObject({
      type: "player.monsterAdded",
      instanceId: "monster-4",
      reason: "combine",
    });
  });

  it("derives live injury price from server time and commits gold plus healing together", () => {
    const state = partyState();
    const reduced = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state,
      previousRevision: 3,
      now: new Date(150_000).toISOString(),
    }, { type: "party.healInjury", instanceId: "keeper" });
    expect(reduced.projection.player.gold).toBe(75);
    expect(reduced.projection.player.party.find((monster) => monster.instanceId === "keeper"))
      .not.toHaveProperty("injuredUntil");
    expect(reduced.events).toEqual([
      { type: "player.currencyChanged", currency: "gold", delta: -25, balance: 75 },
      { type: "party.injuryHealed", instanceId: "keeper", goldCost: 25 },
    ]);
  });

  it("keeps soul-stone creation and inventory consumption authoritative", () => {
    const original = partyState();
    const converted = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state: original,
      previousRevision: 3,
      now: new Date(150_000).toISOString(),
    }, { type: "party.convertToSoulStone", instanceId: "ingredient-1" });
    const stoneId = converted.projection.player.ownedSoulStones[0]!.stoneId;
    const equipped = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state: converted.state,
      previousRevision: 4,
      now: new Date(150_000).toISOString(),
    }, { type: "party.insertSoulStone", instanceId: "keeper", stoneId });
    expect(equipped.projection.player.ownedSoulStones).toEqual([]);
    expect(equipped.projection.player.party.find((monster) => monster.instanceId === "keeper"))
      .toHaveProperty("soulStone");
  });

  it("revives only the authoritative Life-stone target by the stone's MaxHP bonus", () => {
    const original = partyState();
    const state: OfficialGameStateV1 = {
      ...original,
      party: {
        ...original.party,
        monsters: original.party.monsters.map((monster) => monster.instanceId === "keeper"
          ? { ...monster, currentHp: 0 }
          : { ...monster }),
        ownedSoulStones: [{ element: "Life", level: 4 }],
      },
    };
    const projected = reducer.projectPersistedState(state);
    const stoneId = projected.player.ownedSoulStones[0]!.stoneId;
    const otherBefore = projected.player.party.find(
      (monster) => monster.instanceId === "ingredient-1",
    )!.hp;
    const equipped = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state,
      previousRevision: 3,
      now: new Date(150_000).toISOString(),
    }, { type: "party.insertSoulStone", instanceId: "keeper", stoneId });
    expect(equipped.projection.player.party.find((monster) => monster.instanceId === "keeper"))
      .toMatchObject({ hp: 4, soulStone: { element: "Life", level: 4 } });
    expect(equipped.projection.player.party.find(
      (monster) => monster.instanceId === "ingredient-1",
    )!.hp).toBe(otherBefore);
  });

  it("commits quest progress and completion presentation events with the mutation", () => {
    const original = partyState();
    const active = new GuildQuestRuntime(quests, original.quests);
    expect(active.startQuest("MakeASoulstone")).toBe(true);
    const state: OfficialGameStateV1 = {
      ...original,
      quests: active.stateSnapshot(),
    };
    const converted = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state,
      previousRevision: 3,
      now: new Date(150_000).toISOString(),
    }, { type: "party.convertToSoulStone", instanceId: "ingredient-1" });

    expect(converted.projection.quests?.progressByQuestName.MakeASoulstone).toEqual({
      quantity: 1,
    });
    expect(converted.events).toEqual(expect.arrayContaining([
      {
        type: "quest.progressed",
        questId: "MakeASoulstone",
        current: 1,
        required: 1,
      },
      {
        type: "quest.completed",
        questId: "MakeASoulstone",
      },
    ]));
    expect(converted.events.findIndex((event) => event.type === "quest.progressed"))
      .toBeLessThan(converted.events.findIndex((event) => event.type === "quest.completed"));
  });

  it("owns Corova quest acceptance, fails closed on unimplemented authoritative eggs, and drops", () => {
    const unlocked = partyState();
    expect(() => reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state: unlocked,
      previousRevision: 2,
      now: new Date(150_000).toISOString(),
    }, { type: "quest.accept", questId: "MacworldCatch" })).toThrow(
      /Guild quests are unavailable/,
    );
    const unlockedQuests = new GuildQuestRuntime(quests, unlocked.quests);
    unlockedQuests.requestChatPresentation("LeslieSaved", false);
    unlockedQuests.requestChatPresentation("LeslieIntro1", false);
    const unlockedState: OfficialGameStateV1 = {
      ...unlocked,
      quests: unlockedQuests.stateSnapshot(),
    };
    expect(() => reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state: unlockedState,
      previousRevision: 3,
      now: new Date(150_000).toISOString(),
    }, { type: "player.claimDialog", dialogId: "LeslieIntro3" })).toThrow(
      /not the next town story dialog/,
    );
    const dialog = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state: unlockedState,
      previousRevision: 3,
      now: new Date(150_000).toISOString(),
    }, { type: "player.claimDialog", dialogId: "LeslieIntro2" });
    expect(dialog.events).toContainEqual({
      type: "player.dialogClaimed",
      dialogId: "LeslieIntro2",
    });
    const accepted = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state: dialog.state,
      previousRevision: 4,
      now: new Date(150_000).toISOString(),
    }, { type: "quest.accept", questId: "MacworldCatch" });
    expect(accepted.projection.quests?.activeQuestNames).toEqual(["MacworldCatch"]);
    expect(accepted.events).toContainEqual({
      type: "quest.accepted",
      questId: "MacworldCatch",
    });

    const active = new GuildQuestRuntime(quests, accepted.state.quests);
    active.fireEvent({ id: 7, monsterShortType: "Goblin" });
    const claimable: OfficialGameStateV1 = {
      ...accepted.state,
      quests: active.stateSnapshot(),
    };
    expect(() => reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state: claimable,
      previousRevision: 5,
      now: new Date(150_000).toISOString(),
    }, { type: "quest.claim", questId: "MacworldCatch" })).toThrow(
      /authoritative egg hatch commands/,
    );
    expect(parseOfficialGameStateV1(
      data,
      quests,
      structuredClone(claimable),
    )).toEqual(claimable);

    const dropped = reducer.apply({
      playerId: "player-a",
      slotId: "slot-1",
      pack,
      state: claimable,
      previousRevision: 6,
      now: new Date(150_000).toISOString(),
    }, { type: "quest.dropAll" });
    expect(dropped.projection.quests?.activeQuestNames).toEqual([]);
    expect(dropped.events).toContainEqual({ type: "quest.droppedAll" });
  });

  it("runs create through server encounter, battle replay, atomic settlement, and exact retry", async () => {
    const authority = service();
    const created = await authority.execute(
      "flow-player",
      "slot-1",
      envelope("flow_create_000001", 0, {
        type: "slot.create",
        starterElement: "Water",
      }),
    );
    const leftTown = await authority.execute(
      "flow-player",
      "slot-1",
      envelope("flow_leave_town01", created.revision, { type: "world.leaveTown" }),
    );
    expect(leftTown.projection.decision.type).toBe("world.ready");
    if (leftTown.projection.decision.type !== "world.ready") throw new Error("world decision missing");
    let entered = leftTown;
    for (let move = 0; move < 20 && entered.projection.location.kind === "world"; move += 1) {
      const decision = entered.projection.decision;
      if (decision.type !== "world.ready") throw new Error("world decision missing during traversal");
      const currentPoiId = entered.projection.world!.currentPoiId;
      const targetPoiId =
        decision.selectablePoiIds.find((poiId) =>
          poiId !== currentPoiId &&
          world.pointsOfInterest.find((poi) => poi.name === poiId)?.town === undefined &&
          (world.pointsOfInterest.find((poi) => poi.name === poiId)?.randomPopulators.length ?? 0) > 0) ??
        decision.selectablePoiIds.find((poiId) => poiId !== currentPoiId);
      if (targetPoiId === undefined) throw new Error("world traversal has no noncurrent target");
      entered = await authority.execute(
        "flow-player",
        "slot-1",
        envelope(
          `flow_world_${String(move).padStart(6, "0")}`,
          entered.revision,
          { type: "world.navigate", targetPoiId },
          decision.decisionId,
        ),
      );
    }
    expect(entered.projection.location.kind).toBe("battle");
    expect(entered.projection.battle).toBeDefined();
    expect(JSON.stringify(entered.projection.battle)).not.toContain('"seed"');
    expect(await authority.bootstrap("flow-player", "slot-1")).toEqual(entered.projection);

    let result = entered;
    let terminalEnvelope: GameCommandEnvelopeV1 | undefined;
    for (let turn = 0; turn < 200 && result.projection.location.kind === "battle"; turn += 1) {
      const decision = result.projection.decision;
      if (decision.type !== "battle.playerTurn") {
        throw new Error(`battle has no player decision at turn ${turn}`);
      }
      const capture = decision.captureTargets[0];
      const choice = decision.choices.find((candidate) => candidate.blockedReasonId === undefined)!;
      const abilityTargets = choice.target.kind === "enemies"
        ? decision.enemyTargetIds.slice(0, choice.target.count)
        : choice.target.kind === "friends"
          ? decision.friendlyTargetIds.slice(0, choice.target.count)
          : choice.target.kind === "mixed"
            ? [
                ...decision.enemyTargetIds.slice(0, choice.target.enemyCount),
                ...decision.friendlyTargetIds.slice(0, choice.target.friendlyCount),
              ]
            : [];
      const command: GameCommandEnvelopeV1["command"] = capture !== undefined && turn < 2
        ? {
            type: "battle.attemptCapture",
            battleId: decision.battleId,
            actorId: decision.actorId,
            targetId: capture.targetId,
            cardLevel: capture.availableCardLevels[0]!,
          }
        : {
            type: "battle.chooseAbility",
            battleId: decision.battleId,
            actorId: decision.actorId,
            slot: choice.slot,
            targetIds: abilityTargets,
          };
      const nextEnvelope = envelope(
        `flow_battle_${String(turn).padStart(6, "0")}`,
        result.revision,
        command,
        decision.decisionId,
      );
      result = await authority.execute("flow-player", "slot-1", nextEnvelope);
      const replayAdvanced = result.events.find((event) => event.type === "battle.replayAdvanced");
      expect(replayAdvanced).toBeDefined();
      if (replayAdvanced?.type === "battle.replayAdvanced") {
        expect(replayAdvanced.randomDraws).toHaveLength(replayAdvanced.committedDrawCount);
      }
      if (result.projection.location.kind !== "battle") terminalEnvelope = nextEnvelope;
    }
    expect(result.projection.location.kind).not.toBe("battle");
    const ended = result.events.find((event) => event.type === "battle.ended");
    expect(ended).toMatchObject({ type: "battle.ended", outcome: "victory" });
    expect(result.projection.quests?.dialogsSeen).toContain("LeslieSaved");
    expect(terminalEnvelope).toBeDefined();
    const replay = await authority.execute("flow-player", "slot-1", terminalEnvelope!);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.revision).toBe(result.revision);
    expect(replay.events).toEqual(result.events);
    expect(replay.projection).toEqual(result.projection);
  });

  it("strictly round-trips every v12 Egg phase and pending defeat before ordinary decisions", () => {
    const prize = { kind: "gold" as const, amount: 25 };
    const phases: readonly OfficialEggContinuation[] = [
      {
        schemaVersion: 1,
        continuationId: "continuation-1",
        decisionId: "decision-1",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "awaiting-spin",
      },
      {
        schemaVersion: 1,
        continuationId: "continuation-2",
        decisionId: "decision-2",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "spinning",
        providers: [prize],
        reel: [prize],
        previewMonsterShortTypes: [],
      },
      {
        schemaVersion: 1,
        continuationId: "continuation-3",
        decisionId: "decision-3",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "awaiting-prize-resolution",
        providers: [prize],
        reel: [prize],
        previewMonsterShortTypes: [],
        finalReelState: {
          elapsedSeconds: 1.5,
          index: 0,
          speed: 0,
          friction: 0,
          centerIndex: 0,
          stopped: true,
        },
        landedPrize: prize,
      },
      {
        schemaVersion: 1,
        continuationId: "continuation-4",
        decisionId: "decision-4",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "awaiting-repeat-or-finish",
        settledPrize: prize,
        resolution: { kind: "keep" },
      },
    ];

    for (const pendingEgg of phases) {
      const state: OfficialGameStateV12 = {
        ...partyStateV12Core(),
        collectionClaims: { schemaVersion: 1, claimedGoalIds: ["CollectionQuestCollector"] },
        pendingEgg,
        nextContinuationSequence: 20,
      };
      const restored = parseOfficialGameStateV12(data, quests, state);
      const projection = projectOfficialGameStateV12(completeReducer, restored);
      expect(restored.pendingEgg).toEqual(pendingEgg);
      expect(projection.pendingEgg).toEqual(pendingEgg);
      expect(projection.decision).toMatchObject({
        decisionId: pendingEgg.decisionId,
        continuationId: pendingEgg.continuationId,
      });
      expect(projection.decision.type).toBe([
        "egg.awaitingSpin",
        "egg.spinning",
        "egg.awaitingPrizeResolution",
        "egg.awaitingRepeatOrFinish",
      ][phases.indexOf(pendingEgg)]);

      const reparsed = cloneOfficialGameStateV12(data, quests, restored);
      expect(projectOfficialGameStateV12(completeReducer, reparsed)).toEqual(projection);
      expect(reparsed).not.toBe(restored);
      expect(reparsed.pendingEgg).not.toBe(restored.pendingEgg);
    }

    const defeatRestored = finishV12DungeonDefeat(officialDungeonBattleFixture(), {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    }).state;
    const pendingDefeat = defeatRestored.pendingDefeat;
    if (pendingDefeat === undefined) throw new Error("round-trip fixture has no pending defeat");
    const defeatProjection = projectOfficialGameStateV12(completeReducer, defeatRestored);
    expect(defeatProjection.decision).toEqual({
      type: "battle.defeatRecovery",
      decisionId: pendingDefeat.decisionId,
      battleId: pendingDefeat.battleId,
      canSaveMe: true,
    });
    expect(defeatProjection.pendingDefeat).toEqual(pendingDefeat);
    expect(projectOfficialGameStateV12(
      completeReducer,
      cloneOfficialGameStateV12(data, quests, defeatRestored, { dungeonResources: source }),
    )).toEqual(defeatProjection);
  });

  it("requires canonical versioned Collection claims and never adds them to profile schema 6", () => {
    const state: OfficialGameStateV12 = {
      ...partyStateV12Core(),
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: ["CollectionQuestCollector"],
      },
      nextContinuationSequence: 1,
    };
    const { collectionClaims: _missing, ...missingClaims } = state;
    expect(() => parseOfficialGameStateV12(data, quests, missingClaims)).toThrow(/collectionClaims/i);
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: { schemaVersion: 2, claimedGoalIds: [] },
    })).toThrow(/collection claims|schema/i);
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: "not-an-array" },
    })).toThrow(/collection claims|array/i);
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: ["CollectionQuestUsualSuspects", "CollectionQuestCollector"],
      },
    })).toThrow(/canonical|sorted/i);
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: ["CollectionQuestCollector", "CollectionQuestCollector"],
      },
    })).toThrow(/duplicate|canonical/i);
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [""] },
    })).toThrow(/non-empty|claim/i);

    const parsed = parseOfficialGameStateV12(data, quests, state);
    expect(parsed.collectionClaims).toEqual(state.collectionClaims);
    expect((parsed.profile as unknown as Record<string, unknown>).collectionClaims).toBeUndefined();
  });

  it("uses the shared identifier wire bound without inventing a gameplay cardinality limit", () => {
    const state: OfficialGameStateV12 = {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    };
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: ["a".repeat(161)],
      },
    })).toThrow(/identifier|length|protocol|big/i);
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: Array.from({ length: 513 }, (_, index) => `CollectionQuest${index}`).sort(),
      },
    })).not.toThrow();
    expect(validateOfficialCollectionCatalog(["a".repeat(160)]).goalIds)
      .toEqual(["a".repeat(160)]);
    expect(() => validateOfficialCollectionCatalog(["a".repeat(161)])).toThrow(/identifier|length|big/i);
    expect(() => validateOfficialCollectionCatalog(["Collection/Quest"])).toThrow(/identifier|wire|invalid|pattern/i);
    expect(validateOfficialCollectionCatalog(
      Array.from({ length: 513 }, (_, index) => `catalog-goal-${index}`),
    ).goalIds).toHaveLength(513);
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...state,
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: ["Collection/Quest"],
      },
    })).toThrow(/identifier|protocol|invalid|pattern/i);
  });

  it("binds future v12 Collection advertisement to an opaque validated catalog proof", () => {
    const withoutCollection = createOfficialGameV12Support({ support: completeSupport });
    expect(withoutCollection.commandTypes).not.toContain("collection.claim");
    expect(completeSupport.commandTypes).not.toContain("egg.start");
    expect(completePack.capabilities.commandTypes).not.toContain("egg.start");
    expect(withoutCollection.commandTypes).toEqual(expect.arrayContaining([
      "egg.start",
      "egg.release",
      "egg.resolvePrize",
      "egg.repeat",
      "egg.finish",
    ]));
    expect(withoutCollection.commandTypes.filter((type) => type.startsWith("egg."))).toEqual([
      "egg.start",
      "egg.release",
      "egg.resolvePrize",
      "egg.repeat",
      "egg.finish",
    ]);
    expect(withoutCollection.eggSupport).toMatchObject({
      kinds: ["silver", "gold"],
      loadedOrigins: expect.arrayContaining([
        "store", "tournament", "battle", "quest", "dungeonTreasure", "dungeonCatch",
      ]),
      handoffOrigins: ["collection"],
      loadedSource: "operator-data",
    });
    expect(() => createOfficialGameV12Support({
      support: completeSupport,
      commandTypes: ["collection.claim"],
    })).toThrow(/catalog|proof|validated/i);

    const unvalidated = { goalIds: ["catalog-goal-1"] } as never;
    expect(() => createOfficialGameV12Support({
      support: completeSupport,
      commandTypes: ["collection.claim"],
      collectionCatalog: unvalidated,
    })).toThrow(/catalog|proof|validated/i);

    const catalog = validateOfficialCollectionCatalog([
      "catalog-goal-2",
      "catalog-goal-1",
    ]);
    expect(() => createOfficialGameV12Support({
      support: completeSupport,
      commandTypes: ["collection.claim"],
      collectionCatalog: catalog,
    })).toThrow(/catalog|support|exact|validated/i);
    const withCollection = createOfficialGameV12Support({
      support: completeSupport,
      commandTypes: ["collection.claim"],
      collectionCatalog: completeCollectionProof,
    });
    expect(withCollection.commandTypes).toContain("collection.claim");
    const withCollectionPack = createOfficialGameV12LogicPackDescriptor(
      `logic-v1:${"7".repeat(64)}`,
      withCollection,
    );
    expect(withCollectionPack.capabilities.commandTypes).toContain("collection.claim");
    expect(withCollectionPack.capabilities.commandTypes.filter((type) => type.startsWith("egg.")))
      .toEqual([
        "egg.start",
        "egg.release",
        "egg.resolvePrize",
        "egg.repeat",
        "egg.finish",
      ]);
    expect(completeV12Pack.capabilities.commandTypes).toContain("collection.claim");
  });

  it("requires a runtime-bound loaded Egg proof for every v12 descriptor/reducer pair", () => {
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
      pendingEgg: {
        schemaVersion: 1,
        continuationId: "runtime-proof-continuation",
        decisionId: "runtime-proof-decision",
        kind: "silver",
        origin: "quest",
        remainingRepeats: 1,
        phase: "awaiting-spin",
      },
    });
    const handAuthoredPack = {
      ...completeV12Pack,
      logicPackId: `logic-v1:${"9".repeat(64)}`,
    } as LogicPackDescriptorV1;
    expect(() => new OfficialGameV12Reducer(completeReducer, undefined as never).apply({
      playerId: "runtime-proof-player",
      slotId: "slot-1",
      pack: handAuthoredPack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "egg.start" })).toThrow(/proof|descriptor|support|advertised/i);

    const forgedSupport = {
      ...completeV12Support,
      eggSupport: { ...completeV12Support.eggSupport },
    } as typeof completeV12Support;
    expect(() => createOfficialGameV12LogicPackDescriptor(
      `logic-v1:${"8".repeat(64)}`,
      forgedSupport,
    )).toThrow(/proof|support/i);

    const tamperedPack = {
      ...completeV12Pack,
      capabilities: { ...completeV12Pack.capabilities, economy: false },
    } as LogicPackDescriptorV1;
    expect(() => v12Reducer().apply({
      playerId: "runtime-proof-player",
      slotId: "slot-1",
      pack: tamperedPack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "egg.start" })).toThrow(/proof|descriptor|advertised/i);

    expect(() => v12Reducer().apply({
      playerId: "runtime-proof-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "egg.start" })).not.toThrow();

    const exactClone = JSON.parse(JSON.stringify(completeV12Pack)) as LogicPackDescriptorV1;
    expect(() => v12Reducer().apply({
      playerId: "runtime-proof-player",
      slotId: "slot-1",
      pack: exactClone,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "egg.start" })).toThrow(/proof|descriptor|advertised/i);

    const alternateData = loadGameData();
    const alternateSupport = validateOfficialGameSupport({
      data: alternateData,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
    });
    const alternateV12Support = createOfficialGameV12Support({ support: alternateSupport });
    expect(() => new OfficialGameV12Reducer(completeReducer, alternateV12Support))
      .toThrow(/exact|support|loaded/i);
  });

  it("keeps structural preflight private and independently exercises every loaded reference family", () => {
    const proof = completeV12Support.eggSupport;
    expect(proof).not.toHaveProperty("providerCandidates");
    expect(proof).not.toHaveProperty("loadedDefinitions");
    expect(Object.isFrozen(proof)).toBe(true);
    expect(Object.isFrozen(proof.authoredEggBatches)).toBe(true);
    expect(proof.loadedSource).toBe("operator-data");
    expect(proof.kinds).toEqual(["silver", "gold"]);

    // This traversal is an independent loaded-catalog check. It is deliberately not compared
    // with proof internals and does not ask the engine to select or settle a provider.
    for (const monster of data.allMonsters()) {
      expect(data.monsterByShortType(monster.shortType)).toBe(monster);
      expect(data.evolveChainOf(monster.shortType).length).toBeGreaterThan(0);
    }
    for (const recipe of data.allCombineRecipes()) {
      expect(data.combineRecipe(recipe.resultShortType)).toBe(recipe);
      expect(data.monsterByShortType(recipe.resultShortType)).toBeDefined();
    }
    for (const item of data.allItems()) expect(data.item(item.path)).toBe(item);
    expect(data.item("Usables.CardSilver")).toBeDefined();
    expect(data.item("Usables.CardGold")).toBeDefined();
    expect(data.allMonsters().filter(({ category }) => category === "Summon").length)
      .toBeGreaterThan(0);
    expect(proof.authoredEggBatches.every((batch) => Object.isFrozen(batch))).toBe(true);
  });

  it("fails v12 Egg advertisement on a loaded operator fixture with two reachable Eggs", () => {
    for (const options of [
      { battleRewardKey: "operator-two-battle", twoEggReward: true },
      { treasureReward: "egg" as const, twoEggReward: true },
    ]) {
      const authority = minimalOperatorEggContentAuthority(options);
      const badSupport = validateOfficialGameSupport({
        data,
        world,
        worlds: allWorlds,
        resources: authority.resources,
        quests,
        startTownId: "First_City",
      });
      expect(() => createOfficialGameV12Support({ support: badSupport }))
        .toThrow(/multiple Egg|multiple.*Egg|Egg outcomes/i);
    }
  });

  it("fails closed for invalid Tournament, quest, and dungeon-catch Egg plans before admission", () => {
    const invalidTreasure = {
      items: [
        { chance: 1, data: { type: "DestroyOnPickup.Egg" }, spawnType: "fixed" },
        { chance: 1, data: { type: "DestroyOnPickup.MonsterEgg" }, spawnType: "fixed" },
      ],
    };
    const tournamentData = Object.create(data, {
      allTournaments: {
        value: () => data.allTournaments().map((tournament, index) => index === 0
          ? { ...tournament, treasureData: invalidTreasure }
          : tournament),
      },
    }) as typeof data;
    const questCatalog = Object.create(quests, {
      definitions: {
        value: quests.definitions.map((quest, index) => index === 0
          ? { ...quest, treasureData: invalidTreasure }
          : quest),
      },
    }) as typeof quests;
    const dungeonCatch = minimalOperatorEggContentAuthority({
      treasureReward: "egg",
      catchTwoEggReward: true,
    });
    const cases: readonly {
      readonly label: string;
      readonly support: OfficialGameSupportReport;
    }[] = [
      {
        label: "Tournament",
        support: validateOfficialGameSupport({
          data: tournamentData,
          world,
          worlds: allWorlds,
          resources: source,
          quests,
          startTownId: "First_City",
        }),
      },
      {
        label: "quest",
        support: validateOfficialGameSupport({
          data,
          world,
          worlds: allWorlds,
          resources: source,
          quests: questCatalog,
          startTownId: "First_City",
        }),
      },
      {
        label: "dungeon catch",
        support: validateOfficialGameSupport({
          data,
          world,
          worlds: allWorlds,
          resources: dungeonCatch.resources,
          quests,
          startTownId: "First_City",
        }),
      },
    ];
    for (const { label, support: invalidSupport } of cases) {
      expect(() => createOfficialGameV12Support({ support: invalidSupport }), label)
        .toThrow(/multiple Egg|multiple.*Egg|Egg outcomes/i);
    }
  });

  it("replays the committed reel before settling and rejects substituted valid prizes atomically", () => {
    const reelPrize = { kind: "gold" as const, amount: 50 };
    for (const landedPrize of [
      { kind: "gold" as const, amount: 150 },
      { kind: "silver" as const, amount: 500 },
    ]) {
      const state = parseOfficialGameStateV12(data, quests, {
        ...partyStateV12Core(),
        collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
        nextContinuationSequence: 20,
        pendingEgg: {
          schemaVersion: 1,
          continuationId: "landing-replay-continuation",
          decisionId: "landing-replay-decision",
          kind: "silver",
          origin: "quest",
          remainingRepeats: 1,
          phase: "awaiting-prize-resolution",
          providers: [reelPrize],
          reel: [reelPrize],
          previewMonsterShortTypes: [],
          finalReelState: {
            elapsedSeconds: 4.7,
            index: 0,
            speed: -2,
            friction: 3,
            centerIndex: 0,
            stopped: true,
          },
          landedPrize,
        },
      });
      const before = structuredClone(state);
      expect(() => v12Reducer().apply({
        playerId: "landing-replay-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, { type: "egg.resolvePrize", resolution: { kind: "keep" } }))
        .toThrow(/landing|reel|disagrees/i);
      expect(state).toEqual(before);
    }
  });

  it("uses a durable continuation sequence and clones without aliases", () => {
    const state: OfficialGameStateV12 = {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 37,
    };
    const canonical = parseOfficialGameStateV12(data, quests, state);
    const clone = cloneOfficialGameStateV12(data, quests, canonical);
    expect(clone).toEqual(canonical);
    expect(clone).not.toBe(canonical);
    expect(clone.profile).not.toBe(canonical.profile);
    expect(clone.collectionClaims).not.toBe(canonical.collectionClaims);
    const aggregate = OfficialGameV12Aggregate.restore(data, quests, canonical);
    expect(aggregate.hasCollectionClaim("CollectionQuestCollector")).toBe(false);
    expect(aggregate.collectionClaimsSnapshot()).toEqual([]);
    expect(aggregate.state).toEqual(canonical);
    expect(aggregate.state).not.toBe(canonical);
    expect(aggregate.clone().state).toEqual(canonical);

    const first = allocateOfficialContinuationIdentity(clone);
    expect(first.allocation).toEqual({
      continuationId: "continuation-37",
      decisionId: "decision-37",
      nextContinuationSequence: 38,
    });
    expect(first.state.nextContinuationSequence).toBe(38);
    const restoredAfterFirst = parseOfficialGameStateV12(data, quests, first.state);
    const second = allocateOfficialContinuationIdentity(restoredAfterFirst);
    expect(second.allocation).toEqual({
      continuationId: "continuation-38",
      decisionId: "decision-38",
      nextContinuationSequence: 39,
    });
    expect(second.state.nextContinuationSequence).toBe(39);
    expect(() => allocateOfficialContinuationIdentity({
      ...clone,
      nextContinuationSequence: Number.MAX_SAFE_INTEGER,
    })).toThrow(/exhausted|overflow|safe/i);
    expect(clone.nextMonsterSequence).toBe(canonical.nextMonsterSequence);
    expect(clone.nextContinuationSequence).toBe(37);
  });

  it("projects strict v12 claims, rejects projection extras, and detaches nested graphs", () => {
    const state: OfficialGameStateV12 = {
      ...partyStateV12Core(),
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: ["CollectionQuestCollector"],
      },
      pendingEgg: {
        schemaVersion: 1,
        continuationId: "continuation-projection-1",
        decisionId: "decision-projection-1",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "awaiting-spin",
      },
      nextContinuationSequence: 2,
    };
    const raw = structuredClone(state) as unknown as Record<string, unknown>;
    const rawClaims = raw.collectionClaims as { claimedGoalIds: string[] };
    const rawEgg = raw.pendingEgg as { continuationId: string };
    const parsed = parseOfficialGameStateV12(data, quests, raw);
    const projection = projectOfficialGameStateV12(completeReducer, parsed);
    expect(projection.collectionClaims).toEqual(state.collectionClaims);
    expect(parseOfficialGameProjectionV12(projection)).toEqual(projection);
    expect(() => parseOfficialGameProjectionV12({
      ...projection,
      unexpected: true,
    })).toThrow(/unrecognized|unknown|unsupported|unexpected/i);
    expect(() => parseOfficialGameProjectionV12({
      ...projection,
      collectionClaims: {
        ...projection.collectionClaims,
        unexpected: true,
      },
    })).toThrow(/unsupported|unexpected|unrecognized|collection claims/i);

    rawClaims.claimedGoalIds.push("CollectionQuestUsualSuspects");
    rawEgg.continuationId = "mutated-after-parse";
    expect(parsed.collectionClaims.claimedGoalIds).toEqual(["CollectionQuestCollector"]);
    expect(parsed.pendingEgg?.continuationId).toBe("continuation-projection-1");

    const detachedProjection = parseOfficialGameProjectionV12(projection);
    (detachedProjection.collectionClaims.claimedGoalIds as string[]).push(
      "CollectionQuestUsualSuspects",
    );
    if (detachedProjection.pendingEgg?.phase === "awaiting-spin") {
      detachedProjection.pendingEgg.continuationId = "mutated-projection";
    }
    expect(projection.collectionClaims.claimedGoalIds).toEqual(["CollectionQuestCollector"]);
    expect(projection.pendingEgg?.continuationId).toBe("continuation-projection-1");
  });

  it("enforces the Task 2 Egg phase/origin/repeat truth table on v12 restore", () => {
    const base = {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    };
    const nonStoreOrigins = ["collection", "tournament", "battle", "quest", "dungeonTreasure", "dungeonCatch"] as const;
    for (const origin of nonStoreOrigins) {
      expect(() => parseOfficialGameStateV12(data, quests, {
        ...base,
        pendingEgg: {
          schemaVersion: 1,
          continuationId: `${origin}-invalid-continuation`,
          decisionId: `${origin}-invalid-decision`,
          kind: "silver",
          origin,
          remainingRepeats: 0,
          phase: "awaiting-spin",
        },
      })).toThrow(/remaining repeat|awaiting-spin|one remaining/i);
    }

    const phasesWithZero: readonly OfficialEggContinuation[] = [
      {
        schemaVersion: 1,
        continuationId: "post-repeat-spinning",
        decisionId: "post-repeat-spinning-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 0,
        phase: "spinning",
        providers: [protocolGoldPrize],
        reel: [protocolGoldPrize],
        previewMonsterShortTypes: [],
      },
      {
        schemaVersion: 1,
        continuationId: "post-repeat-resolution",
        decisionId: "post-repeat-resolution-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 0,
        phase: "awaiting-prize-resolution",
        providers: [protocolGoldPrize],
        reel: [protocolGoldPrize],
        previewMonsterShortTypes: [],
        finalReelState: {
          elapsedSeconds: 1,
          index: 0,
          speed: 0,
          friction: 0,
          centerIndex: 0,
          stopped: true,
        },
        landedPrize: protocolGoldPrize,
      },
      {
        schemaVersion: 1,
        continuationId: "post-repeat-settled",
        decisionId: "post-repeat-settled-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 0,
        phase: "awaiting-repeat-or-finish",
        settledPrize: protocolGoldPrize,
        resolution: { kind: "keep" },
      },
    ];
    for (const pendingEgg of phasesWithZero) {
      expect(parseOfficialGameStateV12(data, quests, { ...base, pendingEgg }).pendingEgg)
        .toEqual(pendingEgg);
    }
    for (const phase of [
      "awaiting-spin",
      "spinning",
      "awaiting-prize-resolution",
      "awaiting-repeat-or-finish",
    ] as const) {
      const pendingEgg = phase === "awaiting-spin"
        ? {
            schemaVersion: 1 as const,
            continuationId: `store-${phase}`,
            decisionId: `store-${phase}-decision`,
            kind: "silver" as const,
            origin: "store" as const,
            remainingRepeats: 0 as const,
            phase,
          }
        : phase === "spinning"
          ? {
              schemaVersion: 1 as const,
              continuationId: `store-${phase}`,
              decisionId: `store-${phase}-decision`,
              kind: "silver" as const,
              origin: "store" as const,
              remainingRepeats: 0 as const,
              phase,
              providers: [protocolGoldPrize],
              reel: [protocolGoldPrize],
              previewMonsterShortTypes: [],
            }
          : phase === "awaiting-prize-resolution"
            ? {
                schemaVersion: 1 as const,
                continuationId: `store-${phase}`,
                decisionId: `store-${phase}-decision`,
                kind: "silver" as const,
                origin: "store" as const,
                remainingRepeats: 0 as const,
                phase,
                providers: [protocolGoldPrize],
                reel: [protocolGoldPrize],
                previewMonsterShortTypes: [],
                finalReelState: {
                  elapsedSeconds: 1,
                  index: 0,
                  speed: 0,
                  friction: 0,
                  centerIndex: 0,
                  stopped: true,
                },
                landedPrize: protocolGoldPrize,
              }
            : {
                schemaVersion: 1 as const,
                continuationId: `store-${phase}`,
                decisionId: `store-${phase}-decision`,
                kind: "silver" as const,
                origin: "store" as const,
                remainingRepeats: 0 as const,
                phase,
                settledPrize: protocolGoldPrize,
                resolution: { kind: "keep" as const },
              };
      expect(parseOfficialGameStateV12(data, quests, { ...base, pendingEgg }).pendingEgg)
        .toEqual(pendingEgg);
    }
  });

  it("admits only the exact continuation command for each phase and gives it projection precedence", () => {
    const base = {
      ...partyStateV12Core(),
      location: { kind: "world" as const, worldId: world.name, poiId: "First_City" },
      collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    };
    const ordinary = { type: "world.leaveTown" } as const;
    const commandByPhase = {
      "awaiting-spin": { type: "egg.start" } as const,
      spinning: { type: "egg.release" } as const,
      "awaiting-prize-resolution": {
        type: "egg.resolvePrize",
        resolution: { kind: "keep" },
      } as const,
      "awaiting-repeat-or-finish": { type: "egg.finish" } as const,
    };
    const phaseByCommand = [
      "awaiting-spin",
      "spinning",
      "awaiting-prize-resolution",
      "awaiting-repeat-or-finish",
    ] as const;
    const reducerV12 = v12Reducer();
    expect(projectOfficialGameStateV12(completeReducer, parseOfficialGameStateV12(data, quests, base))
      .decision.type).toBe("world.ready");

    for (const [index, phase] of phaseByCommand.entries()) {
      const pendingEgg = {
        schemaVersion: 1 as const,
        continuationId: `continuation-${index + 1}`,
        decisionId: `decision-${index + 1}`,
        kind: "silver" as const,
        origin: "collection" as const,
        remainingRepeats: phase === "awaiting-repeat-or-finish" ? 0 as const : 1 as const,
        phase,
        ...(phase === "spinning" || phase === "awaiting-prize-resolution"
          ? { providers: [protocolGoldPrize], reel: [protocolGoldPrize], previewMonsterShortTypes: [] }
          : {}),
        ...(phase === "awaiting-prize-resolution"
          ? {
              finalReelState: { elapsedSeconds: 1.5, index: 0, speed: 0, friction: 0, centerIndex: 0, stopped: true },
              landedPrize: protocolGoldPrize,
            }
          : {}),
        ...(phase === "awaiting-repeat-or-finish"
          ? { settledPrize: protocolGoldPrize, resolution: { kind: "keep" as const } }
          : {}),
      } as OfficialEggContinuation;
      const state = parseOfficialGameStateV12(data, quests, {
        ...base,
        pendingEgg,
      });
      expect(() => assertOfficialGameV12CommandAdmitted(state, ordinary)).toThrow(/pending Egg/i);
      expect(() => assertOfficialGameV12CommandAdmitted(state, commandByPhase[phase])).not.toThrow();
      expect(() => reducerV12.apply({
        playerId: "route-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, ordinary)).toThrow(/pending Egg/i);
      expect(projectOfficialGameStateV12(completeReducer, state).decision).toMatchObject({
        decisionId: pendingEgg.decisionId,
        continuationId: pendingEgg.continuationId,
      });
    }

    const defeatState = finishV12DungeonDefeat(officialDungeonBattleFixture(), {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    }).state;
    const pendingDefeat = defeatState.pendingDefeat;
    if (pendingDefeat === undefined) throw new Error("continuation fixture has no pending defeat");
    expect(() => assertOfficialGameV12CommandAdmitted(defeatState, ordinary)).toThrow(/defeat/i);
    expect(() => assertOfficialGameV12CommandAdmitted(defeatState, {
      type: "battle.resolveDefeat",
      battleId: pendingDefeat.battleId,
      recovery: "return",
    })).not.toThrow();
    expect(projectOfficialGameStateV12(completeReducer, defeatState).decision.type)
      .toBe("battle.defeatRecovery");
  });

  it("runs a complete continuation admission matrix without RNG or source-state effects", () => {
    const base = {
      ...partyStateV12Core(),
      location: { kind: "town" as const, worldId: world.name, townId: "First_City" },
      collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    };
    const eggCommands: readonly GameCommandEnvelopeV1["command"][] = [
      { type: "egg.start" },
      { type: "egg.release" },
      { type: "egg.resolvePrize", resolution: { kind: "keep" } },
      { type: "egg.repeat" },
      { type: "egg.finish" },
    ];
    const unrelatedCommands: readonly GameCommandEnvelopeV1["command"][] = [
      { type: "collection.claim", goalId: "CollectionQuestCollector" },
      { type: "battle.resolveDefeat", battleId: "battle-foreign", recovery: "return" },
      { type: "store.purchase", stockId: "stock-1", quantity: 1 },
      { type: "party.commitBattingPriority", activeInstanceIds: ["keeper"] },
      { type: "world.leaveTown" },
      { type: "dungeon.openTreasure", treasureId: "treasure-1" },
      { type: "battle.delay", battleId: "battle-foreign", actorId: "keeper" },
    ];
    const phases: readonly [
      OfficialEggContinuation,
      readonly GameCommandEnvelopeV1["command"][],
    ][] = [
      [{
        schemaVersion: 1,
        continuationId: "matrix-spin",
        decisionId: "matrix-spin-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "awaiting-spin",
      }, [{ type: "egg.start" }]],
      [{
        schemaVersion: 1,
        continuationId: "matrix-release",
        decisionId: "matrix-release-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "spinning",
        providers: [protocolGoldPrize],
        reel: [protocolGoldPrize],
        previewMonsterShortTypes: [],
      }, [{ type: "egg.release" }]],
      [{
        schemaVersion: 1,
        continuationId: "matrix-resolve",
        decisionId: "matrix-resolve-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "awaiting-prize-resolution",
        providers: [protocolGoldPrize],
        reel: [protocolGoldPrize],
        previewMonsterShortTypes: [],
        finalReelState: {
          elapsedSeconds: 1,
          index: 0,
          speed: 0,
          friction: 0,
          centerIndex: 0,
          stopped: true,
        },
        landedPrize: protocolGoldPrize,
      }, [{ type: "egg.resolvePrize", resolution: { kind: "keep" } }]],
      [{
        schemaVersion: 1,
        continuationId: "matrix-finish",
        decisionId: "matrix-finish-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 0,
        phase: "awaiting-repeat-or-finish",
        settledPrize: protocolGoldPrize,
        resolution: { kind: "keep" },
      }, [{ type: "egg.finish" }]],
      [{
        schemaVersion: 1,
        continuationId: "matrix-repeat",
        decisionId: "matrix-repeat-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "awaiting-repeat-or-finish",
        settledPrize: protocolGoldPrize,
        resolution: { kind: "keep" },
      }, [{ type: "egg.repeat" }, { type: "egg.finish" }]],
    ];
    let rngCalls = 0;
    const countingLegacy = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngCalls += 1;
        return 0;
      },
    });
    const v12 = v12Reducer(countingLegacy);
    for (const [pendingEgg, validCommands] of phases) {
      const state = parseOfficialGameStateV12(data, quests, { ...base, pendingEgg });
      const rejected = [
        ...eggCommands.filter((command) => !validCommands.some((valid) => valid.type === command.type)),
        ...unrelatedCommands,
      ];
      for (const command of rejected) {
        const before = structuredClone(state);
        expect(() => assertOfficialGameV12CommandAdmitted(state, command)).toThrow(/pending Egg/i);
        expect(() => v12.apply({
          playerId: "matrix-player",
          slotId: "slot-1",
          pack: completeV12Pack,
          state,
          previousRevision: 1,
          now: "2026-07-29T00:00:00.000Z",
        }, command)).toThrow(/pending Egg/i);
        expect(state).toEqual(before);
        expect(rngCalls).toBe(0);
      }
      for (const command of validCommands) {
        expect(() => assertOfficialGameV12CommandAdmitted(state, command)).not.toThrow();
      }
    }

    const impossibleGem = {
      kind: "gem" as const,
      level: 42,
      quality: 0 as const,
      slot: 2 as const,
      enabledStats: ["Attack", "Defense"] as const,
    };
    const impossibleGemState = parseOfficialGameStateV12(data, quests, {
      ...base,
      pendingEgg: {
        schemaVersion: 1,
        continuationId: "matrix-impossible-gem",
        decisionId: "matrix-impossible-gem-decision",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "spinning",
        providers: [impossibleGem],
        reel: [impossibleGem],
        previewMonsterShortTypes: [],
      },
    });
    expect(() => v12.apply({
      playerId: "matrix-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: impossibleGemState,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "egg.release", heldFrames: 91 })).toThrow(/Gem domain is not source-defined/);
    expect(rngCalls).toBe(0);

    const defeatState = finishV12DungeonDefeat(officialDungeonBattleFixture(), {
      hero: { level: 6, totalHighestLevels: minimumHeroTotalForLevel(6) },
      gold: 100,
      tutorialFlags: ["SaveMe"],
    }).state;
    const pendingDefeat = defeatState.pendingDefeat;
    if (pendingDefeat === undefined) throw new Error("admission fixture has no pending defeat");
    const defeatCommands = [
      ...eggCommands,
      ...unrelatedCommands,
      { type: "battle.resolveDefeat", battleId: "battle-foreign", recovery: "saveMe" } as const,
    ];
    for (const command of defeatCommands) {
      const before = structuredClone(defeatState);
      expect(() => assertOfficialGameV12CommandAdmitted(defeatState, command)).toThrow(/defeat|battle|pending/i);
      expect(() => v12.apply({
        playerId: "matrix-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state: defeatState,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, command)).toThrow(/defeat|battle|pending/i);
      expect(defeatState).toEqual(before);
      expect(rngCalls).toBe(0);
    }
    for (const command of [
      { type: "battle.resolveDefeat", battleId: pendingDefeat.battleId, recovery: "return" },
      { type: "battle.resolveDefeat", battleId: pendingDefeat.battleId, recovery: "saveMe" },
    ] as const) {
      expect(() => assertOfficialGameV12CommandAdmitted(defeatState, command)).not.toThrow();
    }
  });

  it("executes every authoritative Egg phase, including the permitted repeat, to a clear state", () => {
    const v12 = v12Reducer();
    let state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      profile: { ...partyStateV12Core().profile, gold: 10_000 },
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 10,
      pendingEgg: {
        schemaVersion: 1,
        continuationId: "continuation-lifecycle",
        decisionId: "decision-lifecycle",
        kind: "silver",
        origin: "quest",
        remainingRepeats: 1,
        phase: "awaiting-spin",
      },
    });
    const apply = (command: GameCommandEnvelopeV1["command"]) => {
      const result = v12.apply({
        playerId: "egg-lifecycle-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, command);
      state = result.state;
      return result;
    };

    expect(apply({ type: "egg.start" }).state.pendingEgg?.phase).toBe("spinning");
    expect(state.nextContinuationSequence).toBe(11);
    expect(apply({ type: "egg.release" }).state.pendingEgg?.phase)
      .toBe("awaiting-prize-resolution");
    expect(apply({ type: "egg.resolvePrize", resolution: { kind: "keep" } })
      .state.pendingEgg?.phase).toBe("awaiting-repeat-or-finish");
    expect(apply({ type: "egg.repeat" }).state.pendingEgg).toMatchObject({
      phase: "spinning",
      remainingRepeats: 0,
    });
    expect(apply({ type: "egg.release" }).state.pendingEgg?.phase)
      .toBe("awaiting-prize-resolution");
    expect(apply({ type: "egg.resolvePrize", resolution: { kind: "keep" } })
      .state.pendingEgg?.phase).toBe("awaiting-repeat-or-finish");
    const finished = apply({ type: "egg.finish" });
    expect(finished.state.pendingEgg).toBeUndefined();
    expect(finished.projection.decision.type).not.toMatch(/^egg\./);
  });

  it("settles every closed-union Egg branch through the authoritative service boundary", async () => {
    // These are independently selected strict union values tied to loaded definitions. They
    // prove aggregate/service settlement branches, not that RNG emitted one representative of
    // every branch and not that the private preflight summary is exhaustive by observation.
    const gold = closedUnionSettlementPrize("150-gold", (prize) =>
      prize.kind === "gold" && prize.amount === 150);
    const silver = closedUnionSettlementPrize("1500-silver", (prize) =>
      prize.kind === "silver" && prize.amount === 1_500);
    const gem = closedUnionSettlementPrize("level-150-quality-1 Gem", (prize) =>
      prize.kind === "gem" && prize.level === 150 && prize.quality === 1 &&
      prize.enabledStats.length === 2);
    const item = closedUnionSettlementPrize("CardGold", (prize) =>
      prize.kind === "item" && prize.definitionPath === "Usables.CardGold" && prize.level === 3);
    const recipeName = data.allCombineRecipes().at(-1)?.resultShortType;
    if (recipeName === undefined) throw new Error("loaded operator fixture has no recipe definition");
    const recipe = closedUnionSettlementPrize("last loaded recipe", (prize) =>
      prize.kind === "recipe" && prize.combineName === recipeName);
    const spiritName = data.allMonsters()
      .filter(({ category }) => category === "Summon")
      .at(-1)?.shortType;
    if (spiritName === undefined) throw new Error("loaded operator fixture has no summon monster");
    const spirit = closedUnionSettlementPrize("last loaded spirit totem", (prize) =>
      prize.kind === "spiritTotem" && prize.shortType === spiritName);
    const monster = closedUnionSettlementPrize("prize monster", (prize) =>
      prize.kind === "monster" && prize.prizeMonster);
    const cases: readonly { readonly label: string; readonly prize: OfficialEggPrize }[] = [
      { label: "gold", prize: gold },
      { label: "silver", prize: silver },
      { label: "gem", prize: gem },
      { label: "item", prize: item },
      { label: "recipe", prize: recipe },
      { label: "spirit-totem", prize: spirit },
      { label: "monster-keep", prize: monster },
    ];

    for (const { label, prize } of cases) {
      const { authority, store, reducer } = v12Service();
      await seedServiceV12PendingEgg(authority, store, reducer, prize);
      const before = await store.read("service-player", "slot-1");
      if (before === undefined) throw new Error(`${label} service fixture was not stored`);
      const command = envelope(
        `service-settle-${label}`,
        before.revision,
        { type: "egg.resolvePrize", resolution: { kind: "keep" } },
        serviceDecisionId(before),
      );
      const result = await authority.execute("service-player", "slot-1", command);
      const after = await store.read("service-player", "slot-1");
      if (after === undefined) throw new Error(`${label} service result was not stored`);
      expect(after.state.pendingEgg?.phase, label).toBe("awaiting-repeat-or-finish");
      expect(after.state.nextMonsterSequence, label).toBe(
        before.state.nextMonsterSequence + (prize.kind === "monster" ? 1 : 0),
      );
      expect(result.projection.decision, label).toMatchObject({
        type: "egg.awaitingRepeatOrFinish",
        decisionId: after.state.pendingEgg?.decisionId,
        continuationId: after.state.pendingEgg?.continuationId,
      });
      expect(result.projection.pendingEgg, label).toEqual(after.state.pendingEgg);
      expect(result.projection.pendingEgg, label).not.toBe(after.state.pendingEgg);
      expect(result.events, label).toEqual(
        prize.kind === "gold" || prize.kind === "silver"
          ? [expect.objectContaining({ type: "player.currencyChanged" })]
          : prize.kind === "monster"
            ? [expect.objectContaining({ type: "player.monsterAdded" })]
            : [],
      );

      if (prize.kind === "gold") expect(after.state.profile.gold).toBe(before.state.profile.gold + prize.amount);
      if (prize.kind === "silver") expect(after.state.profile.silver).toBe(before.state.profile.silver + prize.amount);
      if (prize.kind === "gem") {
        expect(after.state.profile).toMatchObject({
          inventory: { looseItems: expect.arrayContaining([
            expect.objectContaining({ kind: "gem", level: prize.level }),
          ]) },
        });
      }
      if (prize.kind === "item") {
        expect(after.state.profile).toMatchObject({
          inventory: { looseItems: expect.arrayContaining([
            expect.objectContaining({
              kind: "usable",
              definitionPath: prize.definitionPath,
              level: prize.level,
            }),
          ]) },
        });
      }
      if (prize.kind === "recipe") {
        expect(after.state.profile).toMatchObject({
          learnedCombineRecipes: expect.arrayContaining([prize.combineName]),
        });
      }
      if (prize.kind === "spiritTotem") {
        expect(after.state.profile).toMatchObject({
          spiritSavedXp: expect.objectContaining({ [prize.shortType]: expect.any(Number) }),
        });
      }
      if (prize.kind === "monster") {
        expect(after.state.party.monsters).toContainEqual(expect.objectContaining({
          instanceId: `monster-${before.state.nextMonsterSequence}`,
          shortType: prize.shortType,
          level: prize.level,
        }));
      }
    }
  });

  it("proves service Egg phase replay, restart, stale/mismatch, concurrency, RNG, and Feed caps", async () => {
    const feedPrize = closedUnionMonsterPrize("Feed");
    const expectedRngTrace = (draws: number): number[] => Array.from({ length: draws }, () => 0);
    const rngTrace: number[] = [];
    let rngCalls = 0;
    const first = v12Service(() => {
      rngCalls += 1;
      rngTrace.push(0);
      return 0;
    });
    const created = await first.authority.execute("service-player", "slot-1", envelope(
      "service-create-0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    const createdRecord = await first.store.read("service-player", "slot-1");
    if (createdRecord === undefined) throw new Error("service lifecycle create was not stored");
    await seedServiceV12PendingEgg(
      first.authority,
      first.store,
      first.reducer,
      protocolGoldPrize,
      { ...createdRecord.state, profile: { ...createdRecord.state.profile, gold: 10_000 } },
      serviceEggAwaitingSpin(),
    );
    let record = await first.store.read("service-player", "slot-1");
    if (record === undefined) throw new Error("service lifecycle seed was not stored");
    const start = envelope(
      "service-phase-start",
      record.revision,
      { type: "egg.start" },
      serviceDecisionId(record),
    );
    const started = await first.authority.execute("service-player", "slot-1", start);
    expect(started.projection.decision.type).toBe("egg.spinning");
    expect(started.projection.decision).toMatchObject({
      decisionId: "decision-1",
      continuationId: "continuation-service-egg",
    });
    const drawsAfterStart = rngCalls;
    expect(drawsAfterStart).toBe(16);
    expect(rngTrace).toEqual(expectedRngTrace(16));
    const replayedStartResult = await first.authority.execute("service-player", "slot-1", start)
      .catch((error: unknown) => error);
    expect(replayedStartResult).toMatchObject({ idempotentReplay: true });
    expect(rngCalls).toBe(drawsAfterStart);
    expect(rngTrace).toEqual(expectedRngTrace(16));

    const restarted = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({
      pack: completeV12Pack,
      store: first.store,
      reducer: first.reducer,
      validateRecord: (value) => first.reducer.validatePersistedRecord(value),
    });
    record = await first.store.read("service-player", "slot-1");
    if (record === undefined) throw new Error("service lifecycle restart lost state");
    const stale = envelope(
      "service-phase-stale",
      record.revision,
      { type: "egg.release" },
      "decision-service-egg",
    );
    const staleBefore = await first.store.read("service-player", "slot-1");
    const staleResult = await restarted.execute("service-player", "slot-1", stale)
      .catch((error: unknown) => error);
    expect(staleResult).toMatchObject({ code: expect.stringMatching(/DECISION|REVISION|ACTION/) });
    expect(rngCalls).toBe(drawsAfterStart);
    expect(rngTrace).toEqual(expectedRngTrace(16));
    expect(await first.store.read("service-player", "slot-1")).toEqual(staleBefore);

    const release = envelope(
      "service-phase-release",
      record.revision,
      { type: "egg.release" },
      serviceDecisionId(record),
    );
    const releaseResult = await restarted.execute("service-player", "slot-1", release)
      .catch((error: unknown) => error);
    expect(releaseResult).toMatchObject({ idempotentReplay: false });
    expect((releaseResult as Awaited<ReturnType<typeof restarted.execute>>).projection.decision)
      .toMatchObject({ decisionId: "decision-2", continuationId: "continuation-service-egg" });
    expect((await first.store.read("service-player", "slot-1"))?.state.pendingEgg?.phase)
      .toBe("awaiting-prize-resolution");
    const drawsAfterRelease = rngCalls;
    expect(drawsAfterRelease).toBe(drawsAfterStart + 1);
    expect(rngTrace).toEqual(expectedRngTrace(17));
    const releaseReplay = await restarted.execute("service-player", "slot-1", release);
    expect(releaseReplay.idempotentReplay).toBe(true);
    expect(rngCalls).toBe(drawsAfterRelease);
    expect(rngTrace).toEqual(expectedRngTrace(17));
    const afterReleaseRecord = await first.store.read("service-player", "slot-1");
    expect(afterReleaseRecord?.receipts.has(release.commandId)).toBe(true);
    const mismatch = await restarted.execute("service-player", "slot-1", {
      ...release,
      command: { type: "egg.finish" },
    }).catch((error: unknown) => error);
    expect(mismatch).toMatchObject({ code: "COMMAND_DUPLICATE_MISMATCH" });
    expect(rngTrace).toEqual(expectedRngTrace(17));

    record = await first.store.read("service-player", "slot-1");
    if (record === undefined) throw new Error("service lifecycle release was not stored");
    const resolve = envelope(
      "service-phase-resolve",
      record.revision,
      { type: "egg.resolvePrize", resolution: { kind: "keep" } },
      serviceDecisionId(record),
    );
    const [resolvedResult, concurrentReplayResult] = await Promise.all([
      restarted.execute("service-player", "slot-1", resolve)
        .catch((error: unknown) => error),
      restarted.execute("service-player", "slot-1", resolve)
        .catch((error: unknown) => error),
    ]);
    expect(resolvedResult).toMatchObject({ idempotentReplay: false });
    const resolved = resolvedResult as Awaited<ReturnType<typeof restarted.execute>>;
    expect(concurrentReplayResult).toMatchObject({ idempotentReplay: true });
    const concurrentReplay = concurrentReplayResult as Awaited<ReturnType<typeof restarted.execute>>;
    expect(resolved.projection.decision.type).toBe("egg.awaitingRepeatOrFinish");
    expect(resolved.projection.decision).toMatchObject({
      decisionId: "decision-3",
      continuationId: "continuation-service-egg",
    });
    expect([resolved.idempotentReplay, concurrentReplay.idempotentReplay].sort())
      .toEqual([false, true]);
    expect(rngCalls).toBe(drawsAfterRelease);
    expect(rngTrace).toEqual(expectedRngTrace(17));

    record = await first.store.read("service-player", "slot-1");
    if (record === undefined) throw new Error("service lifecycle resolution was not stored");
    const repeat = envelope(
      "service-phase-repeat",
      record.revision,
      { type: "egg.repeat" },
      serviceDecisionId(record),
    );
    expect((await first.store.read("service-player", "slot-1"))?.state.pendingEgg?.phase)
      .toBe("awaiting-repeat-or-finish");
    const repeatedResult = await restarted.execute("service-player", "slot-1", repeat)
      .catch((error: unknown) => error);
    expect(repeatedResult).toMatchObject({ idempotentReplay: false });
    expect((repeatedResult as Awaited<ReturnType<typeof restarted.execute>>).projection.decision)
      .toMatchObject({ decisionId: "decision-4", continuationId: "continuation-service-egg" });
    const drawsAfterRepeat = rngCalls;
    expect(drawsAfterRepeat).toBe(57);
    expect(rngTrace).toEqual(expectedRngTrace(57));
    const repeatReplay = await restarted.execute("service-player", "slot-1", repeat);
    expect(repeatReplay.idempotentReplay).toBe(true);
    expect(rngCalls).toBe(drawsAfterRepeat);
    expect(rngTrace).toEqual(expectedRngTrace(57));

    record = await first.store.read("service-player", "slot-1");
    if (record === undefined) throw new Error("service lifecycle repeat was not stored");
    const secondRelease = envelope(
      "service-phase-release-2",
      record.revision,
      { type: "egg.release" },
      serviceDecisionId(record),
    );
    const secondReleaseResult = await restarted.execute("service-player", "slot-1", secondRelease);
    expect(secondReleaseResult.projection.decision).toMatchObject({
      decisionId: "decision-5",
      continuationId: "continuation-service-egg",
    });
    const drawsAfterSecondRelease = rngCalls;
    expect(drawsAfterSecondRelease).toBe(drawsAfterRepeat + 1);
    expect(rngTrace).toEqual(expectedRngTrace(58));
    expect((await restarted.execute("service-player", "slot-1", secondRelease)).idempotentReplay)
      .toBe(true);
    record = await first.store.read("service-player", "slot-1");
    if (record === undefined) throw new Error("service lifecycle second release was not stored");
    const secondResolve = envelope(
      "service-phase-resolve-2",
      record.revision,
      { type: "egg.resolvePrize", resolution: { kind: "keep" } },
      serviceDecisionId(record),
    );
    const secondResolveResult = await restarted.execute("service-player", "slot-1", secondResolve);
    expect(secondResolveResult.projection.decision).toMatchObject({
      decisionId: "decision-6",
      continuationId: "continuation-service-egg",
    });
    expect(rngCalls).toBe(drawsAfterSecondRelease);
    expect(rngTrace).toEqual(expectedRngTrace(58));
    record = await first.store.read("service-player", "slot-1");
    if (record === undefined) throw new Error("service lifecycle second resolution was not stored");
    const finish = envelope(
      "service-phase-finish",
      record.revision,
      { type: "egg.finish" },
      serviceDecisionId(record),
    );
    const finished = await restarted.execute("service-player", "slot-1", finish);
    expect(finished.idempotentReplay).toBe(false);
    expect(finished.projection.pendingEgg).toBeUndefined();
    expect(rngCalls).toBe(drawsAfterSecondRelease);
    expect(rngTrace).toEqual(expectedRngTrace(58));
    expect((await restarted.execute("service-player", "slot-1", finish)).idempotentReplay)
      .toBe(true);

    for (const level of [149, 150] as const) {
      const feed = v12Service();
      const core: OfficialGameStateV12 = {
        ...partyStateV12Core(),
        collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
        nextContinuationSequence: 1,
      };
      const target = core.party.monsters.find(({ instanceId }) => instanceId === "keeper");
      if (target === undefined) throw new Error("Feed service fixture has no keeper");
      const feedParty = {
        ...core.party,
        monsters: core.party.monsters.map((monster) => monster.instanceId === "keeper"
          ? member("keeper", monster.shortType, level, { injureTime: 100, healTime: 200 })
          : monster),
      };
      await seedServiceV12PendingEgg(
        feed.authority,
        feed.store,
        feed.reducer,
        feedPrize,
        { ...core, party: feedParty },
      );
      const before = await feed.store.read("service-player", "slot-1");
      if (before === undefined) throw new Error("Feed service fixture was not stored");
      const feedCommand = envelope(
        `service-feed-${level}`,
        before.revision,
        { type: "egg.resolvePrize", resolution: { kind: "feed", recipientInstanceId: "keeper" } },
        serviceDecisionId(before),
      );
      const fed = await feed.authority.execute("service-player", "slot-1", feedCommand);
      const after = await feed.store.read("service-player", "slot-1");
      if (after === undefined) throw new Error("Feed service result was not stored");
      expect(after.state.nextMonsterSequence).toBe(before.state.nextMonsterSequence);
      const beforeTarget = before.state.party.monsters.find(({ instanceId }) => instanceId === "keeper");
      const afterTarget = after.state.party.monsters.find(({ instanceId }) => instanceId === "keeper");
      if (beforeTarget === undefined || afterTarget === undefined) {
        throw new Error("Feed service fixture lost its authoritative target");
      }
      if (level === 149) {
        expect(afterTarget).toEqual({
          ...beforeTarget,
          level: 150,
          cumulativeXp: jobXpForLevel(150, data.jobXpPenalty(beforeTarget.shortType)),
        });
      } else {
        expect(afterTarget).toEqual(beforeTarget);
      }
      expect(after.state.pendingEgg).toMatchObject({
        resolution: { kind: "feed", recipientInstanceId: "keeper" },
        settledPrize: { kind: "monster", shortType: feedPrize.shortType, level: feedPrize.level },
      });
      expect(fed.projection.decision.type).toBe("egg.awaitingRepeatOrFinish");
    }

    const missingRngTrace: number[] = [];
    const missing = v12Service(() => {
      missingRngTrace.push(0);
      return 0;
    });
    const missingCore: OfficialGameStateV12 = {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    };
    await seedServiceV12PendingEgg(
      missing.authority,
      missing.store,
      missing.reducer,
      feedPrize,
      missingCore,
    );
    const missingBefore = await missing.store.read("service-player", "slot-1");
    if (missingBefore === undefined) throw new Error("missing Feed service fixture was not stored");
    await expect(missing.authority.execute("service-player", "slot-1", envelope(
      "service-feed-missing",
      missingBefore.revision,
      { type: "egg.resolvePrize", resolution: { kind: "feed", recipientInstanceId: "caller-invented" } },
      serviceDecisionId(missingBefore),
    ))).rejects.toThrow(/recipient|missing/i);
    const missingAfter = await missing.store.read("service-player", "slot-1");
    expect(missingAfter).toEqual(missingBefore);
    expect(missingRngTrace).toEqual([]);
  });

  it("looks up Feed recipients from the authoritative party and applies one level atomically", () => {
    const feedPrize = closedUnionMonsterPrize("Feed");
    const v12 = v12Reducer();
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 20,
      pendingEgg: {
        schemaVersion: 1,
        continuationId: "continuation-feed",
        decisionId: "decision-feed",
        kind: "gold",
        origin: "quest",
        remainingRepeats: 1,
        phase: "awaiting-prize-resolution",
        providers: [feedPrize],
        reel: [feedPrize],
        previewMonsterShortTypes: [],
        finalReelState: {
          elapsedSeconds: 4.7,
          index: 0,
          speed: 0,
          friction: 1,
          centerIndex: 0,
          stopped: true,
        },
        landedPrize: feedPrize,
      },
    });
    const beforeInvalid = structuredClone(state);
    const kept = v12.apply({
      playerId: "feed-keep-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "egg.resolvePrize",
      resolution: { kind: "keep" },
    });
    expect(kept.state.party.monsters).toContainEqual(expect.objectContaining({
      instanceId: `monster-${state.nextMonsterSequence}`,
      shortType: feedPrize.shortType,
      level: feedPrize.level,
    }));
    expect(kept.state.nextMonsterSequence).toBe(state.nextMonsterSequence + 1);
    expect(kept.projection.pendingEgg).not.toBe(kept.state.pendingEgg);
    expect(() => v12.apply({
      playerId: "feed-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "egg.resolvePrize",
      resolution: { kind: "feed", recipientInstanceId: "caller-invented" },
    })).toThrow(/recipient|eligible|missing/i);
    expect(state).toEqual(beforeInvalid);

    const resolved = v12.apply({
      playerId: "feed-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, {
      type: "egg.resolvePrize",
      resolution: { kind: "feed", recipientInstanceId: "keeper" },
    });
    expect(resolved.state.party.monsters.find(({ instanceId }) => instanceId === "keeper"))
      .toMatchObject({ level: 2 });
    expect(resolved.state.pendingEgg).toMatchObject({
      phase: "awaiting-repeat-or-finish",
      resolution: { kind: "feed", recipientInstanceId: "keeper" },
    });
    expect(resolved.state.nextMonsterSequence).toBe(state.nextMonsterSequence);
    expect(resolved.projection.pendingEgg).not.toBe(resolved.state.pendingEgg);
  });

  it("rejects disallowed Save Me and mismatched defeat IDs before any reducer effects", () => {
    const state = finishV12DungeonDefeat(officialDungeonBattleFixture()).state;
    if (state.pendingDefeat?.canSaveMe !== false) throw new Error("defeat gate fixture is unexpectedly Save Me eligible");
    const pendingBattleId = state.pendingDefeat.battleId;
    const before = structuredClone(state);
    let rngCalls = 0;
    const countingLegacy = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngCalls += 1;
        return 0;
      },
    });
    const v12 = v12Reducer(countingLegacy);
    const reject = (command: GameCommandEnvelopeV1["command"]) => {
      expect(() => v12.apply({
        playerId: "defeat-gate-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, command)).toThrow(/Save Me|saveMe|pending defeat|pending/i);
      expect(state).toEqual(before);
      expect(rngCalls).toBe(0);
    };
    expect(() => assertOfficialGameV12CommandAdmitted(state, {
      type: "battle.resolveDefeat",
      battleId: pendingBattleId,
      recovery: "saveMe",
    })).toThrow(/Save Me|saveMe|allowed/i);
    reject({
      type: "battle.resolveDefeat",
      battleId: pendingBattleId,
      recovery: "saveMe",
    });
    expect(() => assertOfficialGameV12CommandAdmitted(state, {
      type: "battle.resolveDefeat",
      battleId: "battle-foreign",
      recovery: "return",
    })).toThrow(/pending defeat battle|not the pending/i);
    reject({
      type: "battle.resolveDefeat",
      battleId: "battle-foreign",
      recovery: "return",
    });
    expect(state).toEqual(before);
  });

  it("routes a source Tournament Egg claim through the v12 aggregate", () => {
    const core = partyStateV12Core();
    const arenaWorld = allWorlds.find((candidate) => candidate.name === "World_1-2")!;
    const arenaTown = arenaWorld.pointsOfInterest.find(({ name }) => name === "Capital_City")!;
    const eggTournament = data.allTournaments().find((candidate) =>
      generateTournamentPrize(candidate, replayableRng([], () => 0))
        .some((reward) => reward.kind === "monsterEgg"),
    );
    if (eggTournament === undefined) throw new Error("fixture has no source Tournament Egg prize");
    const tournamentParty = WorldTripParty.fromStateSnapshot(data, core.party);
    const tournamentProfile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("BlueBabyDragon"),
      gold: 1_000,
      monsterPartyLevels: [1, 1, 1],
      tournament: { schemaVersion: 1, index: eggTournament.index, round: 4, status: 2 },
    }, tournamentParty);
    const initial = parseOfficialGameStateV12(data, quests, {
      ...core,
      profile: tournamentProfile.stateSnapshot(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      location: { kind: "town", worldId: arenaWorld.name, townId: arenaTown.name },
      world: createInitialOfficialWorldState(arenaWorld, arenaTown.name),
      nextContinuationSequence: 1,
    });
    const v12 = v12Reducer();
    const result = v12.apply({
      playerId: "preflight-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: initial,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "tournament.claimPrize" });
    expect(result.state.pendingEgg).toMatchObject({
      origin: "tournament",
      remainingRepeats: 1,
      phase: "awaiting-spin",
    });
    expect(result.state.nextContinuationSequence).toBe(2);
    expect(result.projection.player.tournament).toMatchObject({ status: 0 });
    expect(result.events).toContainEqual({
      type: "tournament.prizeClaimed",
      tournamentIndex: eggTournament.index,
    });
    let continued = result;
    const continueEgg = (command: GameCommandEnvelopeV1["command"]) => {
      const decision = continued.projection.decision;
      if (!decision.type.startsWith("egg.") || !("decisionId" in decision)) {
        throw new Error("Tournament Egg continuation decision is missing");
      }
      continued = v12.apply({
        playerId: "tournament-route-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state: continued.state,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, command);
    };
    continueEgg({ type: "egg.start" });
    continueEgg({ type: "egg.release" });
    continueEgg({ type: "egg.resolvePrize", resolution: { kind: "keep" } });
    const goldBeforeRepeat = continued.state.profile.gold;
    continueEgg({ type: "egg.repeat" });
    expect(continued.state.profile.gold).toBe(goldBeforeRepeat - 298);
    expect(continued.state.pendingEgg).toMatchObject({
      kind: "gold",
      phase: "spinning",
      remainingRepeats: 0,
    });
    continueEgg({ type: "egg.release" });
    continueEgg({ type: "egg.resolvePrize", resolution: { kind: "keep" } });
    continueEgg({ type: "egg.finish" });
    expect(continued.state.pendingEgg).toBeUndefined();
  });

  it("routes a source quest Egg claim through the v12 aggregate and commits the quest terminal state", () => {
    const eggQuest = quests.requireQuest("BeatCyrus");
    if (eggQuest.className !== "WinBattleQuest" ||
        !JSON.stringify(eggQuest.treasureData).includes("DestroyOnPickup.Egg")) {
      throw new Error("source BeatCyrus fixture is not an Egg quest reward");
    }
    const guildTown = allWorlds.flatMap((candidateWorld) => candidateWorld.pointsOfInterest.map((candidatePoi) => ({
      world: candidateWorld,
      poi: candidatePoi,
    }))).find(({ poi }) => poi.name === eggQuest.source && poi.town?.buildings.some(({ className, fake }) =>
      className === "TavernMenuItem" && fake !== true));
    if (guildTown === undefined) throw new Error(`source quest ${eggQuest.name} has no Guild town`);
    const initial = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      profile: { ...partyStateV12Core().profile, gold: 10_000 },
      quests: {
        ...emptyGuildQuestStateSnapshot(),
        activeQuestNames: [eggQuest.name],
        dialogsSeen: ["LeslieSaved"],
        progressByQuestName: { [eggQuest.name]: { quantity: eggQuest.quantity } },
      },
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      location: { kind: "town", worldId: guildTown.world.name, townId: guildTown.poi.name },
      world: createInitialOfficialWorldState(guildTown.world, guildTown.poi.name),
      nextContinuationSequence: 1,
    });
    const result = v12Reducer().apply({
      playerId: "quest-route-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state: initial,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "quest.claim", questId: eggQuest.name });
    expect(result.state.pendingEgg).toMatchObject({
      origin: "quest",
      remainingRepeats: 1,
      phase: "awaiting-spin",
    });
    expect(result.state.nextContinuationSequence).toBe(2);
    expect(result.projection.quests?.finishedQuestNames).toContain(eggQuest.name);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "quest.rewardClaimed",
      questId: eggQuest.name,
    }));
    let continued = result;
    const continueEgg = (command: GameCommandEnvelopeV1["command"]) => {
      const decision = continued.projection.decision;
      if (!decision.type.startsWith("egg.")) throw new Error("quest Egg continuation decision is missing");
      continued = v12Reducer().apply({
        playerId: "quest-route-player",
        slotId: "slot-1",
        pack: completeV12Pack,
        state: continued.state,
        previousRevision: 1,
        now: "2026-07-29T00:00:00.000Z",
      }, command);
    };
    continueEgg({ type: "egg.start" });
    continueEgg({ type: "egg.release" });
    continueEgg({ type: "egg.resolvePrize", resolution: { kind: "keep" } });
    const goldBeforeRepeat = continued.state.profile.gold;
    continueEgg({ type: "egg.repeat" });
    expect(continued.state.profile.gold).toBe(goldBeforeRepeat - 100);
    continueEgg({ type: "egg.release" });
    continueEgg({ type: "egg.resolvePrize", resolution: { kind: "keep" } });
    continueEgg({ type: "egg.finish" });
    expect(continued.state.pendingEgg).toBeUndefined();
  });

  it("rejects a non-v12 pack before v12 admission, RNG, legacy calls, or state effects", () => {
    let legacyCalls = 0;
    let rngCalls = 0;
    const countingLegacy = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngCalls += 1;
        return 0;
      },
    });
    const guardedLegacy = {
      apply(...args: Parameters<OfficialGameReducer["apply"]>) {
        legacyCalls += 1;
        return countingLegacy.apply(...args);
      },
      gameDataForContinuation: () => data,
      supportForContinuation: () => completeSupport,
    } as unknown as OfficialGameReducer;
    const v12 = v12Reducer(guardedLegacy);
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    });
    expect(() => v12.apply({
      playerId: "pack-guard-player",
      slotId: "slot-1",
      pack: completePack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "world.leaveTown" })).toThrow(/official-game-v12|v12 pack|simulation/i);
    expect(() => v12.apply({
      playerId: "pack-guard-player",
      slotId: "slot-1",
      pack: { ...completePack, simulationVersion: "official-game-v13" },
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "world.leaveTown" })).toThrow(/official-game-v12|v12 pack|simulation/i);
    const noEggPack = {
      ...completeV12Pack,
      capabilities: {
        ...completeV12Pack.capabilities,
        commandTypes: completeV12Pack.capabilities.commandTypes.filter(
          (commandType) => !commandType.startsWith("egg."),
        ),
      },
    } as unknown as LogicPackDescriptorV1;
    const eggState = parseOfficialGameStateV12(data, quests, {
      ...state,
      pendingEgg: {
        schemaVersion: 1,
        continuationId: "pack-guard-continuation",
        decisionId: "pack-guard-decision",
        kind: "silver",
        origin: "quest",
        remainingRepeats: 1,
        phase: "awaiting-spin",
      },
    });
    const beforeEgg = structuredClone(eggState);
    expect(() => v12.apply({
      playerId: "pack-guard-player",
      slotId: "slot-1",
      pack: noEggPack,
      state: eggState,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "egg.start" })).toThrow(/not advertised|capability/i);
    expect(eggState).toEqual(beforeEgg);
    expect(legacyCalls).toBe(0);
    expect(rngCalls).toBe(0);
    expect(state.nextContinuationSequence).toBe(1);
  });

  it("rejects simultaneous Egg and defeat continuations before exposing the aggregate", () => {
    expect(() => parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
      pendingEgg: {
        schemaVersion: 1,
        continuationId: "continuation-1",
        decisionId: "decision-1",
        kind: "silver",
        origin: "collection",
        remainingRepeats: 1,
        phase: "awaiting-spin",
      },
      pendingDefeat: {
        schemaVersion: 1,
        kind: "defeat",
        decisionId: "decision-2",
        battleId: "battle-1",
        canSaveMe: true,
      },
    })).toThrow(/simultaneous|continuation/i);
  });

  it("splits one Egg from an ordered mixed batch for every supported origin, including Collection handoff", () => {
    const origins = [
      ["store", 0],
      ["tournament", 1],
      ["battle", 1],
      ["quest", 1],
      ["dungeonTreasure", 1],
      ["dungeonCatch", 1],
      ["collection", 1],
    ] as const;
    for (const [origin, remainingRepeats] of origins) {
      let allocations = 0;
      const context: OfficialReduceContext = {
        allocateContinuation: () => {
          allocations += 1;
          return {
            continuationId: `${origin}-continuation`,
            decisionId: `${origin}-decision`,
          };
        },
      };
      const rewards = [
        { kind: "silver", amount: 7 },
        { kind: "egg" },
        { kind: "gold", amount: 11 },
      ] as const;
      const result = splitPendingEggReward(rewards, origin, remainingRepeats, context);
      expect(result.immediate).not.toBe(rewards);
      expect(result.immediate).toEqual([
        { kind: "silver", amount: 7 },
        { kind: "gold", amount: 11 },
      ]);
      expect(result.pendingEgg).toMatchObject({
        origin,
        kind: "silver",
        remainingRepeats,
        phase: "awaiting-spin",
        continuationId: `${origin}-continuation`,
        decisionId: `${origin}-decision`,
      });
      expect(allocations).toBe(1);
    }
  });

  it("rejects two Eggs before the continuation allocator or any routed settlement can run", () => {
    let allocations = 0;
    const context: OfficialReduceContext = {
      allocateContinuation: () => {
        allocations += 1;
        return { continuationId: "never", decisionId: "never" };
      },
    };
    expect(() => splitPendingEggReward([
      { kind: "gold", amount: 1 },
      { kind: "egg" },
      { kind: "monsterEgg" },
    ], "quest", 1, context)).toThrow(/multiple|two|Egg/i);
    expect(allocations).toBe(0);
  });

  it("rejects an Egg Store quantity other than one before routing or any effect", () => {
    let rngCalls = 0;
    const countingLegacy = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngCalls += 1;
        return 0;
      },
    });
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      profile: { ...partyStateV12Core().profile, gold: 1_000 },
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    });
    const before = structuredClone(state);
    expect(() => v12Reducer(countingLegacy).apply({
      playerId: "store-quantity-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "store.purchase", stockId: "egg", quantity: 2 })).toThrow(/quantity|one|single/i);
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);
  });

  it.each([
    {
      name: "start",
      pendingEgg: {
        schemaVersion: 1 as const,
        continuationId: "sequence-start-continuation",
        decisionId: "sequence-start-decision",
        kind: "silver" as const,
        origin: "quest" as const,
        remainingRepeats: 1 as const,
        phase: "awaiting-spin" as const,
      },
      command: { type: "egg.start" as const },
    },
    {
      name: "release",
      pendingEgg: {
        schemaVersion: 1 as const,
        continuationId: "sequence-release-continuation",
        decisionId: "sequence-release-decision",
        kind: "silver" as const,
        origin: "quest" as const,
        remainingRepeats: 1 as const,
        phase: "spinning" as const,
        providers: [protocolGoldPrize],
        reel: [protocolGoldPrize],
        previewMonsterShortTypes: [],
      },
      command: { type: "egg.release" as const },
    },
    {
      name: "repeat",
      pendingEgg: {
        schemaVersion: 1 as const,
        continuationId: "sequence-repeat-continuation",
        decisionId: "sequence-repeat-decision",
        kind: "silver" as const,
        origin: "quest" as const,
        remainingRepeats: 1 as const,
        phase: "awaiting-repeat-or-finish" as const,
        settledPrize: protocolGoldPrize,
        resolution: { kind: "keep" as const },
      },
      command: { type: "egg.repeat" as const },
    },
  ])("reserves the next Egg $name decision before any RNG at MAX_SAFE_INTEGER", ({
    pendingEgg,
    command,
  }) => {
    let rngCalls = 0;
    const countingLegacy = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngCalls += 1;
        return 0;
      },
    });
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      profile: { ...partyStateV12Core().profile, gold: 1_000 },
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      pendingEgg,
      nextContinuationSequence: Number.MAX_SAFE_INTEGER,
    });
    const before = structuredClone(state);
    expect(() => v12Reducer(countingLegacy).apply({
      playerId: "sequence-exhaustion-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, command)).toThrow(/exhausted|safe/i);
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);
  });

  it("rejects Egg Monster Keep before any profile or party mutation at durable sequence exhaustion", () => {
    const monsterPrize = closedUnionMonsterPrize("sequence exhaustion");
    const rngTrace: number[] = [];
    const countingLegacy = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngTrace.push(0);
        return 0;
      },
    });
    const pendingEgg: OfficialEggContinuation = {
      schemaVersion: 1,
      continuationId: "monster-sequence-continuation",
      decisionId: "monster-sequence-decision",
      kind: "gold",
      origin: "quest",
      remainingRepeats: 1,
      phase: "awaiting-prize-resolution",
      providers: [monsterPrize],
      reel: [monsterPrize],
      previewMonsterShortTypes: [monsterPrize.shortType],
      finalReelState: {
        elapsedSeconds: 1.5,
        index: 0,
        speed: 0,
        friction: 0,
        centerIndex: 0,
        stopped: true,
      },
      landedPrize: monsterPrize,
    };
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
      nextMonsterSequence: Number.MAX_SAFE_INTEGER,
      pendingEgg,
    });
    const before = structuredClone(state);
    expect(() => v12Reducer(countingLegacy).apply({
      playerId: "monster-sequence-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "egg.resolvePrize", resolution: { kind: "keep" } }))
      .toThrow(/monster sequence|exhausted|safe/i);
    expect(state).toEqual(before);
    expect(rngTrace).toEqual([]);
  });

  it("rejects custom or unsupported Egg provider shapes before allocation", () => {
    let allocations = 0;
    const context: OfficialReduceContext = {
      allocateContinuation: () => {
        allocations += 1;
        return { continuationId: "never", decisionId: "never" };
      },
    };
    expect(() => splitPendingEggReward([
      { kind: "customEgg" } as never,
    ], "battle", 1, context)).toThrow(/unsupported|provider|Egg/i);
    expect(() => splitPendingEggReward([
      { kind: "egg" },
      { kind: "customEgg" } as never,
    ], "battle", 1, context)).toThrow(/unsupported|provider|Egg/i);
    expect(allocations).toBe(0);
  });

  it("rejects an unfunded v12 Store Egg before debiting or consuming a continuation sequence", () => {
    const rngTrace: number[] = [];
    const countingLegacy = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngTrace.push(0);
        return 0;
      },
    });
    const v12 = v12Reducer(countingLegacy);
    const core = partyStateV12Core();
    const state = parseOfficialGameStateV12(data, quests, {
      ...core,
      profile: { ...core.profile, gold: 0 },
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    });
    const before = structuredClone(state);
    expect(() => v12.apply({
      playerId: "v12-store-insufficient-player",
      slotId: "slot-1",
      pack: completeV12Pack,
      state,
      previousRevision: 1,
      now: "2026-07-29T00:00:00.000Z",
    }, { type: "store.purchase", stockId: "egg", quantity: 1 })).toThrow(/fund|gold|enough/i);
    expect(state).toEqual(before);
    expect(rngTrace).toEqual([]);
  });

  it("settles a v12 Store Egg through one durable continuation and replays its committed receipt", async () => {
    const legacy = completeReducer;
    const v12 = v12Reducer(legacy);
    const store = new InMemoryAuthoritativeSlotStore<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >();
    const authorityOptions = {
      pack: completeV12Pack,
      reducer: v12,
      store,
      validateRecord: (record: Parameters<typeof v12.validatePersistedRecord>[0]) =>
        v12.validatePersistedRecord(record),
    };
    const authority = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >(authorityOptions);
    const created = await authority.execute(
      "v12-store-player",
      "slot-1",
      envelope("v12_store_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    const purchaseCommand = envelope(
      "v12_store_egg_0001",
      created.revision,
      { type: "store.purchase", stockId: "egg", quantity: 1 },
    );
    const purchased = await authority.execute("v12-store-player", "slot-1", purchaseCommand);
    expect(purchased.events).toContainEqual(expect.objectContaining({
      type: "store.purchased",
      stockId: "egg",
      receivedItems: [{ kind: "egg" }],
      randomDraws: [],
    }));
    expect(purchased.projection.pendingEgg).toMatchObject({
      origin: "store",
      kind: "silver",
      remainingRepeats: 0,
      phase: "awaiting-spin",
    });
    expect(purchased.projection.pendingEgg).toMatchObject({
      continuationId: "continuation-1",
      decisionId: "decision-1",
    });
    expect(purchased.projection.player.gold).toBe(0);
    const replay = await authority.execute("v12-store-player", "slot-1", purchaseCommand);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.revision).toBe(purchased.revision);
    expect(replay.projection).toEqual(purchased.projection);
    expect(replay.events).toEqual(purchased.events);
    await expect(authority.execute(
      "v12-store-player",
      "slot-1",
      envelope(
        "v12_store_egg_0001",
        created.revision,
        { type: "store.purchase", stockId: "egg", quantity: 2 },
      ),
    )).rejects.toMatchObject({ code: "COMMAND_DUPLICATE_MISMATCH" });

    let current = purchased;
    let restarted = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >(authorityOptions);
    const phase = async (
      commandId: string,
      command: GameCommandEnvelopeV1["command"],
    ) => {
      const decision = current.projection.decision;
      if (!decision.type.startsWith("egg.") || !("decisionId" in decision)) {
        throw new Error("Store Egg phase decision is missing");
      }
      current = await restarted.execute(
        "v12-store-player",
        "slot-1",
        envelope(commandId, current.revision, command, decision.decisionId),
      );
      return current;
    };
    const started = await phase("v12_store_start_0001", { type: "egg.start" });
    expect(started.projection.decision.type).toBe("egg.spinning");
    const purchaseDecision = purchased.projection.decision;
    if (!purchaseDecision.type.startsWith("egg.") || !("decisionId" in purchaseDecision)) {
      throw new Error("Store Egg purchase decision is missing");
    }
    const startReplay = await restarted.execute(
      "v12-store-player",
      "slot-1",
      envelope(
        "v12_store_start_0001",
        purchased.revision,
        { type: "egg.start" },
        purchaseDecision.decisionId,
      ),
    );
    expect(startReplay.idempotentReplay).toBe(true);
    expect(startReplay).toEqual({ ...started, idempotentReplay: true });
    restarted = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >(authorityOptions);
    expect((await phase("v12_store_release_0001", { type: "egg.release" })).projection.decision.type)
      .toBe("egg.awaitingPrizeResolution");
    const resolved = await phase("v12_store_resolve_0001", {
      type: "egg.resolvePrize",
      resolution: { kind: "keep" },
    });
    expect(resolved.projection.decision.type).toBe("egg.awaitingRepeatOrFinish");
    const finished = await phase("v12_store_finish_0001", { type: "egg.finish" });
    expect(finished.projection.pendingEgg).toBeUndefined();
    expect(finished.projection.decision.type).not.toMatch(/^egg\./);
  });

  it("settles the actual v12 descriptor's Gold Store Egg without leaking a local pending kind", async () => {
    const v12 = v12Reducer();
    const store = new InMemoryAuthoritativeSlotStore<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >();
    const authority = new AuthoritativeGameService<
      OfficialGameStateV12,
      OfficialGameProjectionBodyV12
    >({
      pack: completeV12Pack,
      reducer: v12,
      store,
      validateRecord: (record) => v12.validatePersistedRecord(record),
    });
    const created = await authority.execute(
      "v12-gold-store-player",
      "slot-1",
      envelope("v12_gold_store_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    await store.transact("v12-gold-store-player", "slot-1", async (record) => {
      if (record === undefined) throw new Error("Gold Store slot was not created");
      const state = {
        ...record.state,
        profile: { ...record.state.profile, gold: 1_000 },
      } satisfies OfficialGameStateV12;
      const body = v12.projectPersistedState(state);
      return {
        record: { ...record, state, projection: { ...record.projection, ...body } },
        value: undefined,
      };
    });
    const purchased = await authority.execute(
      "v12-gold-store-player",
      "slot-1",
      envelope("v12_gold_store_purchase_0001", created.revision, {
        type: "store.purchase",
        stockId: "monster-egg",
        quantity: 1,
      }),
    );
    expect(purchased.events).toContainEqual(expect.objectContaining({
      type: "store.purchased",
      stockId: "monster-egg",
      spent: 298,
      receivedItems: [{ kind: "monsterEgg" }],
    }));
    expect(purchased.projection.player.gold).toBe(702);
    expect(purchased.projection.pendingEgg).toMatchObject({
      kind: "gold",
      origin: "store",
      remainingRepeats: 0,
      phase: "awaiting-spin",
    });
    let current = purchased;
    const phase = async (
      commandId: string,
      command: GameCommandEnvelopeV1["command"],
    ) => {
      const decision = current.projection.decision;
      if (!decision.type.startsWith("egg.") || !("decisionId" in decision)) {
        throw new Error("Gold Store Egg phase decision is missing");
      }
      current = await authority.execute(
        "v12-gold-store-player",
        "slot-1",
        envelope(commandId, current.revision, command, decision.decisionId),
      );
      return current;
    };
    await phase("v12_gold_store_start_0001", { type: "egg.start" });
    await phase("v12_gold_store_release_0001", { type: "egg.release" });
    expect((await phase("v12_gold_store_resolve_0001", {
      type: "egg.resolvePrize",
      resolution: { kind: "keep" },
    })).projection.decision.type).toBe("egg.awaitingRepeatOrFinish");
    expect((await phase("v12_gold_store_finish_0001", { type: "egg.finish" })).projection.pendingEgg)
      .toBeUndefined();
  });

  it("serializes concurrent duplicate v12 Store Egg settlement to one debit and one receipt", async () => {
    const v12 = v12Reducer();
    const authority = new AuthoritativeGameService({
      pack: completeV12Pack,
      reducer: v12,
      validateRecord: (record) => v12.validatePersistedRecord(record),
    });
    const created = await authority.execute(
      "v12-store-concurrent-player",
      "slot-1",
      envelope("v12_store_concurrent_create_0001", 0, {
        type: "slot.create",
        starterElement: "Water",
      }),
    );
    const purchase = envelope(
      "v12_store_concurrent_egg_0001",
      created.revision,
      { type: "store.purchase", stockId: "egg", quantity: 1 },
    );
    const attempts = await Promise.all([
      authority.execute("v12-store-concurrent-player", "slot-1", purchase),
      authority.execute("v12-store-concurrent-player", "slot-1", purchase),
    ]);
    expect(attempts.filter(({ idempotentReplay }) => idempotentReplay)).toHaveLength(1);
    expect(attempts.map(({ revision }) => revision)).toEqual([2, 2]);
    expect(attempts[0]!.projection).toEqual(attempts[1]!.projection);
    expect(attempts[0]!.events).toEqual(attempts[1]!.events);
    expect(attempts[0]!.projection.pendingEgg).toMatchObject({
      continuationId: "continuation-1",
      phase: "awaiting-spin",
    });
  });

  it("reports Store insufficiency before max continuation allocation and preserves the service record", async () => {
    let rngCalls = 0;
    const { authority, store, reducer } = v12Service(() => {
      rngCalls += 1;
      return 0;
    });
    await authority.execute("store-order-player", "slot-1", envelope(
      "store-order-create-0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    await store.transact("store-order-player", "slot-1", async (record) => {
      if (record === undefined) throw new Error("Store ordering slot was not created");
      const state = {
        ...record.state,
        profile: { ...record.state.profile, gold: 0 },
        nextContinuationSequence: Number.MAX_SAFE_INTEGER,
      } satisfies OfficialGameStateV12;
      const projectionBody = reducer.projectPersistedState(state);
      return {
        record: { ...record, state, projection: { ...record.projection, ...projectionBody } },
        value: undefined,
      };
    });
    rngCalls = 0;
    const before = await store.read("store-order-player", "slot-1");
    if (before === undefined) throw new Error("Store ordering record was not stored");
    const beforeClone = structuredClone(before);
    await expect(authority.execute(
      "store-order-player",
      "slot-1",
      envelope(
        "store-order-purchase-0001",
        before.revision,
        { type: "store.purchase", stockId: "egg", quantity: 1 },
      ),
    )).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      message: expect.stringMatching(/Store|gold|insufficient/i),
    });
    const after = await store.read("store-order-player", "slot-1");
    expect(after).toEqual(beforeClone);
    expect(after?.state.nextContinuationSequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(after?.state.profile.gold).toBe(0);
    expect(after?.receipts).toEqual(beforeClone.receipts);
    expect(after?.projection).toEqual(beforeClone.projection);
    expect(rngCalls).toBe(0);
  });

  it("rejects an unfunded egg.repeat before debit, continuation allocation, or receipt settlement", async () => {
    const rngTrace: number[] = [];
    const { authority, store, reducer } = v12Service(() => {
      rngTrace.push(0);
      return 0;
    });
    const core = partyStateV12Core();
    await seedServiceV12PendingEgg(
      authority,
      store,
      reducer,
      protocolGoldPrize,
      {
        ...core,
        profile: { ...core.profile, gold: 0 },
        collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
        nextContinuationSequence: 1,
      },
      serviceEggAwaitingRepeat(protocolGoldPrize),
    );
    rngTrace.length = 0;
    const before = await store.read("service-player", "slot-1");
    if (before === undefined) throw new Error("Egg repeat insufficiency record was not stored");
    const beforeClone = structuredClone(before);
    await expect(authority.execute(
      "service-player",
      "slot-1",
      envelope(
        "service-repeat-insufficient",
        before.revision,
        { type: "egg.repeat" },
        serviceDecisionId(before),
      ),
    )).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      message: expect.stringMatching(/afford|repeat/i),
    });
    const after = await store.read("service-player", "slot-1");
    expect(after).toEqual(beforeClone);
    expect(after?.state.profile.gold).toBe(0);
    expect(after?.state.nextContinuationSequence).toBe(beforeClone.state.nextContinuationSequence);
    expect(after?.receipts).toEqual(beforeClone.receipts);
    expect(rngTrace).toEqual([]);
  });

  it.each([
    { label: "recipe", reward: { kind: "recipe", combineName: "NotLoadedRecipe" } },
    { label: "spirit Summon", reward: { kind: "spiritTotem", shortType: "NotLoadedSummon" } },
    { label: "monster", reward: { kind: "monsterJoin", shortType: "NotLoadedMonster", jobLevel: 1 } },
  ] as const)("rejects an invalid $label in dungeon treasure before collection bookkeeping", async ({ reward }) => {
    const rngTrace: number[] = [];
    const legacyAuthority = minimalOperatorEggContentAuthority({
      treasureReward: "egg",
      random: () => {
        rngTrace.push(0);
        return 0;
      },
    });
    const packHex = reward.kind === "recipe" ? "2" : reward.kind === "spiritTotem" ? "3" : "4";
    const fixture = dungeonTreasureV12Fixture(legacyAuthority, packHex);
    const serviceFixture = v12ServiceFor(
      legacyAuthority.reducer,
      fixture.support,
      fixture.pack,
    );
    await serviceFixture.authority.execute("dungeon-invalid-loot-player", "slot-1", envelope(
      "dungeon-invalid-loot-create",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    const invalidState = fixture.state;
    await serviceFixture.store.transact("dungeon-invalid-loot-player", "slot-1", async (record) => {
      if (record === undefined) throw new Error("invalid dungeon loot slot was not created");
      const projectionBody = serviceFixture.reducer.projectPersistedState(invalidState);
      const projection = { ...record.projection, ...projectionBody };
      serviceFixture.reducer.validatePersistedRecord({ state: invalidState, projection });
      return {
        record: { ...record, state: invalidState, projection },
        value: undefined,
      };
    });
    rngTrace.length = 0;
    if (legacyAuthority.setInvalidTreasureReward === undefined) {
      throw new Error("invalid dungeon loot fixture has no late loaded-data mutation seam");
    }
    legacyAuthority.setInvalidTreasureReward(reward.kind);
    const before = await serviceFixture.store.read("dungeon-invalid-loot-player", "slot-1");
    if (before === undefined) throw new Error("invalid dungeon loot record was not stored");
    const beforeClone = structuredClone(before);
    if (before.projection.decision.type !== "dungeon.ready") {
      throw new Error("invalid dungeon loot fixture has no dungeon-ready decision");
    }
    await expect(serviceFixture.authority.execute(
      "dungeon-invalid-loot-player",
      "slot-1",
      envelope(
        `dungeon-invalid-loot-${reward.kind}`,
        before.revision,
        { type: "dungeon.openTreasure", treasureId: fixture.treasureId },
        before.projection.decision.decisionId,
      ),
    )).rejects.toThrow();
    const after = await serviceFixture.store.read("dungeon-invalid-loot-player", "slot-1");
    expect(after).toEqual(beforeClone);
    expect(after?.state.dungeon?.run.current.session.collectedTreasureIds)
      .toEqual(beforeClone.state.dungeon?.run.current.session.collectedTreasureIds);
    expect(after?.state.pendingEgg).toBeUndefined();
    expect(after?.state.nextContinuationSequence).toBe(beforeClone.state.nextContinuationSequence);
    expect(after?.receipts).toEqual(beforeClone.receipts);
    expect(rngTrace).toEqual([]);
  });

  it("rejects a forged descriptor symbol at the service boundary before reducer RNG or slot state", async () => {
    const symbol = Reflect.ownKeys(completeV12Pack).find((key): key is symbol => typeof key === "symbol");
    if (symbol === undefined) throw new Error("legitimate v12 descriptor has no opaque provenance symbol");
    const descriptor = Object.getOwnPropertyDescriptor(completeV12Pack, symbol);
    if (descriptor === undefined) throw new Error("legitimate v12 descriptor symbol has no descriptor");
    const forgedProvenance = structuredClone(descriptor.value);
    const forgedPack = { ...completeV12Pack } as LogicPackDescriptorV1;
    Object.defineProperty(forgedPack, symbol, {
      value: forgedProvenance,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    let rngCalls = 0;
    const legacy = new OfficialGameReducer({
      data,
      world,
      worlds: allWorlds,
      resources: source,
      quests,
      startTownId: "First_City",
      support: completeSupport,
      random: () => {
        rngCalls += 1;
        return 0;
      },
    });
    const v12 = v12Reducer(legacy);
    const store = new InMemoryAuthoritativeSlotStore<OfficialGameStateV12, OfficialGameProjectionBodyV12>();
    const authority = new AuthoritativeGameService<OfficialGameStateV12, OfficialGameProjectionBodyV12>({
      pack: forgedPack,
      reducer: v12,
      store,
      validateRecord: (record) => v12.validatePersistedRecord(record),
    });
    await expect(authority.execute(
      "forged-symbol-player",
      "slot-1",
      envelope("forged-symbol-create", 0, { type: "slot.create", starterElement: "Water" }),
    )).rejects.toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
    expect(await store.read("forged-symbol-player", "slot-1")).toBeUndefined();
    expect(rngCalls).toBe(0);
  });
});

describe("Task 6 immutable v11 to v12 migration", () => {
  it.each([
    ["missing", (() => {
      const { nextBattleSequence: _nextBattleSequence, ...withoutSequence } = partyState();
      return withoutSequence;
    })()],
    ["zero", { ...partyState(), nextBattleSequence: 0 }],
    ["negative", { ...partyState(), nextBattleSequence: -1 }],
    ["null", { ...partyState(), nextBattleSequence: null }],
    ["string", { ...partyState(), nextBattleSequence: "1" }],
    ["NaN", { ...partyState(), nextBattleSequence: Number.NaN }],
    ["Infinity", { ...partyState(), nextBattleSequence: Number.POSITIVE_INFINITY }],
    ["fractional", { ...partyState(), nextBattleSequence: 1.5 }],
    ["unsafe", { ...partyState(), nextBattleSequence: Number.MAX_SAFE_INTEGER + 1 }],
  ] as const)("requires an explicit valid v11 nextBattleSequence ($0)", (_label, value) => {
    expect(() => parseOfficialGameStateV11(data, quests, value)).toThrow(
      /nextBattleSequence|official game state/i,
    );
  });

  it("preserves the maximum safe v11 nextBattleSequence exactly", () => {
    const state = {
      ...partyState(),
      nextBattleSequence: Number.MAX_SAFE_INTEGER,
    };
    expect(parseOfficialGameStateV11(data, quests, state).nextBattleSequence)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it("creates a repeatable v12 view without RNG and preserves the v11 aggregate domains", () => {
    const sourceState = parseOfficialGameStateV11(data, quests, partyState());
    const sourceProjection = SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 17,
      updatedAt: "2026-08-04T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: "official-game-v11",
      trustTier: "official",
      ...completeReducer.projectPersistedState(sourceState),
    });
    const input = {
      data,
      quests,
      state: structuredClone(sourceState),
      projection: structuredClone(sourceProjection),
    };
    const inputBeforeMigration = structuredClone(input);

    const random = vi.spyOn(Math, "random");
    const first = migrateOfficialGameV11ToV12(input);
    const second = migrateOfficialGameV11ToV12(input);

    expect(second).toEqual(first);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    expect(first.schemaVersion).toBe(1);
    expect(first.profile).toEqual(sourceState.profile);
    expect(first.party).toEqual(sourceState.party);
    expect(first.quests).toEqual(sourceState.quests);
    expect(first.location).toEqual(sourceState.location);
    expect(first.world).toEqual(sourceState.world);
    expect(first.dungeon).toEqual(sourceState.dungeon);
    expect(first.battle).toEqual(sourceState.battle);
    expect(first.nextMonsterSequence).toBe(sourceState.nextMonsterSequence);
    expect(first.nextBattleSequence).toBe(sourceState.nextBattleSequence);
    expect(first.collectionClaims).toEqual({ schemaVersion: 1, claimedGoalIds: [] });
    expect(first.nextContinuationSequence).toBe(1);
    expect(first.pendingEgg).toBeUndefined();
    expect(first.pendingDefeat).toBeUndefined();
    expect(parseOfficialGameStateV11(data, quests, sourceState)).toEqual(sourceState);
    expect(parseOfficialGameStateV12(data, quests, first)).toEqual(first);
    // Migration adds only the v12 envelope-owned domains; every v11-projected gameplay field must
    // remain equivalent, and callers' source/projection/receipt inputs are never consumed in place.
    expect(v12Reducer().projectPersistedState(first)).toMatchObject(
      completeReducer.projectPersistedState(sourceState),
    );
    expect(input).toEqual(inputBeforeMigration);
  });

  it.each([
    ["active world battle", () => sourceWorldActiveBattle(), {}],
    ["active dungeon battle", () => officialDungeonBattleFixture().started.state,
      { dungeonResources: source }],
  ] as const)(
    "migrates a nontrivial $0 twice from fresh inputs with exact domain and sequence preservation",
    (_label, makeState, context) => {
      const sourceState = {
        ...makeState(),
        nextMonsterSequence: 137,
        nextBattleSequence: 241,
      };
      expect(sourceState.battle).toBeDefined();
      if (_label === "active dungeon battle") expect(sourceState.dungeon).toBeDefined();
      const parsedSource = parseOfficialGameStateV11(data, quests, sourceState, context);
      const sourceProjection = SlotProjectionV1Schema.parse({
        slotId: "slot-1",
        revision: 37,
        updatedAt: "2026-08-04T00:00:00.000Z",
        logicPackId: completePack.logicPackId,
        simulationVersion: "official-game-v11",
        trustTier: "official",
        ...completeReducer.projectPersistedState(parsedSource),
      });
      const input = {
        data,
        quests,
        state: structuredClone(sourceState),
        projection: structuredClone(sourceProjection),
        context,
      };
      const random = vi.spyOn(Math, "random");
      const first = migrateOfficialGameV11ToV12(input);
      random.mockClear();
      const second = migrateOfficialGameV11ToV12(input);
      expect(second).toEqual(first);
      expect(random).not.toHaveBeenCalled();
      random.mockRestore();

      const { pendingEgg: _pendingEgg, ...sourceCore } = parsedSource;
      expect(first).toEqual({
        ...sourceCore,
        collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
        nextContinuationSequence: 1,
      });
      expect(first.nextMonsterSequence).toBe(137);
      expect(first.nextBattleSequence).toBe(241);
      expect(first.battle).toEqual(parsedSource.battle);
      expect(first.dungeon).toEqual(parsedSource.dungeon);
    },
  );

  it.each([
    ["private state", (state: OfficialGameStateV1, projection: SlotProjectionV1) => ({
      ...state,
      pendingEgg: { schemaVersion: 1 as const, kind: "silver" as const },
    }), (projection: SlotProjectionV1) => projection],
    ["projection", (state: OfficialGameStateV1, _projection: SlotProjectionV1) => state,
      (projection: SlotProjectionV1) => ({
        ...projection,
        pendingEgg: { schemaVersion: 1 as const, kind: "gold" as const },
      })],
  ] as const)("rejects a legacy one-bit Egg in the $0 as unavailable", (_label, stateFor, projectionFor) => {
    const sourceState = partyState();
    const sourceProjection = SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 17,
      updatedAt: "2026-08-04T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: "official-game-v11",
      trustTier: "official",
      ...completeReducer.projectPersistedState(sourceState),
    });
    expect(() => migrateOfficialGameV11ToV12({
      data,
      quests,
      state: stateFor(sourceState, sourceProjection),
      projection: projectionFor(sourceProjection),
    })).toThrowError(expect.objectContaining({ code: "SIMULATION_VERSION_UNAVAILABLE" }));
  });

  it("fails closed on unknown v11 state fields instead of synthesizing a migration", () => {
    const sourceState = { ...partyState(), unexpected: true };
    const sourceProjection = SlotProjectionV1Schema.parse({
      slotId: "slot-1",
      revision: 17,
      updatedAt: "2026-08-04T00:00:00.000Z",
      logicPackId: completePack.logicPackId,
      simulationVersion: "official-game-v11",
      trustTier: "official",
      ...completeReducer.projectPersistedState(partyState()),
    });
    expect(() => migrateOfficialGameV11ToV12({
      data,
      quests,
      state: sourceState,
      projection: sourceProjection,
    })).toThrow(/unknown|unrecognized|official game state/i);
  });
});

/**
 * The authority owns rules, RNG, and outcomes. Which sprite, background, or sound presents them is
 * resolved in the browser against the archive the player selected there, so no shipped-resource
 * reference may be stored in a slot, projected onto the wire, or retained in a command receipt.
 * `apps/web/scripts/check-content-boundary.mjs` enforces the distribution half of this separation;
 * this is the server half.
 */
describe("authoritative content boundary", () => {
  function v12StateFor(active: OfficialGameStateV1): OfficialGameStateV12 {
    return parseOfficialGameStateV12(data, quests, {
      ...active,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, { dungeonResources: source });
  }

  function describeLeaks(leaks: readonly { path: string; detail: string }[]): string[] {
    return leaks.map((leak) => `${leak.path}: ${leak.detail}`);
  }

  function v13Reducer(): OfficialGameV13Reducer {
    return new OfficialGameV13Reducer(v12Reducer(), completeV12Pack);
  }

  it("v16 projects an active world battle's semantic win chat without its portrait", () => {
    const sourceState = sourceWorldActiveBattle();
    const sourceChat = sourceState.battle?.encounter.kind === "world"
      ? sourceState.battle.encounter.generated.winEvent?.chat
      : undefined;
    expect(sourceChat).toBeDefined();
    const state = migrateOfficialGameV15ToV16({
      data,
      quests,
      state: v12StateFor(sourceState),
      context: { dungeonResources: source },
    });
    const projection = v16Reducer().projectPersistedState(state);
    expect(completeV16Pack.simulationVersion).toBe("official-game-v16");
    expect(projection.battle?.winChat).toEqual({
      name: sourceChat!.name,
      alwaysShow: sourceChat!.alwaysShow,
      messageKeys: sourceChat!.messageKeys,
    });
    expect(projection.battle?.winChat).not.toHaveProperty("imageFile");
    expect(describeLeaks(findPresentationLeaks(projection, "projection"))).toEqual([]);
    expect(v15Reducer().projectPersistedState(state).battle).not.toHaveProperty("winChat");
  });

  it.each([
    { label: "world", active: sourceWorldActiveBattle },
    { label: "Arena", active: sourceArenaActiveBattle },
    { label: "dungeon", active: () => officialDungeonBattleFixture(100).started.state },
  ])("keeps shipped-resource references out of a persisted $label battle", ({ active }) => {
    const state = v12StateFor(active());
    const projection = v13Reducer().projectPersistedState(state);
    expect(describeLeaks(findPresentationLeaks(state, "state"))).toEqual([]);
    expect(describeLeaks(findPresentationLeaks(projection, "projection"))).toEqual([]);
    // The scene is semantic, and it is the only thing the browser needs to pick a background.
    expect(projection.battle?.scene).toBeDefined();
    expect(projection.battle).not.toHaveProperty("backgroundKey");
  });

  it("derives each battle scene from the battle's own origin", () => {
    const reducer = v13Reducer();
    const world = reducer.projectPersistedState(v12StateFor(sourceWorldActiveBattle()));
    expect(world.battle?.scene).toEqual({
      kind: "world",
      worldId: "World_1-1",
      poiId: "1-1_Field_3",
    });
    expect(reducer.projectPersistedState(v12StateFor(sourceArenaActiveBattle())).battle?.scene)
      .toEqual({ kind: "arena" });
    const dungeonState = v12StateFor(officialDungeonBattleFixture(100).started.state);
    const dungeonScene = reducer.projectPersistedState(dungeonState).battle?.scene;
    if (dungeonState.battle?.origin.kind !== "dungeon") throw new Error("fixture is not a dungeon");
    expect(dungeonScene).toEqual({
      kind: "dungeon",
      dungeonId: dungeonState.battle.origin.dungeonId,
    });
  });

  it("keeps them out of a live stored record, including retained command receipts", async () => {
    const live = await runLiveV12ServiceDefeat(
      "content-boundary-player",
      officialDungeonBattleFixture(1).started.state,
    );
    // The stored record is exactly the JSON FileAuthoritativeSlotStore writes to disk. The v12
    // service is used here because it owns the live command loop; its receipts must be clean too,
    // since the projection they retain is what a duplicate command replays back to the player.
    expect(describeLeaks(findPresentationLeaks(live.record, "record"))).toEqual([]);
  });

  it("migrates an installed v12 battle by dropping its stored background file name", () => {
    const legacy = v12StateFor(sourceWorldActiveBattle());
    const stored = {
      ...legacy,
      battle: {
        ...legacy.battle!,
        encounter: { ...legacy.battle!.encounter, backgroundKey: "ForestCombat.png" },
      },
    };
    expect(findPresentationLeaks(stored, "stored")).not.toEqual([]);
    const migrated = migrateOfficialGameV12ToV13({
      data,
      quests,
      state: stored,
      context: { dungeonResources: source },
    });
    expect(describeLeaks(findPresentationLeaks(migrated, "migrated"))).toEqual([]);
    expect(migrated.battle?.encounter).not.toHaveProperty("backgroundKey");
    // Everything else survives the migration untouched.
    expect(migrated.battle?.battleId).toBe(legacy.battle?.battleId);
    expect(migrated.battle?.replay).toEqual(legacy.battle?.replay);
    expect(migrated.profile).toEqual(legacy.profile);
  });

  it("still admits the mechanical rules files a dungeon route legitimately names", () => {
    const state = v12StateFor(officialDungeonBattleFixture(100).started.state);
    const sourceFiles: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value !== null && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) {
          if (key === "sourceFile" && typeof entry === "string") sourceFiles.push(entry);
          collect(entry);
        }
      }
    };
    collect(state);
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(sourceFiles.every((file) => isMechanicalLogicPath(file))).toBe(true);
  });
});

describe("official v17 durable dungeon battle return", () => {
  const context = { dungeonResources: source } as const;

  function stateFor(sourceState: OfficialGameStateV1): OfficialGameStateV17 {
    const v12 = parseOfficialGameStateV12(data, quests, {
      ...sourceState,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, context);
    const v13 = migrateOfficialGameV12ToV13({ data, quests, state: v12, context });
    const v14 = migrateOfficialGameV13ToV14({ data, quests, state: v13, context });
    const v15 = migrateOfficialGameV14ToV15({
      data,
      quests,
      state: v14,
      updatedAt: "2026-08-10T00:00:00.000Z",
      context,
    });
    const v16 = migrateOfficialGameV15ToV16({ data, quests, state: v15, context });
    return migrateOfficialGameV16ToV17({ data, quests, state: v16, context });
  }

  function apply(
    reducer: OfficialGameV17Reducer,
    state: OfficialGameStateV17,
    command: GameCommandEnvelopeV1["command"],
    previousRevision: number,
  ) {
    return reducer.apply({
      playerId: "dungeon-v17-route-player",
      slotId: "slot-1",
      pack: completeV17Pack,
      state,
      previousRevision,
      now: "2026-08-10T00:00:00.000Z",
    }, command);
  }

  function finishVictory(initial: OfficialGameStateV17) {
    const reducer = v17Reducer();
    let state = initial;
    for (let turn = 0; turn < 200; turn += 1) {
      const projection = reducer.projectPersistedState(state);
      const decision = projection.decision;
      if (decision.type !== "battle.playerTurn") {
        throw new Error("v17 victory fixture has no player decision");
      }
      const choice = decision.choices.find(({ blockedReasonId }) => blockedReasonId === undefined);
      if (choice === undefined) throw new Error("v17 victory fixture has no usable ability");
      const targetIds = choice.target.kind === "self"
        ? [decision.actorId]
        : choice.target.kind === "allEnemies"
          ? [...decision.enemyTargetIds]
          : choice.target.kind === "allFriends"
            ? [...decision.friendlyTargetIds]
            : choice.target.kind === "enemies"
              ? decision.enemyTargetIds.slice(0, choice.target.count)
              : choice.target.kind === "friends"
                ? decision.friendlyTargetIds.slice(0, choice.target.count)
                : [
                    ...(choice.target.allEnemies
                      ? decision.enemyTargetIds
                      : decision.enemyTargetIds.slice(0, choice.target.enemyCount)),
                    ...(choice.target.allFriends
                      ? decision.friendlyTargetIds
                      : decision.friendlyTargetIds.slice(0, choice.target.friendlyCount)),
                  ];
      const result = apply(reducer, state, {
        type: "battle.chooseAbility",
        battleId: decision.battleId,
        actorId: decision.actorId,
        slot: choice.slot,
        targetIds,
      }, turn + 1);
      if (result.state.location.kind !== "battle") return { reducer, result };
      state = result.state;
    }
    throw new Error("v17 fixture did not reach dungeon victory");
  }

  function finishDefeatDecision(initial: OfficialGameStateV17) {
    const reducer = v17Reducer();
    let state = initial;
    for (let turn = 0; turn < 500; turn += 1) {
      const decision = reducer.projectPersistedState(state).decision;
      if (decision.type === "battle.defeatRecovery") return { reducer, state, decision };
      if (decision.type !== "battle.playerTurn") {
        throw new Error("v17 defeat fixture has no player decision");
      }
      state = apply(reducer, state, {
        type: "battle.delay",
        battleId: decision.battleId,
        actorId: decision.actorId,
      }, turn + 1).state;
    }
    throw new Error("v17 fixture did not reach dungeon defeat recovery");
  }

  it("persists victory handoff identity and the exact pre-battle catch baseline", () => {
    const initial = stateFor(officialDungeonBattleFixture(100).started.state);
    const baseline = [...initial.dungeon!.run.catchTypes].sort();
    const { reducer, result } = finishVictory(initial);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "victory",
    }));
    expect(result.state.dungeonBattleReturn).toEqual({
      schemaVersion: 1,
      battleId: expect.any(String),
      outcome: "victory",
      dungeonId: result.state.location.kind === "dungeon"
        ? result.state.location.dungeonId
        : "not-a-dungeon",
      floor: result.state.location.kind === "dungeon" ? result.state.location.floor : -1,
      roomId: result.state.location.kind === "dungeon" ? result.state.location.roomId : "missing",
      catchTypesBeforeBattle: baseline,
    });
    expect(reducer.projectPersistedState(result.state).dungeonBattleReturn)
      .toEqual(result.state.dungeonBattleReturn);

    const cleared = apply(reducer, result.state, {
      type: "player.claimTutorialFlag",
      flag: "Tutorial0",
    }, 201);
    expect(cleared.state.dungeonBattleReturn).toBeUndefined();
    expect(cleared.projection.dungeonBattleReturn).toBeUndefined();
  });

  it("persists retreat handoff, omits defeat, and rejects forged baselines", () => {
    const retreatInitial = stateFor(officialDungeonBattleFixture(100).started.state);
    const reducer = v17Reducer();
    const decision = reducer.projectPersistedState(retreatInitial).decision;
    if (decision.type !== "battle.playerTurn") throw new Error("v17 retreat fixture has no decision");
    const retreat = apply(reducer, retreatInitial, {
      type: "battle.retreat",
      battleId: decision.battleId,
      actorId: decision.actorId,
    }, 1);
    expect(retreat.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "retreat",
    }));
    expect(retreat.state.dungeonBattleReturn?.outcome).toBe("retreat");

    const defeated = finishDefeatDecision(stateFor(officialDungeonBattleFixture(1).started.state));
    expect(defeated.state.dungeonBattleReturn).toBeUndefined();
    expect(defeated.reducer.projectPersistedState(defeated.state).dungeonBattleReturn)
      .toBeUndefined();

    expect(() => parseOfficialGameStateV17(data, quests, {
      ...retreat.state,
      dungeonBattleReturn: {
        ...retreat.state.dungeonBattleReturn!,
        catchTypesBeforeBattle: ["NoSuchCapturedType"],
      },
    }, context)).toThrow(/baseline contains unavailable/i);
  });

  it("migrates v16 without fabricating a handoff for an already-settled battle", () => {
    const settled = stateFor(finishDungeonVictory(officialDungeonBattleFixture(100)).state);
    const { dungeonBattleReturn: _handoff, ...terminalV16 } = settled;
    const migrated = migrateOfficialGameV16ToV17({ data, quests, state: terminalV16, context });
    expect(migrated.dungeonBattleReturn).toBeUndefined();
    expect(v17Reducer().projectPersistedState(migrated).dungeonBattleReturn).toBeUndefined();
  });
});

describe("official v18 town-origin world battle return", () => {
  const context = { dungeonResources: source } as const;

  function v17StateFor(sourceState: OfficialGameStateV1): OfficialGameStateV17 {
    const v12 = parseOfficialGameStateV12(data, quests, {
      ...sourceState,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 1,
    }, context);
    const v13 = migrateOfficialGameV12ToV13({ data, quests, state: v12, context });
    const v14 = migrateOfficialGameV13ToV14({ data, quests, state: v13, context });
    const v15 = migrateOfficialGameV14ToV15({
      data,
      quests,
      state: v14,
      updatedAt: "2026-08-12T00:00:00.000Z",
      context,
    });
    const v16 = migrateOfficialGameV15ToV16({ data, quests, state: v15, context });
    return migrateOfficialGameV16ToV17({ data, quests, state: v16, context });
  }

  function stateFor(sourceState: OfficialGameStateV1): OfficialGameStateV18 {
    return migrateOfficialGameV17ToV18({
      data,
      quests,
      state: v17StateFor(sourceState),
      context,
    });
  }

  it("commits retreat into the origin town and starts a fresh town refresh", () => {
    const sourceState = structuredClone(sourceWorldActiveBattle());
    if (sourceState.battle?.origin.kind !== "world" || sourceState.world === undefined) {
      throw new Error("town-origin retreat fixture has no world battle");
    }
    const sourceBattle = sourceState.battle;
    const sourceWorld = sourceState.world;
    const townSourceState: OfficialGameStateV1 = {
      ...sourceState,
      battle: {
        ...sourceBattle,
        origin: { kind: "world", worldId: "World_1-1", poiId: "First_City" },
      },
      location: {
        kind: "battle",
        worldId: "World_1-1",
        poiId: "First_City",
        battleId: sourceBattle.battleId,
      },
      world: {
        ...sourceWorld,
        currentPoiId: "First_City",
        lastTownId: "First_City",
        visitedTownIds: [...new Set([...sourceWorld.visitedTownIds, "First_City"])],
      },
    };

    const initial = stateFor(townSourceState);
    const reducer = v18Reducer();
    const before = reducer.projectPersistedState(initial);
    const decision = before.decision;
    if (decision.type !== "battle.playerTurn") {
      throw new Error("town-origin retreat fixture has no player decision");
    }
    const historicalInitial = v17StateFor(townSourceState);
    const historical = v17Reducer();
    const historicalDecision = historical.projectPersistedState(historicalInitial).decision;
    if (historicalDecision.type !== "battle.playerTurn") {
      throw new Error("historical town-origin retreat fixture has no player decision");
    }
    const historicalResult = historical.apply({
      playerId: "town-retreat-player",
      slotId: "slot-1",
      pack: completeV17Pack,
      state: historicalInitial,
      previousRevision: 1,
      now: "2026-08-12T00:00:00.000Z",
    }, {
      type: "battle.retreat",
      battleId: historicalDecision.battleId,
      actorId: historicalDecision.actorId,
    });
    expect(historicalResult.state.location).toEqual({
      kind: "world",
      worldId: "World_1-1",
      poiId: "First_City",
    });

    const result = reducer.apply({
      playerId: "town-retreat-player",
      slotId: "slot-1",
      pack: completeV18Pack,
      state: initial,
      previousRevision: 1,
      now: "2026-08-12T00:00:00.000Z",
    }, {
      type: "battle.retreat",
      battleId: decision.battleId,
      actorId: decision.actorId,
    });

    expect(result.events).toContainEqual(expect.objectContaining({
      type: "battle.ended",
      outcome: "retreat",
    }));
    expect(result.state.location).toEqual({
      kind: "town",
      worldId: "World_1-1",
      townId: "First_City",
    });
    expect(result.state.world).toMatchObject({
      currentPoiId: "First_City",
      lastTownId: "First_City",
      dayNumber: before.world!.dayNumber + 1,
      completedPoiIds: ["First_City"],
    });
    expect(result.state.battle).toBeUndefined();
    expect(result.projection.location.kind).toBe("town");
    expect(() => reducer.projectPersistedState(result.state)).not.toThrow();
  });
});


describe("v23 source Egg RNG with immutable historical delegates", () => {
  it.each(["silver", "gold"] as const)("preserves v22 and uses source draws for %s start/release/repeat", (kind) => {
    let draws = 0;
    const legacy = new OfficialGameReducer({
      data, world, worlds: allWorlds, resources: source, quests, startTownId: "First_City",
      support: completeSupport, random: () => { draws++; return 0; },
    });
    const priorReducer = v22Reducer(legacy);
    const currentReducer = new OfficialGameV23Reducer(priorReducer, completeV22Pack);
    const state = parseOfficialGameStateV12(data, quests, {
      ...partyStateV12Core(),
      profile: { ...partyStateV12Core().profile, gold: 10000 },
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
      nextContinuationSequence: 10,
      pendingEgg: { ...serviceEggAwaitingSpin(), kind },
    });
    const context = {
      playerId: "egg-rng-versions", slotId: "slot-1" as const, state,
      previousRevision: 1, now: "2026-09-06T00:00:00.000Z",
    };
    const old = priorReducer.apply({ ...context, pack: completeV22Pack }, { type: "egg.start" });
    const oldDraws = draws;
    draws = 0;
    const current = currentReducer.apply({ ...context, pack: completeV23Pack }, { type: "egg.start" });
    // Constant-zero choices preserve provider cardinality: only constructor and Casino draws differ.
    expect(draws - oldDraws).toBe(kind === "silver" ? 11 : 1);
    expect(current.state.pendingEgg).toEqual(old.state.pendingEgg);
    expect(migrateOfficialGameV22ToV23({ data, quests, state: old.state })).toEqual(old.state);
    const before = structuredClone(current.state);
    draws = 0;
    const landed = currentReducer.apply({ ...context, state: current.state, pack: completeV23Pack },
      { type: "egg.release", heldFrames: 137 });
    expect(draws).toBe(1);
    expect(current.state).toEqual(before);
    expect(landed.state.pendingEgg).toMatchObject({
      phase: "awaiting-prize-resolution", finalReelState: { friction: 2.6999998092651367 },
    });
    const oldLanded = priorReducer.apply({ ...context, state: old.state, pack: completeV22Pack },
      { type: "egg.release", heldFrames: 137 });
    expect(oldLanded.state.pendingEgg).toMatchObject({
      phase: "awaiting-prize-resolution", finalReelState: { friction: Math.fround(2.7) },
    });
    const resolved = currentReducer.apply({ ...context, state: landed.state, pack: completeV23Pack },
      { type: "egg.resolvePrize", resolution: { kind: "keep" } });
    const oldResolved = priorReducer.apply({ ...context, state: oldLanded.state, pack: completeV22Pack },
      { type: "egg.resolvePrize", resolution: { kind: "keep" } });
    draws = 0;
    currentReducer.apply({ ...context, state: resolved.state, pack: completeV23Pack }, { type: "egg.repeat" });
    const repeatDraws = draws;
    draws = 0;
    priorReducer.apply({ ...context, state: oldResolved.state, pack: completeV22Pack }, { type: "egg.repeat" });
    expect(repeatDraws - draws).toBe(kind === "silver" ? 11 : 1);
  });
});
