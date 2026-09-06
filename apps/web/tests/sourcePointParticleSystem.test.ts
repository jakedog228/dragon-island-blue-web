import { describe, expect, it, vi } from "vitest";

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
    destroyed = false;
    addChild<T extends Container>(child: T): T { child.parent = this; this.children.push(child); return child; }
    destroy(options?: { children?: boolean }): void {
      if (options?.children) for (const child of this.children) child.destroy(options);
      this.destroyed = true;
      this.parent = null;
    }
  }
  class Geometry {
    readonly topology: string;
    private readonly buffers = new Map<string, { update(): void }>();
    constructor(options?: { attributes?: Record<string, unknown>; topology?: string }) {
      this.topology = options?.topology ?? "triangle-list";
      for (const key of Object.keys(options?.attributes ?? {})) this.buffers.set(key, { update() {} });
    }
    getBuffer(name: string) { return this.buffers.get(name)!; }
    destroy() {}
  }
  class Shader {
    static from() { return new Shader(); }
    destroy() {}
  }
  class State { static for2d() { return new State(); } }
  class Mesh extends Container {
    blendMode = "normal";
    readonly geometry: Geometry;
    constructor(options: { geometry: Geometry }) { super(); this.geometry = options.geometry; }
  }
  return { Container, Geometry, Mesh, Shader, State };
});

import type { ParticleAsset } from "@dib/renderer";
import { SourcePointParticleSystem } from "../src/sourcePointParticleSystem.js";

function asset(overrides: Record<string, number> = {}): ParticleAsset {
  return {
    texture: { source: {} },
    config: {
      maxParticles: 2,
      duration: -1,
      particleLifespan: 1,
      particleLifespanVariance: 0,
      angle: 0,
      angleVariance: 0,
      speed: 0,
      speedVariance: 0,
      gravityx: 0,
      gravityy: 0,
      sourcePositionVariancex: 0,
      sourcePositionVariancey: 0,
      startParticleSize: 20,
      startParticleSizeVariance: 0,
      finishParticleSize: 20,
      finishParticleSizeVariance: 0,
      rotationStart: 0,
      rotationStartVariance: 0,
      rotationEnd: 0,
      rotationEndVariance: 0,
      radialAcceleration: 0,
      radialAccelVariance: 0,
      tangentialAcceleration: 0,
      tangentialAccelVariance: 0,
      startColorRed: 0.5,
      startColorGreen: 0.5,
      startColorBlue: 0.5,
      startColorAlpha: 0.5,
      startColorVarianceRed: 0,
      startColorVarianceGreen: 0,
      startColorVarianceBlue: 0,
      startColorVarianceAlpha: 0,
      finishColorRed: 0.5,
      finishColorGreen: 0.5,
      finishColorBlue: 0.5,
      finishColorAlpha: 0.5,
      finishColorVarianceRed: 0,
      finishColorVarianceGreen: 0,
      finishColorVarianceBlue: 0,
      finishColorVarianceAlpha: 0,
      blendFuncSource: 770,
      blendFuncDestination: 1,
      emitterType: 0,
      ...overrides,
    },
  } as unknown as ParticleAsset;
}

describe("SourcePointParticleSystem", () => {
  it("uses a point list, the authored blend factors, byte-truncated colors, and 19 draws", () => {
    let draws = 0;
    const emitter = new SourcePointParticleSystem({
      asset: asset(), configName: "test.plist", mode: "iphone",
      rand: () => { draws += 1; return 0.5; },
    });
    emitter.advance(0.5); // strict threshold
    expect(emitter.particleCount).toBe(0);
    emitter.advance(0.001);
    expect(emitter.particleTopology).toBe("point-list");
    expect(emitter.particleBlendMode).toBe("add-npm");
    expect(draws).toBe(19);
    expect(emitter.debugParticleState(0)!.rgbaBytes).toEqual([127, 127, 127, 127]);
  });

  it("defaults an omitted point-emitter rotation family to zero without changing draw order", () => {
    const cast = asset();
    for (const key of [
      "rotationStart",
      "rotationStartVariance",
      "rotationEnd",
      "rotationEndVariance",
    ]) delete (cast.config as Record<string, unknown>)[key];
    let draws = 0;
    const emitter = new SourcePointParticleSystem({
      asset: cast,
      configName: "Cast.plist",
      mode: "iphone",
      rand: () => { draws += 1; return 0.5; },
    });
    emitter.advance(0.501);
    expect(emitter.particleCount).toBe(1);
    expect(draws).toBe(19);
  });

  it("keeps accumulating emission time while full, as CCParticleSystem.update does", () => {
    const emitter = new SourcePointParticleSystem({
      asset: asset({ maxParticles: 1, particleLifespanVariance: 10 }),
      configName: "test.plist", mode: "iphone", rand: () => 1,
    });
    emitter.advance(1.01);
    expect(emitter.particleCount).toBe(1);
    emitter.advance(5);
    expect(emitter.particleCount).toBe(1);
    emitter.advance(5);
    expect(emitter.particleCount).toBe(0);
    emitter.advance(0.001);
    expect(emitter.particleCount).toBe(1);
  });

  it("reproduces native framebuffer size by idiom and clamps only the rendered GL point", () => {
    const phone = new SourcePointParticleSystem({
      asset: asset({ startParticleSize: 80, finishParticleSize: 80 }),
      configName: "test.plist", mode: "iphone", rand: () => 0.5,
    });
    const pad = new SourcePointParticleSystem({
      asset: asset({ startParticleSize: 20, finishParticleSize: 20 }),
      configName: "test.plist", mode: "ipad", rand: () => 0.5,
    });
    phone.advance(0.501);
    pad.advance(0.501);
    expect(phone.debugParticleState(0)!.size).toBe(160);
    expect(phone.debugParticleState(0)!.renderSize).toBe(64);
    expect(pad.debugParticleState(0)!.renderSize).toBe(20);
  });

  it("does not double-add the plist sourcePosition overwritten by native setPosition:", () => {
    const emitter = new SourcePointParticleSystem({
      asset: asset({ sourcePositionx: 93.5, sourcePositiony: 240 }),
      configName: "Heal.plist", mode: "iphone", rand: () => 0.5,
    });
    emitter.position.set(120, 80);
    emitter.advance(0.501);
    expect(emitter.position).toMatchObject({ x: 120, y: 80 });
    expect(emitter.debugParticleState(0)).toMatchObject({ x: 0, y: 0 });
  });

  it("fills a zero-base-lifespan FrostGlobal-style emitter on its first positive update", () => {
    const emitter = new SourcePointParticleSystem({
      asset: asset({ maxParticles: 4, duration: 0.5, particleLifespan: 0, particleLifespanVariance: 1.571 }),
      configName: "FrostGlobal.plist", mode: "iphone", rand: () => 1,
    });
    emitter.advance(0.001);
    expect(emitter.particleCount).toBe(4);
  });

  it.each([
    [770, 771, "normal-npm"],
    [1, 1, "add"],
  ] as const)("maps %i/%i to %s", (source, destination, expected) => {
    const emitter = new SourcePointParticleSystem({
      asset: asset({ blendFuncSource: source, blendFuncDestination: destination }),
      configName: "test.plist", mode: "iphone",
    });
    expect(emitter.particleBlendMode).toBe(expected);
  });
});
