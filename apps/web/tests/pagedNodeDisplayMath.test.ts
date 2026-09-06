import { describe, expect, it } from "vitest";
import { pagedNodePageNumberLayout } from "../src/ui/pagedNodeDisplayMath.js";

describe("source PagedNodeDisplay page-number layout", () => {
  it("rebases the native iPhone anchor and position without expanding the popup content", () => {
    expect(pagedNodePageNumberLayout("iphone", { w: 340, h: 180 })).toEqual({
      anchor: { x: 0, y: 0.5 },
      mainPositionY: 0,
      outlineWidthPt: 2,
      position: { x: -12, y: 0 },
      contentBounds: { x: 0, y: 0, w: 340, h: 180 },
    });
  });

  it("normalizes the native iPad 20-point pair to the same 10 port points", () => {
    expect(pagedNodePageNumberLayout("ipad", { w: 400, h: 220 })).toEqual({
      anchor: { x: 0, y: 0.5 },
      mainPositionY: 0,
      outlineWidthPt: 1,
      position: { x: -11, y: 0 },
      contentBounds: { x: 0, y: 0, w: 400, h: 220 },
    });
  });

  it("retains only the source half-rounding delta when rebasing the signed Box origin", () => {
    expect(pagedNodePageNumberLayout("iphone", { w: 340, h: 181 }).position.y).toBe(-0.5);
    expect(pagedNodePageNumberLayout("ipad", { w: 400, h: 220.5 }).position.y).toBe(-0.25);
  });

  it("rejects invalid authored sizes", () => {
    expect(() => pagedNodePageNumberLayout("iphone", { w: -1, h: 10 })).toThrow(
      "PagedNodeDisplay main size must be non-negative",
    );
    expect(() => pagedNodePageNumberLayout("ipad", { w: 10, h: Number.NaN })).toThrow(
      "PagedNodeDisplay main size must be finite",
    );
  });
});
