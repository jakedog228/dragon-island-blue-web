import type { DisplayMode } from "../displayMode.js";
export { heroXpForLevel, heroXpPercent } from "@dib/engine";
import {
  idiomPairPt,
  screenPointsForMode,
  unscaledIdiomPt,
} from "../displayMode.js";









export const WORLD_NAME_PLATE_SCALE = 1.3;
export const WORLD_NAME_PLATE_FADE_IN_MS = 1000;
export const WORLD_NAME_PLATE_HOLD_MS = 2000;
export const WORLD_NAME_PLATE_FADE_OUT_MS = 1000;
export const WORLD_HERO_XP_AUTO_CLOSE_MS = 1500;
export const WORLD_HERO_XP_TOGGLE_MS = 500;

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface WorldNamePlateLayout {
  readonly position: Point2;
  readonly size: { readonly w: number; readonly h: number };
  readonly fontSize: number;
}


export type NamePlatePlacement = "lower-right" | "upper-inset";

/** The two WorldNode call sites do not use the same POI-region test. */
export type WorldNamePlateTrigger = "delayed-entry" | "slide-end";





export function worldMenuPosition(mode: DisplayMode, hasMapIndent: boolean): Point2 {
  const normalIpadWorld = mode === "ipad" && !hasMapIndent;
  return {
    x: normalIpadWorld ? idiomPairPt(0, 36, mode) : 0,
    y: normalIpadWorld ? idiomPairPt(0, 68, mode) : 0,
  };
}

export function worldHeroXpBarPosition(mode: DisplayMode): Point2 {
  return {
    x: idiomPairPt(41, 82, mode),
    y: idiomPairPt(18, 36, mode),
  };
}

export function worldHeroXpFontSize(mode: DisplayMode): number {
  return idiomPairPt(10, 18, mode);
}

export function worldHeroXpLabelGap(mode: DisplayMode): number {
  return unscaledIdiomPt(2, mode);
}

export function worldHeroXpCollapsedX(mode: DisplayMode, frameWidthPt: number): number {
  return idiomPairPt(36, 72, mode) - frameWidthPt;
}






export function namePlateLayout(
  mode: DisplayMode,
  unscaledPlateSizePt: { readonly w: number; readonly h: number },
  placement: NamePlatePlacement,
): WorldNamePlateLayout {
  const screen = screenPointsForMode(mode);
  const margin = unscaledIdiomPt(10, mode);
  const size = {
    w: unscaledPlateSizePt.w * WORLD_NAME_PLATE_SCALE,
    h: unscaledPlateSizePt.h * WORLD_NAME_PLATE_SCALE,
  };
  return {
    position: placement === "upper-inset"
      ? { x: screen.w - margin - size.w * 2, y: margin }
      : { x: screen.w - margin - size.w, y: screen.h - margin - size.h },
    size,
    fontSize: idiomPairPt(14, 20, mode),
  };
}







export function worldNamePlatePlacement(
  mode: DisplayMode,
  currentPoiPosition: Point2,
  trigger: WorldNamePlateTrigger,
): NamePlatePlacement {
  const screen = screenPointsForMode(mode);
  const x = Math.fround(currentPoiPosition.x);
  const y = Math.fround(currentPoiPosition.y);
  const halfHeight = Math.fround(screen.h * Math.fround(0.5));
  const shifted = trigger === "slide-end"
    ? y < halfHeight
    : x < Math.fround(screen.w * Math.fround(0.5)) &&
      y < Math.fround(screen.h / Math.fround(3));
  return shifted ? "upper-inset" : "lower-right";
}

export function worldNamePlateAlpha(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs < WORLD_NAME_PLATE_FADE_IN_MS) return elapsedMs / WORLD_NAME_PLATE_FADE_IN_MS;
  const fadeOutStart = WORLD_NAME_PLATE_FADE_IN_MS + WORLD_NAME_PLATE_HOLD_MS;
  if (elapsedMs < fadeOutStart) return 1;
  const end = fadeOutStart + WORLD_NAME_PLATE_FADE_OUT_MS;
  if (elapsedMs < end) return 1 - (elapsedMs - fadeOutStart) / WORLD_NAME_PLATE_FADE_OUT_MS;
  return 0;
}
