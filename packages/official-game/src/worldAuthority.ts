import type { BattleSceneV1 } from "@dib/game-protocol";
import type { PlayerLicenseType } from "@dib/player-domain";
import type {
  DungeonBreederSpec,
  GameData,
  WorldData,
  WorldPointOfInterest,
} from "@dib/gamedata";
import {
  WorldTrip,
  createWorldTripSharedState,
  type GeneratedWorldEncounter,
  type GuildQuestEvent,
  type Rng,
  type TeamMemberSetup,
  type WorldDefinition,
  type WorldTripParty,
  type WorldTripSharedState,
  type DungeonEncounter,
  type PlayerReward,
  type TournamentEncounter,
} from "@dib/engine";

export interface OfficialWorldStateV1 {
  readonly schemaVersion: 1;
  readonly worldId: string;
  readonly currentPoiId: string;
  readonly lastTownId: string;
  readonly dayNumber: number;
  readonly occurrenceByPoi: Readonly<Record<string, boolean>>;
  readonly completedPoiIds: readonly string[];
  readonly poiWins: Readonly<Record<string, number>>;
  readonly everCompletedPoiIds: readonly string[];
  readonly visitedTownIds: readonly string[];
}

/**
 * Historical only. Battles built before the presentation boundary was closed persisted the shipped
 * combat-background file name here; the v12 wire still has to echo whatever those records stored.
 * Nothing constructs it any more — a battle's scene is derived from its origin, and the browser
 * resolves that against the archive it loaded locally.
 */
type LegacyBackgroundKeyV1 = { readonly backgroundKey?: string };

/** Where a battle came from. This is the authority's own record of the encounter, and the only
 * input the projected scene is derived from. */
export type OfficialBattleOriginV1 =
  | { readonly kind: "world"; readonly worldId: string; readonly poiId: string }
  | { readonly kind: "dungeon"; readonly dungeonId: string; readonly encounterId: string }
  | {
      readonly kind: "arena";
      readonly worldId: string;
      readonly townId: string;
      readonly licenseType: PlayerLicenseType;
    }
  | {
      readonly kind: "tournament";
      readonly worldId: string;
      readonly townId: string;
      readonly tournamentIndex: number;
      readonly round: number;
    };

interface OfficialBattleEncounterCommonV1 extends LegacyBackgroundKeyV1 {
  readonly generated: GeneratedWorldEncounter;
  readonly allowRetreat: boolean;
  readonly breederXpBonus?: number;
  readonly rewards: NonNullable<GeneratedWorldEncounter["rewards"]>;
}
export type OfficialBattleEncounterV1 =
    | (OfficialBattleEncounterCommonV1 & { readonly kind: "world" })
    | (OfficialBattleEncounterCommonV1 & { readonly kind: "arena" })
    | (OfficialBattleEncounterCommonV1 & { readonly kind: "tournament" })
  | (LegacyBackgroundKeyV1 & {
      readonly kind: "dungeon";
      readonly encounter: DungeonEncounter;
      readonly allowRetreat: boolean;
      readonly breederXpBonus?: number;
      readonly rewards: readonly PlayerReward[];
    });

/**
 * World data resolves a fixed encounter's `chatKey` eagerly into a full `ChatDefinition`, portrait
 * and all. The authority only ever reads the chat's `name` and `alwaysShow` to decide whether to
 * request its presentation, so the portrait file is dropped before the encounter is persisted —
 * the browser resolves it from the archive it loaded, exactly as it does offline.
 */
function withoutChatPresentation(generated: GeneratedWorldEncounter): GeneratedWorldEncounter {
  const clone = structuredClone(generated);
  const strip = (
    event: NonNullable<GeneratedWorldEncounter["startEvent"]>,
  ): NonNullable<GeneratedWorldEncounter["startEvent"]> => {
    const { imageFile: _portrait, ...chat } = event.chat;
    return { ...event, chat };
  };
  return {
    ...clone,
    ...(clone.startEvent === undefined ? {} : { startEvent: strip(clone.startEvent) }),
    ...(clone.winEvent === undefined ? {} : { winEvent: strip(clone.winEvent) }),
  };
}

