import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => {
  const point = (value: number) => ({
    x: value,
    y: value,
    set(x: number, y: number = x) { this.x = x; this.y = y; },
  });
  class Container {
    children: Container[] = [];
    parent: Container | null = null;
    label = "";
    position = point(0);
    scale = point(1);
    anchor = point(0.5);
    width = 0;
    height = 0;
    alpha = 1;
    tint = 0xffffff;
    destroyed = false;
    addChild<T extends Container>(child: T): T {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    destroy(options?: { children?: boolean }): void {
      if (options?.children) for (const child of this.children) child.destroy(options);
      this.destroyed = true;
      this.parent = null;
    }
  }
  class Sprite extends Container {
    constructor(_texture?: unknown) { super(); }
  }
  class Geometry {
    private readonly buffers = new Map<string, { update(): void }>();
    destroyed = false;
    constructor(options?: { attributes?: Record<string, unknown> }) {
      for (const key of Object.keys(options?.attributes ?? {})) this.buffers.set(key, { update() {} });
    }
    getBuffer(name: string) { return this.buffers.get(name)!; }
    destroy() { this.destroyed = true; }
  }
  class Shader {
    static readonly instances: Shader[] = [];
    static from(options: unknown) { return new Shader(options); }
    destroyed = false;
    destroyPrograms: boolean | undefined;
    constructor(readonly options?: unknown) { Shader.instances.push(this); }
    destroy(destroyPrograms?: boolean) {
      this.destroyed = true;
      this.destroyPrograms = destroyPrograms;
    }
  }
  class State {
    static for2d() { return new State(); }
  }
  class Mesh extends Container {
    blendMode = "normal";
    geometry: Geometry;
    constructor(readonly options?: { geometry?: Geometry }) {
      super();
      this.geometry = options?.geometry ?? new Geometry();
    }
  }
  return { Container, Geometry, Mesh, Shader, Sprite, State };
});

import { Container, Shader, type Ticker } from "pixi.js";
import type { ParticleAsset } from "@dib/renderer";
import { PoisonStatusEmitter } from "../src/battle/poisonStatusEmitter.js";

class FakeTicker {
  deltaMS = 0;
  readonly listeners = new Set<() => void>();
  add(fn: () => void): void { this.listeners.add(fn); }
  remove(fn: () => void): void { this.listeners.delete(fn); }
  tick(ms: number): void {
    this.deltaMS = ms;
    for (const listener of [...this.listeners]) listener();
  }
}

const poisonAsset = {
  texture: {},
  config: {
    maxParticles: 50,
    duration: -1,
    particleLifespan: 0.5,
    particleLifespanVariance: 0,
    angle: 270,
    angleVariance: 0,
    speed: 30,
    speedVariance: 0,
    gravityx: 0,
    gravityy: -30,
    sourcePositionVariancex: 0,
    sourcePositionVariancey: 0,
    startParticleSize: 20,
    startParticleSizeVariance: 0,
    finishParticleSize: 0,
    finishParticleSizeVariance: 0,
    rotationStart: 0,
    rotationStartVariance: 0,
    rotationEnd: 0,
    rotationEndVariance: 0,
    radialAcceleration: 0,
    radialAccelVariance: 0,
    tangentialAcceleration: 0,
    tangentialAccelVariance: 0,
    startColorRed: 0.1,
    startColorGreen: 0.98,
    startColorBlue: 0.1,
    startColorAlpha: 0,
    startColorVarianceRed: 0,
    startColorVarianceGreen: 0,
    startColorVarianceBlue: 0,
    startColorVarianceAlpha: 0,
    finishColorRed: 0.2,
    finishColorGreen: 0.58,
    finishColorBlue: 0.2,
    finishColorAlpha: 1,
    finishColorVarianceRed: 0,
    finishColorVarianceGreen: 0,
    finishColorVarianceBlue: 0,
    finishColorVarianceAlpha: 0,
    blendFuncSource: 770,
    blendFuncDestination: 771,
    emitterType: 0,
  },
} as unknown as ParticleAsset;

