import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, screenPointsForMode } from "../displayMode.js";

export interface RectPt {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PrizeListRowFrames {
  /** `rewardImage`, UIViewContentModeScaleAspectFit. */
  readonly reward: RectPt;
  /** `lockImage`, UIViewContentModeCenter — natural size, not fitted. */
  readonly lock: RectPt;
  /** `title`, the class letter. */
  readonly title: RectPt;
  /** `subTitle`, two lines, word wrapped to its frame. */
  readonly subtitle: RectPt;
  /** `npcImageView`, UIViewContentModeScaleAspectFit. */
  readonly npc: RectPt;
}

export interface PrizeListLayout {
  readonly screen: { readonly w: number; readonly h: number };
  readonly titleLabel: RectPt;
  readonly titleFontSize: number;
  readonly table: RectPt;
  readonly closeButton: RectPt;
  readonly rowHeight: number;
  readonly cellWidth: number;
  readonly row: PrizeListRowFrames;
  readonly rowTitleFontSize: number;
  readonly rowSubtitleFontSize: number;
}

/** `darkTextColor` in both cell nibs: UIColor(0.0297, 0.0105, 0.0112). */
export const PRIZE_ROW_TEXT_COLOR = 0x080303;
/** The controller nib's `titleLabel` colour, UIColor(0.995, 0.99, 0.99). */
export const PRIZE_TITLE_TEXT_COLOR = 0xfdfcfc;


export function tournamentPrizeListLayout(mode: DisplayMode): PrizeListLayout {
  const pair = (phone: number, pad: number): number => idiomPairPt(phone, pad, mode);
  const rect = (
    phone: readonly [number, number, number, number],
    pad: readonly [number, number, number, number],
  ): RectPt => ({
    x: pair(phone[0], pad[0]),
    y: pair(phone[1], pad[1]),
    w: pair(phone[2], pad[2]),
    h: pair(phone[3], pad[3]),
  });
  return {
    screen: screenPointsForMode(mode),
    titleLabel: rect([0, 0, 480, 80], [0, 0, 1064, 165]),
    titleFontSize: pair(40, 82),
    table: rect([90, 100, 300, 222], [212, 292, 600, 476]),
    closeButton: rect([431, 11, 38, 38], [966, 20, 38, 38]),
    rowHeight: pair(70, 140),
    cellWidth: pair(300, 600),
    row: {
      reward: rect([1, 4, 57, 54], [4, 22, 94, 96]),
      lock: rect([39, 8, 16, 16], [58, 28, 32, 32]),
      title: rect([66, 4, 40, 52], [109, 20, 50, 98]),
      subtitle: rect([105, 4, 128, 52], [172, 20, 326, 98]),
      npc: rect([241, 4, 57, 54], [502, 22, 94, 96]),
    },
    rowTitleFontSize: pair(40, 40),
    rowSubtitleFontSize: pair(20, 33),
  };
}


export function aspectFitScale(
  content: { readonly w: number; readonly h: number },
  frame: { readonly w: number; readonly h: number },
): number {
  if (content.w <= 0 || content.h <= 0) return 1;
  return Math.min(frame.w / content.w, frame.h / content.h);
}

/** Clamps a table's scroll offset to its content, matching UIScrollView's resting bounds. */
export function clampScrollOffset(
  offset: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const maximum = Math.max(0, contentHeight - viewportHeight);
  return Math.min(maximum, Math.max(0, offset));
}

export interface PrizeListScrollBar {
  /** Drawn width of the thumb, in port points. */
  readonly width: number;
  /** Thumb x inside the table, in port points. */
  readonly x: number;
  readonly thumbHeight: number;
  /** Distance the thumb's top travels between the two resting extremes. */
  readonly travel: number;
  /** Largest scroll offset the content allows, i.e. `clampScrollOffset`'s ceiling. */
  readonly maximum: number;
}

/**
 * Resting geometry for the port's scroll indicator. UIScrollView draws and sizes the real one, so
 * only its proportional resting size is reproducible from the nibs; its fade-out and rubber-band
 * are UIKit's. `undefined` when the content fits, which is when UIKit shows no indicator either.
 */
export function prizeListScrollBar(
  layout: PrizeListLayout,
  contentHeight: number,
): PrizeListScrollBar | undefined {
  const viewportHeight = layout.table.h;
  const maximum = contentHeight - viewportHeight;
  if (maximum <= 0) return undefined;
  const width = Math.max(2, layout.table.w * 0.01);
  const thumbHeight = Math.min(
    viewportHeight,
    Math.max(layout.rowHeight / 3, viewportHeight * (viewportHeight / contentHeight)),
  );
  return {
    width,
    x: layout.table.w - width * 2,
    thumbHeight,
    travel: viewportHeight - thumbHeight,
    maximum,
  };
}

/** Thumb top for a scroll offset — the indicator's resting position. */
export function prizeListThumbTop(bar: PrizeListScrollBar, offset: number): number {
  if (bar.maximum <= 0) return 0;
  return bar.travel * (Math.min(bar.maximum, Math.max(0, offset)) / bar.maximum);
}

/** Inverse of `prizeListThumbTop`: the scroll offset that parks the thumb at `thumbTop`. */
export function prizeListOffsetForThumbTop(bar: PrizeListScrollBar, thumbTop: number): number {
  if (bar.travel <= 0) return 0;
  return (thumbTop / bar.travel) * bar.maximum;
}
