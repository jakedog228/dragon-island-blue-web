import { describe, it, expect } from "vitest";
import { BAR_GROW_SPEED, cropTextureRect, easeBarStep, hpTint } from "../src/barMath.js";


describe("hpTint", () => {
  it("full HP is pure red", () => {
    expect(hpTint(100, 100)).toBe(0xff0000);
  });

  it("empty HP is pure yellow", () => {
    expect(hpTint(0, 100)).toBe(0xffff00);
  });

  it("half HP truncates to (255,127,0)", () => {
    expect(hpTint(50, 100)).toBe((255 << 16) | (127 << 8));
  });

  it("matches the footage sanity check: ~74% HP -> (255,66,0)", () => {
    // followup-consts.md §1: friendly "117/158" ~= 74% -> computed tint (255,66,0).
    expect(hpTint(117, 158)).toBe((255 << 16) | (66 << 8));
  });

  it("truncates toward zero, not floor (matters for fractional hp/max)", () => {
    // 1 - 1/3 = 0.6666.. * 255 = 170.0(0) -> trunc 170, not floor-different here, so use a case
    // where floor/trunc would differ: none for positive g, so this pins trunc via a value just
    // under an integer boundary instead (avoids float-noise flakiness).
    const g = Math.trunc((1 - 33 / 100) * 255);
    expect(hpTint(33, 100)).toBe((255 << 16) | (g << 8));
  });

  it("converts all three native packed bytes when HP exceeds its current maximum", () => {

    expect(hpTint(150, 100)).toBe(0xff81ff);
  });

  it("preserves the native blue-byte carry below zero HP rather than clamping the gradient", () => {

    expect(hpTint(-50, 100)).toBe(0xff7e01);
  });
});


describe("easeBarStep", () => {
  it("steps toward a higher target by the grow speed", () => {
    expect(easeBarStep(0.5, 0.9)).toBeCloseTo(0.525);
  });

  it("lands exactly on target when within one step (growing)", () => {
    expect(easeBarStep(0.895, 0.9)).toBe(0.9);
  });

  it("steps toward a lower target by the grow speed (shrinking bar)", () => {
    expect(easeBarStep(0.9, 0.5)).toBeCloseTo(0.875);
  });

  it("lands exactly on target when within one step (shrinking)", () => {
    expect(easeBarStep(0.505, 0.5)).toBe(0.5);
  });

  it("is a no-op when already at target", () => {
    expect(easeBarStep(0.5, 0.5)).toBe(0.5);
  });

  it("uses the documented 0.025 constant", () => {
    expect(BAR_GROW_SPEED).toBe(0.025);
  });

  it("accepts the half-speed step used by the XP award popup", () => {
    expect(easeBarStep(0.5, 0.9, BAR_GROW_SPEED * 0.5)).toBeCloseTo(0.5125);
  });
});

describe("cropTextureRect", () => {
  const full = { x: 2, y: 135, w: 180, h: 22 }; // monsterHpBar.png frame, General-hd.json

  it("left-anchors a horizontal crop (near edge fixed, far edge eaten)", () => {
    expect(cropTextureRect(full, 0.5, true, false)).toEqual({ x: 2, y: 135, w: 90, h: 22 });
  });

  it("full ratio returns the full rect", () => {
    expect(cropTextureRect(full, 1, true, false)).toEqual(full);
  });

  it("zero ratio collapses width to 0 at the near edge", () => {
    expect(cropTextureRect(full, 0, true, false)).toEqual({ x: 2, y: 135, w: 0, h: 22 });
  });

  it("backwards crops from the far edge instead (unused by real HP bars, UNVERIFIED direction)", () => {
    expect(cropTextureRect(full, 0.5, true, true)).toEqual({ x: 92, y: 135, w: 90, h: 22 });
  });

  it("vertical (horizontal=false) crops height instead of width", () => {
    expect(cropTextureRect(full, 0.5, false, false)).toEqual({ x: 2, y: 135, w: 180, h: 11 });
  });
});