/**
 * The semantic scene a battle is fought in, taken from the battle's own origin. The authority does
 * not know or store which background art presents a scene; the browser resolves that against the
 * archive it loaded locally, exactly as it already does for offline play.
 */
export function officialBattleScene(
  origin: OfficialBattleOriginV1,
): BattleSceneV1 {
  switch (origin.kind) {
    case "world":
      return { kind: "world", worldId: origin.worldId, poiId: origin.poiId };
    case "dungeon":
      return { kind: "dungeon", dungeonId: origin.dungeonId };
    case "arena":
      return { kind: "arena" };
    case "tournament":
      return { kind: "tournament" };
  }
}

/**
 * Fails closed before a world can be installed as authoritative. Runtime encounter generation must
 * never be the first place an operator discovers that a reachable authored mechanic has no server
 * implementation.
 */
export function validateOfficialWorldSupport(data: GameData, world: WorldData): void {
  requireId(world.name, "world.name");
  worldDefinition(world);
  const knownMonsters = new Set(data.allMonsters().map((monster) => monster.shortType));
  if (knownMonsters.size === 0) throw new Error("official logic pack contains no monsters");

  for (const poi of world.pointsOfInterest) {
    requireId(poi.name, "POI name");
    for (const populator of poi.randomPopulators) {
      for (const weighted of populator.types) {
        if (weighted.type !== "Random" && !knownMonsters.has(weighted.type)) {
          throw new Error(`official POI ${poi.name} references unknown monster ${weighted.type}`);
        }
      }
      for (const fixed of populator.fixedEncounters) {
        parseBreeder(fixed.breeder);
        if (fixed.monsters.length === 0) {
          throw new Error(`official POI ${poi.name} has an empty fixed encounter`);
        }
        for (const [index, monster] of fixed.monsters.entries()) {
          if (!knownMonsters.has(monster.type)) {
            throw new Error(
              `official POI ${poi.name} fixed encounter references unknown monster ${monster.type}`,
            );
          }
          parseExtraLivingArguments(monster.extraLivingArguments, poi.name, index);
        }
        for (const item of fixed.treasureData?.items ?? []) {
          if (item.kind !== "fixed") continue;
          if (
            (item.data.kind === "spiritTotem" || item.data.kind === "monsterJoin") &&
            !knownMonsters.has(item.data.shortType)
          ) {
            throw new Error(
              `official POI ${poi.name} reward references unknown monster ${item.data.shortType}`,
            );
          }
          if (item.data.kind === "recipe") data.combineRecipe(item.data.combineName);
        }
      }
    }
  }
}

export function createInitialOfficialWorldState(
  world: WorldData,
  townId: string,
): OfficialWorldStateV1 {
  requirePoi(world, townId);
  const shared = createWorldTripSharedState();
  shared.completedThisRefresh.add(townId);
  shared.everCompletedPois.add(townId);
  return snapshotOfficialWorldState(world.name, townId, townId, shared, [townId]);
}

