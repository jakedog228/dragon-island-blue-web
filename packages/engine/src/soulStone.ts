


import type { StatName } from "@dib/gamedata";
import { statWeight } from "./buff.js";

const f = Math.fround;


export function soulStoneMintLevel(stars: number, monsterLevel: number): number {
  const starsInt = Math.floor(stars);
  const halfStarBit = stars - starsInt >= 0.5 ? 1 : 0;
  return starsInt + halfStarBit + Math.trunc(monsterLevel / 2);
}


export function soulStoneBonusForStat(
  stoneLevel: number,
  enabledStats: readonly StatName[],
  stat: StatName,
): number {
  if (!enabledStats.includes(stat)) return 0;

  return f(f(stoneLevel) * statWeight(stat));
}
