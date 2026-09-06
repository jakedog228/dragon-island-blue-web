import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, screenPointsForMode, unscaledIdiomPt } from "../displayMode.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";


export const STARTUP_SOURCE = {
  preloaderOnEnter: 0x0dc0c9,
  preloaderLoadPercentUpdate: 0x0dc53d,
  preloaderUpdateDots: 0x0dc599,
  preloaderLoadNextResource: 0x0dc885,
  mainMenuInit: 0x0cc185,
  mainMenuTouchEnded: 0x0cc799,
  pickSaveSlotOnEnter: 0x0f0795,
  pickSaveSlotContinue: 0x0f0e2d,
  pickSaveSlotLaunch: 0x0f13f1,
  creditsInit: 0x0c7ed9,
  fadeTransitionHelper: 0x066534,
  popupConfigDefaults: 0x0bdff8,
  popupMenuRebuild: 0x0bad0c,
  positionHelper: 0x0656a0,
} as const;

export const PRELOADER_REVEAL_DELAY_MS = 200;
export const PRELOADER_DOT_INTERVAL_MS = 500;
export const PRELOADER_PROGRESS_MAX = 98;
export const TITLE_PULSE_HALF_CYCLE_MS = 1_000;
export const SOURCE_FADE_TRANSITION_MS = 500;
export const SAVE_CONTINUE_DELAY_MS = 100;

export function startupLayout(mode: DisplayMode) {
  return {
    screen: screenPointsForMode(mode),
    preloader: {
      labelFont: unscaledIdiomPt(16, mode),
      dotsFont: unscaledIdiomPt(18, mode),
      bottomInset: unscaledIdiomPt(10, mode),
      progressGap: unscaledIdiomPt(10, mode),
      outlineWidth: unscaledIdiomPt(2, mode),
    },
    title: {
      promptFont: idiomPairPt(30, 60, mode),
      versionFont: unscaledIdiomPt(14, mode),
      bottomInset: unscaledIdiomPt(10, mode),
      versionInset: unscaledIdiomPt(10, mode),
    },
    credits: {
      titleFont: idiomPairPt(20, 40, mode),
      entryFont: idiomPairPt(16, 32, mode),
    },
    mainMenu: {
      titleSize: idiomPairPt(25, 50, mode),
      itemSize: idiomPairPt(20, 40, mode),
      titleGap: idiomPairPt(20, 40, mode),
      itemGap: idiomPairPt(30, 60, mode),
      columnGap: idiomPairPt(30, 60, mode),
      outlineWidth: unscaledIdiomPt(2, mode),
      backgroundMarginX: idiomPairPt(9, 18, mode),
      backgroundMarginY: idiomPairPt(6, 12, mode),
      titleColor: 0xffff88,
      itemColor: 0xffffff,
      disabledColor: 0x000000,
    },
    background: {
      textureRectPx: { x: 0, y: 0, w: 1024, h: 768 },
      sizePt: { w: 512, h: 384 },
    },
  } as const;
}

/** Credits.plist `space` values are proven bare source literals. */
export function normalizeCreditSpacePt(value: number, mode: DisplayMode): number {
  return unscaledIdiomPt(value, mode);
}

export let STARTUP_LAYOUT = startupLayout(DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  STARTUP_LAYOUT = startupLayout(DISPLAY_MODE);
});

/** Menus.plist MainMenu overlays; the left -0.19 anchor is shipped data, not an inferred offset. */
export const MAIN_MENU_OVERLAYS = [
  { file: "ClerkGirl.png", anchor: { x: -0.19, y: 0 } },
  { file: "TutorialRightSide.png", anchor: { x: 1, y: 0 } },
] as const;
