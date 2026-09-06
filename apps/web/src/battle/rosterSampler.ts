import type { GameData } from "@dib/gamedata/browser";
import {
  mulberry32,
  soulStoneMintLevel,
  type Rng,
  type SoulStoneSetup,
  type TeamMemberSetup,
} from "@dib/engine";
import { DEMO_ENCOUNTER_BACKGROUND_KEY, type EncounterConfig } from "./encounter.js";

/** Monsters fielded per side in the randomized demo scenario (3 active + 6 reserves under the
 *  source `Team.fightingGroupSize == 3`) unless an override says otherwise. */
export const RANDOM_TEAM_SIZE = 9;

/** Inclusive level range for every randomized level draw (member levels and random soul-stone
 *  sacrifice levels), centered on the demo's historical shared level 12. Stats then come from the
 *  source-exact `baseStat(monster, stat, level)` pipeline inside BattleCore — identical to a wild
 *  spawn of that monster at that level (stats.md: effective stats are fully determined by
 *  (type, level); quality plays no role). */
export const RANDOM_LEVEL_RANGE: readonly [number, number] = [8, 16];

/**
 * Opt-in DEMO feature-exercise randomization for `sampleEncounter` — the chances that a randomly
 * sampled member is promoted to a boss or handed a minted soul stone, so the demo actually
 * exercises those kits/effects. This is NOT part of the reusable encounter builder: it is passed
 * in by the demo/scenario layer (see `DEMO_FEATURE_ROLLS` in encounter.ts). Omit it entirely
 * and `sampleEncounter` produces a clean roster carrying only its explicit per-member conditions —
 * exactly the shape a real full-game encounter supplies. Explicit `boss`/`soulStone` pins always
 * win regardless.
 */
export interface FeatureRollChances {
  /** Per-slot chance a member is a boss (native Living.boss: immune to Sleep, Paralyze, Confuse,
   *  and direct Stun). At 1/9 this averages ~1 boss per 9-slot side. */
  bossChance: number;


  soulStoneChance: number;
}

/** Demo-composition RNG (NOT battle RNG): platform-random by default, seedable for scenarios.
 *  Math.random here is an accepted platform difference — only the battle stream itself carries
 *  draw-order fidelity requirements. */
export function rosterRng(seed?: number): Rng {
  if (seed !== undefined) return mulberry32(seed);
  return {
    next: () => Math.random(),
    intBelow: (n) => {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`intBelow(${n})`);
      return Math.floor(Math.random() * n);
    },
    chance: (p) => Math.random() < p,
  };
}

/** Per-position pin for one sampled team slot: any `TeamMemberSetup` field may be fixed here;
 *  every field left undefined is randomized (see the RANDOM_* constants for the distributions).
 *  `soulStone: null` forces the member to carry NO stone — undefined means "roll randomly". */
export interface MemberOverride {
  shortType?: string;
  level?: number;
  capturable?: boolean;
  boss?: boolean;
  soulStone?: SoulStoneSetup | null;
}

/** Debug/testing configuration for `sampleEncounter`. The team arrays are sparse and 0-indexed
 *  by team position: index i configures slot i+1 (slots 1-3 are the active row under the source
 *  `Team.fightingGroupSize == 3`; later slots begin on the bench). Holes and slots past the
 *  array's end are fully randomized. Not a gameplay feature — production encounters will arrive
 *  as complete EncounterConfig data. */
export interface EncounterOverrides {
  playerTeam?: readonly (MemberOverride | undefined)[];
  enemyTeam?: readonly (MemberOverride | undefined)[];
  /** Side sizes. Default RANDOM_TEAM_SIZE, auto-grown to fit a longer override array; an
   *  explicit size smaller than its override array is an error. */
  playerTeamSize?: number;
  enemyTeamSize?: number;
  /** Inclusive [min, max] replacing RANDOM_LEVEL_RANGE for this sample's random level draws. */
  levelRange?: readonly [number, number];
  /** Opt-in DEMO feature-exercise randomization (boss / soul-stone rolls per unpinned slot).
   *  Omitted → a clean roster with only its explicit conditions, the real-encounter-ready shape.
   *  See `FeatureRollChances`; the demo supplies it from `DEMO_FEATURE_ROLLS`. */
  featureRolls?: FeatureRollChances;
}

