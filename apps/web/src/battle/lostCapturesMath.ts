


import { shrinkToFitScale } from "./displayShared.js";

export interface LostCaptureFitBox {
  maxWidth: number;
  maxHeight: number;
}


export function lostCaptureFitBox(count: number, screenW: number, screenH: number): LostCaptureFitBox {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`showLostCaptures fit box needs at least one capture, got ${count}`);
  }
  return { maxWidth: screenW / 3.0, maxHeight: screenH / (2 * count) };
}


export function lostCaptureNodeScale(
  contentW: number,
  contentH: number,
  count: number,
  screenW: number,
  screenH: number,
): number {
  const { maxWidth, maxHeight } = lostCaptureFitBox(count, screenW, screenH);
  return shrinkToFitScale(contentW, contentH, maxWidth, maxHeight);
}
