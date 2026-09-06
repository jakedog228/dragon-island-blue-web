import { idiomPairPt, unscaledIdiomPt, type DisplayMode } from "../displayMode.js";

export interface CaptureChooserMetrics {
  boxGap: number;
  statusSquare: number;
  costBottomInset: number;
  balanceCurrencyGap: number;
}


export function captureChooserMetrics(mode: DisplayMode): CaptureChooserMetrics {
  return {
    boxGap: unscaledIdiomPt(5, mode),
    statusSquare: idiomPairPt(70, 100, mode),
    costBottomInset: idiomPairPt(10, 20, mode),
    balanceCurrencyGap: idiomPairPt(30, 60, mode),
  };
}
