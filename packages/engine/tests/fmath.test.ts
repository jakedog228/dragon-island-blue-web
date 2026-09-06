import { describe, it, expect } from "vitest";
import { applyMod } from "../src/fmath.js";


describe("applyMod", () => {
  it("returns a unchanged when b is 0", () => {
    expect(applyMod(50, 0)).toBe(50);
  });

  it("scales up for positive b: a*(1+b)", () => {
    expect(applyMod(50, 0.5)).toBe(75);
  });

  it("scales down for negative b: a/(1-b)", () => {
    expect(applyMod(50, -0.5)).toBeCloseTo(33.333333, 5);
  });

  it("matches the initialBattleDelay base-term anchor: applyMod(100, -1) = 50", () => {
    // speed=300 -> b = -speed/300 = -1 -> applyMod(100,-1) = 100/(1-(-1)) = 50
    expect(applyMod(100, -1)).toBe(50);
  });

  it("matches the abilityTimeCost anchor: applyMod(400, 0.5) = 600", () => {
    expect(applyMod(400, 0.5)).toBe(600);
  });

  it("matches the abilityTimeCost anchor: applyMod(400, -0.5) ~ 266.67 (pre-trunc)", () => {
    expect(applyMod(400, -0.5)).toBeCloseTo(266.666667, 4);
  });
});
