import { describe, it, expect } from "vitest";
import {
  applyStatusCountDelta,
  STATUS_SPAWN_INTERVAL_S,
  STATUS_DRIFT_SCALE_DURATION_S,
  STATUS_FADE_DELAY_S,
  STATUS_FADE_DURATION_S,
  STATUS_SPAWN_TARGET_SCALE,
  STATUS_DRIFT_BASE,
  statusSpawnIntervalMs,
  statusDriftScaleDurationMs,
  statusFadeDelayMs,
  statusFadeDurationMs,
  statusDriftOffset,
  statusAnchorFraction,
  cocosContentFractionToPixiLocalOffset,
  paralyzeBoltLayout,
  PARALYZE_SHAKE_MS,
  PARALYZE_SHAKE_OFFSET,
  poisonSpawnIntervalMs,
  advancePoisonEmission,
  poisonParticleLifeS,
  poisonSpatialIdiomScale,
  IMAGE_EFFECT_DEFAULT_LENGTH_S,
  IMAGE_EFFECT_FADE_MS,
  imageEffectHoldMs,
  buffTargetPhaseKey,
} from "../src/battle/statusOverlayMath.js";


describe("applyStatusCountDelta (transition-counted tracker, §1)", () => {
  it("0 -> 1 is a show transition", () => {
    expect(applyStatusCountDelta(0, 1)).toEqual({ count: 1, transition: "show" });
  });

  it("1 -> 2 (stacking a second same-status buff) is NOT a transition", () => {
    expect(applyStatusCountDelta(1, 1)).toEqual({ count: 2, transition: "none" });
  });

  it("2 -> 3 stays none", () => {
    expect(applyStatusCountDelta(2, 1)).toEqual({ count: 3, transition: "none" });
  });

  it("3 -> 2 (removing one of several stacked buffs) is NOT a hide transition", () => {
    expect(applyStatusCountDelta(3, -1)).toEqual({ count: 2, transition: "none" });
  });

  it("1 -> 0 is a hide transition", () => {
    expect(applyStatusCountDelta(1, -1)).toEqual({ count: 0, transition: "hide" });
  });

  it("0 -> -1 clamps at 0 instead of going negative (defensive assert equivalent)", () => {
    expect(applyStatusCountDelta(0, -1)).toEqual({ count: 0, transition: "none" });
  });

  it("a full add-then-remove round trip on a single buff shows then hides exactly once", () => {
    let count = 0;
    const shows: string[] = [];
    for (const delta of [1, 1, -1, -1] as const) {
      const r = applyStatusCountDelta(count, delta);
      count = r.count;
      if (r.transition !== "none") shows.push(r.transition);
    }
    expect(shows).toEqual(["show", "hide"]);
    expect(count).toBe(0);
  });
});

describe("Sleep/Confuse periodic spawner (status-effects-exact-sleep.md)", () => {
  it("transcribes the register-confirmed literals", () => {
    expect(STATUS_SPAWN_INTERVAL_S).toBe(0.8);
    expect(STATUS_DRIFT_SCALE_DURATION_S).toBe(2.4);
    expect(STATUS_FADE_DELAY_S).toBe(1.2);
    expect(STATUS_FADE_DURATION_S).toBe(1.2);
    expect(STATUS_SPAWN_TARGET_SCALE).toBe(0.4);
  });

  it("ms helpers convert seconds to ms exactly", () => {
    expect(statusSpawnIntervalMs()).toBe(800);
    expect(statusDriftScaleDurationMs()).toBe(2400);
    expect(statusFadeDelayMs()).toBe(1200);
    expect(statusFadeDurationMs()).toBe(1200);
  });

  // §5's closed form: drift.x = Xbase*(0.8 + 0.4*RND) (always rightward, one draw), drift.y =
  // -Ybase exactly (always up in this port's Y-down space, NO randomization).
  it("statusDriftOffset: x = 20*(0.8+0.4*rand), y = -40 exactly", () => {
    expect(STATUS_DRIFT_BASE).toEqual({ x: 20, y: 40 });
    expect(statusDriftOffset(() => 0)).toEqual({ x: 16, y: -40 });
    expect(statusDriftOffset(() => 0.5)).toEqual({ x: 20, y: -40 });
    // rand -> 1 is exclusive in arc4random()*2^-32 but bounds the range: x < 24.
    expect(statusDriftOffset(() => 0.999999).x).toBeLessThan(24);
  });

  it("statusDriftOffset consumes exactly ONE rand draw, for x only", () => {
    let draws = 0;
    const counting = (): number => {
      draws += 1;
      return 0.25;
    };
    const drift = statusDriftOffset(counting);
    expect(draws).toBe(1);
    expect(drift.y).toBe(-40); // y untouched by the draw
  });

  it("y drift never varies across draws (flat device constant)", () => {
    for (const r of [0, 0.3, 0.7, 0.999]) {
      expect(statusDriftOffset(() => r).y).toBe(-40);
    }
  });
});

