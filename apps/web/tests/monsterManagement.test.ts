import { describe, expect, it } from "vitest";
import {
  COVERFLOW_FRAME_MS,
  MANAGEMENT_BACKGROUND_TINT,
  MANAGEMENT_CARD_SIZE_PT,
  MANAGEMENT_KO_FONT_PT,
  MANAGEMENT_LEVEL_FONT_PT,
  MANAGEMENT_STAR_COUNT_FONT_PT,
  MANAGEMENT_STAR_TEXT_GAP_PT,
  MANAGEMENT_SELECTION_CONTROL_ORDER,
  MANAGEMENT_TITLE_COLOR,
  MANAGEMENT_TITLE_FONT_PT,
  advanceCoverflowIndex,
  advanceCoverflowIndexFrames,
  coverflowEaseFrames,
  presentCoverflowIndex,
  coverflowLayout,
  coverflowProjectedQuad,
  coverflowTouchBoundsX,
  draggedCoverflowIndex,
  pointInCoverflowBounds,
  evolutionProgressPercent,
  managementDetailOpacity,
  managementSelectionControlsLayout,
  managementSummaryBoxPosition,
  managementStyleConfig,
  nearestManagementTouchable,
  showingCoverflowIndex,
  updateSelectionTouchState,
} from "../src/battle/monsterManagementMath.js";