export function restoreOfficialWorldSharedState(
  state: OfficialWorldStateV1,
): WorldTripSharedState {
  requireId(state.worldId, "worldId");
  requireId(state.currentPoiId, "currentPoiId");
  requireId(state.lastTownId, "lastTownId");
  if (!Number.isSafeInteger(state.dayNumber) || state.dayNumber < 1) {
    throw new Error(`invalid official world day ${state.dayNumber}`);
  }
  const occurrenceThisRefresh = new Map<string, boolean>();
  for (const [poi, occurs] of Object.entries(state.occurrenceByPoi)) {
    requireId(poi, "occurrence POI");
    if (typeof occurs !== "boolean") throw new Error(`invalid occurrence value for ${poi}`);
    occurrenceThisRefresh.set(poi, occurs);
  }
  const completedThisRefresh = new Set(state.completedPoiIds.map((poi) => requireId(poi, "completed POI")));
  const poiWins = new Map<string, number>();
  for (const [poi, wins] of Object.entries(state.poiWins)) {
    requireId(poi, "win POI");
    if (!Number.isSafeInteger(wins) || wins < 0) throw new Error(`invalid POI wins for ${poi}`);
    poiWins.set(poi, wins);
  }
  const everCompletedPois = new Set(
    state.everCompletedPoiIds.map((poi) => requireId(poi, "ever-completed POI")),
  );
  validateSortedUniqueIds(state.visitedTownIds, "visited town");
  if (!state.visitedTownIds.includes(state.lastTownId)) {
    throw new Error(`official world last town ${state.lastTownId} is not recorded as visited`);
  }
  return {
    occurrenceThisRefresh,
    completedThisRefresh,
    poiWins,
    everCompletedPois,
    // Process-global in the source and deliberately not part of OfficialWorldStateV1: the event-2
    // notify gate is app-run scoped, so a restored authority trip starts with none recorded.
    notifiedCompletedPois: new Set<string>(),
    dayNumber: state.dayNumber,
  };
}

export function snapshotOfficialWorldState(
  worldId: string,
  currentPoiId: string,
  lastTownId: string,
  shared: WorldTripSharedState,
  visitedTownIds: readonly string[],
): OfficialWorldStateV1 {
  const visited = [...new Set(visitedTownIds.map((town) => requireId(town, "visited town")))];
  if (!visited.includes(lastTownId)) visited.push(lastTownId);
  visited.sort();
  return {
    schemaVersion: 1,
    worldId: requireId(worldId, "worldId"),
    currentPoiId: requireId(currentPoiId, "currentPoiId"),
    lastTownId: requireId(lastTownId, "lastTownId"),
    dayNumber: shared.dayNumber,
    occurrenceByPoi: Object.fromEntries([...shared.occurrenceThisRefresh].sort(compareEntry)),
    completedPoiIds: [...shared.completedThisRefresh].sort(),
    poiWins: Object.fromEntries([...shared.poiWins].sort(compareEntry)),
    everCompletedPoiIds: [...shared.everCompletedPois].sort(),
    visitedTownIds: visited,
  };
}

export function restoreOfficialWorldTrip(options: {
  readonly data: GameData;
  readonly world: WorldData;
  readonly state: OfficialWorldStateV1;
  readonly rng: Rng;
  readonly hasCompletedFixedEncounter: (key: string) => boolean;
  readonly canUseQuestKey: (key: string) => boolean;
  /** Source POI quest-event producers (events 1 and 2), reduced inside the command transaction. */
  readonly onQuestEvent?: (event: GuildQuestEvent) => void;
}): { readonly trip: WorldTrip; readonly shared: WorldTripSharedState } {
  if (options.state.worldId !== options.world.name) {
    throw new Error(
      `saved world ${options.state.worldId} does not match installed world ${options.world.name}`,
    );
  }
  requirePoi(options.world, options.state.currentPoiId);
  const shared = restoreOfficialWorldSharedState(options.state);
  const trip = new WorldTrip(
    worldDefinition(options.world),
    options.state.currentPoiId,
    options.rng,
    {
      randomMonsterTypes: options.data.allMonsters()
        .filter((monster) => monster.category === "Normal")
        .map((monster) => monster.shortType),
      sharedState: shared,
      hasCompletedFixedEncounter: options.hasCompletedFixedEncounter,
      canUseQuestKey: options.canUseQuestKey,
      ...(options.onQuestEvent === undefined ? {} : { onQuestEvent: options.onQuestEvent }),
    },
  );
  trip.begin();
  return { trip, shared };
}

