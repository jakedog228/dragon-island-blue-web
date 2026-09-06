import { describe, expect, it } from "vitest";
import {
  townWarpColumns,
  townWarpGeometry,
  townWarpItems,
  townWarpLayout,
} from "../src/world/townWarpMath.js";

describe("TownWarp source model", () => {
  it("keeps every source idiom value classified", () => {
    expect(townWarpLayout("iphone")).toMatchObject({
      itemFontSize: 14,
      titleFontSize: 25,
      questCountFontSize: 10,
      legendCountFontSize: 12,
      legendTextFontSize: 12,
      legendGap: 5,
      legendBottomInset: 10,
      closeInset: 10,
      outlineWidth: 2,
      background: { positionPt: { x: -16, y: -32 } },
    });
    expect(townWarpLayout("ipad")).toMatchObject({
      itemFontSize: 14,
      titleFontSize: 25,
      questCountFontSize: 11,
      legendCountFontSize: 11,
      legendTextFontSize: 12,
      legendGap: 2.5,
      legendBottomInset: 5,
      closeInset: 5,
      outlineWidth: 1,
      background: { positionPt: { x: 0, y: 0 } },
    });
  });

  it("reveals only visited names and badges, then splits round-robin", () => {
    const destinations = Array.from({ length: 5 }, (_, index) => ({
      townName: `Town${index}`,
      worldName: "World",
      sortOrder: index,
    }));
    const items = townWarpItems(
      destinations,
      new Set(["Town0", "Town3"]),
      (name) => `Localized ${name}`,
      (name) => Number(name.slice(-1)) + 1,
    );
    expect(items.map(({ label, questCount, showQuestBadge }) => [
      label,
      questCount,
      showQuestBadge,
    ])).toEqual([
      ["Localized Town0", 1, true],
      ["??????", 0, false],
      ["??????", 0, false],
      ["Localized Town3", 4, true],
      ["??????", 0, false],
    ]);
    expect(townWarpColumns(items).map((column) => column.map(({ townName }) => townName)))
      .toEqual([["Town0", "Town3"], ["Town1", "Town4"], ["Town2"]]);
  });

  it("retains the only visited town as a selectable self destination", () => {
    const destinations = [
      { townName: "Longdale_City", worldName: "World_3-3", sortOrder: 5 },
      { townName: "Capital_City", worldName: "World_1-2", sortOrder: 1 },
    ];
    const items = townWarpItems(
      destinations,
      new Set(["Longdale_City"]),
      (name) => name,
      () => 0,
    );
    expect(items).toEqual([
      {
        townName: "Longdale_City",
        label: "Longdale_City",
        visited: true,
        questCount: 0,
        showQuestBadge: true,
      },
      {
        townName: "Capital_City",
        label: "??????",
        visited: false,
        questCount: 0,
        showQuestBadge: false,
      },
    ]);
    const columns = townWarpColumns(items);
    expect(columns.map((column) => column.length)).toEqual([1, 1, 0]);
    expect(townWarpGeometry(null, columns.map((column) =>
      column.map(() => ({ w: 50, h: 20 }))), "iphone").buttons.map((column) => column.length))
      .toEqual([1, 1, 0]);
  });
});