describe("MonsterManagement style-4 CFlow geometry", () => {
  it("projects the 75-degree side card through the source camera on phone and iPad", () => {
    const phone = coverflowProjectedQuad({
      pivot: { x: 240 + 40 + 80 / 3, y: 320 - 130 },
      screen: { w: 480, h: 320 },
      mode: "iphone",
      orbitDeg: 75,
    });
    expect(phone.topLeft.x).toBeCloseTo(289.494690, 5);
    expect(phone.topRight.x).toBeCloseTo(329.668152, 5);
    expect(phone.topLeft.y).toBeCloseTo(116.054657, 5);
    expect(phone.topRight.y).toBeCloseTo(101.788605, 5);
    expect(phone.bottomLeft.y).toBeCloseTo(186.367203, 5);
    expect(phone.bottomRight.y).toBeCloseTo(194.926834, 5);
    expect(phone.bottomRight.y - phone.topRight.y)
      .toBeGreaterThan(phone.bottomLeft.y - phone.topLeft.y);

    // The source-native iPad baseline is 300px = 150 normalized points. Its larger screen eye
    // distance changes the trapezoid; this is intentionally not copied from the phone tier.
    const ipad = coverflowProjectedQuad({
      pivot: { x: 256 + 40 + 80 / 3, y: 384 - 150 },
      screen: { w: 512, h: 384 },
      mode: "ipad",
      orbitDeg: 75,
    });
    expect(ipad.topLeft.x).toBeCloseTo(306.526581, 5);
    expect(ipad.topRight.x).toBeCloseTo(343.306274, 5);
    expect(ipad.topLeft.y).toBeCloseTo(157.905228, 5);
    expect(ipad.topRight.y).toBeCloseTo(148.924637, 5);
    expect(ipad.bottomLeft.y).toBeCloseTo(229.683701, 5);
    expect(ipad.bottomRight.y).toBeCloseTo(239.609604, 5);
  });

  it("keeps the selected card rectangular and continuously projects a half-drag orbit", () => {
    const selected = coverflowProjectedQuad({
      pivot: { x: 240, y: 190 },
      screen: { w: 480, h: 320 },
      mode: "iphone",
      orbitDeg: 0,
    });
    // The source retains the 0.1645% mismatch between its true 60-degree frustum focal length
    // and cocos2d's rounded 1.1566f eye constant, even when the orbit itself is face-on.
    expect(selected.topLeft.x).toBeCloseTo(199.934204, 5);
    expect(selected.topLeft.y).toBeCloseTo(109.917747, 5);
    expect(selected.topLeft.depthRatio).toBe(1);
    expect(selected.bottomRight.x).toBeCloseTo(280.065796, 5);
    expect(selected.bottomRight.y).toBeCloseTo(190.049347, 5);
    expect(selected.bottomRight.depthRatio).toBe(1);

    const halfDrag = coverflowLayout(1, 0.5);
    const projected = coverflowProjectedQuad({
      pivot: { x: 240 + halfDrag.x, y: 190 },
      screen: { w: 480, h: 320 },
      mode: "iphone",
      orbitDeg: halfDrag.orbitDeg,
    });
    expect(projected.topLeft.x).toBeCloseTo(241.472260, 5);
    expect(projected.topRight.x).toBeCloseTo(311.464203, 5);
    expect(projected.bottomRight.y).toBeCloseTo(192.949280, 5);
  });

  it("uses the exact selected and three-side-card positions, orbit, and opacity", () => {
    expect(MANAGEMENT_CARD_SIZE_PT).toBe(80);
    expect(coverflowLayout(0, 0)).toEqual({ visible: true, x: 0, opacity: 255, orbitDeg: 0, zIndex: 4 });
    expect(coverflowLayout(1, 0)).toMatchObject({
      visible: true,
      opacity: 223,
      orbitDeg: 75,
      zIndex: 2,
    });
    expect(coverflowLayout(1, 0).x).toBeCloseTo(40 + 80 / 3);
    expect(coverflowLayout(2, 0)).toMatchObject({
      visible: true,
      opacity: 191,
      orbitDeg: 75,
      zIndex: 1,
    });
    expect(coverflowLayout(2, 0).x).toBeCloseTo(40 + 160 / 3);
    expect(coverflowLayout(3, 0)).toEqual({ visible: true, x: 120, opacity: 159, orbitDeg: 75, zIndex: 0 });
    expect(coverflowLayout(4, 0).visible).toBe(false);
  });

  it("linearly blends the two integer layouts while easing toward the selected card", () => {
    expect(coverflowLayout(0, 0.5)).toMatchObject({
      visible: true,
      opacity: 239,
      orbitDeg: -37.5,
      zIndex: 2,
    });
    expect(coverflowLayout(0, 0.5).x).toBeCloseTo(-(40 + 80 / 3) / 2);
    expect(coverflowLayout(1, 0.5)).toMatchObject({
      visible: true,
      opacity: 239,
      orbitDeg: 37.5,
      zIndex: 4,
    });
    expect(coverflowLayout(1, 0.5).x).toBeCloseTo((40 + 80 / 3) / 2);
    expect(advanceCoverflowIndex(0, 1)).toBeCloseTo(0.1, 6);
    expect(showingCoverflowIndex(0.49, 3)).toBe(0);
    expect(showingCoverflowIndex(0.5, 3)).toBe(1);
  });

  it("continues through the adjacent off-window geometry before toggling visibility", () => {


    const justBeforeMidpoint = coverflowLayout(0, 3.49);
    expect(justBeforeMidpoint.visible).toBe(true);
    expect(justBeforeMidpoint.x).toBeCloseTo(
      -120 * 0.51 - (40 + (4 * 80) / 3) * 0.49,
    );
    expect(justBeforeMidpoint.x).toBeLessThan(-120);
    expect(justBeforeMidpoint.opacity).toBe(144);
    expect(justBeforeMidpoint.orbitDeg).toBe(-75);

    // roundf flips the visible window at the midpoint. Geometry remains continuous while the
    // card becomes hidden, matching the source's setVisible-before-layout control flow.
    const atMidpoint = coverflowLayout(0, 3.5);
    expect(atMidpoint.visible).toBe(false);
    expect(atMidpoint.x).toBeCloseTo(-120 * 0.5 - (40 + (4 * 80) / 3) * 0.5);
    expect(atMidpoint.opacity).toBe(143);
    expect(atMidpoint.orbitDeg).toBe(-75);

    const incoming = coverflowLayout(4, 0.49);
    expect(incoming.visible).toBe(false);
    expect(incoming.x).toBeGreaterThan(120);
    expect(coverflowLayout(4, 0.5).visible).toBe(true);
  });

  it("latches selection false after any excursion beyond the exact source threshold", () => {
    expect(updateSelectionTouchState({
      selectable: true, startX: 0, startY: 0, currentX: 12, currentY: 9, threshold: 15,
    })).toBe(true); // exactly 15 remains a selection touch
    expect(updateSelectionTouchState({
      selectable: true, startX: 0, startY: 0, currentX: 12.01, currentY: 9, threshold: 15,
    })).toBe(false);
    expect(updateSelectionTouchState({
      selectable: false, startX: 0, startY: 0, currentX: 0, currentY: 0, threshold: 15,
    })).toBe(false);
  });

  it("ports ccTouchMoved's width-normalized drag, lag gain, and safe-index clamp", () => {
    expect(draggedCoverflowIndex({
      anchorIndex: 0,
      startX: 240,
      currentX: 160,
      selectedIndex: 0,
      actualSelectedIndex: 0,
      itemCount: 3,
    })).toBe(1);
    expect(draggedCoverflowIndex({
      anchorIndex: 1,
      startX: 240,
      currentX: 400,
      selectedIndex: 0,
      actualSelectedIndex: 1,
      itemCount: 3,
    })).toBe(0);
    expect(draggedCoverflowIndex({
      anchorIndex: 1,
      startX: 240,
      currentX: 0,
      selectedIndex: 0,
      actualSelectedIndex: 1,
      itemCount: 3,
    })).toBe(2);
  });

  it("paces the 90/10 blend at the source's fixed 1/60s animation interval", () => {
    expect(COVERFLOW_FRAME_MS).toBe(1000 / 60);


    const frame = COVERFLOW_FRAME_MS;
    expect(coverflowEaseFrames(frame)).toEqual({ frames: 1, remainderMs: 0 });
    // A 144Hz display delivers ~6.94ms ticks: the blend must skip most of them, not run on each.
    // This is the LOGICAL sampling lane only -- what the browser DRAWS on the skipped ticks is
    // `presentCoverflowIndex`'s job, asserted in the presentation test below.
    const hz144 = 1000 / 144;
    expect(coverflowEaseFrames(hz144).frames).toBe(0);
    expect(coverflowEaseFrames(hz144 * 2).frames).toBe(0);
    expect(coverflowEaseFrames(hz144 * 3).frames).toBe(1);
    // Remainders carry, so 144 ticks of 1/144s still yield exactly 60 source frames.
    let carry = 0;
    let frames = 0;
    for (let tick = 0; tick < 144; tick += 1) {
      const step = coverflowEaseFrames(carry + hz144);
      carry = step.remainderMs;
      frames += step.frames;
    }
    expect(frames).toBe(60);
    // A long stall spends its whole budget at once rather than dropping it. Native's `update:`
    // ignores dt and would blend ONCE on the resumed draw, so a stalled device's glide slows in
    // wall-clock; the port keeps wall-clock rate instead. Deliberate divergence, confined to
    // frames the browser missed entirely -- and bounded, since Pixi clamps `deltaMS` to its
    // `minFPS` ceiling of 100ms (six source frames).
    expect(coverflowEaseFrames(frame * 4 + 1)).toEqual({ frames: 4, remainderMs: 1 });
    expect(coverflowEaseFrames(0)).toEqual({ frames: 0, remainderMs: 0 });
    expect(coverflowEaseFrames(-5)).toEqual({ frames: 0, remainderMs: 0 });

    // Frame-stepping is exactly repeated single blends, and zero frames is a hold.
    expect(advanceCoverflowIndexFrames(0, 4, 0)).toBe(0);
    expect(advanceCoverflowIndexFrames(0, 4, 1)).toBe(advanceCoverflowIndex(0, 4));
    expect(advanceCoverflowIndexFrames(0, 4, 3))
      .toBe(advanceCoverflowIndex(advanceCoverflowIndex(advanceCoverflowIndex(0, 4), 4), 4));
  });

  it("draws a fresh CFlow position on every browser frame between source frames", () => {
    const frame = COVERFLOW_FRAME_MS;
    // Endpoints are the source's own exact float32 samples, not an independent estimate.
    expect(presentCoverflowIndex(0, 4, 0)).toBe(0);
    expect(presentCoverflowIndex(0, 4, frame)).toBe(advanceCoverflowIndex(0, 4));
    // A settled flow has nothing to interpolate.
    expect(presentCoverflowIndex(3, 3, frame / 2)).toBe(3);
    // Interpolation stays strictly inside the bracketing source samples.
    const mid = presentCoverflowIndex(0, 4, frame / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(advanceCoverflowIndex(0, 4));

    // The defect this guards: at every refresh rate, each positive browser tick must MOVE the
    // drawn position while the flow is unsettled. Whole-source-frame stepping alone repeated the
    // previous transform on 33% of 90Hz frames and 58% of 144Hz frames.
    for (const hz of [60, 90, 120, 144, 165, 240]) {
      const tick = 1000 / hz;
      let carry = 0;
      let logical = 0;
      let drawn = 0;
      let sourceFrames = 0;
      for (let i = 0; i < hz; i += 1) {
        const ease = coverflowEaseFrames(carry + tick);
        carry = ease.remainderMs;
        sourceFrames += ease.frames;
        logical = advanceCoverflowIndexFrames(logical, 4, ease.frames);
        const next = presentCoverflowIndex(logical, 4, carry);
        expect(next, `held frame at ${hz}Hz tick ${i}`).toBeGreaterThan(drawn);
        expect(next).toBeLessThanOrEqual(4);
        drawn = next;
      }
      // ...while the logical lane still samples the source exactly 60 times per second.
      expect(sourceFrames, `${hz}Hz source frames`).toBe(60);
      expect(logical).toBe(advanceCoverflowIndexFrames(0, 4, 60));
    }
  });

  it("keeps the source lane exact at frame boundaries regardless of refresh rate", () => {
    // 144 ticks of 1/144s and 60 ticks of 1/60s must land on the same source sample, and the
    // presentation lane must not feed back into it.
    const settle = (hz: number) => {
      const tick = 1000 / hz;
      let carry = 0;
      let logical = 0;
      for (let i = 0; i < hz; i += 1) {
        const ease = coverflowEaseFrames(carry + tick);
        carry = ease.remainderMs;
        logical = advanceCoverflowIndexFrames(logical, 4, ease.frames);
        presentCoverflowIndex(logical, 4, carry);
      }
      return logical;
    };
    expect(settle(144)).toBe(settle(60));
    expect(settle(165)).toBe(settle(60));
  });

  it("accumulates updateValues' touch band from the visible cards only", () => {
    // Settled seven-card arrangement: the outermost visible card sits at +/-120, and each card
    // contributes its UNSCALED 80pt background width, so the band is the full +/-160 arc.
    const settled = [0, 1, 2, 3, 4, 5, 6].map((index) => {
      const layout = coverflowLayout(index, 3);
      return { visible: layout.visible, x: layout.x };
    });
    expect(coverflowTouchBoundsX(settled)).toEqual({ left: -160, right: 160 });

    // Cards outside the three-per-side window never widen the band.
    const nineCards = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => {
      const layout = coverflowLayout(index, 4);
      return { visible: layout.visible, x: layout.x };
    });
    expect(coverflowTouchBoundsX(nineCards)).toEqual({ left: -160, right: 160 });

    // A short list is genuinely narrower, and the band is asymmetric when the arc is: at the head
    // of the list only the right side has cards. rightBounds' 0.0f seed never goes negative.
    const headOfList = [0, 1, 2].map((index) => {
      const layout = coverflowLayout(index, 0);
      return { visible: layout.visible, x: layout.x };
    });
    expect(coverflowTouchBoundsX(headOfList)).toEqual({
      left: -40,
      right: 133.33333587646484,
    });

    // No visible cards keeps the 9999/0 seeds, which reject every point.
    expect(coverflowTouchBoundsX([{ visible: false, x: 0 }])).toEqual({ left: 9999, right: 0 });
  });

  it("hit-tests isPointInBounds inclusively over that band and the card footprint", () => {
    const bounds = { left: -160, right: 160 };
    const at = (x: number, y: number): boolean =>
      pointInCoverflowBounds({ x, y, originX: 240, originY: 100, bounds });


    expect(at(240 + 159, 100)).toBe(true);
    expect(at(240 - 160, 100)).toBe(true); // inclusive edge
    expect(at(240 + 161, 100)).toBe(false);
    // Y spans exactly one card height, centred on the port's card centre.
    expect(at(240, 100 + 40)).toBe(true);
    expect(at(240, 100 - 40)).toBe(true);
    expect(at(240, 100 + 41)).toBe(false);
    // An empty flow's seeds reject everything, including its own origin.
    expect(pointInCoverflowBounds({
      x: 240, y: 100, originX: 240, originY: 100, bounds: { left: 9999, right: 0 },
    })).toBe(false);
  });
});

