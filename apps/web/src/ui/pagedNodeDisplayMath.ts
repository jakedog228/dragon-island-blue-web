import {
  idiomPairPt,
  roundSourcePoint,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";

export interface PagedNodePageNumberLayout {
  readonly anchor: Readonly<{ x: number; y: number }>;
  readonly mainPositionY: number;
  readonly outlineWidthPt: number;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly contentBounds: Readonly<{ x: number; y: number; w: number; h: number }>;
}


export function pagedNodePageNumberLayout(
  mode: DisplayMode,
  mainSize: Readonly<{ w: number; h: number }>,
): PagedNodePageNumberLayout {
  if (!Number.isFinite(mainSize.w) || !Number.isFinite(mainSize.h)) {
    throw new Error("PagedNodeDisplay main size must be finite");
  }
  if (mainSize.w < 0 || mainSize.h < 0) {
    throw new Error("PagedNodeDisplay main size must be non-negative");
  }
  const gap = idiomPairPt(10, 20, mode);
  const outlineWidthPt = unscaledIdiomPt(2, mode);
  const mainPositionY = mainSize.h / 2 - roundSourcePoint(mainSize.h / 2, mode);
  return Object.freeze({
    anchor: Object.freeze({ x: 0, y: 0.5 }),
    mainPositionY,
    outlineWidthPt,
    position: Object.freeze({
      x: -gap - outlineWidthPt,
      y: mainPositionY,
    }),
    contentBounds: Object.freeze({ x: 0, y: 0, w: mainSize.w, h: mainSize.h }),
  });
}
