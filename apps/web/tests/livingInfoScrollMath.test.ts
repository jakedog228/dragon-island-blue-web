import { describe, expect, it, vi } from "vitest";

// The `@dib/renderer` barrel pulls pixi.js, whose module scope probes the browser environment.
vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

import { MIN_TOUCH_SIZE } from "@dib/renderer";
import {
  livingInfoScrollBarClaims,
  livingInfoScrollHitRects,
  livingInfoScrollHitTest,
  type LivingInfoScrollLayout,
} from "../src/battle/livingInfoScrollMath.js";

// A typical iPhone-tier living-info card: 128pt viewable height (`idiomPairPt(128, 300)`), the
// 10pt gutter, and both shipped bars at their 12pt logical width (`scrollbar.png` 12x30,
// `scrollbarTrack.png` stretched to the viewable height).
const LAYOUT: LivingInfoScrollLayout = {
  viewedW: 240,
  viewedH: 128,
  barX: 250,
  barW: 12,
  trackH: 128,
  thumbH: 30,
  thumbY: 0,
};
const thumbTravel = LAYOUT.viewedH - LAYOUT.thumbH;

describe("ScrollingNode bar hit rectangles", () => {
  it("finalizes the 12pt track to the shared 55pt minimum on the narrow axis only", () => {


    expect(livingInfoScrollHitRects(LAYOUT).track).toEqual({ x: 228.5, y: 0, w: 55, h: 128 });
    expect(MIN_TOUCH_SIZE).toBe(55);
  });

  it("finalizes the 12x30 thumb on both axes", () => {
    expect(livingInfoScrollHitRects(LAYOUT).thumb).toEqual({ x: 228.5, y: -12.5, w: 55, h: 55 });
  });

  it("keeps the source target 4.58x the visible artwork", () => {
    const { track } = livingInfoScrollHitRects(LAYOUT);
    expect(track.w / LAYOUT.barW).toBeCloseTo(4.5833, 4);
  });

  it("claims the padding ring on BOTH sides of the visible bar", () => {
    // Left ring (inside the content column, so only the bar-claim test distinguishes it) and right
    // ring (past the old viewport+gutter+sprite rectangle, which ended at x = 262).
    expect(livingInfoScrollBarClaims(LAYOUT, { x: 232, y: 60 })).toBe(true);
    expect(livingInfoScrollBarClaims(LAYOUT, { x: 270, y: 60 })).toBe(true);
    expect(livingInfoScrollHitTest(LAYOUT, { x: 270, y: 60 })).toBe(true);
  });

  it("rejects points past the finalized edges, half-open as CGRectContainsPoint is", () => {
    expect(livingInfoScrollBarClaims(LAYOUT, { x: 283.4, y: 60 })).toBe(true);
    expect(livingInfoScrollBarClaims(LAYOUT, { x: 283.5, y: 60 })).toBe(false);
    expect(livingInfoScrollBarClaims(LAYOUT, { x: 228.4, y: 60 })).toBe(false);
    expect(livingInfoScrollHitTest(LAYOUT, { x: 283.5, y: 60 })).toBe(false);
  });

  it("leaves the content viewport to the rows — only the bars claim a touch", () => {
    expect(livingInfoScrollHitTest(LAYOUT, { x: 100, y: 60 })).toBe(true);
    expect(livingInfoScrollBarClaims(LAYOUT, { x: 100, y: 60 })).toBe(false);
  });

  it("follows the moving thumb and admits its endpoint padding outside the viewport", () => {
    const at = (percent: number): LivingInfoScrollLayout => ({
      ...LAYOUT,
      thumbY: percent * thumbTravel,
    });
    // Percent 0: 12.5pt of claim ABOVE the viewport top.
    expect(livingInfoScrollBarClaims(at(0), { x: 255, y: -8 })).toBe(true);
    expect(livingInfoScrollHitTest(at(0), { x: 255, y: -8 })).toBe(true);
    expect(livingInfoScrollBarClaims(at(0), { x: 255, y: -13 })).toBe(false);
    // Percent 1: thumb at y = 98, so its rect runs to 140.5 — past the 128pt viewport bottom.
    expect(livingInfoScrollBarClaims(at(1), { x: 255, y: 135 })).toBe(true);
    expect(livingInfoScrollHitTest(at(1), { x: 255, y: 135 })).toBe(true);
    expect(livingInfoScrollBarClaims(at(1), { x: 255, y: 141 })).toBe(false);
    // Mid-travel the thumb rect moves with it; the track still covers the whole column.
    expect(livingInfoScrollHitRects(at(0.5)).thumb.y).toBe(0.5 * thumbTravel - 12.5);
  });

  it("normalizes the native-iPad idiom to the same 55 port points", () => {
    // `data_64654 = 110.0f` is the native-iPad literal; this port's coordinate convention halves
    // native iPad points, so the finalized target stays 55 wide in both display modes. The iPad
    // card is taller (300pt viewable) but the bar is the same 12pt art.
    const ipad: LivingInfoScrollLayout = { ...LAYOUT, viewedH: 300, trackH: 300 };
    expect(livingInfoScrollHitRects(ipad).track).toEqual({ x: 228.5, y: 0, w: 55, h: 300 });
  });
});
