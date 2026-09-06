export interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Scale-to-fit with letterboxing for a fixed logical stage. */
export function computeFit(viewW: number, viewH: number, stageW: number, stageH: number): Fit {
  if (viewW <= 0 || viewH <= 0) throw new Error(`nonpositive viewport: ${viewW}x${viewH}`);
  const scale = Math.min(viewW / stageW, viewH / stageH);
  return {
    scale,
    offsetX: (viewW - stageW * scale) / 2,
    offsetY: (viewH - stageH * scale) / 2,
  };
}