export function buildOfficialWorldBattle(
  generated: GeneratedWorldEncounter,
  world: WorldData,
  party: WorldTripParty,
): {
  readonly encounter: OfficialBattleEncounterV1;
  readonly teams: readonly [readonly TeamMemberSetup[], readonly TeamMemberSetup[]];
} {
  const playerTeam = party.projectAliveBattingPrefix();
  if (playerTeam.length === 0) throw new Error("official world battle has no living player lineup");
  // Still a hard admission gate even though nothing presentational is read from the POI: an
  // encounter must name a POI this world actually owns.
  requirePoi(world, generated.poiName);
  const breeder = parseBreeder(generated.breeder);
  const enemyTeam = generated.monsters.map((monster, index): TeamMemberSetup => {
    const extra = parseExtraLivingArguments(
      monster.extraLivingArguments,
      generated.poiName,
      index,
    );
    return {
      shortType: monster.type,
      level: monster.level,
      ...extra,
      ...(Object.keys(breeder.stats).length === 0
        ? {}
        : { flatStatBonuses: breeder.stats }),
      ...(breeder.present ? { capturable: breeder.allowCapture } : {}),
    };
  });
  if (enemyTeam.length === 0) {
    throw new Error(`official world encounter ${generated.poiName} has no enemies`);
  }
  return {
    encounter: {
      kind: "world",
      generated: withoutChatPresentation(generated),
      allowRetreat: true,
      ...(breeder.xpBonus === undefined ? {} : { breederXpBonus: breeder.xpBonus }),
      rewards: structuredClone(generated.rewards ?? []),
    },
    teams: [
      playerTeam.map((member) => structuredClone(member)),
      enemyTeam.map((member) => structuredClone(member)),
    ],
  };
}

/** Server-owned Arena encounter translation. The caller has already selected the next license
 * from durable profile state; no client-authored level, roster, reward, or background enters. */
export function buildOfficialArenaBattle(
  generated: GeneratedWorldEncounter,
  party: WorldTripParty,
): {
  readonly encounter: Extract<OfficialBattleEncounterV1, { kind: "arena" }>;
  readonly teams: readonly [readonly TeamMemberSetup[], readonly TeamMemberSetup[]];
} {
  const playerTeam = party.projectAliveBattingPrefix();
  if (playerTeam.length === 0) throw new Error("official Arena battle has no living player lineup");
  const breeder = parseBreeder(generated.breeder);
  const enemyTeam = generated.monsters.map((monster, index): TeamMemberSetup => ({
    shortType: monster.type,
    level: monster.level,
    ...parseExtraLivingArguments(monster.extraLivingArguments, generated.poiName, index),
    ...(Object.keys(breeder.stats).length === 0 ? {} : { flatStatBonuses: breeder.stats }),
    ...(breeder.present ? { capturable: breeder.allowCapture } : {}),
  }));
  if (enemyTeam.length === 0) throw new Error("official Arena challenge has no enemies");
  return {
    encounter: {
      kind: "arena",
      generated: withoutChatPresentation(generated),
      allowRetreat: false,
      ...(breeder.xpBonus === undefined ? {} : { breederXpBonus: breeder.xpBonus }),
      rewards: [],
    },
    teams: [
      playerTeam.map((member) => structuredClone(member)),
      enemyTeam.map((member) => structuredClone(member)),
    ],
  };
}

export function buildOfficialTournamentBattle(
  tournament: TournamentEncounter,
  party: WorldTripParty,
): {
  readonly encounter: Extract<OfficialBattleEncounterV1, { kind: "tournament" }>;
  readonly teams: readonly [readonly TeamMemberSetup[], readonly TeamMemberSetup[]];
} {
  const arena = buildOfficialArenaBattle(tournament.encounter, party);
  return {
    encounter: {
      ...arena.encounter,
      kind: "tournament",
      rewards: tournament.rewards.map((reward) => structuredClone(reward)),
    },
    teams: arena.teams,
  };
}

