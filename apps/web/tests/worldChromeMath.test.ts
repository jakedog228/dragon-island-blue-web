import { describe, expect, it } from "vitest";
import {
  WORLD_HERO_XP_AUTO_CLOSE_MS,
  WORLD_HERO_XP_TOGGLE_MS,
  WORLD_NAME_PLATE_FADE_IN_MS,
  WORLD_NAME_PLATE_FADE_OUT_MS,
  WORLD_NAME_PLATE_HOLD_MS,
  heroXpForLevel,
  heroXpPercent,
  namePlateLayout,
  worldHeroXpBarPosition,
  worldHeroXpCollapsedX,
  worldHeroXpFontSize,
  worldHeroXpLabelGap,
  worldMenuPosition,
  worldNamePlateAlpha,
  worldNamePlatePlacement,
} from "../src/world/worldChromeMath.js";

describe("world chrome source facts", () => {
  it("pins the HeroData curve and percent boundaries", () => {
    expect([1, 2, 5, 12].map(heroXpForLevel)).toEqual([0, 8, 68, 515]);


    expect(heroXpPercent(12, 516)).toBeCloseTo(1 / 105);
    expect(heroXpPercent(12, 567)).toBeCloseTo(0.5);
    expect(heroXpPercent(11, 515)).toBe(1);
    expect(() => heroXpPercent(12, 515)).toThrow(/outside level 12/);
    expect(() => heroXpForLevel(0)).toThrow(/positive integer/);
  });

  it("normalizes every HeroXpNode idiom pair and bare gap independently", () => {
    expect(worldHeroXpBarPosition("iphone")).toEqual({ x: 41, y: 18 });
    expect(worldHeroXpBarPosition("ipad")).toEqual({ x: 41, y: 18 });
    expect(worldHeroXpFontSize("iphone")).toBe(10);
    expect(worldHeroXpFontSize("ipad")).toBe(9);
    expect(worldHeroXpLabelGap("iphone")).toBe(2);
    expect(worldHeroXpLabelGap("ipad")).toBe(1);
    expect(worldHeroXpCollapsedX("iphone", 122.5)).toBe(-86.5);
    expect(worldHeroXpCollapsedX("ipad", 122.5)).toBe(-86.5);
    expect({ autoClose: WORLD_HERO_XP_AUTO_CLOSE_MS, toggle: WORLD_HERO_XP_TOGGLE_MS })
      .toEqual({ autoClose: 1500, toggle: 500 });
  });

  it("moves only a normal iPad world's menu into its border opening", () => {
    expect(worldMenuPosition("iphone", false)).toEqual({ x: 0, y: 0 });
    expect(worldMenuPosition("ipad", false)).toEqual({ x: 18, y: 34 });
    expect(worldMenuPosition("ipad", true)).toEqual({ x: 0, y: 0 });
  });

  it("converts both source name-plate modes in both display tiers", () => {
    expect(namePlateLayout("iphone", { w: 147, h: 39 }, "lower-right")).toEqual({
      position: { x: 278.9, y: 259.3 },
      size: { w: 191.1, h: 50.7 },
      fontSize: 14,
    });
    expect(namePlateLayout("ipad", { w: 147, h: 39 }, "lower-right")).toEqual({
      position: { x: 315.9, y: 328.3 },
      size: { w: 191.1, h: 50.7 },
      fontSize: 10,
    });
    const phoneUpper = namePlateLayout("iphone", { w: 147, h: 39 }, "upper-inset");
    expect(phoneUpper.position.x).toBeCloseTo(87.8);
    expect(phoneUpper).toMatchObject({
      position: { y: 10 },
      size: { w: 191.1, h: 50.7 },
      fontSize: 14,
    });
    const padUpper = namePlateLayout("ipad", { w: 147, h: 39 }, "upper-inset");
    expect(padUpper.position.x).toBeCloseTo(124.8);
    expect(padUpper).toMatchObject({
      position: { y: 5 },
      size: { w: 191.1, h: 50.7 },
      fontSize: 10,
    });
    expect({
      fadeIn: WORLD_NAME_PLATE_FADE_IN_MS,
      hold: WORLD_NAME_PLATE_HOLD_MS,
      fadeOut: WORLD_NAME_PLATE_FADE_OUT_MS,
    }).toEqual({ fadeIn: 1000, hold: 2000, fadeOut: 1000 });
    expect([0, 500, 1000, 2999, 3500, 4000].map(worldNamePlateAlpha))
      .toEqual([0, 0.5, 1, 1, 0.5, 0]);
  });

  it("selects the source mode from the arrival POI and transition path", () => {
    // Northern Alvalon's southern entrance: cardinal slide tests only y<height/2, so the source
    // puts this title in the upper inset rather than the port's former fixed lower-right corner.
    expect(worldNamePlatePlacement("iphone", { x: 317, y: 23 }, "slide-end"))
      .toBe("upper-inset");
    expect(worldNamePlatePlacement("ipad", { x: 317, y: 23 }, "slide-end"))
      .toBe("upper-inset");
    expect(worldNamePlatePlacement("iphone", { x: 459, y: 297 }, "slide-end"))
      .toBe("lower-right");
    expect(worldNamePlatePlacement("iphone", { x: 317, y: 23 }, "delayed-entry"))
      .toBe("lower-right");

    // Delayed/fade entry requires BOTH x<width/2 and y<height/3. Comparisons are strict.
    expect(worldNamePlatePlacement("iphone", { x: 239.9, y: 106.6 }, "delayed-entry"))
      .toBe("upper-inset");
    expect(worldNamePlatePlacement("iphone", { x: 240, y: 20 }, "delayed-entry"))
      .toBe("lower-right");
    expect(worldNamePlatePlacement("iphone", { x: 20, y: 320 / 3 }, "delayed-entry"))
      .toBe("lower-right");
    expect(worldNamePlatePlacement("ipad", { x: 255.9, y: 127.9 }, "delayed-entry"))
      .toBe("upper-inset");
    expect(worldNamePlatePlacement("ipad", { x: 256, y: 20 }, "delayed-entry"))
      .toBe("lower-right");
    expect(worldNamePlatePlacement("ipad", { x: 20, y: 128 }, "delayed-entry"))
      .toBe("lower-right");
  });
});
