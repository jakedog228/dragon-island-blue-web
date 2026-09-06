import { describe, expect, it } from "vitest";
import {
  INFINITE_DUNGEON_UNLOCK_BACKING_CONFIG,
  INFINITE_DUNGEON_UNLOCK_BACKING_Z,
  INFINITE_DUNGEON_UNLOCK_LABEL_DELAY_MS,
  INFINITE_DUNGEON_UNLOCK_LABEL_FADE_MS,
  INFINITE_DUNGEON_UNLOCK_LABEL_Z,
  formatDungeonLocalizedName,
  formatInfiniteDungeonUnlock,
  infiniteDungeonUnlockLabelFont,
  infiniteDungeonUnlockLabelLayout,
} from "../src/dungeon/dungeonHudMath.js";
import { screenPointsForMode } from "../src/displayMode.js";

describe("dungeon name plate text", () => {
  it("uses Dungeon.localizedName's exact localized level/name argument order", () => {
    expect(formatDungeonLocalizedName("North Cave", 1, "Lv")).toBe("Lv:1 North Cave");
    expect(formatDungeonLocalizedName("The Abyss", 211, "Lv")).toBe("Lv:211 The Abyss");
  });

  it("rejects invalid display inputs instead of fabricating a floor label", () => {
    expect(() => formatDungeonLocalizedName("", 1, "Lv")).toThrow(/localized name/);
    expect(() => formatDungeonLocalizedName("North Cave", 0, "Lv")).toThrow(/positive integer/);
    expect(() => formatDungeonLocalizedName("North Cave", 1, "")).toThrow(/level label/);
  });
});

describe("Abyss unlock label text", () => {
  it("substitutes the single %d of InfiniteDungeonUnlockFormatKey with the threshold", () => {
    const template = "Next bonus at floor: %d";
    expect(formatInfiniteDungeonUnlock(template, 10)).toBe("Next bonus at floor: 10");
    expect(formatInfiniteDungeonUnlock(template, 220)).toBe("Next bonus at floor: 220");
  });

  it("refuses a template or floor the source's single-vararg call could not have produced", () => {
    expect(() => formatInfiniteDungeonUnlock("Next bonus at floor", 10)).toThrow(/exactly one %d/);
    expect(() => formatInfiniteDungeonUnlock("%d of %d", 10)).toThrow(/exactly one %d/);
    expect(() => formatInfiniteDungeonUnlock("floor %d", 0)).toThrow(/positive integer/);
    expect(() => formatInfiniteDungeonUnlock("floor %d", 1.5)).toThrow(/positive integer/);
  });
});

describe("Abyss unlock label geometry", () => {
  it("keeps the source's action and z constants", () => {
    expect(INFINITE_DUNGEON_UNLOCK_LABEL_DELAY_MS).toBe(2000);
    expect(INFINITE_DUNGEON_UNLOCK_LABEL_FADE_MS).toBe(2000);

    expect(INFINITE_DUNGEON_UNLOCK_LABEL_Z).toBe(10);
    expect(INFINITE_DUNGEON_UNLOCK_BACKING_Z).toBe(-9);
    expect(INFINITE_DUNGEON_UNLOCK_BACKING_CONFIG).toBe("PopupBackgroundThin");
  });

  it("classifies each literal by idiom: the font size is a table pair, the widths are bare", () => {


    expect(infiniteDungeonUnlockLabelFont("iphone")).toEqual({ fontSizePt: 16, outlineWidthPt: 2 });
    expect(infiniteDungeonUnlockLabelFont("ipad")).toEqual({ fontSizePt: 16, outlineWidthPt: 1 });
    // The bare `2.0` border and the bare `10.0` inset have no iPad branch, so they measure half as
    // much against the iPad's bigger point canvas.
    expect(infiniteDungeonUnlockLabelLayout("iphone", { w: 100, h: 20 }).insetPt).toBe(10);
    expect(infiniteDungeonUnlockLabelLayout("ipad", { w: 100, h: 20 }).insetPt).toBe(5);
  });

  it("reproduces the anchor quirk: the box insets by 10 + half its own size, not by 10", () => {
    const size = { w: 100, h: 20 };
    const screen = screenPointsForMode("iphone");
    const layout = infiniteDungeonUnlockLabelLayout("iphone", size);


    expect(layout.cocosPosition).toEqual({ x: 420, y: 20 });
    expect(layout.topLeft).toEqual({ x: 320, y: 280 });
    // The author wrote centred-anchor offsets and kept the corner anchor, so the gap is 10 + w/2
    // from the right edge and 10 + h/2 from the bottom.
    expect(screen.w - (layout.topLeft.x + size.w)).toBe(layout.insetPt + size.w / 2);
    expect(screen.h - (layout.topLeft.y + size.h)).toBe(layout.insetPt + size.h / 2);

    expect(layout.backingCenter).toEqual({ x: 50, y: 10 });
  });

  it("rounds in the source's own point space, so iPad keeps its half points", () => {
    const size = { w: 101, h: 20 };
    // iPhone is 1:1 with the source, so `roundf` applies directly: 480 - 10 - 50.5 -> 420.
    expect(infiniteDungeonUnlockLabelLayout("iphone", size).cocosPosition.x).toBe(420);
    // iPad: 512 - 5 - 50.5 = 456.5 port points is 913 native points, already whole. Rounding in
    // port space instead would have pushed it to 457.
    const pad = infiniteDungeonUnlockLabelLayout("ipad", size);
    expect(pad.cocosPosition).toEqual({ x: 456.5, y: 15 });
    expect(pad.topLeft).toEqual({ x: 355.5, y: 349 });
  });

  it("rejects a content size no measured label could have", () => {
    expect(() => infiniteDungeonUnlockLabelLayout("iphone", { w: -1, h: 20 }))
      .toThrow(/non-negative/);
    expect(() => infiniteDungeonUnlockLabelLayout("iphone", { w: 100, h: Number.NaN }))
      .toThrow(/non-negative/);
  });
});
