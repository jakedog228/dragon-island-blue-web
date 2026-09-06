import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

import { CONTENT_SCALE_FACTOR } from "../src/scale9.js";
import { makeTtfLabel, placeTtfLabelInk, ttfInkAnchorOffsetPt } from "../src/labels.js";
import { OUTLINE_FADE_ALPHA, OUTLINE_FADE_BORDER_PT } from "../src/outlineBackgroundMath.js";











describe("makeTtfLabel outline stroke geometry", () => {
  it("doubles the source borderWidth so the visible outward extent equals it", () => {
    const label = makeTtfLabel("Touch To Continue", 30, { outline: true, outlineWidthPt: 2 });
    const stroke = label.style.stroke as { width: number; join: string; color: unknown };

    expect(stroke.width).toBe(2 * 2 * CONTENT_SCALE_FACTOR);
    // Half of the centred stroke shows outside the fill; in point space (the node is scaled by
    // 1 / CONTENT_SCALE_FACTOR) that is exactly the source's 2.0pt borderWidth.
    expect(stroke.width / 2 / CONTENT_SCALE_FACTOR).toBe(2);
  });

  it("keeps the circular dilation's round join rather than Pixi's spiking miter default", () => {
    const label = makeTtfLabel("Shop", 13, {
      outline: true,
      outlineWidthPt: OUTLINE_FADE_BORDER_PT,
    });
    expect((label.style.stroke as { join: string }).join).toBe("round");
  });

  it("applies the same doubling to the 1.0pt title-screen version outline", () => {

    const label = makeTtfLabel("Version 1.1.0", 14, {
      outline: true,
      outlineWidthPt: 1,
      bold: false,
    });
    expect((label.style.stroke as { width: number }).width).toBe(2 * CONTENT_SCALE_FACTOR);
  });

  it("carries the Fade preset's 128/255 opacity into the stroke colour", () => {
    const label = makeTtfLabel("Leave Town", 13, {
      outline: true,
      outlineWidthPt: OUTLINE_FADE_BORDER_PT,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    const stroke = label.style.stroke as { color: string; width: number };
    expect(stroke.width).toBe(OUTLINE_FADE_BORDER_PT * 2 * CONTENT_SCALE_FACTOR);
    expect(String(stroke.color)).toContain(String(OUTLINE_FADE_ALPHA));
  });

  it("draws no stroke at all when the source call site has no outline node", () => {
    const label = makeTtfLabel("Evolves At: 16", 16, { outline: false, bold: false });
    expect(label.style.stroke ?? undefined).toBeUndefined();
  });







  it("leaves a label bare unless the caller opts in", () => {
    const label = makeTtfLabel("Collection Quest", 20);
    expect(label.style.stroke ?? undefined).toBeUndefined();
  });

  it("treats an explicit borderWidth or alpha as the opt-in", () => {
    // Dropping a width the caller spelled out would swap over-outlining for under-outlining.
    const width = makeTtfLabel("Leave Town", 13, { outlineWidthPt: OUTLINE_FADE_BORDER_PT });
    expect((width.style.stroke as { width: number }).width)
      .toBe(OUTLINE_FADE_BORDER_PT * 2 * CONTENT_SCALE_FACTOR);

    const alpha = makeTtfLabel("Leave Town", 13, { outlineAlpha: OUTLINE_FADE_ALPHA });
    expect(String((alpha.style.stroke as { color: string }).color))
      .toContain(String(OUTLINE_FADE_ALPHA));
  });

  it("lets an explicit outline:false override a supplied width", () => {
    const label = makeTtfLabel("Collection Quest", 20, { outline: false, outlineWidthPt: 2 });
    expect(label.style.stroke ?? undefined).toBeUndefined();
  });
});







describe("ttfInkAnchorOffsetPt", () => {
  it("shifts an edge-anchored label outward by exactly the source borderWidth", () => {
    // Cocos (1,1) top-right -> Pixi (1,0): push right and up so the ink's top-right edge lands on
    // the anchored point instead of sitting 2pt inside it.
    expect(ttfInkAnchorOffsetPt(2, { x: 1, y: 0 })).toEqual({ dx: 2, dy: -2 });
    // Cocos (0,1) top-left -> Pixi (0,0).
    expect(ttfInkAnchorOffsetPt(2, { x: 0, y: 0 })).toEqual({ dx: -2, dy: -2 });
    expect(ttfInkAnchorOffsetPt(2, { x: 1, y: 1 })).toEqual({ dx: 2, dy: 2 });
  });

  it("is a no-op for centred labels and for bare ones", () => {
    // Why popup titles and menu items never showed this.
    expect(ttfInkAnchorOffsetPt(2, { x: 0.5, y: 0.5 })).toEqual({ dx: 0, dy: 0 });
    expect(ttfInkAnchorOffsetPt(0, { x: 1, y: 0 })).toEqual({ dx: 0, dy: -0 });
  });

  it("applies that offset through placeTtfLabelInk on a real label", () => {
    // Bounds cannot be measured here (no DOM canvas), and they do not need to be: the offset is
    // size-independent. The measured proof that the ink lands on the point lives in the
    // `tournament-bracket` browser scenario, where a real canvas exists.
    const label = makeTtfLabel("Class", 20, {
      outline: true,
      outlineWidthPt: OUTLINE_FADE_BORDER_PT,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    label.anchor.set(1, 0);
    placeTtfLabelInk(label, 300, 20, OUTLINE_FADE_BORDER_PT);
    expect(label.x).toBe(300 + OUTLINE_FADE_BORDER_PT);
    expect(label.y).toBe(20 - OUTLINE_FADE_BORDER_PT);
  });
});