export function buildOfficialDungeonBattle(
  encounter: DungeonEncounter,
  party: WorldTripParty,
): {
  readonly encounter: Extract<OfficialBattleEncounterV1, { kind: "dungeon" }>;
  readonly teams: readonly [readonly TeamMemberSetup[], readonly TeamMemberSetup[]];
} {
  const playerTeam = party.projectAliveBattingPrefix();
  if (playerTeam.length === 0) throw new Error("official dungeon battle has no living player lineup");
  const breeder = parseBreeder(encounter.breeder);
  const enemyTeam = buildOfficialDungeonEnemyTeam(encounter);
  if (enemyTeam.length === 0) throw new Error(`official dungeon encounter ${encounter.id} has no enemies`);
  return {
    encounter: {
      kind: "dungeon",
      encounter: structuredClone(encounter),
      allowRetreat: true,
      ...(breeder.xpBonus === undefined ? {} : { breederXpBonus: breeder.xpBonus }),
      rewards: structuredClone(encounter.treasure?.loot ?? []),
    },
    teams: [
      playerTeam.map((member) => structuredClone(member)),
      enemyTeam.map((member) => structuredClone(member)),
    ],
  };
}


export function buildOfficialDungeonEnemyTeam(
  encounter: DungeonEncounter,
): readonly TeamMemberSetup[] {
  const breeder = parseBreeder(encounter.breeder);
  const enemyTeam = encounter.monsters.map((monster, index): TeamMemberSetup => ({
    shortType: monster.type,
    level: monster.level,
    ...parseExtraLivingArguments(monster.extraLivingArguments, encounter.id, index),
    ...(Object.keys(breeder.stats).length === 0 ? {} : { flatStatBonuses: breeder.stats }),
    ...(breeder.present ? { capturable: breeder.allowCapture } : {}),
  }));
  if (enemyTeam.length === 0) throw new Error(`official dungeon encounter ${encounter.id} has no enemies`);
  return enemyTeam;
}

function worldDefinition(world: WorldData): WorldDefinition {
  return {
    instanceName: world.name,
    challengeLevel: world.challengeLevel,
    encounterChance: world.encounterChance,
    pointsOfInterest: world.pointsOfInterest.map((point) => {
      const populators = point.randomPopulators;
      if (populators.length === 0) {
        return point.hasEncounterTable
          ? { instanceName: point.name, encounter: { table: {} } }
          : { instanceName: point.name };
      }
      const first = populators[0]!;
      for (const populator of populators.slice(1)) {
        if (
          populator.encounterLevelScalor !== first.encounterLevelScalor ||
          populator.itterationScalor !== first.itterationScalor
        ) {
          throw new Error(`POI ${point.name} changes encounter scalars between tiers`);
        }
      }
      return {
        instanceName: point.name,
        encounter: {
          levelScalor: first.encounterLevelScalor,
          itterationScalor: first.itterationScalor,
          table: Object.fromEntries(populators.map((populator) => [
            String(populator.tier),
            {
              monsterPopulator: {
                class: "DefaultMonsterPopulator" as const,
                minMonstersPerPack: populator.minMonstersPerPack,
                maxMonstersPerPack: populator.maxMonstersPerPack,
                levelScalor: populator.populatorLevelScalor,
                types: populator.types.map(({ type, chance }) => ({ type, chance })),
                fixedEncounters: populator.fixedEncounters,
              },
            },
          ])),
        },
      };
    }),
    connections: world.connections
      .filter((connection) => (connection.missingPointNames?.length ?? 0) === 0)
      .map((connection) => ({
        poi1: connection.poi1,
        poi2: connection.poi2,
        ...(connection.requiredCompletedPoiNames === undefined
          ? {}
          : { requiredCompletedPoiNames: connection.requiredCompletedPoiNames }),
      })),
  };
}

