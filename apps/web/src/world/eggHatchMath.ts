import type { EggReelState } from "@dib/engine";
import {
  idiomPairPt,
  screenPointsForMode,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";

export const EGG_PREVIEW_STAR_ENTRY_DELAY_BASE_MS = 100;
export const EGG_PREVIEW_STAR_ENTRY_DELAY_STEP_MS = 300;
export const EGG_PREVIEW_STAR_MOVE_MS = 1_500;
export const EGG_PREVIEW_STAR_SCALE_MS = 2_500;
export const EGG_PREVIEW_STAR_FINAL_SCALE = 0.35;

export interface EggGemGlowClock {
  readonly elapsedMs: number;
  readonly firstTick: boolean;
}

/**
 * `CCActionInterval -step:` ignores the first scheduled `dt`, then ActionManager advances the
 * repeating Gem pulse on director time. This clock therefore remains independent of
 * `SlotMachineNode`'s fixed-60 update/catch-up policy.
 */
export function advanceEggGemGlowClock(
  clock: EggGemGlowClock,
  deltaMs: number,
): EggGemGlowClock {
  if (!Number.isFinite(clock.elapsedMs) || clock.elapsedMs < 0 || !Number.isFinite(deltaMs)) {
    throw new Error("egg Gem glow clock values must be finite and nonnegative");
  }
  if (clock.firstTick) return Object.freeze({ elapsedMs: clock.elapsedMs, firstTick: false });
  return Object.freeze({
    elapsedMs: (clock.elapsedMs + Math.max(0, deltaMs)) % 2_000,
    firstTick: false,
  });
}


export function eggAllowsSecondSpin(heroLevel: number): boolean {
  if (!Number.isSafeInteger(heroLevel) || heroLevel < 1) {
    throw new Error(`egg hero level ${heroLevel}`);
  }
  return heroLevel > 2;
}


export function eggFeedMessageKey(
  recipientLevelBeforeFeed: number,
): "SpinFedFullMessageFormatKey" | "SpinFedMessageFormatKey" {
  if (!Number.isSafeInteger(recipientLevelBeforeFeed) || recipientLevelBeforeFeed < 1) {
    throw new Error(`egg feed recipient level ${recipientLevelBeforeFeed}`);
  }
  return recipientLevelBeforeFeed > 149
    ? "SpinFedFullMessageFormatKey"
    : "SpinFedMessageFormatKey";
}

export interface EggPreviewStarGeometry {
  readonly width: number;
  readonly height: number;
  readonly gap: number;
  readonly assetScale: number;
}


export function eggPreviewStarGeometry(
  mode: DisplayMode,
  phonePointWidth: number,
  phonePointHeight: number,
): EggPreviewStarGeometry {
  if (!(phonePointWidth > 0) || !(phonePointHeight > 0)) {
    throw new Error("egg preview star dimensions must be positive");
  }
  const assetScale = 1;
  return Object.freeze({
    width: phonePointWidth,
    height: phonePointHeight,


    gap: idiomPairPt(1, 2, mode),
    assetScale,
  });
}

export function eggPreviewStarEntry(mode: DisplayMode, index: number): {
  readonly delayMs: number;
  readonly startOffsetY: number;
} {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`egg preview star index ${index}`);
  }
  return Object.freeze({
    delayMs:
      EGG_PREVIEW_STAR_ENTRY_DELAY_BASE_MS + EGG_PREVIEW_STAR_ENTRY_DELAY_STEP_MS * index,
    startOffsetY: idiomPairPt(300, 600, mode),
  });
}

export interface EggHatchLayout {
  readonly screen: { readonly w: number; readonly h: number };
  readonly backing: { readonly w: number; readonly h: number };
  readonly arrowCenter: { readonly x: number; readonly y: number };
  readonly previewOrigin: { readonly x: number; readonly y: number };
  readonly previewGap: number;
  readonly previewFit: number;
  readonly prizeCenter: { readonly x: number; readonly y: number };
  readonly backgroundAsset: string;
  readonly backingAsset: string;
}


export function eggHatchLayout(mode: DisplayMode): EggHatchLayout {
  const screen = screenPointsForMode(mode);
  const nativeScale = sourcePointsPerPortPoint(mode);
  const backing = mode === "ipad"
    ? { w: 426 / nativeScale, h: 238 / nativeScale }
    : { w: 364 / 2, h: 203 / 2 };
  const previewCocosY = screen.h - idiomPairPt(65, 130, mode);
  return Object.freeze({
    screen,
    backing,
    // Raw d1ed2-d1f1a: (winWidth * .5 + 78, winHeight * .5). The 78 is bare,
    // so it normalizes to 39 port points on iPad.
    arrowCenter: Object.freeze({
      x: screen.w / 2 + unscaledIdiomPt(78, mode),
      y: screen.h / 2,
    }),
    previewOrigin: Object.freeze({
      x: unscaledIdiomPt(75, mode),
      y: screen.h - previewCocosY,
    }),
    previewGap: idiomPairPt(30, 60, mode),
    previewFit: idiomPairPt(70, 140, mode),
    prizeCenter: Object.freeze({
      x: idiomPairPt(420, 900, mode),
      y: screen.h - idiomPairPt(266, 600, mode),
    }),
    backgroundAsset: mode === "ipad" ? "SlotBackground-ipadhd" : "SlotBackground-hd",
    backingAsset: mode === "ipad" ? "SlotBacking-ipadhd" : "SlotBacking-hd",
  });
}

export interface EggPreviewSize {
  readonly w: number;
  readonly h: number;
}

