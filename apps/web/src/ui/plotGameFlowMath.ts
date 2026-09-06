import { idiomPairPt, screenPointsForMode, type DisplayMode } from "../displayMode.js";

export const PLOT_BACKGROUND_TEXTURE_RECT_PX = { x: 0, y: 0, w: 1024, h: 768 } as const;
export const PLOT_BACKGROUND_SIZE_PT = { w: 512, h: 384 } as const;
export const PLOT_SLIDE_MS = 750;

export const PLOT_OK_DELAY_MS = 250;

export const PLOT_OK_MOVE_MS = 750;
export const PLOT_EARLY_FINISH_MS = 2_000;
export const BATTLE_TUTORIAL_DELAY_MS = 2_000;

export interface PlotPageLayout {
  readonly screen: { readonly w: number; readonly h: number };
  readonly background: { readonly x: number; readonly y: number };
  readonly okFontSize: number;
  readonly okX: number;
}


export function plotPageLayout(mode: DisplayMode): PlotPageLayout {
  const screen = screenPointsForMode(mode);
  return {
    screen,
    background: {
      x: (screen.w - PLOT_BACKGROUND_SIZE_PT.w) / 2,
      y: (screen.h - PLOT_BACKGROUND_SIZE_PT.h) / 2,
    },
    okFontSize: idiomPairPt(20, 30, mode),
    okX: screen.w / 2,
  };
}

/** First-page OK starts 1.5 button-heights below the Cocos bottom edge, then enters to 1.5 above. */
export function plotOkButtonY(
  mode: DisplayMode,
  buttonHeight: number,
): { readonly initial: number; readonly final: number } {
  if (!Number.isFinite(buttonHeight) || buttonHeight <= 0) {
    throw new Error(`plot OK height must be positive; got ${buttonHeight}`);
  }
  const screen = screenPointsForMode(mode);
  return {
    initial: screen.h + buttonHeight * 1.5,
    final: screen.h - buttonHeight * 1.5,
  };
}

/** NewGame's scrolling duration is integer `NSString.length / 19` seconds. */
export function plotTextScrollDurationMs(characterCount: number): number {
  if (!Number.isSafeInteger(characterCount) || characterCount < 0) {
    throw new Error(`plot text length must be a non-negative integer; got ${characterCount}`);
  }
  return Math.floor(characterCount / 19) * 1_000;
}

/** `scrollDone` and the elapsed-time touch branch are independent ways to enable narration exit. */
export function plotNarrationCanFinish(elapsedMs: number, scrollComplete: boolean): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(`plot elapsed time must be non-negative; got ${elapsedMs}`);
  }
  return scrollComplete || elapsedMs >= PLOT_EARLY_FINISH_MS;
}

export const SOURCE_STARTER_CHOICES = [
  { shortType: "BlueBabyDragon", elementName: "Water", elementId: 2 },
  { shortType: "RedBabyDragon", elementName: "Fire", elementId: 3 },
  { shortType: "WhiteBabyDragon", elementName: "Air", elementId: 5 },
  { shortType: "GoldBabyDragon", elementName: "Earth", elementId: 4 },
] as const;

export function pickDragonLayout(mode: DisplayMode): {
  readonly screen: { readonly w: number; readonly h: number };
  readonly gap: number;
  readonly innerGap: number;
  readonly elementFontSize: number;
  readonly descriptionFontSize: number;
  readonly titleFontSize: number;
  readonly choiceCenterY: number;
  readonly titleBand: { readonly y: number; readonly h: number };
} {
  const screen = screenPointsForMode(mode);
  return {
    screen,
    gap: idiomPairPt(15, 30, mode),
    innerGap: idiomPairPt(10, 20, mode),
    elementFontSize: idiomPairPt(16, 32, mode),
    descriptionFontSize: idiomPairPt(11, 22, mode),
    titleFontSize: idiomPairPt(17, 34, mode),
    // Source outer Box's cross-axis origin is at Cocos `winHeight * 0.4`; Box centers its
    // horizontal children on that line. Convert the line to the port's Y-down frame.
    choiceCenterY: screen.h * 0.6,
    titleBand: { y: screen.h * 0.12, h: screen.h * 0.08 },
  };
}
