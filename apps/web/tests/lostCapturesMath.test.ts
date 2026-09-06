import { describe, expect, it } from "vitest";
import { lostCaptureFitBox, lostCaptureNodeScale } from "../src/battle/lostCapturesMath.js";


const W = 480;
const H = 320;

describe("showLostCaptures fit box (0xe59fe-0xe5a18)", () => {
  it("caps width at a fixed third of the screen regardless of capture count", () => {
    expect(lostCaptureFitBox(1, W, H).maxWidth).toBe(160);
    expect(lostCaptureFitBox(2, W, H).maxWidth).toBe(160);
    expect(lostCaptureFitBox(5, W, H).maxWidth).toBe(160);
  });

  it("divides the height cap by TWICE the capture count (the asymmetric divisor is real)", () => {
    expect(lostCaptureFitBox(1, W, H).maxHeight).toBe(160);
    expect(lostCaptureFitBox(2, W, H).maxHeight).toBe(80);
    expect(lostCaptureFitBox(3, W, H).maxHeight).toBeCloseTo(320 / 6, 10);
  });

  it("rejects an empty row — the source returns before building any content", () => {
    expect(() => lostCaptureFitBox(0, W, H)).toThrow(/at least one capture/);
  });
});

describe("showLostCaptures node scale (sub_65d50 @ 0x65d50)", () => {
  it("never upscales past 1.0 (vmin.f32 against the 1.0f immediate @ 0x65dcc)", () => {
    // 40x40 art fits inside the single-capture 160x160 box more than twice over.
    expect(lostCaptureNodeScale(40, 40, 1, W, H)).toBe(1);
  });

  it("shrinks on whichever axis binds first", () => {
    // 2 captures -> box 160x80. A 320x80 sprite is width-bound: 160/320 = 0.5.
    expect(lostCaptureNodeScale(320, 80, 2, W, H)).toBeCloseTo(0.5, 10);
    // A 160x160 sprite in the same box is height-bound: 80/160 = 0.5.
    expect(lostCaptureNodeScale(160, 160, 2, W, H)).toBeCloseTo(0.5, 10);
    // 4 captures -> box 160x40; a 200x200 sprite is height-bound: 40/200 = 0.2.
    expect(lostCaptureNodeScale(200, 200, 4, W, H)).toBeCloseTo(0.2, 10);
  });

  it("keeps shrinking as more captures are forfeited, at a constant width cap", () => {
    const scales = [1, 2, 3, 4].map((count) => lostCaptureNodeScale(200, 200, count, W, H));
    for (let i = 1; i < scales.length; i += 1) {
      expect(scales[i]!).toBeLessThan(scales[i - 1]!);
    }
  });
});
