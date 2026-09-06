import { describe, it, expect } from "vitest";
import { packBox } from "../src/boxLayout.js";





describe("packBox", () => {
  it("packs the bench/retreat/delay row to x=0/45/94 with contentSize (124,30)", () => {
    // followup-layout.md §1.7: bench 30x29.5, retreat 34x30, delay 30x29.5, gap=15pt.
    const r = packBox(
      [
        { w: 30, h: 29.5 },
        { w: 34, h: 30 },
        { w: 30, h: 29.5 },
      ],
      { horizontal: true, gap: 15, positiveAlignDirection: true },
    );
    expect(r.offsets.map((o) => o.x)).toEqual([0, 45, 94]);
    expect(r.contentSize).toEqual({ w: 124, h: 30 });
  });

  it("derives enemy slots x=83/211/339 (3x128-wide slots, gap 0, box width 384)", () => {





    const r = packBox(
      [
        { w: 128, h: 90 },
        { w: 128, h: 90 },
        { w: 128, h: 90 },
      ],
      { horizontal: true, gap: 0, positiveAlignDirection: true },
    );
    expect(r.offsets.map((o) => o.x)).toEqual([0, 128, 256]);
    expect(r.contentSize).toEqual({ w: 384, h: 90 });

    const boxX = 83;
    expect(r.offsets.map((o) => boxX + o.x)).toEqual([83, 211, 339]);
  });

  it("N-1 gaps only; cross-axis = max child", () => {
    const r = packBox(
      [
        { w: 10, h: 5 },
        { w: 20, h: 50 },
        { w: 30, h: 15 },
      ],
      { horizontal: true, gap: 4, positiveAlignDirection: true },
    );
    // 3 children -> exactly 2 gaps: 10+20+30 + 2*4 = 68.
    expect(r.contentSize).toEqual({ w: 68, h: 50 });
    expect(r.offsets.map((o) => o.x)).toEqual([0, 14, 38]);
  });

  it("negative align direction packs in the negative direction", () => {
    const r = packBox(
      [
        { w: 10, h: 5 },
        { w: 10, h: 5 },
      ],
      { horizontal: true, gap: 5, positiveAlignDirection: false },
    );
    // Each child ENDS at its running offset, so the run occupies -25..0 rather than -15..10.
    expect(r.offsets.map((o) => o.x)).toEqual([-10, -25]);
    // Still N-1 gaps only, magnitude-wise: 10+10+1*5 = 25.
    expect(r.contentSize).toEqual({ w: 25, h: 5 });
    expect(r.layoutBounds).toEqual({ x: -25, y: 0, w: 25, h: 5 });
  });

  it("keeps the gap uniform when a negative-direction box's children differ in size", () => {
    // The single-participant XP grid: `sub_65ae0` pre-creates every column array before reading
    // the item count, so one monster yields a 218pt column beside an EMPTY column whose own two
    // (empty) child boxes still charge Box.init's bare 5pt gap. Emitting the bare running offset
    // put the wide column's left edge where its right edge belongs — a whole column width of
    // overhang past the grid's own contentSize, which `performAwardLogic`'s -20pt shift then
    // carried off the popup card and off screen.
    const r = packBox(
      [
        { w: 218, h: 192 },
        { w: 5, h: 0 },
      ],
      { horizontal: true, gap: 5, positiveAlignDirection: false, verticalAlignment: 0 },
    );
    expect(r.offsets).toEqual([
      { x: -218, y: 0 },
      { x: -228, y: 0 },
    ]);
    expect(r.contentSize).toEqual({ w: 228, h: 192 });
    // The invariant that matters to every rebasing consumer: origin + contentSize covers the run.
    expect(r.layoutBounds).toEqual({ x: -228, y: 0, w: 228, h: 192 });
  });

  it("retains the authored XP-grid edge independently of child ink bounds", () => {
    // Two 219pt monster+bar column Boxes, packed toward negative X with the source 5pt gap.
    // The second column begins at -443 and the authored frame is -443..0. A descendant sprite
    // may paint tens of points inside that edge; rebasing from getLocalBounds() would incorrectly
    // discard that cell padding and translate the complete grid.
    const r = packBox(
      [
        { w: 219, h: 192 },
        { w: 219, h: 95 },
      ],
      {
        horizontal: true,
        gap: 5,
        positiveAlignDirection: false,
        verticalAlignment: 0,
      },
    );
    expect(r.offsets).toEqual([
      { x: -219, y: 0 },
      { x: -443, y: 0 },
    ]);
    expect(r.contentSize).toEqual({ w: 443, h: 192 });
    expect(r.layoutBounds).toEqual({ x: -443, y: 0, w: 443, h: 192 });
  });

  it("retains the normalized iPad authored edge after native half-point rounding", () => {
    // Two 100pt normalized children and Box.init's bare native 5pt gap => 2.5 normalized points.
    // Source rounds in native points first, so the signed origin must preserve the half point.
    const r = packBox(
      [
        { w: 100, h: 40 },
        { w: 100, h: 40 },
      ],
      {
        horizontal: true,
        gap: 2.5,
        positiveAlignDirection: false,
        roundingScale: 2,
      },
    );
    expect(r.offsets).toEqual([
      { x: -100, y: 0 },
      { x: -202.5, y: 0 },
    ]);
    expect(r.layoutBounds).toEqual({ x: -202.5, y: 0, w: 202.5, h: 40 });
  });

  it("GapNode override replaces the uniform gap at its slot", () => {
    // followup-layout.md §1.3: a GapNode's advance combined with the previous child's
    // trailing +gap resolves to "use the GapNode's value instead of Box.gap" (no stacking).
    const r = packBox(
      [
        { w: 10, h: 10 },
        { w: 10, h: 10, gapBefore: 100 },
        { w: 10, h: 10 },
      ],
      { horizontal: true, gap: 5, positiveAlignDirection: true },
    );
    expect(r.offsets.map((o) => o.x)).toEqual([0, 110, 125]);
    expect(r.contentSize).toEqual({ w: 135, h: 10 });
  });

  it("offsets are roundf-rounded per child (round-half-away-from-zero, not JS Math.round)", () => {


    const r = packBox(
      [
        { w: 1, h: 1 },
        { w: 1, h: 1 },
      ],
      { horizontal: true, gap: 2.5, positiveAlignDirection: false },
    );
    expect(r.offsets.map((o) => o.x)).toEqual([-1, -5]);
    expect(r.contentSize).toEqual({ w: 5, h: 1 });
  });

  it("packs along the vertical axis into y offsets when horizontal=false", () => {
    const r = packBox(
      [
        { w: 10, h: 10 },
        { w: 10, h: 10 },
      ],
      { horizontal: false, gap: 5, positiveAlignDirection: true },
    );
    expect(r.offsets).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 15 },
    ]);
    expect(r.contentSize).toEqual({ w: 10, h: 25 });
  });

  it("rounds in native iPad points before returning normalized half-points", () => {
    const r = packBox(
      [
        { w: 300, h: 100 },
        { w: 40, h: 40 },
      ],
      {
        horizontal: false,
        gap: 2.5,
        positiveAlignDirection: true,
        roundingScale: 2,
      },
    );
    expect(r.offsets).toEqual([
      { x: 0, y: 0 },
      { x: 130, y: 102.5 },
    ]);
    expect(r.contentSize).toEqual({ w: 300, h: 142.5 });
  });

  it("top-aligns a horizontal box's shorter children under verticalAlignment 0", () => {



    const items = [{ w: 40, h: 192 }, { w: 40, h: 95 }];
    const base = { horizontal: true, gap: 5, positiveAlignDirection: true } as const;
    expect(packBox(items, base).offsets).toEqual([
      { x: 0, y: 0 },
      { x: 45, y: 49 }, // default "skip" sentinel: cross-CENTERED, roundf((192-95)/2) = 49
    ]);
    expect(packBox(items, { ...base, verticalAlignment: 0 }).offsets).toEqual([
      { x: 0, y: 0 },
      { x: 45, y: 0 },
    ]);
    expect(packBox(items, { ...base, verticalAlignment: 1 }).offsets).toEqual([
      { x: 0, y: 0 },
      { x: 45, y: 97 },
    ]);
    // contentSize is authored by `setContentSize:` BEFORE the alignment pass, so it never moves.
    expect(packBox(items, { ...base, verticalAlignment: 0 }).contentSize).toEqual({ w: 85, h: 192 });
  });

  it("start/end-aligns a vertical box's narrower children under horizontalAlignment", () => {
    const items = [{ w: 200, h: 10 }, { w: 60, h: 10 }];
    const base = { horizontal: false, gap: 5, positiveAlignDirection: true } as const;
    expect(packBox(items, { ...base, horizontalAlignment: 0 }).offsets[1]).toEqual({ x: 0, y: 15 });
    expect(packBox(items, { ...base, horizontalAlignment: 1 }).offsets[1]).toEqual({ x: 140, y: 15 });
  });

  it("refuses to guess the source's primary-axis alignment displacement", () => {
    expect(() => packBox([{ w: 1, h: 1 }], {
      horizontal: true,
      gap: 5,
      positiveAlignDirection: true,
      horizontalAlignment: 0,
    })).toThrow(/PRIMARY axis/);
    expect(() => packBox([{ w: 1, h: 1 }], {
      horizontal: false,
      gap: 5,
      positiveAlignDirection: true,
      verticalAlignment: 1,
    })).toThrow(/PRIMARY axis/);
  });

  it("measures an empty box as one gap on its primary axis", () => {
    // The source subtracts a trailing gap that a childless box never accumulated.
    expect(packBox([], { horizontal: true, gap: 5, positiveAlignDirection: false }).contentSize)
      .toEqual({ w: 5, h: 0 });
    expect(packBox([], { horizontal: false, gap: 2, positiveAlignDirection: true }).contentSize)
      .toEqual({ w: 0, h: 2 });
    // No children ⇒ no authored frame to rebase from.
    expect(packBox([], { horizontal: false, gap: 2, positiveAlignDirection: true }).layoutBounds)
      .toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("rejects invalid source-rounding scales", () => {
    expect(() => packBox([], {
      horizontal: true,
      gap: 5,
      positiveAlignDirection: true,
      roundingScale: 0,
    })).toThrow(/roundingScale must be finite and positive/);
  });
});
