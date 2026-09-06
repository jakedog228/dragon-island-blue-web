import { describe, expect, it } from "vitest";
import {
  WORLD_ADJACENT_MOVE_MS,
  WORLD_BATTLE_ZOOM_MS,
  WORLD_CARDINAL_SLIDE_MS,
  WORLD_HERO_SCALE,
  WORLD_IPAD_BORDER_TEXTURE_RECT_PX,
  WORLD_IPAD_MAP_INSET_SOURCE_PT,
  WORLD_RETURN_FADE_MS,
  WORLD_STATE_SPRITE_SCALE,
  WORLD_TELEPORT_FADE_IN_MS,
  WORLD_TELEPORT_FADE_OUT_MS,
  WORLD_WALK_FRAME_MS,
  cardinalWorldSlideDelta,
  isTownPortalOutgoingScene,
  worldBattleZoomTransform,
  isCardinalWorldStep,
  worldMapSizePt,
  worldMapSpriteSizePt,
  worldMapIndentToPixi,
  worldMapPositionToPixi,
  worldMapTextureRect,
  worldPoiPointToPixi,
  worldPoiPointToPort,
  worldPoiPointToScenePixi,
  worldSettledDirection,
  worldTransitionPresentation,
  worldWalkDirection,
  worldWalkFrameName,
} from "../src/world/worldDisplayMath.js";

