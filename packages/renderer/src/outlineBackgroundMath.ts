


export const OUTLINE_SAMPLE_COUNT = 12;
export const OUTLINE_SAMPLE_STEP_DEGREES = 30;


export const OUTLINE_FADE_COLOR = 0x000000;
export const OUTLINE_FADE_BORDER_PT = 2;
export const OUTLINE_FADE_ALPHA = 128 / 255;

export const OUTLINE_PLAIN_ALPHA = 1;

export interface OutlineRenderTextureBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}


export function outlineRenderTextureBounds(
  contentSize: Readonly<{ w: number; h: number }>,
  radiusPt: number,
  sourcePointsPerLocalPoint = 1,
): OutlineRenderTextureBounds {
  if (!(contentSize.w > 0 && contentSize.h > 0) ||
      !Number.isFinite(contentSize.w) || !Number.isFinite(contentSize.h)) {
    throw new Error(`outline content size must be positive and finite: ${contentSize.w}x${contentSize.h}`);
  }
  if (!(radiusPt >= 0) || !Number.isFinite(radiusPt)) {
    throw new Error(`outline radius must be non-negative and finite: ${radiusPt}`);
  }
  if (!(sourcePointsPerLocalPoint > 0) || !Number.isFinite(sourcePointsPerLocalPoint)) {
    throw new Error(`outline source scale must be positive and finite: ${sourcePointsPerLocalPoint}`);
  }
  const w = Math.trunc((contentSize.w + radiusPt * 2) * sourcePointsPerLocalPoint) /
    sourcePointsPerLocalPoint;
  const h = Math.trunc((contentSize.h + radiusPt * 2) * sourcePointsPerLocalPoint) /
    sourcePointsPerLocalPoint;
  return Object.freeze({
    x: (contentSize.w - w) / 2,
    y: (contentSize.h - h) / 2,
    w,
    h,
  });
}


export function outlineSampleOffsets(
  radiusPt: number,
): ReadonlyArray<Readonly<{ x: number; y: number }>> {
  if (!Number.isFinite(radiusPt)) throw new Error(`outline radius must be finite: ${radiusPt}`);
  return Object.freeze(Array.from({ length: OUTLINE_SAMPLE_COUNT }, (_, index) => {
    const radians = (index * OUTLINE_SAMPLE_STEP_DEGREES * Math.PI) / 180;
    return Object.freeze({ x: radiusPt * Math.cos(radians), y: radiusPt * Math.sin(radians) });
  }));
}
