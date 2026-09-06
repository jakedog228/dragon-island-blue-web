import { describe, expect, it } from "vitest";
import {
  EDITOR_TAG_INSERT_SOUL_STONE,
  EDITOR_TAG_ORDER_ALL_LEFT,
  EDITOR_TAG_ORDER_ALL_RIGHT,
  EDITOR_TAG_ORDER_LEFT,
  EDITOR_TAG_ORDER_RIGHT,
  EDITOR_TAG_SORT,
  EDITOR_INSERT_LABEL_COLOR,
  compareEditorSortValues,
  editorArrowEnabled,
  editorCarouselCenter,
  editorHasReserveRow,
  editorHasTownTitle,
  editorInsertSubBoxGap,
  editorInsertLabelFont,
  editorNextSortOrder,
  nearestEditorControl,
  editorPartyHeadingAnchor,
  editorPartyHeadingFont,
  editorPointInCflowStrip,
  partyManagementShowsFirstUseTutorial,
  editorRemoveAllCenter,
  editorReservesCenter,
  editorSelectionSummaryCenters,
  editorSortColumnLayout,
  editorSortInset,
  editorToolboxInsertGap,
  editorToolboxLayout,
  editorToolboxTopGap,
} from "../src/world/partyEditorMath.js";
import { screenPointsForMode, type DisplayMode } from "../src/displayMode.js";

