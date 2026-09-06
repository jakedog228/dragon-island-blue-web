import {
  screenPointsForMode,
  type DisplayMode,
} from "../displayMode.js";

export const SOURCE_FULLSCREEN_TEXTURE_RECT_PX =
  Object.freeze({ x: 0, y: 0, w: 1024, h: 768 });
export const SOURCE_FULLSCREEN_SIZE_PT = Object.freeze({ w: 512, h: 384 });

export function sourceFullscreenPosition(mode: DisplayMode): { readonly x: number; readonly y: number } {
  const screen = screenPointsForMode(mode);
  return Object.freeze({
    x: (screen.w - SOURCE_FULLSCREEN_SIZE_PT.w) / 2,
    y: (screen.h - SOURCE_FULLSCREEN_SIZE_PT.h) / 2,
  });
}
