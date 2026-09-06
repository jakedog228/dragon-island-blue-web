


import { soulStoneBonusForStat } from "@dib/engine";
import type { StatName } from "@dib/gamedata";


export const LIVING_STAT_NAMES = ["MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist"] as const;


export interface SoulStoneInfoStatRow {
  statType: 0 | 1 | 2 | 3 | 4 | 5;
  value: number;
}

/** An equipped soul stone as the card and its tap-through popup render it. `name` is the
 *  localized `stone.localizedName` (== `shortLocalizedName` for a SoulStone — both bottom out at
 *  `Renderable<Element>SoulStoneNameKey`, e.g. "Fire Soul Stone"; soulstone-info-display.md §1)
 *  — battleNode resolves it, like every other name in infoDisplays' snapshots. */
export interface LivingInfoSoulStone {
  name: string;
  /** The stone's OWN isolated stat table (`item.statBonuses`, §3.1) — see soulStoneStatRows. */
  stats: readonly SoulStoneInfoStatRow[];
}


export function soulStoneStatRows(
  stoneLevel: number,
  enabledStats: readonly StatName[],
): SoulStoneInfoStatRow[] {
  return LIVING_STAT_NAMES.map((statName, statType) => ({
    statType: statType as SoulStoneInfoStatRow["statType"],
    value: Math.trunc(soulStoneBonusForStat(stoneLevel, enabledStats, statName)),
  })).filter((row) => row.value >= 1);
}


export function soulStoneSmallItemStatRows(
  stoneLevel: number,
  enabledStats: readonly StatName[],
): SoulStoneInfoStatRow[] {
  return LIVING_STAT_NAMES.map((statName, statType) => ({
    statType: statType as SoulStoneInfoStatRow["statType"],
    value: Math.round(soulStoneBonusForStat(stoneLevel, enabledStats, statName)),
  })).filter((row) => row.value >= 1);
}
