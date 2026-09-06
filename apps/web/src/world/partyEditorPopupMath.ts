import {
  idiomPairPt,
  roundSourcePoint,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";

export interface DestructivePopupLayout {
  messageWidth: number;
  messageHeight: number;
  messageFontSize: number;
  gap: number;
  rendererY: number;
  roundingScale: number;
}

/** Style-2 header enumeration's proven bare NSNumber(20.0) GapNode. */
export function editableLivingInfoHeaderGap(mode: DisplayMode): number {
  return unscaledIdiomPt(20, mode);
}


export function destructivePopupLayout(mode: DisplayMode): DestructivePopupLayout {
  const messageHeight = idiomPairPt(100, 200, mode);
  const gap = unscaledIdiomPt(5, mode);
  return {
    messageWidth: idiomPairPt(300, 600, mode),
    messageHeight,
    messageFontSize: idiomPairPt(14, 28, mode),
    gap,
    rendererY: roundSourcePoint(messageHeight + gap, mode),
    roundingScale: sourcePointsPerPortPoint(mode),
  };
}
