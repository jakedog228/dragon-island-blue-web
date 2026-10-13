import { officialEncounterResources, withoutEncounterRenderers } from "./encounterPresentation.js";
export { officialEncounterResources, withoutEncounterRenderers } from "./encounterPresentation.js";
import {
  loadChatDefinition,
  loadDungeonData,
  loadCollectionCatalog,
  loadSourceTutorialTopics,
  loadTownPortalDestinations,
  parseDungeonTreasureData,
  type ChatDefinition,
  type DungeonResourceSource,
  type DungeonTreasureData,
  type CollectionGoalDefinition,
  type GameData,
  type QuestCatalog,
  type TownBuildingDefinition,
  type WorldData,
  type WorldPointOfInterest,
  type TownPortalDestination,
} from "@dib/gamedata";
import {
  DungeonRuntimeController,
  GuildQuestRuntime,
  WorldTripParty,
  advanceBattleReplay,
  advanceWorldDay,
  refreshWorldTripAtTown,
  baseStat,
  battleLivingId,
  buildLicenseChallengeEncounter,
  buildTournamentEncounter,
  canOfferSaveMe,
  collectionGoalProgress,
  buildPlayerChoices,
  dungeonGemSlotWeights,
  dungeonTerminalFlowIdentity,
  dungeonRunUsesLegacyTopology,
  emptyGuildQuestStateSnapshot,
  fixedEncounterCompletionKey,
  generateQuestRewards,
  generateTournamentPrize,
  jobXpForLevel,
  jobCreationLevel,
  parseDungeonRunSnapshot,
  replayableRng,
  restoreBattleReplay,
  sourceConditionsAreMet,
  type BattleReplayCommandV1,
  type BattleReplaySnapshotV1,
  type BattleEvent,
  type GuildQuestEvent,
  type GuildQuestEventResult,
  type GuildQuestStateSnapshot,
  type RestoredBattleReplay,
  type TeamMemberSetup,
  type DungeonEncounter,
  type DungeonMonster,
  type WorldTripPartyStateSnapshotV1,
  type DungeonRunSnapshot,
  type DungeonRouteDescriptor,
  type EggHatchPlayerView,
  type EggHatchPrize,
  REWARD_GEM_STATS,
  type PlayerReward,
  type SourceConditionContext,
  assertExactObjectKeys,
  assertJsonSafeTree,
  assertPlainObject,
} from "@dib/engine";
import {
  OFFICIAL_GAME_SIMULATION_VERSION,
  OFFICIAL_GAME_V11_SIMULATION_VERSION,
  OFFICIAL_GAME_V12_SIMULATION_VERSION,
  OFFICIAL_GAME_V13_SIMULATION_VERSION,
  OFFICIAL_GAME_V14_SIMULATION_VERSION,
  OFFICIAL_GAME_V15_SIMULATION_VERSION,
  OFFICIAL_GAME_V16_SIMULATION_VERSION,
  OFFICIAL_GAME_V17_SIMULATION_VERSION,
  OFFICIAL_GAME_V18_SIMULATION_VERSION,
  OFFICIAL_GAME_V19_SIMULATION_VERSION,
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
  OFFICIAL_GAME_V21_SIMULATION_VERSION,
  OFFICIAL_GAME_V22_SIMULATION_VERSION,
  OFFICIAL_GAME_V23_SIMULATION_VERSION,
  OFFICIAL_GAME_V24_SIMULATION_VERSION,
  OFFICIAL_GAME_V25_SIMULATION_VERSION,
  OFFICIAL_GAME_V26_SIMULATION_VERSION,
  OFFICIAL_GAME_V27_SIMULATION_VERSION,
  OFFICIAL_EGG_POOL_MAX_ENTRIES,
  CollectionClaimsV1Schema,
  CurrentLogicPackDescriptorV1Schema,
  OfficialDefeatDecisionV1Schema,
  OfficialDungeonBattleReturnV1Schema,
  OfficialEggContinuationV1Schema,
  OfficialGameProjectionV12Schema as OfficialGameProjectionV12WireSchema,
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
  OfficialGameProjectionV27Schema,
  SlotProjectionV1Schema,
  CurrentGameCommandV1Schema,
  type GameCommandV1,
  type CurrentGameCommandV1,
  type CollectionClaimsV1,
  type GameCommandTypeV1,
  type LegacyGameCommandTypeV1,
  type LogicPackDescriptorV1,
  type OfficialGameProjectionBodyV12 as OfficialGameProjectionBodyV12Wire,
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
  type OfficialGameProjectionBodyV27,
  type OfficialGameProjectionV13,
  type OfficialGameProjectionV14,
  type OfficialGameProjectionV15,
  type OfficialGameProjectionV16,
  type OfficialGameProjectionV17,
  type OfficialGameProjectionV18,
  type OfficialGameProjectionV19,
  type OfficialGameProjectionV20,
  type OfficialGameProjectionV21,
  type OfficialGameProjectionV22,
  type OfficialGameProjectionV23,
  type OfficialGameProjectionV24,
  type OfficialGameProjectionV25,
  type OfficialGameProjectionV26,
  type OfficialGameProjectionV27,
  type OfficialGameProjectionV12,
  type OfficialDefeatDecisionV1,
  type OfficialDungeonBattleReturnV1,
  type OfficialEggContinuationV1,
  type PresentationEventV1,
  type SlotProjectionV1,
  type UnsequencedPresentationEventV1,
  type QuestJsonWireValue,
} from "@dib/game-protocol";
import {
  GameServiceError,
  type AuthoritativeRecordValidationInput,
  type CommandReducerContext,
  type CommandReducerResult,
  type GameCommandReducer,
} from "@dib/game-service";
import {
  PlayerProfile,
  CollectionClaims,
  battingOrderSizeFor,
  isInfiniteDungeonInstance,
  applyPlayerRewards,
  purchaseStoreStock,
  recipeStoreStock,
  sourceStoreStock,
  sourceNewGameProfileDefaults,
  spiritTotemStoreStock,
  storeHasHalfStar,
  storeWholeStars,
  type PlayerLicenseType,
  type PlayerProfileStateSnapshot,
  type StoreStock,
} from "@dib/player-domain";
import {
  buildOfficialWorldBattle,
  buildOfficialArenaBattle,
  buildOfficialTournamentBattle,
  buildOfficialDungeonBattle,
  buildOfficialDungeonEnemyTeam,
  createInitialOfficialWorldState,
  officialBattleScene,
  restoreOfficialWorldSharedState,
  restoreOfficialWorldTrip,
  snapshotOfficialWorldState,
  validateOfficialWorldSupport,
  type OfficialBattleEncounterV1,
  type OfficialBattleOriginV1,
  type OfficialWorldStateV1,
} from "./worldAuthority.js";
import {
  createOfficialEgg,
  finishOfficialEgg,
  releaseOfficialEgg,
  replayOfficialEggLanding,
  repeatOfficialEgg,
  resolveOfficialEggPrize,
  startOfficialEgg,
  type OfficialEggKeepReward,
  type OfficialEggOrigin,
  type OfficialEggPrize,
  type OfficialEggPrizeSettlement,
} from "./eggContinuation.js";

export * from "./worldAuthority.js";
export * from "./eggContinuation.js";

export type OfficialGameProjectionBodyV1 = Omit<
  SlotProjectionV1,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;
type ProjectionBodyV1 = OfficialGameProjectionBodyV1;
type ProjectionDungeonRunV1 = NonNullable<SlotProjectionV1["dungeon"]>["run"];
type ProjectionDungeonFloorV1 = ProjectionDungeonRunV1["current"]["session"];

function projectDungeonJsonValue(value: unknown): QuestJsonWireValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(projectDungeonJsonValue);
  if (typeof value === "object") {
    const result: { [key: string]: QuestJsonWireValue } = {};
    for (const [key, child] of Object.entries(value)) result[key] = projectDungeonJsonValue(child);
    return result;
  }
  throw new Error("official dungeon projection contains a non-JSON monster argument");
}

function projectDungeonFloor(session: DungeonRunSnapshot["current"]["session"]): ProjectionDungeonFloorV1 {
  const { encounterRosters, ...withoutRosters } = session;
  return {
    ...withoutRosters,
    ...(encounterRosters === undefined
      ? {}
      : {
          encounterRosters: encounterRosters.map((roster) => ({
            ...roster,
            monsters: roster.monsters.map((monster) => {
              const { extraLivingArguments, ...withoutExtra } = monster;
              return {
                ...withoutExtra,
                ...(extraLivingArguments === undefined
                ? {}
                : {
                    extraLivingArguments: Object.fromEntries(
                      Object.entries(extraLivingArguments).map(([key, value]) => [
                        key,
                        projectDungeonJsonValue(value),
                      ]),
                    ),
                  }),
              };
            }),
          })),
        }),
  };
}

function projectDungeonRun(run: DungeonRunSnapshot): ProjectionDungeonRunV1 {
  const cached = (entry: DungeonRunSnapshot["current"]): ProjectionDungeonRunV1["current"] => ({
    route: { ...entry.route },
    session: projectDungeonFloor(entry.session),
  });
  return {
    ...run,
    current: cached(run.current),
    cachedFloors: run.cachedFloors.map(cached),
    registeredWaypoints: run.registeredWaypoints.map(({ route }) => ({ route: { ...route } })),
  };
}

function validateOfficialGameV12Envelope(value: unknown): void {
  assertJsonSafeTree(value, "official v12 game state");
  assertExactObjectKeys(
    value,
    [
      "schemaVersion", "profile", "party", "quests", "location", "world", "battle", "dungeon",
      "pendingEgg", "pendingDefeat", "collectionClaims", "nextMonsterSequence",
      "nextBattleSequence", "nextContinuationSequence",
    ],
    "official v12 game state",
  );
  const state = value as Record<string, unknown>;
  if (state.collectionClaims === undefined) {
    throw new Error("official v12 state is missing required collectionClaims");
  }
  if (
    state.schemaVersion !== 1 ||
    state.profile === undefined ||
    state.party === undefined ||
    state.quests === undefined ||
    state.location === undefined ||
    !isPositiveSequence(state.nextMonsterSequence) ||
    !isPositiveSequence(state.nextBattleSequence) ||
    !isPositiveSequence(state.nextContinuationSequence)
  ) {
    throw new Error("official v12 game state has invalid required envelope fields");
  }
  parseOfficialCollectionClaims(state.collectionClaims);
  const pendingEgg = state.pendingEgg === undefined
    ? undefined
    : OfficialEggContinuationV1Schema.parse(state.pendingEgg) as OfficialEggContinuation;
  const pendingDefeat = state.pendingDefeat === undefined
    ? undefined
    : OfficialDefeatDecisionV1Schema.parse(state.pendingDefeat) as OfficialDefeatDecision;
  validateOfficialGameV12ContinuationFields({
    ...(pendingEgg === undefined ? {} : { pendingEgg }),
    ...(pendingDefeat === undefined ? {} : { pendingDefeat }),
  });
}

function parseOfficialCollectionClaims(value: unknown): OfficialCollectionClaimsStateV1 {
  return structuredClone(CollectionClaimsV1Schema.parse(value));
}

declare const officialV12CollectionCatalogBrand: unique symbol;

/**
 * Opaque proof that the complete installed Collection catalog passed the v12 claim wire
 * preflight. The private brand is a compile-time seam; the WeakSet below is the runtime seam.
 */
export interface OfficialV12CollectionCatalogProof {
  readonly goalIds: readonly string[];
  readonly [officialV12CollectionCatalogBrand]: "validated";
}

const validatedCollectionCatalogProofs = new WeakSet<object>();
interface OfficialV12CollectionCatalogBinding {
  readonly support: OfficialGameSupportReport;
  readonly data: GameData;
  readonly catalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>;
}
const validatedCollectionCatalogBindings = new WeakMap<object, OfficialV12CollectionCatalogBinding>();

/**
 * Operator preflight seam for Task 5: call this on the complete authoritative Collection catalog
 * before advertising Collection. It proves every reachable goal ID fits the existing command
 * identifier wire and that the catalog has one canonical ID per goal; it intentionally imposes
 * no authored-catalog cardinality limit.
 */
export function validateOfficialCollectionCatalog(
  goalIds: readonly string[],
): OfficialV12CollectionCatalogProof;
export function validateOfficialCollectionCatalog(
  catalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>,
  data: GameData,
  support: OfficialGameSupportReport,
): OfficialV12CollectionCatalogProof;
export function validateOfficialCollectionCatalog(
  input: readonly string[] | ReadonlyMap<string, readonly CollectionGoalDefinition[]>,
  data?: GameData,
  support?: OfficialGameSupportReport,
): OfficialV12CollectionCatalogProof {
  if (Array.isArray(input)) {
    const canonical = [...input].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const parsed = CollectionClaimsV1Schema.parse({ schemaVersion: 1, claimedGoalIds: canonical });
    const proof = Object.freeze({
      goalIds: Object.freeze([...parsed.claimedGoalIds]),
    }) as OfficialV12CollectionCatalogProof;
    validatedCollectionCatalogProofs.add(proof);
    return proof;
  }
  if (data === undefined || support === undefined) {
    throw new Error("strict Collection catalog validation requires its loaded data and support report");
  }
  const supportBinding = validatedSupportReports.get(support);
  if (supportBinding === undefined || supportBinding.data !== data) {
    throw new Error("Collection catalog support was not produced for the exact loaded data");
  }
  if (supportBinding.resources === undefined) {
    throw new Error("Collection catalog requires the complete operator resource package");
  }
  const loaded = loadCollectionCatalog(supportBinding.resources, data);
  for (const [collectionType, goals] of loaded.entries()) {
    for (const [index, goal] of goals.entries()) {
      validateEggTreasureData(
        goal.treasureData,
        `Collection.plist.${collectionType}[${index}].treasureData`,
        data,
      );
    }
  }
  const supplied = snapshotCollectionCatalog(
    input as ReadonlyMap<string, readonly CollectionGoalDefinition[]>,
  );
  const expected = snapshotCollectionCatalog(loaded);
  if (canonicalJsonValue(supplied) !== canonicalJsonValue(expected)) {
    throw new Error("Collection catalog is partial, malformed, or does not match the loaded support");
  }
  const goalIds = expected.Base?.map((goal) => `CollectionQuest${goal.key}`) ?? [];
  const parsed = CollectionClaimsV1Schema.parse({ schemaVersion: 1, claimedGoalIds: goalIds.sort() });
  const proof = Object.freeze({
    goalIds: Object.freeze([...parsed.claimedGoalIds]),
  }) as OfficialV12CollectionCatalogProof;
  validatedCollectionCatalogProofs.add(proof);
  validatedCollectionCatalogBindings.set(proof, {
    support,
    data,
    catalog: freezeCollectionCatalog(loaded),
  });
  return proof;
}

function snapshotCollectionCatalog(
  catalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>,
): Readonly<Record<string, readonly CollectionGoalDefinition[]>> {
  if (catalog === null || typeof catalog !== "object" || typeof catalog.entries !== "function") {
    throw new Error("Collection catalog must be a ReadonlyMap");
  }
  const output: Record<string, readonly CollectionGoalDefinition[]> = {};
  const goalIds = new Set<string>();
  for (const [collectionType, goals] of catalog.entries()) {
    if (typeof collectionType !== "string" || collectionType.length === 0 || !Array.isArray(goals)) {
      throw new Error("Collection catalog contains a malformed collection type");
    }
    output[collectionType] = goals.map((goal, index) => {
      if (goal === null || typeof goal !== "object" || Array.isArray(goal)) {
        throw new Error(`Collection catalog goal ${collectionType}[${index}] is malformed`);
      }
      const candidate = goal as Record<string, unknown>;
      const allowed = new Set(["collectionType", "key", "monsterTypes", "treasureData"]);
      if (Object.keys(candidate).some((key) => !allowed.has(key))) {
        throw new Error(`Collection catalog goal ${collectionType}[${index}] contains unknown fields`);
      }
      if (candidate.collectionType !== collectionType ||
          typeof candidate.key !== "string" || candidate.key.length === 0 ||
          !Array.isArray(candidate.monsterTypes) || candidate.monsterTypes.some(
            (shortType) => typeof shortType !== "string" || shortType.length === 0,
          ) || candidate.treasureData === undefined) {
        throw new Error(`Collection catalog goal ${collectionType}[${index}] is malformed`);
      }
      const goalId = `CollectionQuest${candidate.key}`;
      requireId(goalId, "Collection goal ID");
      if (goalIds.has(goalId)) throw new Error(`Collection catalog repeats goal ${goalId}`);
      goalIds.add(goalId);
      assertJsonSafeTree(candidate, `Collection catalog goal ${goalId}`);
      return Object.freeze({
        collectionType,
        key: candidate.key,
        monsterTypes: Object.freeze([...(candidate.monsterTypes as string[])]),
        treasureData: structuredClone(candidate.treasureData) as CollectionGoalDefinition["treasureData"],
      });
    });
  }
  return Object.freeze(output);
}

function freezeCollectionCatalog(
  catalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>,
): ReadonlyMap<string, readonly CollectionGoalDefinition[]> {
  return catalog;
}

function validateOfficialGameV12ContinuationFields(
  state: Pick<OfficialGameStateV12, "pendingEgg" | "pendingDefeat">,
): void {
  const pendingEgg = state.pendingEgg === undefined
    ? undefined
    : OfficialEggContinuationV1Schema.parse(state.pendingEgg) as OfficialEggContinuation;
  const pendingDefeat = state.pendingDefeat === undefined
    ? undefined
    : OfficialDefeatDecisionV1Schema.parse(state.pendingDefeat) as OfficialDefeatDecision;
  if (pendingEgg !== undefined && pendingDefeat !== undefined) {
    throw new Error("official v12 state cannot contain simultaneous continuations");
  }
}

function createOfficialGameStateV12(core: OfficialGameStateV1): OfficialGameStateV12 {
  const { pendingEgg: legacyPendingEgg, ...withoutLegacyEgg } = core;
  if (legacyPendingEgg !== undefined) {
    throw new GameServiceError(
      "CAPABILITY_UNSUPPORTED",
      "the v11 one-bit Egg state cannot enter the v12 aggregate",
    );
  }
  return {
    ...withoutLegacyEgg,
    collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  };
}

function toOfficialGameStateV11(state: OfficialGameStateV12): OfficialGameStateV1 {
  const {
    collectionClaims: _collectionClaims,
    pendingEgg: _pendingEgg,
    pendingDefeat: _pendingDefeat,
    nextContinuationSequence: _nextContinuationSequence,
    ...core
  } = state;
  return core;
}

function projectV12ContinuationBody(
  ordinary: OfficialGameProjectionBodyV1,
  state: Pick<OfficialGameStateV12, "collectionClaims" | "pendingEgg" | "pendingDefeat">,
): OfficialGameProjectionBodyV12 {
  if (ordinary.pendingEgg !== undefined) {
    throw new Error("v12 projection cannot contain the historical one-bit Egg marker");
  }
  const { pendingEgg: _ordinaryEgg, pendingDefeat: _ordinaryDefeat, ...withoutContinuation } = ordinary;
  const decision = state.pendingEgg === undefined
    ? state.pendingDefeat === undefined
      ? ordinary.decision
      : {
          type: "battle.defeatRecovery" as const,
          decisionId: state.pendingDefeat.decisionId,
          battleId: state.pendingDefeat.battleId,
          canSaveMe: state.pendingDefeat.canSaveMe,
        }
    : eggDecisionForV12Continuation(state.pendingEgg);
  return {
    ...withoutContinuation,
    collectionClaims: structuredClone(state.collectionClaims),
    decision,
    ...(state.pendingEgg === undefined ? {} : { pendingEgg: structuredClone(state.pendingEgg) }),
    ...(state.pendingDefeat === undefined
      ? {}
      : { pendingDefeat: structuredClone(state.pendingDefeat) }),
  };
}

function eggDecisionForV12Continuation(
  continuation: OfficialEggContinuation,
): OfficialGameProjectionBodyV12["decision"] {
  const common = {
    decisionId: continuation.decisionId,
    continuationId: continuation.continuationId,
    kind: continuation.kind,
    origin: continuation.origin,
    remainingRepeats: continuation.remainingRepeats,
  } as const;
  switch (continuation.phase) {
    case "awaiting-spin": return { type: "egg.awaitingSpin", ...common };
    case "spinning":
      return {
        type: "egg.spinning",
        ...common,
        providers: continuation.providers,
        reel: continuation.reel,
        previewMonsterShortTypes: continuation.previewMonsterShortTypes,
      };
    case "awaiting-prize-resolution":
      return {
        type: "egg.awaitingPrizeResolution",
        ...common,
        providers: continuation.providers,
        reel: continuation.reel,
        previewMonsterShortTypes: continuation.previewMonsterShortTypes,
        finalReelState: continuation.finalReelState,
        landedPrize: continuation.landedPrize,
      };
    case "awaiting-repeat-or-finish":
      return {
        type: "egg.awaitingRepeatOrFinish",
        ...common,
        settledPrize: continuation.settledPrize,
        resolution: continuation.resolution,
      };
  }
}

function isV12ContinuationCommand(command: GameCommandV1): boolean {
  return command.type === "collection.claim" ||
    command.type === "battle.resolveDefeat" ||
    command.type === "egg.start" ||
    command.type === "egg.release" ||
    command.type === "egg.resolvePrize" ||
    command.type === "egg.repeat" ||
    command.type === "egg.finish";
}

function officialEggPlayerView(profile: PlayerProfile): EggHatchPlayerView {
  return {
    highestRegisteredLevel: (shortType) => profile.highestRegisteredLevel(shortType),
    highestRegisteredLivingLevel: profile.highestRegisteredLivingLevel(),
    goldEggMonsterLevel: profile.goldEggMonsterLevel(),
    availableGemSlots: Array.from(
      { length: Math.min(3, profile.licenseGemSlots) },
      (_, slot) => slot as 0 | 1 | 2,
    ),
    hasCombineRecipe: (shortType) => profile.hasCombineRecipe(shortType),
    // The source provider treats an absent spirit-unlock key as zero. Read the detached
    // authoritative snapshot rather than swallowing a domain lookup failure.
    spiritSavedXp: (shortType) => profile.stateSnapshot().spiritSavedXp[shortType] ?? 0,
  };
}

type OfficialLocationV1 =
  | { readonly kind: "town"; readonly worldId: string; readonly townId: string }
  | { readonly kind: "world"; readonly worldId: string; readonly poiId: string }
  | {
      readonly kind: "battle";
      readonly worldId: string;
      readonly poiId: string;
      readonly battleId: string;
    }
  | {
      readonly kind: "dungeon";
      readonly dungeonId: string;
      readonly floor: number;
      readonly roomId: string;
    };

export interface OfficialDungeonStateV1 {
  readonly schemaVersion: 1;
  readonly run: DungeonRunSnapshot;
  readonly worldId: string;
  readonly entrancePoiId: string;
}

export interface OfficialBattleStateV1 {
  readonly schemaVersion: 1;
  readonly battleId: string;
  readonly origin: OfficialBattleOriginV1;
  readonly encounter: OfficialBattleEncounterV1;
  readonly replay: BattleReplaySnapshotV1;
}

/** Installed-resource context for the authoritative save boundary. Structural parsing remains
 * usable for migrations and tooling, while an admitted/reduced Official state must also restore
 * every current and cached floor against these exact definitions. */
export interface OfficialGameStateParseContext {
  readonly dungeonResources?: DungeonResourceSource;
  /** Internal v12 continuation seam: the retained terminal battle must be this exact battle. */
  readonly terminalDefeatBattleId?: string;
}

/**
 * Project the authoritative dungeon room roster from the initial server replay and its terminal
 * session. The room stores authored encounter tuples, while the battle session stores temporary
 * construction identities; returning the encounter tuple at each retained construction position
 * deliberately excludes every mid-battle creation.
 */
export function deriveOfficialDungeonTerminalSurvivors(
  encounter: Pick<DungeonEncounter, "id" | "monsters">,
  initialEnemyTeam: readonly TeamMemberSetup[],
  restored: Pick<RestoredBattleReplay, "session">,
): readonly DungeonMonster[] {
  if (initialEnemyTeam.length !== encounter.monsters.length) {
    throw new GameServiceError(
      "STATE_CORRUPT",
      `official dungeon encounter ${encounter.id} replay/room team lengths disagree`,
    );
  }
  for (const [index, setup] of initialEnemyTeam.entries()) {
    const authored = encounter.monsters[index];
    if (
      authored === undefined ||
      setup.shortType !== authored.type ||
      setup.level !== authored.level
    ) {
      throw new GameServiceError(
        "STATE_CORRUPT",
        `official dungeon encounter ${encounter.id} replay/room team disagrees at construction position ${index}`,
      );
    }
  }

  const present = new Set([
    ...restored.session.activeIdsOf(1),
    ...restored.session.benchIdsOf(1),
  ]);
  return Object.freeze(initialEnemyTeam.flatMap((setup, index) =>
    present.has(battleLivingId(1, index, setup.shortType))
      ? [encounter.monsters[index]!]
      : []));
}

export interface OfficialGameStateV1 {
  readonly schemaVersion: 1;
  readonly profile: PlayerProfileStateSnapshot;
  readonly party: WorldTripPartyStateSnapshotV1;
  readonly quests: GuildQuestStateSnapshot;
  readonly location: OfficialLocationV1;
  readonly world?: OfficialWorldStateV1;
  readonly battle?: OfficialBattleStateV1;
  readonly dungeon?: OfficialDungeonStateV1;
  readonly pendingEgg?: {
    readonly schemaVersion: 1;
    readonly kind: "silver" | "gold";
  };
  readonly nextMonsterSequence: number;
  readonly nextBattleSequence: number;
}

/** Detached inputs accepted by the only code path allowed to synthesize v12-only state. */
export interface OfficialGameV11MigrationInput {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly projection: unknown;
  readonly context?: OfficialGameStateParseContext;
}

/** Versioned claims are a sibling aggregate value; the profile snapshot is unchanged. */
export type OfficialCollectionClaimsStateV1 = CollectionClaimsV1;







function profileRestoreOptions(
  data: GameData,
  snapshot: PlayerProfileStateSnapshot,
): { readonly evolveChainOf: (shortType: string) => readonly string[] | undefined;
     readonly licenseBattingOrderSize: number } {
  const licenseType: PlayerLicenseType =
    snapshot.schemaVersion === 5 || snapshot.schemaVersion === 6 || snapshot.schemaVersion === 7
    || snapshot.schemaVersion === 8
      ? snapshot.licenseType
      : "Novice";
  return {
    evolveChainOf: (shortType) => data.evolveChainOrUndefined(shortType),
    licenseBattingOrderSize: data.license(licenseType).battingOrderSize,
  };
}

export type OfficialEggContinuation = OfficialEggContinuationV1;
export type OfficialDefeatDecision = OfficialDefeatDecisionV1;

/** Strict v12 state. The core v11 fields retain their existing snapshot shapes. */
export interface OfficialGameStateV12 extends Omit<OfficialGameStateV1, "pendingEgg"> {
  readonly collectionClaims: OfficialCollectionClaimsStateV1;
  readonly pendingEgg?: OfficialEggContinuation;
  readonly pendingDefeat?: OfficialDefeatDecision;
  /** Allocates continuation/decision identities; it is independent of monster IDs and revisions. */
  readonly nextContinuationSequence: number;
}

export type OfficialGameProjectionBodyV12 = OfficialGameProjectionBodyV12Wire;

export interface OfficialContinuationIdentityAllocation {
  readonly continuationId: string;
  readonly decisionId: string;
  readonly nextContinuationSequence: number;
}

export interface OfficialContinuationAllocationTransition {
  readonly allocation: OfficialContinuationIdentityAllocation;
  readonly state: OfficialGameStateV12;
}

export interface OfficialGameReducerOptions {
  readonly data: GameData;
  /** Start world retained as a compatibility alias for callers installing one world. */
  readonly world: WorldData;
  /** Complete operator-installed world set. Defaults to `[world]` for older test fixtures. */
  readonly worlds?: readonly WorldData[];
  readonly resources?: DungeonResourceSource;
  readonly quests: QuestCatalog;
  readonly startTownId: string;
  /** Server-controlled source. Its values are persisted before they become observable. */
  readonly random: () => number;
  /** Opaque proof that the exact installed data/world pair passed authoritative preflight. */
  readonly support: OfficialGameSupportReport;
  /** Test/integration seam immediately before authoritative dungeon event 4 is appended. */
  readonly beforeDungeonRoomRosterUpdated?: (
    events: readonly UnsequencedPresentationEventV1[],
    update: {
      readonly instanceName: string;
      readonly floor: number;
      readonly survivingMonstersByRoom: readonly number[];
      /** Proof seam: event 9 has already updated the run's fixed-completion gate. */
      readonly completedFixedEncounterKeys: readonly string[];
    },
  ) => void;
}

/** The only identities a reward split is allowed to allocate. The v12 aggregate supplies this
 * from its dedicated continuation sequence; reward providers never receive client IDs. */
export interface OfficialReduceContext {
  readonly allocateContinuation: () => Pick<
    OfficialContinuationIdentityAllocation,
    "continuationId" | "decisionId"
  >;
}

interface OfficialEggRewardSplit {
  readonly immediate: readonly PlayerReward[];
  readonly pendingEgg?: OfficialEggContinuation;
}

interface OfficialEggRewardRouter {
  readonly split: (
    rewards: readonly PlayerReward[],
    origin: OfficialEggOrigin,
    remainingRepeats: 0 | 1,
  ) => OfficialEggRewardSplit;
  readonly validateLoadedRewards: (rewards: readonly PlayerReward[]) => void;
}

const sourceJobLevelRules = Symbol("official-v27-job-levels");

interface OfficialInternalReductionContext {
  /** Internal symbol cannot be selected by JSON commands. */
  readonly [sourceJobLevelRules]?: boolean;
  readonly eggRewardRouter?: OfficialEggRewardRouter;
  readonly deferDefeatRecovery?: boolean;
  /** v14-only: retain dungeon/Tournament progress until the recovery command chooses return or
   * restart. Historical reducers leave this false and preserve their committed behavior. */
  readonly deferDefeatConsequences?: boolean;
  /** v16-only: dungeon encounter treasure stays owned by the room until Take All submits
   * dungeon.openTreasure. Historical reducers preserve their battle-terminal settlement. */
  readonly deferDungeonTreasureRewards?: boolean;
  /** v16-only: persist HeroData readiness from newly committed battle damage. Historical reducers
   * retain their frozen omission. */
  readonly chargeBattleSpiritEnergy?: boolean;
  /** v16-only: inherit sparse dungeon monster/treasure populators by property, as native does.
   * Historical reducers retain the port's former whole-row selection. */
  readonly sourceDungeonPopulationInheritance?: boolean;
  /** v18-only: WorldEncounter's victory/retreat return auto-enters a town origin and performs
   * town bookkeeping there. Historical reducers retain their frozen map-return behavior. */
  readonly sourceTownBattleLifecycle?: boolean;
  /** v19-only: allow a replay-derived Utility.Escape terminal to settle a Tournament retreat.
   * The battle.retreat command remains rejected by the encounter's allowRetreat=false gate. */
  readonly allowTournamentRetreat?: boolean;
  /** v20-only: settle Tournament Save Me through the source town lifecycle instead of replacing
   * the defeated battle. World and ordinary-dungeon Save Me continue using the v14 restart rule. */
  readonly sourceTournamentSaveMe?: boolean;
  /** v21-only: accept replay-derived Arena Escape without inventing Arena loss/Tournament return.
   * The live client remains in state 6; the committed town location is recovery-only. */
  readonly allowArenaEscapeStall?: boolean;














  readonly sourceStoryRules?: boolean;
}

interface OfficialInternalReductionResult extends CommandReducerResult<OfficialGameStateV1> {
  readonly pendingEgg?: OfficialEggContinuation;
}

export interface OfficialGameSupportReport {
  readonly worldId: string;
  readonly worldIds: readonly string[];
  readonly dungeonIds: readonly string[];
  readonly startTownId: string;
  readonly commandTypes: readonly LegacyGameCommandTypeV1[];
  readonly tutorialFlags: readonly string[];
  readonly questIds: readonly string[];
}

declare const officialV12EggSupportBrand: unique symbol;



export interface OfficialV12EggSupportProof {
  readonly kinds: readonly ["silver", "gold"];
  readonly maxPoolEntries: typeof OFFICIAL_EGG_POOL_MAX_ENTRIES;
  readonly loadedOrigins: readonly OfficialEggOrigin[];
  readonly handoffOrigins: readonly ["collection"];
  readonly loadedSource: "operator-data";
  readonly authoredEggBatches: readonly {
    readonly origin: OfficialEggOrigin;
    readonly path: string;
    readonly eggKinds: readonly ("silver" | "gold")[];
  }[];
  /** Immutable identity of the exact loaded catalogs/resources inspected by this proof. */
  readonly supportFingerprint: string;
  readonly [officialV12EggSupportBrand]: "validated";
}


export interface OfficialGameV12SupportReport extends Omit<OfficialGameSupportReport, "commandTypes"> {
  readonly commandTypes: readonly GameCommandTypeV1[];
  readonly eggSupport: OfficialV12EggSupportProof;
  readonly collectionCatalog?: OfficialV12CollectionCatalogProof;
}

interface OfficialV12SupportBinding {
  readonly support: OfficialGameSupportReport;
  readonly eggSupport: OfficialV12EggSupportProof;
  readonly data: GameData;
  readonly world: WorldData;
  readonly worlds: readonly WorldData[];
  readonly resources?: DungeonResourceSource;
  readonly quests: QuestCatalog;
  readonly supportFingerprint: string;
  readonly collectionCatalog?: OfficialV12CollectionCatalogProof;
}

const validatedV12SupportReports = new WeakMap<object, OfficialV12SupportBinding>();
const loadedEggProofBySupport = new WeakMap<object, OfficialV12EggSupportProof>();
const validatedEggSupportProofs = new WeakSet<object>();
const validatedV12DescriptorBindings = new Map<string, {
  readonly support: OfficialGameV12SupportReport;
  readonly proof: OfficialV12EggSupportProof;
  readonly supportFingerprint: string;
  readonly descriptorFingerprint: string;
  readonly commandTypes: readonly GameCommandTypeV1[];
  readonly collectionCatalog?: OfficialV12CollectionCatalogProof;
}>();

/**
 * This symbol is deliberately module-private. The generic service may carry opaque symbol
 * properties through its in-memory descriptor clone, but it cannot manufacture the value stored
 * here. JSON, receipts, projections, and persistence never enumerate symbol properties.
 */
const officialV12DescriptorProvenance = Symbol("official-game-v12-descriptor-provenance");

interface OfficialV12DescriptorProvenance {
  readonly support: OfficialGameV12SupportReport;
  readonly proof: OfficialV12EggSupportProof;
  readonly descriptorFingerprint: string;
  readonly token: object;
  readonly collectionCatalog?: OfficialV12CollectionCatalogProof;
}

const validatedV12DescriptorProvenances = new WeakSet<object>();
const validatedV12DescriptorTokens = new WeakSet<object>();

/**
 * Structural preflight output is intentionally not part of the public proof. These private
 * reference sets are the evidence boundary for the closed engine provider union: the engine owns
 * provider selection and RNG, while this module proves that every loaded reference the engine can
 * emit is present and settleable. `generateEggHatchPool` is that closed engine union and is
 * source-tested separately; these arrays are not a simulation of it and never manufacture an
 * expected provider list.
 */
interface OfficialV12EggSupportInternals {
  readonly eligibleMonsterShortTypes: readonly string[];
  readonly prizeMonsterShortTypes: readonly string[];
  readonly evolutionRootShortTypes: readonly string[];
  readonly recipeResultShortTypes: readonly string[];
  readonly itemPaths: readonly string[];
  readonly spiritSummonShortTypes: readonly string[];
  readonly supportFingerprint: string;
}

const validatedEggSupportInternals = new WeakMap<object, OfficialV12EggSupportInternals>();

type OfficialV11LiveCommandType = Exclude<LegacyGameCommandTypeV1, "tournament.settlePrize">;

function isCurrentOfficialCommandType(
  commandType: LegacyGameCommandTypeV1,
): commandType is OfficialV11LiveCommandType {
  return commandType !== "tournament.settlePrize";
}

/**
 * Prepare the v12 capability seam without changing the installed v11 descriptor. Egg and
 * continuation commands are added only after the loaded-corpus proofs below succeed.
 */
export function createOfficialGameV12Support(options: {
  readonly support: OfficialGameSupportReport;
  readonly commandTypes?: readonly GameCommandTypeV1[];
  readonly collectionCatalog?: OfficialV12CollectionCatalogProof;
}): OfficialGameV12SupportReport {
  requireValidatedSupport(options.support);
  const supportBinding = validatedSupportReports.get(options.support);
  if (supportBinding === undefined) throw new Error("official support binding is unavailable");
  if (options.collectionCatalog !== undefined &&
      !validatedCollectionCatalogProofs.has(options.collectionCatalog)) {
    throw new Error("v12 Collection catalog requires an opaque validated proof");
  }
  if (options.collectionCatalog !== undefined) {
    const catalogBinding = validatedCollectionCatalogBindings.get(options.collectionCatalog);
    if (catalogBinding === undefined ||
        catalogBinding.support !== options.support ||
        catalogBinding.data !== supportBinding.data) {
      throw new Error("v12 Collection catalog proof is not bound to the exact loaded support");
    }
  }
  if (options.commandTypes?.includes("collection.claim") && options.collectionCatalog === undefined) {
    throw new Error("collection.claim requires a validated catalog proof");
  }
  let eggSupport = loadedEggProofBySupport.get(options.support);
  if (eggSupport === undefined) {
    eggSupport = validateOfficialEggSupport({
      data: supportBinding.data,
      world: supportBinding.world,
      worlds: supportBinding.worlds,
      ...(supportBinding.resources === undefined ? {} : { resources: supportBinding.resources }),
      quests: supportBinding.quests,
      support: options.support,
    });
    loadedEggProofBySupport.set(options.support, eggSupport);
  }
  const baseCommandTypes = options.support.commandTypes
    .filter(isCurrentOfficialCommandType) as GameCommandTypeV1[];
  const eggCommandTypes = [
    "egg.start",
    "egg.release",
    "egg.resolvePrize",
    "egg.repeat",
    "egg.finish",
  ] as const satisfies readonly GameCommandTypeV1[];
  const continuationCommandTypes = ["battle.resolveDefeat"] as const satisfies readonly GameCommandTypeV1[];
  const requestedCommandTypes = options.commandTypes;
  const commandTypes = requestedCommandTypes === undefined
    ? [...baseCommandTypes, ...continuationCommandTypes, ...eggCommandTypes,
       ...(options.collectionCatalog === undefined ? [] : ["collection.claim" as const])]
    : [...new Set([
        ...requestedCommandTypes,
        ...continuationCommandTypes,
        ...eggCommandTypes,
        ...(options.collectionCatalog === undefined ? [] : ["collection.claim" as const]),
      ])];
  if (new Set(commandTypes).size !== commandTypes.length) {
    throw new Error("v12 commandTypes must be unique");
  }
  const base = new Set<GameCommandTypeV1>([
    ...baseCommandTypes,
    ...continuationCommandTypes,
    ...eggCommandTypes,
    ...(options.collectionCatalog === undefined ? [] : ["collection.claim" as const]),
  ]);
  for (const commandType of commandTypes) {
    if (commandType !== "collection.claim" && !base.has(commandType)) {
      throw new Error(`v12 command ${commandType} is not supported by the installed preflight`);
    }
  }
  const report = Object.freeze({
    ...options.support,
    commandTypes: Object.freeze(commandTypes),
    eggSupport,
    ...(options.collectionCatalog === undefined
      ? {}
      : { collectionCatalog: options.collectionCatalog }),
  }) as OfficialGameV12SupportReport;
  validatedV12SupportReports.set(report, {
    support: options.support,
    eggSupport,
    data: supportBinding.data,
    world: supportBinding.world,
    worlds: supportBinding.worlds,
    ...(supportBinding.resources === undefined ? {} : { resources: supportBinding.resources }),
    quests: supportBinding.quests,
    supportFingerprint: eggSupport.supportFingerprint,
    ...(options.collectionCatalog === undefined ? {} : { collectionCatalog: options.collectionCatalog }),
  });
  return report;
}

const STARTER_BY_ELEMENT = {
  Water: "BlueBabyDragon",
  Fire: "RedBabyDragon",
  Air: "WhiteBabyDragon",
  Earth: "GoldBabyDragon",
} as const;

export {
  OFFICIAL_GAME_SIMULATION_VERSION,
  OFFICIAL_GAME_V11_SIMULATION_VERSION,
  OFFICIAL_GAME_V12_SIMULATION_VERSION,
  OFFICIAL_GAME_V13_SIMULATION_VERSION,
  OFFICIAL_GAME_V14_SIMULATION_VERSION,
  OFFICIAL_GAME_V15_SIMULATION_VERSION,
  OFFICIAL_GAME_V16_SIMULATION_VERSION,
  OFFICIAL_GAME_V17_SIMULATION_VERSION,
  OFFICIAL_GAME_V18_SIMULATION_VERSION,
  OFFICIAL_GAME_V19_SIMULATION_VERSION,
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
};
export const OFFICIAL_GAME_COMMAND_TYPES = [
  "slot.create",
  "world.leaveTown",
  "world.navigate",
  "world.selectCurrentPoi",
  "world.useDirectTownReturn",
  "world.usePortal",
  "world.activateZone",
  "dungeon.selectRoom",
  "dungeon.activateZone",
  "dungeon.travelToWaypoint",
  "dungeon.openTreasure",
  "dungeon.claimCatchReward",
  "battle.chooseAbility",
  "battle.attemptCapture",
  "battle.delay",
  "battle.retreat",
  "battle.summonSpirit",
  "party.commitBattingPriority",
  "party.combine",
  "party.evolve",
  "party.healInjury",
  "party.destroyMonster",
  "party.convertToSoulStone",
  "party.insertSoulStone",
  "player.claimTutorialFlag",
  "player.claimDialog",
  "player.dropInventoryItem",
  "player.equipGem",
  "player.unequipGem",
  "player.incrementSkill",
  "player.decrementSkill",
  "store.purchase",
  "arena.startLicenseChallenge",
  "tournament.startBattle",
  "tournament.claimPrize",
  "tournament.settlePrize",
  "quest.accept",
  "quest.claim",
  "quest.dropAll",
] as const satisfies readonly LegacyGameCommandTypeV1[];

const validatedSupportReports = new WeakMap<
  object,
  {
    readonly data: GameData;
    readonly world: WorldData;
    readonly worlds: readonly WorldData[];
    readonly resources?: DungeonResourceSource;
    readonly quests: QuestCatalog;
  }
>();


function validateOfficialEggSupport(options: {
  readonly data: GameData;
  readonly world: WorldData;
  readonly worlds: readonly WorldData[];
  readonly resources?: DungeonResourceSource;
  readonly quests: QuestCatalog;
  readonly support: OfficialGameSupportReport;
}): OfficialV12EggSupportProof {
  const originReport = validateLoadedEggRewardOrigins(options);
  const data = options.data;
  const monsters = data.allMonsters();
  if (monsters.length === 0) throw new Error("official Egg preflight found no monster data");

  const eligibleMonsterShortTypes = new Set<string>();
  const prizeMonsterShortTypes = new Set<string>();
  const evolutionRootShortTypes = new Set<string>();
  for (const monster of monsters) {
    requireId(monster.shortType, "Egg monster shortType");
    if (!Number.isSafeInteger(monster.index) || monster.index < 0) {
      throw new GameServiceError("CAPABILITY_UNSUPPORTED", `invalid monster index for ${monster.shortType}`);
    }
    data.monsterByShortType(monster.shortType);
    const chain = data.evolveChainOf(monster.shortType);
    const rootShortType = chain[0];
    if (rootShortType === undefined) {
      throw new Error("official Egg preflight found an evolution chain without a root");
    }
    const root = data.monsterByShortType(rootShortType);
    if (root.category === "Normal") {
      eligibleMonsterShortTypes.add(monster.shortType);
      evolutionRootShortTypes.add(rootShortType);
    }
  }
  if (eligibleMonsterShortTypes.size === 0) {
    throw new Error("official Egg preflight found no eligible monster definitions");
  }
  for (const shortType of Object.values(STARTER_BY_ELEMENT)) {
    data.monsterByShortType(shortType);
    prizeMonsterShortTypes.add(shortType);
  }

  const recipeResultShortTypes = new Set<string>();
  for (const recipe of data.allCombineRecipes()) {
    requireId(recipe.resultShortType, "Egg recipe result");
    data.combineRecipe(recipe.resultShortType);
    data.monsterByShortType(recipe.resultShortType);
    for (const ingredient of recipe.ingredients) data.monsterByShortType(ingredient);
    recipeResultShortTypes.add(recipe.resultShortType);
  }
  const itemPaths = new Set<string>();
  for (const item of data.allItems()) {
    requireId(item.path, "Egg item path");
    data.item(item.path);
  }
  for (const path of ["Usables.CardSilver", "Usables.CardGold"] as const) {
    data.item(path);
    itemPaths.add(path);
  }
  const spiritSummonShortTypes = new Set<string>();
  for (const monster of monsters) {
    if (monster.category !== "Summon") continue;
    data.monsterByShortType(monster.shortType);
    spiritSummonShortTypes.add(monster.shortType);
  }
  if (recipeResultShortTypes.size === 0 || spiritSummonShortTypes.size === 0) {
    throw new Error("official Egg preflight found an incomplete loaded Egg catalog");
  }
  for (const license of data.allLicenses()) {
    if (!Number.isSafeInteger(license.gemSlots) || license.gemSlots < 0) {
      throw new GameServiceError("CAPABILITY_UNSUPPORTED", `invalid Gem slot count for ${license.type}`);
    }
  }

  const structuralSummary = {
    eligibleMonsterShortTypes: [...eligibleMonsterShortTypes].sort(),
    evolutionRootShortTypes: [...evolutionRootShortTypes].sort(),
    recipeResultShortTypes: [...recipeResultShortTypes].sort(),
    itemPaths: [...itemPaths].sort(),
    spiritSummonShortTypes: [...spiritSummonShortTypes].sort(),
    gemLevels: [1, 150],
    gemQualities: [0, 1],
    gemSlots: [0, 1, 2],
    goldAmounts: [50, 150],
    silverAmounts: [500, 1_500],
    authoredEggBatches: originReport.authoredEggBatches,
  } as const;
  const supportFingerprint = canonicalJsonValue({
    support: {
      worldId: options.support.worldId,
      worldIds: options.support.worldIds,
      dungeonIds: options.support.dungeonIds,
      startTownId: options.support.startTownId,
      questIds: options.support.questIds,
    },
    structuralSummary,
    authoredEggBatches: originReport.authoredEggBatches,
  });
  const proof = Object.freeze({
    kinds: Object.freeze(["silver", "gold"] as const),
    maxPoolEntries: OFFICIAL_EGG_POOL_MAX_ENTRIES,
    loadedOrigins: Object.freeze([...originReport.loadedOrigins]),
    handoffOrigins: Object.freeze(["collection"] as const),
    loadedSource: "operator-data" as const,
    authoredEggBatches: Object.freeze(originReport.authoredEggBatches),
    supportFingerprint,
  }) as OfficialV12EggSupportProof;
  validatedEggSupportInternals.set(proof, Object.freeze({
    eligibleMonsterShortTypes: Object.freeze([...eligibleMonsterShortTypes].sort()),
    prizeMonsterShortTypes: Object.freeze([...prizeMonsterShortTypes].sort()),
    evolutionRootShortTypes: Object.freeze([...evolutionRootShortTypes].sort()),
    recipeResultShortTypes: Object.freeze([...recipeResultShortTypes].sort()),
    itemPaths: Object.freeze([...itemPaths].sort()),
    spiritSummonShortTypes: Object.freeze([...spiritSummonShortTypes].sort()),
    supportFingerprint,
  }));
  validatedEggSupportProofs.add(proof);
  return proof;
}

function validateOfficialEggKeepReward(data: GameData, reward: OfficialEggKeepReward): void {
  switch (reward.kind) {
    case "monsterJoin":
      data.monsterByShortType(reward.shortType);
      if (!Number.isSafeInteger(reward.jobLevel) || reward.jobLevel < 1 || reward.jobLevel > 150) {
        throw new Error("official Egg preflight found an invalid monster prize level");
      }
      break;
    case "recipe":
      data.combineRecipe(reward.combineName);
      break;
    case "spiritTotem":
      data.monsterByShortType(reward.shortType);
      break;
    case "item":
      data.item(reward.definitionPath);
      if (!Number.isSafeInteger(reward.level) || reward.level < 1 || reward.level > 150) {
        throw new Error("official Egg preflight found an invalid item reward level");
      }
      break;
    case "gold":
    case "silver":
      if (!Number.isSafeInteger(reward.amount) || reward.amount <= 0) {
        throw new Error("official Egg preflight found an invalid currency reward amount");
      }
      break;
    case "gem":
      if (
        !Number.isSafeInteger(reward.level) || reward.level < 1 || reward.level > 150 ||
        (reward.quality !== 0 && reward.quality !== 1) ||
        (reward.slot !== 0 && reward.slot !== 1 && reward.slot !== 2) ||
        reward.enabledStats.length < 1 || reward.enabledStats.length > 2 ||
        reward.enabledStats.some((stat, index) =>
          !REWARD_GEM_STATS.includes(stat) || reward.enabledStats.indexOf(stat) !== index)
      ) {
        throw new Error("official Egg preflight found an invalid Gem reward");
      }
      break;
  }
}

function validateLoadedEggRewardOrigins(options: {
  readonly data: GameData;
  readonly world: WorldData;
  readonly worlds: readonly WorldData[];
  readonly resources?: DungeonResourceSource;
  readonly quests: QuestCatalog;
}): {
  readonly loadedOrigins: readonly OfficialEggOrigin[];
  readonly authoredEggBatches: readonly {
    readonly origin: OfficialEggOrigin;
    readonly path: string;
    readonly eggKinds: readonly ("silver" | "gold")[];
  }[];
} {
  const loadedOrigins = new Set<OfficialEggOrigin>(["store"]);
  const authoredEggBatches: {
    readonly origin: OfficialEggOrigin;
    readonly path: string;
    readonly eggKinds: readonly ("silver" | "gold")[];
  }[] = [];
  const inspect = (treasure: DungeonTreasureData, path: string, origin: OfficialEggOrigin): void => {
    const eggKinds = validateEggTreasureData(treasure, path, options.data);
    if (eggKinds.length === 0) return;
    loadedOrigins.add(origin);
    authoredEggBatches.push(Object.freeze({ origin, path, eggKinds: Object.freeze([...eggKinds]) }));
  };
  for (const stockId of ["egg", "monster-egg"] as const) {
    const stock = sourceStoreStock(stockId);
    if (stock.kind !== "egg") {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        `Store stock ${stockId} is not a supported standard Egg`,
      );
    }
  }

  for (const tournament of options.data.allTournaments()) {
    inspect(
      parseDungeonTreasureData(
        tournament.treasureData,
        "Tournaments.plist[" + tournament.index + "].treasureData",
        1,
      ),
      "Tournaments.plist[" + tournament.index + "].treasureData",
      "tournament",
    );
    for (const [round, candidate] of tournament.monsterPopulators.entries()) {
      const treasureData = candidate["treasureData"];
      if (treasureData === undefined) continue;
      inspect(
        parseDungeonTreasureData(
          treasureData,
          `Tournaments.plist[${tournament.index}].monsterPopulators[${round}].treasureData`,
          1,
        ),
        `Tournaments.plist[${tournament.index}].monsterPopulators[${round}].treasureData`,
        "battle",
      );
    }
  }
  for (const quest of options.quests.definitions) {
    inspect(
      parseDungeonTreasureData(
        quest.treasureData,
        "Quests.plist." + quest.name + ".treasureData",
        1,
        options.data,
      ),
      "Quests.plist." + quest.name + ".treasureData",
      "quest",
    );
  }
  for (const world of options.worlds) {
    for (const poi of world.pointsOfInterest) {
      for (const populator of poi.randomPopulators) {
        for (const fixed of populator.fixedEncounters) {
          if (fixed.treasureData !== undefined) {
            inspect(
              fixed.treasureData,
              world.name + "." + poi.name + ".fixed[" + fixed.sourceIndex + "].treasureData",
              "battle",
            );
          }
        }
      }
    }
  }
  const dungeonEntrances = options.worlds.flatMap((candidateWorld) =>
    candidateWorld.pointsOfInterest.filter(({ zoneChange }) => zoneChange?.kind === "dungeon"));
  if (options.resources === undefined) {
    if (dungeonEntrances.length > 0) {
      throw new Error("official Egg preflight requires loaded dungeon resources");
    }
    return {
      loadedOrigins: Object.freeze([...loadedOrigins].sort()),
      authoredEggBatches: Object.freeze([...authoredEggBatches].sort(compareEggBatch)),
    };
  }
  const knownMonsters = new Set(options.data.allMonsters().map(({ shortType }) => shortType));
  const loadedDungeons = new Set<string>();
  for (const world of options.worlds) {
    for (const poi of world.pointsOfInterest) {
      const change = poi.zoneChange;
      if (change?.kind !== "dungeon") continue;
      if (change.dungeon === undefined || change.dungeonFile === undefined) {
        throw new GameServiceError(
          "CAPABILITY_UNSUPPORTED",
          `Dungeon route ${world.name}.${poi.name} is missing its resource identity`,
        );
      }
      const dungeon = loadDungeonData(
        options.resources,
        change.dungeon,
        change.dungeonFile,
        change.dungeonLevel ?? 1,
        knownMonsters,
      );
      const key = dungeon.typeName + ":" + dungeon.sourceFile + ":" + dungeon.instanceName;
      if (loadedDungeons.has(key)) continue;
      loadedDungeons.add(key);
      for (const floor of dungeon.floorPopulations) {
        const treasure = floor.treasurePopulator?.treasureData;
        if (treasure !== undefined) {
          inspect(
            treasure,
            key + ".floor" + floor.sourceFloor + ".treasurePopulator",
            "dungeonTreasure",
          );
        }
        for (const fixed of floor.monsterPopulator?.fixedEncounters ?? []) {
          if (fixed.treasureData === undefined) continue;
          inspect(
            fixed.treasureData,
            key + ".floor" + floor.sourceFloor + ".fixed[" + fixed.sourceIndex + "].treasureData",
            "dungeonTreasure",
          );
        }
      }
      if (dungeon.catchQuest !== undefined) {
        inspect(
          dungeon.catchQuest.treasureData,
          key + ".catchQuest.treasureData",
          "dungeonCatch",
        );
      }
    }
  }
  return {
    loadedOrigins: Object.freeze([...loadedOrigins].sort()),
    authoredEggBatches: Object.freeze([...authoredEggBatches].sort(compareEggBatch)),
  };
}

function compareEggBatch(
  left: { readonly origin: OfficialEggOrigin; readonly path: string },
  right: { readonly origin: OfficialEggOrigin; readonly path: string },
): number {
  const leftKey = `${left.origin}:${left.path}`;
  const rightKey = `${right.origin}:${right.path}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function validateEggTreasureData(
  treasure: DungeonTreasureData,
  path: string,
  data: GameData,
): readonly ("silver" | "gold")[] {
  const eggKinds: ("silver" | "gold")[] = [];
  if (!Number.isFinite(treasure.levelScalor) ||
      (treasure.defaultSpawnChance !== undefined &&
       (!Number.isFinite(treasure.defaultSpawnChance) ||
        treasure.defaultSpawnChance < 0 || treasure.defaultSpawnChance > 1))) {
    throw new GameServiceError("CAPABILITY_UNSUPPORTED", `${path} has an invalid treasure schema`);
  }
  for (const [index, item] of treasure.items.entries()) {
    if (item.chance !== undefined &&
        (!Number.isFinite(item.chance) || item.chance < 0 || item.chance > 1)) {
      throw new GameServiceError("CAPABILITY_UNSUPPORTED", `${path}.items[${index}] has an invalid chance`);
    }
    if (!Number.isFinite(item.levelScalor)) {
      throw new GameServiceError("CAPABILITY_UNSUPPORTED", `${path}.items[${index}] has an invalid levelScalor`);
    }
    if (item.kind !== "fixed") continue;
    switch (item.data.kind) {
      case "egg":
        eggKinds.push("silver");
        break;
      case "monsterEgg":
        eggKinds.push("gold");
        break;
      case "monsterJoin":
        data.monsterByShortType(item.data.shortType);
        if (!Number.isSafeInteger(item.data.jobLevel) || item.data.jobLevel < 1 || item.data.jobLevel > 150) {
          throw new GameServiceError("CAPABILITY_UNSUPPORTED", `${path}.items[${index}] has an invalid monster level`);
        }
        break;
      case "recipe":
        data.combineRecipe(item.data.combineName);
        break;
      case "spiritTotem":
        if (data.monsterByShortType(item.data.shortType).category !== "Summon") {
          throw new GameServiceError("CAPABILITY_UNSUPPORTED", `${path}.items[${index}] references a non-Summon Totem`);
        }
        break;
      case "repeatEgg":
      case "usable":
        throw new GameServiceError(
          "CAPABILITY_UNSUPPORTED",
          `${path}.items[${index}] uses local-only reward class ${item.data.kind}`,
        );
    }
    if (eggKinds.length > 1) {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        path + ".items[" + index + "] makes multiple Egg outcomes reachable",
      );
    }
  }
  return eggKinds;
}
export function validateOfficialGameSupport(options: {
  readonly data: GameData;
  readonly world: WorldData;
  readonly worlds?: readonly WorldData[];
  readonly resources?: DungeonResourceSource;
  readonly quests: QuestCatalog;
  readonly startTownId: string;
}): OfficialGameSupportReport {
  const worlds = normalizedWorlds(options.world, options.worlds);
  requireId(options.world.name, "world.name");
  requireId(options.startTownId, "startTownId");
  const startTown = options.world.pointsOfInterest.find(
    (poi) => poi.name === options.startTownId && poi.town !== undefined,
  );
  if (startTown === undefined) {
    throw new Error(`start town ${options.startTownId} is absent from ${options.world.name}`);
  }
  for (const starter of Object.values(STARTER_BY_ELEMENT)) {
    options.data.monsterByShortType(starter);
  }
  for (const monster of options.data.allMonsters()) {
    buildPlayerChoices(options.data, monster.shortType);
  }
  const knownMonsters = new Set(options.data.allMonsters().map(({ shortType }) => shortType));
  for (const world of worlds) validateOfficialWorldSupport(options.data, world);
  const dungeonIds = new Set<string>();
  for (const world of worlds) {
    for (const poi of world.pointsOfInterest) {
      if (poi.zoneChange?.kind !== "dungeon") continue;
      if (options.resources === undefined) continue;
      if (
        poi.zoneChange.dungeon === undefined ||
        poi.zoneChange.dungeonFile === undefined
      ) {
        throw new Error(`official dungeon entrance ${world.name}.${poi.name} is incomplete`);
      }
      const definition = loadDungeonData(
        options.resources,
        poi.zoneChange.dungeon,
        poi.zoneChange.dungeonFile,
        poi.zoneChange.dungeonLevel ?? 1,
        knownMonsters,
      );
      dungeonIds.add(`${definition.typeName}:${definition.sourceFile}:${definition.instanceName}`);
    }
  }
  for (const quest of options.quests.definitions) {
    requireId(quest.name, "quest name");
    if (quest.source !== undefined) requireId(quest.source, "quest source");
    if (quest.questKey !== undefined) requireId(quest.questKey, "quest key");
    const treasure = parseDungeonTreasureData(
      quest.treasureData,
      `Quests.plist.${quest.name}.treasureData`,
      1,
    );
    for (const item of treasure.items) {
      if (item.kind !== "fixed") continue;
      if (
        (item.data.kind === "spiritTotem" || item.data.kind === "monsterJoin") &&
        !knownMonsters.has(item.data.shortType)
      ) {
        throw new Error(`quest ${quest.name} reward references unknown monster ${item.data.shortType}`);
      }
      if (item.data.kind === "recipe") options.data.combineRecipe(item.data.combineName);
    }
  }
  const tutorialFlags = new Set<string>([
    "Tutorial0",
    "Tutorial1",
    "Tutorial2",
    "flashTownExit",
    "FirstMonsterpedia",
    "FirstAllMonsterpedia",
    "TownWarpTutorial",
    "TournamentTutorial",





    ...Array.from({ length: 6 }, (_unused, index) => `NotYourTurn${index + 1}`),
  ]);
  const hasTownWarp = worlds.some((world) => world.pointsOfInterest.some((poi) =>
    poi.town?.buildings.some(({ className }) => className === "TownWarpMenuItem") === true));
  let townWarpSupported = false;
  if (hasTownWarp && options.resources !== undefined) {
    const destinations = loadTownPortalDestinations(options.resources);
    const installedTowns = new Set(worlds.flatMap((world) =>
      world.pointsOfInterest.filter(({ town }) => town !== undefined).map(({ name }) => name)));
    townWarpSupported = destinations.length > 0 &&
      destinations.every(({ townName }) => installedTowns.has(townName));
  }
  if (options.resources !== undefined) {
    const tutorial4 = loadSourceTutorialTopics(options.resources)
      .find(({ key }) => key === "Tutorial4");
    if (
      tutorial4 !== undefined &&
      tutorial4.images.every((image) => options.resources!.has(image))
    ) {
      tutorialFlags.add(tutorial4.key);
    }
  }


  tutorialFlags.add("RevistPOI");
  for (const world of worlds) for (const poi of world.pointsOfInterest) {
    for (const building of poi.town?.buildings ?? []) {
      if (building.tutorialFlashKey !== undefined) {
        requireId(building.tutorialFlashKey, "tutorial flag");
        tutorialFlags.add(building.tutorialFlashKey);
      }
      // First-use popups the town services claim through `showTutorialForFlag:` before showing:
      // Store's `FirstShop` and the Hero house's gem display `FirstCharacterDisplay`.
      if (building.className === "StoreMenuItem") tutorialFlags.add("FirstShop");
      if (building.className === "CharacterDisplayMenuItem") {
        tutorialFlags.add("FirstCharacterDisplay");
      }
    }
  }
  if (dungeonIds.size > 0) {


    tutorialFlags.add("WaypointReached");
    tutorialFlags.add("NewInfiniteMonsterSlot");
  }
  const report: OfficialGameSupportReport = Object.freeze({
    worldId: options.world.name,
    worldIds: Object.freeze(worlds.map(({ name }) => name).sort()),
    dungeonIds: Object.freeze([...dungeonIds].sort()),
    startTownId: options.startTownId,
    commandTypes: Object.freeze(OFFICIAL_GAME_COMMAND_TYPES.filter((type) =>
      (dungeonIds.size > 0 || !type.startsWith("dungeon.")) &&
      (townWarpSupported || type !== "world.usePortal") &&
      (options.data.allTournaments().length > 0 || !type.startsWith("tournament.")))),
    tutorialFlags: Object.freeze([...tutorialFlags].sort()),
    questIds: Object.freeze(options.quests.definitions.map(({ name }) => name)),
  });
  validatedSupportReports.set(report, {
    data: options.data,
    world: options.world,
    worlds,
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    quests: options.quests,
  });
  return report;
}

export function createOfficialLogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameSupportReport,
): LogicPackDescriptorV1 {
  requireValidatedSupport(support);
  return {
    logicPackId,
    simulationVersion: OFFICIAL_GAME_V11_SIMULATION_VERSION,
    trustTier: "official",
    capabilities: {
      slot: true,
      world: true,
      battle: true,
      capture: true,
      spirit: true,
      party: true,
      economy: true,
      dungeon: support.dungeonIds.length > 0,
      quests: true,
      plot: false,
      tournaments: support.commandTypes.includes("tournament.startBattle"),
      commandTypes: [...support.commandTypes],
    },
  };
}

/** Strict parser for the immutable historical Official v11 aggregate. */
export function parseOfficialGameStateV11(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    !Object.prototype.hasOwnProperty.call(value, "nextBattleSequence") ||
    !isPositiveSequence((value as { nextBattleSequence?: unknown }).nextBattleSequence)
  ) {
    throw new Error("official v11 game state requires a valid nextBattleSequence");
  }
  return parseOfficialGameStateV1(data, quests, value, context);
}

/** Strict parser for an immutable historical v11 projection, including its one-bit Egg marker. */
export function parseOfficialGameProjectionV11(value: unknown): SlotProjectionV1 {
  const projection = SlotProjectionV1Schema.parse(value);
  if (projection.simulationVersion !== OFFICIAL_GAME_V11_SIMULATION_VERSION) {
    throw new GameServiceError(
      "SIMULATION_VERSION_UNAVAILABLE",
      "official v11 projection cannot be read by the v11 migration parser",
    );
  }
  return structuredClone(projection);
}

export function parseOfficialGameStateV1(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV1 {
  return parseOfficialGameStateV1WithDefeatBehavior(data, quests, value, context, false);
}

function parseOfficialGameStateV1WithDefeatBehavior(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext,
  terminalDefeatDungeonConsequencesDeferred: boolean,
): OfficialGameStateV1 {
  validateOfficialEnvelope(value);
  const state = value as Partial<OfficialGameStateV1>;
  if (
    state.schemaVersion !== 1 ||
    state.profile === undefined ||
    state.party === undefined ||
    state.quests === undefined ||
    state.location === undefined ||
    !isPositiveSequence(state.nextMonsterSequence)
  ) {
    throw new Error("official game state has invalid envelope fields");
  }
  let location = parseLocation(state.location);
  const party = WorldTripParty.fromStateSnapshot(data, state.party);
  const profile = PlayerProfile.fromStateSnapshot(
    state.profile,
    party.monsters().map((monster) => monster.level),
    party,
    profileRestoreOptions(data, state.profile),
  );



  party.setPlayerBuffSource(() => profile.battleStatBonuses());
  party.setBattingOrderSize(battingOrderSizeFor(
    data.license(profile.licenseType).battingOrderSize,
    profile.heroLevel,
    { infiniteDungeonHighestLevel: profile.infiniteDungeonHighestLevel },
  ));
  const questRuntime = new GuildQuestRuntime(quests, state.quests);
  const nextBattleSequence = state.nextBattleSequence ?? 1;
  if (!isPositiveSequence(nextBattleSequence)) {
    throw new Error("official game state has invalid nextBattleSequence");
  }
  if ((location.kind === "battle") !== (state.battle !== undefined)) {
    throw new Error("official battle location and private battle state disagree");
  }
  const requiresDungeon =
    location.kind === "dungeon" ||
    (location.kind === "battle" && state.battle?.origin.kind === "dungeon");
  if (state.dungeon !== undefined && context.dungeonResources === undefined) {
    throw new Error("authoritative dungeon resources are unavailable for this state");
  }
  if (requiresDungeon && state.dungeon === undefined) {
    throw new Error("official dungeon location is missing its private dungeon state");
  }
  if (location.kind === "town" && state.dungeon !== undefined) {
    throw new Error("official town location retained a purged dungeon cache");
  }
  let canonicalDungeonRun: DungeonRunSnapshot | undefined;
  let restoredDungeon: DungeonRuntimeController | undefined;
  if (state.dungeon !== undefined) {
    if (state.dungeon.schemaVersion !== 1) throw new Error("unsupported official dungeon schema");
    requireId(state.dungeon.worldId, "dungeon.worldId");
    requireId(state.dungeon.entrancePoiId, "dungeon.entrancePoiId");
    const run = parseDungeonRunSnapshot(state.dungeon.run);
    const legacyTopology = dungeonRunUsesLegacyTopology(run);
    canonicalDungeonRun = run;
    if (legacyTopology && location.kind === "battle" && state.battle?.origin.kind === "dungeon") {
      throw new Error(
        "official dungeon battle cannot be correlated from legacy synthetic room geometry",
      );
    }
    // v5 and earlier kept durable UserSavedData waypoint keys only inside the active cache.
    // Promote every still-recoverable cached route before canonicalizing the profile.
    const cachedByRoute = new Map(run.cachedFloors.map((entry) => [
      `${entry.route.typeName}:${entry.route.sourceFile}:${entry.route.floor}`,
      entry,
    ]));
    for (const waypoint of run.registeredWaypoints) {
      const cached = cachedByRoute.get(
        `${waypoint.route.typeName}:${waypoint.route.sourceFile}:${waypoint.route.floor}`,
      );
      if (cached === undefined) continue;
      const separator = cached.session.definitionId.lastIndexOf(":");
      if (separator < 0 || separator === cached.session.definitionId.length - 1) {
        throw new Error(`invalid dungeon definition id ${cached.session.definitionId}`);
      }
      profile.registerDungeonWaypoint(
        cached.session.definitionId.slice(separator + 1),
        waypoint.route.floor,
      );
    }
    if (location.kind === "dungeon") {
      if (location.floor !== run.current.session.floor) {
        throw new Error("official dungeon envelope floor does not match its run");
      }
      if (
        location.dungeonId !== run.current.session.definitionId ||
        location.roomId !== run.current.session.currentRoomId
      ) {
        throw new Error("official dungeon envelope does not match its location");
      }
    }
    restoredDungeon = DungeonRuntimeController.restore({
      resources: context.dungeonResources!,
      monsterTypes: data.allMonsters().map(({ shortType }) => shortType),
      // Every schema parsed here belongs to immutable official-game-v1..v21.
      legacyDungeonGenerationSemantics: true,
      isCompletionSet: (key: string) => questRuntime.hasCompletedFixedEncounter(key),
      isQuestUsable: (key: string) => questRuntime.canUseQuestKey(key),
      isMonsterRegistered: (shortType: string) => profile.highestRegisteredLevel(shortType) > 0,
      isCatchQuestDone: (instanceName: string) => profile.hasCompletedCatchQuest(instanceName),
    }, run);
    if (legacyTopology) {
      canonicalDungeonRun = restoredDungeon.snapshot();
      if (location.kind === "dungeon") {
        const canonicalFloor = canonicalDungeonRun.current.session;
        location = {
          ...location,
          dungeonId: canonicalFloor.definitionId,
          floor: canonicalFloor.floor,
          roomId: canonicalFloor.currentRoomId,
        };
      }
    }
  }
  if (state.world !== undefined) validateWorldEnvelope(state.world);
  if (
    state.pendingEgg !== undefined &&
    (
      state.pendingEgg.schemaVersion !== 1 ||
      (state.pendingEgg.kind !== "silver" && state.pendingEgg.kind !== "gold")
    )
  ) {
    throw new Error("official pending Egg is invalid");
  }
  if (location.kind !== "town" && state.world === undefined) {
    throw new Error("official world/battle location is missing world state");
  }
  if (
    context.terminalDefeatBattleId !== undefined &&
    (
      location.kind !== "battle" ||
      state.battle === undefined ||
      location.battleId !== context.terminalDefeatBattleId ||
      state.battle.battleId !== context.terminalDefeatBattleId
    )
  ) {
    throw new Error("pending terminal defeat is not bound to its battle location");
  }
  if (state.battle !== undefined && location.kind === "battle") {
    const restoredBattle = validateBattleEnvelope(data, state.battle);
    if (state.battle.battleId !== location.battleId) {
      throw new Error("official battle envelope does not match its location");
    }
    if (context.terminalDefeatBattleId !== undefined) {
      requireId(context.terminalDefeatBattleId, "terminal defeat battleId");
      if (state.battle.battleId !== context.terminalDefeatBattleId) {
        throw new Error("pending terminal defeat does not own the retained battle");
      }
      if (restoredBattle.step.type !== "ended" || restoredBattle.step.report.winner !== 1) {
        throw new Error("pending terminal defeat requires an ended loss battle");
      }
    }
    if (state.battle.origin.kind === "world" && (
      state.battle.origin.worldId !== location.worldId ||
      state.battle.origin.poiId !== location.poiId
    )) {
      throw new Error("official world battle envelope does not match its location");
    }
    if (state.battle.origin.kind === "arena" && (
      state.battle.origin.worldId !== location.worldId ||
      state.battle.origin.townId !== location.poiId
    )) {
      throw new Error("official Arena battle envelope does not match its location");
    }
    if (state.battle.origin.kind === "tournament" && (
      state.battle.origin.worldId !== location.worldId ||
      state.battle.origin.townId !== location.poiId
    )) {
      throw new Error("official Tournament battle envelope does not match its location");
    }
    const playerIds = new Set(party.monsters().map((monster) => monster.instanceId));
    for (const member of state.battle.replay.teams[0]) {
      if (member.sourceInstanceId !== undefined && !playerIds.has(member.sourceInstanceId)) {
        throw new Error(`official battle references missing player ${member.sourceInstanceId}`);
      }
    }
    if (state.battle.origin.kind === "dungeon") {
      if (restoredDungeon === undefined) {
        throw new Error("official dungeon battle is missing its restored dungeon run");
      }
      if (
        state.dungeon === undefined ||
        state.dungeon.worldId !== location.worldId ||
        state.dungeon.entrancePoiId !== location.poiId
      ) {
        throw new Error("official dungeon battle origin does not match its dungeon envelope");
      }
      if (context.terminalDefeatBattleId !== undefined) {
        if (terminalDefeatDungeonConsequencesDeferred) {
          validateDeferredTerminalDefeatDungeonBattleAgainstRun(
            restoredDungeon,
            state.battle,
            restoredBattle,
          );
        } else {
          validateTerminalDefeatDungeonBattleAgainstRun(
            restoredDungeon,
            state.battle,
            restoredBattle,
          );
        }
      } else {
        validateDungeonBattleAgainstRun(
          party,
          restoredDungeon,
          state.battle,
        );
      }
    }
  }
  return {
    schemaVersion: 1,
    profile: profile.stateSnapshot(),
    party: party.stateSnapshot(),
    quests: questRuntime.stateSnapshot(),
    location,
    ...(state.world === undefined ? {} : { world: structuredClone(state.world) }),
    ...(state.battle === undefined ? {} : { battle: structuredClone(state.battle) }),
    ...(state.dungeon === undefined
      ? {}
      : { dungeon: { ...structuredClone(state.dungeon), run: structuredClone(canonicalDungeonRun!) } }),
    ...(state.pendingEgg === undefined ? {} : { pendingEgg: structuredClone(state.pendingEgg) }),
    nextMonsterSequence: state.nextMonsterSequence!,
    nextBattleSequence,
  };
}

/** Construct a v12 descriptor only from the proof-bound future support seam. */
export function createOfficialGameV12LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const binding = validatedV12SupportReports.get(support);
  if (binding === undefined ||
      !validatedEggSupportProofs.has(binding.eggSupport) ||
      binding.eggSupport !== support.eggSupport ||
      (support.collectionCatalog !== undefined &&
        (binding.collectionCatalog !== support.collectionCatalog ||
          validatedCollectionCatalogBindings.get(support.collectionCatalog)?.support !== binding.support))) {
    throw new Error("v12 support report was not produced by createOfficialGameV12Support");
  }
  const descriptor = CurrentLogicPackDescriptorV1Schema.parse({
    logicPackId,
    simulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
    trustTier: "official",
    capabilities: {
      slot: true,
      world: true,
      battle: true,
      capture: true,
      spirit: true,
      party: true,
      economy: true,
      dungeon: support.dungeonIds.length > 0,
      quests: true,
      plot: false,
      tournaments: support.commandTypes.includes("tournament.startBattle"),
      commandTypes: [...support.commandTypes],
    },
  });
  const descriptorFingerprint = canonicalJsonValue(descriptor);
  const prior = validatedV12DescriptorBindings.get(descriptor.logicPackId);
  if (prior !== undefined &&
      (prior.proof !== support.eggSupport ||
       prior.supportFingerprint !== support.eggSupport.supportFingerprint ||
       prior.collectionCatalog !== support.collectionCatalog)) {
    throw new Error("logic pack ID is already bound to a different loaded Egg proof");
  }
  validatedV12DescriptorBindings.set(descriptor.logicPackId, {
    support,
    proof: support.eggSupport,
    supportFingerprint: support.eggSupport.supportFingerprint,
    descriptorFingerprint,
    commandTypes: Object.freeze([...support.commandTypes]),
    ...(support.collectionCatalog === undefined ? {} : { collectionCatalog: support.collectionCatalog }),
  });
  const provenance = Object.freeze({
    support,
    proof: support.eggSupport,
    descriptorFingerprint,
    token: Object.freeze({}),
    ...(support.collectionCatalog === undefined ? {} : { collectionCatalog: support.collectionCatalog }),
  }) satisfies OfficialV12DescriptorProvenance;
  validatedV12DescriptorTokens.add(provenance.token);
  validatedV12DescriptorProvenances.add(provenance);
  Object.defineProperty(descriptor, officialV12DescriptorProvenance, {
    value: provenance,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(descriptor);
}

/**
 * Parse the additive v12 aggregate. The v11 parser is deliberately used only for the core
 * domains after the v12-only siblings have been removed from its strict envelope.
 */
export function parseOfficialGameStateV12(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV12 {
  return parseOfficialGameStateV12WithDefeatBehavior(data, quests, value, context, false);
}

/** V14+ leaves dungeon loss consequences untouched until the recovery choice. V12/V13 instead
 * synchronize survivors before persisting the same additive continuation envelope, so the
 * simulation wrapper must select the matching invariant even though the JSON schema is shared. */
function parseOfficialGameStateV12WithDefeatBehavior(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext,
  terminalDefeatDungeonConsequencesDeferred: boolean,
): OfficialGameStateV12 {
  validateOfficialGameV12Envelope(value);
  const input = value as Record<string, unknown>;
  const collectionClaims = parseOfficialCollectionClaims(input.collectionClaims);
  const pendingEgg = input.pendingEgg === undefined
    ? undefined
    : OfficialEggContinuationV1Schema.parse(input.pendingEgg) as OfficialEggContinuation;
  const pendingDefeat = input.pendingDefeat === undefined
    ? undefined
    : OfficialDefeatDecisionV1Schema.parse(input.pendingDefeat) as OfficialDefeatDecision;
  validateOfficialGameV12ContinuationFields({
    ...(pendingEgg === undefined ? {} : { pendingEgg }),
    ...(pendingDefeat === undefined ? {} : { pendingDefeat }),
  });

  const {
    collectionClaims: _collectionClaims,
    pendingEgg: _pendingEgg,
    pendingDefeat: _pendingDefeat,
    nextContinuationSequence: _nextContinuationSequence,
    ...v11Core
  } = input;
  const parsedCore = parseOfficialGameStateV1WithDefeatBehavior(
    data,
    quests,
    v11Core,
    {
      ...context,
      ...(pendingDefeat === undefined ? {} : { terminalDefeatBattleId: pendingDefeat.battleId }),
    },
    terminalDefeatDungeonConsequencesDeferred,
  );
  const { pendingEgg: legacyPendingEgg, ...core } = parsedCore;
  if (legacyPendingEgg !== undefined) {
    throw new Error("official v12 state cannot contain a historical one-bit Egg marker");
  }
  return {
    ...core,
    ...(pendingEgg === undefined ? {} : { pendingEgg: structuredClone(pendingEgg) }),
    ...(pendingDefeat === undefined ? {} : { pendingDefeat: structuredClone(pendingDefeat) }),
    collectionClaims: structuredClone(collectionClaims),
    nextContinuationSequence: input.nextContinuationSequence as number,
  };
}

/**
 * Pure, detached upgrade of an eligible v11 aggregate. The empty claims sibling and continuation
 * sequence are synthesized here and nowhere in either strict version parser.
 */
export function migrateOfficialGameV11ToV12(
  input: OfficialGameV11MigrationInput,
): OfficialGameStateV12 {
  const sourceState = parseOfficialGameStateV11(
    input.data,
    input.quests,
    input.state,
    input.context,
  );
  const sourceProjection = parseOfficialGameProjectionV11(input.projection);
  if (sourceState.pendingEgg !== undefined || sourceProjection.pendingEgg !== undefined) {
    throw new GameServiceError(
      "SIMULATION_VERSION_UNAVAILABLE",
      "an official v11 slot with a legacy one-bit Egg cannot be migrated to v12",
    );
  }
  const { pendingEgg: _legacyPendingEgg, ...sourceCore } = sourceState;
  const migrated = {
    ...sourceCore,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] },
    nextContinuationSequence: 1,
  } satisfies OfficialGameStateV12;
  return parseOfficialGameStateV12(input.data, input.quests, migrated, input.context);
}

/** Restore a distinct v12 snapshot graph; no nested input graph is retained by the aggregate. */
export function cloneOfficialGameStateV12(
  data: GameData,
  quests: QuestCatalog,
  value: OfficialGameStateV12,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV12 {
  return parseOfficialGameStateV12(data, quests, structuredClone(value), context);
}

/** Immutable restored v12 aggregate facade backed by the shared CollectionClaims domain value. */
export class OfficialGameV12Aggregate {
  private constructor(
    private readonly data: GameData,
    private readonly quests: QuestCatalog,
    private readonly context: OfficialGameStateParseContext,
    private readonly current: OfficialGameStateV12,
    private readonly claims: CollectionClaims,
  ) {}

  static restore(
    data: GameData,
    quests: QuestCatalog,
    value: unknown,
    context: OfficialGameStateParseContext = {},
  ): OfficialGameV12Aggregate {
    const current = parseOfficialGameStateV12(data, quests, value, context);
    const claims = new CollectionClaims(current.collectionClaims.claimedGoalIds);
    return new OfficialGameV12Aggregate(data, quests, context, current, claims);
  }

  get state(): OfficialGameStateV12 {
    return this.snapshot();
  }

  snapshot(): OfficialGameStateV12 {
    return structuredClone({
      ...this.current,
      collectionClaims: {
        schemaVersion: 1 as const,
        claimedGoalIds: [...this.claims.snapshot()],
      },
    });
  }

  clone(): OfficialGameV12Aggregate {
    return OfficialGameV12Aggregate.restore(
      this.data,
      this.quests,
      this.snapshot(),
      this.context,
    );
  }

  hasCollectionClaim(goalId: string): boolean {
    return this.claims.has(goalId);
  }

  collectionClaimsSnapshot(): readonly string[] {
    return this.claims.snapshot();
  }

  project(reducer: OfficialGameReducer): OfficialGameProjectionBodyV12 {
    return projectOfficialGameStateV12(reducer, this.current);
  }

  admit(command: GameCommandV1 | CurrentGameCommandV1): void {
    assertOfficialGameV12CommandAdmitted(this.current, command);
  }
}

/**
 * Atomically allocate both continuation identities and return the replacement aggregate state.
 * This is deliberately an aggregate transition rather than a fake player command; Tasks 4–5 can
 * compose it with an origin settlement while retaining one durable sequence increment.
 */
export function allocateOfficialContinuationIdentity(
  state: OfficialGameStateV12,
): OfficialContinuationAllocationTransition {
  validateOfficialGameV12Envelope(state);
  const sequence = state.nextContinuationSequence;
  if (!isPositiveSequence(sequence)) {
    throw new Error("official v12 continuation sequence is invalid");
  }
  if (sequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("official v12 continuation sequence is exhausted before safe increment");
  }
  const allocation = {
    continuationId: `continuation-${sequence}`,
    decisionId: `decision-${sequence}`,
    nextContinuationSequence: sequence + 1,
  } satisfies OfficialContinuationIdentityAllocation;
  return {
    allocation,
    state: structuredClone({ ...state, nextContinuationSequence: allocation.nextContinuationSequence }),
  };
}






export function splitPendingEggReward(
  rewards: readonly PlayerReward[],
  origin: OfficialEggOrigin,
  remainingRepeats: 0 | 1,
  context: OfficialReduceContext,
): OfficialEggRewardSplit {
  validateOfficialEggRewardBatchShape(rewards);
  const eggRewards = rewards.filter(
    (reward) => reward.kind === "egg" || reward.kind === "monsterEgg",
  );
  if (eggRewards.length > 1) {
    throw new GameServiceError(
      "STATE_CORRUPT",
      "official reward batch contains multiple Eggs",
    );
  }
  const immediate = Object.freeze(rewards.filter(
    (reward) => reward.kind !== "egg" && reward.kind !== "monsterEgg",
  )) as readonly PlayerReward[];
  const egg = eggRewards[0];
  if (egg === undefined) return { immediate };
  const allocation = context.allocateContinuation();
  const pendingEgg = createOfficialEgg({
    kind: egg.kind === "egg" ? "silver" : "gold",
    origin,
    remainingRepeats,
    continuationId: allocation.continuationId,
    decisionId: allocation.decisionId,
  });
  return { immediate, pendingEgg };
}

type OfficialPlayerReward = Exclude<
  PlayerReward,
  { readonly kind: "repeatEgg" | "usable" }
>;

function validateOfficialEggRewardBatchShape(
  rewards: readonly PlayerReward[],
): asserts rewards is readonly OfficialPlayerReward[] {
  const supportedKinds = new Set([
    "silver", "gold", "gem", "spiritTotem", "recipe", "egg", "monsterEgg", "monsterJoin",
  ]);
  for (const reward of rewards) {
    if (
      reward === null ||
      typeof reward !== "object" ||
      !supportedKinds.has((reward as { readonly kind?: unknown }).kind as string)
    ) {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        "official reward batch contains an unsupported Egg/provider shape",
      );
    }
  }
  const eggCount = rewards.filter(
    (reward) => reward.kind === "egg" || reward.kind === "monsterEgg",
  ).length;
  if (eggCount > 1) {
    throw new GameServiceError(
      "STATE_CORRUPT",
      "official reward batch contains multiple Eggs",
    );
  }
}

function validateStorePurchaseAffordability(
  profile: PlayerProfile,
  stock: StoreStock,
  quantity: number,
): void {
  const total = stock.unitPrice * quantity;
  if (!Number.isSafeInteger(total)) {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "Store: purchase total is not a safe integer");
  }
  if (profile.snapshot()[stock.currency] < total) {
    throw new GameServiceError("INSUFFICIENT_FUNDS", `Store: insufficient ${stock.currency}`);
  }
}

/**
 * Project a v12 state through the existing pure v11 world/battle projection and then replace its
 * decision with the highest-priority continuation decision. This helper has no network or clock
 * dependency; the legacy reducer only restores local authoritative data.
 */
export function projectOfficialGameStateV12(
  reducer: OfficialGameReducer,
  state: OfficialGameStateV12,
  sourceDungeonPopulationInheritance = false,
  terminalDefeatDungeonConsequencesDeferred = false,
): OfficialGameProjectionBodyV12 {
  validateOfficialGameV12Envelope(state);
  validateOfficialGameV12ContinuationFields(state);
  const base = state.pendingDefeat === undefined
    ? reducer.projectPersistedState(
        toOfficialGameStateV11(state),
        sourceDungeonPopulationInheritance,
      )
    : reducer.projectPersistedContinuationState(
        toOfficialGameStateV11(state),
        state.pendingDefeat.battleId,
        sourceDungeonPopulationInheritance,
        terminalDefeatDungeonConsequencesDeferred,
      );
  return parseOfficialGameProjectionV12(projectV12ContinuationBody(base, state));
}

function parseOfficialGameProjectionV12Body(
  value: unknown,
): OfficialGameProjectionBodyV12 {
  assertJsonSafeTree(value, "official v12 projection");
  assertPlainObject(value, "official v12 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v12 projection body contains envelope field ${key}`);
    }
  }
  const input = value as Record<string, unknown>;
  const parsed = OfficialGameProjectionV12WireSchema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
    trustTier: "official",
    ...input,
  });
  return structuredClone(projectionBody(parsed));
}

/** Strictly validate a v12 body-shaped projection and return a detached copy. */
export function parseOfficialGameProjectionV12(
  value: unknown,
): OfficialGameProjectionBodyV12 {
  return parseOfficialGameProjectionV12Body(value);
}

/**
 * The single admission gate for the continuation aggregate. It is intentionally independent of
 * reducer implementation so a getter or projection cannot accidentally perform admission work.
 */
export function assertOfficialGameV12CommandAdmitted(
  state: Pick<OfficialGameStateV12, "pendingEgg" | "pendingDefeat">,
  command: GameCommandV1 | CurrentGameCommandV1,
): void {
  const currentCommand = CurrentGameCommandV1Schema.parse(command);
  validateOfficialGameV12ContinuationFields(state);
  if (state.pendingEgg !== undefined) {
    const allowed = state.pendingEgg.phase === "awaiting-spin"
      ? currentCommand.type === "egg.start"
      : state.pendingEgg.phase === "spinning"
        ? currentCommand.type === "egg.release"
        : state.pendingEgg.phase === "awaiting-prize-resolution"
          ? currentCommand.type === "egg.resolvePrize"
          : currentCommand.type === "egg.finish" || (
              currentCommand.type === "egg.repeat" && state.pendingEgg.remainingRepeats === 1
            );
    if (!allowed) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        `pending Egg phase ${state.pendingEgg.phase} requires its phase-valid egg command`,
      );
    }
    return;
  }
  if (state.pendingDefeat !== undefined) {
    if (currentCommand.type !== "battle.resolveDefeat") {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        "pending defeat requires battle.resolveDefeat",
      );
    }
    if (currentCommand.battleId !== state.pendingDefeat.battleId) {
      throw new GameServiceError(
        "ENTITY_NOT_FOUND",
        `battle ${currentCommand.battleId} is not the pending defeat battle`,
      );
    }
    if (currentCommand.recovery === "saveMe" && !state.pendingDefeat.canSaveMe) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        "pending defeat does not allow Save Me recovery",
      );
    }
  }
}

export function migrateOfficialGameV3State(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV1 {
  validateOfficialEnvelope(value, { allowLegacyBattleWorldOrigin: true });
  const migrated = structuredClone(value) as {
    battle?: { origin?: { kind?: string; worldId?: string; poiId?: string } };
    world?: { lastTownId?: unknown; visitedTownIds?: readonly string[] };
  };
  const origin = migrated.battle?.origin;
  if (
    origin !== undefined &&
    origin.kind === undefined &&
    typeof origin.worldId === "string" &&
    typeof origin.poiId === "string"
  ) {
    origin.kind = "world";
  }
  if (
    migrated.world !== undefined &&
    migrated.world.visitedTownIds === undefined &&
    typeof migrated.world.lastTownId === "string"
  ) {
    migrated.world.visitedTownIds = [migrated.world.lastTownId];
  }
  return parseOfficialGameStateV1(data, quests, migrated, context);
}

/**
 * Complete authoritative reducer for the supported official vertical slice. Every random/value
 * decision is committed here; the browser receives a committed draw prefix solely to reuse the
 * existing source-timed presentation engine.
 */
export class OfficialGameReducer implements GameCommandReducer<OfficialGameStateV1> {
  private readonly random: () => number;
  /** Source event 5 notifications raised during the command currently being reduced. */
  private pendingSpiritQuestEvents: UnsequencedPresentationEventV1[] = [];
  /** Synchronous reduction-local version behavior, also used by projection restore. */
  private sourceDungeonPopulationInheritanceForCurrentReduction = false;
  /** Synchronous reduction-local v25 source story rules (see `sourceStoryRules`). */
  private sourceStoryRulesForCurrentReduction = false;
  /** Synchronous, try/finally-scoped v27 construction/legacy-capture compatibility rule. */
  private sourceJobLevelsForCurrentReduction = false;
  /** Parsed `Chats.plist` definitions; the catalog is immutable installed data. */
  private readonly encounterChatDefinitions = new Map<string, ChatDefinition>();

  constructor(private readonly options: OfficialGameReducerOptions) {
    requireValidatedSupport(options.support);
    if (typeof options.random !== "function") {
      throw new Error("official reducer requires an explicit server-controlled random source");
    }
    if (
      validatedSupportReports.get(options.support)?.data !== options.data ||
      validatedSupportReports.get(options.support)?.world !== options.world ||
      validatedSupportReports.get(options.support)?.quests !== options.quests ||
      validatedSupportReports.get(options.support)?.resources !== options.resources ||
      options.support.worldId !== options.world.name ||
      !sameWorldInstallation(
        validatedSupportReports.get(options.support)!.worlds,
        normalizedWorlds(options.world, options.worlds),
      ) ||
      options.support.startTownId !== options.startTownId
    ) {
      throw new Error("authoritative support report does not match the installed world");
    }
    this.random = options.random;
  }

  /** Internal v12 bridge: restore the same detached v11 domain graph without exposing live state. */
  restoreForContinuation(
    state: OfficialGameStateV1,
    terminalDefeatBattleId?: string,
    terminalDefeatDungeonConsequencesDeferred = false,
  ): ReturnType<OfficialGameReducer["restore"]> {
    return this.restore(
      state,
      terminalDefeatBattleId,
      terminalDefeatDungeonConsequencesDeferred,
    );
  }

  /** Internal v12 bridge for source projection after a continuation-only transition. */
  projectForContinuation(
    state: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
  ): ProjectionBodyV1 {
    return this.project(state, party, profile, quests);
  }

  /** Internal v12 bridge for source snapshot construction after a continuation-only transition. */
  snapshotForContinuation(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    location: OfficialLocationV1,
    world: OfficialWorldStateV1 | undefined,
    battle: OfficialBattleStateV1 | undefined,
    dungeon?: OfficialDungeonStateV1 | null,
  ): OfficialGameStateV1 {
    return this.snapshot(prior, party, profile, quests, location, world, battle, dungeon);
  }

  gameDataForContinuation(): GameData {
    return this.options.data;
  }

  supportForContinuation(): OfficialGameSupportReport {
    return this.options.support;
  }

  randomForContinuation(): () => number {
    return this.random;
  }

  /** Validate both halves of a persisted Official record against this exact installed authority. */
  validatePersistedRecord(record: AuthoritativeRecordValidationInput<OfficialGameStateV1>): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official persisted projection disagrees with its restored state");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official persisted record cannot be validated",
      );
    }
  }

  /** Produce the canonical projection for a migrated or restored aggregate. */
  projectPersistedState(
    state: OfficialGameStateV1,
    sourceDungeonPopulationInheritance = false,
  ): OfficialGameProjectionBodyV1 {
    const restored = this.restore(state);
    return this.project(
      restored.state,
      restored.party,
      restored.profile,
      restored.quests,
      undefined,
      sourceDungeonPopulationInheritance,
    );
  }

  /** Internal v12 bridge for projecting a committed terminal defeat before its recovery choice. */
  projectPersistedContinuationState(
    state: OfficialGameStateV1,
    terminalDefeatBattleId?: string,
    sourceDungeonPopulationInheritance = false,
    terminalDefeatDungeonConsequencesDeferred = false,
  ): OfficialGameProjectionBodyV1 {
    const restored = this.restore(
      state,
      terminalDefeatBattleId,
      terminalDefeatDungeonConsequencesDeferred,
    );
    return this.project(
      restored.state,
      restored.party,
      restored.profile,
      restored.quests,
      undefined,
      sourceDungeonPopulationInheritance,
    );
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV1>,
    command: GameCommandV1,
  ): OfficialInternalReductionResult {
    // Source event 5 is raised from deep inside spirit-XP mutation, below the reducer that owns the
    // command's presentation list. Quest progress is applied at the moment of the award; these are
    // only its `quest.progressed`/`quest.completed` notifications, appended once the reducer has
    // produced its own events.
    this.pendingSpiritQuestEvents = [];
    const previousPopulationBehavior =
      this.sourceDungeonPopulationInheritanceForCurrentReduction;
    this.sourceDungeonPopulationInheritanceForCurrentReduction =
      (context as CommandReducerContext<OfficialGameStateV1> & OfficialInternalReductionContext)
        .sourceDungeonPopulationInheritance === true;
    const previousJobRules = this.sourceJobLevelsForCurrentReduction;
    this.sourceJobLevelsForCurrentReduction =
      (context as CommandReducerContext<OfficialGameStateV1> & OfficialInternalReductionContext)[sourceJobLevelRules] === true;
    const previousStoryRules = this.sourceStoryRulesForCurrentReduction;
    this.sourceStoryRulesForCurrentReduction =
      (context as CommandReducerContext<OfficialGameStateV1> & OfficialInternalReductionContext)
        .sourceStoryRules === true;
    try {
      const result = this.applyRestored(context, command);
      const spiritEvents = this.pendingSpiritQuestEvents;
      if (spiritEvents.length === 0) return result;
      return { ...result, events: [...(result.events ?? []), ...spiritEvents] };
    } finally {
      this.pendingSpiritQuestEvents = [];
      this.sourceDungeonPopulationInheritanceForCurrentReduction = previousPopulationBehavior;
      this.sourceStoryRulesForCurrentReduction = previousStoryRules;
      this.sourceJobLevelsForCurrentReduction = previousJobRules;
    }
  }






  private recordEncounterChat(quests: GuildQuestRuntime, chatKey: string | undefined): void {
    if (!this.sourceStoryRulesForCurrentReduction || chatKey === undefined) return;
    let chat = this.encounterChatDefinitions.get(chatKey);
    if (chat === undefined) {
      if (this.options.resources === undefined) {
        throw new GameServiceError(
          "CAPABILITY_UNSUPPORTED",
          `encounter chat ${chatKey} requires the installed Chats.plist`,
        );
      }
      chat = loadChatDefinition(this.options.resources, chatKey);
      this.encounterChatDefinitions.set(chatKey, chat);
    }
    quests.requestChatPresentation(chat.name, chat.alwaysShow);
  }

  /** v25: fire source quest event 0 for each enemy death in a newly committed engine batch. */
  private fireEnemyDeathQuestEvents(
    events: UnsequencedPresentationEventV1[],
    quests: GuildQuestRuntime,
    restored: RestoredBattleReplay,
    engineEvents: readonly BattleEvent[],
  ): void {
    if (!this.sourceStoryRulesForCurrentReduction) return;



    const enemyDead = new Set(restored.session.deadIdsOf(1));
    for (const event of engineEvents) {
      if (event.type !== "died" || !enemyDead.has(event.living)) continue;
      const shortType = restored.session.xpStateOf(event.living).shortType;
      appendGuildQuestEvents(events, quests, () => quests.fireEvent({
        id: 0,
        target: { shortType, inEnemyDeadMembers: true },
      }));
    }
  }

  private applyRestored(
    context: CommandReducerContext<OfficialGameStateV1>,
    command: GameCommandV1,
  ): OfficialInternalReductionResult {
    if (command.type === "slot.create") return this.createSlot(command);
    if (context.state === undefined) {
      throw new GameServiceError("SLOT_NOT_FOUND", "slot must exist before gameplay commands");
    }
    const restored = this.restore(context.state);
    const state = restored.state;
    const eggRewardRouter = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).eggRewardRouter;
    const deferDefeatRecovery = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).deferDefeatRecovery === true;
    const deferDefeatConsequences = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).deferDefeatConsequences === true;
    const deferDungeonTreasureRewards = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).deferDungeonTreasureRewards === true;
    const chargeBattleSpiritEnergy = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).chargeBattleSpiritEnergy === true;
    const sourceDungeonPopulationInheritance = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).sourceDungeonPopulationInheritance === true;
    const sourceTownBattleLifecycle = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).sourceTownBattleLifecycle === true;
    const allowTournamentRetreat = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).allowTournamentRetreat === true;
    const allowArenaEscapeStall = (context as CommandReducerContext<OfficialGameStateV1> &
      OfficialInternalReductionContext).allowArenaEscapeStall === true;
    try {
      if (command.type === "world.leaveTown") {
        return this.leaveTown(
          state, restored.party, restored.profile, restored.quests, context.now,
        );
      }
      if (command.type === "world.navigate" || command.type === "world.selectCurrentPoi") {
        return this.navigateWorld(
          state, restored.party, restored.profile, restored.quests, command, context.now,
          chargeBattleSpiritEnergy,
        );
      }
      if (command.type === "world.useDirectTownReturn") {
        return this.useDirectTownReturn(
          state, restored.party, restored.profile, restored.quests, context.now,
        );
      }
      if (command.type === "world.activateZone") {
        return this.activateWorldZone(
          state, restored.party, restored.profile, restored.quests, command,
          chargeBattleSpiritEnergy,
          sourceDungeonPopulationInheritance,
        );
      }
      if (isDungeonCommand(command)) {
        return this.applyDungeon(
          state, restored.party, restored.profile, restored.quests, command, context.now,
          eggRewardRouter, chargeBattleSpiritEnergy, sourceDungeonPopulationInheritance,
        );
      }
      if (isBattleCommand(command)) {
        return this.applyBattle(
          state, restored.party, restored.profile, restored.quests, command, context.now,
          eggRewardRouter,
          deferDefeatRecovery,
          deferDefeatConsequences,
          deferDungeonTreasureRewards,
          chargeBattleSpiritEnergy,
          sourceDungeonPopulationInheritance,
          sourceTownBattleLifecycle,
          allowTournamentRetreat,
          allowArenaEscapeStall,
        );
      }
      if (isPartyCommand(command)) {
        return this.applyParty(
          state, restored.party, restored.profile, restored.quests, command, context.now,
        );
      }
      if (isQuestCommand(command)) {
        return this.applyQuest(
          state, restored.party, restored.profile, restored.quests, command,
          eggRewardRouter,
        );
      }
      if (command.type === "player.claimDialog") {
        const location = state.location;
        if (location.kind !== "town") {
          throw new GameServiceError(
            "ACTION_NOT_ALLOWED",
            "player.claimDialog requires a town location",
          );
        }
        const poi = this.world(location.worldId).pointsOfInterest.find(
          ({ name }) => name === location.townId,
        )!;
        const chat = firstTownEnterChat(poi, restored.quests);
        if (
          chat?.name !== command.dialogId ||
          !restored.quests.requestChatPresentation(chat.name, chat.alwaysShow)
        ) {
          throw new GameServiceError(
            "ACTION_NOT_ALLOWED",
            `dialog ${command.dialogId} is not the next town story dialog`,
          );
        }
        const nextState = this.snapshot(
          state,
          restored.party,
          restored.profile,
          restored.quests,
          state.location,
          state.world,
          state.battle,
        );
        return {
          state: nextState,
          projection: this.project(
            nextState,
            restored.party,
            restored.profile,
            restored.quests,
          ),
          events: [{ type: "player.dialogClaimed", dialogId: command.dialogId }],
        };
      }
      if (command.type === "player.claimTutorialFlag") {
        if (!this.options.support.tutorialFlags.includes(command.flag)) {
          throw new GameServiceError(
            "ACTION_NOT_ALLOWED",
            `tutorial flag ${command.flag} is not authoritative in this logic pack`,
          );
        }
        if (!restored.profile.claimTutorialFlag(command.flag)) {
          throw new GameServiceError(
            "ACTION_NOT_ALLOWED",
            `tutorial flag ${command.flag} is already claimed`,
          );
        }
        const nextState = this.snapshot(
          state,
          restored.party,
          restored.profile,
          restored.quests,
          state.location,
          state.world,
          state.battle,
        );
        return {
          state: nextState,
          projection: this.project(nextState, restored.party, restored.profile, restored.quests),
          events: [{ type: "player.tutorialFlagClaimed", flag: command.flag }],
        };
      }
      if (command.type === "world.usePortal") {
        return this.useTownPortal(
          state, restored.party, restored.profile, restored.quests, command, context.now,
        );
      }
      if (
        command.type === "player.dropInventoryItem" ||
        command.type === "player.equipGem" ||
        command.type === "player.unequipGem" ||
        command.type === "player.incrementSkill" ||
        command.type === "player.decrementSkill"
      ) {
        if (state.location.kind === "battle") {
          throw new GameServiceError(
            "ACTION_NOT_ALLOWED",
            `${command.type} is unavailable in battle`,
          );
        }
        const characterOnly =
          command.type === "player.equipGem" ||
          command.type === "player.unequipGem" ||
          command.type === "player.incrementSkill" ||
          command.type === "player.decrementSkill";
        if (
          characterOnly &&
          !this.characterManagementAvailable(state.location, restored.quests)
        ) {
          throw new GameServiceError(
            "ACTION_NOT_ALLOWED",
            `${command.type} requires a town character building`,
          );
        }
        switch (command.type) {
          case "player.dropInventoryItem":
            restored.profile.inventory.item(command.itemId);
            restored.profile.inventory.drop(command.itemId);
            break;
          case "player.equipGem":
            restored.profile.equipGem(command.itemId);



            restored.party.fullRestoreAndReapplyPermanentBuffs();
            break;
          case "player.unequipGem":
            // No native call site reapplies here (`dropItem:`/unequip never calls the full
            // restore), so the existing buff children stay until the next application point.
            restored.profile.unequipGem(command.itemId);
            break;
          case "player.incrementSkill":
            if (!restored.profile.incrementSkill(command.stat)) {
              throw new GameServiceError("ACTION_NOT_ALLOWED", "no free skill points");
            }




            restored.party.fullRestoreAndReapplyPermanentBuffs();
            break;
          case "player.decrementSkill":
            if (!restored.profile.decrementSkill(command.stat)) {
              throw new GameServiceError("ACTION_NOT_ALLOWED", "skill is already zero");
            }
            restored.party.fullRestoreAndReapplyPermanentBuffs();
            break;
        }
        const nextState = this.snapshot(
          state,
          restored.party,
          restored.profile,
          restored.quests,
          state.location,
          state.world,
          state.battle,
        );
        return {
          state: nextState,
          projection: this.project(nextState, restored.party, restored.profile, restored.quests),
          events: [],
        };
      }
      if (command.type === "store.purchase") {
        if (!this.storeAvailable(state.location)) {
          throw new GameServiceError(
            "ACTION_NOT_ALLOWED",
            "store purchase requires a town Store building",
          );
        }
        const stock = this.storeStock(command.stockId);
        if (stock.kind === "egg") {
          if (eggRewardRouter === undefined) {
            throw new GameServiceError(
              "CAPABILITY_UNSUPPORTED",
              "authoritative Egg purchase requires the SlotMachine reducer",
            );
          }
          if (command.quantity !== 1) {
            throw new GameServiceError(
              "ACTION_NOT_ALLOWED",
              "Store Egg purchases require quantity one",
            );
          }
          validateStorePurchaseAffordability(restored.profile, stock, command.quantity);
          const routed = eggRewardRouter.split([
            { kind: stock.onlyMonsters ? "monsterEgg" : "egg" },
          ], "store", 0);
          if (routed.immediate.length !== 0 || routed.pendingEgg === undefined) {
            throw new GameServiceError("STATE_CORRUPT", "Store Egg reward was not handed off");
          }
          const purchased = purchaseStoreStock(restored.profile, stock, command.quantity);
          const nextState = this.snapshot(
            state,
            restored.party,
            restored.profile,
            restored.quests,
            state.location,
            state.world,
            state.battle,
          );
          return {
            state: nextState,
            projection: this.project(nextState, restored.party, restored.profile, restored.quests),
            events: [{
              type: "store.purchased",
              stockId: purchased.stockId,
              quantity: purchased.quantity,
              currency: purchased.currency,
              spent: purchased.spent,
              balance: purchased.balance,
              randomDraws: [],
              receivedItems: purchased.receivedItems.map((item) => item.kind === "gem"
                ? { ...item, enabledStats: [...item.enabledStats] }
                : { ...item }),
            }],
            pendingEgg: routed.pendingEgg,
          } satisfies OfficialInternalReductionResult;
        }
        const rng = replayableRng([], this.random);
        const purchased = purchaseStoreStock(
          restored.profile,
          stock,
          command.quantity,
          rng,
        );
        const nextState = this.snapshot(
          state,
          restored.party,
          restored.profile,
          restored.quests,
          state.location,
          state.world,
          state.battle,
        );
        return {
          state: nextState,
          projection: this.project(nextState, restored.party, restored.profile, restored.quests),
          events: [{
            type: "store.purchased",
            ...purchased,
            randomDraws: [...rng.draws],
            receivedItems: purchased.receivedItems.map((item) => item.kind === "gem"
              ? { ...item, enabledStats: [...item.enabledStats] }
              : { ...item }),
          }],
        };
      }
      if (command.type === "arena.startLicenseChallenge") {
        return this.startArenaChallenge(
          state,
          restored.party,
          restored.profile,
          restored.quests,
          chargeBattleSpiritEnergy,
        );
      }
      if (command.type === "tournament.startBattle") {
        if (state.pendingEgg !== undefined) {
          throw new GameServiceError("ACTION_NOT_ALLOWED", "settle the pending Egg first");
        }
        return this.startTournamentBattle(
          state,
          restored.party,
          restored.profile,
          restored.quests,
          context.now,
          chargeBattleSpiritEnergy,
        );
      }
      if (command.type === "tournament.claimPrize") {
        if (state.pendingEgg !== undefined) {
          throw new GameServiceError("ACTION_NOT_ALLOWED", "settle the pending Egg first");
        }
        return this.claimTournamentPrize(
          state,
          restored.party,
          restored.profile,
          restored.quests,
          eggRewardRouter,
        );
      }
      if (command.type === "tournament.settlePrize") {
        return this.settleTournamentPrize(
          state,
          restored.party,
          restored.profile,
          restored.quests,
        );
      }
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        `${command.type} is not implemented by this simulation`,
      );
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw classifyDomainError(error);
    }
  }

  private characterManagementAvailable(
    location: OfficialLocationV1,
    quests: GuildQuestRuntime,
  ): boolean {
    if (location.kind !== "town") return false;
    const town = this.world(location.worldId).pointsOfInterest.find(
      ({ name }) => name === location.townId,
    );



    return town?.town?.buildings.some((building) =>
      building.className === "CharacterDisplayMenuItem" &&
      !building.fake &&
      townBuildingConditionsPass(building, quests),
    ) === true;
  }

  private storeAvailable(location: OfficialLocationV1): boolean {
    if (location.kind !== "town") return false;
    const town = this.world(location.worldId).pointsOfInterest.find(
      ({ name }) => name === location.townId,
    );
    return town?.town?.buildings.some(
      ({ className, fake }) => className === "StoreMenuItem" && !fake,
    ) === true;
  }

  /** Resolves a client-supplied stock ID against the same catalog the Store screen builds. Every
   *  refusal here is a bad or unsellable ID, so it must surface as a typed client error — a plain
   *  `Error` escapes as `INTERNAL`, reporting a crafted command as a server fault. */
  private storeStock(stockId: string) {
    if (stockId.startsWith("recipe-")) {
      const combineName = stockId.slice("recipe-".length);
      const recipe = this.options.data.allCombineRecipes().find(
        ({ resultShortType }) => resultShortType === combineName,
      );
      if (recipe === undefined) {
        throw new GameServiceError("ENTITY_NOT_FOUND", `unknown recipe stock ${stockId}`);
      }
      return recipeStoreStock(
        combineName,
        storeWholeStars(this.options.data.monsterByShortType(combineName).stars),
      );
    }
    if (stockId.startsWith("totem-")) {
      const shortType = stockId.slice("totem-".length);



      const monster = this.options.data.allMonsters().find(
        (candidate) => candidate.shortType === shortType,
      );
      if (monster === undefined || monster.category !== "Summon") {
        throw new GameServiceError("ENTITY_NOT_FOUND", `unknown spirit totem stock ${stockId}`);
      }
      return spiritTotemStoreStock(
        shortType,
        storeWholeStars(monster.stars),
        storeHasHalfStar(monster.stars),
      );
    }
    try {
      return sourceStoreStock(stockId);
    } catch {
      throw new GameServiceError("ENTITY_NOT_FOUND", `unknown store stock ${stockId}`);
    }
  }

  private arenaAvailable(location: OfficialLocationV1): boolean {
    if (location.kind !== "town") return false;
    const town = this.world(location.worldId).pointsOfInterest.find(
      ({ name }) => name === location.townId,
    );
    return town?.town?.buildings.some(
      ({ className, fake, noLicense }) =>
        className === "ArenaMenuItem" && !fake && noLicense !== true,
    ) === true;
  }

  private tournamentAvailable(location: OfficialLocationV1): boolean {
    if (location.kind !== "town") return false;
    const town = this.world(location.worldId).pointsOfInterest.find(
      ({ name }) => name === location.townId,
    );
    return town?.town?.buildings.some(
      ({ className, fake }) => className === "ArenaMenuItem" && !fake,
    ) === true;
  }

  private startTournamentBattle(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    now: string,
    chargeBattleSpiritEnergy: boolean,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (!this.tournamentAvailable(prior.location) || prior.location.kind !== "town") {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        "Tournament battle requires a town Arena",
      );
    }
    const progress = profile.tournament;
    const tournament = this.options.data.tournament(progress.index);
    if (tournament === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "all Tournaments are complete");
    }
    if (progress.status === 2) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        "claim the current Tournament prize before another battle",
      );
    }
    // Command commit timestamps carry millisecond precision, while Tournament progress is part of
    // the integer-seconds projection wire. Quantize at the authority boundary so an ordinary
    // request time cannot create a state value that its own strict projection rejects.
    const nowSeconds = Math.floor(Date.parse(now) / 1_000);
    if (!Number.isFinite(nowSeconds)) {
      throw new GameServiceError("STATE_CORRUPT", "server Tournament time is invalid");
    }
    const remaining = progress.beginBattle(nowSeconds);
    if (remaining > 0) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        `Tournament cooldown has ${Math.ceil(remaining)} seconds remaining`,
      );
    }
    const round = progress.round;
    const rng = replayableRng([], this.random);
    const tournamentEncounter = buildTournamentEncounter(tournament, round, rng);
    const built = buildOfficialTournamentBattle(tournamentEncounter, party);
    const battleId = `battle-${prior.nextBattleSequence}`;
    const initialReplay: BattleReplaySnapshotV1 = {
      schemaVersion: 1,
      randomDraws: [],
      teams: officialBattleTeams(built.teams),
      options: {
        fightingGroupSize: 3,
        silver: profile.snapshot().silver,
        ...(this.sourceJobLevelsForCurrentReduction ? { sourceJobLevels: true } : {}),
      },
      commands: [],
    };
    const first = restoreBattleReplay(this.options.data, initialReplay, {
      randomSource: this.random,
    });
    if (chargeBattleSpiritEnergy) {
      applyCommittedBattleSpiritEnergy(profile, first, first.events);
    }
    const battle: OfficialBattleStateV1 = {
      schemaVersion: 1,
      battleId,
      origin: {
        kind: "tournament",
        worldId: prior.location.worldId,
        townId: prior.location.townId,
        tournamentIndex: tournament.index,
        round,
      },
      encounter: built.encounter,
      replay: {
        ...initialReplay,
        randomDraws: first.randomDraws!,
      },
    };
    const events: UnsequencedPresentationEventV1[] = [
      {
        type: "tournament.battleStarted",
        tournamentIndex: tournament.index,
        round,
      },
      { type: "battle.started", battleId },
    ];
    this.fireEnemyDeathQuestEvents(events, quests, first, first.events);
    const state: OfficialGameStateV1 = {
      ...this.snapshot(
        prior,
        party,
        profile,
        quests,
        {
          kind: "battle",
          worldId: prior.location.worldId,
          poiId: prior.location.townId,
          battleId,
        },
        prior.world,
        battle,
      ),
      nextBattleSequence: prior.nextBattleSequence + 1,
    };
    return {
      state,
      projection: this.project(state, party, profile, quests, first),
      events,
    };
  }

  private claimTournamentPrize(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    eggRewardRouter?: OfficialEggRewardRouter,
  ): OfficialInternalReductionResult {
    if (!this.tournamentAvailable(prior.location)) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        "Tournament prize claim requires a town Arena",
      );
    }
    const tournament = this.options.data.tournament(profile.tournament.index);
    if (tournament === undefined || profile.tournament.status !== 2) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "Tournament prize is not ready");
    }
    if (eggRewardRouter !== undefined) {
      validateEggTreasureData(
        parseDungeonTreasureData(
          tournament.treasureData,
          `Tournaments.plist[${tournament.index}].treasureData`,
          1,
        ),
        `Tournaments.plist[${tournament.index}].treasureData`,
        this.options.data,
      );
    }
    const rewards = generateTournamentPrize(
      tournament,
      replayableRng([], this.random),
    );
    const routed = eggRewardRouter?.split(rewards, "tournament", 1);
    const eggRewards = eggRewardRouter === undefined
      ? rewards.filter((reward) => reward.kind === "egg" || reward.kind === "monsterEgg")
      : [];
    if (eggRewardRouter === undefined && eggRewards.length > 1) {
      throw new GameServiceError("STATE_CORRUPT", "Tournament prize contains multiple Eggs");
    }
    let nextMonsterSequence = prior.nextMonsterSequence;
    const immediateRewards = routed?.immediate ?? rewards.filter(
      (reward) => reward.kind !== "egg" && reward.kind !== "monsterEgg",
    );
    reserveOfficialMonsterSequence(
      nextMonsterSequence,
      monsterJoinRewardCount(immediateRewards),
      "tournament prize",
    );
    const applied = applyPlayerRewards(profile, immediateRewards, {
      addMonsterJoin: (shortType, jobLevel) => {
        const allocated = allocateOfficialMonsterSequence(nextMonsterSequence, "tournament prize");
        nextMonsterSequence = allocated.nextSequence;
        const instanceId = allocated.instanceId;
        party.addCapturedMonster({ instanceId, shortType, level: jobLevel });
        profile.recordCapturedMonster(shortType, jobLevel);
        return { instanceId };
      },
    });
    const claimedIndex = tournament.index;
    profile.tournament.claimPrize();
    const state: OfficialGameStateV1 = {
      ...this.snapshot(
        prior,
        party,
        profile,
        quests,
        prior.location,
        prior.world,
        undefined,
      ),
      nextMonsterSequence,
      ...(eggRewardRouter !== undefined || eggRewards[0] === undefined
        ? {}
        : {
            pendingEgg: {
              schemaVersion: 1 as const,
              kind: eggRewards[0].kind === "egg" ? "silver" as const : "gold" as const,
            },
          }),
    };
    const events: UnsequencedPresentationEventV1[] = [{
      type: "tournament.prizeClaimed",
      tournamentIndex: claimedIndex,
    }];
    for (const reward of applied) {
      if (reward.kind === "monsterJoin") {
        events.push({
          type: "player.monsterAdded",
          instanceId: reward.instanceId,
          monsterTypeId: reward.shortType,
          level: reward.jobLevel,
          reason: "reward",
        });
      }
    }
    return {
      state,
      projection: this.project(state, party, profile, quests),
      events,
      ...(routed?.pendingEgg === undefined ? {} : { pendingEgg: routed.pendingEgg }),
    };
  }

  private settleTournamentPrize(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.pendingEgg === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "no pending Tournament Egg to settle");
    }
    if (prior.location.kind !== "town") {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "Tournament Egg can only be settled in a town");
    }
    const { pendingEgg, ...snapshot } = this.snapshot(
        prior,
        party,
        profile,
        quests,
        prior.location,
        prior.world,
        prior.battle,
      );
    if (pendingEgg === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "no pending Tournament Egg to settle");
    }
    const state = snapshot;
    return { state, projection: this.project(state, party, profile, quests), events: [] };
  }

  private startArenaChallenge(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    chargeBattleSpiritEnergy: boolean,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (!this.arenaAvailable(prior.location) || prior.location.kind !== "town") {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        "license challenge requires a normal town Arena",
      );
    }
    const next = this.options.data.allLicenses()[profile.licenseOrdinal + 1];
    if (next === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "Grandmaster is the highest license");
    }
    const qualification = profile.licenseQualification(
      next,
      quests.finishedQuestNames().length,
    );
    if (!qualification.qualifies) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        `license challenge requires ${qualification.completedQuestsRequired} quests and ` +
          `hero level ${qualification.heroLevelRequired}`,
      );
    }
    const challenge = buildLicenseChallengeEncounter(next);
    const built = buildOfficialArenaBattle(challenge.encounter, party);
    // v25: the license challenge's startEvent runs (and records its chat) before combat starts.
    this.recordEncounterChat(quests, challenge.startChatKey);
    const battleId = `battle-${prior.nextBattleSequence}`;
    const initialReplay: BattleReplaySnapshotV1 = {
      schemaVersion: 1,
      randomDraws: [],
      teams: officialBattleTeams(built.teams),
      options: {
        fightingGroupSize: 3,
        silver: profile.snapshot().silver,
        ...(this.sourceJobLevelsForCurrentReduction ? { sourceJobLevels: true } : {}),
      },
      commands: [],
    };
    const first = restoreBattleReplay(this.options.data, initialReplay, {
      randomSource: this.random,
    });
    if (chargeBattleSpiritEnergy) {
      applyCommittedBattleSpiritEnergy(profile, first, first.events);
    }
    const battle: OfficialBattleStateV1 = {
      schemaVersion: 1,
      battleId,
      origin: {
        kind: "arena",
        worldId: prior.location.worldId,
        townId: prior.location.townId,
        licenseType: next.type,
      },
      encounter: built.encounter,
      replay: {
        ...initialReplay,
        randomDraws: first.randomDraws!,
      },
    };
    const events: UnsequencedPresentationEventV1[] = [{ type: "battle.started", battleId }];
    this.fireEnemyDeathQuestEvents(events, quests, first, first.events);
    const state: OfficialGameStateV1 = {
      ...this.snapshot(
        prior,
        party,
        profile,
        quests,
        {
          kind: "battle",
          worldId: prior.location.worldId,
          poiId: prior.location.townId,
          battleId,
        },
        prior.world,
        battle,
      ),
      nextBattleSequence: prior.nextBattleSequence + 1,
    };
    return {
      state,
      projection: this.project(state, party, profile, quests, first),
      events,
    };
  }

  /**
   * Explicit v2 -> v3 operator migration. V2 never persisted Guild/story state and could leave a
   * completed navigation onto a town POI classified as `world`. Reconstruct only deterministic
   * fixed-encounter story facts, then apply the missed town-return transaction when the last
   * location command proves this was a navigation arrival rather than a deliberate departure.
   */
  migrateV2State(
    value: unknown,
    input: {
      readonly updatedAt: string;
      readonly lastLocationCommand?: GameCommandV1;
    },
  ): {
    readonly state: OfficialGameStateV1;
    readonly projection: OfficialGameProjectionBodyV1;
  } {
    if (value === null || typeof value !== "object") {
      throw new Error("official-game-v2 migration requires an object state");
    }
    validateOfficialEnvelope(value, { allowMissingQuests: true });
    if ("quests" in value) {
      throw new Error("official-game-v2 migration requires a state without Guild/story data");
    }
    const emptyParsed = parseOfficialGameStateV1(
      this.options.data,
      this.options.quests,
      this.withMigratedTownVisits({
      ...value,
      quests: emptyGuildQuestStateSnapshot(),
      }),
      this.dungeonParseContext(),
    );
    const inferredQuests = inferV2GuildQuestState(this.options.world, emptyParsed.world);
    const parsed = parseOfficialGameStateV1(this.options.data, this.options.quests, {
      ...emptyParsed,
      quests: inferredQuests,
    }, this.dungeonParseContext());
    const party = WorldTripParty.fromStateSnapshot(this.options.data, parsed.party);
    const profile = PlayerProfile.fromStateSnapshot(
      parsed.profile,
      party.monsters().map((monster) => monster.level),
      party,
      profileRestoreOptions(this.options.data, parsed.profile),
    );
    party.setPlayerBuffSource(() => profile.battleStatBonuses());
    const quests = new GuildQuestRuntime(this.options.quests, parsed.quests);
    let state = this.snapshot(
      parsed,
      party,
      profile,
      quests,
      parsed.location,
      parsed.world,
      parsed.battle,
    );
    const currentWorldPoiId = parsed.location.kind === "world"
      ? parsed.location.poiId
      : undefined;
    const currentTown = currentWorldPoiId === undefined
      ? undefined
      : this.options.world.pointsOfInterest.find(({ name }) =>
          name === currentWorldPoiId && name === parsed.world?.currentPoiId)
    if (
      currentTown?.town !== undefined &&
      input.lastLocationCommand?.type === "world.navigate" &&
      input.lastLocationCommand.targetPoiId === currentTown.name &&
      parsed.world !== undefined
    ) {
      const nowSeconds = Date.parse(input.updatedAt) / 1_000;
      if (!Number.isFinite(nowSeconds)) throw new Error("v2 migration has an invalid commit time");
      party.restoreAtTown(nowSeconds);
      profile.resetSpiritsForTownReturn();
      const restored = restoreOfficialWorldTrip({
        data: this.options.data,
        world: this.options.world,
        state: parsed.world,
        rng: replayableRng([]),
        hasCompletedFixedEncounter: (key) => quests.hasCompletedFixedEncounter(key),
        canUseQuestKey: (key) => quests.canUseQuestKey(key),
      });
      restored.trip.refreshAtTown();
      advanceWorldDay(restored.shared);
      quests.enteredTown(currentTown.name);
      const world = snapshotOfficialWorldState(
        parsed.world.worldId,
        currentTown.name,
        parsed.world.lastTownId,
        restored.shared,
        [...new Set([...parsed.world.visitedTownIds, currentTown.name])],
      );
      state = this.snapshot(
        parsed,
        party,
        profile,
        quests,
        { kind: "town", worldId: parsed.world.worldId, townId: currentTown.name },
        world,
        undefined,
        null,
      );
    }
    return {
      state,
      projection: this.project(state, party, profile, quests),
    };
  }

  private createSlot(
    command: Extract<GameCommandV1, { type: "slot.create" }>,
  ): CommandReducerResult<OfficialGameStateV1> {
    const shortType = STARTER_BY_ELEMENT[command.starterElement];
    const monster = this.options.data.monsterByShortType(shortType);
    const party = new WorldTripParty(this.options.data, [{
      instanceId: "monster-1",
      shortType,
      level: 1,
      cumulativeXp: jobXpForLevel(1, this.options.data.jobXpPenalty(shortType)),
      currentHp: baseStat(monster, "MaxHP", 1),
    }], this.options.data.license("Novice").battingOrderSize);
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults(shortType),
      monsterPartyLevels: [1],
      evolveChainOf: (type) => this.options.data.evolveChainOrUndefined(type),
      licenseBattingOrderSize: this.options.data.license("Novice").battingOrderSize,
    }, party);
    party.setPlayerBuffSource(() => profile.battleStatBonuses());
    const quests = new GuildQuestRuntime(this.options.quests, emptyGuildQuestStateSnapshot());
    const state: OfficialGameStateV1 = {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: quests.stateSnapshot(),
      location: {
        kind: "town",
        worldId: this.options.world.name,
        townId: this.options.startTownId,
      },
      world: createInitialOfficialWorldState(this.options.world, this.options.startTownId),
      nextMonsterSequence: 2,
      nextBattleSequence: 1,
    };
    return {
      state,
      projection: this.project(
        state,
        party,
        profile,
        quests,
      ),
      events: [
        { type: "slot.created" },
        {
          type: "player.monsterAdded",
          instanceId: "monster-1",
          monsterTypeId: shortType,
          level: 1,
          reason: "starter",
        },
      ],
    };
  }

  private leaveTown(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    now: string,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.location.kind !== "town") {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "world.leaveTown requires a town location");
    }
    const installedWorld = this.world(prior.location.worldId);
    const world = prior.world ?? createInitialOfficialWorldState(
      installedWorld,
      prior.location.townId,
    );
    const restored = restoreOfficialWorldTrip({
      data: this.options.data,
      world: installedWorld,
      state: world,
      rng: replayableRng([], this.random),
      hasCompletedFixedEncounter: (key) => quests.hasCompletedFixedEncounter(key),
      canUseQuestKey: (key) => quests.canUseQuestKey(key),
    });
    party.purgeExpiredInjuries(Date.parse(now) / 1_000);
    const nextWorld = snapshotOfficialWorldState(
      installedWorld.name,
      restored.trip.currentPoiName,
      prior.location.townId,
      restored.shared,
      world.visitedTownIds,
    );
    const state = this.snapshot(
      prior,
      party,
      profile,
      quests,
      { kind: "world", worldId: nextWorld.worldId, poiId: nextWorld.currentPoiId },
      nextWorld,
      undefined,
    );
    return {
      state,
      projection: this.project(state, party, profile, quests),
      events: [{
        type: "world.arrived",
        worldId: nextWorld.worldId,
        poiId: nextWorld.currentPoiId,
        movement: "same",
        randomDraws: [],
      }],
    };
  }

  private useDirectTownReturn(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    now: string,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.location.kind !== "world" && prior.location.kind !== "dungeon") {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        "world.useDirectTownReturn requires a world or dungeon location",
      );
    }
    if (prior.world === undefined) throw new Error("direct town return is missing world state");
    const destination = this.town(prior.world.lastTownId);
    const shared = restoreOfficialWorldSharedState(prior.world);
    party.restoreAtTown(Date.parse(now) / 1_000);
    profile.resetSpiritsForTownReturn();
    refreshWorldTripAtTown(shared, destination.poi.name);
    advanceWorldDay(shared);
    const world = snapshotOfficialWorldState(
      destination.world.name,
      destination.poi.name,
      destination.poi.name,
      shared,
      [...new Set([...prior.world.visitedTownIds, destination.poi.name])],
    );
    const events: UnsequencedPresentationEventV1[] = [{
      type: "world.arrived",
      worldId: world.worldId,
      poiId: world.currentPoiId,
      movement: "teleport",
      randomDraws: [],
    }];
    appendGuildQuestEvents(events, quests, () => quests.enteredTown(destination.poi.name));
    const state = this.snapshot(
      prior,
      party,
      profile,
      quests,
      { kind: "town", worldId: world.worldId, townId: destination.poi.name },
      world,
      undefined,
      null,
    );
    return { state, projection: this.project(state, party, profile, quests), events };
  }

  /** Explicit v9 -> v10 migration: reconstruct source town visits from durable completed POIs. */
  migrateV9State(value: unknown): {
    readonly state: OfficialGameStateV1;
    readonly projection: OfficialGameProjectionBodyV1;
  } {
    validateOfficialEnvelope(value);
    const state = parseOfficialGameStateV1(
      this.options.data,
      this.options.quests,
      this.withMigratedTownVisits(value),
      this.dungeonParseContext(),
    );
    const restored = this.restore(state);
    return {
      state,
      projection: this.project(
        state,
        restored.party,
        restored.profile,
        restored.quests,
      ),
    };
  }

  private useTownPortal(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    command: Extract<GameCommandV1, { type: "world.usePortal" }>,
    now: string,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.location.kind !== "town" || prior.world === undefined) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        "world.usePortal requires a town location",
      );
    }
    const currentTown = this.town(prior.location.townId);
    if (!currentTown.poi.town!.buildings.some(
      ({ className }) => className === "TownWarpMenuItem",
    )) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        `town ${currentTown.poi.name} has no Warp Gate`,
      );
    }
    const destinations = this.townPortalDestinations();
    const current = destinations.find(({ townName }) => townName === currentTown.poi.name);
    const destination = destinations.find(
      ({ townName }) => townName === command.destinationTownId,
    );
    if (current === undefined || destination === undefined) {
      throw new GameServiceError(
        "ENTITY_NOT_FOUND",
        `Warp Gate destination ${command.destinationTownId} is unavailable`,
      );
    }
    const conditionContext = this.townPortalConditionContext(prior.world, quests);
    if (!sourceConditionsAreMet(current.portalConditions, conditionContext)) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "town Warp Gates are disabled");
    }
    if (!sourceConditionsAreMet(destination.portalConditions, conditionContext)) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        `Warp Gate destination ${destination.townName} is locked`,
      );
    }
    if (!prior.world.visitedTownIds.includes(destination.townName)) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        `Warp Gate destination ${destination.townName} has not been visited`,
      );
    }
    const installed = this.town(destination.townName);
    const shared = restoreOfficialWorldSharedState(prior.world);
    party.restoreAtTown(Date.parse(now) / 1_000);
    profile.resetSpiritsForTownReturn();
    refreshWorldTripAtTown(shared, installed.poi.name);
    advanceWorldDay(shared);
    const world = snapshotOfficialWorldState(
      installed.world.name,
      installed.poi.name,
      installed.poi.name,
      shared,
      prior.world.visitedTownIds,
    );
    const events: UnsequencedPresentationEventV1[] = [{
      type: "world.arrived",
      worldId: world.worldId,
      poiId: world.currentPoiId,
      movement: "teleport",
      randomDraws: [],
    }];
    appendGuildQuestEvents(events, quests, () => quests.enteredTown(installed.poi.name));
    const state = this.snapshot(
      prior,
      party,
      profile,
      quests,
      { kind: "town", worldId: world.worldId, townId: installed.poi.name },
      world,
      undefined,
      null,
    );
    return { state, projection: this.project(state, party, profile, quests), events };
  }

  private activateWorldZone(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    command: Extract<GameCommandV1, { type: "world.activateZone" }>,
    chargeBattleSpiritEnergy: boolean,
    sourceDungeonPopulationInheritance: boolean,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.location.kind !== "world" || prior.world === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "world.activateZone requires the world");
    }
    if (command.zoneId !== prior.location.poiId) {
      throw new GameServiceError("ENTITY_NOT_FOUND", `world zone ${command.zoneId} is not current`);
    }
    const sourceWorld = this.world(prior.location.worldId);
    const poi = sourceWorld.pointsOfInterest.find(({ name }) => name === command.zoneId);
    if (poi?.zoneChange === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `world zone ${command.zoneId} is not an exit`);
    }




    if (
      this.sourceStoryRulesForCurrentReduction &&
      !sourceConditionsAreMet(
        poi.zoneChange.conditions,
        this.townPortalConditionContext(prior.world, quests),
      )
    ) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        `world zone ${command.zoneId} conditions are not met`,
      );
    }
    if (poi.zoneChange.kind === "dungeon") {
      if (
        this.options.resources === undefined ||
        poi.zoneChange.dungeon === undefined ||
        poi.zoneChange.dungeonFile === undefined
      ) {
        throw new Error(`dungeon entrance ${sourceWorld.name}.${poi.name} is incomplete`);
      }
      const route: DungeonRouteDescriptor = {
        typeName: poi.zoneChange.dungeon,
        sourceFile: poi.zoneChange.dungeonFile,
        floor: poi.zoneChange.dungeonLevel ?? 1,
        ...(poi.zoneChange.targetZoneChange === undefined
          ? {}
          : { entryZoneName: poi.zoneChange.targetZoneChange }),
      };
      const run = prior.dungeon === undefined
        ? DungeonRuntimeController.enter(
            this.dungeonContext(
              profile,
              quests,
              this.randomSeed(),
              undefined,
              sourceDungeonPopulationInheritance,
            ),
            route,
          )
        : this.restoreDungeon(
            prior.dungeon,
            profile,
            quests,
            undefined,
            sourceDungeonPopulationInheritance,
          );
      if (prior.dungeon !== undefined) run.reenterFromWorld(route);
      const entryActions = run.session.enterCurrentRoom();
      if (entryActions.some((action) => action.kind === "waypoint")) {
        run.registerWaypoint();
      }
      const dungeon = this.dungeonState(run, sourceWorld.name, poi.name);
      const events: UnsequencedPresentationEventV1[] = [{
        type: "dungeon.entered",
        dungeonId: run.session.snapshot().definitionId,
        floor: run.route.floor,
        roomId: run.session.currentRoom.id,
      }];
      // Before `snapshot`, so the durable `infiniteHighestLevel` write is part of this revision.
      this.applyInfiniteDungeonFloor(run, profile, events);
      const state = this.snapshot(
        prior,
        party,
        profile,
        quests,
        this.dungeonLocation(run),
        prior.world,
        undefined,
        dungeon,
      );
      const encounter = entryActions.find((action) => action.kind === "encounter")?.encounter;
      if (encounter !== undefined) {
        return this.startDungeonBattle(
          state,
          party,
          profile,
          quests,
          run,
          encounter,
          events,
          chargeBattleSpiritEnergy,
        );
      }
      return {
        state,
        projection: this.project(state, party, profile, quests),
        events,
      };
    }
    const targetWorldId = poi.zoneChange.targetWorld;
    const targetPoiId = poi.zoneChange.targetZoneChange;
    if (targetWorldId === undefined || targetPoiId === undefined) {
      throw new Error(`world exit ${sourceWorld.name}.${poi.name} is incomplete`);
    }
    const targetWorld = this.world(targetWorldId);
    if (!targetWorld.pointsOfInterest.some(({ name }) => name === targetPoiId)) {
      throw new Error(`world exit ${sourceWorld.name}.${poi.name} targets missing ${targetWorldId}.${targetPoiId}`);
    }
    const shared = restoreOfficialWorldSharedState(prior.world);
    const trip = restoreOfficialWorldTrip({
      data: this.options.data,
      world: targetWorld,
      state: snapshotOfficialWorldState(
        targetWorldId,
        targetPoiId,
        prior.world.lastTownId,
        shared,
        prior.world.visitedTownIds,
      ),
      rng: replayableRng([], this.random),
      hasCompletedFixedEncounter: (key) => quests.hasCompletedFixedEncounter(key),
      canUseQuestKey: (key) => quests.canUseQuestKey(key),
    });
    const world = snapshotOfficialWorldState(
      targetWorldId,
      trip.trip.currentPoiName,
      prior.world.lastTownId,
      trip.shared,
      prior.world.visitedTownIds,
    );
    const state = this.snapshot(
      prior,
      party,
      profile,
      quests,
      { kind: "world", worldId: targetWorldId, poiId: world.currentPoiId },
      world,
      undefined,
    );
    return {
      state,
      projection: this.project(state, party, profile, quests),
      events: [{
        type: "world.arrived",
        worldId: targetWorldId,
        poiId: world.currentPoiId,
        movement: "same",
        randomDraws: [],
      }],
    };
  }

  private navigateWorld(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    command: Extract<GameCommandV1, { type: "world.navigate" | "world.selectCurrentPoi" }>,
    now: string,
    chargeBattleSpiritEnergy: boolean,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.location.kind !== "world" || prior.world === undefined || prior.battle !== undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `${command.type} requires the world`);
    }
    const rng = replayableRng([], this.random);
    const installedWorld = this.world(prior.location.worldId);
    // `navigate`/`refreshAtTown` complete POIs (source event 2) before this reducer has an event
    // array to append to, so buffer and drain once the presentation list exists.
    const pendingPoiQuestEvents: GuildQuestEvent[] = [];
    const restored = restoreOfficialWorldTrip({
      data: this.options.data,
      world: installedWorld,
      state: prior.world,
      rng,
      hasCompletedFixedEncounter: (key) => quests.hasCompletedFixedEncounter(key),
      canUseQuestKey: (key) => quests.canUseQuestKey(key),
      onQuestEvent: (event) => { pendingPoiQuestEvents.push(event); },
    });
    const targetPoiId = command.type === "world.navigate"
      ? command.targetPoiId
      : restored.trip.currentPoiName;
    const activeLevels = party.projectAliveBattingPrefix().slice(0, 3).map((member) => member.level);
    const arrival = restored.trip.navigate(targetPoiId, activeLevels);
    const nextWorld = snapshotOfficialWorldState(
      installedWorld.name,
      restored.trip.currentPoiName,
      prior.world.lastTownId,
      restored.shared,
      prior.world.visitedTownIds,
    );
    const movement = arrival.movement?.kind ?? "same";
    const events: UnsequencedPresentationEventV1[] = [{
      type: "world.arrived",
      worldId: nextWorld.worldId,
      poiId: nextWorld.currentPoiId,
      movement,
      randomDraws: [...rng.draws],
    }];
    const drainPoiQuestEvents = (): void => {
      for (const event of pendingPoiQuestEvents.splice(0)) {
        appendGuildQuestEvents(events, quests, () => quests.fireEvent(event));
      }
    };
    drainPoiQuestEvents();
    if (arrival.kind !== "encounter") {
      const poi = installedWorld.pointsOfInterest.find(({ name }) => name === targetPoiId)!;
      if (poi.town !== undefined) {
        const nowSeconds = Date.parse(now) / 1_000;
        party.restoreAtTown(nowSeconds);
        profile.resetSpiritsForTownReturn();
        restored.trip.refreshAtTown();
        advanceWorldDay(restored.shared);
        drainPoiQuestEvents();
        appendGuildQuestEvents(events, quests, () => quests.enteredTown(targetPoiId));
        const townWorld = snapshotOfficialWorldState(
          nextWorld.worldId,
          targetPoiId,
          targetPoiId,
          restored.shared,
          [...new Set([...prior.world.visitedTownIds, targetPoiId])],
        );
        const state = this.snapshot(
          prior,
          party,
          profile,
          quests,
          { kind: "town", worldId: townWorld.worldId, townId: targetPoiId },
          townWorld,
          undefined,
          null,
        );
        return { state, projection: this.project(state, party, profile, quests), events };
      }
      const state = this.snapshot(
        prior,
        party,
        profile,
        quests,
        { kind: "world", worldId: nextWorld.worldId, poiId: nextWorld.currentPoiId },
        nextWorld,
        undefined,
      );
      return { state, projection: this.project(state, party, profile, quests), events };
    }

    const built = buildOfficialWorldBattle(
      arrival.encounter,
      installedWorld,
      party,
    );
    if (arrival.encounter.startEvent !== undefined) {
      const chat = arrival.encounter.startEvent.chat;
      quests.requestChatPresentation(chat.name, chat.alwaysShow);
    }
    const battleId = `battle-${prior.nextBattleSequence}`;
    const initialReplay: BattleReplaySnapshotV1 = {
      schemaVersion: 1,
      randomDraws: [],
      teams: officialBattleTeams(built.teams),
      options: {
        fightingGroupSize: 3,
        silver: profile.snapshot().silver,
        ...(this.sourceJobLevelsForCurrentReduction ? { sourceJobLevels: true } : {}),
      },
      commands: [],
    };
    const first = restoreBattleReplay(this.options.data, initialReplay, {
      randomSource: this.random,
    });
    if (chargeBattleSpiritEnergy) {
      applyCommittedBattleSpiritEnergy(profile, first, first.events);
    }
    const replay: BattleReplaySnapshotV1 = {
      ...initialReplay,
      randomDraws: first.randomDraws!,
    };
    const battle: OfficialBattleStateV1 = {
      schemaVersion: 1,
      battleId,
      origin: { kind: "world", worldId: nextWorld.worldId, poiId: nextWorld.currentPoiId },
      encounter: built.encounter,
      replay,
    };
    // Snapshot construction never reads `events`; pushing first only lets v25 append the opening
    // prefix's quest events after `battle.started` and before the quest snapshot is taken.
    events.push({ type: "battle.started", battleId });
    this.fireEnemyDeathQuestEvents(events, quests, first, first.events);
    const state: OfficialGameStateV1 = {
      ...this.snapshot(
        prior,
        party,
        profile,
        quests,
        {
          kind: "battle",
          worldId: nextWorld.worldId,
          poiId: nextWorld.currentPoiId,
          battleId,
        },
        nextWorld,
        battle,
      ),
      nextBattleSequence: prior.nextBattleSequence + 1,
    };
    return { state, projection: this.project(state, party, profile, quests, first), events };
  }













  private applyInfiniteDungeonFloor(
    run: DungeonRuntimeController,
    profile: PlayerProfile,
    events: UnsequencedPresentationEventV1[],
  ): void {
    if (!isInfiniteDungeonInstance(run.definition.instanceName)) return;
    const entry = profile.recordInfiniteDungeonFloor(run.route.floor);
    if (!entry.updated) return;
    events.push({
      type: "dungeon.infiniteFloorEntered",
      dungeonId: run.session.snapshot().definitionId,
      floor: run.route.floor,
      previousHighest: entry.previousHighest,
    });
  }

  private applyDungeon(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    command: Extract<GameCommandV1, { type: `dungeon.${string}` }>,
    now: string,
    eggRewardRouter?: OfficialEggRewardRouter,
    chargeBattleSpiritEnergy = false,
    sourceDungeonPopulationInheritance = false,
  ): OfficialInternalReductionResult {
    if (prior.location.kind !== "dungeon" || prior.dungeon === undefined || prior.world === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `${command.type} requires an active dungeon`);
    }
    const run = this.restoreDungeon(
      prior.dungeon,
      profile,
      quests,
      undefined,
      sourceDungeonPopulationInheritance,
    );
    const events: UnsequencedPresentationEventV1[] = [];
    let nextMonsterSequence = prior.nextMonsterSequence;
    let pendingEgg: OfficialEggContinuation | undefined;
    if (command.type === "dungeon.selectRoom") {
      const result = run.session.selectMaterializedRoom(command.roomId);
      events.push({
        type: "dungeon.roomSelected",
        dungeonId: run.session.snapshot().definitionId,
        roomId: command.roomId,
        transition: result.kind === "same-room" ? "same-room" : result.transition,
      });
      const actions = result.kind === "changed-room"
        ? result.actions
        : run.session.enterCurrentRoom();
      if (actions.some((action) => action.kind === "waypoint")) {
        run.registerWaypoint();
      }
      const encounter = actions.find((action) => action.kind === "encounter")?.encounter;
      if (encounter !== undefined) {
        return this.startDungeonBattle(
          prior,
          party,
          profile,
          quests,
          run,
          encounter,
          events,
          chargeBattleSpiritEnergy,
        );
      }
    } else if (command.type === "dungeon.activateZone") {
      const transition = run.activateZone(command.zoneId);
      if (transition.kind === "blocked") {
        throw new GameServiceError("ACTION_NOT_ALLOWED", "dungeon floor must be cleared first");
      }
      if (transition.kind === "world") {
        const targetWorld = this.world(transition.change.targetWorld);
        if (!targetWorld.pointsOfInterest.some(
          ({ name }) => name === transition.change.targetZoneChange,
        )) {
          throw new Error(
            `dungeon exit targets missing ${transition.change.targetWorld}.` +
              transition.change.targetZoneChange,
          );
        }
        const shared = restoreOfficialWorldSharedState(prior.world);
        const world = snapshotOfficialWorldState(
          targetWorld.name,
          transition.change.targetZoneChange,
          prior.world.lastTownId,
          shared,
          prior.world.visitedTownIds,
        );
        const state = this.snapshot(
          prior,
          party,
          profile,
          quests,
          {
            kind: "world",
            worldId: targetWorld.name,
            poiId: transition.change.targetZoneChange,
          },
          world,
          undefined,
          this.dungeonState(
            run,
            prior.dungeon.worldId,
            prior.dungeon.entrancePoiId,
          ),
        );
        events.push(
          { type: "dungeon.zoneActivated", zoneId: command.zoneId, destination: "world" },
          { type: "dungeon.exited" },
          {
            type: "world.arrived",
            worldId: world.worldId,
            poiId: world.currentPoiId,
            movement: "same",
            randomDraws: [],
          },
        );
        return { state, projection: this.project(state, party, profile, quests), events };
      }
      events.push({
        type: "dungeon.zoneActivated",
        zoneId: command.zoneId,
        destination: transition.kind,
      });
      this.applyInfiniteDungeonFloor(run, profile, events);
      const actions = run.session.enterCurrentRoom();
      if (actions.some((action) => action.kind === "waypoint")) {
        run.registerWaypoint();
      }
      const encounter = actions.find((action) => action.kind === "encounter")?.encounter;
      if (encounter !== undefined) {
        return this.startDungeonBattle(
          prior,
          party,
          profile,
          quests,
          run,
          encounter,
          events,
          chargeBattleSpiritEnergy,
        );
      }
    } else if (command.type === "dungeon.travelToWaypoint") {
      const restoredFromCache = run.travelToWaypoint(command.floor);
      events.push({
        type: "dungeon.waypointTravelled",
        dungeonId: run.session.snapshot().definitionId,
        floor: run.route.floor,
        roomId: run.session.currentRoom.id,
        restoredFromCache,
      });
      this.applyInfiniteDungeonFloor(run, profile, events);
      const encounter = run.session.enterCurrentRoom()
        .find((action) => action.kind === "encounter")?.encounter;
      if (encounter !== undefined) {
        return this.startDungeonBattle(
          prior,
          party,
          profile,
          quests,
          run,
          encounter,
          events,
          chargeBattleSpiritEnergy,
        );
      }
    } else if (command.type === "dungeon.openTreasure") {
      const room = run.session.currentRoom;
      const currentTreasure = room.encounter?.treasure ?? room.treasure;
      const floor = run.session.snapshot();
      if (
        currentTreasure?.id !== command.treasureId ||
        floor.collectedTreasureIds.includes(command.treasureId) ||
        (currentTreasure.guarded && room.encounter !== undefined &&
          !floor.clearedEncounterIds.includes(room.encounter.id))
      ) {
        throw new GameServiceError(
          "ACTION_NOT_ALLOWED",
          `dungeon treasure ${command.treasureId} is not visible in the current room`,
        );
      }
      const encounter = room.encounter;
      const rewardKey = encounter?.battleRewardKey ?? encounter?.questKey;
      const alreadyReceived = rewardKey !== undefined &&
        quests.hasReceivedBattleReward(rewardKey);
      if (eggRewardRouter !== undefined) {
        eggRewardRouter.validateLoadedRewards(currentTreasure.loot);
      }
      const generatedLoot = run.session.collectTreasure(command.treasureId);
      const loot = alreadyReceived ? [] : generatedLoot;
      ({ nextMonsterSequence, pendingEgg } = this.applyDungeonLoot(
        party,
        profile,
        loot,
        nextMonsterSequence,
        events,
        "dungeonTreasure",
        eggRewardRouter,
      ));


      if (!alreadyReceived && rewardKey !== undefined && loot.length > 0) {
        quests.markBattleRewardReceived(rewardKey);
      }
      events.push({ type: "dungeon.treasureClaimed", treasureId: command.treasureId });
    } else if (command.type === "dungeon.claimCatchReward") {
      if (eggRewardRouter !== undefined && run.definition.catchQuest !== undefined) {
        validateEggTreasureData(
          run.definition.catchQuest.treasureData,
          `${run.definition.instanceName}.catchQuest.treasureData`,
          this.options.data,
        );
      }
      const loot = run.claimCatchQuestReward();
      if (loot.length === 0) {
        throw new GameServiceError("ACTION_NOT_ALLOWED", "dungeon catch reward is unavailable");
      }
      ({ nextMonsterSequence, pendingEgg } = this.applyDungeonLoot(
        party,
        profile,
        loot,
        nextMonsterSequence,
        events,
        "dungeonCatch",
        eggRewardRouter,
      ));
      profile.completeCatchQuest(run.definition.instanceName);
      events.push({
        type: "dungeon.catchRewardClaimed",
        dungeonId: run.session.snapshot().definitionId,
      });
    }
    const dungeon = this.dungeonState(run, prior.dungeon.worldId, prior.dungeon.entrancePoiId);
    const state: OfficialGameStateV1 = {
      ...this.snapshot(
        prior,
        party,
        profile,
        quests,
        this.dungeonLocation(run),
        prior.world,
        undefined,
        dungeon,
      ),
      nextMonsterSequence,
    };
    return {
      state,
      projection: this.project(state, party, profile, quests),
      events,
      ...(pendingEgg === undefined ? {} : { pendingEgg }),
    };
  }

  private applyBattle(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    command: Extract<GameCommandV1, { type: `battle.${string}` }>,
    now: string,
    eggRewardRouter?: OfficialEggRewardRouter,
    deferDefeat = false,
    deferDefeatConsequences = false,
    deferDungeonTreasureRewards = false,
    chargeBattleSpiritEnergy = false,
    sourceDungeonPopulationInheritance = false,
    sourceTownBattleLifecycle = false,
    allowTournamentRetreat = false,
    allowArenaEscapeStall = false,
  ): OfficialInternalReductionResult {
    if (prior.location.kind !== "battle" || prior.battle === undefined || prior.world === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `${command.type} requires an active battle`);
    }
    const battle = prior.battle;
    if ("battleId" in command && command.battleId !== battle.battleId) {
      throw new GameServiceError("ENTITY_NOT_FOUND", `battle ${command.battleId} is not active`);
    }
    const current = restoreBattleReplay(this.options.data, battle.replay);
    if (current.step.type !== "awaitingPlayer") {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `battle is ${current.step.type}`);
    }
    if ("actorId" in command && command.actorId !== current.step.actorId) {
      throw new GameServiceError("DECISION_STALE", `actor ${command.actorId} is no longer pending`);
    }
    // `canRetreat` in the public decision keeps the ordinary client honest, but it is not an
    // admission boundary. Reject a forged retreat intent before advancing the replay so an Arena
    // or Tournament request cannot consume a retreat roll or a player turn.
    if (command.type === "battle.retreat" && !battle.encounter.allowRetreat) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "retreat is not allowed for this battle");
    }
    if (current.session.silver !== profile.snapshot().silver) {
      throw new GameServiceError(
        "STATE_CORRUPT",
        `battle wallet ${current.session.silver} != profile wallet ${profile.snapshot().silver}`,
      );
    }
    if (eggRewardRouter !== undefined) {
      validateOfficialEggRewardBatchShape(battle.encounter.rewards);
    }

    let replayCommand: BattleReplayCommandV1;
    const beforeInventory = profile.snapshot();
    if (command.type === "battle.chooseAbility") {
      replayCommand = {
        type: "ability",
        actorId: command.actorId,
        slot: command.slot,
        targetIds: [...command.targetIds],
      };
    } else if (command.type === "battle.attemptCapture") {
      if (current.session.captureStatusOf(command.targetId) !== "available") {
        throw new GameServiceError("ACTION_NOT_ALLOWED", "capture target is not available");
      }
      const partyLevel = profile.capturePartyLevel();
      if (current.session.captureChanceOf(command.targetId, command.cardLevel, partyLevel) <= 0) {
        throw new GameServiceError("ACTION_NOT_ALLOWED", "capture chance is zero");
      }
      const spent = profile.spendCaptureCard(command.cardLevel);
      if (!spent.ok) {
        throw new GameServiceError("INSUFFICIENT_FUNDS", "cannot afford this capture card");
      }
      const afterSpend = profile.snapshot();
      const silverDebit = beforeInventory.silver - afterSpend.silver;
      replayCommand = {
        type: "capture",
        actorId: command.actorId,
        targetId: command.targetId,
        cardLevel: command.cardLevel,
        partyLevel,
        ...(silverDebit === 0 ? {} : { externalSilverDebit: silverDebit }),
      };
    } else if (command.type === "battle.delay") {
      replayCommand = { type: "delay", actorId: command.actorId };
    } else if (command.type === "battle.retreat") {
      replayCommand = { type: "retreat", actorId: command.actorId };
    } else if (command.type === "battle.summonSpirit") {
      const savedXp = profile.spiritSavedXp(command.shortType);
      replayCommand = {
        type: "summonSpirit",
        actorId: current.step.actorId,
        shortType: command.shortType,
        savedXp,
      };
    } else throw new GameServiceError("CAPABILITY_UNSUPPORTED", "battle command is not supported");

    const priorEventCount = current.events.length;
    const advanced = advanceBattleReplay(
      this.options.data,
      battle.replay,
      replayCommand,
      this.random,
    );
    if (command.type === "battle.summonSpirit") profile.useSpirit(command.shortType);
    const newEngineEvents = advanced.restored.events.slice(priorEventCount);
    if (chargeBattleSpiritEnergy) {
      applyCommittedBattleSpiritEnergy(profile, advanced.restored, newEngineEvents);
    }
    for (const event of newEngineEvents) {
      if (event.type !== "silverSpent") continue;
      if (!profile.spendSilver(event.amount)) {
        throw new GameServiceError("STATE_CORRUPT", "battle spent unavailable profile silver");
      }
    }
    const events: UnsequencedPresentationEventV1[] = [{
      type: "battle.replayAdvanced",
      battleId: battle.battleId,
      commandCount: advanced.snapshot.commands.length,
      committedDrawCount: advanced.committedDraws.length,
      randomDraws: [...advanced.committedDraws],
    }];
    appendCommonBattleEvents(events, battle.battleId, newEngineEvents);
    // v25 counts each committed enemy death now, whatever the battle's eventual outcome.
    this.fireEnemyDeathQuestEvents(events, quests, advanced.restored, newEngineEvents);

    const nextBattle: OfficialBattleStateV1 = {
      ...battle,
      replay: advanced.snapshot,
    };
    if (advanced.restored.step.type === "awaitingPlayer") {
      const state = this.snapshot(
        prior,
        party,
        profile,
        quests,
        prior.location,
        prior.world,
        nextBattle,
      );
      return {
        state,
        projection: this.project(state, party, profile, quests, advanced.restored),
        events: appendWalletEvents(events, beforeInventory, profile.snapshot()),
      };
    }
    return this.settleBattle(
      prior,
      nextBattle,
      advanced.restored,
      party,
      profile,
      quests,
      now,
      appendWalletEvents(events, beforeInventory, profile.snapshot()),
      eggRewardRouter,
      deferDefeat,
      deferDefeatConsequences,
      deferDungeonTreasureRewards,
      sourceDungeonPopulationInheritance,
      sourceTownBattleLifecycle,
      allowTournamentRetreat,
      allowArenaEscapeStall,
    );
  }

  private settleBattle(
    prior: OfficialGameStateV1,
    battle: OfficialBattleStateV1,
    restored: RestoredBattleReplay,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    now: string,
    initialEvents: UnsequencedPresentationEventV1[],
    eggRewardRouter?: OfficialEggRewardRouter,
    deferDefeat = false,
    deferDefeatConsequences = false,
    deferDungeonTreasureRewards = false,
    sourceDungeonPopulationInheritance = false,
    sourceTownBattleLifecycle = false,
    allowTournamentRetreat = false,
    allowArenaEscapeStall = false,
  ): OfficialInternalReductionResult {
    const events = [...initialEvents];
    if (restored.step.type === "awaitingPlayer" || restored.step.type === "awaitingEnemy") {
      throw new GameServiceError("STATE_CORRUPT", "cannot settle a nonterminal battle");
    }
    const outcome = restored.step.type === "retreated"
      ? "retreat" as const
      : restored.step.report.winner === 0
        ? "victory" as const
        : restored.step.report.winner === 1
          ? "defeat" as const
          : "draw" as const;
    if (outcome === "draw") {
      throw new GameServiceError("STATE_CORRUPT", "official DIB battle cannot settle a draw");
    }
    const preserveArenaCheckpoint =
      outcome === "retreat" && battle.origin.kind === "arena" && allowArenaEscapeStall;
    if (!preserveArenaCheckpoint) {
      party.commitBattleSnapshot(restored.session.playerTerminalSnapshot());
    }
    events.push({ type: "battle.ended", battleId: battle.battleId, outcome });

    let nextMonsterSequence = prior.nextMonsterSequence;
    let pendingEgg = prior.pendingEgg;
    let pendingContinuation: OfficialEggContinuation | undefined;
    let world = prior.world!;
    let location: OfficialLocationV1;
    if (outcome === "victory") {
      // Historical reducers count enemy deaths only here, at victory. v25 already fired them as
      // each death was committed (`fireEnemyDeathQuestEvents`), so it must not count them twice.
      for (const id of this.sourceStoryRulesForCurrentReduction ? [] : restored.session.deadIdsOf(1)) {
        appendGuildQuestEvents(events, quests, () => quests.fireEvent({
          id: 0,
          target: {
            shortType: restored.session.xpStateOf(id).shortType,
            inEnemyDeadMembers: true,
          },
        }));
      }
      const xp = restored.session.postBattleXpSummary(battle.encounter.breederXpBonus);
      for (const id of xp.awardedIds) {
        const sourceInstanceId = restored.session.sourceInstanceIdOf(id);
        if (sourceInstanceId === undefined) continue;
        const before = party.monster(sourceInstanceId);
        const beforeLevel = before.level;
        const awarded = party.awardXp(sourceInstanceId, xp.amount);
        const after = party.monster(sourceInstanceId);
        profile.recordCapturedMonster(after.shortType, awarded.level);
        events.push({
          type: "player.xpAwarded",
          instanceId: sourceInstanceId,
          amount: xp.amount,
          levelBefore: beforeLevel,
          levelAfter: awarded.level,
        });
      }
      for (let guard = 0; guard < 1_000; guard += 1) {
        const candidate = party.battingOrderMonsters().find((monster) => {
          const evolution = this.options.data.monsterByShortType(monster.shortType).evolveData;
          return evolution !== undefined && monster.level >= evolution.levelReq;
        });
        if (candidate === undefined) break;
        const beforeType = candidate.shortType;
        appendGuildQuestEvents(
          events,
          quests,
          () => quests.fireEvent({ id: 6, monsterShortType: beforeType }),
        );
        const evolved = party.evolve(candidate.instanceId);
        profile.recordCapturedMonster(evolved.shortType, evolved.level);
        events.push({
          type: "player.evolved",
          instanceId: evolved.instanceId,
          fromTypeId: beforeType,
          toTypeId: evolved.shortType,
          level: evolved.level,
        });
        if (guard === 999) throw new Error("official automatic evolution guard exceeded");
      }
      const capturedIds = restored.session.capturedIds();
      reserveOfficialMonsterSequence(nextMonsterSequence, capturedIds.length, "battle capture");
      for (const id of capturedIds) {
        const historicalCapture = restored.session.xpStateOf(id);
        // Migrated in-flight replays keep their committed levels/RNG. Apply the constructor
        // bound only to the new durable award, so an old >150 capture cannot strand the slot.
        const captured = this.sourceJobLevelsForCurrentReduction
          ? { ...historicalCapture, level: jobCreationLevel(historicalCapture.level) }
          : historicalCapture;
        const allocated = allocateOfficialMonsterSequence(nextMonsterSequence, "battle capture");
        nextMonsterSequence = allocated.nextSequence;
        const instanceId = allocated.instanceId;
        party.addCapturedMonster({
          instanceId,
          shortType: captured.shortType,
          level: captured.level,
        });
        profile.recordCapturedMonster(captured.shortType, captured.level);
        appendGuildQuestEvents(
          events,
          quests,
          () => quests.fireEvent({ id: 7, monsterShortType: captured.shortType }),
        );
        events.push({
          type: "player.monsterAdded",
          instanceId,
          monsterTypeId: captured.shortType,
          level: captured.level,
          reason: "capture",
        });
      }
      const sourceEncounter = battle.encounter.kind === "dungeon"
        ? battle.encounter.encounter
        : battle.encounter.generated;
      const rewardKey = sourceEncounter.battleRewardKey ?? sourceEncounter.questKey;
      const shouldAward = rewardKey === undefined || !quests.hasReceivedBattleReward(rewardKey);
      // Starting with v16, dungeon encounter treasure remains room-owned after victory. Native
      // returns to the room, opens LootPageProvider, and transfers/marks the reward only when Take
      // All invokes the treasure owner. Historical versions retain their frozen terminal behavior.
      const rewardItems = shouldAward &&
          (!deferDungeonTreasureRewards || battle.encounter.kind !== "dungeon")
        ? battle.encounter.rewards
        : [];
      validateOfficialEggRewardBatchShape(rewardItems);
      const routed = eggRewardRouter?.split(rewardItems, "battle", 1);
      pendingContinuation = routed?.pendingEgg;
      const eggRewards = eggRewardRouter === undefined
        ? rewardItems.filter((reward) => reward.kind === "egg" || reward.kind === "monsterEgg")
        : [];
      if (eggRewardRouter === undefined &&
        (eggRewards.length > 1 || (pendingEgg !== undefined && eggRewards.length > 0))) {
        throw new GameServiceError(
          "STATE_CORRUPT",
          "official reward batch contains overlapping Egg settlements",
        );
      }
      if (eggRewardRouter === undefined && eggRewards[0] !== undefined) {
        pendingEgg = {
          schemaVersion: 1,
          kind: eggRewards[0].kind === "egg" ? "silver" : "gold",
        };
      }
      const immediateRewards = routed?.immediate ?? rewardItems.filter(
        (reward) => reward.kind !== "egg" && reward.kind !== "monsterEgg",
      );
      reserveOfficialMonsterSequence(
        nextMonsterSequence,
        monsterJoinRewardCount(immediateRewards),
        "battle reward",
      );
      const rewardResults = applyPlayerRewards(profile, immediateRewards, {
        addMonsterJoin: (shortType, jobLevel) => {
          const allocated = allocateOfficialMonsterSequence(nextMonsterSequence, "battle reward");
          nextMonsterSequence = allocated.nextSequence;
          const instanceId = allocated.instanceId;
          party.addCapturedMonster({ instanceId, shortType, level: jobLevel });
          profile.recordCapturedMonster(shortType, jobLevel);
          return { instanceId };
        },
      });




      if (rewardKey !== undefined && rewardItems.length > 0) {
        quests.markBattleRewardReceived(rewardKey);
      }
      if (rewardItems.length > 0) {
        events.push({
          type: "battle.rewardsGranted",
          battleId: battle.battleId,
          rewards: rewardItems.map((reward) =>
            reward.kind === "gem"
              ? { ...reward, enabledStats: [...reward.enabledStats] }
              : { ...reward }),
        });
      }
      for (const reward of rewardResults) {
        if (reward.kind === "silver" || reward.kind === "gold") {
          events.push({
            type: "player.currencyChanged",
            currency: reward.kind,
            delta: reward.amount,
            balance: reward.balance,
          });
        } else if (reward.kind === "monsterJoin") {
          events.push({
            type: "player.monsterAdded",
            instanceId: reward.instanceId,
            monsterTypeId: reward.shortType,
            level: reward.jobLevel,
            reason: "reward",
          });
        }
      }
      appendGuildQuestEvents(events, quests, () => quests.recordBattleWin({
        id: 9,
        battle: {
          ...(sourceEncounter.questKey === undefined
            ? {}
            : { questKey: sourceEncounter.questKey }),
          ...(sourceEncounter.completionKey === undefined
            ? {}
            : { uniqueKey: sourceEncounter.completionKey }),
          friendlyTeamCount: restored.session.activeIdsOf(0).length,
          battingOrderSize: party.battingOrderSize,
          difficultyModifier: 0,
        },
      }));
      if (battle.encounter.kind === "world" && battle.origin.kind === "world") {
        const origin = battle.origin;
        const trip = restoreOfficialWorldTrip({
          data: this.options.data,
          world: this.world(world.worldId),
          state: world,
          rng: replayableRng([], this.random),
          hasCompletedFixedEncounter: (key) => quests.hasCompletedFixedEncounter(key),
          canUseQuestKey: (key) => quests.canUseQuestKey(key),


          onQuestEvent: (event) => {
            appendGuildQuestEvents(events, quests, () => quests.fireEvent(event));
          },
        });
        trip.trip.recordEncounterWin(origin.poiId);
        if (battle.encounter.generated.winEvent !== undefined) {
          const chat = battle.encounter.generated.winEvent.chat;
          quests.requestChatPresentation(chat.name, chat.alwaysShow);
        }
        world = snapshotOfficialWorldState(
          world.worldId,
          origin.poiId,
          world.lastTownId,
          trip.shared,
          world.visitedTownIds,
        );
        const originPoi = this.world(world.worldId).pointsOfInterest.find(
          ({ name }) => name === origin.poiId,
        );
        if (sourceTownBattleLifecycle && originPoi?.town !== undefined) {
          const townReturn = this.completeOriginTownBattleReturn(
            world,
            origin.poiId,
            party,
            profile,
            quests,
            now,
            events,
          );
          world = townReturn.world;
          location = townReturn.location;
        } else {
          location = { kind: "world", worldId: world.worldId, poiId: origin.poiId };
        }
      } else if (
        battle.encounter.kind === "dungeon" &&
        battle.origin.kind === "dungeon" &&
        prior.dungeon !== undefined
      ) {
        const run = this.restoreDungeon(
          prior.dungeon,
          profile,
          quests,
          events,
          sourceDungeonPopulationInheritance,
        );
        const flow = dungeonTerminalFlowIdentity(run.route, battle.battleId);
        const survivingMonsters = deriveOfficialDungeonTerminalSurvivors(
          battle.encounter.encounter,
          battle.replay.teams[1],
          restored,
        );
        run.synchronizeEncounterRoomRoster(battle.encounter.encounter, flow, survivingMonsters);
        run.resolveEncounter(
          battle.encounter.encounter,
          "victory",
          restored.session.capturedIds().map((id) => restored.session.xpStateOf(id).shortType),
        );


        if (this.sourceStoryRulesForCurrentReduction) {
          this.recordEncounterChat(
            quests,
            dungeonEncounterChatKey(battle.encounter.encounter.winEvent, battle.encounter.encounter.id),
          );
        }
        location = this.dungeonLocation(run);
        prior = {
          ...prior,
          dungeon: this.dungeonState(run, prior.dungeon.worldId, prior.dungeon.entrancePoiId),
        };
      } else if (
        battle.encounter.kind === "arena" &&
        battle.origin.kind === "arena"
      ) {
        profile.increaseLicenseAfterChallenge(
          this.options.data.license(battle.origin.licenseType),
        );
        // v25: ArenaEncounter does not override `performWinLogic`, so the license winEvent chat
        // (Apprentice `HaraldDefeated`) is recorded exactly like a world win chat.
        if (this.sourceStoryRulesForCurrentReduction) {
          this.recordEncounterChat(
            quests,
            buildLicenseChallengeEncounter(
              this.options.data.license(battle.origin.licenseType),
            ).winChatKey,
          );
        }


        location = {
          kind: "world",
          worldId: battle.origin.worldId,
          poiId: battle.origin.townId,
        };
      } else if (
        battle.encounter.kind === "tournament" &&
        battle.origin.kind === "tournament"
      ) {
        profile.tournament.settleBattle("victory");
        events.push({
          type: "tournament.progressed",
          tournamentIndex: battle.origin.tournamentIndex,
          round: profile.tournament.round,
          status: profile.tournament.status,
        });



        location = rewardItems.length > 0
          ? {
              kind: "world",
              worldId: battle.origin.worldId,
              poiId: battle.origin.townId,
            }
          : {
              kind: "town",
              worldId: battle.origin.worldId,
              townId: battle.origin.townId,
            };
      } else {
        throw new GameServiceError("STATE_CORRUPT", "battle source and origin disagree");
      }
    } else if (outcome === "defeat") {
      if (!deferDefeatConsequences) {
        prior = this.applyDeferredDefeatConsequencesForContinuation(
          prior,
          battle,
          restored,
          profile,
          quests,
          events,
          sourceDungeonPopulationInheritance,
        );
      }
      if (deferDefeat) {
        location = prior.location;
      } else {
        const recovery = this.completeDefeatReturn(
          prior,
          party,
          profile,
          quests,
          world,
          now,
          events,
        );
        world = recovery.world;
        location = recovery.location;
      }
    } else {
      if (battle.origin.kind === "world") {
        const origin = battle.origin;
        const originPoi = this.world(origin.worldId).pointsOfInterest.find(
          ({ name }) => name === origin.poiId,
        );
        if (sourceTownBattleLifecycle && originPoi?.town !== undefined) {
          const townReturn = this.completeOriginTownBattleReturn(
            world,
            origin.poiId,
            party,
            profile,
            quests,
            now,
            events,
          );
          world = townReturn.world;
          location = townReturn.location;
        } else {
          location = {
            kind: "world",
            worldId: origin.worldId,
            poiId: origin.poiId,
          };
        }
      } else if (prior.dungeon !== undefined && battle.encounter.kind === "dungeon") {
        if (battle.origin.kind !== "dungeon") {
          throw new GameServiceError("STATE_CORRUPT", "dungeon retreat has a non-dungeon origin");
        }
        const run = this.restoreDungeon(
          prior.dungeon,
          profile,
          quests,
          events,
          sourceDungeonPopulationInheritance,
        );
        const flow = dungeonTerminalFlowIdentity(run.route, battle.battleId);
        const survivingMonsters = deriveOfficialDungeonTerminalSurvivors(
          battle.encounter.encounter,
          battle.replay.teams[1],
          restored,
        );
        run.synchronizeEncounterRoomRoster(battle.encounter.encounter, flow, survivingMonsters);
        run.resolveEncounter(battle.encounter.encounter, "retreat");
        location = this.dungeonLocation(run);
        prior = {
          ...prior,
          dungeon: this.dungeonState(run, prior.dungeon.worldId, prior.dungeon.entrancePoiId),
        };
      } else if (battle.origin.kind === "arena") {
        if (!allowArenaEscapeStall) {
          throw new GameServiceError("STATE_CORRUPT", "Arena battle cannot retreat");
        }





        location = {
          kind: "town",
          worldId: battle.origin.worldId,
          townId: battle.origin.townId,
        };
      } else if (battle.origin.kind === "tournament") {
        if (!allowTournamentRetreat) {
          throw new GameServiceError("STATE_CORRUPT", "Tournament battle cannot retreat");
        }
        // Utility.Escape reaches this branch through the replay's `retreated` terminal state. The
        // source `combatRetreatFinished:` destroys the transient monsters, shows TournamentLost,
        // then returns to the saved town without invoking the tournament progress writer.
        if (sourceTownBattleLifecycle) {
          const townReturn = this.completeOriginTownBattleReturn(
            world,
            battle.origin.townId,
            party,
            profile,
            quests,
            now,
            events,
          );
          world = townReturn.world;
          location = townReturn.location;
        } else {
          location = {
            kind: "town",
            worldId: battle.origin.worldId,
            townId: battle.origin.townId,
          };
        }
      } else {
        throw new GameServiceError("STATE_CORRUPT", "dungeon retreat is missing its run");
      }
    }
    const state: OfficialGameStateV1 = {
      ...this.snapshot(
        prior,
        party,
        profile,
        quests,
        location,
        world,
        outcome === "defeat" && deferDefeat ? battle : undefined,
        outcome === "defeat" && !deferDefeat ? null : prior.dungeon,
      ),
      nextMonsterSequence,
      ...(pendingEgg === undefined ? {} : { pendingEgg }),
    };
    return {
      state,
      projection: this.project(state, party, profile, quests),
      events,
      ...(pendingContinuation === undefined ? {} : { pendingEgg: pendingContinuation }),
    };
  }

  /**
   * Apply the run/bracket consequences of an already-terminal defeat. v12 calls this while the
   * battle command settles, preserving its historical bytes. v14 deliberately calls it later from
   * `battle.resolveDefeat { recovery: "return" }`, because Save Me restarts the encounter and must
   * leave both the dungeon attempt and Tournament round untouched.
   */
  applyDeferredDefeatConsequencesForContinuation(
    prior: OfficialGameStateV1,
    battle: OfficialBattleStateV1,
    restored: RestoredBattleReplay,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    events: UnsequencedPresentationEventV1[],
    sourceDungeonPopulationInheritance = false,
  ): OfficialGameStateV1 {
    let next = prior;
    if (battle.encounter.kind === "dungeon") {
      if (battle.origin.kind !== "dungeon" || prior.dungeon === undefined) {
        throw new GameServiceError("STATE_CORRUPT", "dungeon defeat is missing its run");
      }
      const run = this.restoreDungeon(
        prior.dungeon,
        profile,
        quests,
        events,
        sourceDungeonPopulationInheritance,
      );
      const flow = dungeonTerminalFlowIdentity(run.route, battle.battleId);
      const survivingMonsters = deriveOfficialDungeonTerminalSurvivors(
        battle.encounter.encounter,
        battle.replay.teams[1],
        restored,
      );
      run.synchronizeEncounterRoomRoster(battle.encounter.encounter, flow, survivingMonsters);
      run.resolveEncounter(battle.encounter.encounter, "defeat", []);
      next = {
        ...next,
        dungeon: this.dungeonState(run, prior.dungeon.worldId, prior.dungeon.entrancePoiId),
      };
    }
    if (battle.origin.kind === "tournament") {
      profile.tournament.settleBattle("defeat");
      events.push({
        type: "tournament.progressed",
        tournamentIndex: battle.origin.tournamentIndex,
        round: profile.tournament.round,
        status: profile.tournament.status,
      });
    }
    return next;
  }

  /** Complete WorldEncounter's source auto-entry when victory/retreat returns on a town POI. */
  completeOriginTownBattleReturn(
    world: OfficialWorldStateV1,
    townId: string,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    now: string,
    events: UnsequencedPresentationEventV1[],
  ): {
    readonly world: OfficialWorldStateV1;
    readonly location: OfficialLocationV1;
  } {
    const destination = this.town(townId);
    if (destination.world.name !== world.worldId || world.currentPoiId !== townId) {
      throw new GameServiceError(
        "STATE_CORRUPT",
        `town-origin battle return ${world.worldId}.${world.currentPoiId} != ${destination.world.name}.${townId}`,
      );
    }
    const pendingPoiQuestEvents: GuildQuestEvent[] = [];
    const restored = restoreOfficialWorldTrip({
      data: this.options.data,
      world: destination.world,
      state: world,
      rng: replayableRng([]),
      hasCompletedFixedEncounter: (key) => quests.hasCompletedFixedEncounter(key),
      canUseQuestKey: (key) => quests.canUseQuestKey(key),
      onQuestEvent: (event) => { pendingPoiQuestEvents.push(event); },
    });
    const nowSeconds = Date.parse(now) / 1_000;
    if (!Number.isFinite(nowSeconds)) {
      throw new GameServiceError("STATE_CORRUPT", "town-origin battle return has an invalid commit time");
    }
    party.restoreAtTown(nowSeconds);
    profile.resetSpiritsForTownReturn();
    restored.trip.refreshAtTown();
    advanceWorldDay(restored.shared);
    for (const event of pendingPoiQuestEvents) {
      appendGuildQuestEvents(events, quests, () => quests.fireEvent(event));
    }
    appendGuildQuestEvents(events, quests, () => quests.enteredTown(townId));
    const nextWorld = snapshotOfficialWorldState(
      destination.world.name,
      townId,
      townId,
      restored.shared,
      [...new Set([...world.visitedTownIds, townId])],
    );
    return {
      world: nextWorld,
      location: { kind: "town", worldId: nextWorld.worldId, townId },
    };
  }

  /** Complete the source town return after a terminal defeat has already been committed. */
  completeDefeatReturn(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    world: OfficialWorldStateV1,
    now: string,
    events: UnsequencedPresentationEventV1[],
    restoreParty = true,
  ): {
    readonly world: OfficialWorldStateV1;
    readonly location: OfficialLocationV1;
  } {
    const nowSeconds = Date.parse(now) / 1_000;
    if (restoreParty) party.restoreAtTown(nowSeconds);
    else party.purgeExpiredInjuries(nowSeconds);
    profile.resetSpiritsForTownReturn();
    const destination = this.town(world.lastTownId);
    const shared = restoreOfficialWorldSharedState(world);
    refreshWorldTripAtTown(shared, world.lastTownId);
    advanceWorldDay(shared);
    appendGuildQuestEvents(events, quests, () => quests.enteredTown(world.lastTownId));
    const nextWorld = snapshotOfficialWorldState(
      destination.world.name,
      world.lastTownId,
      world.lastTownId,
      shared,
      world.visitedTownIds,
    );
    return {
      world: nextWorld,
      location: { kind: "town", worldId: nextWorld.worldId, townId: nextWorld.lastTownId },
    };
  }

  /**
   * Replace a retained terminal loss with a fresh replay of the same authority-owned encounter.
   * The enemy setup is copied from the committed replay (so a Tournament draw is never rerolled),
   * while the player setup comes from the Save-Me-healed durable party. V14+ invokes this seam.
   */
  restartDefeatedBattleForContinuation(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    events: UnsequencedPresentationEventV1[],
    chargeBattleSpiritEnergy: boolean,
    sourceJobLevels = false,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.location.kind !== "battle" || prior.battle === undefined || prior.world === undefined) {
      throw new GameServiceError("STATE_CORRUPT", "Save Me restart requires its retained battle");
    }
    const terminal = restoreBattleReplay(this.options.data, prior.battle.replay);
    if (terminal.step.type !== "ended" || terminal.step.report.winner !== 1) {
      throw new GameServiceError("STATE_CORRUPT", "Save Me restart requires an ended loss battle");
    }
    const restartPrior = restoreDeferredDungeonEncounterForRestart(prior);
    const playerTeam = party.projectAliveBattingPrefix();
    if (playerTeam.length === 0) {
      throw new GameServiceError("STATE_CORRUPT", "Save Me recovery produced no living lineup");
    }
    const battleId = `battle-${prior.nextBattleSequence}`;
    const initialReplay: BattleReplaySnapshotV1 = {
      schemaVersion: 1,
      randomDraws: [],
      teams: officialBattleTeams([playerTeam, prior.battle.replay.teams[1]]),
      options: {
        ...prior.battle.replay.options,
        silver: profile.snapshot().silver,
        ...(sourceJobLevels ? { sourceJobLevels: true } : {}),
      },
      commands: [],
    };
    const first = restoreBattleReplay(this.options.data, initialReplay, {
      randomSource: this.random,
    });
    if (chargeBattleSpiritEnergy) {
      applyCommittedBattleSpiritEnergy(profile, first, first.events);
    }
    const battle: OfficialBattleStateV1 = {
      schemaVersion: 1,
      battleId,
      origin: structuredClone(prior.battle.origin),
      encounter: structuredClone(prior.battle.encounter),
      replay: {
        ...initialReplay,
        randomDraws: first.randomDraws!,
      },
    };
    const state: OfficialGameStateV1 = {
      ...this.snapshot(
        restartPrior,
        party,
        profile,
        quests,
        {
          kind: "battle",
          worldId: prior.location.worldId,
          poiId: prior.location.poiId,
          battleId,
        },
        prior.world,
        battle,
        restartPrior.dungeon,
      ),
      nextBattleSequence: prior.nextBattleSequence + 1,
    };
    events.push({ type: "battle.started", battleId });
    return {
      state,
      projection: this.project(state, party, profile, quests, first),
      events,
    };
  }

  /**
   * Source `Encounter.useSaveMe:` continues through the encounter subclass's retreat callback.
   * World returns to its origin POI; Dungeon synchronizes surviving enemies and returns to the
   * captured previous room. Tournament keeps its separate town-return path in the v12 coordinator,
   * and Arena cannot offer Save Me.
   */
  completeSourceSaveMeReturnForContinuation(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    restoredBattle: RestoredBattleReplay,
    now: string,
    events: UnsequencedPresentationEventV1[],
    sourceDungeonPopulationInheritance: boolean,
    sourceTownBattleLifecycle: boolean,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.location.kind !== "battle" || prior.battle === undefined || prior.world === undefined) {
      throw new GameServiceError("STATE_CORRUPT", "Save Me return requires its retained battle");
    }
    const battle = prior.battle;
    let world = prior.world;
    let dungeon = prior.dungeon;
    let location: OfficialLocationV1;

    if (battle.origin.kind === "world" && battle.encounter.kind === "world") {
      const origin = battle.origin;
      const originPoi = this.world(world.worldId).pointsOfInterest.find(
        ({ name }) => name === origin.poiId,
      );
      if (sourceTownBattleLifecycle && originPoi?.town !== undefined) {
        const returned = this.completeOriginTownBattleReturn(
          world,
          origin.poiId,
          party,
          profile,
          quests,
          now,
          events,
        );
        world = returned.world;
        location = returned.location;
      } else {
        location = {
          kind: "world",
          worldId: origin.worldId,
          poiId: origin.poiId,
        };
      }
    } else if (
      battle.origin.kind === "dungeon" &&
      battle.encounter.kind === "dungeon" &&
      dungeon !== undefined
    ) {
      const run = this.restoreDungeon(
        dungeon,
        profile,
        quests,
        events,
        sourceDungeonPopulationInheritance,
      );
      const flow = dungeonTerminalFlowIdentity(run.route, battle.battleId);
      const survivingMonsters = deriveOfficialDungeonTerminalSurvivors(
        battle.encounter.encounter,
        battle.replay.teams[1],
        restoredBattle,
      );
      run.synchronizeEncounterRoomRoster(battle.encounter.encounter, flow, survivingMonsters);
      run.resolveEncounter(battle.encounter.encounter, "retreat");
      dungeon = this.dungeonState(run, dungeon.worldId, dungeon.entrancePoiId);
      location = this.dungeonLocation(run);
    } else {
      throw new GameServiceError(
        "STATE_CORRUPT",
        "source Save Me return requires a World or Dungeon encounter",
      );
    }

    const state = this.snapshot(
      prior,
      party,
      profile,
      quests,
      location,
      world,
      undefined,
      dungeon,
    );
    return {
      state,
      projection: this.project(state, party, profile, quests),
      events,
    };
  }

  private applyParty(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    command: Extract<GameCommandV1, { type: `party.${string}` }>,
    now: string,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.location.kind === "battle") {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "party editing is unavailable in battle");
    }
    const events: UnsequencedPresentationEventV1[] = [];
    let nextMonsterSequence = prior.nextMonsterSequence;
    switch (command.type) {
      case "party.commitBattingPriority":
        party.commitBattingPriority(command.activeInstanceIds);
        events.push({ type: "party.orderCommitted", activeInstanceIds: [...command.activeInstanceIds] });
        break;
      case "party.combine": {
        if (!profile.hasCombineRecipe(command.resultTypeId)) {
          throw new GameServiceError("ACTION_NOT_ALLOWED", "combine recipe has not been learned");
        }
        const firstType = party.monster(command.firstInstanceId).shortType;
        const secondType = party.monster(command.secondInstanceId).shortType;
        const allocated = allocateOfficialMonsterSequence(nextMonsterSequence, "party combine");
        nextMonsterSequence = allocated.nextSequence;
        const result = party.combineMonsters(
          allocated.instanceId,
          command.resultTypeId,
          command.firstInstanceId,
          command.secondInstanceId,
        );
        profile.recordCapturedMonster(result.monster.shortType, result.monster.level);
        appendGuildQuestEvents(events, quests, () => quests.fireEvent({
          id: 8,
          firstIngredientShortType: firstType,
          secondIngredientShortType: secondType,
        }));
        for (const consumed of result.consumed) {
          events.push({
            type: "player.monsterRemoved",
            instanceId: consumed.instanceId,
            reason: "combine",
          });
        }
        events.push({
          type: "player.monsterAdded",
          instanceId: result.monster.instanceId,
          monsterTypeId: result.monster.shortType,
          level: result.monster.level,
          reason: "combine",
        });
        break;
      }
      case "party.evolve": {
        const before = party.monster(command.instanceId);
        appendGuildQuestEvents(
          events,
          quests,
          () => quests.fireEvent({ id: 6, monsterShortType: before.shortType }),
        );
        const evolved = party.evolve(command.instanceId);
        profile.recordCapturedMonster(evolved.shortType, evolved.level);
        events.push({
          type: "player.evolved",
          instanceId: evolved.instanceId,
          fromTypeId: before.shortType,
          toTypeId: evolved.shortType,
          level: evolved.level,
        });
        break;
      }
      case "party.healInjury": {
        const cost = party.injuryHealCost(command.instanceId, Date.parse(now) / 1_000);
        if (!profile.spendGold(cost)) {
          throw new GameServiceError("INSUFFICIENT_FUNDS", "not enough gold to heal injury");
        }
        party.healInjury(command.instanceId);
        events.push(
          { type: "player.currencyChanged", currency: "gold", delta: -cost, balance: profile.snapshot().gold },
          { type: "party.injuryHealed", instanceId: command.instanceId, goldCost: cost },
        );
        break;
      }
      case "party.destroyMonster": {
        const removed = party.destroyMonster(command.instanceId);
        events.push({ type: "player.monsterRemoved", instanceId: removed.instanceId, reason: "destroy" });
        break;
      }
      case "party.convertToSoulStone": {
        const removed = party.monster(command.instanceId);
        const stone = party.convertToSoulStone(command.instanceId);
        appendGuildQuestEvents(events, quests, () => quests.fireEvent({ id: 3 }));
        const entry = party.ownedSoulStoneEntries().at(-1);
        if (entry === undefined) throw new Error("soul-stone conversion produced no item");
        events.push(
          { type: "player.monsterRemoved", instanceId: removed.instanceId, reason: "soulStone" },
          {
            type: "party.soulStoneAdded",
            stoneId: entry.token,
            element: stone.element,
            level: stone.level,
            ...(stone.sourceType === undefined ? {} : { sourceTypeId: stone.sourceType }),
          },
        );
        break;
      }
      case "party.insertSoulStone":
        party.insertSoulStoneByToken(command.instanceId, command.stoneId);
        events.push({
          type: "party.soulStoneEquipped",
          stoneId: command.stoneId,
          instanceId: command.instanceId,
        });
        break;
    }
    const state: OfficialGameStateV1 = {
      ...this.snapshot(prior, party, profile, quests, prior.location, prior.world, prior.battle),
      nextMonsterSequence,
    };
    return { state, projection: this.project(state, party, profile, quests), events };
  }

  private applyQuest(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    command: Extract<GameCommandV1, { type: "quest.accept" | "quest.claim" | "quest.dropAll" }>,
    eggRewardRouter?: OfficialEggRewardRouter,
  ): OfficialInternalReductionResult {
    if (prior.location.kind !== "town") {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `${command.type} requires a town`);
    }
    if (!townGuildAvailable(this.world(prior.location.worldId), prior.location.townId, quests)) {
      throw new GameServiceError(
        "ACTION_NOT_ALLOWED",
        `Guild quests are unavailable in ${prior.location.townId}`,
      );
    }
    const events: UnsequencedPresentationEventV1[] = [];
    let nextMonsterSequence = prior.nextMonsterSequence;
    let pendingEgg: OfficialEggContinuation | undefined;
    if (command.type === "quest.accept") {
      const first = quests.firstAvailableQuestInTown(prior.location.townId);
      if (first?.name !== command.questId || !quests.startQuest(command.questId)) {
        throw new GameServiceError(
          "ACTION_NOT_ALLOWED",
          `quest ${command.questId} is not the next available town quest`,
        );
      }
      events.push({ type: "quest.accepted", questId: command.questId });
    } else if (command.type === "quest.dropAll") {




      if (quests.activeQuestNames().length === 0 && !this.sourceStoryRulesForCurrentReduction) {
        throw new GameServiceError("ACTION_NOT_ALLOWED", "there are no active quests to drop");
      }
      quests.clearAllQuests();
      events.push({ type: "quest.droppedAll" });
    } else {
      const first = quests.completedActiveQuestNames()[0];
      if (first !== command.questId) {
        throw new GameServiceError(
          "ACTION_NOT_ALLOWED",
          `quest ${command.questId} is not the next completed quest`,
        );
      }
      if (eggRewardRouter === undefined && !quests.completeQuest(command.questId)) {
        throw new GameServiceError(
          "ACTION_NOT_ALLOWED",
          `quest ${command.questId} is not the next completed quest`,
        );
      }
      const definition = this.options.quests.requireQuest(command.questId);
      if (eggRewardRouter !== undefined) {
        validateEggTreasureData(
          parseDungeonTreasureData(
            definition.treasureData,
            `Quests.plist.${definition.name}.treasureData`,
            1,
          ),
          `Quests.plist.${definition.name}.treasureData`,
          this.options.data,
        );
      }
      const rng = replayableRng([], this.random);
      const rewards = generateQuestRewards(
        parseDungeonTreasureData(
          definition.treasureData,
          `Quests.plist.${definition.name}.treasureData`,
          1,
        ),
        definition.challengeLevel,
        rng,
      );
      validateOfficialEggRewardBatchShape(rewards);
      const routed = eggRewardRouter?.split(rewards, "quest", 1);
      pendingEgg = routed?.pendingEgg;
      if (eggRewardRouter === undefined && rewards.some((reward) =>
        reward.kind === "egg" || reward.kind === "monsterEgg")) {
        throw new GameServiceError(
          "ACTION_NOT_ALLOWED",
          "quest reward requires authoritative egg hatch commands that are not enabled",
        );
      }
      if (eggRewardRouter !== undefined && !quests.completeQuest(command.questId)) {
        throw new GameServiceError(
          "STATE_CORRUPT",
          `quest ${command.questId} could not be completed after reward generation`,
        );
      }
      const immediateRewards = routed?.immediate ?? rewards;
      reserveOfficialMonsterSequence(
        nextMonsterSequence,
        monsterJoinRewardCount(immediateRewards),
        "quest reward",
      );
      const applied = applyPlayerRewards(profile, immediateRewards, {
        addMonsterJoin: (shortType, jobLevel) => {
          const allocated = allocateOfficialMonsterSequence(nextMonsterSequence, "quest reward");
          nextMonsterSequence = allocated.nextSequence;
          const instanceId = allocated.instanceId;
          party.addCapturedMonster({ instanceId, shortType, level: jobLevel });
          profile.recordCapturedMonster(shortType, jobLevel);
          return { instanceId };
        },
      });
      for (const result of applied) {
        if (result.kind === "silver" || result.kind === "gold") {
          events.push({
            type: "player.currencyChanged",
            currency: result.kind,
            delta: result.amount,
            balance: result.balance,
          });
        } else if (result.kind === "monsterJoin") {
          events.push({
            type: "player.monsterAdded",
            instanceId: result.instanceId,
            monsterTypeId: result.shortType,
            level: result.jobLevel,
            reason: "reward",
          });
        }
      }
      events.push({
        type: "quest.rewardClaimed",
        questId: command.questId,
        rewards: rewards.map((reward) =>
          reward.kind === "gem"
            ? { ...reward, enabledStats: [...reward.enabledStats] }
            : { ...reward }),
        randomDraws: [...rng.draws],
      });
    }
    const state: OfficialGameStateV1 = {
      ...this.snapshot(prior, party, profile, quests, prior.location, prior.world, prior.battle),
      nextMonsterSequence,
    };
    return {
      state,
      projection: this.project(state, party, profile, quests),
      events,
      ...(pendingEgg === undefined ? {} : { pendingEgg }),
    };
  }

  private world(worldId: string): WorldData {
    const world = normalizedWorlds(this.options.world, this.options.worlds)
      .find(({ name }) => name === worldId);
    if (world === undefined) {
      throw new GameServiceError("ENTITY_NOT_FOUND", `world ${worldId} is not installed`);
    }
    return world;
  }

  private town(townId: string): { readonly world: WorldData; readonly poi: WorldPointOfInterest } {
    for (const world of normalizedWorlds(this.options.world, this.options.worlds)) {
      const poi = world.pointsOfInterest.find(
        (candidate) => candidate.name === townId && candidate.town !== undefined,
      );
      if (poi !== undefined) return { world, poi };
    }
    throw new Error(`saved town ${townId} is not installed`);
  }

  private townPortalDestinations(): readonly TownPortalDestination[] {
    if (this.options.resources === undefined) {
      throw new Error("official TownWarp resources are not installed");
    }
    return loadTownPortalDestinations(this.options.resources);
  }

  private townPortalConditionContext(
    world: OfficialWorldStateV1,
    quests: GuildQuestRuntime,
  ): SourceConditionContext {
    const completedPois = new Set(world.everCompletedPoiIds);
    return {
      hasSeenChat: (name) => quests.hasSeenDialog(name),
      hasCompletedBattle: (name) => quests.hasCompletedFixedEncounter(name),
      hasCompletedQuest: (name) => quests.hasFinishedQuest(name),
      canUseQuest: (name) => quests.canUseQuestKey(name),
      hasCompletedPoi: (name) => completedPois.has(name),
      goldPurchased: 0,
    };
  }

  private withMigratedTownVisits(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    const migrated = structuredClone(value) as {
      world?: {
        lastTownId?: unknown;
        everCompletedPoiIds?: unknown;
        visitedTownIds?: unknown;
      };
    };
    const world = migrated.world;
    if (world === undefined || world.visitedTownIds !== undefined) return migrated;
    const knownTowns = new Set(normalizedWorlds(this.options.world, this.options.worlds).flatMap(
      (candidate) => candidate.pointsOfInterest
        .filter(({ town }) => town !== undefined)
        .map(({ name }) => name),
    ));
    const visits = new Set<string>();
    if (Array.isArray(world.everCompletedPoiIds)) {
      for (const name of world.everCompletedPoiIds) {
        if (typeof name === "string" && knownTowns.has(name)) visits.add(name);
      }
    }
    if (typeof world.lastTownId === "string" && knownTowns.has(world.lastTownId)) {
      visits.add(world.lastTownId);
    }
    world.visitedTownIds = [...visits].sort();
    return migrated;
  }

  private dungeonContext(
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    runSeed?: number,
    events?: UnsequencedPresentationEventV1[],
    sourceDungeonPopulationInheritance?: boolean,
  ) {
    const resources = this.options.resources;
    if (resources === undefined) throw new Error("official dungeon resources are not installed");
    const useSourcePopulationInheritance = sourceDungeonPopulationInheritance ??
      this.sourceDungeonPopulationInheritanceForCurrentReduction;
    return {
      resources,
      monsterTypes: this.options.data.allMonsters().map(({ shortType }) => shortType),
      // v1..v22 are immutable. Source-correct topology/weighted-choice semantics require a new
      // simulation version rather than silently changing future floors in already-pinned slots.
      legacyDungeonGenerationSemantics: true,
      ...(useSourcePopulationInheritance
        ? {}
        : { legacyWholeRowPopulationSelection: true }),
      isCompletionSet: (key: string) => quests.hasCompletedFixedEncounter(key),
      isQuestUsable: (key: string) => quests.canUseQuestKey(key),
      isMonsterRegistered: (shortType: string) => profile.highestRegisteredLevel(shortType) > 0,
      isCatchQuestDone: (instanceName: string) => profile.hasCompletedCatchQuest(instanceName),
      waypointFloorsForDungeon: (instanceName: string) =>
        profile.dungeonWaypointsFor(instanceName),
      onWaypointRegistered: (instanceName: string, floor: number) => {
        profile.registerDungeonWaypoint(instanceName, floor);
      },
      ...(events === undefined
        ? {}
        : {
            // Event 10 has no source emitter; see `DungeonRuntimeContext.onDungeonFloorEntered`.
            onDungeonFloorEntered: (instanceName: string, floor: number) => {
              appendGuildQuestEvents(events, quests, () =>
                quests.fireEvent({ id: 10, dungeon: { instanceName, floor } }));
            },
            onDungeonRoomRosterUpdated: (
              instanceName: string,
              floor: number,
              survivingMonstersByRoom: readonly number[],
            ) => {
              this.options.beforeDungeonRoomRosterUpdated?.(events, {
                instanceName,
                floor,
                survivingMonstersByRoom: [...survivingMonstersByRoom],
                completedFixedEncounterKeys: quests.stateSnapshot().completedFixedEncounterKeys,
              });
              appendGuildQuestEvents(events, quests, () => quests.fireEvent({
                id: 4,
                dungeon: {
                  instanceName,
                  floor,
                  survivingMonstersByRoom: [...survivingMonstersByRoom],
                },
              }));
            },
          }),
      ...(runSeed === undefined ? {} : { runSeed }),
    };
  }

  private restoreDungeon(
    state: OfficialDungeonStateV1,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    events?: UnsequencedPresentationEventV1[],
    sourceDungeonPopulationInheritance?: boolean,
  ): DungeonRuntimeController {
    return DungeonRuntimeController.restore(
      this.dungeonContext(
        profile,
        quests,
        undefined,
        events,
        sourceDungeonPopulationInheritance,
      ),
      state.run,
    );
  }

  private dungeonState(
    run: DungeonRuntimeController,
    worldId: string,
    entrancePoiId: string,
  ): OfficialDungeonStateV1 {
    return {
      schemaVersion: 1,
      run: run.snapshot(),
      worldId,
      entrancePoiId,
    };
  }

  private dungeonLocation(run: DungeonRuntimeController): Extract<
    OfficialLocationV1,
    { kind: "dungeon" }
  > {
    const snapshot = run.session.snapshot();
    return {
      kind: "dungeon",
      dungeonId: snapshot.definitionId,
      floor: snapshot.floor,
      roomId: snapshot.currentRoomId,
    };
  }

  private randomSeed(): number {
    return Math.floor(this.random() * 0x1_0000_0000) >>> 0;
  }

  private startDungeonBattle(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    run: DungeonRuntimeController,
    encounter: Parameters<typeof buildOfficialDungeonBattle>[0],
    events: UnsequencedPresentationEventV1[],
    chargeBattleSpiritEnergy: boolean,
  ): CommandReducerResult<OfficialGameStateV1> {
    if (prior.dungeon === undefined) throw new Error("dungeon battle is missing its run");
    const built = buildOfficialDungeonBattle(encounter, party);
    const battleId = `battle-${prior.nextBattleSequence}`;
    const initialReplay: BattleReplaySnapshotV1 = {
      schemaVersion: 1,
      randomDraws: [],
      teams: officialBattleTeams(built.teams),
      options: {
        fightingGroupSize: 3,
        ...(isInfiniteDungeonInstance(run.definition.instanceName)
          ? { blockCapture: true }
          : {}),
        silver: profile.snapshot().silver,
        ...(this.sourceJobLevelsForCurrentReduction ? { sourceJobLevels: true } : {}),
      },
      commands: [],
    };
    const first = restoreBattleReplay(this.options.data, initialReplay, {
      randomSource: this.random,
    });
    if (chargeBattleSpiritEnergy) {
      applyCommittedBattleSpiritEnergy(profile, first, first.events);
    }
    const battle: OfficialBattleStateV1 = {
      schemaVersion: 1,
      battleId,
      origin: {
        kind: "dungeon",
        dungeonId: run.session.snapshot().definitionId,
        encounterId: encounter.id,
      },
      encounter: built.encounter,
      replay: {
        ...initialReplay,
        randomDraws: first.randomDraws!,
      },
    };
    const dungeon = this.dungeonState(run, prior.dungeon.worldId, prior.dungeon.entrancePoiId);



    if (this.sourceStoryRulesForCurrentReduction) {
      this.recordEncounterChat(quests, dungeonEncounterChatKey(encounter.startEvent, encounter.id));
    }
    events.push({ type: "battle.started", battleId });
    this.fireEnemyDeathQuestEvents(events, quests, first, first.events);
    const state: OfficialGameStateV1 = {
      ...this.snapshot(
        prior,
        party,
        profile,
        quests,
        {
          kind: "battle",
          worldId: prior.dungeon.worldId,
          poiId: prior.dungeon.entrancePoiId,
          battleId,
        },
        prior.world,
        battle,
        dungeon,
      ),
      nextBattleSequence: prior.nextBattleSequence + 1,
    };
    return {
      state,
      projection: this.project(state, party, profile, quests, first),
      events,
    };
  }

  private applyDungeonLoot(
    party: WorldTripParty,
    profile: PlayerProfile,
    loot: readonly Parameters<typeof applyPlayerRewards>[1][number][],
    firstMonsterSequence: number,
    events: UnsequencedPresentationEventV1[],
    origin: OfficialEggOrigin,
    eggRewardRouter?: OfficialEggRewardRouter,
  ): { readonly nextMonsterSequence: number; readonly pendingEgg?: OfficialEggContinuation } {
    let nextMonsterSequence = firstMonsterSequence;
    const routed = eggRewardRouter?.split(loot, origin, 1);
    const immediateRewards = routed?.immediate ?? loot;
    reserveOfficialMonsterSequence(
      nextMonsterSequence,
      monsterJoinRewardCount(immediateRewards),
      `${origin} reward`,
    );
    const applied = applyPlayerRewards(profile, immediateRewards, {
      addMonsterJoin: (shortType, jobLevel) => {
        const allocated = allocateOfficialMonsterSequence(nextMonsterSequence, `${origin} reward`);
        nextMonsterSequence = allocated.nextSequence;
        const instanceId = allocated.instanceId;
        party.addCapturedMonster({ instanceId, shortType, level: jobLevel });
        profile.recordCapturedMonster(shortType, jobLevel);
        return { instanceId };
      },
    });
    for (const reward of applied) {
      if (reward.kind === "silver" || reward.kind === "gold") {
        events.push({
          type: "player.currencyChanged",
          currency: reward.kind,
          delta: reward.amount,
          balance: reward.balance,
        });
      } else if (reward.kind === "monsterJoin") {
        events.push({
          type: "player.monsterAdded",
          instanceId: reward.instanceId,
          monsterTypeId: reward.shortType,
          level: reward.jobLevel,
          reason: "reward",
        });
      }
    }
    return {
      nextMonsterSequence,
      ...(routed?.pendingEgg === undefined ? {} : { pendingEgg: routed.pendingEgg }),
    };
  }

  private restore(
    state: OfficialGameStateV1,
    terminalDefeatBattleId?: string,
    terminalDefeatDungeonConsequencesDeferred = false,
  ): {
    readonly state: OfficialGameStateV1;
    readonly party: WorldTripParty;
    readonly profile: PlayerProfile;
    readonly quests: GuildQuestRuntime;
  } {
    try {
      const parsed = parseOfficialGameStateV1WithDefeatBehavior(
        this.options.data,
        this.options.quests,
        state,
        {
          ...(this.options.resources === undefined
            ? {}
            : { dungeonResources: this.options.resources }),
          ...(terminalDefeatBattleId === undefined ? {} : { terminalDefeatBattleId }),
        },
        terminalDefeatDungeonConsequencesDeferred,
      );
      const party = WorldTripParty.fromStateSnapshot(this.options.data, parsed.party);
      const profile = PlayerProfile.fromStateSnapshot(
        parsed.profile,
        party.monsters().map((monster) => monster.level),
        party,
        profileRestoreOptions(this.options.data, parsed.profile),
      );



      party.setPlayerBuffSource(() => profile.battleStatBonuses());
      const quests = new GuildQuestRuntime(this.options.quests, parsed.quests);




      const pendingSpiritQuestEvents: UnsequencedPresentationEventV1[] = [];
      profile.setSpiritExperienceListener((shortType) => {
        appendGuildQuestEvents(pendingSpiritQuestEvents, quests, () =>
          quests.fireEvent({ id: 5, spiritShortType: shortType }));
        // `apply` publishes these after the active reducer builds its own presentation list.
        for (const event of pendingSpiritQuestEvents) this.pendingSpiritQuestEvents.push(event);
        pendingSpiritQuestEvents.length = 0;
      });
      return { state: parsed, party, profile, quests };
    } catch (error) {
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "authoritative state cannot be restored",
      );
    }
  }

  private dungeonParseContext(): OfficialGameStateParseContext {
    return this.options.resources === undefined
      ? {}
      : { dungeonResources: this.options.resources };
  }

  private snapshot(
    prior: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    location: OfficialLocationV1,
    world: OfficialWorldStateV1 | undefined,
    battle: OfficialBattleStateV1 | undefined,
    dungeon: OfficialDungeonStateV1 | null | undefined = undefined,
  ): OfficialGameStateV1 {
    // A dungeon world exit (`dungeon.activateZone` -> world) deliberately keeps the run cache while
    // the player walks the overworld; only a town entry purges it. Every town entry therefore drops
    // the cache here, including the auto-entries that end a battle (town-origin WorldEncounter
    // victory/retreat/Save Me, Tournament/Arena returns), not only the paths that pass `null`.
    // A town location carrying the cache is rejected by the state parser, so this can only turn a
    // previously always-rejected transition into a valid one.
    const nextDungeon = location.kind === "town"
      ? undefined
      : dungeon === undefined ? prior.dungeon : dungeon ?? undefined;
    return {
      schemaVersion: 1,
      profile: profile.stateSnapshot(),
      party: party.stateSnapshot(),
      quests: quests.stateSnapshot(),
      location,
      ...(world === undefined ? {} : { world }),
      ...(battle === undefined ? {} : { battle }),
      ...(nextDungeon === undefined ? {} : { dungeon: nextDungeon }),
      ...(prior.pendingEgg === undefined ? {} : { pendingEgg: prior.pendingEgg }),
      nextMonsterSequence: prior.nextMonsterSequence,
      nextBattleSequence: prior.nextBattleSequence,
    };
  }

  private project(
    state: OfficialGameStateV1,
    party: WorldTripParty,
    profile: PlayerProfile,
    quests: GuildQuestRuntime,
    restoredBattle?: RestoredBattleReplay,
    sourceDungeonPopulationInheritance?: boolean,
  ): ProjectionBodyV1 {
    const profileState = profile.stateSnapshot();
    if (profileState.schemaVersion !== 8) throw new Error("official profile must use schema 8");
    const battleRestore = state.battle === undefined
      ? undefined
      : restoredBattle ?? restoreBattleReplay(this.options.data, state.battle.replay);
    const worldView = state.world === undefined
      ? undefined
      : (() => {
          const restored = restoreOfficialWorldTrip({
            data: this.options.data,
            world: this.world(state.world.worldId),
            state: state.world,
            rng: replayableRng([]),
            hasCompletedFixedEncounter: (key) => quests.hasCompletedFixedEncounter(key),
            canUseQuestKey: (key) => quests.canUseQuestKey(key),
          });
          return {
            worldId: state.world.worldId,
            currentPoiId: state.world.currentPoiId,
            lastTownId: state.world.lastTownId,
            dayNumber: state.world.dayNumber,
            poiStates: Object.fromEntries(restored.trip.poiStates()),
            selectablePoiIds: [...restored.trip.selectablePoiNames()],
            occurrenceByPoi: { ...state.world.occurrenceByPoi },
            completedPoiIds: [...state.world.completedPoiIds],
            poiWins: { ...state.world.poiWins },
            everCompletedPoiIds: [...state.world.everCompletedPoiIds],
            visitedTownIds: [...state.world.visitedTownIds],
          };
        })();
    return {
      player: {
        heroLevel: profile.heroLevel,
        heroTotalHighestLevels: profile.heroTotalHighestLevels,
        silver: profileState.silver,
        gold: profileState.gold,
        captureCards: profile.snapshot().captureCards,
        party: party.monsters().map((monster) => ({
          instanceId: monster.instanceId,
          shortType: monster.shortType,
          level: monster.level,
          cumulativeXp: monster.cumulativeXp,
          hp: monster.currentHp,
          maxHp: party.maxHpOf(monster.instanceId),
          ...(monster.injureTime === undefined
            ? {}
            : { injuredAt: new Date(monster.injureTime * 1_000).toISOString() }),
          ...(monster.healTime === undefined
            ? {}
            : { injuredUntil: new Date(monster.healTime * 1_000).toISOString() }),
          ...(monster.soulStone === undefined
            ? {}
            : {
                soulStone: {
                  element: monster.soulStone.element,
                  level: monster.soulStone.level,
                  ...(monster.soulStone.sourceType === undefined
                    ? {}
                    : { sourceTypeId: monster.soulStone.sourceType }),
                },
              }),
        })),
        battingOrderSize: party.battingOrderSize,
        battingOrderIds: party.battingOrderMonsters().map((monster) => monster.instanceId),







        ownedSoulStones: party.ownedSoulStoneEntries().map(({ stone }, index) => ({
          stoneId: `soul-stone-${index + 1}`,
          element: stone.element,
          level: stone.level,
          ...(stone.sourceType === undefined ? {} : { sourceTypeId: stone.sourceType }),
        })),
        highestCapturedLevels: profileState.highestCapturedLevels,
        learnedCombineRecipes: [...profileState.learnedCombineRecipes],
        tutorialFlags: [...profileState.tutorialFlags],
        catchQuestsDone: [...(profileState.catchQuestsDone ?? [])],
        dungeonWaypoints: Object.fromEntries(
          Object.entries(profileState.dungeonWaypoints ?? {})
            .map(([instanceName, floors]) => [instanceName, [...floors]]),
        ),
        infiniteDungeonHighestLevel: profileState.infiniteDungeonHighestLevel,
        items: profile.inventory.legacyItemCounts(),
        inventory: (() => {
          const inventory = profile.inventory.stateSnapshot();
          return {
            schemaVersion: 1 as const,
            nextItemSequence: inventory.nextItemSequence,
            looseItems: inventory.looseItems.map((item) =>
              item.kind === "gem"
                ? { ...item, enabledStats: [...item.enabledStats] }
                : { ...item }),
            equippedGems: Object.fromEntries(
              Object.entries(inventory.equippedGems).map(([slot, gem]) => [
                slot,
                gem === undefined
                  ? undefined
                  : { ...gem, enabledStats: [...gem.enabledStats] },
              ]),
            ),
          };
        })(),
        licenseType: profile.licenseType,
        skillPoints: {
          MaxHP: profile.skillValue("MaxHP"),
          Attack: profile.skillValue("Attack"),
          Magic: profile.skillValue("Magic"),
          Speed: profile.skillValue("Speed"),
          Defense: profile.skillValue("Defense"),
          Resist: profile.skillValue("Resist"),
        },
        tournament: profile.tournament.stateSnapshot(),
        spirit: {
          energy: profileState.spiritEnergy,
          savedXp: Object.fromEntries(
            Object.entries(profileState.spiritSavedXp).filter(([, xp]) => xp > 0),
          ),
          usedThisTrip: [...profileState.spiritsUsedThisTrip],
        },
      },
      location: state.location,
      decision: battleRestore === undefined
        ? state.location.kind === "world"
          ? {
              type: "world.ready",
              decisionId: `world-${state.world!.currentPoiId}`,
              selectablePoiIds: [...worldView!.selectablePoiIds],
            }
          : state.location.kind === "dungeon" && state.dungeon !== undefined
            ? {
                type: "dungeon.ready",
                decisionId: `dungeon-${protocolIdSegment(state.location.roomId)}`,
                selectableRoomIds: [...state.dungeon.run.current.session.exploredRoomIds],
                activatableZoneIds: this.restoreDungeon(
                  state.dungeon,
                  profile,
                  quests,
                  undefined,
                  sourceDungeonPopulationInheritance,
                )
                  .session.currentRoom.zones
                  .map(({ id }) => id),
              }
            : { type: "none" }
        : battleDecisionView(battleRestore, state.battle!, profile),
      ...(worldView === undefined ? {} : { world: worldView }),
      quests: questProjection(quests),
      ...(state.battle === undefined
        ? {}
        : {
            battle: {
              battleId: state.battle.battleId,
              backgroundKey: legacyBackgroundKey(state.battle),
              allowRetreat: state.battle.encounter.allowRetreat,
              ...(state.battle.encounter.breederXpBonus === undefined
                ? {}
                : { breederXpBonus: state.battle.encounter.breederXpBonus }),
              teams: [
                state.battle.replay.teams[0].map((member) => structuredClone(member)),
                state.battle.replay.teams[1].map((member) => structuredClone(member)),
              ],
              options: { ...state.battle.replay.options },
              randomDraws: [...state.battle.replay.randomDraws!],
              commands: state.battle.replay.commands.map((entry) => entry.type === "ability"
                ? { ...entry, targetIds: [...entry.targetIds] }
                : { ...entry }),
            },
          }),
      ...(state.dungeon === undefined || (
        state.location.kind !== "dungeon" &&
        !(state.location.kind === "battle" && state.battle?.origin.kind === "dungeon")
      )
        ? {}
        : {
            dungeon: {
              run: projectDungeonRun(state.dungeon.run),
              worldId: state.dungeon.worldId,
              entrancePoiId: state.dungeon.entrancePoiId,
            },
          }),
      ...(state.pendingEgg === undefined
        ? {}
        : { pendingEgg: structuredClone(state.pendingEgg) }),
    };
  }
}

/**
 * Additive v12 reducer. The existing v11 reducer remains the ordinary-domain implementation;
 * this aggregate owns the authoritative Egg continuation while later continuation reducers stay
 * explicitly gated.
 */
export class OfficialGameV12Reducer implements GameCommandReducer<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
  private readonly support: OfficialGameV12SupportReport;

  constructor(
    private readonly legacy: OfficialGameReducer,
    support: OfficialGameV12SupportReport,
  ) {
    const binding = validatedV12SupportReports.get(support);
    if (binding === undefined ||
        !validatedEggSupportProofs.has(binding.eggSupport) ||
        validatedEggSupportInternals.get(binding.eggSupport) === undefined ||
        binding.eggSupport !== support.eggSupport ||
        binding.support !== legacy.supportForContinuation() ||
        binding.data !== legacy.gameDataForContinuation()) {
      throw new Error("OfficialGameV12Reducer requires the exact runtime-validated loaded Egg proof");
    }
    this.support = support;
  }

  private requireBoundDescriptor(pack: LogicPackDescriptorV1): void {
    const provenance = (pack as unknown as Record<PropertyKey, unknown>)[officialV12DescriptorProvenance];
    const binding = validatedV12DescriptorBindings.get(pack.logicPackId);
    const typedProvenance = typeof provenance === "object" && provenance !== null
      ? provenance as OfficialV12DescriptorProvenance
      : undefined;
    if (typeof provenance !== "object" || provenance === null ||
        !validatedV12DescriptorProvenances.has(provenance) ||
        typedProvenance === undefined ||
        !validatedV12DescriptorTokens.has(typedProvenance.token) ||
        binding === undefined ||
        binding.support !== this.support ||
        binding.proof !== this.support.eggSupport ||
        binding.collectionCatalog !== this.support.collectionCatalog ||
        typedProvenance.support !== this.support ||
        typedProvenance.proof !== this.support.eggSupport ||
        typedProvenance.collectionCatalog !== this.support.collectionCatalog ||
        typedProvenance.descriptorFingerprint !== canonicalJsonValue(pack) ||
        binding.supportFingerprint !== this.support.eggSupport.supportFingerprint ||
        binding.descriptorFingerprint !== canonicalJsonValue(pack) ||
        binding.commandTypes.length !== pack.capabilities.commandTypes.length ||
        binding.commandTypes.some((commandType, index) =>
          pack.capabilities.commandTypes[index] !== commandType)) {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        "v12 descriptor is not advertised or bound to the exact validated loaded Egg proof",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV12, OfficialGameProjectionBodyV12>,
  ): void {
    try {
      validateOfficialGameV12Envelope(record.state);
      validateOfficialGameV12ContinuationFields(record.state);
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v12 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV12(projectionBody(record.projection));
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V12_SIMULATION_VERSION) {
        throw new Error("official v12 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v12 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV12): OfficialGameProjectionBodyV12 {
    validateOfficialGameV12Envelope(state);
    validateOfficialGameV12ContinuationFields(state);
    return projectOfficialGameStateV12(this.legacy, state);
  }

  /** Internal v14/v15 projection path: pending dungeon losses still own their pre-loss room. */
  projectPersistedStateForV14(state: OfficialGameStateV12): OfficialGameProjectionBodyV12 {
    validateOfficialGameV12Envelope(state);
    validateOfficialGameV12ContinuationFields(state);
    return projectOfficialGameStateV12(this.legacy, state, false, true);
  }

  /** Internal v16 projection path: retain v14's deferred-loss invariant while selecting native
   * sparse dungeon-population behavior. */
  projectPersistedStateForV16(state: OfficialGameStateV12): OfficialGameProjectionBodyV12 {
    validateOfficialGameV12Envelope(state);
    validateOfficialGameV12ContinuationFields(state);
    return projectOfficialGameStateV12(this.legacy, state, true, true);
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: false,
      restorePartyOnOrdinaryReturn: false,
    });
  }

  /** Internal v14 delegate entry. The descriptor remains v12-bound, but terminal defeat
   * consequences and Save Me resolution use the new restart contract. */
  applyForV14(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: false,
    });
  }

  /** Internal v15 delegate entry. Ordinary defeat returns now perform the same town restoration as
   * every other source path that deposits the player in town. */
  applyForV15(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: false,
    });
  }

  /** Internal v16 delegate entry. Guarded dungeon treasure is settled only by Take All after the
   * battle returns to its room, and newly committed damage charges durable Hero spirit energy. */
  applyForV16(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: true,
      chargeBattleSpiritEnergy: true,
      sourceDungeonPopulationInheritance: true,
    });
  }

  /** Internal v18 delegate entry. Town-origin world battles auto-enter the same town after victory
   * or retreat, matching WorldEncounter's return wrapper. */
  applyForV18(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: true,
      chargeBattleSpiritEnergy: true,
      sourceDungeonPopulationInheritance: true,
      sourceTownBattleLifecycle: true,
    });
  }

  /** Internal v19 delegate entry. It preserves v18's lifecycle while allowing only the replay
   * terminal produced by Utility.Escape to settle a Tournament retreat. */
  applyForV19(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: true,
      chargeBattleSpiritEnergy: true,
      sourceDungeonPopulationInheritance: true,
      sourceTownBattleLifecycle: true,
      allowTournamentRetreat: true,
    });
  }

  /** Internal v20 delegate entry. Only Tournament Save Me changes; every other v19 behavior is
   * retained, including the replay-derived Escape retreat gate. */
  applyForV20(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: true,
      chargeBattleSpiritEnergy: true,
      sourceDungeonPopulationInheritance: true,
      sourceTownBattleLifecycle: true,
      allowTournamentRetreat: true,
      sourceTournamentSaveMe: true,
    });
  }

  /** Internal v21 delegate entry. Arena Utility.Escape now commits recovery state without
   * inventing the Arena loss or Tournament retreat callbacks. */
  applyForV21(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: true,
      chargeBattleSpiritEnergy: true,
      sourceDungeonPopulationInheritance: true,
      sourceTownBattleLifecycle: true,
      allowTournamentRetreat: true,
      sourceTournamentSaveMe: true,
      allowArenaEscapeStall: true,
    });
  }

  /** Internal v22 delegate entry. World/Dungeon Save Me now uses the source retreat callbacks. */
  applyForV22(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: true,
      chargeBattleSpiritEnergy: true,
      sourceDungeonPopulationInheritance: true,
      sourceTownBattleLifecycle: true,
      allowTournamentRetreat: true,
      sourceTournamentSaveMe: true,
      allowArenaEscapeStall: true,
      sourceWorldDungeonSaveMe: true,
    });
  }

  /** Internal v23 delegate; earlier public simulation behavior remains immutable. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: true,
      chargeBattleSpiritEnergy: true,
      sourceDungeonPopulationInheritance: true,
      sourceTownBattleLifecycle: true,
      allowTournamentRetreat: true,
      sourceTournamentSaveMe: true,
      allowArenaEscapeStall: true,
      sourceWorldDungeonSaveMe: true,
      sourceEggRng: true,
    });
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    return this.applyVersioned(context, command, {
      restartSaveMe: true,
      restorePartyOnOrdinaryReturn: true,
      deferDungeonTreasureRewards: true,
      chargeBattleSpiritEnergy: true,
      sourceDungeonPopulationInheritance: true,
      sourceTownBattleLifecycle: true,
      allowTournamentRetreat: true,
      sourceTournamentSaveMe: true,
      allowArenaEscapeStall: true,
      sourceWorldDungeonSaveMe: true,
      sourceEggRng: true,
      sourceStoryRules: true,
    });
  }

  private applyVersioned(
    context: CommandReducerContext<OfficialGameStateV12>,
    command: GameCommandV1,
    behavior: {
      readonly restartSaveMe: boolean;
      readonly restorePartyOnOrdinaryReturn: boolean;
      readonly deferDungeonTreasureRewards?: boolean;
      readonly chargeBattleSpiritEnergy?: boolean;
      readonly sourceDungeonPopulationInheritance?: boolean;
      readonly sourceTownBattleLifecycle?: boolean;
      readonly allowTournamentRetreat?: boolean;
      readonly sourceTournamentSaveMe?: boolean;
      readonly allowArenaEscapeStall?: boolean;
      readonly sourceWorldDungeonSaveMe?: boolean;
      readonly sourceEggRng?: boolean;
      readonly sourceStoryRules?: boolean;
    },
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    if (context.pack.simulationVersion !== OFFICIAL_GAME_V12_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV12Reducer requires the official-game-v12 simulation pack",
      );
    }
    if (context.pack.trustTier !== "official") {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV12Reducer requires an official-trust simulation pack",
      );
    }
    this.requireBoundDescriptor(context.pack);
    if (context.state === undefined) {
      const advertisedCommand = CurrentGameCommandV1Schema.safeParse(command);
      const advertisedCommandTypes = context.pack.capabilities.commandTypes as readonly string[];
      if (
        !advertisedCommand.success ||
        !advertisedCommandTypes.includes(advertisedCommand.data.type)
      ) {
        throw new GameServiceError(
          "CAPABILITY_UNSUPPORTED",
          `${command.type} is not advertised by the installed v12 simulation pack`,
        );
      }
      const reduced = this.legacy.apply(
        context as CommandReducerContext<OfficialGameStateV1>,
        command,
      );
      const state = createOfficialGameStateV12(reduced.state);
      return {
        state,
        projection: parseOfficialGameProjectionV12(
          projectV12ContinuationBody(reduced.projection, state),
        ),
        events: reduced.events,
      };
    }

    validateOfficialGameV12Envelope(context.state);
    validateOfficialGameV12ContinuationFields(context.state);
    assertOfficialGameV12CommandAdmitted(context.state, command);
    const advertisedCommand = CurrentGameCommandV1Schema.safeParse(command);
    const advertisedCommandTypes = context.pack.capabilities.commandTypes as readonly string[];
    if (
      !advertisedCommand.success ||
      !advertisedCommandTypes.includes(advertisedCommand.data.type)
    ) {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        `${command.type} is not advertised by the installed v12 simulation pack`,
      );
    }
    if (
      command.type === "egg.start" ||
      command.type === "egg.release" ||
      command.type === "egg.resolvePrize" ||
      command.type === "egg.repeat" ||
      command.type === "egg.finish"
    ) {
      return this.applyEggCommand(context, context.state, command, behavior.sourceEggRng === true);
    }
    const installed = validatedV12SupportReports.get(this.support);
    if (installed === undefined) {
      throw new GameServiceError("CAPABILITY_UNSUPPORTED", "v12 support is not installed");
    }
    if (command.type === "collection.claim") {
      return this.applyCollectionClaim(
        context,
        context.state,
        installed,
        command,
      );
    }
    if (command.type === "battle.resolveDefeat") {
      return behavior.restartSaveMe
        ? this.applyDefeatResolutionForV14(
            context,
            context.state,
            command,
            behavior.restorePartyOnOrdinaryReturn,
            behavior.chargeBattleSpiritEnergy === true,
            behavior.sourceDungeonPopulationInheritance === true,
            behavior.sourceTournamentSaveMe === true,
            behavior.sourceWorldDungeonSaveMe === true,
          )
        : this.applyDefeatResolution(context, context.state, command);
    }
    validateRouteRewardPlanBeforeReduction(
      this.legacy.gameDataForContinuation(),
      installed.quests,
      this.support.eggSupport,
      context.state,
      command,
    );
    if (isV12ContinuationCommand(command) || command.type === "tournament.settlePrize") {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        `${command.type} is reserved for the later v12 settlement reducer`,
      );
    }

    let nextContinuationSequence = context.state.nextContinuationSequence;
    const eggRewardRouter: OfficialEggRewardRouter = {
      split: (rewards, origin, remainingRepeats) => splitPendingEggReward(
        rewards,
        origin,
        remainingRepeats,
        {
          allocateContinuation: () => {
            const transition = allocateOfficialContinuationIdentity({
              ...context.state!,
              nextContinuationSequence,
            });
            nextContinuationSequence = transition.allocation.nextContinuationSequence;
            return transition.allocation;
          },
        },
      ),
      validateLoadedRewards: (rewards) => validateLoadedRewardBatch(
        this.legacy.gameDataForContinuation(),
        this.support.eggSupport,
        rewards,
      ),
    };

    const reduced = this.legacy.apply({
      ...context,
      state: toOfficialGameStateV11(context.state),
      eggRewardRouter,
      ...(isBattleCommand(command) ? { deferDefeatRecovery: true } : {}),
      ...(behavior.restartSaveMe && isBattleCommand(command)
        ? { deferDefeatConsequences: true }
        : {}),
      ...(behavior.deferDungeonTreasureRewards && isBattleCommand(command)
        ? { deferDungeonTreasureRewards: true }
        : {}),
      ...(behavior.chargeBattleSpiritEnergy
        ? { chargeBattleSpiritEnergy: true }
        : {}),
      ...(behavior.sourceDungeonPopulationInheritance
        ? { sourceDungeonPopulationInheritance: true }
        : {}),
      ...(behavior.sourceTownBattleLifecycle
        ? { sourceTownBattleLifecycle: true }
        : {}),
      ...(behavior.allowTournamentRetreat
        ? { allowTournamentRetreat: true }
        : {}),
      ...(behavior.sourceTournamentSaveMe
        ? { sourceTournamentSaveMe: true }
        : {}),
      ...(behavior.allowArenaEscapeStall
        ? { allowArenaEscapeStall: true }
        : {}),
      ...(behavior.sourceStoryRules
        ? { sourceStoryRules: true }
        : {}),
    } as CommandReducerContext<OfficialGameStateV1>, command);
    const pendingEgg = reduced.pendingEgg;
    let state = {
      ...createOfficialGameStateV12(reduced.state),
      collectionClaims: structuredClone(context.state.collectionClaims),
      nextContinuationSequence,
      ...(pendingEgg === undefined ? {} : { pendingEgg: structuredClone(pendingEgg) }),
    } satisfies OfficialGameStateV12;
    let ordinaryProjection = reduced.projection;
    let events = reduced.events;
    // Battle-start routes run the committed opening enemy/passive prefix before returning. That
    // prefix can itself end the battle, so terminal defeat ownership is a property of the reduced
    // retained replay, not of whether the initiating intent happened to be `battle.*`.
    const terminalBattle = reduced.state.location.kind === "battle" &&
      reduced.state.battle !== undefined
      ? restoreBattleReplay(this.legacy.gameDataForContinuation(), reduced.state.battle.replay)
      : undefined;
    const defeatedBattle = reduced.state.battle;
    if (terminalBattle?.step.type === "ended" &&
        terminalBattle.step.report.winner === 1 &&
        defeatedBattle !== undefined) {
      const restored = this.legacy.restoreForContinuation(
        reduced.state,
        defeatedBattle.battleId,
        behavior.restartSaveMe,
      );
      const canSaveMe = canOfferSaveMe({
        blockSaveMe: officialBattleBlocksSaveMe(reduced.state),
        tutorialSeen: restored.profile.hasTutorialFlag("SaveMe"),
        heroLevel: restored.profile.heroLevel,
        gold: restored.profile.snapshot().gold,
      });
      if (canSaveMe) restored.profile.claimTutorialFlag("SaveMe");
      const allocation = allocateOfficialContinuationIdentity({
        ...state,
        nextContinuationSequence,
      });
      nextContinuationSequence = allocation.allocation.nextContinuationSequence;
      state = {
        ...state,
        profile: restored.profile.stateSnapshot(),
        party: restored.party.stateSnapshot(),
        quests: restored.quests.stateSnapshot(),
        nextContinuationSequence,
        pendingDefeat: {
          schemaVersion: 1,
          kind: "defeat",
          decisionId: allocation.allocation.decisionId,
          battleId: defeatedBattle.battleId,
          canSaveMe,
        },
      };
      ordinaryProjection = this.legacy.projectForContinuation(
        toOfficialGameStateV11(state),
        restored.party,
        restored.profile,
        restored.quests,
      );
      if (!events.some((event) =>
        event.type === "battle.ended" && event.battleId === defeatedBattle.battleId)) {
        // Start routes emit `battle.started`; ordinary battle-command settlement emits its own
        // terminal event. Append only the opening-prefix case so the committed lifecycle remains
        // ordered and exactly once.
        events = [...events, {
          type: "battle.ended",
          battleId: defeatedBattle.battleId,
          outcome: "defeat",
        }];
      }
    }
    return {
      state,
      projection: parseOfficialGameProjectionV12(
        projectV12ContinuationBody(ordinaryProjection, state),
      ),
      events,
    };
  }

  private applyCollectionClaim(
    context: CommandReducerContext<OfficialGameStateV12>,
    prior: OfficialGameStateV12,
    installed: OfficialV12SupportBinding,
    command: Extract<GameCommandV1, { type: "collection.claim" }>,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    const proof = this.support.collectionCatalog;
    if (proof === undefined) {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        "Collection claims require an exact validated operator catalog",
      );
    }
    const catalogBinding = validatedCollectionCatalogBindings.get(proof);
    if (catalogBinding === undefined ||
        catalogBinding.support !== installed.support ||
        catalogBinding.data !== this.legacy.gameDataForContinuation()) {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        "Collection catalog proof is not bound to the installed authority",
      );
    }
    const goals = catalogBinding.catalog.get("Base");
    const goal = goals?.find((candidate) => `CollectionQuest${candidate.key}` === command.goalId);
    if (goal === undefined) {
      throw new GameServiceError("ENTITY_NOT_FOUND", `Collection goal ${command.goalId} is unknown`);
    }
    const restored = this.legacy.restoreForContinuation(toOfficialGameStateV11(prior));
    const claims = new CollectionClaims(prior.collectionClaims.claimedGoalIds);
    const goalId = command.goalId;
    if (claims.has(goalId)) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `Collection goal ${goalId} is already claimed`);
    }
    const progress = collectionGoalProgress(
      goal,
      (shortType) => restored.profile.highestRegisteredLevel(shortType),
      new Set(claims.snapshot()),
    );
    if (!progress.complete) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `Collection goal ${goalId} is incomplete`);
    }

    // Reserve the complete authored MonsterJoin demand before creating the replayable RNG. A
    // generated reward batch can only contain one result per authored item; zero-chance items do
    // not create a reachable demand. The checked allocator below remains the settlement authority
    // for each actual generated join.
    reserveOfficialMonsterSequence(
      prior.nextMonsterSequence,
      collectionGoalMonsterJoinDemand(goal),
      "collection reward",
    );

    // A Collection reward that can emit an Egg needs a continuation identity. Reserve that
    // durable sequence before asking the server RNG for authored reward draws, so an exhausted
    // continuation namespace is a full no-op rather than a failed claim after consuming RNG.
    if (collectionGoalCanProduceEgg(goal)) allocateOfficialContinuationIdentity(prior);
    let nextContinuationSequence = prior.nextContinuationSequence;
    const rng = replayableRng([], this.legacy.randomForContinuation());
    const rewards = generateQuestRewards(goal.treasureData, 1, rng);
    validateOfficialEggRewardBatchShape(rewards);
    validateLoadedRewardBatch(
      this.legacy.gameDataForContinuation(),
      this.support.eggSupport,
      rewards,
    );
    const routed = splitPendingEggReward(
      rewards,
      "collection",
      1,
      {
        allocateContinuation: () => {
          const allocation = allocateOfficialContinuationIdentity({
            ...prior,
            nextContinuationSequence,
          });
          nextContinuationSequence = allocation.allocation.nextContinuationSequence;
          return allocation.allocation;
        },
      },
    );
    reserveOfficialMonsterSequence(
      prior.nextMonsterSequence,
      monsterJoinRewardCount(routed.immediate),
      "collection reward",
    );
    let nextMonsterSequence = prior.nextMonsterSequence;
    const applied = applyPlayerRewards(restored.profile, routed.immediate, {
      addMonsterJoin: (shortType, jobLevel) => {
        const allocation = allocateOfficialMonsterSequence(nextMonsterSequence, "collection reward");
        nextMonsterSequence = allocation.nextSequence;
        restored.party.addCapturedMonster({
          instanceId: allocation.instanceId,
          shortType,
          level: jobLevel,
        });
        restored.profile.recordCapturedMonster(shortType, jobLevel);
        return { instanceId: allocation.instanceId };
      },
    });
    claims.claim(goalId);
    const events: UnsequencedPresentationEventV1[] = [];
    for (const result of applied) {
      if (result.kind === "silver" || result.kind === "gold") {
        events.push({
          type: "player.currencyChanged",
          currency: result.kind,
          delta: result.amount,
          balance: result.balance,
        });
      } else if (result.kind === "monsterJoin") {
        events.push({
          type: "player.monsterAdded",
          instanceId: result.instanceId,
          monsterTypeId: result.shortType,
          level: result.jobLevel,
          reason: "reward",
        });
      }
    }
    events.push({
      type: "quest.rewardClaimed",
      questId: goalId,
      rewards: rewards.map((reward) =>
        reward.kind === "gem" ? { ...reward, enabledStats: [...reward.enabledStats] } : { ...reward }),
      randomDraws: [...rng.draws],
    });
    const nextState = replaceOfficialV12State(
      prior,
      routed.pendingEgg,
      restored.party,
      restored.profile,
      restored.quests,
      nextContinuationSequence,
      nextMonsterSequence,
      claims,
    );
    return {
      state: nextState,
      projection: parseOfficialGameProjectionV12(
        projectV12ContinuationBody(
          this.legacy.projectForContinuation(
            toOfficialGameStateV11(nextState),
            restored.party,
            restored.profile,
            restored.quests,
          ),
          nextState,
        ),
      ),
      events,
    };
  }

  private applyDefeatResolution(
    context: CommandReducerContext<OfficialGameStateV12>,
    prior: OfficialGameStateV12,
    command: Extract<GameCommandV1, { type: "battle.resolveDefeat" }>,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    const pending = prior.pendingDefeat;
    if (pending === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "battle.resolveDefeat requires a pending defeat");
    }
    if (command.battleId !== pending.battleId) {
      throw new GameServiceError("ENTITY_NOT_FOUND", "battle.resolveDefeat does not own this battle");
    }
    if (prior.location.kind !== "battle" || prior.battle?.battleId !== pending.battleId) {
      throw new GameServiceError("STATE_CORRUPT", "pending defeat is missing its committed battle snapshot");
    }
    const restored = this.legacy.restoreForContinuation(
      toOfficialGameStateV11(prior),
      pending.battleId,
    );
    const replay = restoreBattleReplay(this.legacy.gameDataForContinuation(), prior.battle.replay);
    if (replay.step.type !== "ended") {
      throw new GameServiceError("STATE_CORRUPT", "pending defeat battle is not terminal");
    }
    const canSaveMe = canOfferSaveMe({
      blockSaveMe: officialBattleBlocksSaveMe(prior),
      tutorialSeen: restored.profile.hasTutorialFlag("SaveMe"),
      heroLevel: restored.profile.heroLevel,
      gold: restored.profile.snapshot().gold,
    });
    if (pending.canSaveMe !== canSaveMe) {
      throw new GameServiceError("STATE_CORRUPT", "pending defeat Save Me eligibility changed");
    }
    const events: UnsequencedPresentationEventV1[] = [];
    if (command.recovery === "saveMe") {
      if (!pending.canSaveMe) {
        throw new GameServiceError("ACTION_NOT_ALLOWED", "Save Me is not available for this defeat");
      }
      if (!restored.profile.spendGold(100)) {
        throw new GameServiceError("INSUFFICIENT_FUNDS", "Save Me requires 100 gold");
      }
      restored.party.applySaveMeRecovery();
      events.push({
        type: "player.currencyChanged",
        currency: "gold",
        delta: -100,
        balance: restored.profile.snapshot().gold,
      });
    }
    const returned = this.legacy.completeDefeatReturn(
      prior,
      restored.party,
      restored.profile,
      restored.quests,
      prior.world!,
      context.now,
      events,
      false,
    );
    const core = this.legacy.snapshotForContinuation(
      toOfficialGameStateV11(prior),
      restored.party,
      restored.profile,
      restored.quests,
      returned.location,
      returned.world,
      undefined,
      null,
    );
    const { pendingDefeat: _pendingDefeat, ...withoutPendingDefeat } = prior;
    const nextState = {
      ...createOfficialGameStateV12(core),
      ...withoutPendingDefeat,
      profile: restored.profile.stateSnapshot(),
      party: restored.party.stateSnapshot(),
      quests: restored.quests.stateSnapshot(),
      location: returned.location,
      world: returned.world,
      battle: undefined,
      dungeon: undefined,
      collectionClaims: structuredClone(prior.collectionClaims),
      nextContinuationSequence: prior.nextContinuationSequence,
    } as unknown as OfficialGameStateV12;
    delete (nextState as { battle?: unknown }).battle;
    delete (nextState as { dungeon?: unknown }).dungeon;
    validateOfficialGameV12Envelope(nextState);
    return {
      state: structuredClone(nextState),
      projection: parseOfficialGameProjectionV12(
        projectV12ContinuationBody(
          this.legacy.projectForContinuation(
            toOfficialGameStateV11(nextState),
            restored.party,
            restored.profile,
            restored.quests,
          ),
          nextState,
        ),
      ),
      events,
    };
  }

  /** v14/v15 resolution: ordinary return commits the deferred run/bracket loss; Save Me instead
   * spends 100 gold, heals the durable party, and replaces the terminal replay with the same
   * encounter. The caller selects whether ordinary return also performs town restoration. */
  private applyDefeatResolutionForV14(
    context: CommandReducerContext<OfficialGameStateV12>,
    prior: OfficialGameStateV12,
    command: Extract<GameCommandV1, { type: "battle.resolveDefeat" }>,
    restorePartyOnOrdinaryReturn: boolean,
    chargeBattleSpiritEnergy: boolean,
    sourceDungeonPopulationInheritance: boolean,
    sourceTournamentSaveMe: boolean,
    sourceWorldDungeonSaveMe: boolean,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    const pending = prior.pendingDefeat;
    if (pending === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "battle.resolveDefeat requires a pending defeat");
    }
    if (command.battleId !== pending.battleId) {
      throw new GameServiceError("ENTITY_NOT_FOUND", "battle.resolveDefeat does not own this battle");
    }
    if (prior.location.kind !== "battle" || prior.battle?.battleId !== pending.battleId) {
      throw new GameServiceError("STATE_CORRUPT", "pending defeat is missing its committed battle snapshot");
    }
    const restored = this.legacy.restoreForContinuation(
      toOfficialGameStateV11(prior),
      pending.battleId,
      true,
    );
    const replay = restoreBattleReplay(this.legacy.gameDataForContinuation(), prior.battle.replay);
    if (replay.step.type !== "ended" || replay.step.report.winner !== 1) {
      throw new GameServiceError("STATE_CORRUPT", "pending defeat battle is not a terminal loss");
    }
    const canSaveMe = canOfferSaveMe({
      blockSaveMe: officialBattleBlocksSaveMe(prior),
      tutorialSeen: restored.profile.hasTutorialFlag("SaveMe"),
      heroLevel: restored.profile.heroLevel,
      gold: restored.profile.snapshot().gold,
    });
    if (pending.canSaveMe !== canSaveMe) {
      throw new GameServiceError("STATE_CORRUPT", "pending defeat Save Me eligibility changed");
    }
    const events: UnsequencedPresentationEventV1[] = [];
    if (command.recovery === "saveMe") {
      if (!pending.canSaveMe) {
        throw new GameServiceError("ACTION_NOT_ALLOWED", "Save Me is not available for this defeat");
      }
      if (!restored.profile.spendGold(100)) {
        throw new GameServiceError("INSUFFICIENT_FUNDS", "Save Me requires 100 gold");
      }
      restored.party.applySaveMeRecovery();
      events.push({
        type: "player.currencyChanged",
        currency: "gold",
        delta: -100,
        balance: restored.profile.snapshot().gold,
      });
      if (sourceTournamentSaveMe && prior.battle.origin.kind === "tournament") {
        // Native `TournamentEncounter useSaveMe:` follows the retreat/return lifecycle. Do not
        // run deferred Tournament loss consequences and do not mint a replacement battle: the
        // committed round/status/timeLast remain untouched while the source town entry heals,
        // resets spirits, refreshes the trip, advances the day, and records town quest events.
        const returned = this.legacy.completeOriginTownBattleReturn(
          prior.world!,
          prior.battle.origin.townId,
          restored.party,
          restored.profile,
          restored.quests,
          context.now,
          events,
        );
        const { pendingDefeat: _pendingDefeat, ...withoutPendingDefeat } = prior;
        const core = this.legacy.snapshotForContinuation(
          toOfficialGameStateV11(prior),
          restored.party,
          restored.profile,
          restored.quests,
          returned.location,
          returned.world,
          undefined,
          null,
        );
        const nextState = {
          ...createOfficialGameStateV12(core),
          ...withoutPendingDefeat,
          profile: restored.profile.stateSnapshot(),
          party: restored.party.stateSnapshot(),
          quests: restored.quests.stateSnapshot(),
          location: returned.location,
          world: returned.world,
          battle: undefined,
          dungeon: undefined,
          collectionClaims: structuredClone(prior.collectionClaims),
          nextContinuationSequence: prior.nextContinuationSequence,
        } as unknown as OfficialGameStateV12;
        delete (nextState as { battle?: unknown }).battle;
        delete (nextState as { dungeon?: unknown }).dungeon;
        validateOfficialGameV12Envelope(nextState);
        return {
          state: structuredClone(nextState),
          projection: parseOfficialGameProjectionV12(
            projectV12ContinuationBody(
              this.legacy.projectForContinuation(
                toOfficialGameStateV11(nextState),
                restored.party,
                restored.profile,
                restored.quests,
              ),
              nextState,
            ),
          ),
          events,
        };
      }
      if (
        sourceWorldDungeonSaveMe &&
        (prior.battle.origin.kind === "world" || prior.battle.origin.kind === "dungeon")
      ) {
        const returned = this.legacy.completeSourceSaveMeReturnForContinuation(
          toOfficialGameStateV11(prior),
          restored.party,
          restored.profile,
          restored.quests,
          replay,
          context.now,
          events,
          sourceDungeonPopulationInheritance,
          true,
        );
        const { pendingDefeat: _pendingDefeat, ...withoutPendingDefeat } = prior;
        const nextState = {
          ...withoutPendingDefeat,
          ...createOfficialGameStateV12(returned.state),
          collectionClaims: structuredClone(prior.collectionClaims),
          nextContinuationSequence: prior.nextContinuationSequence,
        } as unknown as OfficialGameStateV12;
        delete (nextState as { battle?: unknown }).battle;
        validateOfficialGameV12Envelope(nextState);
        return {
          state: structuredClone(nextState),
          projection: parseOfficialGameProjectionV12(
            projectV12ContinuationBody(returned.projection, nextState),
          ),
          events: returned.events,
        };
      }
      const restarted = this.legacy.restartDefeatedBattleForContinuation(
        toOfficialGameStateV11(prior),
        restored.party,
        restored.profile,
        restored.quests,
        events,
        chargeBattleSpiritEnergy,
        (context as CommandReducerContext<OfficialGameStateV12> & OfficialInternalReductionContext)[sourceJobLevelRules] === true,
      );
      const { pendingDefeat: _pendingDefeat, ...withoutPendingDefeat } = prior;
      const nextState = {
        ...withoutPendingDefeat,
        ...createOfficialGameStateV12(restarted.state),
        collectionClaims: structuredClone(prior.collectionClaims),
        nextContinuationSequence: prior.nextContinuationSequence,
      } satisfies OfficialGameStateV12;
      const restartedBattle = nextState.battle;
      if (nextState.location.kind !== "battle" || restartedBattle === undefined) {
        throw new GameServiceError("STATE_CORRUPT", "Save Me restart did not retain its battle");
      }
      const restartedReplay = restoreBattleReplay(
        this.legacy.gameDataForContinuation(),
        restartedBattle.replay,
      );
      let finalState = nextState;
      let ordinaryProjection = restarted.projection;
      let finalEvents = restarted.events;
      if (restartedReplay.step.type === "ended" && restartedReplay.step.report.winner === 1) {
        const canSaveMe = canOfferSaveMe({
          blockSaveMe: officialBattleBlocksSaveMe(nextState),
          tutorialSeen: restored.profile.hasTutorialFlag("SaveMe"),
          heroLevel: restored.profile.heroLevel,
          gold: restored.profile.snapshot().gold,
        });
        if (canSaveMe) restored.profile.claimTutorialFlag("SaveMe");
        const allocation = allocateOfficialContinuationIdentity(nextState);
        finalState = {
          ...nextState,
          profile: restored.profile.stateSnapshot(),
          party: restored.party.stateSnapshot(),
          quests: restored.quests.stateSnapshot(),
          nextContinuationSequence: allocation.allocation.nextContinuationSequence,
          pendingDefeat: {
            schemaVersion: 1,
            kind: "defeat",
            decisionId: allocation.allocation.decisionId,
            battleId: restartedBattle.battleId,
            canSaveMe,
          },
        };
        ordinaryProjection = this.legacy.projectForContinuation(
          toOfficialGameStateV11(finalState),
          restored.party,
          restored.profile,
          restored.quests,
        );
        if (!finalEvents.some((event) =>
          event.type === "battle.ended" && event.battleId === restartedBattle.battleId)) {
          finalEvents = [...finalEvents, {
            type: "battle.ended",
            battleId: restartedBattle.battleId,
            outcome: "defeat",
          }];
        }
      }
      validateOfficialGameV12Envelope(finalState);
      return {
        state: structuredClone(finalState),
        projection: parseOfficialGameProjectionV12(
          projectV12ContinuationBody(ordinaryProjection, finalState),
        ),
        events: finalEvents,
      };
    }

    const consequencePrior = this.legacy.applyDeferredDefeatConsequencesForContinuation(
      toOfficialGameStateV11(prior),
      prior.battle,
      replay,
      restored.profile,
      restored.quests,
      events,
      sourceDungeonPopulationInheritance,
    );
    const returned = this.legacy.completeDefeatReturn(
      consequencePrior,
      restored.party,
      restored.profile,
      restored.quests,
      prior.world!,
      context.now,
      events,
      restorePartyOnOrdinaryReturn,
    );
    const core = this.legacy.snapshotForContinuation(
      consequencePrior,
      restored.party,
      restored.profile,
      restored.quests,
      returned.location,
      returned.world,
      undefined,
      null,
    );
    const { pendingDefeat: _pendingDefeat, ...withoutPendingDefeat } = prior;
    const nextState = {
      ...createOfficialGameStateV12(core),
      ...withoutPendingDefeat,
      profile: restored.profile.stateSnapshot(),
      party: restored.party.stateSnapshot(),
      quests: restored.quests.stateSnapshot(),
      location: returned.location,
      world: returned.world,
      battle: undefined,
      dungeon: undefined,
      collectionClaims: structuredClone(prior.collectionClaims),
      nextContinuationSequence: prior.nextContinuationSequence,
    } as unknown as OfficialGameStateV12;
    delete (nextState as { battle?: unknown }).battle;
    delete (nextState as { dungeon?: unknown }).dungeon;
    validateOfficialGameV12Envelope(nextState);
    return {
      state: structuredClone(nextState),
      projection: parseOfficialGameProjectionV12(
        projectV12ContinuationBody(
          this.legacy.projectForContinuation(
            toOfficialGameStateV11(nextState),
            restored.party,
            restored.profile,
            restored.quests,
          ),
          nextState,
        ),
      ),
      events,
    };
  }

  private applyEggCommand(
    context: CommandReducerContext<OfficialGameStateV12>,
    prior: OfficialGameStateV12,
    command: Extract<
      GameCommandV1,
      { type: "egg.start" | "egg.release" | "egg.resolvePrize" | "egg.repeat" | "egg.finish" }
    >,
    sourceEggRng: boolean,
  ): CommandReducerResult<OfficialGameStateV12, OfficialGameProjectionBodyV12> {
    const current = prior.pendingEgg;
    if (current === undefined) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", `${command.type} requires a pending Egg`);
    }
    const restored = this.legacy.restoreForContinuation(toOfficialGameStateV11(prior));
    let nextContinuationSequence = prior.nextContinuationSequence;
    const reserveDecisionIdentity = (route: string): { readonly nextDecisionId: () => string } => {
      const transition = allocateOfficialContinuationIdentity({
        ...prior,
        nextContinuationSequence,
      });
      nextContinuationSequence = transition.allocation.nextContinuationSequence;
      let consumed = false;
      return {
        nextDecisionId: () => {
          if (consumed) throw new GameServiceError("STATE_CORRUPT", `${route} allocated its decision twice`);
          consumed = true;
          return transition.allocation.decisionId;
        },
      };
    };
    let pendingEgg: OfficialEggContinuation | undefined;
    let events: UnsequencedPresentationEventV1[] = [];
    const proof = this.support.eggSupport;
    validateGeneratedOfficialEggContinuation(
      this.legacy.gameDataForContinuation(),
      proof,
      current,
    );

    if (command.type === "egg.start") {
      const identity = reserveDecisionIdentity("egg.start");
      pendingEgg = startOfficialEgg({
        continuation: current,
        game: this.legacy.gameDataForContinuation(),
        player: officialEggPlayerView(restored.profile),
        rng: replayableRng([], this.legacy.randomForContinuation()),
        rngRules: sourceEggRng ? "source" : "legacy-v22",
        identity,
      });
      validateGeneratedOfficialEggContinuation(this.legacy.gameDataForContinuation(), proof, pendingEgg);
    } else if (command.type === "egg.release") {
      const identity = reserveDecisionIdentity("egg.release");
      pendingEgg = releaseOfficialEgg({
        continuation: current,
        rng: replayableRng([], this.legacy.randomForContinuation()),
        rngRules: sourceEggRng ? "source" : "legacy-v22",
        identity,
        // The player's release point. It is committed here, before the friction draw inside
        // releaseOfficialEgg decides where the reel actually stops.
        ...(command.heldFrames === undefined ? {} : { heldFrames: command.heldFrames }),
      });
      validateGeneratedOfficialEggContinuation(this.legacy.gameDataForContinuation(), proof, pendingEgg);
    } else if (command.type === "egg.resolvePrize") {
      if (current.phase !== "awaiting-prize-resolution") {
        throw new GameServiceError("ACTION_NOT_ALLOWED", "egg.resolvePrize requires a landed Egg prize");
      }
      // The persisted landing is an input boundary. Recompute its prize from the committed reel
      // before reserving an identity or touching profile/party state; this path consumes no RNG.
      const replayedLanding = replayOfficialEggLanding(current);
      validateGeneratedOfficialEggPrize(this.legacy.gameDataForContinuation(), proof, replayedLanding);
      const identity = reserveDecisionIdentity("egg.resolvePrize");
      const resolved = resolveOfficialEggPrize({
        continuation: current,
        resolution: command.resolution,
        recipientResolver: {
          resolveRecipient: (recipientInstanceId) => {
            try {
              const recipient = restored.party.monster(recipientInstanceId);
              return { level: recipient.level };
            } catch {
              return undefined;
            }
          },
        },
        identity,
      });
      validateOfficialEggSettlementForAggregate(
        this.legacy.gameDataForContinuation(),
        resolved.settlement,
      );
      const applied = applyOfficialEggPrizeSettlement(
        this.legacy.gameDataForContinuation(),
        resolved.settlement,
        restored.party,
        restored.profile,
        prior.nextMonsterSequence,
      );
      pendingEgg = resolved.continuation;
      events = [...applied.events];
      const nextState = replaceOfficialV12State(
        prior,
        pendingEgg,
        restored.party,
        restored.profile,
        restored.quests,
        nextContinuationSequence,
        applied.nextMonsterSequence,
      );
      return {
        state: nextState,
        projection: parseOfficialGameProjectionV12(
          projectV12ContinuationBody(
            this.legacy.projectForContinuation(
              toOfficialGameStateV11(nextState),
              restored.party,
              restored.profile,
              restored.quests,
            ),
            nextState,
          ),
        ),
        events,
      };
    } else if (command.type === "egg.repeat") {
      const identity = reserveDecisionIdentity("egg.repeat");
      const before = restored.profile.snapshot();
      const repeated = repeatOfficialEgg({
        continuation: current,
        game: this.legacy.gameDataForContinuation(),
        player: officialEggPlayerView(restored.profile),
        rng: replayableRng([], this.legacy.randomForContinuation()),
        rngRules: sourceEggRng ? "source" : "legacy-v22",
        goldBalance: { gold: before.gold },
        identity,
      });
      validateGeneratedOfficialEggContinuation(this.legacy.gameDataForContinuation(), proof, repeated.continuation);
      if (!restored.profile.spendGold(repeated.goldCost)) {
        throw new GameServiceError("STATE_CORRUPT", "Egg repeat balance changed during settlement");
      }
      pendingEgg = repeated.continuation;
      events = [{
        type: "player.currencyChanged",
        currency: "gold",
        delta: -repeated.goldCost,
        balance: restored.profile.snapshot().gold,
      }];
    } else {
      finishOfficialEgg(current);
      pendingEgg = undefined;
    }

    const nextState = replaceOfficialV12State(
      prior,
      pendingEgg,
      restored.party,
      restored.profile,
      restored.quests,
      nextContinuationSequence,
      prior.nextMonsterSequence,
    );
    return {
      state: nextState,
      projection: parseOfficialGameProjectionV12(
        projectV12ContinuationBody(
          this.legacy.projectForContinuation(
            toOfficialGameStateV11(nextState),
            restored.party,
            restored.profile,
            restored.quests,
          ),
          nextState,
        ),
      ),
      events,
    };
  }
}

/**
 * The v13 aggregate is the v12 rules with the presentation boundary closed: a battle projects the
 * semantic scene it is fought in instead of a shipped combat-background file name. State, commands,
 * events, RNG, and every settlement rule are v12's, so this layer delegates to a v12 reducer rather
 * than restating them. The operator holds both descriptors: v13 is what players are told they are
 * running, v12 is the internal rules identity the delegate is bound to.
 */
export type OfficialGameStateV13 = OfficialGameStateV12;

/** Strip the historical presentation field from a migrated battle. */
export function cloneOfficialGameStateV13(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV13 {
  const cloned = parseOfficialGameStateV12(data, quests, structuredClone(state), context);
  return withoutLegacyBattleBackground(cloned);
}

function withoutLegacyBattleBackground(cloned: OfficialGameStateV12): OfficialGameStateV13 {
  if (cloned.battle === undefined) return cloned;
  const { backgroundKey: _legacy, ...encounter } = cloned.battle.encounter;
  return {
    ...cloned,
    battle: { ...cloned.battle, encounter: encounter as OfficialBattleEncounterV1 },
  };
}

/** Replace the historical `backgroundKey` with the semantic scene taken from the battle's origin. */
export function projectOfficialGameStateV13(
  body: OfficialGameProjectionBodyV12,
  state: OfficialGameStateV13,
): OfficialGameProjectionBodyV13 {
  if (body.battle === undefined) return body as OfficialGameProjectionBodyV13;
  if (state.battle === undefined) {
    throw new Error("official v13 projection has a battle view without battle state");
  }
  const { backgroundKey: _legacy, ...battle } = body.battle;
  return {
    ...body,
    battle: { ...battle, scene: officialBattleScene(state.battle.origin) },
  };
}

export function parseOfficialGameStateV13(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV13 {
  return parseOfficialGameStateV12(data, quests, value, context);
}

/** Strictly validate a v13 body-shaped projection and return a detached copy. */
export function parseOfficialGameProjectionV13(
  value: unknown,
): OfficialGameProjectionBodyV13 {
  assertJsonSafeTree(value, "official v13 projection");
  assertPlainObject(value, "official v13 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v13 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV13Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V13_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(projectionBody(parsed) as OfficialGameProjectionBodyV13);
}

/**
 * Migrate an installed v12 slot. The aggregate is unchanged, so this only drops the stored
 * background file name and reprojects; every gameplay field carries across untouched.
 */
export function migrateOfficialGameV12ToV13(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  /** Accepts the untrusted stored value; `cloneOfficialGameStateV13` parses it strictly. */
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV13 {
  return cloneOfficialGameStateV13(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

/** Construct a v13 descriptor from the same proof-bound v12 support seam. */
export function createOfficialGameV13LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v12 = createOfficialGameV12LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v12,
    simulationVersion: OFFICIAL_GAME_V13_SIMULATION_VERSION,
    capabilities: { ...v12.capabilities, commandTypes: [...v12.capabilities.commandTypes] },
  }));
}

export class OfficialGameV13Reducer implements GameCommandReducer<
  OfficialGameStateV13,
  OfficialGameProjectionBodyV13
> {
  /**
   * `v12Pack` is the descriptor the delegate is provenance-bound to. It is never advertised to a
   * player and never written into a slot; the installed identity is the v13 descriptor.
   */
  constructor(
    private readonly v12: OfficialGameV12Reducer,
    private readonly v12Pack: LogicPackDescriptorV1,
  ) {
    if (v12Pack.simulationVersion !== OFFICIAL_GAME_V12_SIMULATION_VERSION) {
      throw new Error("OfficialGameV13Reducer requires the bound official-game-v12 delegate pack");
    }
  }

  private requireV13Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V13_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV13Reducer requires the official-game-v13 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v12Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v13 pack does not share its bound v12 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV13, OfficialGameProjectionBodyV13>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v13 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV13(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V13_SIMULATION_VERSION) {
        throw new Error("official v13 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v13 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV13): OfficialGameProjectionBodyV13 {
    return projectOfficialGameStateV13(this.v12.projectPersistedState(state), state);
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV13>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV13, OfficialGameProjectionBodyV13> {
    this.requireV13Pack(context.pack);
    const result = this.v12.apply({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV13(result.projection, result.state),
    };
  }
}

/**
 * v14 keeps v13's archive-neutral wire and changes only deferred defeat settlement: ordinary return
 * commits the loss, while Save Me replaces the terminal battle with the same encounter and healed
 * party. The aggregate schema remains v12's strict continuation envelope.
 */
export type OfficialGameStateV14 = OfficialGameStateV13;

export function cloneOfficialGameStateV14(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV14 {
  return withoutLegacyBattleBackground(parseOfficialGameStateV12WithDefeatBehavior(
    data,
    quests,
    structuredClone(state),
    context,
    true,
  ));
}

export function projectOfficialGameStateV14(
  body: OfficialGameProjectionBodyV12,
  state: OfficialGameStateV14,
): OfficialGameProjectionBodyV14 {
  return parseOfficialGameProjectionV14(projectOfficialGameStateV13(body, state));
}

export function parseOfficialGameStateV14(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV14 {
  return parseOfficialGameStateV12WithDefeatBehavior(data, quests, value, context, true);
}

/** Strictly validate a v14 body-shaped projection and return a detached copy. */
export function parseOfficialGameProjectionV14(
  value: unknown,
): OfficialGameProjectionBodyV14 {
  assertJsonSafeTree(value, "official v14 projection");
  assertPlainObject(value, "official v14 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v14 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV14Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V14_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(projectionBody(parsed) as OfficialGameProjectionBodyV14);
}

/** v13-to-v14 migration is state-preserving; the new behavior starts with the next command. */
export function migrateOfficialGameV13ToV14(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV14 {
  return cloneOfficialGameStateV14(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

/** Construct the installed v14 descriptor from the same proof-bound support seam. */
export function createOfficialGameV14LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v12 = createOfficialGameV12LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v12,
    simulationVersion: OFFICIAL_GAME_V14_SIMULATION_VERSION,
    capabilities: { ...v12.capabilities, commandTypes: [...v12.capabilities.commandTypes] },
  }));
}

export class OfficialGameV14Reducer implements GameCommandReducer<
  OfficialGameStateV14,
  OfficialGameProjectionBodyV14
> {
  constructor(
    private readonly v12: OfficialGameV12Reducer,
    private readonly v12Pack: LogicPackDescriptorV1,
  ) {
    if (v12Pack.simulationVersion !== OFFICIAL_GAME_V12_SIMULATION_VERSION) {
      throw new Error("OfficialGameV14Reducer requires the bound official-game-v12 delegate pack");
    }
  }

  private requireV14Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V14_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV14Reducer requires the official-game-v14 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v12Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v14 pack does not share its bound v12 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV14, OfficialGameProjectionBodyV14>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v14 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV14(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V14_SIMULATION_VERSION) {
        throw new Error("official v14 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v14 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV14): OfficialGameProjectionBodyV14 {
    return projectOfficialGameStateV14(this.v12.projectPersistedStateForV14(state), state);
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV14>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV14, OfficialGameProjectionBodyV14> {
    this.requireV14Pack(context.pack);
    const result = this.v12.applyForV14({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV14(result.projection, result.state),
    };
  }

}

/**
 * v15 keeps v14's archive-neutral state and wire shape. Its only forward behavior change is that
 * an ordinary defeat return restores the durable party as part of entering town.
 */
export type OfficialGameStateV15 = OfficialGameStateV14;

export function cloneOfficialGameStateV15(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV15 {
  return cloneOfficialGameStateV14(data, quests, state, context);
}

export function projectOfficialGameStateV15(
  body: OfficialGameProjectionBodyV12,
  state: OfficialGameStateV15,
): OfficialGameProjectionBodyV15 {
  return parseOfficialGameProjectionV15(projectOfficialGameStateV14(body, state));
}

export function parseOfficialGameStateV15(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV15 {
  return parseOfficialGameStateV14(data, quests, value, context);
}

/** Strictly validate a v15 body-shaped projection and return a detached copy. */
export function parseOfficialGameProjectionV15(
  value: unknown,
): OfficialGameProjectionBodyV15 {
  assertJsonSafeTree(value, "official v15 projection");
  assertPlainObject(value, "official v15 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v15 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV15Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V15_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(projectionBody(parsed) as OfficialGameProjectionBodyV15);
}

/**
 * Repair the persisted v14 town-entry omission only when the record proves it is at town, or its
 * last location command proves it just left town. Active battles and unrelated world states are
 * cloned without a gameplay transition.
 */
export function migrateOfficialGameV14ToV15(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly updatedAt: string;
  readonly lastLocationCommand?: GameCommandV1;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV15 {
  const state = cloneOfficialGameStateV15(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
  const shouldRestore = state.location.kind === "town" ||
    (state.location.kind === "world" && options.lastLocationCommand?.type === "world.leaveTown");
  if (!shouldRestore) return state;

  const commitSeconds = Date.parse(options.updatedAt) / 1_000;
  if (!Number.isFinite(commitSeconds)) {
    throw new Error("official-game-v14 migration has an invalid commit time");
  }
  const party = WorldTripParty.fromStateSnapshot(options.data, state.party);
  const profile = PlayerProfile.fromStateSnapshot(
    state.profile,
    party.monsters().map(({ level }) => level),
    party,
    profileRestoreOptions(options.data, state.profile),
  );
  party.setPlayerBuffSource(() => profile.battleStatBonuses());
  party.restoreAtTown(commitSeconds);
  return parseOfficialGameStateV15(
    options.data,
    options.quests,
    { ...state, party: party.stateSnapshot() },
    options.context ?? {},
  );
}

/** Construct the installed v15 descriptor from the same proof-bound support seam. */
export function createOfficialGameV15LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v12 = createOfficialGameV12LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v12,
    simulationVersion: OFFICIAL_GAME_V15_SIMULATION_VERSION,
    capabilities: { ...v12.capabilities, commandTypes: [...v12.capabilities.commandTypes] },
  }));
}

export class OfficialGameV15Reducer implements GameCommandReducer<
  OfficialGameStateV15,
  OfficialGameProjectionBodyV15
> {
  constructor(
    private readonly v12: OfficialGameV12Reducer,
    private readonly v12Pack: LogicPackDescriptorV1,
  ) {
    if (v12Pack.simulationVersion !== OFFICIAL_GAME_V12_SIMULATION_VERSION) {
      throw new Error("OfficialGameV15Reducer requires the bound official-game-v12 delegate pack");
    }
  }

  private requireV15Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V15_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV15Reducer requires the official-game-v15 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v12Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v15 pack does not share its bound v12 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV15, OfficialGameProjectionBodyV15>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v15 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV15(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V15_SIMULATION_VERSION) {
        throw new Error("official v15 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v15 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV15): OfficialGameProjectionBodyV15 {
    return projectOfficialGameStateV15(this.v12.projectPersistedStateForV14(state), state);
  }

  /** Internal v16 projection path; v15's public projection remains immutable. */
  projectPersistedStateForV16(state: OfficialGameStateV15): OfficialGameProjectionBodyV15 {
    return projectOfficialGameStateV15(this.v12.projectPersistedStateForV16(state), state);
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV15({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

  /** Internal v22 delegate entry; v15 stays immutable while the v12 core uses source Save Me. */
  applyForV22(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV22({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

  /** Internal v23 delegate; earlier public simulation behavior remains immutable. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV23({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV25({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

  /** Internal v21 delegate entry; v15 stays immutable while the v12 core admits Arena Escape. */
  applyForV21(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV21({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

  /** Internal v18 delegate entry; v15's public behavior remains immutable. */
  applyForV18(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV18({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

  /** Internal v16 delegate entry. The v15 descriptor remains the identity bridge while the v12
   * core selects v16's dungeon-treasure and battle-spirit settlement behavior. */
  applyForV16(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV16({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

  /** Internal v19 delegate entry; v15 remains immutable while the bound v12 core enables the
   * replay-derived Tournament Escape settlement. */
  applyForV19(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV19({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

  /** Internal v20 delegate entry; v15 remains immutable while the bound v12 core selects the
   * source-faithful Tournament Save Me town return. */
  applyForV20(
    context: CommandReducerContext<OfficialGameStateV15>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV15, OfficialGameProjectionBodyV15> {
    this.requireV15Pack(context.pack);
    const result = this.v12.applyForV20({ ...context, pack: this.v12Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV15(result.projection, result.state),
    };
  }

}

/** v16 keeps v15 state, adds archive-neutral reconnect lifecycle metadata, defers guarded dungeon
 * treasure settlement to dungeon.openTreasure, and owns durable battle-damage spirit charging. */
export type OfficialGameStateV16 = OfficialGameStateV15;

export function cloneOfficialGameStateV16(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV16 {
  return cloneOfficialGameStateV15(data, quests, state, context);
}

export function projectOfficialGameStateV16(
  body: OfficialGameProjectionBodyV15,
  state: OfficialGameStateV16,
): OfficialGameProjectionBodyV16 {
  const projected = parseOfficialGameProjectionV15(body);
  if (projected.battle === undefined || state.battle === undefined) {
    return parseOfficialGameProjectionV16(projected);
  }
  const chat = state.battle.encounter.kind === "dungeon"
    ? undefined
    : state.battle.encounter.generated.winEvent?.chat;
  return parseOfficialGameProjectionV16({
    ...projected,
    battle: {
      ...projected.battle,
      ...(chat === undefined
        ? {}
        : {
            winChat: {
              name: chat.name,
              alwaysShow: chat.alwaysShow,
              messageKeys: [...chat.messageKeys],
            },
          }),
    },
  });
}

export function parseOfficialGameStateV16(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV16 {
  return parseOfficialGameStateV15(data, quests, value, context);
}

/** Strictly validate a v16 body-shaped projection and return a detached copy. */
export function parseOfficialGameProjectionV16(
  value: unknown,
): OfficialGameProjectionBodyV16 {
  assertJsonSafeTree(value, "official v16 projection");
  assertPlainObject(value, "official v16 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v16 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV16Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V16_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(projectionBody(parsed) as OfficialGameProjectionBodyV16);
}

/** Enter the immutable v16 namespace and consume a provably terminal-settled v15 dungeon chest.
 * V15 granted guarded encounter loot during victory but left the cleared room's treasure ID
 * uncollected. Without this narrow repair, a keyless chest could be granted again by v16 Take All. */
export function migrateOfficialGameV15ToV16(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV16 {
  const state = cloneOfficialGameStateV16(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
  if (state.dungeon === undefined) return state;

  const party = WorldTripParty.fromStateSnapshot(options.data, state.party);
  const profile = PlayerProfile.fromStateSnapshot(
    state.profile,
    party.monsters().map(({ level }) => level),
    party,
    profileRestoreOptions(options.data, state.profile),
  );
  const questRuntime = new GuildQuestRuntime(options.quests, state.quests);
  const resources = options.context?.dungeonResources;
  if (resources === undefined) {
    throw new Error("authoritative dungeon resources are unavailable for v15-to-v16 migration");
  }
  const runtimeContext = {
    resources,
    monsterTypes: options.data.allMonsters().map(({ shortType }) => shortType),
    legacyDungeonGenerationSemantics: true,
    isCompletionSet: (key: string) => questRuntime.hasCompletedFixedEncounter(key),
    isQuestUsable: (key: string) => questRuntime.canUseQuestKey(key),
    isMonsterRegistered: (shortType: string) => profile.highestRegisteredLevel(shortType) > 0,
    isCatchQuestDone: (instanceName: string) => profile.hasCompletedCatchQuest(instanceName),
  };
  const sourceRun = state.dungeon.run;
  let changed = false;
  const cachedFloors = sourceRun.cachedFloors.map((entry) => {
    // A run retains every generated floor and duplicates the active floor in `current`. Rotate
    // each immutable cache entry through the strict restorer so the generated encounter/treasure
    // identities are validated against its own route and seed before repairing only the marker.
    const floor = DungeonRuntimeController.restore(runtimeContext, {
      ...sourceRun,
      current: entry,
    }).session.state;
    const cleared = new Set(entry.session.clearedEncounterIds);
    const collected = new Set(entry.session.collectedTreasureIds);
    for (const room of floor.rooms) {
      const encounter = room.encounter;
      const treasure = encounter?.treasure;
      if (encounter !== undefined && treasure !== undefined && cleared.has(encounter.id)) {
        collected.add(treasure.id);
      }
    }
    if (collected.size === entry.session.collectedTreasureIds.length) return entry;
    changed = true;
    return {
      ...entry,
      session: {
        ...entry.session,
        collectedTreasureIds: [...collected],
      },
    };
  });
  if (!changed) return state;
  const current = cachedFloors.find(({ route }) =>
    route.typeName === sourceRun.current.route.typeName &&
    route.sourceFile === sourceRun.current.route.sourceFile &&
    route.floor === sourceRun.current.route.floor,
  );
  if (current === undefined) throw new Error("authoritative dungeon current floor is absent from cache");
  return cloneOfficialGameStateV16(
    options.data,
    options.quests,
    {
      ...state,
      dungeon: {
        ...state.dungeon,
        run: { ...sourceRun, current, cachedFloors },
      },
    },
    options.context ?? {},
  );
}

export function createOfficialGameV16LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v15 = createOfficialGameV15LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v15,
    simulationVersion: OFFICIAL_GAME_V16_SIMULATION_VERSION,
    capabilities: { ...v15.capabilities, commandTypes: [...v15.capabilities.commandTypes] },
  }));
}

export class OfficialGameV16Reducer implements GameCommandReducer<
  OfficialGameStateV16,
  OfficialGameProjectionBodyV16
> {
  constructor(
    private readonly v15: OfficialGameV15Reducer,
    private readonly v15Pack: LogicPackDescriptorV1,
  ) {
    if (v15Pack.simulationVersion !== OFFICIAL_GAME_V15_SIMULATION_VERSION) {
      throw new Error("OfficialGameV16Reducer requires the bound official-game-v15 delegate pack");
    }
  }

  private requireV16Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V16_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV16Reducer requires the official-game-v16 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v15Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v16 pack does not share its bound v15 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV16, OfficialGameProjectionBodyV16>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v16 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV16(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V16_SIMULATION_VERSION) {
        throw new Error("official v16 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v16 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV16): OfficialGameProjectionBodyV16 {
    return projectOfficialGameStateV16(this.v15.projectPersistedStateForV16(state), state);
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV16>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV16, OfficialGameProjectionBodyV16> {
    this.requireV16Pack(context.pack);
    const result = this.v15.applyForV16({ ...context, pack: this.v15Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV16(result.projection, result.state),
    };
  }

  /** Internal v22 delegate entry; v16 stays immutable while passing source Save Me settlement. */
  applyForV22(
    context: CommandReducerContext<OfficialGameStateV16>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV16, OfficialGameProjectionBodyV16> {
    this.requireV16Pack(context.pack);
    const result = this.v15.applyForV22({ ...context, pack: this.v15Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV16(result.projection, result.state),
    };
  }

  /** Internal v23 delegate; earlier public simulation behavior remains immutable. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV16>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV16, OfficialGameProjectionBodyV16> {
    this.requireV16Pack(context.pack);
    const result = this.v15.applyForV23({ ...context, pack: this.v15Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV16(result.projection, result.state),
    };
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV16>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV16, OfficialGameProjectionBodyV16> {
    this.requireV16Pack(context.pack);
    const result = this.v15.applyForV25({ ...context, pack: this.v15Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV16(result.projection, result.state),
    };
  }

  /** Internal v21 delegate entry; v16 stays immutable while passing the Arena Escape gate. */
  applyForV21(
    context: CommandReducerContext<OfficialGameStateV16>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV16, OfficialGameProjectionBodyV16> {
    this.requireV16Pack(context.pack);
    const result = this.v15.applyForV21({ ...context, pack: this.v15Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV16(result.projection, result.state),
    };
  }

  /** Internal v18 delegate entry; v16's public behavior remains immutable. */
  applyForV18(
    context: CommandReducerContext<OfficialGameStateV16>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV16, OfficialGameProjectionBodyV16> {
    this.requireV16Pack(context.pack);
    const result = this.v15.applyForV18({ ...context, pack: this.v15Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV16(result.projection, result.state),
    };
  }

  /** Internal v19 delegate entry; v16 remains immutable while passing the Tournament Escape gate. */
  applyForV19(
    context: CommandReducerContext<OfficialGameStateV16>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV16, OfficialGameProjectionBodyV16> {
    this.requireV16Pack(context.pack);
    const result = this.v15.applyForV19({ ...context, pack: this.v15Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV16(result.projection, result.state),
    };
  }

  /** Internal v20 delegate entry; v16 remains immutable while passing the Tournament Save Me
   * lifecycle gate. */
  applyForV20(
    context: CommandReducerContext<OfficialGameStateV16>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV16, OfficialGameProjectionBodyV16> {
    this.requireV16Pack(context.pack);
    const result = this.v15.applyForV20({ ...context, pack: this.v15Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV16(result.projection, result.state),
    };
  }
}







export type OfficialGameStateV17 = OfficialGameStateV16 & {
  readonly dungeonBattleReturn?: OfficialDungeonBattleReturnV1;
};

function officialGameStateWithoutV17Handoff(
  state: OfficialGameStateV17,
): OfficialGameStateV16 {
  const { dungeonBattleReturn: _handoff, ...v16 } = state;
  return v16;
}

function validateOfficialDungeonBattleReturn(
  state: OfficialGameStateV16,
  handoff: OfficialDungeonBattleReturnV1,
): void {
  if (
    state.location.kind !== "dungeon" ||
    state.dungeon === undefined ||
    state.location.dungeonId !== handoff.dungeonId ||
    state.location.floor !== handoff.floor ||
    state.location.roomId !== handoff.roomId
  ) {
    throw new Error("official v17 dungeon battle return disagrees with its dungeon location");
  }
  const retainedCatchTypes = new Set(state.dungeon.run.catchTypes);
  for (const shortType of handoff.catchTypesBeforeBattle) {
    if (!retainedCatchTypes.has(shortType)) {
      throw new Error(
        `official v17 dungeon battle return baseline contains unavailable ${shortType}`,
      );
    }
  }
}

export function parseOfficialGameStateV17(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV17 {
  assertJsonSafeTree(value, "official v17 game state");
  assertPlainObject(value, "official v17 game state");
  const {
    dungeonBattleReturn: sourceHandoff,
    ...sourceV16
  } = value as Record<string, unknown>;
  const state = cloneOfficialGameStateV16(data, quests, sourceV16, context);
  if (sourceHandoff === undefined) return state;
  const handoff = OfficialDungeonBattleReturnV1Schema.parse(sourceHandoff);
  validateOfficialDungeonBattleReturn(state, handoff);
  return {
    ...state,
    dungeonBattleReturn: structuredClone(handoff),
  };
}

export function cloneOfficialGameStateV17(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV17 {
  return parseOfficialGameStateV17(data, quests, structuredClone(state), context);
}

export function projectOfficialGameStateV17(
  body: OfficialGameProjectionBodyV16,
  state: OfficialGameStateV17,
): OfficialGameProjectionBodyV17 {
  const projected = parseOfficialGameProjectionV16(body);
  return parseOfficialGameProjectionV17({
    ...projected,
    ...(state.dungeonBattleReturn === undefined
      ? {}
      : { dungeonBattleReturn: structuredClone(state.dungeonBattleReturn) }),
  });
}

/** Strictly validate a v17 body-shaped projection and return a detached copy. */
export function parseOfficialGameProjectionV17(
  value: unknown,
): OfficialGameProjectionBodyV17 {
  assertJsonSafeTree(value, "official v17 projection");
  assertPlainObject(value, "official v17 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v17 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV17Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V17_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(projectionBody(parsed) as OfficialGameProjectionBodyV17);
}


export function migrateOfficialGameV16ToV17(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV17 {
  return cloneOfficialGameStateV17(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

export function createOfficialGameV17LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v16 = createOfficialGameV16LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v16,
    simulationVersion: OFFICIAL_GAME_V17_SIMULATION_VERSION,
    capabilities: { ...v16.capabilities, commandTypes: [...v16.capabilities.commandTypes] },
  }));
}

export class OfficialGameV17Reducer implements GameCommandReducer<
  OfficialGameStateV17,
  OfficialGameProjectionBodyV17
> {
  constructor(
    private readonly v16: OfficialGameV16Reducer,
    private readonly v16Pack: LogicPackDescriptorV1,
  ) {
    if (v16Pack.simulationVersion !== OFFICIAL_GAME_V16_SIMULATION_VERSION) {
      throw new Error("OfficialGameV17Reducer requires the bound official-game-v16 delegate pack");
    }
  }

  private requireV17Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V17_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV17Reducer requires the official-game-v17 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v16Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v17 pack does not share its bound v16 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV17, OfficialGameProjectionBodyV17>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v17 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV17(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V17_SIMULATION_VERSION) {
        throw new Error("official v17 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v17 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV17): OfficialGameProjectionBodyV17 {
    const v16State = officialGameStateWithoutV17Handoff(state);
    return projectOfficialGameStateV17(this.v16.projectPersistedState(v16State), state);
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    return this.applyVersioned(context, command, false);
  }

  /** Internal v18 delegate entry; v17's public behavior remains immutable. */
  applyForV18(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    return this.applyVersioned(context, command, true);
  }

  /** Internal v19 delegate entry; source town lifecycle remains enabled and the v12 core gets
   * the explicit Tournament Escape settlement gate. */
  applyForV19(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    return this.applyVersioned(context, command, true, true);
  }

  private applyVersioned(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
    sourceTownBattleLifecycle: boolean,
    allowTournamentRetreat = false,
    sourceTournamentSaveMe = false,
    allowArenaEscapeStall = false,
    sourceWorldDungeonSaveMe = false,
    sourceEggRng = false,
    sourceStoryRules = false,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    this.requireV17Pack(context.pack);
    const prior = context.state;
    const delegateContext = {
      ...context,
      pack: this.v16Pack,
      state: prior === undefined ? undefined : officialGameStateWithoutV17Handoff(prior),
    };
    const result = sourceStoryRules
      ? this.v16.applyForV25(delegateContext, command)
      : sourceEggRng
      ? this.v16.applyForV23(delegateContext, command)
      : sourceWorldDungeonSaveMe
      ? this.v16.applyForV22(delegateContext, command)
      : allowArenaEscapeStall
      ? this.v16.applyForV21(delegateContext, command)
      : sourceTournamentSaveMe
        ? this.v16.applyForV20(delegateContext, command)
      : allowTournamentRetreat
        ? this.v16.applyForV19(delegateContext, command)
      : sourceTownBattleLifecycle
        ? this.v16.applyForV18(delegateContext, command)
        : this.v16.apply(delegateContext, command);
    let terminal: { readonly battleId: string; readonly outcome: "victory" | "retreat" } | undefined;
    for (const event of result.events) {
      if (
        event.type === "battle.ended" &&
        (event.outcome === "victory" || event.outcome === "retreat")
      ) {
        terminal = { battleId: event.battleId, outcome: event.outcome };
        break;
      }
    }
    if (
      terminal === undefined &&
      sourceWorldDungeonSaveMe &&
      command.type === "battle.resolveDefeat" &&
      command.recovery === "saveMe" &&
      prior?.battle?.origin.kind === "dungeon" &&
      result.state.battle === undefined &&
      result.state.location.kind === "dungeon"
    ) {
      terminal = { battleId: command.battleId, outcome: "retreat" };
    }
    const dungeon = result.state.dungeon;
    const location = result.state.location;
    const handoff = terminal === undefined || prior?.dungeon === undefined ||
        dungeon === undefined || location.kind !== "dungeon"
      ? undefined
      : {
          schemaVersion: 1 as const,
          battleId: terminal.battleId,
          outcome: terminal.outcome,
          dungeonId: location.dungeonId,
          floor: location.floor,
          roomId: location.roomId,
          catchTypesBeforeBattle: [...prior.dungeon.run.catchTypes].sort(),
        } satisfies OfficialDungeonBattleReturnV1;
    const state: OfficialGameStateV17 = {
      ...result.state,
      ...(handoff === undefined ? {} : { dungeonBattleReturn: handoff }),
    };
    return {
      ...result,
      state,
      projection: projectOfficialGameStateV17(result.projection, state),
    };
  }

  /** Internal v20 delegate entry; v17 remains immutable while selecting v20's lower behavior. */
  applyForV20(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    return this.applyVersioned(context, command, true, true, true);
  }

  /** Internal v21 delegate entry; recovery bookkeeping stays outside the live Arena scene. */
  applyForV21(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    return this.applyVersioned(context, command, true, true, true, true);
  }

  /** Internal v22 delegate entry; dungeon Save Me emits the same retained return receipt as a
   * source retreat, while world settlement remains receipt-free. */
  applyForV22(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    return this.applyVersioned(context, command, true, true, true, true, true);
  }

  /** Internal v23 delegate; earlier public simulation behavior remains immutable. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    return this.applyVersioned(context, command, true, true, true, true, true, true);
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV17>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV17, OfficialGameProjectionBodyV17> {
    return this.applyVersioned(context, command, true, true, true, true, true, true, true);
  }
}

/** v18 keeps v17's strict state/wire and corrects town-origin WorldEncounter lifecycle behavior. */
export type OfficialGameStateV18 = OfficialGameStateV17;

export function parseOfficialGameStateV18(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV18 {
  return parseOfficialGameStateV17(data, quests, value, context);
}

export function cloneOfficialGameStateV18(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV18 {
  return parseOfficialGameStateV18(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV18(
  value: unknown,
): OfficialGameProjectionBodyV18 {
  assertJsonSafeTree(value, "official v18 projection");
  assertPlainObject(value, "official v18 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v18 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV18Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V18_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(projectionBody(parsed) as OfficialGameProjectionBodyV18);
}

export function projectOfficialGameStateV18(
  body: OfficialGameProjectionBodyV17,
): OfficialGameProjectionBodyV18 {
  return parseOfficialGameProjectionV18(body);
}

/** v17 and v18 have identical state shape; migration cannot fabricate a gameplay transition. */
export function migrateOfficialGameV17ToV18(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV18 {
  return cloneOfficialGameStateV18(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

export function createOfficialGameV18LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v17 = createOfficialGameV17LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v17,
    simulationVersion: OFFICIAL_GAME_V18_SIMULATION_VERSION,
    capabilities: { ...v17.capabilities, commandTypes: [...v17.capabilities.commandTypes] },
  }));
}

export class OfficialGameV18Reducer implements GameCommandReducer<
  OfficialGameStateV18,
  OfficialGameProjectionBodyV18
> {
  constructor(
    private readonly v17: OfficialGameV17Reducer,
    private readonly v17Pack: LogicPackDescriptorV1,
  ) {
    if (v17Pack.simulationVersion !== OFFICIAL_GAME_V17_SIMULATION_VERSION) {
      throw new Error("OfficialGameV18Reducer requires the bound official-game-v17 delegate pack");
    }
  }

  private requireV18Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V18_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV18Reducer requires the official-game-v18 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v17Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v18 pack does not share its bound v17 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV18, OfficialGameProjectionBodyV18>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v18 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV18(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V18_SIMULATION_VERSION) {
        throw new Error("official v18 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v18 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV18): OfficialGameProjectionBodyV18 {
    return projectOfficialGameStateV18(this.v17.projectPersistedState(state));
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV18>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV18, OfficialGameProjectionBodyV18> {
    this.requireV18Pack(context.pack);
    const result = this.v17.applyForV18({ ...context, pack: this.v17Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV18(result.projection),
    };
  }

  /** Internal v19 delegate entry; the v18 projection/state remain shape-identical while the
   * lower reducer permits only replay-derived Tournament Escape settlement. */
  applyForV19(
    context: CommandReducerContext<OfficialGameStateV18>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV18, OfficialGameProjectionBodyV18> {
    this.requireV18Pack(context.pack);
    const result = this.v17.applyForV19({ ...context, pack: this.v17Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV18(result.projection),
    };
  }

  /** Internal v20 delegate entry; v18 remains immutable while selecting Tournament Save Me's
   * source town return in the lower reducer. */
  applyForV20(
    context: CommandReducerContext<OfficialGameStateV18>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV18, OfficialGameProjectionBodyV18> {
    this.requireV18Pack(context.pack);
    const result = this.v17.applyForV20({ ...context, pack: this.v17Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV18(result.projection),
    };
  }

  /** Internal v21 delegate entry; v18 remains immutable while passing Arena Escape settlement. */
  applyForV21(
    context: CommandReducerContext<OfficialGameStateV18>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV18, OfficialGameProjectionBodyV18> {
    this.requireV18Pack(context.pack);
    const result = this.v17.applyForV21({ ...context, pack: this.v17Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV18(result.projection),
    };
  }

  /** Internal v22 delegate entry; v18 stays immutable while passing source Save Me settlement. */
  applyForV22(
    context: CommandReducerContext<OfficialGameStateV18>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV18, OfficialGameProjectionBodyV18> {
    this.requireV18Pack(context.pack);
    const result = this.v17.applyForV22({ ...context, pack: this.v17Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV18(result.projection),
    };
  }

  /** Internal v23 delegate; earlier public simulation behavior remains immutable. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV18>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV18, OfficialGameProjectionBodyV18> {
    this.requireV18Pack(context.pack);
    const result = this.v17.applyForV23({ ...context, pack: this.v17Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV18(result.projection),
    };
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV18>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV18, OfficialGameProjectionBodyV18> {
    this.requireV18Pack(context.pack);
    const result = this.v17.applyForV25({ ...context, pack: this.v17Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV18(result.projection),
    };
  }
}

/** v19 keeps v18's state shape and wire exactly; only Tournament Escape settlement is new. */
export type OfficialGameStateV19 = OfficialGameStateV18;

export function parseOfficialGameStateV19(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV19 {
  return parseOfficialGameStateV18(data, quests, value, context);
}

export function cloneOfficialGameStateV19(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV19 {
  return parseOfficialGameStateV19(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV19(
  value: unknown,
): OfficialGameProjectionBodyV19 {
  assertJsonSafeTree(value, "official v19 projection");
  assertPlainObject(value, "official v19 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v19 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV19Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V19_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV19),
  ) as unknown as OfficialGameProjectionBodyV19;
}

export function projectOfficialGameStateV19(
  body: OfficialGameProjectionBodyV18,
): OfficialGameProjectionBodyV19 {
  return parseOfficialGameProjectionV19(body);
}

/** v18-to-v19 migration is shape-preserving; the new behavior starts with the next command. */
export function migrateOfficialGameV18ToV19(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV19 {
  return cloneOfficialGameStateV19(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

export function createOfficialGameV19LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v18 = createOfficialGameV18LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v18,
    simulationVersion: OFFICIAL_GAME_V19_SIMULATION_VERSION,
    capabilities: { ...v18.capabilities, commandTypes: [...v18.capabilities.commandTypes] },
  }));
}

export class OfficialGameV19Reducer implements GameCommandReducer<
  OfficialGameStateV19,
  OfficialGameProjectionBodyV19
> {
  constructor(
    private readonly v18: OfficialGameV18Reducer,
    private readonly v18Pack: LogicPackDescriptorV1,
  ) {
    if (v18Pack.simulationVersion !== OFFICIAL_GAME_V18_SIMULATION_VERSION) {
      throw new Error("OfficialGameV19Reducer requires the bound official-game-v18 delegate pack");
    }
  }

  private requireV19Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V19_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV19Reducer requires the official-game-v19 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v18Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v19 pack does not share its bound v18 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV19, OfficialGameProjectionBodyV19>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v19 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV19(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V19_SIMULATION_VERSION) {
        throw new Error("official v19 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v19 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV19): OfficialGameProjectionBodyV19 {
    return projectOfficialGameStateV19(this.v18.projectPersistedState(state));
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV19>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV19, OfficialGameProjectionBodyV19> {
    this.requireV19Pack(context.pack);
    const result = this.v18.applyForV19({ ...context, pack: this.v18Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV19(result.projection),
    };
  }

  /** Internal v20 delegate entry; v19 remains immutable while the lower reducer enables only the
   * source-faithful Tournament Save Me settlement. */
  applyForV20(
    context: CommandReducerContext<OfficialGameStateV19>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV19, OfficialGameProjectionBodyV19> {
    this.requireV19Pack(context.pack);
    const result = this.v18.applyForV20({ ...context, pack: this.v18Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV19(result.projection),
    };
  }

  /** Internal v21 delegate entry; v19 remains immutable while passing Arena Escape settlement. */
  applyForV21(
    context: CommandReducerContext<OfficialGameStateV19>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV19, OfficialGameProjectionBodyV19> {
    this.requireV19Pack(context.pack);
    const result = this.v18.applyForV21({ ...context, pack: this.v18Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV19(result.projection),
    };
  }

  /** Internal v22 delegate entry; v19 stays immutable while passing source Save Me settlement. */
  applyForV22(
    context: CommandReducerContext<OfficialGameStateV19>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV19, OfficialGameProjectionBodyV19> {
    this.requireV19Pack(context.pack);
    const result = this.v18.applyForV22({ ...context, pack: this.v18Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV19(result.projection),
    };
  }

  /** Internal v23 delegate; earlier public simulation behavior remains immutable. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV19>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV19, OfficialGameProjectionBodyV19> {
    this.requireV19Pack(context.pack);
    const result = this.v18.applyForV23({ ...context, pack: this.v18Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV19(result.projection),
    };
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV19>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV19, OfficialGameProjectionBodyV19> {
    this.requireV19Pack(context.pack);
    const result = this.v18.applyForV25({ ...context, pack: this.v18Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV19(result.projection),
    };
  }
}

/** v20 keeps v19's strict state and wire exactly; Tournament Save Me now follows the source town
 * lifecycle after its atomic 100-gold recovery, while world/dungeon Save Me remain v14 restarts. */
export type OfficialGameStateV20 = OfficialGameStateV19;

export function parseOfficialGameStateV20(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV20 {
  return parseOfficialGameStateV19(data, quests, value, context);
}

export function cloneOfficialGameStateV20(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV20 {
  return parseOfficialGameStateV20(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV20(
  value: unknown,
): OfficialGameProjectionBodyV20 {
  assertJsonSafeTree(value, "official v20 projection");
  assertPlainObject(value, "official v20 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v20 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV20Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V20_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV20),
  ) as unknown as OfficialGameProjectionBodyV20;
}

export function projectOfficialGameStateV20(
  body: OfficialGameProjectionBodyV19,
): OfficialGameProjectionBodyV20 {
  return parseOfficialGameProjectionV20(body);
}

/** v19-to-v20 migration is shape-preserving; the new behavior starts with the next command. */
export function migrateOfficialGameV19ToV20(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV20 {
  return cloneOfficialGameStateV20(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

export function createOfficialGameV20LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v19 = createOfficialGameV19LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v19,
    simulationVersion: OFFICIAL_GAME_V20_SIMULATION_VERSION,
    capabilities: { ...v19.capabilities, commandTypes: [...v19.capabilities.commandTypes] },
  }));
}

export class OfficialGameV20Reducer implements GameCommandReducer<
  OfficialGameStateV20,
  OfficialGameProjectionBodyV20
> {
  constructor(
    private readonly v19: OfficialGameV19Reducer,
    private readonly v19Pack: LogicPackDescriptorV1,
  ) {
    if (v19Pack.simulationVersion !== OFFICIAL_GAME_V19_SIMULATION_VERSION) {
      throw new Error("OfficialGameV20Reducer requires the bound official-game-v19 delegate pack");
    }
  }

  private requireV20Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V20_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV20Reducer requires the official-game-v20 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v19Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v20 pack does not share its bound v19 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV20, OfficialGameProjectionBodyV20>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v20 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV20(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V20_SIMULATION_VERSION) {
        throw new Error("official v20 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v20 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV20): OfficialGameProjectionBodyV20 {
    return projectOfficialGameStateV20(this.v19.projectPersistedState(state));
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV20>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV20, OfficialGameProjectionBodyV20> {
    this.requireV20Pack(context.pack);
    const result = this.v19.applyForV20({ ...context, pack: this.v19Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV20(result.projection),
    };
  }

  /** Internal v21 delegate entry; v20 remains immutable while the lower reducer admits only the
   * replay-derived Arena Escape terminal. */
  applyForV21(
    context: CommandReducerContext<OfficialGameStateV20>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV20, OfficialGameProjectionBodyV20> {
    this.requireV20Pack(context.pack);
    const result = this.v19.applyForV21({ ...context, pack: this.v19Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV20(result.projection),
    };
  }

  /** Internal v22 delegate entry; v20 stays immutable while passing source Save Me settlement. */
  applyForV22(
    context: CommandReducerContext<OfficialGameStateV20>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV20, OfficialGameProjectionBodyV20> {
    this.requireV20Pack(context.pack);
    const result = this.v19.applyForV22({ ...context, pack: this.v19Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV20(result.projection),
    };
  }

  /** Internal v23 delegate; earlier public simulation behavior remains immutable. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV20>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV20, OfficialGameProjectionBodyV20> {
    this.requireV20Pack(context.pack);
    const result = this.v19.applyForV23({ ...context, pack: this.v19Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV20(result.projection),
    };
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV20>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV20, OfficialGameProjectionBodyV20> {
    this.requireV20Pack(context.pack);
    const result = this.v19.applyForV25({ ...context, pack: this.v19Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV20(result.projection),
    };
  }
}

/** v21 keeps v20 state/wire shape. Arena Escape remains an in-process state-6 dead-end while the
 * authority stores the origin town solely as restart/reconnect recovery. */
export type OfficialGameStateV21 = OfficialGameStateV20;

export function parseOfficialGameStateV21(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV21 {
  return parseOfficialGameStateV20(data, quests, value, context);
}

export function cloneOfficialGameStateV21(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV21 {
  return parseOfficialGameStateV21(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV21(
  value: unknown,
): OfficialGameProjectionBodyV21 {
  assertJsonSafeTree(value, "official v21 projection");
  assertPlainObject(value, "official v21 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v21 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV21Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V21_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV21),
  ) as unknown as OfficialGameProjectionBodyV21;
}

export function projectOfficialGameStateV21(
  body: OfficialGameProjectionBodyV20,
): OfficialGameProjectionBodyV21 {
  return parseOfficialGameProjectionV21(body);
}

/** v20-to-v21 migration is shape-preserving; Arena Escape changes only on a later command. */
export function migrateOfficialGameV20ToV21(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV21 {
  return cloneOfficialGameStateV21(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

export function createOfficialGameV21LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v20 = createOfficialGameV20LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v20,
    simulationVersion: OFFICIAL_GAME_V21_SIMULATION_VERSION,
    capabilities: { ...v20.capabilities, commandTypes: [...v20.capabilities.commandTypes] },
  }));
}

export class OfficialGameV21Reducer implements GameCommandReducer<
  OfficialGameStateV21,
  OfficialGameProjectionBodyV21
> {
  constructor(
    private readonly v20: OfficialGameV20Reducer,
    private readonly v20Pack: LogicPackDescriptorV1,
  ) {
    if (v20Pack.simulationVersion !== OFFICIAL_GAME_V20_SIMULATION_VERSION) {
      throw new Error("OfficialGameV21Reducer requires the bound official-game-v20 delegate pack");
    }
  }

  private requireV21Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V21_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV21Reducer requires the official-game-v21 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v20Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v21 pack does not share its bound v20 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV21, OfficialGameProjectionBodyV21>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v21 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV21(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V21_SIMULATION_VERSION) {
        throw new Error("official v21 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v21 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV21): OfficialGameProjectionBodyV21 {
    return projectOfficialGameStateV21(this.v20.projectPersistedState(state));
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV21>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV21, OfficialGameProjectionBodyV21> {
    this.requireV21Pack(context.pack);
    const result = this.v20.applyForV21({ ...context, pack: this.v20Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV21(result.projection),
    };
  }

  /** Internal v22 delegate entry; v21 remains immutable while the lower reducers settle source
   * World/Dungeon Save Me returns. */
  applyForV22(
    context: CommandReducerContext<OfficialGameStateV21>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV21, OfficialGameProjectionBodyV21> {
    this.requireV21Pack(context.pack);
    const result = this.v20.applyForV22({ ...context, pack: this.v20Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV21(result.projection),
    };
  }

  /** Internal v23 delegate; earlier public simulation behavior remains immutable. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV21>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV21, OfficialGameProjectionBodyV21> {
    this.requireV21Pack(context.pack);
    const result = this.v20.applyForV23({ ...context, pack: this.v20Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV21(result.projection),
    };
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV21>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV21, OfficialGameProjectionBodyV21> {
    this.requireV21Pack(context.pack);
    const result = this.v20.applyForV25({ ...context, pack: this.v20Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV21(result.projection),
    };
  }
}

/** v22 keeps v21's strict state/wire. World and Dungeon Save Me now settle through the source
 * retreat callbacks instead of fabricating a replacement battle. */
export type OfficialGameStateV22 = OfficialGameStateV21;

export function parseOfficialGameStateV22(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV22 {
  return parseOfficialGameStateV21(data, quests, value, context);
}

export function cloneOfficialGameStateV22(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV22 {
  return parseOfficialGameStateV22(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV22(
  value: unknown,
): OfficialGameProjectionBodyV22 {
  assertJsonSafeTree(value, "official v22 projection");
  assertPlainObject(value, "official v22 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v22 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV22Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V22_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV22),
  ) as unknown as OfficialGameProjectionBodyV22;
}

export function projectOfficialGameStateV22(
  body: OfficialGameProjectionBodyV21,
): OfficialGameProjectionBodyV22 {
  return parseOfficialGameProjectionV22(body);
}

/** v21-to-v22 migration is shape-preserving; source Save Me starts with the next command. */
export function migrateOfficialGameV21ToV22(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV22 {
  return cloneOfficialGameStateV22(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

export function createOfficialGameV22LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v21 = createOfficialGameV21LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v21,
    simulationVersion: OFFICIAL_GAME_V22_SIMULATION_VERSION,
    capabilities: { ...v21.capabilities, commandTypes: [...v21.capabilities.commandTypes] },
  }));
}

export class OfficialGameV22Reducer implements GameCommandReducer<
  OfficialGameStateV22,
  OfficialGameProjectionBodyV22
> {
  constructor(
    private readonly v21: OfficialGameV21Reducer,
    private readonly v21Pack: LogicPackDescriptorV1,
  ) {
    if (v21Pack.simulationVersion !== OFFICIAL_GAME_V21_SIMULATION_VERSION) {
      throw new Error("OfficialGameV22Reducer requires the bound official-game-v21 delegate pack");
    }
  }

  private requireV22Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V22_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV22Reducer requires the official-game-v22 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v21Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v22 pack does not share its bound v21 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV22, OfficialGameProjectionBodyV22>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v22 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV22(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V22_SIMULATION_VERSION) {
        throw new Error("official v22 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v22 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV22): OfficialGameProjectionBodyV22 {
    return projectOfficialGameStateV22(this.v21.projectPersistedState(state));
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV22>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV22, OfficialGameProjectionBodyV22> {
    this.requireV22Pack(context.pack);
    const result = this.v21.applyForV22({ ...context, pack: this.v21Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV22(result.projection),
    };
  }
  /** Internal v23 delegate; retain v22 public RNG behavior for historical receipts. */
  applyForV23(
    context: CommandReducerContext<OfficialGameStateV22>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV22, OfficialGameProjectionBodyV22> {
    this.requireV22Pack(context.pack);
    const result = this.v21.applyForV23({ ...context, pack: this.v21Pack }, command);
    return { ...result, projection: projectOfficialGameStateV22(result.projection) };
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV22>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV22, OfficialGameProjectionBodyV22> {
    this.requireV22Pack(context.pack);
    const result = this.v21.applyForV25({ ...context, pack: this.v21Pack }, command);
    return { ...result, projection: projectOfficialGameStateV22(result.projection) };
  }

}

/** v23 preserves state and corrects Egg RNG generation and release arithmetic. */
export type OfficialGameStateV23 = OfficialGameStateV22;

export function parseOfficialGameStateV23(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV23 {
  return parseOfficialGameStateV22(data, quests, value, context);
}

export function cloneOfficialGameStateV23(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV23 {
  return parseOfficialGameStateV23(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV23(
  value: unknown,
): OfficialGameProjectionBodyV23 {
  assertJsonSafeTree(value, "official v23 projection");
  assertPlainObject(value, "official v23 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v23 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV23Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V23_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV23),
  ) as unknown as OfficialGameProjectionBodyV23;
}

export function projectOfficialGameStateV23(
  body: OfficialGameProjectionBodyV22,
): OfficialGameProjectionBodyV23 {
  return parseOfficialGameProjectionV23(body);
}

/** v22-to-v23 migration is shape-preserving; source Egg RNG starts with the next command. */
export function migrateOfficialGameV22ToV23(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV23 {
  return cloneOfficialGameStateV23(
    options.data,
    options.quests,
    options.state,
    options.context ?? {},
  );
}

export function createOfficialGameV23LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v22 = createOfficialGameV22LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v22,
    simulationVersion: OFFICIAL_GAME_V23_SIMULATION_VERSION,
    capabilities: { ...v22.capabilities, commandTypes: [...v22.capabilities.commandTypes] },
  }));
}

export class OfficialGameV23Reducer implements GameCommandReducer<
  OfficialGameStateV23,
  OfficialGameProjectionBodyV23
> {
  constructor(
    private readonly v22: OfficialGameV22Reducer,
    private readonly v22Pack: LogicPackDescriptorV1,
  ) {
    if (v22Pack.simulationVersion !== OFFICIAL_GAME_V22_SIMULATION_VERSION) {
      throw new Error("OfficialGameV23Reducer requires the bound official-game-v22 delegate pack");
    }
  }

  private requireV23Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V23_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV23Reducer requires the official-game-v23 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v22Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v23 pack does not share its bound v22 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV23, OfficialGameProjectionBodyV23>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v23 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV23(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V23_SIMULATION_VERSION) {
        throw new Error("official v23 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v23 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV23): OfficialGameProjectionBodyV23 {
    return projectOfficialGameStateV23(this.v22.projectPersistedState(state));
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV23>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV23, OfficialGameProjectionBodyV23> {
    this.requireV23Pack(context.pack);
    const result = this.v22.applyForV23({ ...context, pack: this.v22Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV23(result.projection),
    };
  }

  /** Internal v25 delegate; earlier public simulation behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV23>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV23, OfficialGameProjectionBodyV23> {
    this.requireV23Pack(context.pack);
    const result = this.v22.applyForV25({ ...context, pack: this.v22Pack }, command);
    return { ...result, projection: projectOfficialGameStateV23(result.projection) };
  }
}

/** v24 preserves mechanics and projects archive-neutral fixed encounter identities. */
export type OfficialGameStateV24 = OfficialGameStateV23;

/** Read-only exhibition projection; it must never settle PvP changes into a campaign aggregate. */
export function projectOfficialPvpParty(data: GameData, state: OfficialGameStateV24): TeamMemberSetup[] {
  if (state.location.kind !== "town" || state.battle !== undefined || state.pendingEgg !== undefined || state.pendingDefeat !== undefined) {
    throw new Error("Return to town and finish the current campaign decision before entering PvP.");
  }
  const party = WorldTripParty.fromStateSnapshot(data, state.party);
  const profile = PlayerProfile.fromStateSnapshot(state.profile, party.monsters().map((monster) => monster.level), party,
    profileRestoreOptions(data, state.profile));
  party.setPlayerBuffSource(() => profile.battleStatBonuses());
  party.setBattingOrderSize(battingOrderSizeFor(data.license(profile.licenseType).battingOrderSize, profile.heroLevel,
    { infiniteDungeonHighestLevel: profile.infiniteDungeonHighestLevel }));
  const members = party.projectAliveBattingPrefix();
  if (!members.length) throw new Error("Your party has no healthy monsters. Heal your party before entering PvP.");
  return members.map(({ sourceInstanceId: _id, currentHp: _hp, ...member }) => member);
}

export function parseOfficialGameStateV24(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV24 {
  if (canonicalJsonValue(value) !== canonicalJsonValue(withoutEncounterRenderers(value))) {
    throw new Error("official v24 state contains encounter renderer data");
  }
  return parseOfficialGameStateV23(data, quests, value, {
    ...context,
    ...(context.dungeonResources === undefined ? {} : {
      dungeonResources: officialEncounterResources(context.dungeonResources),
    }),
  });
}

export function cloneOfficialGameStateV24(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV24 {
  return parseOfficialGameStateV24(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV24(
  value: unknown,
): OfficialGameProjectionBodyV24 {
  assertJsonSafeTree(value, "official v24 projection");
  assertPlainObject(value, "official v24 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v24 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV24Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V24_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV24),
  ) as unknown as OfficialGameProjectionBodyV24;
}

export function projectOfficialGameStateV24(
  body: OfficialGameProjectionBodyV23,
  state: OfficialGameStateV24,
): OfficialGameProjectionBodyV24 {
  const battle = state.battle;
  let fixedEncounter = null;
  if (battle?.encounter.kind === "world" && battle.encounter.generated.kind === "fixed") {
    fixedEncounter = { source: { kind: "world", tableKey: battle.encounter.generated.tableKey },
      members: battle.encounter.generated.monsters };
  } else if (battle?.encounter.kind === "dungeon" && battle.encounter.encounter.kind === "fixed") {
    fixedEncounter = { source: { kind: "dungeon", encounterId: battle.encounter.encounter.id },
      members: battle.encounter.encounter.monsters };
  }
  return parseOfficialGameProjectionV24({ ...body,
    ...(body.battle === undefined ? {} : { battle: { ...body.battle, fixedEncounter } }),
  });
}

/** Preserve mechanics while removing legacy archive renderers from all retained encounters. */
export function migrateOfficialGameV23ToV24(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV24 {
  return cloneOfficialGameStateV24(
    options.data,
    options.quests,
    withoutEncounterRenderers(options.state),
    options.context ?? {},
  );
}

export function createOfficialGameV24LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v23 = createOfficialGameV23LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v23,
    simulationVersion: OFFICIAL_GAME_V24_SIMULATION_VERSION,
    capabilities: { ...v23.capabilities, commandTypes: [...v23.capabilities.commandTypes] },
  }));
}

export class OfficialGameV24Reducer implements GameCommandReducer<
  OfficialGameStateV24,
  OfficialGameProjectionBodyV24
> {
  constructor(
    private readonly v23: OfficialGameV23Reducer,
    private readonly v23Pack: LogicPackDescriptorV1,
  ) {
    if (v23Pack.simulationVersion !== OFFICIAL_GAME_V23_SIMULATION_VERSION) {
      throw new Error("OfficialGameV24Reducer requires the bound official-game-v23 delegate pack");
    }
  }

  private requireV24Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V24_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV24Reducer requires the official-game-v24 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v23Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v24 pack does not share its bound v23 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV24, OfficialGameProjectionBodyV24>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v24 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV24(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V24_SIMULATION_VERSION) {
        throw new Error("official v24 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v24 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV24): OfficialGameProjectionBodyV24 {
    return projectOfficialGameStateV24(this.v23.projectPersistedState(state), state);
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV24>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV24, OfficialGameProjectionBodyV24> {
    this.requireV24Pack(context.pack);
    const result = this.v23.apply({ ...context, pack: this.v23Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV24(result.projection, result.state),
    };
  }

  /** Internal v25 delegate; v24's public behavior remains immutable. */
  applyForV25(
    context: CommandReducerContext<OfficialGameStateV24>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV24, OfficialGameProjectionBodyV24> {
    this.requireV24Pack(context.pack);
    const result = this.v23.applyForV25({ ...context, pack: this.v23Pack }, command);
    return {
      ...result,
      state: result.state,
      projection: projectOfficialGameStateV24(result.projection, result.state),
    };
  }
}

/**
 * v25 keeps v24's state and wire shape. It adopts the source story rules documented on
 * `OfficialInternalReductionContext.sourceStoryRules`: Arena license and dungeon fixed-encounter
 * chats enter `dialogsSeen`, zone-change conditions gate `world.activateZone`, quest event 0
 * follows every committed enemy death, and an empty Drop Quests is accepted.
 */
export type OfficialGameStateV25 = OfficialGameStateV24;

export function parseOfficialGameStateV25(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV25 {
  return parseOfficialGameStateV24(data, quests, value, context);
}

export function cloneOfficialGameStateV25(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV25 {
  return parseOfficialGameStateV25(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV25(
  value: unknown,
): OfficialGameProjectionBodyV25 {
  assertJsonSafeTree(value, "official v25 projection");
  assertPlainObject(value, "official v25 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v25 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV25Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V25_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV25),
  ) as unknown as OfficialGameProjectionBodyV25;
}

export function projectOfficialGameStateV25(
  body: OfficialGameProjectionBodyV24,
): OfficialGameProjectionBodyV25 {
  return parseOfficialGameProjectionV25(body);
}
















export function officialV25ProvenEncounterDialogs(options: {
  readonly data: GameData;
  readonly worlds: readonly WorldData[];
  readonly resources?: DungeonResourceSource;
  readonly state: OfficialGameStateV24;
}): readonly string[] {
  const { data, worlds, resources, state } = options;
  const dialogs = new Set<string>();
  const licenses = data.allLicenses();
  const licenseType = (state.profile as { readonly licenseType?: string }).licenseType ?? "Novice";
  const ordinal = licenses.findIndex(({ type }) => type === licenseType);
  if (ordinal < 0) throw new Error(`official v25 migration found unknown license ${licenseType}`);
  for (const license of licenses.slice(1, ordinal + 1)) {
    const challenge = buildLicenseChallengeEncounter(license);
    if (challenge.startChatKey !== undefined) dialogs.add(challenge.startChatKey);
    if (challenge.winChatKey !== undefined) dialogs.add(challenge.winChatKey);
  }
  const battle = state.battle;
  if (battle?.encounter.kind === "arena" && battle.origin.kind === "arena") {
    const start = buildLicenseChallengeEncounter(data.license(battle.origin.licenseType)).startChatKey;
    if (start !== undefined) dialogs.add(start);
  }
  if (battle?.encounter.kind === "dungeon") {
    const start = dungeonEncounterChatKey(
      battle.encounter.encounter.startEvent,
      battle.encounter.encounter.id,
    );
    if (start !== undefined) dialogs.add(start);
  }

  const completed = new Set(state.quests.completedFixedEncounterKeys);
  if (resources !== undefined && completed.size > 0) {
    interface AuthoredFixedEncounter {
      readonly uniqueKey?: string;
      readonly everyXFloors?: number;
      readonly startEvent?: DungeonEncounter["startEvent"];
      readonly winEvent?: DungeonEncounter["winEvent"];
      readonly path: string;
      readonly dungeon: boolean;
    }
    const authored: AuthoredFixedEncounter[] = [];
    for (const world of worlds) {
      for (const poi of world.pointsOfInterest) {
        for (const populator of poi.randomPopulators) {
          for (const fixed of populator.fixedEncounters) {
            authored.push({
              ...(fixed.uniqueKey === undefined ? {} : { uniqueKey: fixed.uniqueKey }),
              ...(fixed.everyXFloors === undefined ? {} : { everyXFloors: fixed.everyXFloors }),
              path: `${world.name}.${poi.name}`,
              dungeon: false,
            });
          }
        }
      }
    }
    const knownMonsters = new Set(data.allMonsters().map(({ shortType }) => shortType));
    const pending: { readonly typeName: string; readonly sourceFile: string; readonly floor: number }[] = [];
    for (const world of worlds) {
      for (const poi of world.pointsOfInterest) {
        const change = poi.zoneChange;
        if (
          change?.kind !== "dungeon" ||
          change.dungeon === undefined ||
          change.dungeonFile === undefined
        ) {
          continue;
        }
        pending.push({
          typeName: change.dungeon,
          sourceFile: change.dungeonFile,
          floor: change.dungeonLevel ?? 1,
        });
      }
    }
    const visited = new Set<string>();
    while (pending.length > 0) {
      const route = pending.shift()!;
      const routeKey = `${route.typeName}:${route.sourceFile}`;
      if (visited.has(routeKey)) continue;
      visited.add(routeKey);
      const definition = loadDungeonData(
        resources,
        route.typeName,
        route.sourceFile,
        route.floor,
        knownMonsters,
      );
      for (const population of definition.floorPopulations) {
        for (const fixed of population.monsterPopulator?.fixedEncounters ?? []) {
          authored.push({
            ...(fixed.uniqueKey === undefined ? {} : { uniqueKey: fixed.uniqueKey }),
            ...(fixed.everyXFloors === undefined ? {} : { everyXFloors: fixed.everyXFloors }),
            ...(fixed.startEvent === undefined ? {} : { startEvent: fixed.startEvent }),
            ...(fixed.winEvent === undefined ? {} : { winEvent: fixed.winEvent }),
            path: `${definition.sourceFile}.floor${population.sourceFloor}.fixed[${fixed.sourceIndex}]`,
            dungeon: true,
          });
        }
        for (const zone of population.zoneChanges) {
          if (zone.kind !== "dungeonExit") continue;
          pending.push({
            typeName: zone.dungeonType,
            sourceFile: zone.dungeonFile,
            floor: zone.dungeonLevel ?? 1,
          });
        }
      }
    }
    const cadenceKeys = authored
      .filter((entry) => entry.uniqueKey !== undefined && entry.everyXFloors !== undefined)
      .map((entry) => entry.uniqueKey!);
    for (const entry of authored) {
      const key = entry.uniqueKey;
      if (!entry.dungeon || key === undefined || !completed.has(key)) continue;
      if (entry.everyXFloors !== undefined && entry.everyXFloors !== 0) continue;
      if (authored.filter((other) => other.uniqueKey === key).length !== 1) continue;
      if (cadenceKeys.some((prefix) =>
        key.length > prefix.length &&
        key.startsWith(prefix) &&
        /^-?[0-9]+$/.test(key.slice(prefix.length)))) {
        continue;
      }
      for (const event of [entry.startEvent, entry.winEvent]) {
        const chat = dungeonEncounterChatKey(event, entry.path);
        if (chat !== undefined) dialogs.add(chat);
      }
    }
  }
  return Object.freeze([...dialogs].sort());
}

/**
 * v24-to-v25 migration: a shape-preserving namespace copy plus the provable `dialogsSeen` repair
 * from `officialV25ProvenEncounterDialogs`. It never replays commands, draws, or settlement.
 */
export function migrateOfficialGameV24ToV25(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly worlds: readonly WorldData[];
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV25 {
  const context = options.context ?? {};
  const prior = cloneOfficialGameStateV24(options.data, options.quests, options.state, context);
  const repaired = officialV25ProvenEncounterDialogs({
    data: options.data,
    worlds: options.worlds,
    ...(context.dungeonResources === undefined ? {} : { resources: context.dungeonResources }),
    state: prior,
  });
  const dialogsSeen = [...new Set([...prior.quests.dialogsSeen, ...repaired])].sort();
  return cloneOfficialGameStateV25(options.data, options.quests, {
    ...prior,
    quests: { ...prior.quests, dialogsSeen },
  }, context);
}

export function createOfficialGameV25LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  const v24 = createOfficialGameV24LogicPackDescriptor(logicPackId, support);
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...v24,
    simulationVersion: OFFICIAL_GAME_V25_SIMULATION_VERSION,
    capabilities: { ...v24.capabilities, commandTypes: [...v24.capabilities.commandTypes] },
  }));
}

export class OfficialGameV25Reducer implements GameCommandReducer<
  OfficialGameStateV25,
  OfficialGameProjectionBodyV25
> {
  constructor(
    private readonly v24: OfficialGameV24Reducer,
    private readonly v24Pack: LogicPackDescriptorV1,
  ) {
    if (v24Pack.simulationVersion !== OFFICIAL_GAME_V24_SIMULATION_VERSION) {
      throw new Error("OfficialGameV25Reducer requires the bound official-game-v24 delegate pack");
    }
  }

  private requireV25Pack(pack: LogicPackDescriptorV1): void {
    if (pack.simulationVersion !== OFFICIAL_GAME_V25_SIMULATION_VERSION) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "OfficialGameV25Reducer requires the official-game-v25 simulation pack",
      );
    }
    if (pack.logicPackId !== this.v24Pack.logicPackId) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        "official v25 pack does not share its bound v24 rules identity",
      );
    }
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV25, OfficialGameProjectionBodyV25>,
  ): void {
    try {
      const expected = this.projectPersistedState(record.state);
      const actual = projectionBody(record.projection);
      if (canonicalJsonValue(expected) !== canonicalJsonValue(actual)) {
        throw new Error("official v25 persisted projection disagrees with its restored state");
      }
      parseOfficialGameProjectionV25(actual);
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V25_SIMULATION_VERSION) {
        throw new Error("official v25 projection has the wrong simulation version");
      }
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "official v25 persisted record is invalid",
      );
    }
  }

  projectPersistedState(state: OfficialGameStateV25): OfficialGameProjectionBodyV25 {
    return projectOfficialGameStateV25(this.v24.projectPersistedState(state));
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV25>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV25, OfficialGameProjectionBodyV25> {
    this.requireV25Pack(context.pack);
    const result = this.v24.applyForV25({ ...context, pack: this.v24Pack }, command);
    const projection = projectOfficialGameStateV25(result.projection);
    // Battle teardown removes permanent player buffs from members that left the Team. Those
    // children are intentionally not serialized; the authority's existing restore path reapplies
    // the profile on its next command. Publish the durable party view at this boundary rather
    // than the transient teardown view (a fainted member's maxHp can otherwise disagree and
    // reject an earned victory as STATE_CORRUPT). State, events, RNG and settlement stay unchanged.
    const terminalParty = result.events.some(event => event.type === "battle.ended")
      ? this.projectPersistedState(result.state).player.party
      : undefined;
    return {
      ...result,
      state: result.state,
      projection: terminalParty === undefined ? projection : {
        ...projection, player: { ...projection.player, party: terminalParty },
      },
    };
  }
}

/** v26 retains v25 state and wire shapes; only opening-wallet settlement changes. */
export type OfficialGameStateV26 = OfficialGameStateV25;

export function parseOfficialGameStateV26(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV26 {
  return parseOfficialGameStateV25(data, quests, value, context);
}

export function cloneOfficialGameStateV26(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV26 {
  return parseOfficialGameStateV26(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV26(
  value: unknown,
): OfficialGameProjectionBodyV26 {
  assertJsonSafeTree(value, "official v26 projection");
  assertPlainObject(value, "official v26 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v26 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV26Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V26_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV26),
  ) as unknown as OfficialGameProjectionBodyV26;
}

export function projectOfficialGameStateV26(
  body: OfficialGameProjectionBodyV25,
): OfficialGameProjectionBodyV26 {
  return parseOfficialGameProjectionV26(body);
}

/** Settle only a provable, uncommitted automatic opening debit. No RNG is drawn on restore. */
function settleOfficialOpeningSilver(data: GameData, state: OfficialGameStateV25): OfficialGameStateV26 {
  const battle = state.battle;
  if (battle === undefined) return state;
  const restored = restoreBattleReplay(data, battle.replay);
  if (state.profile.silver === restored.session.silver) return state;
  const spent = restored.events.reduce((total, event) =>
    total + (event.type === "silverSpent" ? event.amount : 0), 0);
  if (
    battle.replay.commands.length !== 0 || spent <= 0 ||
    state.profile.silver !== battle.replay.options.silver ||
    state.profile.silver - spent !== restored.session.silver
  ) {
    throw new GameServiceError("STATE_CORRUPT", "battle wallet mismatch is not an unsettled opening debit");
  }
  return { ...state, profile: { ...state.profile, silver: restored.session.silver } };
}

/** Preserve the v25 namespace; repair only the exact replay-proven opening wallet omission. */
export function migrateOfficialGameV25ToV26(options: {
  readonly data: GameData;
  readonly quests: QuestCatalog;
  readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV26 {
  const prior = cloneOfficialGameStateV25(options.data, options.quests, options.state, options.context);
  return cloneOfficialGameStateV26(options.data, options.quests,
    settleOfficialOpeningSilver(options.data, prior), options.context);
}

export function createOfficialGameV26LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"],
  support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...createOfficialGameV25LogicPackDescriptor(logicPackId, support),
    simulationVersion: OFFICIAL_GAME_V26_SIMULATION_VERSION,
  }));
}

/** v26 settles the engine's shared-wallet opening costs before publishing the new battle. */
export class OfficialGameV26Reducer implements GameCommandReducer<OfficialGameStateV26, OfficialGameProjectionBodyV26> {
  constructor(
    private readonly data: GameData,
    private readonly v25: OfficialGameV25Reducer,
    private readonly v25Pack: LogicPackDescriptorV1,
  ) {
    if (v25Pack.simulationVersion !== OFFICIAL_GAME_V25_SIMULATION_VERSION) {
      throw new Error("OfficialGameV26Reducer requires the bound official-game-v25 delegate pack");
    }
  }

  projectPersistedState(state: OfficialGameStateV26): OfficialGameProjectionBodyV26 {
    return projectOfficialGameStateV26(this.v25.projectPersistedState(state));
  }

  validatePersistedRecord(
    record: AuthoritativeRecordValidationInput<OfficialGameStateV26, OfficialGameProjectionBodyV26>,
  ): void {
    try {
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V26_SIMULATION_VERSION ||
          canonicalJsonValue(this.projectPersistedState(record.state)) !==
          canonicalJsonValue(projectionBody(record.projection))) {
        throw new Error("official v26 persisted projection disagrees with its restored state or version");
      }
      parseOfficialGameProjectionV26(projectionBody(record.projection));
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError("STATE_CORRUPT",
        error instanceof Error ? error.message : "official v26 persisted record is invalid");
    }
  }

  apply(
    context: CommandReducerContext<OfficialGameStateV26>,
    command: GameCommandV1,
  ): CommandReducerResult<OfficialGameStateV26, OfficialGameProjectionBodyV26> {
    if (context.pack.simulationVersion !== OFFICIAL_GAME_V26_SIMULATION_VERSION ||
        context.pack.logicPackId !== this.v25Pack.logicPackId) {
      throw new GameServiceError("PACK_UNAVAILABLE", "official v26 requires its bound v25 rules identity");
    }
    const result = this.v25.apply({ ...context, pack: this.v25Pack }, command);
    // Every entry path (world, dungeon, Arena, Tournament and restarted Save Me) allocates a
    // battle identity. Ordinary turns already debit their new silverSpent events in applyBattle.
    const newBattle = result.state.battle !== undefined &&
      result.state.battle.battleId !== context.state?.battle?.battleId;
    const state = newBattle ? settleOfficialOpeningSilver(this.data, result.state) : result.state;
    return {
      ...result,
      state,
      projection: parseOfficialGameProjectionV26({
        ...result.projection,
        player: { ...result.projection.player, silver: state.profile.silver },
      }),
    };
  }
}

/** v27 retains v26 state and wire shapes; new battles carry source Job construction rules. */
export type OfficialGameStateV27 = OfficialGameStateV26;

export function parseOfficialGameStateV27(
  data: GameData,
  quests: QuestCatalog,
  value: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV27 {
  return parseOfficialGameStateV26(data, quests, value, context);
}

export function cloneOfficialGameStateV27(
  data: GameData,
  quests: QuestCatalog,
  state: unknown,
  context: OfficialGameStateParseContext = {},
): OfficialGameStateV27 {
  return parseOfficialGameStateV27(data, quests, structuredClone(state), context);
}

export function parseOfficialGameProjectionV27(
  value: unknown,
): OfficialGameProjectionBodyV27 {
  assertJsonSafeTree(value, "official v27 projection");
  assertPlainObject(value, "official v27 projection");
  for (const key of ["slotId", "revision", "updatedAt", "logicPackId", "simulationVersion", "trustTier"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`official v27 projection body contains envelope field ${key}`);
    }
  }
  const parsed = OfficialGameProjectionV27Schema.parse({
    slotId: "slot-1",
    revision: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    logicPackId: `logic-v1:${"0".repeat(64)}`,
    simulationVersion: OFFICIAL_GAME_V27_SIMULATION_VERSION,
    trustTier: "official",
    ...(value as Record<string, unknown>),
  });
  return structuredClone(
    projectionBody(parsed as unknown as OfficialGameProjectionV27),
  ) as unknown as OfficialGameProjectionBodyV27;
}

export function projectOfficialGameStateV27(
  body: OfficialGameProjectionBodyV26,
): OfficialGameProjectionBodyV27 {
  return parseOfficialGameProjectionV27(body);
}

/** Preserve committed replay prefixes when moving the slot into the v27 namespace. */
export function migrateOfficialGameV26ToV27(options: {
  readonly data: GameData; readonly quests: QuestCatalog; readonly state: unknown;
  readonly context?: OfficialGameStateParseContext;
}): OfficialGameStateV27 {
  return cloneOfficialGameStateV27(options.data, options.quests, options.state, options.context);
}

export function createOfficialGameV27LogicPackDescriptor(
  logicPackId: LogicPackDescriptorV1["logicPackId"], support: OfficialGameV12SupportReport,
): LogicPackDescriptorV1 {
  return Object.freeze(CurrentLogicPackDescriptorV1Schema.parse({
    ...createOfficialGameV26LogicPackDescriptor(logicPackId, support),
    simulationVersion: OFFICIAL_GAME_V27_SIMULATION_VERSION,
  }));
}

/** Source construction for new battles; replay-preserving migration and capture settlement. */
export class OfficialGameV27Reducer implements GameCommandReducer<OfficialGameStateV27, OfficialGameProjectionBodyV27> {
  constructor(private readonly v26: OfficialGameV26Reducer, private readonly v26Pack: LogicPackDescriptorV1) {
    if (v26Pack.simulationVersion !== OFFICIAL_GAME_V26_SIMULATION_VERSION) {
      throw new Error("OfficialGameV27Reducer requires the bound official-game-v26 delegate pack");
    }
  }
  projectPersistedState(state: OfficialGameStateV27): OfficialGameProjectionBodyV27 {
    return projectOfficialGameStateV27(this.v26.projectPersistedState(state));
  }
  validatePersistedRecord(record: AuthoritativeRecordValidationInput<OfficialGameStateV27, OfficialGameProjectionBodyV27>): void {
    try {
      if (record.projection.simulationVersion !== OFFICIAL_GAME_V27_SIMULATION_VERSION ||
          canonicalJsonValue(this.projectPersistedState(record.state)) !== canonicalJsonValue(projectionBody(record.projection))) {
        throw new Error("official v27 persisted projection disagrees with its restored state or version");
      }
      parseOfficialGameProjectionV27(projectionBody(record.projection));
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError("STATE_CORRUPT", error instanceof Error ? error.message : "invalid official v27 record");
    }
  }
  apply(context: CommandReducerContext<OfficialGameStateV27>, command: GameCommandV1): CommandReducerResult<OfficialGameStateV27, OfficialGameProjectionBodyV27> {
    if (context.pack.simulationVersion !== OFFICIAL_GAME_V27_SIMULATION_VERSION || context.pack.logicPackId !== this.v26Pack.logicPackId) {
      throw new GameServiceError("PACK_UNAVAILABLE", "official v27 requires its bound v26 rules identity");
    }
    const delegated = { ...context, pack: this.v26Pack, [sourceJobLevelRules]: true };
    const result = this.v26.apply(delegated, command);
    return { ...result, projection: projectOfficialGameStateV27(result.projection) };
  }
}

function replaceOfficialV12State(
  prior: OfficialGameStateV12,
  pendingEgg: OfficialEggContinuation | undefined,
  party: WorldTripParty,
  profile: PlayerProfile,
  quests: GuildQuestRuntime,
  nextContinuationSequence: number,
  nextMonsterSequence: number,
  claims: CollectionClaims = new CollectionClaims(prior.collectionClaims.claimedGoalIds),
): OfficialGameStateV12 {
  const { pendingEgg: _priorPendingEgg, ...withoutPendingEgg } = prior;
  const next = {
    ...withoutPendingEgg,
    profile: profile.stateSnapshot(),
    party: party.stateSnapshot(),
    quests: quests.stateSnapshot(),
    collectionClaims: {
      schemaVersion: 1 as const,
      claimedGoalIds: [...claims.snapshot()],
    },
    nextContinuationSequence,
    nextMonsterSequence,
    ...(pendingEgg === undefined ? {} : { pendingEgg: structuredClone(pendingEgg) }),
  } satisfies OfficialGameStateV12;
  validateOfficialGameV12Envelope(next);
  return structuredClone(next);
}

function validateOfficialEggSettlementForAggregate(
  data: GameData,
  settlement: OfficialEggPrizeSettlement,
): void {
  if (settlement.kind === "keep") {
    validateOfficialEggKeepReward(data, settlement.reward);
    return;
  }
  data.monsterByShortType(settlement.prize.shortType);
  if (!Number.isSafeInteger(settlement.prize.level) || settlement.prize.level < 1 || settlement.prize.level > 150) {
    throw new GameServiceError("CAPABILITY_UNSUPPORTED", "Egg monster prize level is not settleable");
  }
  if (
    !Number.isSafeInteger(settlement.recipientLevel) ||
    settlement.recipientLevel < 1 ||
    settlement.recipientLevel > 150
  ) {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "Egg Feed recipient level is invalid");
  }
}

function validateOfficialEggPrizeForAggregate(
  data: GameData,
  prize: OfficialEggPrize,
): void {
  switch (prize.kind) {
    case "monster":
      data.monsterByShortType(prize.shortType);
      if (!Number.isSafeInteger(prize.level) || prize.level < 1 || prize.level > 150) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", "Egg monster prize level is not settleable");
      }
      break;
    case "item":
      validateOfficialEggKeepReward(data, prize);
      break;
    case "recipe":
      validateOfficialEggKeepReward(data, prize);
      break;
    case "spiritTotem":
      validateOfficialEggKeepReward(data, prize);
      break;
    case "gold":
    case "silver":
      if (!Number.isSafeInteger(prize.amount) || prize.amount <= 0) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", "Egg currency prize amount is not settleable");
      }
      break;
    case "gem":
      try {
        validateOfficialEggKeepReward(data, prize);
      } catch (error) {
        throw new GameServiceError(
          "CAPABILITY_UNSUPPORTED",
          error instanceof Error ? error.message : "Egg Gem prize is not settleable",
        );
      }
      break;
  }
}

function requireEggSupportInternals(
  proof: OfficialV12EggSupportProof,
): OfficialV12EggSupportInternals {
  if (!validatedEggSupportProofs.has(proof)) {
    throw new GameServiceError("CAPABILITY_UNSUPPORTED", "official Egg support proof is not validated");
  }
  const internals = validatedEggSupportInternals.get(proof);
  if (internals === undefined || internals.supportFingerprint !== proof.supportFingerprint) {
    throw new GameServiceError("CAPABILITY_UNSUPPORTED", "official Egg support proof internals are unavailable");
  }
  return internals;
}

/** Validate an actual engine-generated provider after RNG but before it becomes committed state. */
function validateGeneratedOfficialEggPrize(
  data: GameData,
  proof: OfficialV12EggSupportProof,
  prize: OfficialEggPrize,
): void {
  const internals = requireEggSupportInternals(proof);
  validateOfficialEggPrizeForAggregate(data, prize);
  switch (prize.kind) {
    case "monster":
      if ((prize.prizeMonster
        ? !internals.prizeMonsterShortTypes.includes(prize.shortType)
        : !internals.eligibleMonsterShortTypes.includes(prize.shortType))) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", `Egg provider monster ${prize.shortType} is not loaded`);
      }
      break;
    case "recipe":
      if (!internals.recipeResultShortTypes.includes(prize.combineName)) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", `Egg provider recipe ${prize.combineName} is not loaded`);
      }
      break;
    case "spiritTotem":
      if (!internals.spiritSummonShortTypes.includes(prize.shortType)) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", `Egg provider Totem ${prize.shortType} is not loaded`);
      }
      break;
    case "item":
      if (!internals.itemPaths.includes(prize.definitionPath)) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", `Egg provider item ${prize.definitionPath} is not a fixed card path`);
      }
      break;
    case "gold":
      if (prize.amount !== 50 && prize.amount !== 150) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", `Egg provider gold ${prize.amount} is not source-defined`);
      }
      break;
    case "silver":
      if (prize.amount !== 500 && prize.amount !== 1_500) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", `Egg provider silver ${prize.amount} is not source-defined`);
      }
      break;
    case "gem":
      if (
        prize.level < 1 || prize.level > 150 || prize.quality > 1 || prize.slot > 2 ||
        prize.enabledStats.length !== prize.quality + 1
      ) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", "Egg provider Gem domain is not source-defined");
      }
      break;
  }
}

function validateGeneratedOfficialEggContinuation(
  data: GameData,
  proof: OfficialV12EggSupportProof,
  continuation: OfficialEggContinuation,
): void {
  if (continuation.phase === "spinning" || continuation.phase === "awaiting-prize-resolution") {
    if (continuation.providers.length !== continuation.reel.length) {
      throw new GameServiceError("STATE_CORRUPT", "Egg providers and reel have different lengths");
    }
    for (const prize of continuation.providers) validateGeneratedOfficialEggPrize(data, proof, prize);
    for (const prize of continuation.reel) validateGeneratedOfficialEggPrize(data, proof, prize);
    for (const shortType of continuation.previewMonsterShortTypes) {
      const internals = requireEggSupportInternals(proof);
      if (!internals.eligibleMonsterShortTypes.includes(shortType) &&
          !internals.prizeMonsterShortTypes.includes(shortType)) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", `Egg preview monster ${shortType} is not loaded`);
      }
    }
    if (continuation.phase === "awaiting-prize-resolution") {
      validateGeneratedOfficialEggPrize(data, proof, continuation.landedPrize);
    }
  } else if (continuation.phase === "awaiting-repeat-or-finish") {
    validateGeneratedOfficialEggPrize(data, proof, continuation.settledPrize);
  }
}

/**
 * Route admission is structural and happens before the legacy reducer is allowed to draw or
 * mutate. The support proof already walked every authored Store, Tournament, quest, battle,
 * dungeon-treasure, and dungeon-catch plan. This second gate rechecks the route-specific plan
 * at the command boundary: Tournament/quest definitions are selected here, while battle rewards
 * are persisted in the battle snapshot and dungeon collection performs the equivalent check
 * immediately before collection. No route branch is allowed to use validation as a rollback.
 */
function validateRouteRewardPlanBeforeReduction(
  data: GameData,
  quests: QuestCatalog,
  proof: OfficialV12EggSupportProof,
  state: OfficialGameStateV12,
  command: GameCommandV1,
): void {
  switch (command.type) {
    case "store.purchase":
      // Store Egg shape is fixed authored data, but quantity is command input and must be
      // rejected before any balance read, RNG, or pending-state mutation.
      if (command.stockId === "egg" || command.stockId === "monster-egg") {
        const stock = sourceStoreStock(command.stockId);
        if (stock.kind !== "egg" || command.quantity !== 1) {
          throw new GameServiceError(
            "ACTION_NOT_ALLOWED",
            "Store Egg route is not a single standard Egg reward",
          );
        }
      }
      return;
    case "tournament.claimPrize": {
      if (state.profile.schemaVersion !== 7 && state.profile.schemaVersion !== 8) {
        throw new GameServiceError(
          "STATE_CORRUPT",
          "Tournament reward route requires profile schema v7 or newer",
        );
      }
      const tournament = data.tournament(state.profile.tournament.index);
      if (tournament === undefined) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", "Tournament reward plan is not loaded");
      }
      const path = `Tournaments.plist[${tournament.index}].treasureData`;
      validateEggTreasureData(parseDungeonTreasureData(tournament.treasureData, path, 1), path, data);
      return;
    }
    case "quest.claim": {
      const definition = quests.definitions.find(({ name }) => name === command.questId);
      if (definition === undefined) {
        throw new GameServiceError("CAPABILITY_UNSUPPORTED", "quest reward plan is not loaded");
      }
      const path = `Quests.plist.${definition.name}.treasureData`;
      validateEggTreasureData(parseDungeonTreasureData(definition.treasureData, path, 1), path, data);
      return;
    }
    case "dungeon.openTreasure":
    case "dungeon.claimCatchReward":
      // The restored dungeon route owns the exact selected treasure/catch object and repeats
      // this structural check immediately before collection in applyDungeonCommand.
      return;
    default:
      break;
  }
  if (!command.type.startsWith("battle.")) return;
  const rewards = state.battle?.encounter.rewards;
  if (rewards !== undefined) validateLoadedRewardBatch(data, proof, rewards);
}

function validateLoadedRewardBatch(
  data: GameData,
  proof: OfficialV12EggSupportProof,
  rewards: readonly PlayerReward[],
): void {
  validateOfficialEggRewardBatchShape(rewards);
  const internals = requireEggSupportInternals(proof);
  for (const reward of rewards) {
    switch (reward.kind) {
      case "egg":
      case "monsterEgg":
        break;
      case "monsterJoin":
        data.monsterByShortType(reward.shortType);
        if (!Number.isSafeInteger(reward.jobLevel) || reward.jobLevel < 1 || reward.jobLevel > 150) {
          throw new GameServiceError("CAPABILITY_UNSUPPORTED", "route reward has an invalid monster level");
        }
        break;
      case "recipe":
        data.combineRecipe(reward.combineName);
        if (!internals.recipeResultShortTypes.includes(reward.combineName)) {
          throw new GameServiceError("CAPABILITY_UNSUPPORTED", "route reward recipe is not loaded");
        }
        break;
      case "spiritTotem":
        data.monsterByShortType(reward.shortType);
        if (!internals.spiritSummonShortTypes.includes(reward.shortType)) {
          throw new GameServiceError("CAPABILITY_UNSUPPORTED", "route reward Totem is not loaded");
        }
        break;
      case "gold":
      case "silver":
        if (!Number.isSafeInteger(reward.amount) || reward.amount <= 0) {
          throw new GameServiceError("CAPABILITY_UNSUPPORTED", "route reward currency is invalid");
        }
        break;
      case "gem":
        // Route rewards come from TreasureData generation, never from an Egg reel: validate them
        // against the generator's own domain, not the Egg prize rule (slot 0-2, level <= 150).
        validateGeneratedTreasureGem(reward);
        break;
    }
  }
}

/**
 * The chat key of a dungeon fixed encounter's `ChatGameFlowEvent`, exactly as the browser derives
 * it (`installDungeonFeature.withChatEvents`). Any other flow-event class has no chat to record.
 */
function dungeonEncounterChatKey(
  event: DungeonEncounter["startEvent"],
  encounterId: string,
): string | undefined {
  if (event === undefined || event.className !== "ChatGameFlowEvent") return undefined;
  const keys = Object.keys(event.data);
  const chatKey = event.data["chatKey"];
  if (keys.length !== 1 || keys[0] !== "chatKey" || typeof chatKey !== "string" || chatKey.length === 0) {
    throw new GameServiceError(
      "CAPABILITY_UNSUPPORTED",
      `dungeon encounter ${encounterId} ChatGameFlowEvent must carry exactly one chatKey`,
    );
  }
  return chatKey;
}



















function validateGeneratedTreasureGem(reward: Extract<PlayerReward, { readonly kind: "gem" }>): void {
  const weights = Number.isSafeInteger(reward.level) && reward.level >= 1
    ? dungeonGemSlotWeights(reward.level)
    : undefined;
  if (
    weights === undefined ||
    (reward.quality !== 0 && reward.quality !== 1) ||
    !Number.isSafeInteger(reward.slot) || reward.slot < 0 || reward.slot >= weights.length ||
    !(weights[reward.slot]! > 0) ||
    reward.enabledStats.length !== reward.quality + 1 ||
    reward.enabledStats.some((stat, index) =>
      !REWARD_GEM_STATS.includes(stat) || reward.enabledStats.indexOf(stat) !== index)
  ) {
    throw new GameServiceError(
      "CAPABILITY_UNSUPPORTED",
      "route reward Gem is outside the source TreasureData Gem domain",
    );
  }
}

function applyOfficialEggPrizeSettlement(
  data: GameData,
  settlement: OfficialEggPrizeSettlement,
  party: WorldTripParty,
  profile: PlayerProfile,
  firstMonsterSequence: number,
): {
  readonly nextMonsterSequence: number;
  readonly events: readonly UnsequencedPresentationEventV1[];
} {
  validateOfficialEggSettlementForAggregate(data, settlement);
  let nextMonsterSequence = firstMonsterSequence;
  const events: UnsequencedPresentationEventV1[] = [];
  if (settlement.kind === "discard") return { nextMonsterSequence, events };
  if (settlement.kind === "feed") {
    const recipient = party.monster(settlement.recipientInstanceId);
    if (recipient.level !== settlement.recipientLevel) {
      throw new GameServiceError("STATE_CORRUPT", "Egg Feed recipient changed during settlement");
    }
    const fed = party.feedOneLevel(settlement.recipientInstanceId);
    if (fed.level !== settlement.recipientLevel + 1) {
      throw new GameServiceError("STATE_CORRUPT", "Egg Feed level cap disagrees with the party reducer");
    }
    profile.recordCapturedMonster(recipient.shortType, fed.level);
    return { nextMonsterSequence, events };
  }

  const reward = settlement.reward;
  if (reward.kind === "item") {
    const instanceName = reward.definitionPath.slice(reward.definitionPath.lastIndexOf(".") + 1);
    profile.inventory.addUsable(reward.definitionPath, instanceName, reward.level);
    return { nextMonsterSequence, events };
  }
  reserveOfficialMonsterSequence(
    nextMonsterSequence,
    monsterJoinRewardCount([reward as PlayerReward]),
    "Egg settlement",
  );
  const applied = applyPlayerRewards(profile, [
    reward as PlayerReward,
  ], {
    addMonsterJoin: (shortType, jobLevel) => {
      const allocated = allocateOfficialMonsterSequence(nextMonsterSequence, "Egg settlement");
      nextMonsterSequence = allocated.nextSequence;
      const instanceId = allocated.instanceId;
      party.addCapturedMonster({ instanceId, shortType, level: jobLevel });
      profile.recordCapturedMonster(shortType, jobLevel);
      return { instanceId };
    },
  });
  for (const result of applied) {
    if (result.kind === "silver" || result.kind === "gold") {
      events.push({
        type: "player.currencyChanged",
        currency: result.kind,
        delta: result.amount,
        balance: result.balance,
      });
    } else if (result.kind === "monsterJoin") {
      events.push({
        type: "player.monsterAdded",
        instanceId: result.instanceId,
        monsterTypeId: result.shortType,
        level: result.jobLevel,
        reason: "hatch",
      });
    }
  }
  return { nextMonsterSequence, events };
}

function requireValidatedSupport(report: OfficialGameSupportReport): void {
  if (!validatedSupportReports.has(report)) {
    throw new Error("official support report was not produced by validateOfficialGameSupport");
  }
}

function battleDecisionView(
  restored: RestoredBattleReplay,
  battle: OfficialBattleStateV1,
  profile: PlayerProfile,
): SlotProjectionV1["decision"] {
  if (restored.step.type !== "awaitingPlayer") return { type: "none" };
  const partyLevel = profile.capturePartyLevel();
  return {
    type: "battle.playerTurn",
    decisionId: restored.decisionId!,
    battleId: battle.battleId,
    actorId: restored.step.actorId,
    choices: restored.step.choices.map((choice) => ({
      slot: choice.slot,
      abilityId: choice.abilityPath,
      target: choice.targeting,
      ...(choice.blockReason === undefined ? {} : { blockedReasonId: choice.blockReason }),
      ...(choice.tier === undefined ? {} : { tier: choice.tier }),
      activationLength: choice.activationLength,
    })),
    enemyTargetIds: restored.session.targetableIdsOf(1),
    friendlyTargetIds: restored.session.targetableIdsOf(0),
    canDelay: true,
    canRetreat: battle.encounter.allowRetreat,
    captureTargets: restored.session.targetableIdsOf(1).flatMap((targetId) => {
      if (restored.session.captureStatusOf(targetId) !== "available") return [];
      const availableCardLevels = ([1, 2, 3] as const).filter(
        (level) => restored.session.captureChanceOf(targetId, level, partyLevel) > 0,
      );
      return availableCardLevels.length === 0 ? [] : [{ targetId, availableCardLevels }];
    }),
    summonableSpiritTypes: profile.spiritSnapshot().full
      ? profile.spiritSnapshot().spirits
        .filter((spirit) => !spirit.usedThisTrip)
        .map((spirit) => spirit.shortType)
      : [],
  };
}

/** Mirror `-[BattleNode notifyDamage:]` into the authority-owned HeroData profile. Every committed
 * damage notification charges independently, including collateral targets; replay restoration
 * supplies the immutable combat levels and team ownership needed by the source formula. */
function applyCommittedBattleSpiritEnergy(
  profile: PlayerProfile,
  restored: RestoredBattleReplay,
  events: readonly BattleEvent[],
): void {
  for (const event of events) {
    if (event.type !== "damageDealt") continue;
    if (restored.session.teamOf(event.source) === 0) {
      profile.chargeSpiritForDealtDamage(
        restored.session.levelOf(event.source),
        restored.session.levelOf(event.target),
      );
    }
    if (restored.session.teamOf(event.target) === 0) {
      profile.chargeSpiritForTakenDamage(
        restored.session.levelOf(event.target),
        restored.session.levelOf(event.source),
      );
    }
  }
}

function appendCommonBattleEvents(
  output: UnsequencedPresentationEventV1[],
  battleId: string,
  events: readonly BattleEvent[],
): void {
  for (const event of events) {
    if (event.type === "abilityUsed") {
      output.push({
        type: "battle.abilityUsed",
        battleId,
        sourceId: event.source,
        abilityId: event.ability,
        targetIds: [...event.targets],
      });
    } else if (event.type === "damageDealt") {
      output.push({
        type: "battle.damage",
        battleId,
        sourceId: event.source,
        targetId: event.target,
        amount: event.amount,
        hpAfter: event.hpAfter,
      });
    } else if (event.type === "healed") {
      output.push({
        type: "battle.healed",
        battleId,
        sourceId: event.source,
        targetId: event.target,
        amount: event.amount,
        hpAfter: event.hpAfter,
      });
    } else if (event.type === "captureResolved") {
      output.push({
        type: "battle.captureResolved",
        battleId,
        targetId: event.target,
        success: event.success,
        cardLevel: event.cardLevel,
      });
    }
  }
}

function appendWalletEvents(
  events: UnsequencedPresentationEventV1[],
  before: ReturnType<PlayerProfile["snapshot"]>,
  after: ReturnType<PlayerProfile["snapshot"]>,
): UnsequencedPresentationEventV1[] {
  if (after.silver !== before.silver) {
    events.push({
      type: "player.currencyChanged",
      currency: "silver",
      delta: after.silver - before.silver,
      balance: after.silver,
    });
  }
  if (after.gold !== before.gold) {
    events.push({
      type: "player.currencyChanged",
      currency: "gold",
      delta: after.gold - before.gold,
      balance: after.gold,
    });
  }
  return events;
}

function questProjection(quests: GuildQuestRuntime): NonNullable<SlotProjectionV1["quests"]> {
  const snapshot = quests.stateSnapshot();
  return {
    activeQuestNames: [...snapshot.activeQuestNames],
    finishedQuestNames: [...snapshot.finishedQuestNames],
    progressByQuestName: structuredClone(
      snapshot.progressByQuestName,
    ) as NonNullable<SlotProjectionV1["quests"]>["progressByQuestName"],
    dialogsSeen: [...snapshot.dialogsSeen],
    completedFixedEncounterKeys: [...snapshot.completedFixedEncounterKeys],
    receivedBattleRewardKeys: [...snapshot.receivedBattleRewardKeys],
  };
}

function inferV2GuildQuestState(
  world: WorldData,
  state: OfficialWorldStateV1 | undefined,
): GuildQuestStateSnapshot {
  if (state === undefined) return emptyGuildQuestStateSnapshot();
  const dialogsSeen = new Set<string>();
  const completedFixedEncounterKeys = new Set<string>();
  const receivedBattleRewardKeys = new Set<string>();
  const hasLeftLastTown = state.everCompletedPoiIds.some((name) => name !== state.lastTownId);
  if (hasLeftLastTown) {
    const lastTown = world.pointsOfInterest.find(({ name }) => name === state.lastTownId);
    const initialEnterChat = lastTown?.town?.enterChats.find(
      ({ requiredSeenChat }) => requiredSeenChat === undefined,
    );
    if (initialEnterChat !== undefined) dialogsSeen.add(initialEnterChat.chat.name);
  }
  for (const poi of world.pointsOfInterest) {
    const wins = state.poiWins[poi.name] ?? 0;
    for (let floor = 1; floor <= wins; floor++) {
      for (const populator of poi.randomPopulators) {
        const fixed = populator.fixedEncounters[0];
        // Only a source-deterministic candidate can be reconstructed without the retired v2
        // battle aggregate. Chance-based and quest-gated candidates remain deliberately unknown.
        if (
          fixed === undefined ||
          fixed.chanceToAppear < 1 ||
          fixed.questKey !== undefined ||
          !fixedEncounterMatchesLegacyFloor(fixed, floor)
        ) {
          continue;
        }
        const completionKey = fixedEncounterCompletionKey(fixed, floor);
        if (completionKey !== undefined) completedFixedEncounterKeys.add(completionKey);
        if (fixed.battleRewardKey !== undefined) {
          receivedBattleRewardKeys.add(fixed.battleRewardKey);
        }
        if (fixed.startEvent !== undefined) dialogsSeen.add(fixed.startEvent.chat.name);
        if (fixed.winEvent !== undefined) dialogsSeen.add(fixed.winEvent.chat.name);
      }
    }
  }
  return {
    schemaVersion: 1,
    activeQuestNames: [],
    finishedQuestNames: [],
    progressByQuestName: {},
    dialogsSeen: [...dialogsSeen].sort(),
    completedFixedEncounterKeys: [...completedFixedEncounterKeys].sort(),
    receivedBattleRewardKeys: [...receivedBattleRewardKeys].sort(),
  };
}

/**
 * Preserve the source notification decision made by the quest aggregate in the committed event
 * batch. Projection diffs are insufficient: WinBattleListQuest intentionally notifies after
 * global fixed-encounter state changes without writing its local progress dictionary.
 */
function appendGuildQuestEvents(
  events: UnsequencedPresentationEventV1[],
  quests: GuildQuestRuntime,
  mutate: () => GuildQuestEventResult,
): void {
  const completionBefore = new Map(
    quests.activeQuestNames().map((name) => [name, quests.isComplete(name)]),
  );
  const result = mutate();
  for (const questId of result.notificationQuestNames) {
    const { current, required } = quests.questProgressCount(questId);
    events.push({ type: "quest.progressed", questId, current, required });
  }
  for (const questId of quests.activeQuestNames()) {
    if (completionBefore.get(questId) === false && quests.isComplete(questId)) {
      events.push({ type: "quest.completed", questId });
    }
  }
}

function fixedEncounterMatchesLegacyFloor(
  fixed: Pick<import("@dib/gamedata").WorldFixedEncounter, "exactFloor" | "everyXFloors">,
  floor: number,
): boolean {
  if (fixed.exactFloor === undefined) return true;
  if (fixed.everyXFloors === undefined) return floor === fixed.exactFloor;
  const difference = floor - fixed.exactFloor;
  return difference >= 0 && difference % fixed.everyXFloors === 0;
}

function firstTownEnterChat(
  poi: WorldPointOfInterest,
  quests: GuildQuestRuntime,
): import("@dib/gamedata").ChatDefinition | undefined {
  for (const entry of poi.town?.enterChats ?? []) {
    const condition = entry.requiredSeenChat;
    if (condition !== undefined) {
      const negated = condition.startsWith("!");
      const name = negated ? condition.slice(1) : condition;
      const seen = quests.hasSeenDialog(name);
      if (negated ? seen : !seen) continue;
    }
    if (!quests.hasSeenDialog(entry.chat.name) || entry.chat.alwaysShow) return entry.chat;
  }
  return undefined;
}

function townGuildAvailable(
  world: WorldData,
  townId: string,
  quests: GuildQuestRuntime,
): boolean {
  const town = world.pointsOfInterest.find(({ name }) => name === townId)?.town;
  return town?.buildings.some((building) =>
    building.className === "TavernMenuItem" && townBuildingConditionsPass(building, quests),
  ) === true;
}


function townBuildingConditionsPass(
  building: TownBuildingDefinition,
  quests: GuildQuestRuntime,
): boolean {
  const conditions = building.conditions;
  return conditionPasses(conditions?.chats, (name) => quests.hasSeenDialog(name)) &&
    conditionPasses(conditions?.inProgressQuests, (name) => quests.canUseQuestKey(name)) &&
    conditionPasses(conditions?.quests, (name) => quests.hasFinishedQuest(name));
}

function conditionPasses(
  expression: string | undefined,
  predicate: (name: string) => boolean,
): boolean {
  if (expression === undefined) return true;
  const negated = expression.startsWith("!");
  const name = negated ? expression.slice(1) : expression;
  const value = predicate(name);
  return negated ? !value : value;
}

function parseLocation(value: OfficialLocationV1): OfficialLocationV1 {
  validateLocationShape(value);
  if (value.kind === "town") {
    return {
      kind: "town",
      worldId: requireId(value.worldId, "location.worldId"),
      townId: requireId(value.townId, "location.townId"),
    };
  }
  if (value.kind === "world") {
    return {
      kind: "world",
      worldId: requireId(value.worldId, "location.worldId"),
      poiId: requireId(value.poiId, "location.poiId"),
    };
  }
  if (value.kind === "battle") {
    return {
      kind: "battle",
      worldId: requireId(value.worldId, "location.worldId"),
      poiId: requireId(value.poiId, "location.poiId"),
      battleId: requireId(value.battleId, "location.battleId"),
    };
  }
  if (value.kind === "dungeon") {
    return {
      kind: "dungeon",
      dungeonId: requireDungeonId(value.dungeonId, "location.dungeonId"),
      floor: positiveInteger(value.floor, "location.floor"),
      roomId: requireDungeonId(value.roomId, "location.roomId"),
    };
  }
  throw new Error("official game state has an invalid location");
}

function validateWorldEnvelope(world: OfficialWorldStateV1): void {
  validateWorldShape(world);
  if (world.schemaVersion !== 1) throw new Error("unsupported official world schema");
  requireId(world.worldId, "world.worldId");
  requireId(world.currentPoiId, "world.currentPoiId");
  requireId(world.lastTownId, "world.lastTownId");
  if (
    !Array.isArray(world.completedPoiIds) ||
    !Array.isArray(world.everCompletedPoiIds) ||
    !Array.isArray(world.visitedTownIds)
  ) {
    throw new Error("official world completion arrays are malformed");
  }
  let previousTown: string | undefined;
  for (const town of world.visitedTownIds) {
    requireId(town, "world.visitedTownIds[]");
    if (previousTown !== undefined && previousTown >= town) {
      throw new Error("official visited-town ids must be sorted and unique");
    }
    previousTown = town;
  }
  if (!world.visitedTownIds.includes(world.lastTownId)) {
    throw new Error("official last town must be present in visited-town history");
  }
}

function validateBattleEnvelope(data: GameData, battle: OfficialBattleStateV1): RestoredBattleReplay {
  validateBattleShape(battle, false);
  if (battle.schemaVersion !== 1) throw new Error("unsupported official battle schema");
  requireId(battle.battleId, "battleId");
  if (battle.origin.kind === "world") {
    requireId(battle.origin.worldId, "battle.origin.worldId");
    requireId(battle.origin.poiId, "battle.origin.poiId");
  } else if (battle.origin.kind === "dungeon") {
    requireDungeonId(battle.origin.dungeonId, "battle.origin.dungeonId");
    requireDungeonId(battle.origin.encounterId, "battle.origin.encounterId");
  } else if (battle.origin.kind === "arena") {
    requireId(battle.origin.worldId, "battle.origin.worldId");
    requireId(battle.origin.townId, "battle.origin.townId");
    if (![
      "Novice", "Apprentice", "Veteran", "Expert", "Elite", "Master", "Grandmaster",
    ].includes(battle.origin.licenseType)) {
      throw new Error("battle.origin.licenseType is invalid");
    }
  } else {
    requireId(battle.origin.worldId, "battle.origin.worldId");
    requireId(battle.origin.townId, "battle.origin.townId");
    if (
      !Number.isSafeInteger(battle.origin.tournamentIndex) ||
      battle.origin.tournamentIndex < 0 ||
      !Number.isSafeInteger(battle.origin.round) ||
      battle.origin.round < 0 ||
      battle.origin.round > 3
    ) {
      throw new Error("battle.origin Tournament coordinates are invalid");
    }
  }

  return restoreBattleReplay(data, battle.replay);
}

interface OfficialEnvelopeValidationOptions {
  readonly allowMissingQuests?: boolean;
  readonly allowLegacyBattleWorldOrigin?: boolean;
}

function validateOfficialEnvelope(
  value: unknown,
  options: OfficialEnvelopeValidationOptions = {},
): void {
  assertJsonSafeTree(value, "official game state");
  assertExactObjectKeys(
    value,
    [
      "schemaVersion", "profile", "party", "quests", "location", "world", "battle", "dungeon",
      "pendingEgg", "nextMonsterSequence", "nextBattleSequence",
    ],
    "official game state",
  );
  const state = value as Record<string, unknown>;
  if (state.location !== undefined) validateLocationShape(state.location);
  if (state.world !== undefined) validateWorldShape(state.world);
  if (state.battle !== undefined) {
    validateBattleShape(state.battle, options.allowLegacyBattleWorldOrigin === true);
  }
  if (state.dungeon !== undefined) {
    assertExactObjectKeys(
      state.dungeon,
      ["schemaVersion", "run", "worldId", "entrancePoiId"],
      "official dungeon envelope",
    );
  }
  if (state.pendingEgg !== undefined) {
    assertExactObjectKeys(state.pendingEgg, ["schemaVersion", "kind"], "official pending Egg");
  }
  if (!options.allowMissingQuests && state.quests === undefined) {
    // The typed parser below emits the canonical missing-field error. This branch exists only to
    // keep the migration exception explicit at this outer envelope boundary.
    return;
  }
}

function validateLocationShape(value: unknown): void {
  assertPlainObject(value, "official location");
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "town") {
    assertExactObjectKeys(value, ["kind", "worldId", "townId"], "official town location");
  } else if (kind === "world") {
    assertExactObjectKeys(value, ["kind", "worldId", "poiId"], "official world location");
  } else if (kind === "battle") {
    assertExactObjectKeys(value, ["kind", "worldId", "poiId", "battleId"], "official battle location");
  } else if (kind === "dungeon") {
    const legacyWorldCoordinates =
      Object.prototype.hasOwnProperty.call(value, "worldId") &&
      Object.prototype.hasOwnProperty.call(value, "poiId");
    assertExactObjectKeys(
      value,
      legacyWorldCoordinates
        ? ["kind", "worldId", "poiId", "dungeonId", "floor", "roomId"]
        : ["kind", "dungeonId", "floor", "roomId"],
      "official dungeon location",
    );
  } else {
    throw new Error("official game state has an invalid location");
  }
}

function validateWorldShape(value: unknown): void {
  assertExactObjectKeys(
    value,
    [
      "schemaVersion", "worldId", "currentPoiId", "lastTownId", "dayNumber", "occurrenceByPoi",
      "completedPoiIds", "poiWins", "everCompletedPoiIds", "visitedTownIds",
    ],
    "official world envelope",
  );
}

function validateBattleShape(value: unknown, allowLegacyWorldOrigin: boolean): void {
  assertExactObjectKeys(
    value,
    ["schemaVersion", "battleId", "origin", "encounter", "replay"],
    "official battle envelope",
  );
  const battle = value as { origin?: unknown };
  assertPlainObject(battle.origin, "official battle origin");
  const kind = (battle.origin as { kind?: unknown }).kind;
  if (kind === "world") {
    assertExactObjectKeys(battle.origin, ["kind", "worldId", "poiId"], "official world battle origin");
  } else if (kind === "dungeon") {
    assertExactObjectKeys(battle.origin, ["kind", "dungeonId", "encounterId"], "official dungeon battle origin");
  } else if (kind === "arena") {
    assertExactObjectKeys(battle.origin, ["kind", "worldId", "townId", "licenseType"], "official Arena battle origin");
  } else if (kind === "tournament") {
    assertExactObjectKeys(
      battle.origin,
      ["kind", "worldId", "townId", "tournamentIndex", "round"],
      "official Tournament battle origin",
    );
  } else if (
    allowLegacyWorldOrigin &&
    kind === undefined &&
    typeof (battle.origin as { worldId?: unknown }).worldId === "string" &&
    typeof (battle.origin as { poiId?: unknown }).poiId === "string"
  ) {
    assertExactObjectKeys(battle.origin, ["worldId", "poiId"], "legacy official world battle origin");
  } else {
    throw new Error("official battle origin is invalid");
  }
}

function validateDungeonBattleAgainstRun(
  party: WorldTripParty,
  run: DungeonRuntimeController,
  battle: OfficialBattleStateV1,
): void {
  if (battle.origin.kind !== "dungeon" || battle.encounter.kind !== "dungeon") {
    throw new Error("official dungeon battle envelope has a non-dungeon origin or encounter");
  }
  const origin = battle.origin;
  const floor = run.session.snapshot();
  if (origin.dungeonId !== floor.definitionId) {
    throw new Error("official dungeon battle origin does not own the restored current floor");
  }
  const currentEncounter = run.session.currentRoom.encounter;
  if (currentEncounter === undefined) {
    throw new Error("official dungeon battle current room has no encounter");
  }
  if (origin.encounterId !== currentEncounter.id) {
    throw new Error("official dungeon battle origin encounter does not own the current room encounter");
  }
  if (canonicalJsonValue(battle.encounter.encounter) !== canonicalJsonValue(currentEncounter)) {
    throw new Error("official dungeon battle encounter tuple/order disagrees with the current room");
  }
  const owningRosters = floor.encounterRosters?.filter((roster) =>
    roster.encounterId === origin.encounterId) ?? [];
  if (owningRosters.length > 1) {
    throw new Error("official dungeon battle stores duplicate current encounter ownership");
  }
  const storedRoster = owningRosters[0];
  if (
    storedRoster !== undefined &&
    canonicalJsonValue(storedRoster.monsters) !== canonicalJsonValue(currentEncounter.monsters)
  ) {
    throw new Error("official dungeon battle stored current encounter roster disagrees");
  }
  const expected = buildOfficialDungeonBattle(currentEncounter, party);
  if (canonicalJsonValue(expected.teams[1]) !== canonicalJsonValue(battle.replay.teams[1])) {
    throw new Error("official dungeon battle replay enemy team disagrees with encounter construction");
  }
}




function validateTerminalDefeatDungeonBattleAgainstRun(
  run: DungeonRuntimeController,
  battle: OfficialBattleStateV1,
  restored: RestoredBattleReplay,
): void {
  if (battle.origin.kind !== "dungeon" || battle.encounter.kind !== "dungeon") {
    throw new Error("official terminal dungeon battle has a non-dungeon origin or encounter");
  }
  const origin = battle.origin;
  const floor = run.session.snapshot();
  if (origin.dungeonId !== floor.definitionId) {
    throw new Error("official terminal dungeon battle origin does not own the restored current floor");
  }
  const currentEncounter = run.session.currentRoom.encounter;
  if (currentEncounter === undefined) {
    throw new Error("official terminal dungeon battle current room has no encounter");
  }
  if (origin.encounterId !== currentEncounter.id) {
    throw new Error("official terminal dungeon battle origin does not own the current room encounter");
  }
  const survivingMonsters = deriveOfficialDungeonTerminalSurvivors(
    battle.encounter.encounter,
    battle.replay.teams[1],
    restored,
  );
  if (canonicalJsonValue(currentEncounter.monsters) !== canonicalJsonValue(survivingMonsters)) {
    throw new Error("official terminal dungeon battle retained roster disagrees with battle survivors");
  }
  const retainedEncounter = {
    ...battle.encounter.encounter,
    monsters: currentEncounter.monsters,
  };
  if (canonicalJsonValue(retainedEncounter) !== canonicalJsonValue(currentEncounter)) {
    throw new Error("official terminal dungeon battle retained encounter disagrees with its room");
  }
  const owningRosters = floor.encounterRosters?.filter((roster) =>
    roster.encounterId === origin.encounterId) ?? [];
  if (owningRosters.length > 1) {
    throw new Error("official terminal dungeon battle stores duplicate current encounter ownership");
  }
  const storedRoster = owningRosters[0];
  if (
    storedRoster !== undefined &&
    canonicalJsonValue(storedRoster.monsters) !== canonicalJsonValue(survivingMonsters)
  ) {
    throw new Error("official terminal dungeon battle stored roster disagrees with battle survivors");
  }
  const expectedEnemyTeam = buildOfficialDungeonEnemyTeam(battle.encounter.encounter);
  if (canonicalJsonValue(expectedEnemyTeam) !== canonicalJsonValue(battle.replay.teams[1])) {
    throw new Error("official terminal dungeon battle replay enemy team disagrees with encounter construction");
  }
}

/** A v12/v13 terminal loss may have synchronized the room to its enemy survivors before the
 * state was migrated into v14. Save Me reverses that already-committed loss consequence before
 * installing the fresh replay; native v14+ states either have no roster override or already hold
 * this exact original roster, so they remain byte-for-byte unchanged. */
function restoreDeferredDungeonEncounterForRestart(
  prior: OfficialGameStateV1,
): OfficialGameStateV1 {
  if (
    prior.battle?.origin.kind !== "dungeon" ||
    prior.battle.encounter.kind !== "dungeon" ||
    prior.dungeon === undefined
  ) {
    return prior;
  }
  const encounterId = prior.battle.origin.encounterId;
  const originalMonsters = prior.battle.encounter.encounter.monsters;
  const run = prior.dungeon.run;
  let changed = false;
  const restoreEntry = (entry: DungeonRunSnapshot["current"]): DungeonRunSnapshot["current"] => {
    const rosters = entry.session.encounterRosters;
    if (rosters === undefined) return entry;
    const owningRoster = rosters.find((roster) => roster.encounterId === encounterId);
    if (
      owningRoster === undefined ||
      canonicalJsonValue(owningRoster.monsters) === canonicalJsonValue(originalMonsters)
    ) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      session: {
        ...entry.session,
        encounterRosters: rosters.map((roster) => roster.encounterId === encounterId
          ? { encounterId, monsters: structuredClone(originalMonsters) }
          : structuredClone(roster)),
      },
    };
  };
  const current = restoreEntry(run.current);
  const currentRoute = run.current.route;
  const cachedFloors = run.cachedFloors.map((entry) => (
    entry.route.typeName === currentRoute.typeName &&
    entry.route.sourceFile === currentRoute.sourceFile &&
    entry.route.floor === currentRoute.floor
      ? restoreEntry(entry)
      : entry
  ));
  if (!changed) return prior;
  return {
    ...prior,
    dungeon: {
      ...prior.dungeon,
      run: { ...run, current, cachedFloors },
    },
  };
}

/** V14+ defers room mutation so Save Me can restart the untouched encounter. A terminal record
 * migrated from immutable v12/v13 may already contain the exact survivor-synchronized room;
 * accept that one historical lifecycle point as well, while rejecting every other roster. */
function validateDeferredTerminalDefeatDungeonBattleAgainstRun(
  run: DungeonRuntimeController,
  battle: OfficialBattleStateV1,
  restored: RestoredBattleReplay,
): void {
  const currentEncounter = run.session.currentRoom.encounter;
  const originalEncounter = battle.encounter.kind === "dungeon"
    ? battle.encounter.encounter
    : undefined;
  if (
    currentEncounter !== undefined &&
    originalEncounter !== undefined &&
    canonicalJsonValue(currentEncounter.monsters) === canonicalJsonValue(originalEncounter.monsters)
  ) {
    if (battle.origin.kind !== "dungeon") {
      throw new Error("official deferred terminal dungeon battle has a non-dungeon origin");
    }
    const origin = battle.origin;
    const floor = run.session.snapshot();
    if (origin.dungeonId !== floor.definitionId) {
      throw new Error("official deferred terminal dungeon battle origin does not own the restored current floor");
    }
    if (origin.encounterId !== currentEncounter.id) {
      throw new Error("official deferred terminal dungeon battle origin does not own the current room encounter");
    }
    if (canonicalJsonValue(originalEncounter) !== canonicalJsonValue(currentEncounter)) {
      throw new Error("official deferred terminal dungeon battle encounter disagrees with the current room");
    }
    const owningRosters = floor.encounterRosters?.filter((roster) =>
      roster.encounterId === origin.encounterId) ?? [];
    if (owningRosters.length > 1) {
      throw new Error("official deferred terminal dungeon battle stores duplicate current encounter ownership");
    }
    if (
      owningRosters[0] !== undefined &&
      canonicalJsonValue(owningRosters[0].monsters) !== canonicalJsonValue(currentEncounter.monsters)
    ) {
      throw new Error("official deferred terminal dungeon battle stored current encounter roster disagrees");
    }
    const expectedEnemyTeam = buildOfficialDungeonEnemyTeam(originalEncounter);
    if (canonicalJsonValue(expectedEnemyTeam) !== canonicalJsonValue(battle.replay.teams[1])) {
      throw new Error("official deferred terminal dungeon battle replay enemy team disagrees with encounter construction");
    }
    return;
  }
  validateTerminalDefeatDungeonBattleAgainstRun(run, battle, restored);
}

function projectionBody<
  P extends
    | SlotProjectionV1
    | OfficialGameProjectionV12
    | OfficialGameProjectionV13
    | OfficialGameProjectionV14
    | OfficialGameProjectionV15
    | OfficialGameProjectionV16
    | OfficialGameProjectionV17
    | OfficialGameProjectionV18
    | OfficialGameProjectionV19
    | OfficialGameProjectionV20
    | OfficialGameProjectionV21
    | OfficialGameProjectionV22
    | OfficialGameProjectionV23
    | OfficialGameProjectionV24
    | OfficialGameProjectionV25
    | OfficialGameProjectionV26
    | OfficialGameProjectionV27,
>(
  projection: P,
): Omit<P, "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"> {
  const {
    slotId: _slotId,
    revision: _revision,
    updatedAt: _updatedAt,
    logicPackId: _logicPackId,
    simulationVersion: _simulationVersion,
    trustTier: _trustTier,
    ...body
  } = projection;
  return body as Omit<
    P,
    "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
  >;
}

function canonicalJsonValue(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }
  return value;
}

function classifyDomainError(error: unknown): GameServiceError {
  const message = error instanceof Error ? error.message : String(error);
  if (/unknown instanceId|unknown .*type|not found|has no POI/i.test(message)) {
    return new GameServiceError("ENTITY_NOT_FOUND", message);
  }
  if (/target/i.test(message)) return new GameServiceError("INVALID_TARGET", message);
  if (/silver|gold|afford|fund/i.test(message)) {
    return new GameServiceError("INSUFFICIENT_FUNDS", message);
  }
  return new GameServiceError("ACTION_NOT_ALLOWED", message);
}

function requireId(value: string, name: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new Error(`${name} is not a protocol-safe identifier`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function requireDungeonId(value: string, name: string): string {
  if (!/^[A-Za-z0-9._:{} ,+\-]{1,240}$/.test(value)) {
    throw new Error(`${name} is not a protocol-safe dungeon identifier`);
  }
  return value;
}

/**
 * The historical v11/v12 battle wire requires a `backgroundKey` string. Records written before the
 * presentation boundary was closed carry the shipped file name they stored, and echoing it back
 * keeps their persisted projections byte-identical under `validatePersistedRecord`. Battles built
 * since carry no resource name at all, so the semantic scene identity is emitted instead — the v13
 * wire drops the field entirely and sends `scene`.
 */
function legacyBackgroundKey(battle: OfficialBattleStateV1): string {
  const stored = battle.encounter.backgroundKey;
  if (stored !== undefined) return stored;
  const scene = officialBattleScene(battle.origin);
  switch (scene.kind) {
    case "world":
      return protocolIdSegment(`scene:world:${scene.worldId}:${scene.poiId}`);
    case "dungeon":
      return protocolIdSegment(`scene:dungeon:${scene.dungeonId}`);
    default:
      return `scene:${scene.kind}`;
  }
}

function protocolIdSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, "_");
  return normalized.slice(0, 140) || "unknown";
}

function normalizedWorlds(
  startWorld: WorldData,
  installed: readonly WorldData[] | undefined,
): readonly WorldData[] {
  const worlds = installed ?? [startWorld];
  if (worlds.length === 0 || !worlds.includes(startWorld)) {
    throw new Error("official world installation must include its start world");
  }
  const byName = new Map<string, WorldData>();
  for (const world of worlds) {
    requireId(world.name, "world.name");
    if (byName.has(world.name)) throw new Error(`duplicate official world ${world.name}`);
    byName.set(world.name, world);
  }
  if (installed !== undefined) for (const world of worlds) {
    for (const poi of world.pointsOfInterest) {
      if (poi.zoneChange?.kind !== "world") continue;
      const targetWorld = poi.zoneChange.targetWorld;
      const targetPoi = poi.zoneChange.targetZoneChange;
      if (targetWorld === undefined || targetPoi === undefined) {
        throw new Error(`official world exit ${world.name}.${poi.name} is incomplete`);
      }
      const target = byName.get(targetWorld);
      if (target === undefined) {
        throw new Error(`official world exit ${world.name}.${poi.name} targets uninstalled ${targetWorld}`);
      }
      if (!target.pointsOfInterest.some(({ name }) => name === targetPoi)) {
        throw new Error(
          `official world exit ${world.name}.${poi.name} targets missing ${targetWorld}.${targetPoi}`,
        );
      }
    }
  }
  return Object.freeze([...worlds]);
}

function sameWorldInstallation(left: readonly WorldData[], right: readonly WorldData[]): boolean {
  return left.length === right.length &&
    left.every((world) => right.some((candidate) => candidate === world));
}








function officialBattleTeams(
  teams: readonly [readonly TeamMemberSetup[], readonly TeamMemberSetup[]],
): readonly [readonly TeamMemberSetup[], readonly TeamMemberSetup[]] {
  return [
    teams[0].map((member) => structuredClone(member)),
    teams[1].map((member) => structuredClone(member)),
  ];
}

function isPositiveSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function reserveOfficialMonsterSequence(
  firstSequence: number,
  count: number,
  route: string,
): void {
  if (!isPositiveSequence(firstSequence) || !Number.isSafeInteger(count) || count < 0) {
    throw new GameServiceError("STATE_CORRUPT", `${route} has an invalid monster sequence reservation`);
  }
  if (firstSequence > Number.MAX_SAFE_INTEGER - count) {
    throw new GameServiceError("STATE_CORRUPT", `${route} exhausts the durable monster sequence`);
  }
}

function allocateOfficialMonsterSequence(
  nextSequence: number,
  route: string,
): { readonly instanceId: string; readonly nextSequence: number } {
  reserveOfficialMonsterSequence(nextSequence, 1, route);
  return {
    instanceId: `monster-${nextSequence}`,
    nextSequence: nextSequence + 1,
  };
}

function monsterJoinRewardCount(rewards: readonly PlayerReward[]): number {
  return rewards.reduce((count, reward) => count + (reward.kind === "monsterJoin" ? 1 : 0), 0);
}

function collectionGoalMonsterJoinDemand(goal: CollectionGoalDefinition): number {
  return goal.treasureData.items.reduce((count, spawn) => count + (
    spawn.kind === "fixed" &&
    spawn.data.kind === "monsterJoin" &&
    (spawn.chance === undefined || spawn.chance > 0)
      ? 1
      : 0
  ), 0);
}

function collectionGoalCanProduceEgg(goal: CollectionGoalDefinition): boolean {
  return goal.treasureData.items.some((spawn) =>
    spawn.kind === "fixed" &&
    (spawn.data.kind === "egg" || spawn.data.kind === "monsterEgg") &&
    (spawn.chance === undefined || spawn.chance > 0));
}

function officialBattleBlocksSaveMe(state: Pick<OfficialGameStateV1, "battle" | "dungeon">): boolean {
  const battle = state.battle;
  if (battle === undefined) throw new GameServiceError("STATE_CORRUPT", "defeat has no battle envelope");
  if (battle.origin.kind === "arena") return true;
  if (battle.origin.kind !== "dungeon") return false;
  const definitionId = state.dungeon?.run.current.session.definitionId ?? battle.origin.dungeonId;
  return definitionId.split(":").some((part) => isInfiniteDungeonInstance(part));
}

function isBattleCommand(
  command: GameCommandV1,
): command is Extract<GameCommandV1, { type: `battle.${string}` }> {
  return command.type === "battle.chooseAbility" ||
    command.type === "battle.attemptCapture" ||
    command.type === "battle.delay" ||
    command.type === "battle.retreat" ||
    command.type === "battle.summonSpirit";
}

function isPartyCommand(
  command: GameCommandV1,
): command is Extract<GameCommandV1, { type: `party.${string}` }> {
  return command.type === "party.commitBattingPriority" ||
    command.type === "party.combine" ||
    command.type === "party.evolve" ||
    command.type === "party.healInjury" ||
    command.type === "party.destroyMonster" ||
    command.type === "party.convertToSoulStone" ||
    command.type === "party.insertSoulStone";
}

function isDungeonCommand(
  command: GameCommandV1,
): command is Extract<GameCommandV1, { type: `dungeon.${string}` }> {
  return command.type === "dungeon.selectRoom" ||
    command.type === "dungeon.activateZone" ||
    command.type === "dungeon.travelToWaypoint" ||
    command.type === "dungeon.openTreasure" ||
    command.type === "dungeon.claimCatchReward";
}

function isQuestCommand(
  command: GameCommandV1,
): command is Extract<
  GameCommandV1,
  { type: "quest.accept" | "quest.claim" | "quest.dropAll" }
> {
  return command.type === "quest.accept" ||
    command.type === "quest.claim" ||
    command.type === "quest.dropAll";
}
