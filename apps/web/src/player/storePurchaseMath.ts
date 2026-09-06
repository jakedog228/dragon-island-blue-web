import type { DisplayMode } from "../displayMode.js";
import {
  idiomPairPt,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
} from "../displayMode.js";

export interface StorePurchaseLayout {
  readonly outerGap: number;
  readonly priceGap: number;
  readonly nameFontSize: number;
  readonly descriptionFontSize: number;
  readonly descriptionWrapWidth: number;
  readonly quantityFontSize: number;
  readonly quantityRootGap: number;
  readonly quantityArrowGap: number;
  readonly priceFontSize: number;
  readonly outlineWidth: number;
  readonly roundingScale: number;
}


export function storePurchaseLayout(mode: DisplayMode): StorePurchaseLayout {
  return Object.freeze({
    outerGap: unscaledIdiomPt(5, mode),
    priceGap: unscaledIdiomPt(5, mode),
    nameFontSize: idiomPairPt(18, 36, mode),
    descriptionFontSize: idiomPairPt(15, 30, mode),
    descriptionWrapWidth: idiomPairPt(300, 600, mode),
    // Store passes the raw integer 18 into Incramenter on both native idioms.
    quantityFontSize: unscaledIdiomPt(18, mode),
    quantityRootGap: idiomPairPt(20, 40, mode),
    quantityArrowGap: unscaledIdiomPt(30, mode),
    priceFontSize: idiomPairPt(16, 32, mode),
    outlineWidth: unscaledIdiomPt(2, mode),
    roundingScale: sourcePointsPerPortPoint(mode),
  });
}

export const SOURCE_STORE_PURCHASE_MIN_QUANTITY = 1;
export const SOURCE_STORE_PURCHASE_MAX_QUANTITY = 99;
export const SOURCE_STORE_PURCHASE_PRICE_PLACEHOLDER = "99999";
export const SOURCE_STORE_INCREMENTER_DISABLED_TINT = 0xa6a6a6;

/** `-[Incramenter ccTouchEnded:]`: release-arrow selection with clamping at both gray endpoints. */
export function nextStorePurchaseQuantity(
  quantity: number,
  releasedArrow: "up" | "down",
): number {
  if (!Number.isSafeInteger(quantity) ||
      quantity < SOURCE_STORE_PURCHASE_MIN_QUANTITY ||
      quantity > SOURCE_STORE_PURCHASE_MAX_QUANTITY) {
    throw new Error(`Store purchase quantity is outside 1..99: ${quantity}`);
  }
  return releasedArrow === "up"
    ? Math.min(quantity + 1, SOURCE_STORE_PURCHASE_MAX_QUANTITY)
    : Math.max(quantity - 1, SOURCE_STORE_PURCHASE_MIN_QUANTITY);
}
