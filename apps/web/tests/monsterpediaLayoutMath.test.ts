import { describe, expect, it } from "vitest";
import {
  MONSTERPEDIA_BOOK_SIZE_PT,
  monsterpediaBookLayout,
  monsterpediaCardLayout,
  monsterpediaCompleteListLayout,
  monsterpediaExpansionLayout,
  monsterpediaHelpLineExtent,
  monsterpediaHalfStarFrame,
  monsterpediaHelpLabelOffset,
} from "../src/world/monsterpediaLayoutMath.js";

describe("Monsterpedia classified layout", () => {
  it("bottom-left-pins the fixed book crop and uses the exact dual-idiom card grids", () => {
    const phone = monsterpediaBookLayout("iphone");
    const pad = monsterpediaBookLayout("ipad");
    expect(MONSTERPEDIA_BOOK_SIZE_PT).toEqual({ w: 512, h: 384 });
    expect(phone.screen).toEqual({ w: 480, h: 320 });

    expect(phone.bookTopLeft).toEqual({ x: 0, y: -64 });
    expect(pad.screen).toEqual({ w: 512, h: 384 });
    expect(pad.bookTopLeft).toEqual({ x: 0, y: 0 });
    expect(phone.ordinaryCardTopLeft).toEqual([
      { x: 20, y: 10 },
      { x: 150, y: 10 },
      { x: 280, y: 10 },
      { x: 20, y: 165 },
      { x: 150, y: 165 },
      { x: 280, y: 165 },
    ]);
    expect(pad.ordinaryCardTopLeft).toEqual([
      { x: 25, y: 15 },
      { x: 155, y: 15 },
      { x: 285, y: 15 },
      { x: 25, y: 185 },
      { x: 155, y: 185 },
      { x: 285, y: 185 },
    ]);
    expect(phone.recipeCardTopLeft).toEqual([
      { x: 80, y: 10 },
      { x: 280, y: 10 },
      { x: 80, y: 165 },
      { x: 280, y: 165 },
    ]);
    expect(pad.recipeCardTopLeft).toEqual([
      { x: 80, y: 15 },
      { x: 280, y: 15 },
      { x: 80, y: 185 },
      { x: 280, y: 185 },
    ]);
  });

  it("right-mounts the tab box and classifies the stacked footer in both modes", () => {
    const phoneBook = monsterpediaBookLayout("iphone");
    const padBook = monsterpediaBookLayout("ipad");
    expect(phoneBook.tab.categoryTop(0)).toBe(196);
    expect(phoneBook.tab.categoryTop(5)).toBe(-4);
    expect(phoneBook.tab.closeTop).toBe(270);

    expect(phoneBook.tab.left(75)).toBe(405);
    expect(phoneBook.tab.left(90)).toBe(390);
    expect(padBook.tab.categoryTop(0)).toBe(214);
    expect(padBook.tab.categoryTop(5)).toBe(14);
    expect(padBook.tab.closeTop).toBe(334);
    expect(padBook.tab.left(75)).toBe(437);
    expect(padBook.tab.left(90)).toBe(422);
    expect(phoneBook.footer).toEqual({
      fontPt: 13,
      rightInset: 2,
      cocosBottom: 48,
      gap: 5,
    });
    expect(padBook.footer).toEqual({
      fontPt: 13,
      rightInset: 5,
      cocosBottom: 70,
      gap: 2.5,
    });
  });

  it("pins the Complete List card, labels, controls, and summary in both modes", () => {
    const phone = monsterpediaCompleteListLayout("iphone");
    const pad = monsterpediaCompleteListLayout("ipad");
    expect(phone.cardTopLeft).toEqual({ x: 350, y: 85 });
    expect(pad.cardTopLeft).toEqual({ x: 372, y: 117 });
    expect(phone.labelsOrigin).toEqual({ x: 30, y: 30 });
    expect(pad.labelsOrigin).toEqual({ x: 20, y: 20 });
    expect(phone.cell).toEqual({ w: 165, h: 20 });
    expect(pad.cell).toEqual({ w: 100, h: 20 });
    expect(phone).toMatchObject({
      rows: 11,
      columns: 2,
      visibleLabels: 22,
      labelFontPt: 14,
      controlGap: 40,
      roundingScale: 1,
    });
    expect(pad).toMatchObject({
      rows: 15,
      columns: 3,
      visibleLabels: 45,
      labelFontPt: 10,
      controlGap: 40,
      roundingScale: 2,
    });
    expect(phone.controlsLeft(166)).toBe(157);
    expect(pad.controlsLeft(166)).toBe(173);
    expect(phone.controlsTop(32)).toBe(283);
    expect(pad.controlsTop(32)).toBe(342);
    expect(phone.summary).toMatchObject({ fontPt: 14, gapPt: 5 });
    expect(pad.summary).toMatchObject({ fontPt: 14, gapPt: 2.5 });
  });

  it("keeps recovered card internals explicit in each mode", () => {
    const phone = monsterpediaCardLayout("iphone");
    const pad = monsterpediaCardLayout("ipad");
    expect(phone).toEqual(pad);
    expect(phone.size).toEqual({ w: 120, h: 150 });
    expect(phone.portrait.ordinaryMax).toEqual({ w: 103, h: 73 });
    expect(phone.portrait.ordinaryCenter).toEqual({ x: 60.5, yFromFrameBottom: 93.5 });
    expect(phone.unknownCenter).toEqual({ x: 60.5, y: 56.5 });
    expect(phone.unknownMaxHeight).toBe(73);
    expect(phone.ingredientCenters).toEqual([
      { x: -34, y: 65, anchorX: 0.5, anchorY: 1 },
      { x: -34, y: 85, anchorX: 0.5, anchorY: 0 },
    ]);
    expect(phone.ingredientMax).toEqual({ w: 40, h: 50 });
    expect(phone.combine).toEqual({ x: -26, y: 75 });
  });

  it("uses the exact two-row expansion and help call sites in both modes", () => {
    const phone = monsterpediaExpansionLayout("iphone");
    const pad = monsterpediaExpansionLayout("ipad");
    expect(phone.closeTopLeft).toEqual({ x: 20, y: 20 });
    expect(pad.closeTopLeft).toEqual({ x: 20, y: 20 });
    expect(phone.selectedTopLeft).toEqual({ x: 180, y: 5 });
    expect(pad.selectedTopLeft).toEqual({ x: 196, y: 10 });
    expect(phone.bottomTop).toBe(165);
    expect(pad.bottomTop).toBe(224);
    expect(phone.bottomColumnX).toEqual([70 / 3, 180, 1010 / 3]);
    expect(pad.bottomColumnX).toEqual([32, 196, 360]);
    expect(phone.helpLines).toEqual([
      { name: "YourHighest", x: 195, y: 135, flipX: false, flipY: false },
      { name: "MonsterElement", x: 227, y: 140, flipX: false, flipY: true },
      { name: "MonsterRating", x: 270, y: 110, flipX: true, flipY: false },
      { name: "MonsterIndex", x: 292, y: 138, flipX: true, flipY: true },
      { name: "MonsterChain", x: 274, y: 129, flipX: true, flipY: false },
    ]);
    expect(pad.helpLines).toEqual([
      { name: "YourHighest", x: 210, y: 134, flipX: false, flipY: false },
      { name: "MonsterElement", x: 250, y: 149, flipX: false, flipY: true },
      { name: "MonsterRating", x: 280, y: 109, flipX: true, flipY: false },
      { name: "MonsterIndex", x: 308, y: 154, flipX: true, flipY: true },
      { name: "MonsterChain", x: 288, y: 126, flipX: true, flipY: false },
    ]);
    const line = { w: 48, h: 18 };
    expect(monsterpediaHelpLabelOffset(line, 4, false, false)).toEqual({ x: -48, y: -18 });
    expect(monsterpediaHelpLabelOffset(line, 4, false, true)).toEqual({ x: -48, y: 14 });
    expect(monsterpediaHelpLabelOffset(line, 4, true, false)).toEqual({ x: 48, y: -18 });
    expect(monsterpediaHelpLabelOffset(line, 4, true, true)).toEqual({ x: 48, y: 14 });
    expect(monsterpediaHelpLineExtent(line, false, false)).toEqual({
      left: -48, right: 0, top: -18, bottom: 0,
    });
    expect(monsterpediaHelpLineExtent(line, true, false)).toEqual({
      left: 0, right: 48, top: -18, bottom: 0,
    });
    expect(monsterpediaHelpLineExtent(line, false, true)).toEqual({
      left: -48, right: 0, top: 0, bottom: 18,
    });
    expect(monsterpediaHelpLineExtent(line, true, true)).toEqual({
      left: 0, right: 48, top: 0, bottom: 18,
    });
  });

  it("left-crops the shipped 20x19 HD rarity star without squeezing its height", () => {
    expect(monsterpediaHalfStarFrame({ x: 456, y: 84, width: 20, height: 19 }))
      .toEqual({ x: 456, y: 84, width: 10, height: 19 });
  });
});
