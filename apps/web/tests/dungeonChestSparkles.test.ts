import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "DIB test", platform: "Win32" },
    });
  }
});

vi.mock("pixi.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pixi.js")>();
  class Geometry {
    readonly topology: string;
    private readonly buffers = new Map<string, { update(): void }>();
    constructor(options: { attributes?: Record<string, unknown>; topology?: string } = {}) {
      this.topology = options.topology ?? "triangle-list";
      for (const key of Object.keys(options.attributes ?? {})) this.buffers.set(key, { update() {} });
    }
    getBuffer(name: string) { return this.buffers.get(name)!; }
    destroy() {}
  }
  class Shader {
    static from() { return new Shader(); }
    destroy() {}
  }
  class State {
    static for2d() { return new State(); }
  }
  class Mesh extends actual.Container {
    constructor(readonly options: { geometry: Geometry; shader: Shader }) { super(); }
    get geometry() { return this.options.geometry; }
  }
  return { ...actual, Geometry, Shader, State, Mesh };
});

import { Container, Texture } from "pixi.js";
import type { ParticleAsset } from "@dib/renderer";
import {
  DungeonChestSparkles,
  advanceDungeonSparkleEmission,
  dungeonChestSparklePlacement,
  dungeonSparkleFramebufferSize,
} from "../src/dungeon/dungeonChestSparkles.js";

const sparkleConfig = Object.freeze({
  maxParticles: 18,
  particleLifespan: 0.8553000092506409,
  particleLifespanVariance: 0.05999999865889549,
  duration: -1,
  emitterType: 0,
  angle: 0,
  angleVariance: 360,
  speed: 10,
  speedVariance: 0.1000000014901161,
  gravityx: 0,
  gravityy: 0,
  radialAcceleration: 0,
  radialAccelVariance: 0,
  tangentialAcceleration: 0,
  tangentialAccelVariance: 0,
  startParticleSize: 2,
  startParticleSizeVariance: 9,
  finishParticleSize: 16.84210586547852,
  finishParticleSizeVariance: 0,
  rotationStart: 0,
  rotationStartVariance: 0,
  rotationEnd: 0,
  rotationEndVariance: 0,
  startColorRed: 0.8,
  startColorGreen: 0.8,
  startColorBlue: 0,
  startColorAlpha: 1,
  startColorVarianceRed: 0,
  startColorVarianceGreen: 0,
  startColorVarianceBlue: 0,
  startColorVarianceAlpha: 0.2,
  finishColorRed: 1,
  finishColorGreen: 1,
  finishColorBlue: 0,
  finishColorAlpha: 0,
  finishColorVarianceRed: 0,
  finishColorVarianceGreen: 0,
  finishColorVarianceBlue: 0,
  finishColorVarianceAlpha: 0,
  blendFuncSource: 770,
  blendFuncDestination: 1,
});