describe("overlay anchor fraction (register-verified for all four classes)", () => {
  it("Sleep/Paralyze/Confuse anchor at (0.5*w, 0.9*h)", () => {
    expect(statusAnchorFraction("Sleep")).toEqual({ x: 0.5, y: 0.9 });
    expect(statusAnchorFraction("Paralyze")).toEqual({ x: 0.5, y: 0.9 });
    expect(statusAnchorFraction("Confuse")).toEqual({ x: 0.5, y: 0.9 });
  });

  it("Poison anchors at (0.5*w, 0.6*h)", () => {
    expect(statusAnchorFraction("Poison")).toEqual({ x: 0.5, y: 0.6 });
  });

  it("cocosContentFractionToPixiLocalOffset converts a Cocos bottom-left fraction into a Pixi Y-flipped anchor-relative offset", () => {
    // 100x200 node, Pixi anchor (0.5,0.5): fraction (0.5,0.9) -> x=0 (centered), y = -(0.9-0.5)*200 = -80
    // (negative Pixi y = further UP on screen, matching "near the top of the box").
    expect(cocosContentFractionToPixiLocalOffset(100, 200, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.9 })).toEqual({
      x: 0,
      y: -80,
    });
    // Poison's lower fraction (0.6) sits closer to center than Sleep's (0.9).
    const poison = cocosContentFractionToPixiLocalOffset(100, 200, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 });
    expect(poison.x).toBe(0);
    expect(poison.y).toBeCloseTo(-20, 9);
    expect(Math.abs(poison.y)).toBeLessThan(80);
  });

  it("a (0,0) Pixi anchor (top-left, e.g. a raw content container) shifts the whole fraction, no anchor subtraction", () => {
    expect(cocosContentFractionToPixiLocalOffset(100, 200, { x: 0, y: 0 }, { x: 0.5, y: 0.9 })).toEqual({
      x: 50,
      y: -180,
    });
  });
});

describe("ParalyzeEffect bolt cluster (status-effects-exact-paralyze.md — NOT a symmetric fan)", () => {
  it("left bolt at (-boltW, 0) rotated -65deg (bit-exact 0xc2820000 — not the old -64.5 misread)", () => {
    const [left] = paralyzeBoltLayout(30, 42);
    expect(left).toEqual({ position: { x: -30, y: 0 }, rotationDeg: -65.0 });
  });

  it("top bolt at (0, -boltH/2) with NO rotation (no setRotation: call exists for it)", () => {
    const [, top] = paralyzeBoltLayout(30, 42);
    expect(top).toEqual({ position: { x: 0, y: -21 }, rotationDeg: 0 });
  });

  it("right bolt at (+boltW, 0) rotated +45deg (not a mirror of the left's -65)", () => {
    const [, , right] = paralyzeBoltLayout(30, 42);
    expect(right).toEqual({ position: { x: 30, y: 0 }, rotationDeg: 45.0 });
  });

  it("exactly 3 bolts", () => {
    expect(paralyzeBoltLayout(10, 10)).toHaveLength(3);
  });

  it("shake matches shakeNodeActionWithDuration:0.5 offset:(2.0, 4.0) — asymmetric axes", () => {
    expect(PARALYZE_SHAKE_MS).toBe(500);
    expect(PARALYZE_SHAKE_OFFSET).toEqual({ x: 2.0, y: 4.0 });
  });
});

