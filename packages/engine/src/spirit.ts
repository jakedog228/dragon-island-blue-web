import type { MonsterDef } from "@dib/gamedata";


export const SPIRIT_TIER_COUNT = 19;
export type SpiritTierLevel =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18;

const LETTERS = ["E", "D", "C", "B", "A"] as const;

export function spiritTierLevelForXp(savedXp: number): SpiritTierLevel {
  const xp = validatedXp(savedXp);
  if (xp < 100) return 0;
  if (xp < 400) return 1;
  if (xp < 600) return 2;
  if (xp >= 3600) return 18;
  const band = Math.floor((xp - 600) / 600); // E..A
  const phase = Math.floor(((xp - 600) % 600) / 200); // -, bare, +
  return (3 + band * 3 + phase) as SpiritTierLevel;
}

export function spiritGradeForXp(savedXp: number): string {
  const tier = spiritTierLevelForXp(savedXp);
  if (tier === 0) return "F-";
  if (tier === 1) return "F";
  if (tier === 2) return "F+";
  if (tier === 18) return "S";
  const offset = tier - 3;
  const letter = LETTERS[Math.floor(offset / 3)]!;
  return `${letter}${["-", "", "+"][offset % 3]!}`;
}


export function spiritSavedXpForTierLevel(tier: number): number {
  assertSpiritTierLevel(tier);
  if (tier === 0) return 0;
  if (tier === 1) return 100;
  if (tier === 2) return 400;
  if (tier === 18) return 3600;
  return 600 + (tier - 3) * 200;
}

/**
 * Source-valid persistence value for an explicitly unlocked grade.
 * `addExperience:toSpiritWithShortType:` rejects <=0 before creating the record, so tier zero's
 * mathematical threshold 0 is represented by the smallest positive saved XP.
 */
export function spiritSavedXpForUnlockedTierLevel(tier: number): number {
  return Math.max(1, spiritSavedXpForTierLevel(tier));
}

/**
 * A spirit is built at Monster/Job level 1, then `increaseLevel` runs once per complete 100 XP
 * in `(monster.summonXpBonus + saved spirit XP)`.  Its effective combat level is therefore
 * `1 + floor(total/100)`; the normal stat pipeline consumes that level unchanged.
 */
export function spiritCombatLevel(monster: MonsterDef, savedXp: number): number {
  if (monster.category !== "Summon" || monster.summonXpBonus === undefined) {
    throw new Error(`spiritCombatLevel: ${monster.path} is not a summon spirit`);
  }
  return 1 + Math.floor((monster.summonXpBonus + validatedXp(savedXp)) / 100);
}


export const HERO_SPIRIT_MAX_ENERGY = 100;
export const HERO_SPIRIT_FULL_EPSILON = 0.00001;

/** `HeroData.isEnergyFull`: absolute comparison rather than a strict float equality. */
export function isSpiritEnergyFull(energy: number): boolean {
  if (!Number.isFinite(energy)) throw new Error(`isSpiritEnergyFull: invalid energy ${energy}`);
  return Math.abs(energy - HERO_SPIRIT_MAX_ENERGY) < HERO_SPIRIT_FULL_EPSILON;
}


export function spiritEnergyGainForLevelRatio(levelRatio: number): number {
  if (!Number.isFinite(levelRatio) || levelRatio < 0) {
    throw new Error(`spiritEnergyGainForLevelRatio: invalid ratio ${levelRatio}`);
  }
  const raw = Math.trunc(Math.fround(Math.fround(10) * Math.fround(levelRatio)));
  return Math.max(1, Math.min(10, raw));
}

export function addSpiritEnergy(current: number, levelRatio: number): number {
  if (!Number.isFinite(current) || current < 0) {
    throw new Error(`addSpiritEnergy: invalid current energy ${current}`);
  }
  return Math.min(HERO_SPIRIT_MAX_ENERGY, current + spiritEnergyGainForLevelRatio(levelRatio));
}

export function assertSpiritTierLevel(value: number): asserts value is SpiritTierLevel {
  if (!Number.isInteger(value) || value < 0 || value >= SPIRIT_TIER_COUNT) {
    throw new Error(`spirit tier level must be an integer from 0 to ${SPIRIT_TIER_COUNT - 1}; got ${value}`);
  }
}

function validatedXp(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`spirit XP must be a non-negative integer; got ${value}`);
  }
  return value;
}