export interface EggPreviewEntryLayout {
  readonly x: number;
  readonly y: number;
}


export function eggPreviewEntryLayouts(
  sizes: readonly EggPreviewSize[],
  mode: DisplayMode,
): readonly EggPreviewEntryLayout[] {
  const { previewOrigin, previewGap } = eggHatchLayout(mode);
  const nativeScale = sourcePointsPerPortPoint(mode);
  const sourceRound = (value: number): number =>
    (value < 0 ? -Math.round(-value) : Math.round(value));
  const boxWidthNative = sourceRound(Math.max(0, ...sizes.map(({ w }) => w * nativeScale)));
  let precedingExtentNative = 0;
  return Object.freeze(sizes.map(({ w, h }, index) => {
    if (!(w > 0) || !(h > 0)) {
      throw new Error(`egg preview ${index} dimensions must be positive`);
    }
    const widthNative = w * nativeScale;
    const primaryOffsetNative = sourceRound(-precedingExtentNative);
    // layoutChildren first roundf-packs x=-w/2. The explicit horizontalAlignment=0 second pass
    // then applies -(boxW-w)/2 and roundf again. Algebraically this resembles a common left edge,
    // but the nested source rounding can retain a one-native-point child-specific difference.
    const crossOffsetNative = sourceRound(
      sourceRound(-widthNative / 2) - (boxWidthNative - widthNative) / 2,
    );
    const result = Object.freeze({
      x: previewOrigin.x + crossOffsetNative / nativeScale,
      y: previewOrigin.y - primaryOffsetNative / nativeScale,
    });
    precedingExtentNative += (h + previewGap) * nativeScale;
    return result;
  }));
}


export function eggMonsterPreviewScale(
  contentWidth: number,
  contentHeight: number,
  mode: DisplayMode,
): number {
  if (!(contentWidth > 0) || !(contentHeight > 0)) {
    throw new Error("egg monster preview content dimensions must be positive");
  }
  return eggHatchLayout(mode).previewFit / Math.max(contentWidth, contentHeight);
}

export interface EggPreviewStarAttachment {
  readonly pivot: { readonly x: number; readonly y: number };
  readonly position: { readonly x: number; readonly y: number };
  readonly scale: number;
}

/**
 * SlotMachine attaches the untouched helper Box at Cocos `(0,-boxH/2)` before applying the Box's
 * reciprocal scale. In the renderer's top-left/Y-down frame, that Box origin is
 * `(0, rendererHeight + boxH/2)`. Pixi pivots participate in scale, so expressing this as a
 * half-height pivot changes the source position whenever the reciprocal scale is not one.
 */
export function eggPreviewStarAttachment(
  rendererWidth: number,
  rendererHeight: number,
  starBoxHeight: number,
  rendererScale: number,
): EggPreviewStarAttachment {
  if (!(rendererWidth > 0) || !(rendererHeight > 0) || !(starBoxHeight > 0)) {
    throw new Error("egg preview star attachment dimensions must be positive");
  }
  if (!(rendererScale > 0)) throw new Error("egg preview renderer scale must be positive");
  return Object.freeze({
    pivot: Object.freeze({ x: 0, y: 0 }),
    position: Object.freeze({
      // Cocos anchorPoint changes how the renderer is positioned in its parent; it does not move
      // the renderer's local bottom-left coordinate system used by its star child. Both the outer
      // Box-owned previews and the independently positioned Gold prize therefore attach at local
      // x=0. Cocos y=-boxH/2 becomes rendererHeight+boxH/2 in the Y-down frame.
      x: 0,
      y: rendererHeight + starBoxHeight / 2,
    }),
    scale: 1 / rendererScale + 0.3,
  });
}

export interface EggReelEntryLayout {
  readonly index: number;
  readonly x: number;
  /** Pixi top edge. The source backing is anchored (.5,0) in its Y-up frame. */
  readonly y: number;
  readonly visible: boolean;
  readonly selected: boolean;
}


export function eggReelEntryLayouts(
  state: Pick<EggReelState, "index" | "centerIndex">,
  count: number,
  mode: DisplayMode,
): readonly EggReelEntryLayout[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error(`egg reel count ${count}`);
  const layout = eggHatchLayout(mode);
  const selectedAbsolute = Math.floor(state.index);
  const fraction = state.index - selectedAbsolute;
  const selectedBaselineCocosY = layout.screen.h / 2 - fraction * layout.backing.h;
  const result: EggReelEntryLayout[] = [];
  for (let index = 0; index < count; index += 1) {
    let delta = index - state.centerIndex;
    if (delta > count / 2) delta -= count;
    if (delta < -count / 2) delta += count;
    const baselineCocosY = selectedBaselineCocosY + delta * layout.backing.h;
    const top = layout.screen.h - baselineCocosY - layout.backing.h;
    result.push(Object.freeze({
      index,
      x: layout.screen.w / 2 - layout.backing.w / 2,
      y: top,
      visible: top < layout.screen.h && top + layout.backing.h > 0,
      selected: index === state.centerIndex,
    }));
  }
  return Object.freeze(result);
}


export function eggProviderFitScale(displayHeight: number, backingHeight: number): number {
  if (!(displayHeight > 0) || !(backingHeight > 0)) {
    throw new Error("egg provider fit dimensions must be positive");
  }
  return Math.min(1, backingHeight * 0.9 / displayHeight);
}

/** `EggProvider.buildDisplayNode` uses one bare 14pt literal with no iPad idiom pair. */
export function eggProviderAmountFontSize(mode: DisplayMode): number {
  return unscaledIdiomPt(14, mode);
}
