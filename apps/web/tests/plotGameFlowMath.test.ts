import { describe, expect, it } from "vitest";
import {
  PLOT_BACKGROUND_TEXTURE_RECT_PX,
  BATTLE_TUTORIAL_DELAY_MS,
  PLOT_EARLY_FINISH_MS,
  PLOT_OK_DELAY_MS,
  PLOT_OK_MOVE_MS,
  PLOT_SLIDE_MS,
  SOURCE_STARTER_CHOICES,
  pickDragonLayout,
  plotNarrationCanFinish,
  plotOkButtonY,
  plotPageLayout,
  plotTextScrollDurationMs,
} from "../src/ui/plotGameFlowMath.js";

describe("source plot and starter geometry", () => {
  it("pins the PlotGameFlowEvent crop, placement, and timings in both idioms", () => {
    expect(PLOT_BACKGROUND_TEXTURE_RECT_PX).toEqual({ x: 0, y: 0, w: 1024, h: 768 });
    expect(plotPageLayout("iphone")).toEqual({
      screen: { w: 480, h: 320 },
      background: { x: -16, y: -32 },
      okFontSize: 20,
      okX: 240,
    });
    expect(plotPageLayout("ipad")).toEqual({
      screen: { w: 512, h: 384 },
      background: { x: 0, y: 0 },
      okFontSize: 15,
      okX: 256,
    });
    expect(plotOkButtonY("iphone", 20)).toEqual({ initial: 350, final: 290 });
    expect(plotOkButtonY("ipad", 20)).toEqual({ initial: 414, final: 354 });
    expect([
      PLOT_SLIDE_MS,
      PLOT_OK_DELAY_MS,
      PLOT_OK_MOVE_MS,
      PLOT_EARLY_FINISH_MS,
      BATTLE_TUTORIAL_DELAY_MS,
    ]).toEqual([750, 250, 750, 2_000, 2_000]);
  });

  it("uses integer NSString.length / 19 seconds for the NewGame plot scroll", () => {
    expect(plotTextScrollDurationMs(0)).toBe(0);
    expect(plotTextScrollDurationMs(18)).toBe(0);
    expect(plotTextScrollDurationMs(19)).toBe(1_000);
    expect(plotTextScrollDurationMs(57)).toBe(3_000);
    expect(() => plotTextScrollDurationMs(1.5)).toThrow(/integer/);
    expect(plotNarrationCanFinish(1_999, false)).toBe(false);
    expect(plotNarrationCanFinish(2_000, false)).toBe(true);
    expect(plotNarrationCanFinish(500, true)).toBe(true);
    expect(() => plotNarrationCanFinish(-1, false)).toThrow(/non-negative/);
  });

  it("pins the four source starter identities, elements, and paired layout constants", () => {
    expect(SOURCE_STARTER_CHOICES).toEqual([
      { shortType: "BlueBabyDragon", elementName: "Water", elementId: 2 },
      { shortType: "RedBabyDragon", elementName: "Fire", elementId: 3 },
      { shortType: "WhiteBabyDragon", elementName: "Air", elementId: 5 },
      { shortType: "GoldBabyDragon", elementName: "Earth", elementId: 4 },
    ]);
    expect(pickDragonLayout("iphone")).toEqual({
      screen: { w: 480, h: 320 },
      gap: 15,
      innerGap: 10,
      elementFontSize: 16,
      descriptionFontSize: 11,
      titleFontSize: 17,
      choiceCenterY: 192,
      titleBand: { y: 38.4, h: 25.6 },
    });
    const ipad = pickDragonLayout("ipad");
    expect(ipad).toMatchObject({
      screen: { w: 512, h: 384 },
      gap: 15,
      innerGap: 10,
      elementFontSize: 16,
      descriptionFontSize: 11,
      titleFontSize: 17,
      titleBand: { y: 46.08, h: 30.72 },
    });
    expect(ipad.choiceCenterY).toBeCloseTo(230.4);
  });
});
