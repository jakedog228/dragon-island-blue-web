import type { DisplayMode } from "../displayMode.js";
import { screenPointsForMode } from "../displayMode.js";

export const BIG_MAP_SIZE_PT = { w: 480, h: 320 } as const;
export const BIG_MAP_CELL_SIZE_PT = { w: 120, h: 80 } as const;
export const BIG_MAP_UNVISITED_ALPHA = 120 / 255;

export function parseWorldCell(name: string): { column: number; row: number } {
  const match = /^World_([1-4])-([1-4])$/.exec(name);
  if (!match) throw new Error(`BigMapNode requires World_<1-4>-<1-4>, got ${name}`);
  return { column: Number(match[1]), row: Number(match[2]) };
}

export function bigMapViewportPosition(mode: DisplayMode): { x: number; y: number } {
  const screen = screenPointsForMode(mode);
  return { x: (screen.w - BIG_MAP_SIZE_PT.w) / 2, y: (screen.h - BIG_MAP_SIZE_PT.h) / 2 };
}

export function bigMapCellLayout(name: string): {
  mask: { x: number; y: number; w: number; h: number };
  heroCenter: { x: number; y: number };
} {
  const { column, row } = parseWorldCell(name);
  return {
    mask: {
      x: (column - 1) * BIG_MAP_CELL_SIZE_PT.w,
      y: (4 - row) * BIG_MAP_CELL_SIZE_PT.h,
      w: BIG_MAP_CELL_SIZE_PT.w,
      h: BIG_MAP_CELL_SIZE_PT.h,
    },
    heroCenter: {
      x: (column - 0.5) * BIG_MAP_CELL_SIZE_PT.w,
      y: (4.5 - row) * BIG_MAP_CELL_SIZE_PT.h,
    },
  };
}

/** The source never parses the active world's name. `BigMapNode.fadeInFinished` compares it
 * against the sixteen literal `World_i-j` names produced by its nested loop and adds a hero only
 * on a match. The shipped seventeenth world, `UnderWorld_1-1`, therefore has no Big Map marker. */
export function bigMapCurrentWorldLayout(name: string): ReturnType<typeof bigMapCellLayout> | undefined {
  return /^World_[1-4]-[1-4]$/.test(name) ? bigMapCellLayout(name) : undefined;
}
