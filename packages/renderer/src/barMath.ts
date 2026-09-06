


export const BAR_GROW_SPEED = 0.025;


export function easeBarStep(current: number, target: number, growSpeed = BAR_GROW_SPEED): number {
  const diff = target - current;
  if (Math.abs(diff) <= growSpeed) return target;
  return current + Math.sign(diff) * growSpeed;
}


export function hpTint(hp: number, max: number): number {
  const g = Math.trunc((1 - hp / max) * 255);
  return (255 << 16) | (g << 8);
}

/** Pixel-space rect, top-left/Y-down (the convention `tools/dib_extract`'s atlas JSON already uses,
 *  and what PixiJS `Texture.frame` addresses — see scale9.ts's header for the point-vs-pixel split
 *  this widget kit follows). */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}


export function cropTextureRect(full: PixelRect, ratio: number, horizontal: boolean, backwards: boolean): PixelRect {
  if (horizontal) {
    const w = full.w * ratio;
    const x = backwards ? full.x + (full.w - w) : full.x;
    return { x, y: full.y, w, h: full.h };
  }
  const h = full.h * ratio;
  const y = backwards ? full.y + (full.h - h) : full.y;
  return { x: full.x, y, w: full.w, h };
}


export function formatBarFraction(currentPercent: number, max: number): string {
  return `${Math.floor(currentPercent * max)}/${Math.trunc(max)}`;
}