/** Uniform random encounter over the full roster (no category/quality filtering — every existing
 *  monster is eligible), with optional by-position pins (`EncounterOverrides`).
 *
 *  This is the reusable encounter BUILDER: by default it materializes only each member's explicit
 *  conditions (shortType/level/boss/capturable/soulStone), so a real full-game encounter can drive
 *  it with fully specified members and get exactly those. The demo's feature-exercise
 *  randomization (random bosses / soul stones) is strictly opt-in via `overrides.featureRolls`
 *  (see `FeatureRollChances`), keeping that scenario concern out of the core path.
 *
 *  Randomized shortTypes are a uniform without-replacement sample of every monster NOT pinned
 *  anywhere, so all random picks stay distinct from each other and from every pin; explicitly
 *  pinned duplicates are allowed (the fixed demo roster fields duplicates too). Draw order is
 *  deterministic for a seeded rng: the type sample first, then per-slot field draws in team order
 *  (player slot 1..n, then enemy slot 1..n) — a pinned field, and every feature roll when
 *  `featureRolls` is omitted, consumes no draw. */
export function sampleEncounter(
  gd: GameData,
  rng: Rng = rosterRng(),
  overrides: EncounterOverrides = {},
): EncounterConfig {
  const monsters = gd.allMonsters();
  const known = new Set(monsters.map((m) => m.shortType));

  const teamSize = (side: "player" | "enemy"): number => {
    const explicit = side === "player" ? overrides.playerTeamSize : overrides.enemyTeamSize;
    const pinned = (side === "player" ? overrides.playerTeam : overrides.enemyTeam)?.length ?? 0;
    if (explicit === undefined) return Math.max(RANDOM_TEAM_SIZE, pinned);
    if (!Number.isInteger(explicit) || explicit < 1) {
      throw new Error(`sampleEncounter: ${side}TeamSize must be a positive integer, got ${explicit}`);
    }
    if (explicit < pinned) {
      throw new Error(`sampleEncounter: ${side}TeamSize ${explicit} < ${pinned} configured ${side}Team positions`);
    }
    return explicit;
  };
  const playerSize = teamSize("player");
  const enemySize = teamSize("enemy");

  const [minLevel, maxLevel] = overrides.levelRange ?? RANDOM_LEVEL_RANGE;
  if (!Number.isInteger(minLevel) || !Number.isInteger(maxLevel) || minLevel < 1 || maxLevel < minLevel) {
    throw new Error(`sampleEncounter: bad levelRange [${minLevel}, ${maxLevel}]`);
  }
  const randomLevel = (): number => minLevel + rng.intBelow(maxLevel - minLevel + 1);

  const pinnedTypes = new Set<string>();
  let pinnedSlots = 0;
  for (const [label, team] of [
    ["playerTeam", overrides.playerTeam],
    ["enemyTeam", overrides.enemyTeam],
  ] as const) {
    team?.forEach((o, i) => {
      if (o?.shortType === undefined) return;
      if (!known.has(o.shortType)) {
        throw new Error(`sampleEncounter: unknown shortType "${o.shortType}" (${label}[${i}])`);
      }
      pinnedTypes.add(o.shortType);
      pinnedSlots++;
    });
  }

  const pool = monsters.map((m) => m.shortType).filter((t) => !pinnedTypes.has(t));
  const randomSlots = playerSize + enemySize - pinnedSlots;
  if (pool.length < randomSlots) {
    throw new Error(`sampleEncounter: ${randomSlots} random slots but only ${pool.length} unpinned monsters`);
  }
  // Partial Fisher-Yates: after i swaps, pool[0..i) is a uniform without-replacement sample.
  for (let i = 0; i < randomSlots; i++) {
    const j = i + rng.intBelow(pool.length - i);
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }

  const featureRolls = overrides.featureRolls;

  const rollSoulStone = (holderShortType: string): SoulStoneSetup | undefined => {
    // No feature-exercise randomization requested: a real encounter carries only its explicit
    // stones. Return BEFORE any draw so the roster stays clean and the rng stream is untouched.
    if (featureRolls === undefined) return undefined;
    // Desoul-carrier guard — see FeatureRollChances.soulStoneChance. Skipping the whole roll (not
    // just the equip) keeps the draw sequence identical for every non-carrier slot.
    if (gd.jobAbilitiesOrEmpty(holderShortType).some((a) => a.type === "Utility.Desoul")) {
      return undefined;
    }
    if (!rng.chance(featureRolls.soulStoneChance)) return undefined;
    const sacrifice = monsters[rng.intBelow(monsters.length)]!;
    return {
      element: sacrifice.element,
      level: soulStoneMintLevel(sacrifice.stars, randomLevel()),
      sourceType: sacrifice.shortType,
    };
  };

  let nextType = 0;
  const buildTeam = (
    label: "playerTeam" | "enemyTeam",
    size: number,
    team: readonly (MemberOverride | undefined)[] | undefined,
  ): TeamMemberSetup[] => {
    const members: TeamMemberSetup[] = [];
    for (let i = 0; i < size; i++) {
      const o = team?.[i] ?? {};
      if (o.level !== undefined && (!Number.isInteger(o.level) || o.level < 1)) {
        throw new Error(`sampleEncounter: bad level ${o.level} (${label}[${i}])`);
      }
      const member: TeamMemberSetup = {
        shortType: o.shortType ?? pool[nextType++]!,
        level: o.level ?? randomLevel(),
      };
      // TeamMemberSetup keeps its engine defaults implicit: only deviations are materialized
      // (exactOptionalPropertyTypes also rejects explicit undefined assignments here).
      // Boss/soul-stone are DEMO feature-exercise rolls, opt-in via `featureRolls`; a real
      // encounter (featureRolls omitted) gets only its explicit pins. The roll sits behind `??` so
      // a defined pin never triggers it — and returns false without drawing when feature rolls are
      // off — keeping the rng stream identical to a pure explicit-pin build.
      const rollBoss = (): boolean => featureRolls !== undefined && rng.chance(featureRolls.bossChance);
      if (o.boss ?? rollBoss()) member.boss = true;
      // `capturable` is never randomized: the engine already renders no capture card for the one
      // legitimately-uncapturable case a random roster produces — a `Summon`-category monster
      // (`core.ts` captureStatusOf) — so a synthetic non-capturable roll only stripped the card
      // from ordinary monsters that should have one. Explicit per-slot pins still force it off.
      if (o.capturable === false) member.capturable = false;
      const soulStone = o.soulStone === undefined ? rollSoulStone(member.shortType) : o.soulStone;
      if (soulStone !== undefined && soulStone !== null) member.soulStone = soulStone;
      members.push(member);
    }
    return members;
  };

  return {
    backgroundKey: DEMO_ENCOUNTER_BACKGROUND_KEY,
    playerTeam: buildTeam("playerTeam", playerSize, overrides.playerTeam),
    enemyTeam: buildTeam("enemyTeam", enemySize, overrides.enemyTeam),
  };
}

/** True when every species referenced by an encounter exists in the selected content package.
 * The deterministic browser harness historically defaults to the fixed DIB demo fixture. A
 * structurally compatible custom archive may use wholly independent species identities, so boot
 * uses this check to retain that fixture only when it belongs to the selected package and falls
 * back to a seeded content-local sample otherwise. */
export function encounterUsesKnownMonsters(gd: GameData, encounter: EncounterConfig): boolean {
  const known = new Set(gd.allMonsters().map((monster) => monster.shortType));
  return [...encounter.playerTeam, ...encounter.enemyTeam].every((member) => known.has(member.shortType));
}