describe("PoisonStatusEmitter — native CCParticleSystemPoint behavior", () => {
  let ticker: FakeTicker;
  let battleRoot: Container;

  beforeEach(() => {
    ticker = new FakeTicker();
    battleRoot = new Container();
    battleRoot.label = "battlePointRoot";
    battleRoot.scale.set(2);
  });

  it("uses the strict emission threshold and consumes the exact 19 native RNG draws", () => {
    let draws = 0;
    const emitter = new PoisonStatusEmitter(poisonAsset, ticker as unknown as Ticker, "iphone", () => {
      draws += 1;
      return 0.5;
    });
    battleRoot.addChild(emitter);
    emitter.start();

    ticker.tick(10); // interval is exactly 10ms: native strict `>` does not emit at equality
    expect(emitter.particleCount).toBe(0);
    expect(draws).toBe(0);
    ticker.tick(0.001);
    expect(emitter.particleCount).toBe(1);
    expect(draws).toBe(19);
  });

  it("advances a newly emitted particle during the same frame", () => {
    const emitter = new PoisonStatusEmitter(poisonAsset, ticker as unknown as Ticker, "iphone", () => 0.5);
    battleRoot.addChild(emitter);
    emitter.start();
    ticker.tick(11);

    const particle = emitter.debugParticleState(0)!;
    expect(emitter.particleBlendMode).toBe("normal-npm");
    expect(particle.y).toBeGreaterThan(0);
    expect(particle.rgbaBytes[3]).toBeGreaterThan(0);
    expect(particle.size).toBeLessThan(40);
  });

  it("keeps point diameter fixed while monster/modelview scale changes", () => {
    const emitter = new PoisonStatusEmitter(poisonAsset, ticker as unknown as Ticker, "iphone", () => 0.5);
    emitter.scale.set(0.5);
    battleRoot.addChild(emitter);
    emitter.start();
    ticker.tick(11);

    const particle = emitter.debugParticleState(0)!;
    expect(particle.renderSize).toBeCloseTo(39.12, 1);
    // GL point diameter ignores the emitter and battle-root modelview scales.
    expect(particle.renderSize).toBeCloseTo(particle.size, 5);
  });

  it("initializes zero-life particles with all draws, then removes them in that frame", () => {
    let draws = 0;
    const zeroLifeAsset = {
      ...poisonAsset,
      config: { ...poisonAsset.config, particleLifespan: 0.329, particleLifespanVariance: 0.855 },
    } as ParticleAsset;
    const emitter = new PoisonStatusEmitter(zeroLifeAsset, ticker as unknown as Ticker, "iphone", () => {
      draws += 1;
      return draws === 1 ? 0 : 0.5;
    });
    battleRoot.addChild(emitter);
    emitter.start();
    ticker.tick(7);

    expect(draws).toBe(19);
    expect(emitter.particleCount).toBe(0);
  });

  it("cleanup removes the sole ticker listener and every particle immediately", () => {
    const emitter = new PoisonStatusEmitter(poisonAsset, ticker as unknown as Ticker, "iphone", () => 0.5);
    battleRoot.addChild(emitter);
    emitter.start();
    ticker.tick(11);
    const particleMesh = emitter.children[0]! as Container & {
      geometry: { destroyed: boolean };
    };
    const shader = (Shader as unknown as {
      instances: Array<{ destroyed: boolean; destroyPrograms: boolean | undefined }>;
    }).instances.at(-1)!;
    expect(ticker.listeners.size).toBe(1);

    emitter.destroy({ children: true });
    expect(ticker.listeners.size).toBe(0);
    expect(emitter.particleCount).toBe(0);
    expect(particleMesh.destroyed).toBe(true);
    expect(particleMesh.geometry.destroyed).toBe(true);
    expect(shader.destroyed).toBe(true);
    expect(shader.destroyPrograms).toBe(false);
  });

  it.each([1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects non-safe-integer maxParticles=%s",
    (maxParticles) => {
      const invalidAsset = {
        ...poisonAsset,
        config: { ...poisonAsset.config, maxParticles },
      } as ParticleAsset;

      expect(() => new PoisonStatusEmitter(
        invalidAsset,
        ticker as unknown as Ticker,
        "iphone",
        () => 0.5,
      )).toThrow("PoisonParticles.plist maxParticles must be a positive safe integer");
    },
  );

  it("does not impose the obsolete Uint16 quad limit on a point-list emitter", () => {
    const boundaryAsset = {
      ...poisonAsset,
      config: { ...poisonAsset.config, maxParticles: 16_385 },
    } as ParticleAsset;

    const emitter = new PoisonStatusEmitter(
      boundaryAsset,
      ticker as unknown as Ticker,
      "iphone",
      () => 0.5,
    );
    expect(emitter.particleCount).toBe(0);
    emitter.destroy({ children: true });
  });
});
