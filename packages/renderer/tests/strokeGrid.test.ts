import { describe, it, expect } from "vitest";
import { BATTLE_STROKES, gridSequence, matchStroke, resampleStrokePath, strokeBounds, strokeGridAxes } from "../src/strokeGrid.js";
import type { Point, Rect } from "../src/scale9Math.js";


const ZONE: Rect = { x: 0, y: 0, w: 90, h: 90 }; // 30x30pt cells for easy arithmetic
const midY = ZONE.y + ZONE.h / 2; // inside the middle row
const midX = ZONE.x + ZONE.w / 2; // inside the middle column

function sample(xs: number[], y: number): Point[] {
  return xs.map((x) => ({ x, y }));
}

describe("gridSequence", () => {
  it("a straight left-to-right drag through the middle row produces \"456\"", () => {
    const path = sample([5, 20, 35, 50, 65, 80], midY);
    expect(gridSequence(path, ZONE)).toBe("456");
  });

  it("a straight right-to-left drag through the middle row produces \"654\"", () => {
    const path = sample([80, 65, 50, 35, 20, 5], midY);
    expect(gridSequence(path, ZONE)).toBe("654");
  });

  it("a straight top-to-bottom drag through the middle column produces \"852\"", () => {
    const path = [90 - 5, 90 - 20, 90 - 35, 90 - 50, 90 - 65, 90 - 80].map((y) => ({ x: midX, y }));
    expect(gridSequence(path, ZONE)).toBe("852");
  });

  it("a straight bottom-to-top drag through the middle column produces \"258\"", () => {
    const path = [5, 20, 35, 50, 65, 80].map((y) => ({ x: midX, y }));
    expect(gridSequence(path, ZONE)).toBe("258");
  });

  it("dedupes consecutive same-cell points from a wiggly (jittery) path", () => {
    // Hand jitter that stays in cell 4 (bottom-left of the middle row... here: col0,row1) for
    // several points before moving on, then jitters again in cell 5, then 6.
    const path: Point[] = [
      { x: 5, y: midY },
      { x: 6, y: midY + 1 },
      { x: 4, y: midY - 1 }, // still cell 4 x3
      { x: 35, y: midY },
      { x: 36, y: midY + 1 }, // still cell 5 x2
      { x: 65, y: midY },
    ];
    expect(gridSequence(path, ZONE)).toBe("456");
  });

  it("non-consecutive repeats of the same cell are NOT collapsed (only consecutive dupes are)", () => {
    const path = sample([5, 35, 5], midY); // cell 4, cell 5, back to cell 4
    expect(gridSequence(path, ZONE)).toBe("454");
  });

  it("an empty path produces the sentinel \"0\"", () => {
    expect(gridSequence([], ZONE)).toBe("0");
  });

  it("clamps out-of-zone points to the nearest edge cell instead of dropping them", () => {
    // Entirely to the right of the zone at mid-height -> clamps to column 2 (rightmost) for every
    // point -> single deduped digit "6".
    const path = sample([100, 150, 200], midY);
    expect(gridSequence(path, ZONE)).toBe("6");
  });
});

describe("dynamic stroke bounds (source minBound/maxBound)", () => {
  it("resamples a sparse quick swipe through the missing middle cell like sub_61a20", () => {
    const sparse: Point[] = [{ x: 120, y: 73 }, { x: 180, y: 73 }];
    const bounds = strokeBounds(sparse, true);
    const resampled = resampleStrokePath(sparse, bounds);
    expect(resampled).toEqual([
      { x: 120, y: 73 },
      { x: 140, y: 73 },
      { x: 160, y: 73 },
      { x: 180, y: 73 },
    ]);
    expect(gridSequence(resampled, bounds)).toBe("456");
  });

  it("rejects shaky clicks whose complete span stays below the source 20pt axis floor", () => {
    const jitter: Point[] = [{ x: 100, y: 70 }, { x: 108, y: 74 }, { x: 103, y: 68 }];
    const bounds = strokeBounds(jitter, true);
    expect(strokeGridAxes(bounds)).toEqual({ useX: false, useY: false });
    expect(gridSequence(resampleStrokePath(jitter, bounds), bounds)).toBe("5");
    expect(matchStroke("5", BATTLE_STROKES)).toBeNull();
  });

  it("resamples an intentional sparse 24pt swipe rather than requiring a 60pt span", () => {
    const sparse: Point[] = [{ x: 120, y: 73 }, { x: 144, y: 73 }];
    const bounds = strokeBounds(sparse, true);
    expect(strokeGridAxes(bounds)).toEqual({ useX: true, useY: false });
    expect(gridSequence(resampleStrokePath(sparse, bounds), bounds)).toBe("456");
  });

  it("suppresses cross-axis shake for strokes more directional than 3:1", () => {
    const bounds: Rect = { x: 0, y: 25, w: 100, h: -25 };
    expect(strokeGridAxes(bounds)).toEqual({ useX: true, useY: false });
  });

  it("recognizes a horizontal stroke at any position without fixed widget bounds", () => {
    const path = sample([120, 150, 180], 73);
    expect(strokeBounds(path, true)).toEqual({ x: 120, y: 73, w: 60, h: 0 });
    expect(gridSequence(path, strokeBounds(path, true))).toBe("456");
  });

  it("flips Pixi Y-down into the source GL Y-up row direction", () => {
    const down: Point[] = [20, 50, 80].map((y) => ({ x: 240, y }));
    const up = [...down].reverse();
    expect(gridSequence(down, strokeBounds(down, true))).toBe("852");
    expect(gridSequence(up, strokeBounds(up, true))).toBe("258");
  });

  it("uses the geometric midpoint consumed by MonsterTurnPanel handleRecognizer", () => {
    const bounds = strokeBounds([{ x: 10, y: 90 }, { x: 70, y: 30 }], true);
    expect({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }).toEqual({ x: 40, y: 60 });
  });
});

describe("matchStroke against BATTLE_STROKES", () => {
  it("matches slot 1 leftToRight", () => {
    expect(matchStroke("456", BATTLE_STROKES)).toBe("leftToRight");
  });

  it("matches slot 2 rightToLeft", () => {
    expect(matchStroke("654", BATTLE_STROKES)).toBe("rightToLeft");
  });

  it("matches slot 3 upToDown", () => {
    expect(matchStroke("852", BATTLE_STROKES)).toBe("upToDown");
  });

  it("matches slot 4 downToUp", () => {
    expect(matchStroke("258", BATTLE_STROKES)).toBe("downToUp");
  });

  it("a path outside the zone (clamped to a single edge digit) matches nothing", () => {
    const path = sample([100, 150, 200], midY); // clamps to "6" per the gridSequence test above
    const seq = gridSequence(path, ZONE);
    expect(matchStroke(seq, BATTLE_STROKES)).toBeNull();
  });

  it("an unrecognized sequence matches nothing", () => {
    expect(matchStroke("159", BATTLE_STROKES)).toBeNull();
  });

  it("anchors the pattern (a matching subsequence inside a longer path does not match)", () => {
    // "1456" contains "456" as a substring but the registered patterns are ^...$ anchored.
    expect(matchStroke("1456", BATTLE_STROKES)).toBeNull();
  });
});