describe("PoisonEffect emitter model (status-effects-exact-poison.md §A4)", () => {
  it("spawn interval = 1/emissionRate = particleLifespan / maxParticles, in ms", () => {
    expect(poisonSpawnIntervalMs(50, 0.5)).toBeCloseTo(10, 9);
    expect(poisonSpawnIntervalMs(10, 1)).toBeCloseTo(100, 9);
    // The real config: ~152 particles/sec -> ~6.58ms interval (multiple spawns per 60Hz frame).
    expect(poisonSpawnIntervalMs(50, 0.32894736528396606)).toBeCloseTo(6.579, 3);
  });

  it("throws (fail-loud) on a non-positive maxParticles or particleLifespan", () => {
    expect(() => poisonSpawnIntervalMs(0, 1)).toThrow(/invalid maxParticles/);
    expect(() => poisonSpawnIntervalMs(10, 0)).toThrow(/invalid maxParticles/);
    expect(() => poisonSpawnIntervalMs(10, -1)).toThrow(/invalid maxParticles/);
  });

  it("emits only after the strict native threshold and respects capacity", () => {
    expect(advancePoisonEmission(0, 0.01, 100, 10)).toEqual({ counterSeconds: 0.01, spawnCount: 0 });
    expect(advancePoisonEmission(0, 0.010001, 100, 10).spawnCount).toBe(1);
    const capped = advancePoisonEmission(0, 0.1, 100, 2);
    expect(capped.spawnCount).toBe(2);
    expect(capped.counterSeconds).toBeCloseTo(0.08, 9);
  });

  it("per-particle life = base + variance*rand(-1,1), clamped at 0", () => {
    // rand=0 -> -1 draw -> base - variance, clamped to 0 for the real config (variance > base).
    expect(poisonParticleLifeS(0.329, 0.855, () => 0)).toBe(0);
    // rand=1 -> +1 draw -> base + variance.
    expect(poisonParticleLifeS(0.329, 0.855, () => 1)).toBeCloseTo(1.184, 9);
    // rand=0.5 -> 0 draw -> exactly base.
    expect(poisonParticleLifeS(0.329, 0.855, () => 0.5)).toBeCloseTo(0.329, 9);
  });

  it("spatial idiom scale: CSF=2 on iPhone is 1:1 in normalized points; CSF=1 on iPad halves", () => {
    expect(poisonSpatialIdiomScale("iphone")).toBe(1);
    expect(poisonSpatialIdiomScale("ipad")).toBe(0.5);
  });
});

describe("ImageEffectBuilder timing (§7 item 4)", () => {
  it("defaults length to 1.0s when absent", () => {
    expect(IMAGE_EFFECT_DEFAULT_LENGTH_S).toBe(1.0);
    expect(imageEffectHoldMs(undefined)).toBe(1000);
  });

  it("uses an authored length verbatim", () => {
    expect(imageEffectHoldMs(2.5)).toBe(2500);
  });

  it("the trailing fade-remove is a hardcoded 0.25s, independent of length", () => {
    expect(IMAGE_EFFECT_FADE_MS).toBe(250);
  });
});

describe("buffAdded phase-dict selection (§7 item 2)", () => {
  it("same-team buff (self/ally) selects friendlyTargetEventData", () => {
    expect(buffTargetPhaseKey(true)).toBe("friendlyTargetEventData");
  });

  it("cross-team buff (a debuff landed on an enemy) selects enemyTargetEventData", () => {
    expect(buffTargetPhaseKey(false)).toBe("enemyTargetEventData");
  });
});
