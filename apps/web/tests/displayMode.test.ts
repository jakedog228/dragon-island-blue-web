import { describe, it, expect } from "vitest";
import {
  screenPointsForMode,
  stagePixelsForMode,
  combatBackgroundSpriteKey,
  idiomPairPt,
  roundSourcePoint,
  sourcePointsPerPortPoint,
  truncateSourcePoint,
  unscaledIdiomPt,
} from "../src/displayMode.js";
import { DISPLAY_MODE, TEXT_RESOLUTION_MODE } from "../src/runtimeSettings.js";
import { SCREEN_W, SCREEN_H, ENEMY_SLOT_HEIGHT } from "../src/battle/displayShared.js";

// Persisted display selection: pure size math plus the boot-time invariants the rest of the suite
// (and the browser scenario coordinate math) relies on.

describe("screenPointsForMode / stagePixelsForMode", () => {
  it("iphone: 480x320 points on a 960x640 stage (the RE'd tier)", () => {
    expect(screenPointsForMode("iphone")).toEqual({ w: 480, h: 320 });
    expect(stagePixelsForMode("iphone")).toEqual({ w: 960, h: 640 });
  });

  it("ipad: 512x384 points on a 1024x768 stage (1024x768-pt CSF-1 idiom folded into CSF-2 point space)", () => {
    expect(screenPointsForMode("ipad")).toEqual({ w: 512, h: 384 });
    expect(stagePixelsForMode("ipad")).toEqual({ w: 1024, h: 768 });
  });

  it("stage pixels are always points x CONTENT_SCALE_FACTOR(2)", () => {
    for (const mode of ["iphone", "ipad"] as const) {
      const pt = screenPointsForMode(mode);
      expect(stagePixelsForMode(mode)).toEqual({ w: pt.w * 2, h: pt.h * 2 });
    }
  });
});

describe("unscaledIdiomPt", () => {


  it("passes literals through unchanged in iphone mode", () => {
    expect(unscaledIdiomPt(5, "iphone")).toBe(5);
    expect(unscaledIdiomPt(20, "iphone")).toBe(20);
  });

  it("halves bare literals in ipad mode (L iPad-pt = L/2 normalized pt)", () => {
    expect(unscaledIdiomPt(5, "ipad")).toBe(2.5);
    expect(unscaledIdiomPt(20, "ipad")).toBe(10);
    expect(unscaledIdiomPt(2, "ipad")).toBe(1);
  });
});

describe("idiomPairPt", () => {
  it("selects in source-native coordinates before normalizing", () => {
    expect(idiomPairPt(75, 172, "iphone")).toBe(75);
    expect(idiomPairPt(75, 172, "ipad")).toBe(86);
    expect(idiomPairPt(14, 20, "ipad")).toBe(10);
  });

  it("keeps exactly doubled pairs at the same normalized size", () => {
    expect(idiomPairPt(30, 60, "iphone")).toBe(30);
    expect(idiomPairPt(30, 60, "ipad")).toBe(30);
  });
});

describe("source-device rounding", () => {
  it("rounds in native Cocos coordinates before normalizing iPad results", () => {
    expect(sourcePointsPerPortPoint("iphone")).toBe(1);
    expect(sourcePointsPerPortPoint("ipad")).toBe(2);
    expect(roundSourcePoint(6.5, "iphone")).toBe(7);
    expect(roundSourcePoint(6.5, "ipad")).toBe(6.5);
    expect(roundSourcePoint(42.666666, "ipad")).toBe(42.5);
    expect(truncateSourcePoint(67.5, "iphone")).toBe(67);
    expect(truncateSourcePoint(64.75, "ipad")).toBe(64.5);
  });

  it("matches roundf's halfway-away-from-zero behavior", () => {
    expect(roundSourcePoint(-2.5, "iphone")).toBe(-3);
    expect(roundSourcePoint(-1.25, "ipad")).toBe(-1.5);
  });
});

describe("combatBackgroundSpriteKey", () => {
  it("maps the encounter data's file-name vocabulary to manifest keys", () => {
    expect(combatBackgroundSpriteKey("ForestCombat.png")).toBe("ForestCombat");
    expect(combatBackgroundSpriteKey("CaveCombat.png")).toBe("CaveCombat");
  });

  it("fails loudly outside the <Biome>Combat.png vocabulary (config typo guard)", () => {
    expect(() => combatBackgroundSpriteKey("forestBackground-hd")).toThrow(/combat background/);
    expect(() => combatBackgroundSpriteKey("ForestCombat")).toThrow(/combat background/);
    expect(() => combatBackgroundSpriteKey("Forest Combat.png")).toThrow(/combat background/);
  });
});

describe("runtimeSettings.ts invariants", () => {
  // The active value comes from persisted Options state; don't pin a specific mode here.
  it("the configured mode is a supported display mode", () => {
    expect(["iphone", "ipad"]).toContain(DISPLAY_MODE);
  });

  it("the configured text resolution mode is original or modern", () => {
    expect(["original", "modern"]).toContain(TEXT_RESOLUTION_MODE);
  });

  it("displayShared's SCREEN constants follow the configured mode", () => {
    expect({ w: SCREEN_W, h: SCREEN_H }).toEqual(screenPointsForMode(DISPLAY_MODE));
    // The winSize-derived enemy slot height ("winSize minus 90/180 and 20/40",
    // team-displays.md §2) — 210 on the default 320pt-tall screen.
    expect(ENEMY_SLOT_HEIGHT).toBe(SCREEN_H - 90 - 20);
  });
});
