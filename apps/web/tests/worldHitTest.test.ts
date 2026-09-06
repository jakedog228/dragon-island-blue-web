import { describe, expect, it } from "vitest";
import {
  minimumWorldHitRectangle,
  townLocalMinimumTouchSize,
  townPoiAggregateHitRegions,
  unionWorldHitRectangles,
  worldMinimumTouchSize,
} from "../src/world/worldHitTest.js";

describe("source shared minimum touch rectangle", () => {
  it("normalizes the decoded 55/110pt phone/iPad pair", () => {
    expect(worldMinimumTouchSize("iphone")).toBe(55);
    expect(worldMinimumTouchSize("ipad")).toBe(55);
  });

  it("recenters a 1x1 empty POI sprite in the 55pt source floor", () => {
    expect(minimumWorldHitRectangle(
      { x: 159.5, y: 141.5, width: 1, height: 1 },
      worldMinimumTouchSize("iphone"),
    )).toEqual({ x: 132.5, y: 114.5, width: 55, height: 55 });
  });

  it("expands only an undersized axis and never shrinks icon bounds", () => {
    expect(minimumWorldHitRectangle(
      { x: 10, y: 20, width: 64, height: 40 },
      55,
    )).toEqual({ x: 10, y: 12.5, width: 64, height: 55 });
  });

  it("maps the source floor into a final town's counter-scaled local frame", () => {
    expect(townLocalMinimumTouchSize(3, "iphone")).toBeCloseTo(55 / 3);
    expect(townLocalMinimumTouchSize(3, "ipad")).toBeCloseTo(55 / 3);
  });
});

describe("source town POI aggregate hit regions", () => {
  it("keeps the gap between separated members inside the aggregate region", () => {
    const union = unionWorldHitRectangles([
      { x: 10, y: 20, width: 8, height: 10 },
      { x: 38, y: 12, width: 12, height: 6 },
    ]);

    expect(union).toEqual({ x: 10, y: 12, width: 40, height: 18 });
    expect(union).toBeDefined();
    expect(30).toBeGreaterThan(union!.x);
    expect(30).toBeLessThan(union!.x + union!.width);
  });

  it("returns no region for an empty source array", () => {
    expect(unionWorldHitRectangles([])).toBeUndefined();
    expect(townPoiAggregateHitRegions([], [])).toEqual([]);
  });

  it("preserves the source's separate icon and building aggregate tests", () => {
    expect(townPoiAggregateHitRegions(
      [{ x: 0, y: 0, width: 10, height: 10 }],
      [{ x: 0, y: 40, width: 10, height: 10 }],
    )).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 40, width: 10, height: 10 },
    ]);
  });
});
