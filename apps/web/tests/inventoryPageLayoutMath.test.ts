import { describe, expect, it } from "vitest";
import {
  inventoryGemDisplayLayout,
  inventoryPageLayout,
  inventoryPagedClosePosition,
} from "../src/player/inventoryPageLayoutMath.js";

describe("source InventoryPageProvider layout", () => {
  it("pins iPhone native geometry", () => {
    expect(inventoryPageLayout("iphone")).toEqual({
      mainGap: 10,
      itemGap: 5,
      controlGap: 5,
      roundingScale: 1,
      controlSpacer: 10,
      titleFont: 18,
      actionFont: 14,
      topInset: 10,
      closeOffset: 10,
      arrowSize: { w: 22, h: 32 },
      actionSize: { w: 99.5, h: 26 },
      closeSize: { w: 30, h: 29.5 },
    });
  });

  it("normalizes paired constants and halves bare literals on iPad", () => {
    expect(inventoryPageLayout("ipad")).toEqual({
      mainGap: 10,
      itemGap: 2.5,
      controlGap: 2.5,
      roundingScale: 2,
      controlSpacer: 10,
      titleFont: 18,
      actionFont: 14,
      topInset: 5,
      closeOffset: 5,
      arrowSize: { w: 22, h: 32 },
      actionSize: { w: 99.5, h: 26 },
      closeSize: { w: 30, h: 29.5 },
    });
  });

  it("pins SmallItemDisplay, ItemInfoDisplay, and GemNodeStack values in both idioms", () => {
    expect(inventoryGemDisplayLayout("iphone")).toEqual({
      rowIconSide: 32,
      rowStatIconSide: 24,
      rowValueFont: 10,
      infoStatIconSide: 20,
      infoValueFont: 14,
      equipmentScale: 0.46,
      instructionHoldMs: 3_000,
      instructionFadeMs: 1_000,
    });
    expect(inventoryGemDisplayLayout("ipad")).toEqual({
      rowIconSide: 32,
      rowStatIconSide: 24,
      rowValueFont: 8,
      infoStatIconSide: 20,
      infoValueFont: 14,
      equipmentScale: 0.46,
      instructionHoldMs: 3_000,
      instructionFadeMs: 1_000,
    });
  });

  it("rebases the PagedNodeDisplay close chrome to the source top inset", () => {
    expect(inventoryPagedClosePosition("iphone", 300, -0.5)).toEqual({ x: 310, y: 9.5 });
    expect(inventoryPagedClosePosition("ipad", 300, -0.25)).toEqual({ x: 305, y: 4.75 });
    expect(() => inventoryPagedClosePosition("iphone", 300, Number.NaN)).toThrow(
      "PagedNodeDisplay main position must be finite",
    );
  });
});
