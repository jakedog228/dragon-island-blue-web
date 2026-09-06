import { describe, expect, it } from "vitest";
import {
  HERO_FLASH_PERIOD_MS,
  HERO_REVEAL_OPACITY,
  HERO_SHADER_UPDATE_MS,
  heroFlashOpacity,
  heroRevealRect,
} from "../src/battle/heroDisplayMath.js";

describe("HeroDisplay readiness presentation", () => {
  it("covers bottom-up and reveals the portrait top-first", () => {
    expect(heroRevealRect(0, true, 79, 96)).toEqual({ x: 0, y: 0, w: 79, h: 96, percent: 1 });
    expect(heroRevealRect(0.25, true, 79, 96)).toEqual({ x: 0, y: 24, w: 79, h: 72, percent: 0.75 });
    expect(heroRevealRect(1, true, 79, 96)).toEqual({ x: 0, y: 96, w: 79, h: 0, percent: 0 });
    expect(heroRevealRect(1, false, 79, 96)).toEqual({ x: 0, y: 0, w: 79, h: 96, percent: 1 });
  });

  it("pins the source cadence, opacity, and triangular ready flash", () => {
    expect(HERO_SHADER_UPDATE_MS).toBe(Math.fround(0.3) * 1000);
    expect(HERO_REVEAL_OPACITY).toBe(100 / 255);
    expect(HERO_FLASH_PERIOD_MS).toBe(1500);
    expect(heroFlashOpacity(0)).toBe(0);
    expect(heroFlashOpacity(375)).toBe(127 / 255);
    expect(heroFlashOpacity(750)).toBe(1);
    expect(heroFlashOpacity(1125)).toBe(127 / 255);
    expect(heroFlashOpacity(1500)).toBe(0);
  });
});
