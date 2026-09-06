import { rectContainsPoint } from "@dib/renderer/hitTest";

export interface MenuButton2Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}












export function menuButton2HitRect(
  visibleRect: MenuButton2Rect,
): { x: number; y: number; w: number; h: number } {
  return { ...visibleRect };
}

export function menuButton2HitTest(
  visibleRect: MenuButton2Rect,
  point: Readonly<{ x: number; y: number }>,
): boolean {
  return rectContainsPoint(visibleRect, point);
}

/** Source release arbitration: containing candidates compete by squared Euclidean centre distance;
 * strict improvement means source enumeration order wins exact ties. */
export function nearestMenuButton2Hit<T>(
  candidates: readonly { readonly value: T; readonly visibleRect: MenuButton2Rect }[],
  point: Readonly<{ x: number; y: number }>,
): T | undefined {
  let nearest: { value: T; distanceSquared: number } | undefined;
  for (const candidate of candidates) {
    if (!rectContainsPoint(candidate.visibleRect, point)) continue;
    const dx = candidate.visibleRect.x + candidate.visibleRect.w / 2 - point.x;
    const dy = candidate.visibleRect.y + candidate.visibleRect.h / 2 - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = { value: candidate.value, distanceSquared };
    }
  }
  return nearest?.value;
}
