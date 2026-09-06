


import type { Point, Rect, Size } from "./scale9Math.js";

/** Normalized source minimum: the shared 55/110pt pair is 55pt in both port idioms. */
export const MIN_TOUCH_SIZE = 55;


export function buttonHitRect(worldPos: Point, scaledSize: Size, minSize: number = MIN_TOUCH_SIZE): Rect {
  let x = worldPos.x;
  let y = worldPos.y;
  let w = scaledSize.w;
  let h = scaledSize.h;

  if (w < minSize) {
    const pad = (minSize - w) / 2;
    x -= pad;
    w = minSize;
  }
  if (h < minSize) {
    const pad = (minSize - h) / 2;
    y -= pad;
    h = minSize;
  }

  return { x, y, w, h };
}

/**
 * Local-space variant of `buttonHitRect`, for gating PixiJS's own event hit test: Pixi's
 * EventBoundary tests a container's `hitArea` in LOCAL space (it applies the container's inverse
 * worldTransform to the pointer first) BEFORE delivering any pointer event, so the padded rect must
 * also exist in local units or taps in the padding ring never generate an event at all.
 *
 * Standard ButtonSprite hosts have identity source-geometry parent scales, so the expansion is
 * computed against `contentSize × ownScale`, then mapped back into local units by dividing through
 * `ownScale` (Pixi already inverts that scale before testing `hitArea`). Transformed world/town
 * hosts instead calculate the minimum in their explicit map/town coordinate frame.
 */
export function buttonHitRectLocal(contentSize: Size, ownScale: Point, minSize: number = MIN_TOUCH_SIZE): Rect {
  return minimumHitRectLocal({ x: 0, y: 0, w: contentSize.w, h: contentSize.h }, ownScale, minSize);
}

/**
 * General local-space form of the shared minimum-hit finalizer. Unlike `buttonHitRectLocal`, the
 * authored content rect may start away from local `(0,0)` (notably an anchored Sprite whose Cocos
 * content origin maps to `(-anchor.x*w, -anchor.y*h)` in Pixi local coordinates). Negative display
 * scales mirror the rect but do not make its physical size negative, so padding uses magnitudes.
 */
export function minimumHitRectLocal(contentRect: Rect, ownScale: Point, minSize: number = MIN_TOUCH_SIZE): Rect {
  const scaleX = Math.abs(ownScale.x);
  const scaleY = Math.abs(ownScale.y);
  if (scaleX === 0 || scaleY === 0) {
    return { ...contentRect };
  }
  const scaled = buttonHitRect(
    { x: contentRect.x * scaleX, y: contentRect.y * scaleY },
    { w: contentRect.w * scaleX, h: contentRect.h * scaleY },
    minSize,
  );
  return {
    x: scaled.x / scaleX,
    y: scaled.y / scaleY,
    w: scaled.w / scaleX,
    h: scaled.h / scaleY,
  };
}

export interface MinimumHitCandidate<T> {
  value: T;
  /** Authored content rect expressed in the same coordinate frame as `point`. */
  contentRect: Rect;
  /** Scale affecting the content rect before the native minimum is applied. */
  ownScale: Point;
}


export function nearestMinimumHit<T>(
  candidates: readonly MinimumHitCandidate<T>[],
  point: Point,
  minSize: number = MIN_TOUCH_SIZE,
): T | undefined {
  let nearest: { value: T; distance2: number } | undefined;
  for (const candidate of candidates) {
    const rect = minimumHitRectLocal(candidate.contentRect, candidate.ownScale, minSize);
    if (!rectContainsPoint(rect, point)) continue;
    const dx = rect.x + rect.w / 2 - point.x;
    const dy = rect.y + rect.h / 2 - point.y;
    const distance2 = dx * dx + dy * dy;
    if (!nearest || distance2 < nearest.distance2) {
      nearest = { value: candidate.value, distance2 };
    }
  }
  return nearest?.value;
}


export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
}