describe("partyEditorMath", () => {
  it("floors touchableNodes controls and resolves overlaps by nearest centre", () => {
    const controls = [
      { value: "left", rect: { x: 100, y: 250, w: 20, h: 20 } },
      { value: "right", rect: { x: 145, y: 250, w: 20, h: 20 } },
    ] as const;
    expect(nearestEditorControl(controls, { x: 110, y: 238 })).toBe("left");
    expect(nearestEditorControl(controls, { x: 155, y: 238 })).toBe("right");
    expect(nearestEditorControl(controls, { x: 132, y: 260 })).toBe("left");
    expect(nearestEditorControl(controls, { x: 134, y: 260 })).toBe("right");
    expect(nearestEditorControl(controls, { x: 200, y: 260 })).toBeUndefined();
  });

  it("gates first-use Tutorial4 to editable MonsterManagement styles 0/1", () => {
    expect([0, 1, 2, 3, 4].map(partyManagementShowsFirstUseTutorial)).toEqual([
      true, true, false, false, false,
    ]);
  });

  it("keeps the raw-confirmed userObject tags (monster-management-editor.md Q2)", () => {
    expect(EDITOR_TAG_ORDER_ALL_LEFT).toBe(5);
    expect(EDITOR_TAG_ORDER_LEFT).toBe(0);
    expect(EDITOR_TAG_INSERT_SOUL_STONE).toBe(2);
    expect(EDITOR_TAG_ORDER_RIGHT).toBe(1);
    expect(EDITOR_TAG_ORDER_ALL_RIGHT).toBe(6);
    expect(EDITOR_TAG_SORT).toBe(7);
  });

  it("cycles sort order Name -> Stars -> Level -> Name (Q4's mod-3 wrap)", () => {
    expect(editorNextSortOrder(0)).toBe(1);
    expect(editorNextSortOrder(1)).toBe(2);
    expect(editorNextSortOrder(2)).toBe(0);
  });

  it("classifies every toolbox idiom constant explicitly", () => {
    expect(editorToolboxTopGap("iphone")).toBe(5);
    expect(editorToolboxTopGap("ipad")).toBe(2.5);
    expect(editorToolboxInsertGap("iphone")).toBe(30);
    expect(editorToolboxInsertGap("ipad")).toBe(15);
    expect(editorInsertSubBoxGap("iphone")).toBe(0);
    expect(editorInsertSubBoxGap("ipad")).toBe(1);
    expect(editorInsertLabelFont("iphone")).toBe(15);
    expect(editorInsertLabelFont("ipad")).toBe(15);
    expect(editorPartyHeadingFont("iphone")).toBe(20);
    expect(editorPartyHeadingFont("ipad")).toBe(20);
    expect(EDITOR_INSERT_LABEL_COLOR).toBe(0x93cddd);
    expect(editorSortInset("iphone")).toBe(5);
    expect(editorSortInset("ipad")).toBe(10);
  });

  it("uses the native ascending-name and descending-stars/level comparators without tie-breaks", () => {
    const low = { localizedName: "Abel", stars: 1.5, level: 2 };
    const high = { localizedName: "Zed", stars: 4, level: 20 };
    expect(compareEditorSortValues(0, low, high)).toBeLessThan(0);
    expect(compareEditorSortValues(1, low, high)).toBeGreaterThan(0);
    expect(compareEditorSortValues(2, low, high)).toBeGreaterThan(0);
    expect(compareEditorSortValues(1, low, { ...high, stars: low.stars })).toBe(0);
    expect(compareEditorSortValues(2, low, { ...high, level: low.level })).toBe(0);
  });

  it.each(["iphone", "ipad"] as const)(
    "lays the %s toolbox row out per the raw-confirmed §1b formula",
    (mode: DisplayMode) => {
    const sizes = {
      arrowAllLeft: { w: 20, h: 22 },
      arrowLeft: { w: 20, h: 22 },
      soulStone: { w: 30, h: 30 },
      arrowRight: { w: 20, h: 22 },
      arrowAllRight: { w: 20, h: 22 },
      insertLabel: { w: 84, h: 16 },
    };
    const screen = screenPointsForMode(mode);
    const layout = editorToolboxLayout(sizes, mode);
    const keys = layout.controls.map((control) => control.key);
    expect(keys).toEqual([
      "orderAllLeftArrow",
      "orderLeftArrow",
      "soulStoneButton",
      "orderRightArrow",
      "orderAllRightArrow",
    ]);
    // the insert sub-box (icon + gap + label) is the tallest child -> box height
    const subGap = layout.rowHeight - sizes.soulStone.h - sizes.insertLabel.h;
    expect(subGap).toBe(editorInsertSubBoxGap(mode));
    // §1b: the whole box is horizontally centered and its vertical CENTER is 5 + boxH/2
    const rowCenterY = editorToolboxTopGap(mode) + layout.rowHeight / 2;
    // arrows sit cross-axis-centered on the row line
    expect(layout.controls[0]!.center.y).toBeCloseTo(rowCenterY, 5);
    expect(layout.controls[4]!.center.y).toBeCloseTo(rowCenterY, 5);
    // source child order is label then icon: label above, tappable icon below
    expect(layout.insertLabelCenter.y).toBeLessThan(rowCenterY);
    expect(layout.controls[2]!.center.y).toBeGreaterThan(rowCenterY);
    // the insert sub-box is the middle slot, centered on the screen (symmetric widths)
    expect(layout.controls[2]!.center.x).toBeCloseTo(screen.w / 2, 5);
    expect(layout.insertLabelCenter.x).toBeCloseTo(screen.w / 2, 5);
    // arrows mirror around it with the 30pt GapNodes replacing the uniform 20pt gap
    expect(layout.controls[0]!.center.x + layout.controls[4]!.center.x).toBeCloseTo(screen.w, 5);
    expect(layout.controls[1]!.center.x + layout.controls[3]!.center.x).toBeCloseTo(screen.w, 5);
    const stepGap = layout.controls[1]!.center.x - layout.controls[0]!.center.x - 20;
    expect(stepGap).toBeCloseTo(20, 5); // uniform Box gap between the two left arrows
    const insertGap =
      layout.controls[2]!.center.x - 84 / 2 - (layout.controls[1]!.center.x + 20 / 2);
    expect(insertGap).toBeCloseTo(editorToolboxInsertGap(mode), 5);
    // monotonically left -> right
    for (let i = 1; i < layout.controls.length; i++) {
      expect(layout.controls[i]!.center.x).toBeGreaterThan(layout.controls[i - 1]!.center.x);
    }
  });

  it("places the shared sort icon and style-0 label in the source lower-left column", () => {
    expect(editorSortColumnLayout({ w: 36, h: 33 }, undefined, "iphone")).toEqual({
      iconCenter: { x: 28, y: 293.5 },
    });
    expect(editorSortColumnLayout({ w: 36, h: 33 }, undefined, "ipad")).toEqual({
      iconCenter: { x: 38, y: 347.5 },
    });
    expect(editorSortColumnLayout({ w: 36, h: 33 }, { w: 30, h: 16 }, "iphone")).toEqual({
      iconCenter: { x: 28, y: 293.5 },
      labelCenter: { x: 28, y: 259 },
    });
    expect(editorSortColumnLayout({ w: 36, h: 33 }, { w: 30, h: 16 }, "ipad")).toEqual({
      iconCenter: { x: 38, y: 347.5 },
      labelCenter: { x: 38, y: 308 },
    });
  });

  it("pins the asymmetric style-0 Party and Remove-All coordinates in both idioms", () => {
    expect(editorPartyHeadingAnchor("iphone")).toEqual({ x: 45, y: 110 });
    expect(editorPartyHeadingAnchor("ipad")).toEqual({ x: 40, y: 55 });
    expect(editorRemoveAllCenter("iphone")).toEqual({ x: 70, y: 154 });
    expect(editorRemoveAllCenter("ipad")).toEqual({ x: 70, y: 219 });
  });

  it("places carousel and reserves at explicit phone/iPad coordinates", () => {
    expect(editorCarouselCenter("iphone")).toEqual({ x: 240, y: 110 });
    expect(editorCarouselCenter("ipad")).toEqual({ x: 256, y: 144 });
    expect(editorReservesCenter("iphone")).toEqual({ x: 240, y: 230 });
    expect(editorReservesCenter("ipad")).toEqual({ x: 256, y: 294 });
  });

  it("places both editable selection summaries from their native idiom pairs", () => {
    expect(editorSelectionSummaryCenters("iphone")).toEqual({
      batting: { x: 240, y: 60 },
      reserves: { x: 240, y: 178 },
    });
    expect(editorSelectionSummaryCenters("ipad")).toEqual({
      batting: { x: 256, y: 84 },
      reserves: { x: 256, y: 209 },
    });
  });

  it("gates reorder arrows on occupied fixed slots and real movement", () => {
    const slots = ["a", undefined, "c", undefined];
    expect(editorArrowEnabled(slots, 0, -1)).toBe(false);
    expect(editorArrowEnabled(slots, 0, 1)).toBe(true);
    expect(editorArrowEnabled(slots, 1, 1)).toBe(false);
    expect(editorArrowEnabled(slots, 2, -1)).toBe(true);
    expect(editorArrowEnabled(slots, 2, 999)).toBe(true);
    expect(editorArrowEnabled(slots, 3, 1)).toBe(false);
  });

  it("constructs source style-dependent title and reserve rows structurally", () => {
    expect(editorHasTownTitle(0)).toBe(true);
    expect(editorHasTownTitle(1)).toBe(false);


    expect(editorHasReserveRow(0, 1)).toBe(true);
    expect(editorHasReserveRow(0, 0)).toBe(false);
    expect(editorHasReserveRow(1, 0)).toBe(false);
    expect(editorHasReserveRow(1, 2)).toBe(false);
  });

  it("gates cross-list drops on isPointNearCenter's one-card-wide strip", () => {
    // Drop targeting only. The scroll gesture's own hit test is the much wider
    // isPointInBounds: arc band (monsterManagement.test.ts) — reusing this strip for touch-down
    // was what made swipes starting on a side card do nothing.
    const center = editorCarouselCenter("iphone");
    expect(editorPointInCflowStrip({ x: 319.999, y: 70 }, center)).toBe(true);
    expect(editorPointInCflowStrip({ x: 320, y: 110 }, center)).toBe(false);
    expect(editorPointInCflowStrip({ x: 240, y: 150 }, center)).toBe(true);
    expect(editorPointInCflowStrip({ x: 240, y: 150.001 }, center)).toBe(false);
  });
});
