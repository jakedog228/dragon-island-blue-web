import {
  idiomPairPt,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";

/** Source `PagedNodeDisplay`/`LicenseDisplay` geometry in normalized port points. */
export function inventoryPageLayout(mode: DisplayMode) {
  return Object.freeze({
    mainGap: idiomPairPt(10, 20, mode),
    itemGap: unscaledIdiomPt(5, mode),
    controlGap: unscaledIdiomPt(5, mode),
    roundingScale: sourcePointsPerPortPoint(mode),
    controlSpacer: idiomPairPt(10, 20, mode),
    titleFont: idiomPairPt(18, 36, mode),
    actionFont: idiomPairPt(14, 28, mode),
    topInset: unscaledIdiomPt(10, mode),
    closeOffset: unscaledIdiomPt(10, mode),
    arrowSize: Object.freeze({ w: 22, h: 32 }),
    actionSize: Object.freeze({ w: 99.5, h: 26 }),
    closeSize: Object.freeze({ w: 30, h: 29.5 }),
  });
}

export function inventoryGemDisplayLayout(mode: DisplayMode) {
  return Object.freeze({
    rowIconSide: idiomPairPt(32, 64, mode),
    rowStatIconSide: idiomPairPt(24, 48, mode),
    rowValueFont: idiomPairPt(10, 16, mode),
    infoStatIconSide: idiomPairPt(20, 40, mode),
    infoValueFont: idiomPairPt(14, 28, mode),
    equipmentScale: 0.46,
    instructionHoldMs: 3_000,
    instructionFadeMs: 1_000,
  });
}

/**
 * Native `PagedNodeDisplay` authors the separate close sprite outside the main Box. Its content
 * root is center-based; this port's root is already rebased to top-left, so the native bare
 * 10-point vertical offset maps to the top inset plus the rebased signed main-Box origin rather
 * than being flipped around mainHeight/2.
 */
export function inventoryPagedClosePosition(
  mode: DisplayMode,
  mainWidth: number,
  mainPositionY: number,
) {
  if (!Number.isFinite(mainPositionY)) {
    throw new Error("PagedNodeDisplay main position must be finite");
  }
  const inset = unscaledIdiomPt(10, mode);
  return Object.freeze({ x: mainWidth + inset, y: mainPositionY + inset });
}