describe("MonsterManagement source constants and style table", () => {
  it("floors touchableNodes to 55pt and resolves overlapping controls by nearest centre", () => {
    const controls = [
      { value: "select", rect: { x: 100, y: 260, w: 24, h: 14 } },
      { value: "close", rect: { x: 150, y: 260, w: 22, h: 14 } },
    ] as const;


    expect(nearestManagementTouchable(controls, { x: 112, y: 245 })).toBe("select");
    expect(nearestManagementTouchable(controls, { x: 161, y: 245 })).toBe("close");

    expect(nearestManagementTouchable(controls, { x: 136, y: 267 })).toBe("select");
    expect(nearestManagementTouchable(controls, { x: 138, y: 267 })).toBe("close");
    expect(nearestManagementTouchable(controls, { x: 220, y: 267 })).toBeUndefined();
  });

  it("gives the style-4 close sprite the same 55pt touchableNodes floor", () => {
    const close = [{ value: "close", rect: { x: 448, y: 10, w: 22, h: 22 } }] as const;
    expect(nearestManagementTouchable(close, { x: 432, y: -5 })).toBe("close");
    expect(nearestManagementTouchable(close, { x: 420, y: -5 })).toBeUndefined();
  });

  it("pins the onEnter background tint and the raw-decoded label constants", () => {


    expect(MANAGEMENT_BACKGROUND_TINT).toBe(0x505050);
    expect(MANAGEMENT_TITLE_COLOR).toBe(0x93cddd);
    expect(MANAGEMENT_TITLE_FONT_PT).toBe(16);
    expect(MANAGEMENT_STAR_COUNT_FONT_PT).toBe(16);
    expect(MANAGEMENT_LEVEL_FONT_PT).toBe(18);
    expect(MANAGEMENT_STAR_TEXT_GAP_PT).toBe(2);
    expect(MANAGEMENT_KO_FONT_PT).toBe(30);
  });

  it("maps every style to its decoded title/editability/chrome shape (init @ 0xab498)", () => {
    expect(managementStyleConfig(0)).toEqual({
      titleKey: "TownGroupKey",
      editable: true,
      hasReservesRow: true,
      hasSelectButton: false,
      hasCloseButton: true,
      hasEditorToolbox: true,
    });
    expect(managementStyleConfig(1)).toEqual({
      titleKey: "TownGroupKey",
      editable: true,
      hasReservesRow: false,
      hasSelectButton: false,
      hasCloseButton: true,
      hasEditorToolbox: true,
    });
    expect(managementStyleConfig(2)).toMatchObject({
      titleKey: "MonsterpediaSelectionTitleKey",
      editable: false,
      hasSelectButton: true,
      hasCloseButton: true,
    });
    expect(managementStyleConfig(3)).toMatchObject({
      titleKey: "RepeatEggSelectionTitleKey",
      editable: false,
      hasSelectButton: true,
      hasCloseButton: false,
    });
    expect(managementStyleConfig(4)).toEqual({
      titleKey: "MonsterpediaViewOnlyTitleKey",
      editable: false,
      hasReservesRow: false,
      hasSelectButton: false,
      hasCloseButton: true,
      hasEditorToolbox: false,
    });
  });

  it("normalizes the source style-2 text-control row for both display idioms", () => {
    expect(MANAGEMENT_SELECTION_CONTROL_ORDER).toEqual(["select", "cancel"]);
    const phone = managementSelectionControlsLayout("iphone");
    expect(phone.fontPt).toBe(14);
    expect(phone.gapPt).toBe(30);
    expect(phone.roundingScale).toBe(1);
    expect(phone.cocosCenterY).toBe(60);
    expect(phone.positionForSize({ w: 180, h: 20 })).toEqual({ x: 150, y: 250 });

    const pad = managementSelectionControlsLayout("ipad");
    expect(pad.fontPt).toBe(12);
    expect(pad.gapPt).toBe(30);
    expect(pad.roundingScale).toBe(2);
    expect(pad.cocosCenterY).toBe(120);
    expect(pad.positionForSize({ w: 180, h: 20 })).toEqual({ x: 166, y: 254 });
  });
});

