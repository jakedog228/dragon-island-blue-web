


import { minimumHitRectLocal, rectContainsPoint, type Point, type Rect } from "@dib/renderer";

/**
 * The scroll region's own coordinate frame (origin = viewport top-left, y down), which is already
 * in port points — the bar sprites' `1 / CONTENT_SCALE_FACTOR` node scale is baked into `barW` /
 * `trackH` / `thumbH` by the caller, so the finalizer runs at unit scale here.
 */
export interface LivingInfoScrollLayout {
  /** `min(content, viewable)` viewport width — the clipped/masked content column. */
  readonly viewedW: number;
  /** `min(content, viewable)` viewport height; also the track's stretched height. */
  readonly viewedH: number;
  /** Both bars' x: `min'd width + 10.0` (the source's SCROLLBAR_X_GAP gutter). */
  readonly barX: number;
  /** Bar sprite width in points (12 for both shipped images). */
  readonly barW: number;
  /** Track height in points (`setScaleY:` stretches it to the viewable height). */
  readonly trackH: number;
  /** Thumb height in points (native `scrollbar.png` size, never stretched). */
  readonly thumbH: number;
  /** Current thumb y in region coordinates: `percent x (viewableH - thumbH)`. */
  readonly thumbY: number;
}

const UNIT_SCALE: Point = { x: 1, y: 1 };

/**
 * The three regions a pointer may land in: the masked content viewport (rows stay tappable — the
 * source's swallowed claim covers only the two bar sprites) plus each bar's minimum-finalized
 * rectangle. The thumb rect follows `thumbY`, so callers must rebuild it per hit test rather than
 * caching one rect for the drag's lifetime.
 */
export function livingInfoScrollHitRects(
  layout: LivingInfoScrollLayout,
): { readonly viewport: Rect; readonly track: Rect; readonly thumb: Rect } {
  return {
    viewport: { x: 0, y: 0, w: layout.viewedW, h: layout.viewedH },
    track: minimumHitRectLocal(
      { x: layout.barX, y: 0, w: layout.barW, h: layout.trackH },
      UNIT_SCALE,
    ),
    thumb: minimumHitRectLocal(
      { x: layout.barX, y: layout.thumbY, w: layout.barW, h: layout.thumbH },
      UNIT_SCALE,
    ),
  };
}

/**
 * Whether the scroll region as a whole should accept `point`. This is the region container's Pixi
 * `hitArea`, and a Pixi `hitArea` PRUNES ITS WHOLE SUBTREE for rejected points
 * (`EventBoundary.hitTestRecursive` calls `hitPruneFn` before descending into children), so it has
 * to be the union rather than the bare viewport: a viewport-only rect would clip the bars' entire
 * right-hand padding ring and the thumb's endpoint padding back off again.
 */
export function livingInfoScrollHitTest(layout: LivingInfoScrollLayout, point: Point): boolean {
  const rects = livingInfoScrollHitRects(layout);
  return (
    rectContainsPoint(rects.viewport, point) ||
    rectContainsPoint(rects.track, point) ||
    rectContainsPoint(rects.thumb, point)
  );
}

/**
 * Whether `point` (region coordinates) lands on either bar — i.e. whether `ccTouchBegan:` would
 * claim and swallow the touch. Content rows keep every point this rejects.
 */
export function livingInfoScrollBarClaims(layout: LivingInfoScrollLayout, point: Point): boolean {
  const rects = livingInfoScrollHitRects(layout);
  return rectContainsPoint(rects.track, point) || rectContainsPoint(rects.thumb, point);
}
