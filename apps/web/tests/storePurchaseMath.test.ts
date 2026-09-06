import { describe, expect, it } from "vitest";
import {
  nextStorePurchaseQuantity,
  storePurchaseLayout,
} from "../src/player/storePurchaseMath.js";

describe("Store purchase source layout", () => {
  it("classifies every recovered phone/iPad constant before normalization", () => {
    expect(storePurchaseLayout("iphone")).toEqual({
      outerGap: 5,
      priceGap: 5,
      nameFontSize: 18,
      descriptionFontSize: 15,
      descriptionWrapWidth: 300,
      quantityFontSize: 18,
      quantityRootGap: 20,
      quantityArrowGap: 30,
      priceFontSize: 16,
      outlineWidth: 2,
      roundingScale: 1,
    });
    expect(storePurchaseLayout("ipad")).toEqual({
      outerGap: 2.5,
      priceGap: 2.5,
      nameFontSize: 18,
      descriptionFontSize: 15,
      descriptionWrapWidth: 300,
      quantityFontSize: 9,
      quantityRootGap: 20,
      quantityArrowGap: 15,
      priceFontSize: 16,
      outlineWidth: 1,
      roundingScale: 2,
    });
  });

  it("uses the released arrow and clamps both source endpoints", () => {
    expect(nextStorePurchaseQuantity(1, "up")).toBe(2);
    expect(nextStorePurchaseQuantity(99, "up")).toBe(99);
    expect(nextStorePurchaseQuantity(2, "down")).toBe(1);
    expect(nextStorePurchaseQuantity(1, "down")).toBe(1);
  });
});
