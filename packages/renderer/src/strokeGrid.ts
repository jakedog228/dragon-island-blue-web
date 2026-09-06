


import type { Point, Rect } from "./scale9Math.js";


export function gridSequence(points: readonly Point[], bounds: Rect): string {
  if (points.length === 0) return "0";

  const cellW = bounds.w / 3;
  const cellH = bounds.h / 3;
  const axes = strokeGridAxes(bounds);
  let seq = "";
  let lastDigit = -1;

  for (const p of points) {


    const rawCol = axes.useX ? Math.floor((p.x - bounds.x) / cellW) : 1;
    const rawRow = axes.useY ? Math.floor((p.y - bounds.y) / cellH) : 1;
    const col = Math.min(2, Math.max(0, rawCol));
    const row = Math.min(2, Math.max(0, rawRow));
    const digit = col + 1 + 3 * row;
    if (digit !== lastDigit) {
      seq += String(digit);
      lastDigit = digit;
    }
  }

  return seq;
}

export interface StrokeGridAxes {
  useX: boolean;
  useY: boolean;
}

/** Exact axis gates around the source's 20pt constant and 3:1 aspect comparisons. */
export function strokeGridAxes(bounds: Rect): StrokeGridAxes {
  const spanX = Math.abs(bounds.w);
  const spanY = Math.abs(bounds.h);
  return {
    useX: spanX >= 20 && !(spanX * 3 < spanY),
    useY: spanY >= 20 && !(spanY * 3 < spanX),
  };
}


export function strokeBounds(points: readonly Point[], pixiYDown = false): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0]!.x;
  let maxX = minX;
  let minY = points[0]!.y;
  let maxY = minY;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return pixiYDown
    ? { x: minX, y: maxY, w: maxX - minX, h: minY - maxY }
    : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}


function resampleAtSpacing(points: readonly Point[], spacing: number): Point[] {
  if (points.length <= 1 || !Number.isFinite(spacing) || spacing <= 0) return [...points];
  const result: Point[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length; i++) {
    const destination = points[i]!;
    let last = result[result.length - 1]!;
    for (;;) {
      const dx = destination.x - last.x;
      const dy = destination.y - last.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= spacing) break;
      const next = {
        x: Math.round(last.x + (dx / distance) * spacing),
        y: Math.round(last.y + (dy / distance) * spacing),
      };
      if (next.x === last.x && next.y === last.y) break;
      result.push(next);
      last = next;
    }
    if (last.x !== destination.x || last.y !== destination.y) result.push({ ...destination });
  }
  return result;
}


export function resampleStrokePath(points: readonly Point[], bounds: Rect): Point[] {
  let result = [...points];
  const axes = strokeGridAxes(bounds);
  const cellW = Math.abs(bounds.w) / 3;
  const cellH = Math.abs(bounds.h) / 3;
  if (axes.useX) result = resampleAtSpacing(result, cellW);
  if (axes.useY) result = resampleAtSpacing(result, cellH);
  return result;
}


export function matchStroke(seq: string, patterns: ReadonlyMap<string, RegExp>): string | null {
  for (const [name, pattern] of patterns) {
    if (pattern.test(seq)) return name;
  }
  return null;
}


export const BATTLE_STROKES: ReadonlyMap<string, RegExp> = new Map([
  ["leftToRight", /^456$/], // slot 1
  ["rightToLeft", /^654$/], // slot 2
  ["upToDown", /^852$/], // slot 3
  ["downToUp", /^258$/], // slot 4
]);
