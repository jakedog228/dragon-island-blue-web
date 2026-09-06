import { describe, expect, it } from "vitest";
import {
  advanceEggGemGlowClock,
  eggAllowsSecondSpin,
  eggFeedMessageKey,
  eggHatchLayout,
  eggMonsterPreviewScale,
  eggPreviewEntryLayouts,
  eggPreviewStarEntry,
  eggPreviewStarAttachment,
  eggPreviewStarGeometry,
  eggProviderAmountFontSize,
  eggProviderFitScale,
  eggReelEntryLayouts,
} from "../src/world/eggHatchMath.js";

describe("egg hatch source layout", () => {
  it("runs the Gem pulse on the raw source action clock instead of the capped reel clock", () => {
    const entered = advanceEggGemGlowClock({ elapsedMs: 0, firstTick: true }, 1_000);
    expect(entered).toEqual({ elapsedMs: 0, firstTick: false });
    expect(advanceEggGemGlowClock(entered, 8_500)).toEqual({
      elapsedMs: 500,
      firstTick: false,
    });
    expect(() => advanceEggGemGlowClock(entered, Number.NaN)).toThrow(/finite/);
  });

  it("pins initializer-time repeat eligibility and pre-feed message branching", () => {
    expect(eggAllowsSecondSpin(2)).toBe(false);
    expect(eggAllowsSecondSpin(3)).toBe(true);
    expect(eggFeedMessageKey(149)).toBe("SpinFedMessageFormatKey");
    expect(eggFeedMessageKey(150)).toBe("SpinFedFullMessageFormatKey");
  });

  it("normalizes the asymmetric native phone/iPad constants", () => {
    expect(eggHatchLayout("iphone")).toMatchObject({
      screen: { w: 480, h: 320 },
      backing: { w: 182, h: 101.5 },
      arrowCenter: { x: 318, y: 160 },
      previewOrigin: { x: 75, y: 65 },
      previewGap: 30,
      previewFit: 70,
      prizeCenter: { x: 420, y: 54 },
    });
    expect(eggHatchLayout("ipad")).toMatchObject({
      screen: { w: 512, h: 384 },
      backing: { w: 213, h: 119 },
      arrowCenter: { x: 295, y: 192 },
      previewOrigin: { x: 37.5, y: 65 },
      previewGap: 30,
      previewFit: 70,
      prizeCenter: { x: 450, y: 84 },
    });
  });

  it("uses the negative-direction Box origin as each preview's top edge", () => {
    expect(eggPreviewEntryLayouts([
      { w: 60, h: 70 },
      { w: 55, h: 50 },
    ], "iphone")).toEqual([
      { x: 45, y: 65 },
      { x: 44, y: 165 },
    ]);
    expect(eggPreviewEntryLayouts([
      { w: 60, h: 70 },
      { w: 55, h: 50 },
    ], "ipad")).toEqual([
      { x: 7.5, y: 65 },
      { x: 7.5, y: 165 },
    ]);
  });

  it("overwrites RendererFactory scale with the source max-dimension preview fit", () => {
    expect(eggMonsterPreviewScale(200, 100, "iphone")).toBe(0.35);
    expect(eggMonsterPreviewScale(20, 10, "iphone")).toBe(3.5);
    expect(eggMonsterPreviewScale(200, 100, "ipad")).toBe(0.35);
  });

  it("starts preview stars at the monster origin without centering the complete row", () => {
    expect(eggPreviewStarAttachment(80, 60, 12, 0.5)).toEqual({
      pivot: { x: 0, y: 0 },
      position: { x: 0, y: 66 },
      scale: 2.3,
    });
  });

  it("pins the helper-owned staggered falling-star startup timing in both idioms", () => {
    expect(eggPreviewStarEntry("iphone", 0)).toEqual({
      delayMs: 100,
      startOffsetY: 300,
    });
    expect(eggPreviewStarEntry("ipad", 4)).toEqual({
      delayMs: 1_300,
      startOffsetY: 300,
    });
  });

  it("folds the HD star exactly once while normalizing the independent 1/2-native gap", () => {
    expect(eggPreviewStarGeometry("iphone", 32, 29.5)).toEqual({
      width: 32,
      height: 29.5,
      gap: 1,
      assetScale: 1,
    });
    expect(eggPreviewStarGeometry("ipad", 32, 29.5)).toEqual({
      width: 32,
      height: 29.5,
      gap: 1,
      assetScale: 1,
    });
  });

  it("lays the cyclic selected backing and neighbours in the explicit Y-up/Y-down frame", () => {
    const entries = eggReelEntryLayouts({ index: 2.25, centerIndex: 2 }, 5, "iphone");
    expect(entries[2]).toEqual({
      index: 2,
      x: 149,
      y: 83.875,
      visible: true,
      selected: true,
    });
    expect(entries[3]!.y).toBe(-17.625);
    expect(entries[1]!.y).toBe(185.375);
  });

  it("overwrites provider scale from 90% of the backing height", () => {
    expect(eggProviderFitScale(200, 101.5)).toBeCloseTo(0.45675);
    expect(eggProviderFitScale(40, 101.5)).toBe(1);
    expect(eggProviderFitScale(200, 119)).toBeCloseTo(0.5355);
  });

  it("normalizes the provider amount's proven bare 14pt literal", () => {
    expect(eggProviderAmountFontSize("iphone")).toBe(14);
    expect(eggProviderAmountFontSize("ipad")).toBe(7);
  });
});