describe("source dungeon chest sparkles", () => {
  function mountEffect(
    mode: "iphone" | "ipad" = "iphone",
    rand: () => number = () => 0.5,
    stageScale = 1,
  ): Readonly<{
    effect: DungeonChestSparkles;
    ticker: { deltaMS: number; add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
    tick: () => void;
    stageRoot: Container;
    pointRoot: Container;
    world: Container;
  }> {
    let callback: (() => void) | undefined;
    const ticker = {
      deltaMS: 50,
      add: vi.fn((value: () => void) => { callback = value; }),
      remove: vi.fn(),
    };
    const stageRoot = new Container();
    stageRoot.scale.set(stageScale);
    const pointRoot = new Container();
    pointRoot.label = "dungeonPointRoot";
    pointRoot.scale.set(2);
    const world = new Container();
    const chest = new Container();
    chest.scale.set(0.5);
    stageRoot.addChild(pointRoot);
    pointRoot.addChild(world);
    world.addChild(chest);
    const effect = new DungeonChestSparkles(
      { config: sparkleConfig, texture: Texture.WHITE } as ParticleAsset,
      ticker as never,
      mode,
      dungeonChestSparklePlacement({ width: 45, height: 33 }),
      rand,
    );
    chest.addChild(effect);
    return Object.freeze({
      effect,
      ticker,
      tick: () => callback?.(),
      stageRoot,
      pointRoot,
      world,
    });
  }

  it("uses half the live chest content size for position and position variance on both idioms", () => {
    // The shipped normalized chest is 45x33pt on both modes: 45x33 source points on iPhone and
    // the 90x66 iPad frame normalized through the port's uniform CSF-2 point space.
    expect(dungeonChestSparklePlacement({ width: 45, height: 33 })).toEqual({
      position: { x: 22.5, y: 16.5 },
      positionVariance: { x: 22.5, y: 16.5 },
    });
    expect(dungeonChestSparklePlacement({ width: 90 / 2, height: 66 / 2 })).toEqual({
      position: { x: 22.5, y: 16.5 },
      positionVariance: { x: 22.5, y: 16.5 },
    });
    expect(() => dungeonChestSparklePlacement({ width: 0, height: 33 })).toThrow(/positive finite/);
  });

  it("uses strict source emission thresholds and caps the live population", () => {
    const rate = Math.fround(18 / Math.fround(0.8553000092506409));
    const interval = Math.fround(1 / rate);
    expect(advanceDungeonSparkleEmission(0, interval, rate, 18)).toEqual({
      counterSeconds: interval,
      spawnCount: 0,
    });
    const emitted = advanceDungeonSparkleEmission(0, interval + 1e-6, rate, 18);
    expect(emitted.spawnCount).toBe(1);
    expect(emitted.counterSeconds).toBeCloseTo(1e-6, 7);
    expect(advanceDungeonSparkleEmission(0, interval * 10, rate, 2).spawnCount).toBe(2);

    const saturated = advanceDungeonSparkleEmission(0.04, 0.02, rate, 0);
    expect(saturated.spawnCount).toBe(0);
    expect(saturated.counterSeconds).toBeCloseTo(0.06, 7);
    const caughtUp = advanceDungeonSparkleEmission(saturated.counterSeconds, 0, rate, 1);
    expect(caughtUp.spawnCount).toBe(1);
    expect(caughtUp.counterSeconds).toBeCloseTo(0.06 - interval, 7);
  });

  it("uses each source idiom's native framebuffer scale for GL point sizes", () => {
    expect(dungeonSparkleFramebufferSize(2, "iphone")).toBe(4);
    expect(dungeonSparkleFramebufferSize(16.84210586547852, "iphone"))
      .toBe(Math.fround(Math.fround(16.84210586547852) * 2));
    expect(dungeonSparkleFramebufferSize(2, "ipad")).toBe(2);
    expect(dungeonSparkleFramebufferSize(16.84210586547852, "ipad"))
      .toBe(Math.fround(16.84210586547852));
  });

  it("uses one source-blended GL point list, all 19 draws, and cleanup-owned ticking", () => {
    let draws = 0;
    const mounted = mountEffect("iphone", () => { draws += 1; return 0.5; });
    const { effect, ticker } = mounted;
    expect(effect.sourcePosition).toEqual({ x: 22.5, y: 16.5 });
    expect(effect.position).toMatchObject({ x: 0, y: 0 });
    expect(effect.particleCount).toBe(0);
    mounted.tick();
    expect(effect.particleCount).toBe(1);
    expect(draws).toBe(19);
    expect(effect.children).toHaveLength(1);
    expect(effect.particleTopology).toBe("point-list");
    expect(effect.particleBlendMode).toBe("add-npm");
    const particle = effect.debugParticleState(0)!;
    expect(particle.xPx).toBeCloseTo(1, 6);
    expect(particle.rgbaBytes).toEqual([206, 206, 0, 240]);
    effect.destroy({ children: true });
    expect(ticker.remove).toHaveBeenCalledTimes(1);
    mounted.stageRoot.destroy({ children: true });
  });

  it("keeps free-position particles fixed under camera translation in native pixel coordinates", () => {
    const mounted = mountEffect();
    mounted.tick();
    const before = mounted.effect.debugParticleState(0)!;
    const beforeScreenX = mounted.world.x * 2 + before.renderXPx;
    mounted.world.x = 10;
    mounted.tick();
    const after = mounted.effect.debugParticleState(0)!;
    const afterScreenX = mounted.world.x * 2 + after.renderXPx;
    expect(after.renderXPx - before.renderXPx).toBeCloseTo(-19, 6);
    // Its own 20px/s source velocity advances one pixel; the 20px camera shift contributes zero.
    expect(afterScreenX - beforeScreenX).toBeCloseTo(1, 6);
    mounted.effect.destroy({ children: true });
    mounted.stageRoot.destroy({ children: true });
  });

  it("applies browser letterboxing to raster size without changing native simulation size", () => {
    const mounted = mountEffect("iphone", () => 0.5, 0.5);
    mounted.tick();
    const particle = mounted.effect.debugParticleState(0)!;
    expect(particle.renderSizePx).toBeCloseTo(particle.sizePx * 0.5, 6);
    mounted.effect.destroy({ children: true });
    mounted.stageRoot.destroy({ children: true });
  });
});
