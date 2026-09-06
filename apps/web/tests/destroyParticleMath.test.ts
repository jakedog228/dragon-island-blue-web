import { describe, expect, it } from "vitest";
import {
  advanceDestroyParticleEmission,
  destroyParticlePlacement,
  destroyParticleLifetimeMs,
  destroyParticleSizePt,
} from "../src/world/destroyParticleMath.js";

describe("destroyParticleMath", () => {
  // The destructive card's emitter is a CCParticleSystemPoint: sizes are GL point sizes in
  // FRAMEBUFFER PIXELS, so they divide by the uniform CSF and are identical on both device tiers.
  // Regression guard: routing them through the per-idiom source-point conversion instead doubled
  // them in iPhone mode (4x area, 300 saturated additive particles burying the monster art).
  it("converts CCParticleSystemPoint pixel sizes by the uniform CSF, not the idiom scale", () => {
    // Shipped destroy plist: startParticleSize 64 (== GL_POINT_SIZE_MAX), finishParticleSize 10,
    // both with zero variance.
    expect(destroyParticleSizePt(64, 0, -1, 2)).toBe(32);
    expect(destroyParticleSizePt(64, 0, 1, 2)).toBe(32);
    expect(destroyParticleSizePt(10, 0, 0, 2)).toBe(5);
  });

  it("applies size variance and clamps a negative result at zero like initParticle", () => {
    expect(destroyParticleSizePt(64, 20, 1, 2)).toBe(42);
    expect(destroyParticleSizePt(64, 20, -1, 2)).toBe(22);
    expect(destroyParticleSizePt(10, 30, -1, 2)).toBe(0);
  });

  it("rejects a nonpositive content scale factor instead of fabricating a size", () => {
    expect(() => destroyParticleSizePt(64, 0, 0, 0)).toThrow(/content scale factor/);
    expect(() => destroyParticleSizePt(64, 0, 0, Number.NaN)).toThrow(/content scale factor/);
  });

  it("clamps randomized lifetime at zero exactly like CCParticleSystem initParticle", () => {
    expect(destroyParticleLifetimeMs(1, 1.829, -1)).toBe(0);
    expect(destroyParticleLifetimeMs(1, 1.829, 0)).toBe(1000);
    expect(destroyParticleLifetimeMs(1, 1.829, 1)).toBeCloseTo(2829, 10);
  });

  it("starts with no immediate particle and uses the source's strict greater-than interval", () => {
    const rate = 300; // shipped destroy plist: maxParticles 300 / life 1s
    const interval = 1 / rate;
    expect(advanceDestroyParticleEmission(0, 0, rate, 300)).toEqual({
      emitCounterSeconds: 0,
      spawnCount: 0,
    });
    expect(advanceDestroyParticleEmission(0, interval, rate, 300)).toEqual({
      emitCounterSeconds: interval,
      spawnCount: 0,
    });
    const justOver = advanceDestroyParticleEmission(0, interval + 1e-9, rate, 300);
    expect(justOver.spawnCount).toBe(1);
    expect(justOver.emitCounterSeconds).toBeCloseTo(1e-9, 12);
  });

  it("emits multiple particles in one update and respects remaining capacity", () => {
    const rate = 100;
    const uncapped = advanceDestroyParticleEmission(0, 0.035, rate, 99);
    expect(uncapped.spawnCount).toBe(3);
    expect(uncapped.emitCounterSeconds).toBeCloseTo(0.005, 12);
    const capped = advanceDestroyParticleEmission(0, 0.035, rate, 2);
    expect(capped.spawnCount).toBe(2);
    expect(capped.emitCounterSeconds).toBeCloseTo(0.015, 12);
  });

  it("positions from the Box-laid-out renderer root, not an inner sprite", () => {
    const rendererRoot = {
      position: { x: 73, y: -112 },
      scaledContentSize: { w: 86, h: 64 },
    };
    // A centered descendant could independently sit at x=0 with width=120. Those values are
    // intentionally absent from the source formula.
    expect(destroyParticlePlacement(rendererRoot)).toEqual({
      position: { x: 116, y: -48 },
      positionVariance: { x: 43, y: 0 },
    });
  });

  it("rejects invalid renderer-root sizes instead of fabricating a particle origin", () => {
    expect(() => destroyParticlePlacement({
      position: { x: 0, y: 0 },
      scaledContentSize: { w: Number.NaN, h: 10 },
    })).toThrow(/finite and nonnegative/);
    expect(() => destroyParticlePlacement({
      position: { x: 0, y: 0 },
      scaledContentSize: { w: 10, h: -1 },
    })).toThrow(/finite and nonnegative/);
  });
});
