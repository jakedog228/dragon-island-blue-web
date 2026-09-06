import type { GameData, WorldData } from "@dib/gamedata/browser";
import {
  WorldTrip,
  WorldTripParty,
  baseStat,
  jobXpForLevel,
  type GuildQuestEvent,
  type Rng,
  type SoulStoneSetup,
  type WorldTripSharedState,
  type WorldDefinition,
} from "@dib/engine";
import type { PlayerProfile } from "../player/playerProfile.js";

/** Baseline world used when a selected content package has no saved world in progress. */
export const DEMO_WORLD_CONFIG: {
  readonly worldName: string;
  readonly initialPoiName: string;
  readonly party: DemoWorldPartyConfig;
} = {
  // Bottom-left shipped overworld tile. Its localized source name is the intentionally spelled
  // "Southern Alvalon" (`RenderableWorld_1-1NameKey`). Keep the world and POI pins together:
  // `First_City` is authored in this tile, and boot selects these exact identities when available.
  worldName: "World_1-1",
  initialPoiName: "First_City",
  party: {
    size: 6,
    battingOrderSize: 6,
    // Shipped outdoor worlds currently author challenge level 1. Stay below the source's level-7
    // auto-skip gate so ordinary destination rolls can enter combat.
    levelRange: [5, 6],
  },
};

export interface DemoPartyMemberOverride {
  readonly shortType?: string;
  readonly level?: number;
  /** Deterministic browser-fixture partial progress added to the source level boundary. */
  readonly xpIntoLevel?: number;
  readonly currentHp?: number;
  readonly injureTime?: number;
  readonly healTime?: number;
  readonly soulStone?: SoulStoneSetup;
}

export interface DemoWorldPartyConfig {
  readonly size: number;
  readonly battingOrderSize: number;
  readonly levelRange: readonly [number, number];
  readonly members?: readonly (DemoPartyMemberOverride | undefined)[];
  /** Deterministic browser-fixture loose inventory. Production/demo defaults omit it. */
  readonly soulStones?: readonly SoulStoneSetup[];
}

/**
 * Shell-only random party assignment for the navigation demo. This is deliberately separate from
 * the source encounter RNG: it replaces the absent new-game/save picker, while every subsequent
 * world roll is owned by `WorldTrip` and retains the recovered source draw order.
 */
export function createRandomDemoParty(
  data: GameData,
  rng: Rng,
  config: DemoWorldPartyConfig,
): WorldTripParty {
  if (!Number.isInteger(config.size) || config.size < 1) {
    throw new Error(`demo party size must be a positive integer; got ${config.size}`);
  }
  if (!Number.isInteger(config.battingOrderSize) || config.battingOrderSize < 1 || config.battingOrderSize > config.size) {
    throw new Error(
      `demo battingOrderSize must be an integer in [1, ${config.size}]; got ${config.battingOrderSize}`,
    );
  }
  const [minLevel, maxLevel] = config.levelRange;
  if (!Number.isInteger(minLevel) || !Number.isInteger(maxLevel) || minLevel < 1 || maxLevel < minLevel) {
    throw new Error(`bad demo party levelRange [${minLevel}, ${maxLevel}]`);
  }
  if ((config.members?.length ?? 0) > config.size) {
    throw new Error(`demo party has ${config.members!.length} overrides for ${config.size} slots`);
  }

  // Player-owned parties are ordinary monsters. Summons, eggs, combination placeholders, and
  // collection-only forms are not valid random new-game bench entries.
  const eligible = data.allMonsters().filter((monster) => monster.category === "Normal");
  const known = new Set(eligible.map((monster) => monster.shortType));
  const pinned = new Set<string>();
  for (const [index, override] of (config.members ?? []).entries()) {
    if (override?.shortType === undefined) continue;
    if (!known.has(override.shortType)) {
      throw new Error(`demo party member ${index} pins ineligible or unknown type ${override.shortType}`);
    }
    if (pinned.has(override.shortType)) {
      throw new Error(`demo party pins duplicate type ${override.shortType}`);
    }
    pinned.add(override.shortType);
  }
  const pool = eligible.map((monster) => monster.shortType).filter((shortType) => !pinned.has(shortType));
  const randomSlots = config.size - pinned.size;
  if (pool.length < randomSlots) {
    throw new Error(`demo party needs ${randomSlots} random members but only ${pool.length} are eligible`);
  }
  for (let index = 0; index < randomSlots; index += 1) {
    const swapIndex = index + rng.intBelow(pool.length - index);
    [pool[index], pool[swapIndex]] = [pool[swapIndex]!, pool[index]!];
  }

  let nextRandomType = 0;
  const members = Array.from({ length: config.size }, (_, index) => {
    const override = config.members?.[index];
    const shortType = override?.shortType ?? pool[nextRandomType++]!;
    const level = override?.level ?? minLevel + rng.intBelow(maxLevel - minLevel + 1);
    if (!Number.isInteger(level) || level < 1 || level > 150) {
      throw new Error(`demo party member ${index} has invalid level ${level}`);
    }
    if (
      override?.xpIntoLevel !== undefined &&
      (!Number.isSafeInteger(override.xpIntoLevel) || override.xpIntoLevel < 0)
    ) {
      throw new Error(
        `demo party member ${index} has invalid xpIntoLevel ${override.xpIntoLevel}`,
      );
    }
    const monster = data.monsterByShortType(shortType);
    return {
      instanceId: `demo-party-${index + 1}`,
      shortType,
      level,
      cumulativeXp:
        jobXpForLevel(level, data.jobXpPenalty(shortType)) +
        (override?.xpIntoLevel ?? 0),
      currentHp: override?.currentHp ?? baseStat(monster, "MaxHP", level),
      ...(override?.injureTime === undefined ? {} : { injureTime: override.injureTime }),
      ...(override?.healTime === undefined ? {} : { healTime: override.healTime }),
      ...(override?.soulStone === undefined ? {} : { soulStone: override.soulStone }),
    };
  });
  return new WorldTripParty(data, members, config.battingOrderSize, config.soulStones ?? []);
}


