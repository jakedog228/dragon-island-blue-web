import { idiomPairPt, type DisplayMode } from "../displayMode.js";

export interface WorldHitRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}


export function worldMinimumTouchSize(mode: DisplayMode): number {
  return idiomPairPt(55, 110, mode);
}


export function minimumWorldHitRectangle(
  rectangle: WorldHitRectangle,
  minimumSize: number,
): WorldHitRectangle {
  const width = Math.max(rectangle.width, minimumSize);
  const height = Math.max(rectangle.height, minimumSize);
  return {
    x: rectangle.x - (width - rectangle.width) / 2,
    y: rectangle.y - (height - rectangle.height) / 2,
    width,
    height,
  };
}

/** Final-town children sit under the source town zoom, so express the world-space floor locally. */
export function townLocalMinimumTouchSize(zoom: number, mode: DisplayMode): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) throw new Error(`invalid town zoom: ${zoom}`);
  return worldMinimumTouchSize(mode) / zoom;
}


export function unionWorldHitRectangles(
  rectangles: readonly WorldHitRectangle[],
): WorldHitRectangle | undefined {
  if (rectangles.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rectangle of rectangles) {
    minX = Math.min(minX, rectangle.x);
    minY = Math.min(minY, rectangle.y);
    maxX = Math.max(maxX, rectangle.x + rectangle.width);
    maxY = Math.max(maxY, rectangle.y + rectangle.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Source tests the icon union first and the touchable-building union second, as two regions. */
export function townPoiAggregateHitRegions(
  iconRectangles: readonly WorldHitRectangle[],
  buildingRectangles: readonly WorldHitRectangle[],
): WorldHitRectangle[] {
  const iconRegion = unionWorldHitRectangles(iconRectangles);
  const buildingRegion = unionWorldHitRectangles(buildingRectangles);
  return [iconRegion, buildingRegion].filter(
    (region): region is WorldHitRectangle => region !== undefined,
  );
}
