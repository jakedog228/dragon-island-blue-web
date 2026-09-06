import { describe, expect, it } from "vitest";
import {
  TOWN_ENTRY_REVEAL_DELAY_MS,
  TOWN_ENTRY_ZOOM_MS,
  TOWN_EXIT_SPRITE_SCALE,
  TOWN_EXIT_ZOOM_MS,
  TOWN_FIELD_FLAGS_FADE_OUT_MS,
  TOWN_FIELD_MENU_FADE_OUT_MS,
  TOWN_FIELD_RESTORE_FADE_MS,
  TOWN_MENU_FADE_MS,
  townBuildingEnabled,
  townBuildingIconOffsetY,
  townBuildingLabelOffsetY,
  townCounterScale,
  townHouseSpriteScale,
  townLabelFontSize,
  townMapZoomTarget,
  townMenuLocalPosition,
  townRelativePointToPixi,
  townWorldZoomTarget,
} from "../src/world/townDisplayMath.js";

describe("townDisplayMath", () => {
  it("pins the source entry, reveal, fade, and departure timings", () => {
    expect(TOWN_ENTRY_ZOOM_MS).toBe(5_000);
    expect(TOWN_ENTRY_REVEAL_DELAY_MS).toBe(1_000);
    expect(TOWN_MENU_FADE_MS).toBe(500);
    expect(TOWN_EXIT_ZOOM_MS).toBe(1_000);
    expect(TOWN_FIELD_MENU_FADE_OUT_MS).toBe(500);
    expect(TOWN_FIELD_FLAGS_FADE_OUT_MS).toBe(500);
    expect(TOWN_FIELD_RESTORE_FADE_MS).toBe(500);
  });

  it("enables the implemented town Guild, character, and monster destinations", () => {
    expect(townBuildingEnabled("TavernMenuItem")).toBe(true);
    expect(townBuildingEnabled("MonsterManagementMenuItem")).toBe(true);
    expect(townBuildingEnabled("MonsterpediaMenuItem")).toBe(true);
    expect(townBuildingEnabled("CharacterDisplayMenuItem")).toBe(true);
    expect(townBuildingEnabled("StoreMenuItem")).toBe(true);
    expect(townBuildingEnabled("TownWarpMenuItem")).toBe(true);
    expect(townBuildingEnabled("BlackMarketMenuItem")).toBe(true);
    expect(townBuildingEnabled(undefined)).toBe(false);
    expect(townBuildingEnabled("ArenaMenuItem")).toBe(true);
  });

  it("pins source town sprite, label, and counter-scale constants", () => {
    expect(townHouseSpriteScale("iphone")).toBeCloseTo(1 / 3);
    expect(townHouseSpriteScale("ipad")).toBeCloseTo(1 / 3);
    expect(townLabelFontSize("iphone")).toBe(13);
    expect(townLabelFontSize("ipad")).toBe(8);
    expect(townBuildingIconOffsetY("iphone")).toBe(15);
    expect(townBuildingIconOffsetY("ipad")).toBe(15);
    expect(TOWN_EXIT_SPRITE_SCALE).toBe(0.25);
    expect(townCounterScale(3)).toBeCloseTo(1 / 3);
    expect(townBuildingLabelOffsetY(18)).toBe(3);
  });

  it("converts source-relative building geometry into Pixi coordinates", () => {
    expect(townRelativePointToPixi({ x: 5, y: -43 }, "iphone")).toEqual({ x: 5, y: 43 });
    expect(townRelativePointToPixi({ x: -58, y: 0 }, "iphone")).toEqual({ x: -58, y: -0 });
    expect(townRelativePointToPixi({ x: 5, y: -43 }, "ipad")).toEqual({ x: 5, y: 43 });
    expect(townRelativePointToPixi({ x: -58, y: 0 }, "ipad")).toEqual({ x: -58, y: -0 });
  });

  it("centers an in-bounds authored town focus", () => {
    expect(townMapZoomTarget({ w: 480, h: 320 }, { x: 231, y: 242 }, 3)).toEqual({
      pivot: { x: 231, y: 242 },
      position: { x: 240, y: 160 },
      scale: 3,
    });
  });

  it("clamps edge towns so zooming cannot reveal outside the world rectangle", () => {
    expect(townMapZoomTarget({ w: 480, h: 320 }, { x: 10, y: 310 }, 3)).toEqual({
      pivot: { x: 80, y: 320 - 320 / 6 },
      position: { x: 240, y: 160 },
      scale: 3,
    });
    expect(townMapZoomTarget({ w: 512, h: 384 }, { x: 10, y: 370 }, 3)).toEqual({
      pivot: { x: 512 / 6, y: 320 },
      position: { x: 256, y: 192 },
      scale: 3,
    });
    // Capital City is only edge-clamped if the normal iPad map's (16,32) placement participates.
    expect(townMapZoomTarget(
      { w: 512, h: 384 },
      { x: 345, y: 84 },
      2,
      { x: 16, y: 32 },
    )).toEqual({
      pivot: { x: 345, y: 84 },
      position: { x: 256, y: 192 },
      scale: 2,
    });
    // Secret City uses the phone Underworld map top (-17,-25) and a POI position flipped through
    // the full 384pt map height. Clamp in scene space, then return a map-local pivot. The composed
    // scene focus remains 56pt and therefore preserves the source whole-world zoom target.
    expect(townMapZoomTarget(
      { w: 480, h: 320 },
      { x: 195, y: 81 },
      2,
      { x: -17, y: -25 },
    )).toEqual({
      pivot: { x: 195, y: 105 },
      position: { x: 240, y: 160 },
      scale: 2,
    });
  });

  it("expresses the source's direct whole-world move target with a fixed zero pivot", () => {
    expect(townWorldZoomTarget(
      { w: 512, h: 384 },
      { x: 345, y: 84 },
      2,
      { x: 16, y: 32 },
    )).toEqual({
      pivot: { x: 0, y: 0 },
      position: { x: -466, y: -40 },
      scale: 2,
    });
  });

  it("places the distinct counter-scaled town menu in POI-local coordinates", () => {
    expect(townMenuLocalPosition({ w: 480, h: 320 }, "iphone", 3))
      .toEqual({ x: -80, y: -320 / 6 });
    expect(townMenuLocalPosition({ w: 480, h: 320 }, "iphone", 2, { x: 0, y: -30 }))
      .toEqual({ x: -120, y: -50 });
    expect(townMenuLocalPosition({ w: 512, h: 384 }, "ipad", 2, { x: 0, y: -30 }))
      .toEqual({ x: -128, y: -81 });
  });
});
