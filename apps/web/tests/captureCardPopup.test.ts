import { describe, expect, it } from "vitest";
import { captureChooserMetrics } from "../src/battle/captureCardPopupMath.js";

describe("captureChooserMetrics", () => {
  it("pins the source phone geometry", () => {
    expect(captureChooserMetrics("iphone")).toEqual({
      boxGap: 5,
      statusSquare: 70,
      costBottomInset: 10,
      balanceCurrencyGap: 30,
    });
  });

  it("normalizes the source iPad geometry without widening bare Box gaps", () => {
    expect(captureChooserMetrics("ipad")).toEqual({
      boxGap: 2.5,
      statusSquare: 50,
      costBottomInset: 10,
      balanceCurrencyGap: 30,
    });
  });
});
