


import type { MonsterDef, StatName } from "@dib/gamedata";
import { baseStat } from "@dib/engine";
import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";


const STAT_INDEX_ORDER: readonly StatName[] = ["MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist"];

export interface LevelUpEntry {
  monster: MonsterDef;
  /** `-[Renderable localizedName]` result (caller resolves via `localizedRenderableName`). */
  displayName: string;
  startLevel: number;
  /** `jobLevelAfterAward` result; == startLevel means no pages for this entry. */
  endLevel: number;
  /** `rebuildAbilities` name-set hook for the Learned-page diff (see module header). Omitted =
   *  level-ungated abilities (the shipped-data reality): no Learned pages. */
  abilityNamesAtLevel?: (level: number) => readonly string[];
}

function format(template: string, replacements: ReadonlyArray<[token: string, value: string]>): string {
  let out = template;
  for (const [token, value] of replacements) {
    if (!out.includes(token)) throw new Error(`level-up template is missing its ${token} placeholder`);
    out = out.replace(token, value);
  }
  return out;
}

/** One `outputTextFromIncreasingLevel` call's stat page (step 2 above), or null if no stat's
 *  cached (rounded) value changed across the level step. Deltas compare `Living statBonuses`'
 *  cached per-stat values, which are `valueForCachedStat`'s rounded integers — `baseStat` here. */
export function statBonusPage(
  strings: LocalizedStrings,
  monster: MonsterDef,
  fromLevel: number,
  toLevel: number,
): string | null {
  const parts: string[] = [];
  for (const stat of STAT_INDEX_ORDER) {
    const before = baseStat(monster, stat, fromLevel);
    const after = baseStat(monster, stat, toLevel);
    if (after === before) continue; // `!isEqualToNumber:` gate — integers, so delta != 0
    const name = localizedString(strings, `Stat${stat}InfoTitleKey`);
    parts.push(`${parts.length === 0 ? "" : ", "}+${after - before} ${name}`);
  }
  return parts.length === 0 ? null : parts.join("");
}

/** The full flattened page list `performAwardLogic` queues: `MonsterLevelUpKey` header iff any
 *  entry leveled, then per entry, per level: LevelUpTextKey page, stat page, Learned pages. */
export function levelUpPages(strings: LocalizedStrings, entries: readonly LevelUpEntry[]): string[] {
  const pages: string[] = [];
  for (const entry of entries) {
    if (entry.endLevel < entry.startLevel) {
      throw new Error(`level-up entry for ${entry.monster.shortType} lost levels`);
    }
    for (let level = entry.startLevel; level < entry.endLevel; level++) {
      const newLevel = level + 1;
      pages.push(
        format(localizedString(strings, "LevelUpTextKey"), [
          ["%@", entry.displayName],
          ["%d", String(newLevel)],
        ]),
      );
      const statPage = statBonusPage(strings, entry.monster, level, newLevel);
      if (statPage !== null) pages.push(statPage);
      if (entry.abilityNamesAtLevel) {
        const before = new Set(entry.abilityNamesAtLevel(level));
        for (const name of entry.abilityNamesAtLevel(newLevel)) {
          if (before.has(name)) continue;
          pages.push(format(localizedString(strings, "LearnAbilityTextKey"), [["%@", name]]));
        }
      }
    }
  }
  if (pages.length > 0) pages.unshift(localizedString(strings, "MonsterLevelUpKey"));
  return pages;
}
