import type { EncounterConfig } from "../battle/encounter.js";
import type { StatName } from "@dib/gamedata";

export const SCENARIO_KINDS = ["combat", "egg", "arena"] as const;
export type ScenarioKind = typeof SCENARIO_KINDS[number];

export const SCENARIO_TRANSPORTS = ["offline", "online"] as const;
export type ScenarioTransport = typeof SCENARIO_TRANSPORTS[number];

export const SCENARIO_COMBAT_EXAMPLES = ["random", "reserve", "starter", "ice-storm"] as const;
export type ScenarioCombatExample = typeof SCENARIO_COMBAT_EXAMPLES[number];

export const SCENARIO_USABLE_SLOTS = ["usable1", "usable2", "usable3", "usable4"] as const;
export type ScenarioUsableSlot = typeof SCENARIO_USABLE_SLOTS[number];

export interface ScenarioJobAbilityConfiguration {
  readonly abilityPath: string;
  /** The complete Job.jobAbilities[slot].arguments dictionary. Slot-local values such as
   * activationLength, aiChance, components, buffs, and scalars materially affect combat. */
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ScenarioPassiveAbilityConfiguration extends ScenarioJobAbilityConfiguration {
  /** Native passive slot names are semantic display/order identities, not necessarily `passiveN`. */
  readonly slot: string;
}

export interface ScenarioSoulStoneConfiguration {
  /** The sacrificed species. Its element selects the shipped SoulStone definition and Desoul
   * revives this exact species. */
  readonly sourceType: string;
  readonly level: number;
}

export interface ScenarioGemConfiguration {
  readonly level: number;
  readonly quality: number;
  readonly enabledStats: readonly StatName[];
}

/** One fully materialized row in the development-only fixed-combat builder. */
export interface ScenarioCombatantConfiguration {
  readonly shortType: string;
  readonly level: number;
  readonly boss: boolean;
  readonly capturable: boolean;
  /** Omitted means source full HP after all creation-time children are attached. */
  readonly currentHp?: number;
  /** Exactly four source `usable1`...`usable4` slots. `null` renders that card locked. */
  readonly kitSlots: readonly (ScenarioJobAbilityConfiguration | null)[];
  /** Every non-usable Job ability. Native passives are copied here when a monster is selected. */
  readonly passiveAbilities: readonly ScenarioPassiveAbilityConfiguration[];
  readonly soulStone?: ScenarioSoulStoneConfiguration;
  /** Source Breeder creation-time cached-stat term, independently configurable per member. */
  readonly flatStatBonuses?: Readonly<Partial<Record<StatName, number>>>;
}

export interface ScenarioBattleResourcesConfiguration {
  readonly heroLevel: number;
  readonly silver: number;
  readonly gold: number;
  readonly captureCards: Readonly<Record<1 | 2 | 3, number>>;
  /** Source HeroData.energyPercent, normalized to [0, 1]. */
  readonly spiritReadiness: number;
  /** Four source license Gem slots; null means the slot is empty. */
  readonly equippedGems: readonly (ScenarioGemConfiguration | null)[];
  /** Unlocked Spirit species -> source grade index (0=F-, ..., 18=S). */
  readonly spiritTierLevels: Readonly<Record<string, number>>;
  /** Player/Hero skill allocation. The profile applies the source stat weights to all friends. */
  readonly skillPoints: Readonly<Partial<Record<StatName, number>>>;
}

export interface ScenarioFixedCombatConfiguration {
  readonly backgroundKey: string;
  readonly allowRetreat: boolean;
  readonly blockCapture: boolean;
  /** Presence selects BossBattle music and multiplies aggregate defeated-enemy XP. */
  readonly breederXpBonus?: number;
  readonly resources: ScenarioBattleResourcesConfiguration;
  readonly playerTeam: readonly ScenarioCombatantConfiguration[];
  readonly enemyTeam: readonly ScenarioCombatantConfiguration[];
}

export interface ScenarioConfiguration {
  readonly kind: ScenarioKind;
  /**
   * Both transports remain tab-local. `online` adds an asynchronous transport boundary and
   * development latency; it never authenticates with or writes to the Official service.
   */
  readonly transport: ScenarioTransport;
  readonly randomize: boolean;
  readonly seed: number;
  readonly eggKind: "silver" | "gold";
  readonly combatExample: ScenarioCombatExample;
  readonly fixedCombat?: ScenarioFixedCombatConfiguration;
}

export interface ScenarioRuntime {
  readonly configuration: ScenarioConfiguration;
  readonly encounter?: EncounterConfig;
  readonly worldAction?: "egg" | "arena";
}

export const DEFAULT_SCENARIO_CONFIGURATION: ScenarioConfiguration = Object.freeze({
  kind: "combat",
  transport: "offline",
  randomize: false,
  seed: 0x5343454e,
  eggKind: "silver",
  combatExample: "random",
});

export function parseScenarioSeed(value: string): number {
  const trimmed = value.trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(trimmed)) {
    throw new Error("Scenario seed must be a decimal integer or 0x-prefixed hexadecimal integer.");
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
    throw new Error("Scenario seed must be an unsigned 32-bit integer.");
  }
  return parsed;
}
