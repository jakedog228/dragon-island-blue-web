import {
  idiomPairPt,
  screenPointsForMode,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";

export const TOWN_DAY_BANNER_SLIDE_MS = 500;
export const TOWN_DAY_BANNER_HOLD_MS = 2_000;
export const TOWN_DAY_BANNER_LIFETIME_MS =
  TOWN_DAY_BANNER_SLIDE_MS * 2 + TOWN_DAY_BANNER_HOLD_MS;


export const TOWN_DAY_BANNER_COLOR = 0x2a4494;
/** The top-edge vertex color of that same gradient quad. */
export const TOWN_DAY_BANNER_TOP_COLOR = 0x003264;

export interface TownDayBannerLayout {
  readonly width: number;
  readonly height: number;
  readonly imageSlot: number;
  readonly imageCenter: { readonly x: number; readonly y: number };
  readonly textX: number;
  readonly titleY: number;
  readonly messageY: number;
  readonly titleFontSize: number;
  readonly messageFontSize: number;
}


export function townDayBannerLayout(mode: DisplayMode): TownDayBannerLayout {
  const screen = screenPointsForMode(mode);
  const height = idiomPairPt(50, 100, mode);
  const imageSlot = idiomPairPt(50, 100, mode);
  // Raw layout literals have no idiom branch. They remain 15/3/5 native source points and
  // therefore halve in the port's normalized iPad coordinate frame.
  const textInset = unscaledIdiomPt(15, mode);
  const edge = unscaledIdiomPt(3, mode);
  return {
    width: screen.w,
    height,
    imageSlot,
    imageCenter: {
      x: imageSlot / 2 + unscaledIdiomPt(5, mode),
      y: height / 2,
    },
    textX: imageSlot + textInset,
    titleY: edge,
    messageY: height - edge,
    titleFontSize: idiomPairPt(14, 28, mode),
    messageFontSize: idiomPairPt(16, 32, mode),
  };
}

/** Native default alignment 1: enter from above, hold against the top edge, then exit upward. */
export function townDayBannerY(elapsedMs: number, mode: DisplayMode): number {
  const { height } = townDayBannerLayout(mode);
  const hiddenY = -height;
  const shownY = 0;
  if (elapsedMs <= 0) return hiddenY;
  if (elapsedMs < TOWN_DAY_BANNER_SLIDE_MS) {
    return hiddenY + height * (elapsedMs / TOWN_DAY_BANNER_SLIDE_MS);
  }
  const slideOutAt = TOWN_DAY_BANNER_SLIDE_MS + TOWN_DAY_BANNER_HOLD_MS;
  if (elapsedMs < slideOutAt) return shownY;
  if (elapsedMs < TOWN_DAY_BANNER_LIFETIME_MS) {
    return shownY -
      height * ((elapsedMs - slideOutAt) / TOWN_DAY_BANNER_SLIDE_MS);
  }
  return hiddenY;
}

/** `CCNotifications` registers its swallowing touch delegate only after slide-in completes and
 * removes it synchronously when either an inside touch or the hold timeout starts slide-out. */
export function townDayBannerTouchActive(
  elapsedMs: number,
  dismissing = false,
): boolean {
  return !dismissing &&
    elapsedMs >= TOWN_DAY_BANNER_SLIDE_MS &&
    elapsedMs < TOWN_DAY_BANNER_SLIDE_MS + TOWN_DAY_BANNER_HOLD_MS;
}
