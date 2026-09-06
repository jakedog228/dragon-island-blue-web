import { describe, it, expect } from "vitest";
import { MIN_TOUCH_SIZE, buttonHitRect, buttonHitRectLocal, minimumHitRectLocal, nearestMinimumHit, rectContainsPoint } from "../src/hitTest.js";


describe("buttonHitRect", () => {
  it("uses the documented 55pt default floor", () => {
    expect(MIN_TOUCH_SIZE).toBe(55);
  });

  it("expands a smaller-than-floor button symmetrically on both axes", () => {
    // 20x10 at (100,100) -> pad x by (55-20)/2=17.5, y by (55-10)/2=22.5
    expect(buttonHitRect({ x: 100, y: 100 }, { w: 20, h: 10 })).toEqual({
      x: 100 - 17.5,
      y: 100 - 22.5,
      w: 55,
      h: 55,
    });
  });

  it("expands only the undersized axis when the other already meets the floor", () => {
    // width 55 already at floor (no pad), height 30 under floor -> pad by (55-30)/2=12.5
    expect(buttonHitRect({ x: 0, y: 0 }, { w: 55, h: 30 })).toEqual({ x: 0, y: -12.5, w: 55, h: 55 });
  });

  it("does not shrink a button already at or above the floor on both axes", () => {
    expect(buttonHitRect({ x: 5, y: 5 }, { w: 55, h: 55 })).toEqual({ x: 5, y: 5, w: 55, h: 55 });
  });

  it("does not shrink a large button", () => {
    expect(buttonHitRect({ x: 0, y: 0 }, { w: 200, h: 100 })).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it("honors a caller-supplied minSize override instead of the 55pt default", () => {
    expect(buttonHitRect({ x: 0, y: 0 }, { w: 10, h: 10 }, 20)).toEqual({ x: -5, y: -5, w: 20, h: 20 });
  });

  it("a zero minSize never expands (degenerates to a plain no-floor rect)", () => {
    expect(buttonHitRect({ x: 1, y: 2 }, { w: 3, h: 4 }, 0)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});

// buttonHitRectLocal: the same expansion mapped into a container's LOCAL space for Pixi's hitArea
// (EventBoundary applies the inverse worldTransform before hitArea.contains, so the container's own
// scale must be divided back out of the padded rect).
describe("buttonHitRectLocal", () => {
  it("matches buttonHitRect at the origin for identity scale", () => {
    expect(buttonHitRectLocal({ w: 20, h: 10 }, { x: 1, y: 1 })).toEqual(
      buttonHitRect({ x: 0, y: 0 }, { w: 20, h: 10 }),
    );
  });

  it("computes the pad against scaledContentSize, then divides own scale back out (scale 2)", () => {
    // content 20x10 pt, own scale 2 -> scaledContentSize 40x20; world pads (55-40)/2=7.5,
    // (55-20)/2=17.5 -> local rect: x -7.5/2=-3.75, w 55/2=27.5; y -17.5/2=-8.75, h 27.5.
    expect(buttonHitRectLocal({ w: 20, h: 10 }, { x: 2, y: 2 })).toEqual({
      x: -3.75,
      y: -8.75,
      w: 27.5,
      h: 27.5,
    });
  });

  it("expands only the axis whose SCALED size is under the floor (scale 0.5)", () => {
    // content 200x100, scale 0.5 -> scaled 100x50: width >= 55 untouched, height padded 2.5 world
    // -> local y -5, h 110.
    expect(buttonHitRectLocal({ w: 200, h: 100 }, { x: 0.5, y: 0.5 })).toEqual({
      x: 0,
      y: -5,
      w: 200,
      h: 110,
    });
  });

  it("leaves a large button untouched", () => {
    expect(buttonHitRectLocal({ w: 200, h: 100 }, { x: 1, y: 1 })).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
});

describe("minimumHitRectLocal", () => {
  it("pads around an anchored sprite's authored local content rect", () => {
    expect(minimumHitRectLocal(
      { x: -10, y: -5, w: 20, h: 10 },
      { x: 1, y: 1 },
    )).toEqual({ x: -27.5, y: -27.5, w: 55, h: 55 });
  });

  it("uses physical scale magnitudes for mirrored nodes", () => {
    expect(minimumHitRectLocal(
      { x: 0, y: 0, w: 20, h: 10 },
      { x: -2, y: 2 },
    )).toEqual({ x: -3.75, y: -8.75, w: 27.5, h: 27.5 });
  });

  it("retains the nearest center when minimum-finalized sibling rects overlap", () => {
    const candidates = [
      { value: "first", contentRect: { x: 0, y: 0, w: 100, h: 32 }, ownScale: { x: 1, y: 1 } },
      { value: "second", contentRect: { x: 0, y: 37, w: 100, h: 32 }, ownScale: { x: 1, y: 1 } },
    ];
    expect(nearestMinimumHit(candidates, { x: 50, y: 33 })).toBe("first");
    expect(nearestMinimumHit(candidates, { x: 50, y: 36 })).toBe("second");
    expect(nearestMinimumHit(candidates, { x: 101, y: 16 })).toBeUndefined();
  });
});

describe("rectContainsPoint", () => {
  const rect = { x: 10, y: 10, w: 20, h: 20 }; // covers [10,30) x [10,30)

  it("contains a point in the interior", () => {
    expect(rectContainsPoint(rect, { x: 20, y: 20 })).toBe(true);
  });

  it("contains the near (min) edges", () => {
    expect(rectContainsPoint(rect, { x: 10, y: 10 })).toBe(true);
  });

  it("excludes the far (max) edges (CGRectContainsPoint is half-open)", () => {
    expect(rectContainsPoint(rect, { x: 30, y: 20 })).toBe(false);
    expect(rectContainsPoint(rect, { x: 20, y: 30 })).toBe(false);
  });

  it("excludes points outside the rect entirely", () => {
    expect(rectContainsPoint(rect, { x: 0, y: 0 })).toBe(false);
    expect(rectContainsPoint(rect, { x: 100, y: 100 })).toBe(false);
  });

  it("combines with buttonHitRect: a tap just outside an undersized button's raw bounds still hits", () => {
    // 10x10 button at world (0,0) -> expanded hit rect is (-22.5,-22.5,55,55); a tap at (12,12),
    // outside the raw 10x10 sprite, still lands inside the expanded MinTouchSizeMenu hit box.
    const hit = buttonHitRect({ x: 0, y: 0 }, { w: 10, h: 10 });
    expect(rectContainsPoint(hit, { x: 12, y: 12 })).toBe(true);
  });
});
