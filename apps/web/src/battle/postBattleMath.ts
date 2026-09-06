import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, unscaledIdiomPt } from "../displayMode.js";



export {
  jobCanLevelUp,
  jobLevelAfterAward,
  jobXpCostOfNextLevel,
  jobXpForLevel,
  monsterXpAward,
  xpAwardPerParticipant,
} from "@dib/engine";
export type { DefeatedMonsterXp } from "@dib/engine";

export interface XpAwardLayoutMetrics {
  columns: 2 | 3;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  barMaxWidth: number;
  itemGap: number;
  boxGap: number;
  headingFontSize: number;
  gridShiftX: number;
}



























export function xpAwardLayoutMetrics(
  count: number,
  screenWidth: number,
  screenHeight: number,
  mode: DisplayMode,
): XpAwardLayoutMetrics {
  if (count < 1) throw new Error("XP award layout requires at least one entry");
  const columns: 2 | 3 = count > 12 ? 3 : 2;
  const rows = Math.ceil(count / columns);
  const itemGap = unscaledIdiomPt(2, mode); // bare `setGap:2.0`
  const boxGap = unscaledIdiomPt(5, mode); // `Box.init` bare default
  const heightBand = screenHeight * 0.6;
  const widthBand = screenWidth * 0.9;
  const barMaxWidth = idiomPairPt(100, 200, mode) / columns;

  const widthReservation = idiomPairPt(5, 10, mode);
  return {
    columns,
    rows,
    cellWidth: (widthBand - barMaxWidth * columns - widthReservation * (columns - 1)) / columns,
    cellHeight: Math.max(1, (heightBand - itemGap * (rows - 1)) / rows),
    barMaxWidth,
    itemGap,
    boxGap,
    headingFontSize: idiomPairPt(16, 24, mode),
    gridShiftX: idiomPairPt(20, 40, mode),
  };
}

export function formatAwardXp(localizedFormat: string, amount: number): string {
  if (!localizedFormat.includes("%d")) throw new Error("AwardXPKey is missing its %d placeholder");
  return localizedFormat.replace("%d", String(Math.trunc(amount)));
}
