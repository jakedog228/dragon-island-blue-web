import {
  idiomPairPt,
  screenPointsForMode,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";

export function characterSkillsLayout(mode: DisplayMode) {
  return Object.freeze({
    freeInset: unscaledIdiomPt(10, mode),
    rowX: idiomPairPt(30, 60, mode),
    rowCocosY: Object.freeze([
      idiomPairPt(70, 180, mode),
      idiomPairPt(190, 460, mode),
    ]),
    rowGap: idiomPairPt(50, 100, mode),
    adjustGap: idiomPairPt(12, 24, mode),
    cellGap: idiomPairPt(2, 4, mode),
  });
}

export function storeCarouselLayout(mode: DisplayMode) {
  const screen = screenPointsForMode(mode);
  return Object.freeze({
    center: Object.freeze({ x: screen.w * 0.5, y: screen.h * 0.55 }),
    topBuffer: idiomPairPt(40, 80, mode),
    bottomBuffer: idiomPairPt(80, 160, mode),
    descriptionInset: unscaledIdiomPt(10, mode),
  });
}




export const SOURCE_STORE_CFLOW_SIDE_COUNT = 4;
























export function storeCarouselCardLayout(
  itemIndex: number,
  visualIndex: number,
  largestWidth: number,
  centeredWidth: number,
  itemCount: number,
) {
  if (
    !Number.isInteger(itemIndex) ||
    !Number.isFinite(visualIndex) ||
    !(largestWidth > 0) ||
    !(centeredWidth > 0) ||
    !Number.isInteger(itemCount) ||
    itemCount < 1
  ) {
    throw new Error("invalid Store CFlow card layout input");
  }
  const rounded = Math.min(itemCount - 1, Math.max(0, Math.floor(visualIndex + 0.5)));
  const fraction = Math.abs(visualIndex - rounded);
  const adjacent = Math.min(
    itemCount - 1,
    Math.max(0, rounded + Math.sign(visualIndex - rounded)),
  );
  const distance = itemIndex - rounded;
  const absoluteDistance = Math.abs(distance);
  const sideCount = SOURCE_STORE_CFLOW_SIDE_COUNT;
  const visible = absoluteDistance <= sideCount;
  const integerScale = (d: number): number =>
    0.4 + 0.6 * (1 - Math.abs(d) / (sideCount + 1));
  const integerX = (d: number): number => d === 0
    ? 0
    : Math.sign(d) * (centeredWidth / 2 + Math.abs(d) * largestWidth * 3 / sideCount);
  const adjacentDistance = itemIndex - adjacent;
  const scale =
    (1 - fraction) * integerScale(distance) + fraction * integerScale(adjacentDistance);
  const x = (1 - fraction) * integerX(distance) + fraction * integerX(adjacentDistance);
  const zIndex = distance < 0
    ? itemCount + distance + 1
    : distance === 0
      ? itemCount * 2 + 3
      : itemCount * 2 + itemIndex + 3;
  return Object.freeze({ x, scale, visible, zIndex, roundedIndex: rounded });
}




export const SOURCE_ITEM_QUALITY_COLORS: Readonly<Record<number, number>> = Object.freeze({
  0: 0x000000,
  1: 0x3ff1ff,
  2: 0xe7ec19,
});

/** `ActionFactory pulseActionWithDuration:maxOpacity:minOpacity:` as `GlowingGemNode` schedules it:
 *  a 2.0s cycle between full and 150/255 opacity. */
export const SOURCE_GEM_GLOW_PULSE = Object.freeze({ durationMs: 2_000, maxAlpha: 1, minAlpha: 150 / 255 });

/** Linear `CCFadeTo` down-then-up over one `durationMs` cycle, repeating forever. */
export function storeGemGlowAlpha(elapsedMs: number): number {
  const { durationMs, maxAlpha, minAlpha } = SOURCE_GEM_GLOW_PULSE;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(`invalid Store gem glow elapsed ${elapsedMs}`);
  }
  const phase = (elapsedMs % durationMs) / (durationMs / 2);
  const t = phase <= 1 ? phase : 2 - phase;
  return maxAlpha + (minAlpha - maxAlpha) * t;
}













export const SOURCE_STORE_REFLECTION_ARGS = Object.freeze({

  categoryArt: Object.freeze({ percentOfHeight: 1, fadeStart: 255, fadeTo: 25, fitsToParent: true }),

  recipe: Object.freeze({ percentOfHeight: 1, fadeStart: 255, fadeTo: 25, fitsToParent: true }),

  totem: Object.freeze({ percentOfHeight: 1, fadeStart: 255, fadeTo: 10, fitsToParent: true }),

  cflow: Object.freeze({ percentOfHeight: 0.75, fadeStart: 128, fadeTo: 0, fitsToParent: false }),
});

export interface SourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}







export function storeReflectionTextureRect(frame: SourceRect, percentOfHeight: number): SourceRect {
  if (!Number.isFinite(percentOfHeight) || percentOfHeight <= 0 || percentOfHeight > 1) {
    throw new Error(`invalid Store reflection percentOfHeight ${percentOfHeight}`);
  }
  if (!(frame.width > 0) || !(frame.height > 0)) {
    throw new Error("Store reflection needs a positive texture frame");
  }
  const height = Math.round(frame.height * percentOfHeight);
  if (!(height > 0)) throw new Error("Store reflection percentOfHeight produced an empty rect");
  return Object.freeze({
    x: frame.x,
    y: frame.y + frame.height - height,
    width: frame.width,
    height,
  });
}







export function storeReflectionFit(
  naturalWidthPt: number,
  /** `parentOverride.contentSize.width`, or `undefined` when the sprite is its own parent. */
  fitWidthPt: number | undefined,
): number {
  if (!(naturalWidthPt > 0)) throw new Error("Store reflection fit needs a positive texture width");
  if (fitWidthPt === undefined) return 1;
  if (!(fitWidthPt > 0)) throw new Error("Store reflection fit needs a positive card width");
  return fitWidthPt / naturalWidthPt;
}
