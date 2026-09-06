import { describe, expect, it } from "vitest";
import {
  aspectFitScale,
  clampScrollOffset,
  prizeListOffsetForThumbTop,
  prizeListScrollBar,
  prizeListThumbTop,
  tournamentPrizeListLayout,
} from "../src/player/tournamentPrizeListMath.js";

/**
 * Frames decoded from the shipped compiled nibs with `tools/dib_extract/nibarchive.py`. Native
 * points, before this port's iPad halving; the iPad cell is hand-tuned rather than a uniform 2x,
 * which is exactly why each pair is selected before normalisation.
 */
const NATIVE = {
  iphone: {
    scale: 1,
    table: { x: 90, y: 100, w: 300, h: 222 },
    rowHeight: 70,
    reward: { x: 1, y: 4, w: 57, h: 54 },
    lock: { x: 39, y: 8, w: 16, h: 16 },
    title: { x: 66, y: 4, w: 40, h: 52 },
    subtitle: { x: 105, y: 4, w: 128, h: 52 },
    npc: { x: 241, y: 4, w: 57, h: 54 },
    titleFont: 40,
    subtitleFont: 20,
  },
  ipad: {
    scale: 2,
    table: { x: 212, y: 292, w: 600, h: 476 },
    rowHeight: 140,
    reward: { x: 4, y: 22, w: 94, h: 96 },
    lock: { x: 58, y: 28, w: 32, h: 32 },
    title: { x: 109, y: 20, w: 50, h: 98 },
    subtitle: { x: 172, y: 20, w: 326, h: 98 },
    npc: { x: 502, y: 22, w: 94, h: 96 },
    titleFont: 40,
    subtitleFont: 33,
  },
} as const;

describe("TournamentPrizeList nib geometry", () => {
  it("normalises every shipped nib frame into port points", () => {
    for (const mode of ["iphone", "ipad"] as const) {
      const native = NATIVE[mode];
      const layout = tournamentPrizeListLayout(mode);
      const norm = (value: number): number => value / native.scale;

      expect(layout.rowHeight).toBe(norm(native.rowHeight));
      expect(layout.table).toEqual({
        x: norm(native.table.x),
        y: norm(native.table.y),
        w: norm(native.table.w),
        h: norm(native.table.h),
      });
      for (const key of ["reward", "lock", "title", "subtitle", "npc"] as const) {
        expect(layout.row[key]).toEqual({
          x: norm(native[key].x),
          y: norm(native[key].y),
          w: norm(native[key].w),
          h: norm(native[key].h),
        });
      }
      expect(layout.rowTitleFontSize).toBe(norm(native.titleFont));
      expect(layout.rowSubtitleFontSize).toBe(norm(native.subtitleFont));

      // Every row subview stays inside the cell, and the table stays on screen.
      for (const key of ["reward", "lock", "title", "subtitle", "npc"] as const) {
        const frame = layout.row[key];
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.x + frame.w).toBeLessThanOrEqual(layout.cellWidth);
        expect(frame.y + frame.h).toBeLessThanOrEqual(layout.rowHeight);
      }
      expect(layout.table.x + layout.table.w).toBeLessThanOrEqual(layout.screen.w);
      expect(layout.closeButton.x + layout.closeButton.w).toBeLessThanOrEqual(layout.screen.w);
      // The phone nib's table bottom lands 2pt past the 320pt view, matching its background image
      // view's own `y = 4` offset. Authored overhang, reproduced rather than corrected.
      expect(layout.table.y + layout.table.h).toBeLessThanOrEqual(layout.screen.h + 2);
    }
  });

  it("keeps the twelve shipped classes scrollable inside the table viewport", () => {
    for (const mode of ["iphone", "ipad"] as const) {
      const layout = tournamentPrizeListLayout(mode);
      const content = 12 * layout.rowHeight;
      expect(content).toBeGreaterThan(layout.table.h);
      expect(clampScrollOffset(-50, content, layout.table.h)).toBe(0);
      expect(clampScrollOffset(1e6, content, layout.table.h)).toBe(content - layout.table.h);
    }
  });

  it("sizes a scroll thumb that maps one-to-one onto the scroll range", () => {
    for (const mode of ["iphone", "ipad"] as const) {
      const layout = tournamentPrizeListLayout(mode);
      const content = 12 * layout.rowHeight;
      const bar = prizeListScrollBar(layout, content);
      expect(bar).toBeDefined();
      if (bar === undefined) return;

      // The thumb is proportional, stays inside the viewport, and sits inside the table's width.
      expect(bar.thumbHeight).toBeLessThan(layout.table.h);
      expect(bar.travel).toBeCloseTo(layout.table.h - bar.thumbHeight);
      expect(bar.maximum).toBe(content - layout.table.h);
      expect(bar.x + bar.width).toBeLessThanOrEqual(layout.table.w);

      // Both extremes park exactly, and the two directions are inverses of each other.
      expect(prizeListThumbTop(bar, 0)).toBe(0);
      expect(prizeListThumbTop(bar, bar.maximum)).toBeCloseTo(bar.travel);
      expect(prizeListOffsetForThumbTop(bar, 0)).toBe(0);
      expect(prizeListOffsetForThumbTop(bar, bar.travel)).toBeCloseTo(bar.maximum);
      for (const offset of [0, bar.maximum / 3, bar.maximum / 2, bar.maximum]) {
        expect(prizeListOffsetForThumbTop(bar, prizeListThumbTop(bar, offset))).toBeCloseTo(offset);
      }
      // A resting thumb never reports a position outside its own travel.
      expect(prizeListThumbTop(bar, -500)).toBe(0);
      expect(prizeListThumbTop(bar, 1e6)).toBeCloseTo(bar.travel);
    }
  });

  it("shows no scroll bar when the rows fit the table", () => {
    const layout = tournamentPrizeListLayout("iphone");
    expect(prizeListScrollBar(layout, layout.table.h)).toBeUndefined();
    expect(prizeListScrollBar(layout, layout.table.h - 1)).toBeUndefined();
    expect(prizeListScrollBar(layout, layout.table.h + 1)).toBeDefined();
  });

  it("aspect-fits a reward render into its frame without distorting it", () => {
    // UIViewContentModeScaleAspectFit: limited by the tighter axis, and it does upscale.
    expect(aspectFitScale({ w: 100, h: 50 }, { w: 50, h: 50 })).toBe(0.5);
    expect(aspectFitScale({ w: 50, h: 100 }, { w: 50, h: 50 })).toBe(0.5);
    expect(aspectFitScale({ w: 10, h: 10 }, { w: 50, h: 50 })).toBe(5);
    expect(aspectFitScale({ w: 0, h: 0 }, { w: 50, h: 50 })).toBe(1);
  });
});