describe("world display facts", () => {
  it("accepts both source MasterMenu origins for the direct Town Portal transition", () => {
    expect(isTownPortalOutgoingScene("world")).toBe(true);
    expect(isTownPortalOutgoingScene("dungeon")).toBe(true);
    expect(isTownPortalOutgoingScene("battle")).toBe(false);
    expect(isTownPortalOutgoingScene(undefined)).toBe(false);
  });

  it("crops the POT maps to the source device rectangles", () => {
    expect(worldMapTextureRect("iphone")).toEqual({ x: 0, y: 0, w: 960, h: 640 });
    expect(worldMapTextureRect("ipad")).toEqual({ x: 0, y: 0, w: 960, h: 640 });
    expect(worldMapTextureRect("iphone", true)).toEqual({ x: 0, y: 0, w: 1024, h: 768 });
    expect(worldMapTextureRect("ipad", true)).toEqual({ x: 0, y: 0, w: 1024, h: 768 });
    expect(WORLD_IPAD_BORDER_TEXTURE_RECT_PX).toEqual({ x: 0, y: 0, w: 1024, h: 768 });
    expect(worldMapSizePt("iphone")).toEqual({ w: 480, h: 320 });
    expect(worldMapSizePt("ipad")).toEqual({ w: 512, h: 384 });
    expect(worldMapSpriteSizePt("iphone")).toEqual({ w: 480, h: 320 });
    expect(worldMapSpriteSizePt("ipad")).toEqual({ w: 480, h: 320 });
    expect(worldMapSpriteSizePt("iphone", true)).toEqual({ w: 512, h: 384 });
    expect(worldMapSpriteSizePt("ipad", true)).toEqual({ w: 512, h: 384 });
    expect(worldMapIndentToPixi({ x: -17, y: -39 }, "iphone")).toEqual({ x: -17, y: 39 });
    expect(worldMapIndentToPixi({ x: -17, y: -39 }, "ipad")).toEqual({ x: 0, y: 0 });
    expect(WORLD_IPAD_MAP_INSET_SOURCE_PT).toEqual({ x: 32, y: 64 });
    expect(worldMapPositionToPixi(undefined, "iphone")).toEqual({ x: 0, y: 0 });
    expect(worldMapPositionToPixi(undefined, "ipad")).toEqual({ x: 16, y: 32 });
    expect(worldMapPositionToPixi({ x: -17, y: -39 }, "iphone")).toEqual({ x: -17, y: -25 });
    expect(worldMapPositionToPixi({ x: -17, y: -39 }, "ipad")).toEqual({ x: 0, y: 0 });
  });

  it("normalizes the source iPad x2 POI multiplier back into the shared point space", () => {
    expect(worldPoiPointToPort({ x: 52, y: 46 }, "iphone")).toEqual({ x: 52, y: 46 });
    expect(worldPoiPointToPort({ x: 52, y: 46 }, "ipad")).toEqual({ x: 52, y: 46 });
    expect(worldPoiPointToPixi({ x: 52, y: 46 }, "iphone")).toEqual({ x: 52, y: 274 });
    expect(worldPoiPointToPixi({ x: 52, y: 46 }, "ipad")).toEqual({ x: 52, y: 274 });
    expect(worldPoiPointToScenePixi({ x: 52, y: 46 }, "iphone")).toEqual({ x: 52, y: 274 });
    expect(worldPoiPointToScenePixi({ x: 52, y: 46 }, "ipad")).toEqual({ x: 68, y: 306 });
    expect(worldPoiPointToPixi({ x: 52, y: 46 }, "iphone", true)).toEqual({ x: 52, y: 338 });
    expect(worldPoiPointToPixi({ x: 52, y: 46 }, "ipad", true)).toEqual({ x: 52, y: 338 });
    expect(worldPoiPointToScenePixi({ x: 52, y: 46 }, "iphone", { x: -17, y: -39 })).toEqual({
      x: 35,
      y: 313,
    });
    expect(worldPoiPointToScenePixi({ x: 52, y: 46 }, "ipad", { x: -17, y: -39 })).toEqual({
      x: 52,
      y: 338,
    });
    // UnderWorld's 384pt map is 64pt taller than the phone viewport. Its map-local POI and
    // top-left map placement must compose to the native global result: 320 - (-39 + 46) = 313.
    const underworldMap = worldMapPositionToPixi({ x: -17, y: -39 }, "iphone");
    const underworldPoi = worldPoiPointToPixi({ x: 52, y: 46 }, "iphone", true);
    expect({
      x: underworldMap.x + underworldPoi.x,
      y: underworldMap.y + underworldPoi.y,
    }).toEqual({ x: 35, y: 313 });
    expect(WORLD_STATE_SPRITE_SCALE).toBe(0.5);
  });

  it("pins source movement/transition durations and marker scale", () => {
    expect({
      adjacent: WORLD_ADJACENT_MOVE_MS,
      fadeOut: WORLD_TELEPORT_FADE_OUT_MS,
      fadeIn: WORLD_TELEPORT_FADE_IN_MS,
      frame: WORLD_WALK_FRAME_MS,
      zoom: WORLD_BATTLE_ZOOM_MS,
      returnFade: WORLD_RETURN_FADE_MS,
      slide: WORLD_CARDINAL_SLIDE_MS,
    }).toEqual({
      adjacent: 250,
      fadeOut: 250,
      fadeIn: 500,
      frame: 100,
      zoom: 2000,
      returnFade: 500,
      slide: 1000,
    });
    expect(WORLD_HERO_SCALE).toEqual({ x: 0.8, y: 0.7 });
  });

  it("selects dominant-axis source walk frames", () => {
    expect(worldWalkDirection({ x: 0, y: 0 }, { x: 9, y: 2 })).toBe("right");
    expect(worldWalkDirection({ x: 0, y: 0 }, { x: -9, y: 2 })).toBe("left");
    expect(worldWalkDirection({ x: 0, y: 0 }, { x: 2, y: -9 })).toBe("front");
    expect(worldWalkDirection({ x: 0, y: 0 }, { x: 2, y: 9 })).toBe("back");
    expect(worldSettledDirection({ x: 0, y: 0 }, { x: 9, y: 2 }, "walk", "front"))
      .toBe("right");
    expect(worldSettledDirection({ x: 0, y: 0 }, { x: 9, y: 2 }, "teleport", "back"))
      .toBe("back");
    expect(worldWalkFrameName("front", 8)).toBe("herowalkFront_8.png");
    expect(() => worldWalkFrameName("left", 0)).toThrow(/\[1,8\]/);
  });

  it("derives cardinal slides and routes every other valid world-name pair through the source fade", () => {
    expect(isCardinalWorldStep("World_3-1", "World_3-2")).toBe(true);
    expect(isCardinalWorldStep("World_3-1", "World_2-1")).toBe(true);
    expect(isCardinalWorldStep("World_3-1", "World_4-2")).toBe(false);
    expect(cardinalWorldSlideDelta("World_3-1", "World_3-2", "iphone")).toEqual({ x: 0, y: -320 });
    expect(cardinalWorldSlideDelta("World_3-1", "World_2-1", "ipad")).toEqual({ x: -512, y: 0 });
    expect(cardinalWorldSlideDelta("UnderWorld_1-1", "World_1-1", "iphone")).toBeNull();
    expect(worldTransitionPresentation("World_4-1", "World_5-1", "iphone")).toEqual({
      kind: "cardinal-slide",
      delta: { x: 480, y: 0 },
    });
    expect(worldTransitionPresentation("World_1-1", "World_5-1", "iphone"))
      .toEqual({ kind: "fade" });
    expect(worldTransitionPresentation("World_4-2", "World_5-1", "ipad"))
      .toEqual({ kind: "fade" });
    expect(worldTransitionPresentation("ModWorld_1-1", "ModWorld_1-2", "iphone"))
      .toEqual({ kind: "fade" });
  });

  it("derives the clamped 2x encounter zoom in both display tiers", () => {
    expect(worldBattleZoomTransform({ x: 166, y: 60 }, "iphone")).toEqual({
      pivot: { x: 240, y: 160 },
      focus: { x: 166, y: 240 },
      finalPosition: { x: 388, y: 0 },
      scale: 2,
      zoomAndFadeInMs: 1320,
      fadeOutMs: 660,
    });
    expect(worldBattleZoomTransform({ x: 166, y: 60 }, "ipad")).toEqual({
      pivot: { x: 256, y: 192 },
      focus: { x: 182, y: 288 },
      finalPosition: { x: 404, y: 0 },
      scale: 2,
      zoomAndFadeInMs: 1320,
      fadeOutMs: 660,
    });
    expect(worldBattleZoomTransform({ x: 166, y: 60 }, "iphone", { x: -17, y: -39 })).toEqual({
      pivot: { x: 240, y: 160 },
      focus: { x: 149, y: 240 },
      finalPosition: { x: 422, y: 0 },
      scale: 2,
      zoomAndFadeInMs: 1320,
      fadeOutMs: 660,
    });
  });
});
