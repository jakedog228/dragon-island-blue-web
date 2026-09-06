import { describe, expect, it } from "vitest";
import {
  collectionCloseItemLayout,
  collectionCompletedRowTint,
  collectionMenuMetrics,
  formatCollectionRowLabel,
} from "../src/world/collectionMath.js";

describe("Collection source math", () => {
  it("formats the localized title and integer progress exactly", () => {
    expect(formatCollectionRowLabel("Usual Suspects", 0)).toBe("Usual Suspects (0%)");
    expect(formatCollectionRowLabel("Collector", 100)).toBe("Collector (100%)");
    expect(() => formatCollectionRowLabel("Collector", 99.5)).toThrow(/integer/);
  });

  it("normalizes every CenteredWithClose metric for iPhone", () => {
    expect(collectionMenuMetrics("iphone")).toEqual({
      configName: "CenteredWithClose",
      columnCount: 1,
      alignment: "center",
      titleFontSize: 25,
      rowFontSize: 20,
      itemGap: 30,
      columnGap: 30,
      titleGap: 10,
      outlineWidth: 2,
      closeInset: 10,
      closeItemGap: 10,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
    });
  });

  it("normalizes every CenteredWithClose metric for iPad", () => {
    expect(collectionMenuMetrics("ipad")).toEqual({
      configName: "CenteredWithClose",
      columnCount: 1,
      alignment: "center",
      titleFontSize: 25,
      rowFontSize: 20,
      itemGap: 30,
      columnGap: 30,
      titleGap: 10,
      outlineWidth: 1,
      closeInset: 5,
      closeItemGap: 10,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
    });
  });

  it("interpolates completed rows white to yellow and back over the exact one-second loop", () => {
    expect(collectionCompletedRowTint(0)).toBe(0xffffff);
    expect(collectionCompletedRowTint(250)).toBe(0xffff80);
    expect(collectionCompletedRowTint(500)).toBe(0xffff00);
    expect(collectionCompletedRowTint(750)).toBe(0xffff80);
    expect(collectionCompletedRowTint(1_000)).toBe(0xffffff);
    expect(collectionCompletedRowTint(1_250)).toBe(0xffff80);
  });

  it("anchors the complete icon-left Back item in both idioms", () => {
    expect(collectionCloseItemLayout(
      { w: 480, h: 320 },
      "iphone",
      { w: 40, h: 20 },
      { w: 30, h: 29.5 },
    )).toEqual({
      position: { x: 390, y: 10 },
      contentSize: { w: 80, h: 30 },
      icon: { x: 0, y: 0 },
      label: { x: 40, y: 5 },
    });
    expect(collectionCloseItemLayout(
      { w: 512, h: 384 },
      "ipad",
      { w: 40, h: 20 },
      { w: 30, h: 29.5 },
    )).toEqual({
      position: { x: 427, y: 5 },
      contentSize: { w: 80, h: 29.5 },
      icon: { x: 0, y: 0 },
      label: { x: 40, y: 5 },
    });
  });
});
