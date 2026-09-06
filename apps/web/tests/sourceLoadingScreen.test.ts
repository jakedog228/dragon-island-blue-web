import { describe, expect, it } from "vitest";
import {
  sourceLoadingScreenLayout,
  sourceLoadingScreenMetrics,
} from "../src/content/sourceLoadingScreen.js";

describe("source first-load screen geometry", () => {
  it("preserves the source-native iPhone crop and loading placement", () => {
    expect(sourceLoadingScreenMetrics("iphone")).toEqual({
      screenWidthPt: 480,
      screenHeightPt: 320,
      backgroundWidthPt: 512,
      backgroundHeightPt: 384,
      labelBottomPt: 10,
      labelFontPt: 16,
    });
  });

  it("preserves the distinct source-native iPad geometry", () => {
    expect(sourceLoadingScreenMetrics("ipad")).toEqual({
      screenWidthPt: 512,
      screenHeightPt: 384,
      backgroundWidthPt: 512,
      backgroundHeightPt: 384,
      labelBottomPt: 5,
      labelFontPt: 8,
    });
  });

  it("letterboxes the iPhone stage and keeps its crop and label in the same frame", () => {
    expect(sourceLoadingScreenLayout("iphone", 1_280, 800, 1_024, 1_024)).toEqual({
      frameWidthPx: 1_200,
      frameHeightPx: 800,
      backgroundWidthPx: 1_280,
      backgroundHeightPx: 960,
      sourceImageWidthPx: 1_280,
      sourceImageHeightPx: 1_280,
      sourceImageLeftPx: -0,
      sourceImageTopPx: -0,
      labelBottomPx: 25,
      labelFontPx: 40,
    });
  });

  it("letterboxes the iPad stage with its distinct full-frame geometry", () => {
    const layout = sourceLoadingScreenLayout("ipad", 1_280, 800, 1_024, 1_024);
    expect(layout.frameWidthPx).toBeCloseTo(1_066.6667);
    expect(layout.frameHeightPx).toBe(800);
    expect(layout.backgroundWidthPx).toBeCloseTo(1_066.6667);
    expect(layout.backgroundHeightPx).toBe(800);
    expect(layout.sourceImageWidthPx).toBeCloseTo(1_066.6667);
    expect(layout.sourceImageHeightPx).toBeCloseTo(1_066.6667);
    expect(layout.sourceImageLeftPx).toBe(-0);
    expect(layout.sourceImageTopPx).toBe(-0);
    expect(layout.labelBottomPx).toBeCloseTo(10.4167);
    expect(layout.labelFontPx).toBeCloseTo(16.6667);
  });

  it("rejects an archive image that cannot supply the source texture rectangle", () => {
    expect(() => sourceLoadingScreenLayout("iphone", 960, 640, 1_024, 767))
      .toThrow(/source crop requires 1024x768/);
  });
});