function parseBreeder(breeder: DungeonBreederSpec | undefined): {
  readonly present: boolean;
  readonly stats: Partial<Record<"Attack" | "Defense" | "Magic" | "MaxHP" | "Resist" | "Speed", number>>;
  readonly xpBonus?: number;
  readonly allowCapture: boolean;
} {
  if (breeder === undefined) return { present: false, stats: {}, allowCapture: true };
  if (breeder.type !== "Normal") throw new Error(`unsupported official breeder ${breeder.type}`);
  const stats: Record<string, number> = {};
  const rawStats = breeder.arguments["stats"];
  if (rawStats !== undefined) {
    if (!isRecord(rawStats)) throw new Error("official breeder stats must be an object");
    for (const [name, value] of Object.entries(rawStats)) {
      if (!["Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed"].includes(name)) {
        throw new Error(`unsupported official breeder stat ${name}`);
      }
      if (!Number.isSafeInteger(value)) throw new Error(`invalid official breeder stat ${name}`);
      if ((value as number) > 0) stats[name] = value as number;
    }
  }
  const xpBonus = breeder.arguments["xpBonus"];
  if (xpBonus !== undefined && (
    typeof xpBonus !== "number" || !Number.isFinite(xpBonus) || xpBonus < 0
  )) {
    throw new Error("official breeder xpBonus must be nonnegative");
  }
  const allowCapture = breeder.arguments["allowCapture"];
  if (allowCapture !== undefined && typeof allowCapture !== "boolean") {
    throw new Error("official breeder allowCapture must be boolean");
  }
  return {
    present: true,
    stats,
    // Preserve Breeder's native 1.0 default in durable battle state/projections. The browser can
    // then recover the exact nonnil-breeder music branch on a fresh mount or reconnect without
    // trusting a client-authored monster flag.
    xpBonus: xpBonus ?? 1,
    allowCapture: allowCapture ?? false,
  };
}

function parseExtraLivingArguments(
  value: Readonly<Record<string, unknown>> | undefined,
  poi: string,
  index: number,
): Partial<TeamMemberSetup> {
  if (value === undefined) return {};
  const result: Partial<TeamMemberSetup> = {};
  for (const [key, argument] of Object.entries(value)) {
    if (key === "boss") {
      if (typeof argument !== "boolean") throw livingArgumentError(poi, index, key);
      result.boss = argument;
    } else if (key === "capturable" || key === "allowCapture") {
      if (typeof argument !== "boolean") throw livingArgumentError(poi, index, key);
      result.capturable = argument;
    } else if (key === "displayName" || key === "rendererData") {
      // Presentation stays browser-local and never enters the authoritative team setup.
      continue;
    } else {
      throw new Error(`official encounter ${poi} monster ${index} has unsupported argument ${key}`);
    }
  }
  return result;
}

function requirePoi(world: WorldData, poiId: string): WorldPointOfInterest {
  const poi = world.pointsOfInterest.find((candidate) => candidate.name === poiId);
  if (poi === undefined) throw new Error(`world ${world.name} has no POI ${poiId}`);
  return poi;
}

function livingArgumentError(poi: string, index: number, key: string): Error {
  return new Error(`official encounter ${poi} monster ${index} has invalid ${key}`);
}

function requireId(value: string, label: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw new Error(`${label} is not a protocol-safe identifier`);
  }
  return value;
}

function compareEntry(left: readonly [string, unknown], right: readonly [string, unknown]): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

function validateSortedUniqueIds(values: readonly string[], label: string): void {
  if (!Array.isArray(values)) throw new Error(`official world ${label} array is malformed`);
  let previous: string | undefined;
  for (const value of values) {
    requireId(value, label);
    if (previous !== undefined && previous >= value) {
      throw new Error(`official world ${label} ids must be sorted and unique`);
    }
    previous = value;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