export function createSourceNewGameParty(data: GameData, shortType: string): WorldTripParty {
  const monster = data.monsterByShortType(shortType);
  const level = 1;
  return new WorldTripParty(data, [{
    instanceId: `new-game-starter-${shortType}`,
    shortType,
    level,
    cumulativeXp: jobXpForLevel(level, data.jobXpPenalty(shortType)),
    currentHp: baseStat(monster, "MaxHP", level),
  }], data.license("Novice").battingOrderSize);
}


export function recordDemoEvolutionHistory(
  profile: PlayerProfile,
  party: WorldTripParty,
  data: GameData,
): void {
  for (const monster of party.monsters()) {
    const chain = data.evolveChainOf(monster.shortType);
    const stageIndex = chain.indexOf(monster.shortType);
    for (let i = 0; i < stageIndex; i += 1) {
      const ancestor = chain[i]!;
      // Every pre-leaf stage evolves, so evolveData is always present; guard defensively regardless.
      const evolveLevel = data.monsterByShortType(ancestor).evolveData?.levelReq;
      if (evolveLevel === undefined) continue;
      profile.recordCapturedMonster(ancestor, evolveLevel);
    }
    // This helper is the explicit synthetic-bootstrap boundary. Normal runtime construction must
    // never promote current ownership into persistent capture history or Hero progression.
    profile.recordCapturedMonster(monster.shortType, monster.level);
  }
}

export interface WorldFixedEncounterState {
  hasCompletedFixedEncounter(key: string): boolean;
  canUseQuestKey(key: string): boolean;
}

/** Adapts the strict imported representation to the engine's renderer-free source model. */
export function createWorldTrip(
  world: WorldData,
  initialPoiName: string,
  rng: Rng,
  randomMonsterTypes: readonly string[],
  sharedState?: WorldTripSharedState,
  fixedEncounterState?: WorldFixedEncounterState,
  /** Local-simulation POI quest events (source events 1 and 2). Omit under Official authority. */
  onQuestEvent?: (event: GuildQuestEvent) => void,
): WorldTrip {
  const definition: WorldDefinition = {
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
          throw new Error(`POI ${point.name} changes encounter scalars between table tiers`);
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
    // Source retains stale connection strings, but missing Objective-C endpoint lookups become
    // nil/no-op during availability traversal. Omitting those graph edges here is the pure-engine
    // equivalent; imported WorldData still preserves and discloses every authored string.
    connections: world.connections
      .filter((connection) => (connection.missingPointNames?.length ?? 0) === 0)
      .map((connection) => ({
        poi1: connection.poi1,
        poi2: connection.poi2,
        // The shipped conditioned edge is First_City <-> 1-1_Forest_1, unlocked by the durable
        // completion written after winning the staged Leslie encounter at 1-1_Field_1.
        ...(connection.requiredCompletedPoiNames === undefined
          ? {}
          : { requiredCompletedPoiNames: connection.requiredCompletedPoiNames }),
      })),
  };
  const trip = new WorldTrip(definition, initialPoiName, rng, {
    randomMonsterTypes,
    ...(sharedState === undefined ? {} : { sharedState }),
    ...(fixedEncounterState === undefined
      ? {}
      : {
          hasCompletedFixedEncounter: (key: string) =>
            fixedEncounterState.hasCompletedFixedEncounter(key),
          canUseQuestKey: (key: string) => fixedEncounterState.canUseQuestKey(key),
        }),
    ...(onQuestEvent === undefined ? {} : { onQuestEvent }),
  });
  trip.begin();
  return trip;
}
