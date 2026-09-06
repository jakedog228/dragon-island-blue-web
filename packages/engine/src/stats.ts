


import type { MonsterDef, StatName } from "@dib/gamedata";
import { soulStoneBonusForStat } from "./soulStone.js";

const MIN_LEVEL = 1;
const MAX_LEVEL = 150;

const ALL_STATS: readonly StatName[] = [
  "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
];

/**
 * Effective value of `stat` for `monster` at `level`.
 *
 * Formula (see file header): fround(base*starsMul) + fround(base*(level-1)) as two separate
 * float32 products, summed in float32, then rounded and clamped to >= 0. `quality` plays no role
 * (stats.md: "quality plays no role in effective stats").
 */
export function baseStat(monster: MonsterDef, stat: StatName, level: number): number {
  return Math.max(0, Math.round(baseStatRaw(monster, stat, level)));
}

/** Float32 accumulator immediately before Living.valueForCachedStat's final round/clamp. */
export function baseStatRaw(monster: MonsterDef, stat: StatName, level: number): number {
  const clampedLevel = clampLevel(level);


  const s = Math.fround(monster.stars);
  const three = Math.fround(3.0);
  const five = Math.fround(5.0);

  const starsMul = Math.fround(Math.fround(s / three) + Math.fround(five / s));

  const base = Math.fround(monster.rootStats[stat]);


  const term1 = Math.fround(base * starsMul);


  const term2 = Math.fround(base * Math.fround(clampedLevel - 1));


  const raw = Math.fround(term1 + term2);


  return raw;
}

/** Convenience alias for the MaxHP stat (Living stat index 0). */
export function maxHp(monster: MonsterDef, level: number): number {
  return baseStat(monster, "MaxHP", level);
}

/** The non-Job children a bench `Monster` carries into `Living.valueForCachedStat:`, in the order
 * `Living.addChild:` appends them. */
export interface MonsterStatChildren {
  /** Equipped item slot "Monster" content, with its Items.plist `stats` gate already resolved. */
  readonly soulStone?: {
    readonly level: number;
    readonly enabledStats: readonly StatName[];
  };


  readonly playerBuffs?: Readonly<Partial<Record<StatName, number>>>;
}


export function monsterStatRaw(
  monster: MonsterDef,
  stat: StatName,
  level: number,
  children?: MonsterStatChildren,
): number {
  let raw = baseStatRaw(monster, stat, level);
  if (children?.soulStone !== undefined) {
    raw = Math.fround(
      raw + soulStoneBonusForStat(children.soulStone.level, children.soulStone.enabledStats, stat),
    );
  }
  if (children?.playerBuffs !== undefined) {
    raw = Math.fround(raw + (children.playerBuffs[stat] ?? 0));
  }
  return raw;
}

/** Rounded/clamped `monsterStatRaw` — `valueForCachedStat:`'s `max(0, roundf(total))` tail. */
export function monsterStat(
  monster: MonsterDef,
  stat: StatName,
  level: number,
  children?: MonsterStatChildren,
): number {
  return Math.max(0, Math.round(monsterStatRaw(monster, stat, level, children)));
}

/** All six Living stats at once, for cards and ability-description contexts. */
export function monsterStats(
  monster: MonsterDef,
  level: number,
  children?: MonsterStatChildren,
): Record<StatName, number> {
  const stats = {} as Record<StatName, number>;
  for (const stat of ALL_STATS) stats[stat] = monsterStat(monster, stat, level, children);
  return stats;
}

// Job._initWithName:dictionary:arguments: clamps the spawn-requested level to [1, 0x96] (150)
// before driving `increaseLevel` up to it (stats.md, "-[Job level] ... how the level is set").
function clampLevel(level: number): number {
  if (level < MIN_LEVEL) return MIN_LEVEL;
  if (level > MAX_LEVEL) return MAX_LEVEL;
  return level;
}
