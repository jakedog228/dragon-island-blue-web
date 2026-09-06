import { describe, expect, it } from "vitest";
import {
  guildQuestDisplayLayout,
  guildTavernBackgroundLayout,
  guildTavernLayout,
  guildTavernMenuGeometry,
} from "../src/world/guildQuestLayoutMath.js";

describe("Guild quest source layout", () => {
  it("crops the Tavern POT texture and preserves the source full-screen placement", () => {
    expect(guildTavernBackgroundLayout("iphone")).toEqual({
      textureRectPx: { x: 0, y: 0, w: 1024, h: 768 },
      sizePt: { w: 512, h: 384 },
      positionPt: { x: -16, y: -32 },
    });
    expect(guildTavernBackgroundLayout("ipad")).toEqual({
      textureRectPx: { x: 0, y: 0, w: 1024, h: 768 },
      sizePt: { w: 512, h: 384 },
      positionPt: { x: 0, y: 0 },
    });
  });

  it("inherits the Tavern item font and includes icon accessories in both idioms", () => {
    expect(guildTavernLayout("iphone")).toEqual({
      itemFontSize: 20,
      itemGap: 40,
      columnGap: 50,
      itemIconGap: 10,
      notificationFontSize: 13,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
      closeInset: 10,
      outlineWidth: 2,
    });
    expect(guildTavernLayout("ipad")).toEqual({
      itemFontSize: 20,
      itemGap: 40,
      columnGap: 50,
      itemIconGap: 10,
      notificationFontSize: 13,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
      closeInset: 5,
      outlineWidth: 1,
    });
  });

  it.each([
    ["iphone", 320],
    ["ipad", 384],
  ] as const)("centers Tavern's action matrix with no title slot in %s mode", (mode, screenHeight) => {
    const geometry = guildTavernMenuGeometry(mode, [
      [{ w: 100, h: 20 }, { w: 80, h: 20 }],
      [{ w: 90, h: 20 }, { w: 70, h: 20 }],
    ]);

    expect(geometry.title).toBeNull();
    expect(geometry.content.y + geometry.content.h / 2).toBe(screenHeight / 2);
    expect(geometry.content.h).toBe(80);
  });

  it("keeps QuestDisplay's explicit item gap but halves its bare Box gaps on iPad", () => {
    expect(guildQuestDisplayLayout("iphone")).toEqual({
      itemFontSize: 20,
      titleFontSize: 25,
      itemGap: 20,
      itemIconGap: 10,
      boxGap: 5,
      outlineWidth: 2,
      roundingScale: 1,
    });
    expect(guildQuestDisplayLayout("ipad")).toEqual({
      itemFontSize: 20,
      titleFontSize: 25,
      itemGap: 20,
      itemIconGap: 10,
      boxGap: 2.5,
      outlineWidth: 1,
      roundingScale: 2,
    });
  });
});
