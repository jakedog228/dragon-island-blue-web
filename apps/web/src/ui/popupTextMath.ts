import { unscaledIdiomPt, type DisplayMode } from "../displayMode.js";

export interface PopupTextMeasuredSize {
  readonly width: number;
  readonly height: number;
}

export interface PopupTextLayout extends PopupTextMeasuredSize {
  /** Width supplied to the final fixed-dimensions `CCLabelTTF` equivalent. */
  readonly wrapWidth: number;
  readonly measuredWidth: number;
  readonly measuredHeight: number;
}


export function popupTextLayout(
  minimumWidth: number,
  fontSize: number,
  mode: DisplayMode,
  measure: (wrapWidth: number) => PopupTextMeasuredSize,
): PopupTextLayout {
  if (!(minimumWidth > 0) || !(fontSize > 0)) {
    throw new Error(
      `Popup text dimensions require positive minimum width/font size, got ${minimumWidth}/${fontSize}`,
    );
  }
  let constraint = minimumWidth;
  let measured = measure(constraint);
  while (measured.height > measured.width) {
    constraint += unscaledIdiomPt(50, mode);
    measured = measure(constraint);
  }
  const width = measured.width + unscaledIdiomPt(30, mode);
  return Object.freeze({
    width,
    height: measured.height + fontSize + unscaledIdiomPt(5, mode),
    wrapWidth: width,
    measuredWidth: measured.width,
    measuredHeight: measured.height,
  });
}
