


import { outlineSampleOffsets } from "@dib/renderer/outlineBackgroundMath";
import type { MonsterDef } from "@dib/gamedata";
import type { DisplayMode } from "../displayMode.js";
import { screenPointsForMode, unscaledIdiomPt } from "../displayMode.js";


export const EVOLVE_SHAKE_REPS = 12;
export const EVOLVE_SHAKE_MS = 700 * EVOLVE_SHAKE_REPS;

export const EVOLVE_REVEAL_FLIP_REPS = 4;
export const EVOLVE_REVEAL_FLIP_MS = 500 * EVOLVE_REVEAL_FLIP_REPS;
/** Schedule on BattleNode: Delay(1.0) -> performEvolution -> Delay(4.0) -> endEvolve. */
export const EVOLVE_PERFORM_DELAY_MS = 1000;
export const EVOLVE_END_DELAY_MS = 4000;


export const EVOLVE_STAR_TWINKLE_MS = 4000;


export const EVOLVE_STAR_ROW_SHOW_DELAY_MS = 1000;
export const EVOLVE_STARS_PER_ROW = 5;

export interface EvolutionBannerLayoutPt {
  anchor: { x: number; y: number };
  position: { x: number; y: number };
  /** `CCTexture2D.contentSize` divides the bare 380x23 image by phone CSF=2; native iPad
   *  content is divided by this port's coordinate normalization instead. Both become 0.5x. */
  textureScale: number;
}


export function evolutionBannerLayoutPt(mode: DisplayMode): EvolutionBannerLayoutPt {
  const screen = screenPointsForMode(mode);
  return {
    anchor: { x: 0.5, y: 0 },
    position: { x: screen.w / 2, y: unscaledIdiomPt(10, mode) },
    textureScale: 0.5,
  };
}

export interface EvolutionLayoutPt {
  nameGapPt: number;
  nameFontPt: number;
  nameOutlineRadiusPt: number;
  starGapPt: number;
}


export function evolutionLayoutPt(mode: DisplayMode): EvolutionLayoutPt {
  return {
    nameGapPt: unscaledIdiomPt(10, mode),
    nameFontPt: unscaledIdiomPt(20, mode),
    nameOutlineRadiusPt: unscaledIdiomPt(3, mode),
    starGapPt: unscaledIdiomPt(5, mode),
  };
}


export function evolutionOutlineOffsets(radiusPt: number): Array<{ x: number; y: number }> {
  return outlineSampleOffsets(radiusPt).map((offset) => ({ x: offset.x, y: offset.y }));
}


export function isNewEvolutionStar(
  oldRarity: number,
  fullStarNumber: number,
  isHalf: boolean,
): boolean {
  const oldFull = Math.floor(oldRarity);
  if (!isHalf) return fullStarNumber > oldFull;
  const oldHadHalf = oldRarity - oldFull >= 0.5;
  return fullStarNumber > oldFull || !oldHadHalf;
}


export function canEvolveAt(def: MonsterDef, level: number): boolean {
  return def.evolveData !== undefined && level >= def.evolveData.levelReq;
}

/** The first-match scan both `beginEvolve:` (batting order) and `performEvolution` (bench) run —
 *  independently, over their own lists; the caller preserves that quirk by calling this twice. */
export function firstEvolveCandidate<T extends { shortType: string; level: number }>(
  list: readonly T[],
  defOf: (shortType: string) => MonsterDef,
): T | undefined {
  return list.find((entry) => canEvolveAt(defOf(entry.shortType), entry.level));
}


export function evolutionBattingPrefix<T>(bench: readonly T[], length: number): T[] {
  if (!Number.isInteger(length) || length < 0 || length > bench.length) {
    throw new Error(
      `evolutionBattingPrefix: length must be an integer in [0, ${bench.length}]; got ${length}`,
    );
  }
  return bench.slice(0, length);
}

/** Every renderable the synchronous native evolve loop can show for this bench at its current
 * levels. The web port preloads this set before `beginEvolve:` so texture I/O cannot insert a
 * blank frame or stretch the exact +1s/+5s action schedule. */
export function evolutionRenderableTypes<T extends { shortType: string; level: number }>(
  list: readonly T[],
  defOf: (shortType: string) => MonsterDef,
): string[] {
  const result = new Set<string>();
  for (const entry of list) {
    let shortType = entry.shortType;
    const chain = new Set<string>();
    for (;;) {
      if (chain.has(shortType)) {
        throw new Error(`evolutionRenderableTypes: evolve-chain cycle at ${shortType}`);
      }
      chain.add(shortType);
      result.add(shortType);
      const def = defOf(shortType);
      if (!canEvolveAt(def, entry.level)) break;
      shortType = def.evolveData!.newType;
    }
  }
  return [...result];
}

/**
 * Scale-x of a node running `Repeat(ScaleBy(duration, -1x, 1x), reps)` under one outer ease:
 * each rep linearly interpolates scaleX from its start value s to -s (a squash-through-zero
 * mirror flip), and the NEXT rep starts from that flipped value — multiplicative ScaleBy.
 * `easedT` is the eased 0..1 progress of the WHOLE repeat block.
 */
export function flipScaleX(reps: number, easedT: number): number {
  const total = Math.min(Math.max(easedT, 0), 1) * reps;
  const rep = Math.min(Math.floor(total), reps - 1);
  const frac = total - rep;
  const startSign = rep % 2 === 0 ? 1 : -1;
  return startSign * (1 - 2 * frac);
}