describe("MonsterManagement selected-monster detail", () => {
  it("centers the native star/count/level Box on its detail origin in both display idioms", () => {
    // The dimensions are normalized phone/iPad examples; the source formula itself is the same
    // after normalization. The former `y=-height` conversion put each row half its height high.
    const iphoneSummarySize = { w: 88, h: 18 };
    const ipadSummarySize = { w: 52, h: 9 };
    expect(managementSummaryBoxPosition(iphoneSummarySize)).toEqual({ x: -44, y: -9 });
    expect(managementSummaryBoxPosition(ipadSummarySize)).toEqual({ x: -26, y: -4.5 });
  });

  it("uses the source evolution range, rounding, and 1..99 clamp", () => {
    expect(evolutionProgressPercent(1, 28, 1)).toBe(1);
    expect(evolutionProgressPercent(14, 28, 1)).toBe(48);
    expect(evolutionProgressPercent(27, 28, 1)).toBe(96);
    expect(evolutionProgressPercent(30, 28, 1)).toBe(99);
    expect(evolutionProgressPercent(1, 30, 6)).toBe(1);
  });

  it("alternates summary/evolution with 2s holds and 0.2s cross-fades", () => {
    expect(managementDetailOpacity(0)).toEqual({ summary: 1, evolution: 0 });
    expect(managementDetailOpacity(2100)).toEqual({ summary: 0.5, evolution: 0.5 });
    expect(managementDetailOpacity(2200)).toEqual({ summary: 0, evolution: 1 });
    expect(managementDetailOpacity(4300)).toEqual({ summary: 0.5, evolution: 0.5 });
    expect(managementDetailOpacity(4400)).toEqual({ summary: 1, evolution: 0 });
  });
});
