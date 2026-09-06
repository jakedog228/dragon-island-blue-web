import type { DisplayMode } from "../displayMode.js";
import { screenPointsForMode } from "../displayMode.js";


export const SOURCE_POPUP_DIM_COLOR = 0x000000;
export const SOURCE_POPUP_DIM_OPACITY = 200 / 255;
export const SOURCE_POPUP_DIM_FADE_MS = 500;
export const SOURCE_POPUP_DIM_Z_INDEX = -9_999;

export function sourcePopupDimSpec(mode: DisplayMode) {
  const screen = screenPointsForMode(mode);
  return {
    x: 0,
    y: 0,
    w: screen.w,
    h: screen.h,
    color: SOURCE_POPUP_DIM_COLOR,
    targetAlpha: SOURCE_POPUP_DIM_OPACITY,
    durationMs: SOURCE_POPUP_DIM_FADE_MS,
    zIndex: SOURCE_POPUP_DIM_Z_INDEX,
  } as const;
}
