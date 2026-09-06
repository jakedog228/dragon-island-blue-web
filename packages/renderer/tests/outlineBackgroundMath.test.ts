import { describe, expect, it } from "vitest";
import {
  OUTLINE_FADE_ALPHA,
  OUTLINE_FADE_BORDER_PT,
  OUTLINE_FADE_COLOR,
  OUTLINE_PLAIN_ALPHA,
  OUTLINE_SAMPLE_COUNT,
  OUTLINE_SAMPLE_STEP_DEGREES,
  outlineRenderTextureBounds,
  outlineSampleOffsets,
} from "../src/outlineBackgroundMath.js";

describe("sub_660cc outline stamp circle", () => {
  it("stamps twelve samples at thirty-degree steps", () => {
    expect(OUTLINE_SAMPLE_COUNT).toBe(12);
    expect(OUTLINE_SAMPLE_STEP_DEGREES).toBe(30);
    expect(OUTLINE_SAMPLE_COUNT * OUTLINE_SAMPLE_STEP_DEGREES).toBe(360);
  });

  it("places every sample on the border-width circle", () => {
    const offsets = outlineSampleOffsets(3);
    expect(offsets).toHaveLength(12);
    for (const offset of offsets) {
      expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(3, 10);
    }

    expect(offsets[0]).toEqual({ x: 3, y: 0 });
    expect(offsets[3]!.x).toBeCloseTo(0, 10);
    expect(offsets[3]!.y).toBeCloseTo(3, 10);
    expect(offsets[6]!.x).toBeCloseTo(-3, 10);
  });

  it("scales the circle with the border width and rejects non-finite radii", () => {
    expect(outlineSampleOffsets(2)[0]).toEqual({ x: 2, y: 0 });
    expect(() => outlineSampleOffsets(Number.NaN)).toThrow(/finite/);
  });

  it("keeps the two source outline presets apart", () => {

    expect(OUTLINE_FADE_COLOR).toBe(0x000000);
    expect(OUTLINE_FADE_BORDER_PT).toBe(2);
    expect(OUTLINE_FADE_ALPHA).toBeCloseTo(128 / 255, 12);
    expect(OUTLINE_PLAIN_ALPHA).toBe(1);
  });

  it("truncates and centers the native render target before device normalization", () => {
    // Bitewing-hd is 180x123 px = 90x61.5 iPhone points. Native truncates 61.5 + 2*3 to 67.
    expect(outlineRenderTextureBounds({ w: 90, h: 61.5 }, 3, 1)).toEqual({
      x: -3,
      y: -2.75,
      w: 96,
      h: 67,
    });
    // The iPad source uses doubled coordinates, then this port normalizes them back by two.
    expect(outlineRenderTextureBounds({ w: 90, h: 61.5 }, 1.5, 2)).toEqual({
      x: -1.5,
      y: -1.5,
      w: 93,
      h: 64.5,
    });
  });

  it("rejects invalid render-target inputs", () => {
    expect(() => outlineRenderTextureBounds({ w: 0, h: 1 }, 2)).toThrow(/content size/);
    expect(() => outlineRenderTextureBounds({ w: 1, h: 1 }, -1)).toThrow(/radius/);
    expect(() => outlineRenderTextureBounds({ w: 1, h: 1 }, 1, 0)).toThrow(/source scale/);
  });
});
