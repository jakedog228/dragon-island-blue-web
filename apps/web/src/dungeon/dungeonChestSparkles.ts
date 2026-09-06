import {
  Container,
  Geometry,
  Mesh,
  Shader,
  State,
  type Ticker,
} from "pixi.js";
import { CONTENT_SCALE_FACTOR, type ParticleAsset } from "@dib/renderer";
import { sourcePointsPerPortPoint, type DisplayMode } from "../displayMode.js";

export interface DungeonChestSparklePlacement {
  readonly position: Readonly<{ x: number; y: number }>;
  readonly positionVariance: Readonly<{ x: number; y: number }>;
}

const f32 = Math.fround;






export function dungeonChestSparklePlacement(
  chest: Readonly<{ width: number; height: number }>,
): DungeonChestSparklePlacement {
  if (!(chest.width > 0) || !(chest.height > 0) ||
      !Number.isFinite(chest.width) || !Number.isFinite(chest.height)) {
    throw new Error(`Dungeon chest sparkle needs a positive finite chest size: ${chest.width}x${chest.height}`);
  }
  const half = Object.freeze({ x: chest.width / 2, y: chest.height / 2 });
  return Object.freeze({ position: half, positionVariance: half });
}

/** Native `CCParticleSystemPoint` size in device-framebuffer pixels for this source idiom. */
export function dungeonSparkleFramebufferSize(size: number, mode: DisplayMode): number {
  return f32(Math.max(0, size) * (CONTENT_SCALE_FACTOR / sourcePointsPerPortPoint(mode)));
}






export function advanceDungeonSparkleEmission(
  counterSeconds: number,
  dtSeconds: number,
  emissionRate: number,
  availableSlots: number,
): Readonly<{ counterSeconds: number; spawnCount: number }> {
  if (!(emissionRate > 0)) {
    return Object.freeze({ counterSeconds: f32(counterSeconds), spawnCount: 0 });
  }
  const interval = f32(1 / f32(emissionRate));
  let counter = f32(f32(counterSeconds) + f32(dtSeconds));
  let spawnCount = 0;
  while (counter > interval && spawnCount < Math.max(0, Math.trunc(availableSlots))) {
    counter = f32(counter - interval);
    spawnCount += 1;
  }
  return Object.freeze({ counterSeconds: counter, spawnCount });
}

interface SparkleParticle {
  lifeSeconds: number;
  readonly totalLifeSeconds: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
  readonly emitterWorldAtBirth: Readonly<{ x: number; y: number }>;
  readonly radialAcceleration: number;
  readonly tangentialAcceleration: number;
  sizePx: number;
  readonly sizeDeltaPerSecond: number;
  readonly color: [number, number, number, number];
  readonly colorDeltaPerSecond: [number, number, number, number];
  spinDegrees: number;
  readonly spinDeltaPerSecond: number;
}

const SPARKLE_POINT_VERTEX = `
attribute vec2 aPosition;
attribute float aPointSize;
attribute vec4 aColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uResolution;
varying vec4 vParticleColor;
void main(void) {
  vec3 projected = uProjectionMatrix * uWorldTransformMatrix *
    uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);
  // aPointSize is already scaled for FixedStage's letterbox. GL point sizes are physical
  // framebuffer pixels, so apply only the render-target resolution (normally devicePixelRatio).
  float logicalToFramebuffer = abs(uProjectionMatrix[0][0]) * uResolution.x * 0.5;
  gl_PointSize = max(1.0, aPointSize * logicalToFramebuffer);
  vParticleColor = aColor;
}
`;

const SPARKLE_POINT_FRAGMENT = `
uniform sampler2D uTexture;
varying vec4 vParticleColor;
void main(void) {
  vec4 mask = texture2D(uTexture, gl_PointCoord);
  // iOS uploads particleTexture.png premultiplied, while CCParticleSystemPoint supplies straight
  // particle RGBA and explicitly blends SRC_ALPHA/ONE. Premultiplying particle RGB here would
  // apply particle alpha twice and produce a visibly dimmer fade.
  gl_FragColor = vec4(mask.rgb * vParticleColor.rgb, mask.a * vParticleColor.a);
}
`;

/** One native-style GL point list for the complete continuous emitter. */
class SparklePointMesh extends Mesh<Geometry, Shader> {
  private readonly ownedGeometry: Geometry;
  private readonly ownedShader: Shader;

  constructor(
    asset: ParticleAsset,
    positions: Float32Array,
    sizes: Float32Array,
    colors: Uint8Array,
  ) {
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: positions, format: "float32x2" },
        aPointSize: { buffer: sizes, format: "float32" },
        aColor: { buffer: colors, format: "unorm8x4" },
      },
      topology: "point-list",
    });
    const shader = Shader.from({
      gl: {
        name: "dungeon-sparkle-src-alpha-point-list",
        vertex: SPARKLE_POINT_VERTEX,
        fragment: SPARKLE_POINT_FRAGMENT,
      },
      resources: { uTexture: asset.texture.source },
    });
    super({ geometry, shader, texture: asset.texture, state: State.for2d() });
    this.ownedGeometry = geometry;
    this.ownedShader = shader;
    this.label = "dungeonChestSparkles:pointList";
    this.blendMode = "add-npm";
  }

  updateBuffers(): void {
    this.geometry.getBuffer("aPosition").update();
    this.geometry.getBuffer("aPointSize").update();
    this.geometry.getBuffer("aColor").update();
  }

  override destroy(options?: Parameters<Mesh<Geometry, Shader>["destroy"]>[0]): void {
    if (this.destroyed) return;
    super.destroy(options);
    this.ownedGeometry.destroy();
    this.ownedShader.destroy(false);
  }
}

/**
 * Source `CCParticleSystemPoint` used only by RoomNode's continuous `Sparkle.plist` child. The
 * simulation mirrors the shipped Cocos float32 initialization/update order, including all 19 RNG
 * draws, full-array emission accumulation, free-position compensation, byte-truncated colors,
 * and the actual GL point-list primitive and 770/1 blend path.
 */
export class DungeonChestSparkles extends Container {
  private readonly particles: SparkleParticle[] = [];
  private emissionCounterSeconds = 0;
  private readonly nativeSpatialScale: number;
  private readonly maxParticles: number;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly colors: Uint8Array;
  private readonly particleMesh: SparklePointMesh;
  private readonly updateFn = (): void => this.update(f32(this.ticker.deltaMS / 1000));

  constructor(
    private readonly asset: ParticleAsset,
    private readonly ticker: Ticker,
    private readonly mode: DisplayMode,
    placement: DungeonChestSparklePlacement,
    private readonly rand: () => number = Math.random,
  ) {
    super();
    this.label = "dungeonChestSparkles";
    // Cocos children use their parent's unanchored 0..contentSize coordinate frame. Pixi Sprite
    // anchors shift only its texture vertices, not its child origin, so source `(w/2,h/2)` maps to
    // Pixi local `(0,0)` on the anchor-.5 chest rather than another +half-size displacement.
    this.position.set(
      placement.position.x - placement.positionVariance.x,
      placement.position.y - placement.positionVariance.y,
    );
    this.sourcePosition = placement.position;
    this.positionVariance = placement.positionVariance;
    this.nativeSpatialScale = CONTENT_SCALE_FACTOR / sourcePointsPerPortPoint(mode);
    this.maxParticles = this.validateConfig();
    this.positions = new Float32Array(this.maxParticles * 2);
    this.sizes = new Float32Array(this.maxParticles);
    this.colors = new Uint8Array(this.maxParticles * 4);
    this.particleMesh = new SparklePointMesh(asset, this.positions, this.sizes, this.colors);
    this.addChild(this.particleMesh);
    this.ticker.add(this.updateFn);
  }

  readonly positionVariance: Readonly<{ x: number; y: number }>;
  readonly sourcePosition: Readonly<{ x: number; y: number }>;

  get particleCount(): number { return this.particles.length; }
  get particleBlendMode(): string { return this.particleMesh.blendMode; }
  get particleTopology(): string { return this.particleMesh.geometry.topology; }

  debugParticleState(index: number): Readonly<{
    xPx: number;
    yPx: number;
    renderXPx: number;
    renderYPx: number;
    sizePx: number;
    renderSizePx: number;
    rgbaBytes: readonly [number, number, number, number];
  }> | undefined {
    const particle = this.particles[index];
    if (!particle) return undefined;
    const offset = index * 4;
    return Object.freeze({
      xPx: particle.x,
      yPx: particle.y,
      renderXPx: this.positions[index * 2]!,
      renderYPx: this.positions[index * 2 + 1]!,
      sizePx: particle.sizePx,
      renderSizePx: this.sizes[index]!,
      rgbaBytes: Object.freeze([
        this.colors[offset]!,
        this.colors[offset + 1]!,
        this.colors[offset + 2]!,
        this.colors[offset + 3]!,
      ] as const),
    });
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.ticker.remove(this.updateFn);
    super.destroy(options);
    this.particles.length = 0;
  }

  private number(key: string): number {
    const value = this.asset.config[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Sparkle.plist is missing finite numeric ${key}`);
    }
    return f32(value);
  }

  private optionalNumber(key: string): number {
    const value = this.asset.config[key];
    return typeof value === "number" && Number.isFinite(value) ? f32(value) : 0;
  }

  private validateConfig(): number {
    for (const key of [
      "maxParticles", "particleLifespan", "particleLifespanVariance", "angle", "angleVariance",
      "speed", "speedVariance", "gravityx", "gravityy", "startParticleSize",
      "startParticleSizeVariance", "finishParticleSize", "finishParticleSizeVariance",
      "rotationStart", "rotationStartVariance", "rotationEnd", "rotationEndVariance",
      "startColorRed", "startColorGreen", "startColorBlue", "startColorAlpha",
      "finishColorRed", "finishColorGreen", "finishColorBlue", "finishColorAlpha",
      "blendFuncSource", "blendFuncDestination", "emitterType",
    ]) this.number(key);
    if (this.number("emitterType") !== 0) throw new Error("Sparkle.plist must use the gravity emitter type");
    if (`${this.number("blendFuncSource")}/${this.number("blendFuncDestination")}` !== "770/1") {
      throw new Error("Sparkle.plist must use GL_SRC_ALPHA/GL_ONE");
    }
    const maxParticles = this.number("maxParticles");
    if (!Number.isSafeInteger(maxParticles) || maxParticles < 1) {
      throw new Error("Sparkle.plist maxParticles must be a positive safe integer");
    }
    if (!(this.number("particleLifespan") > 0)) {
      throw new Error("Sparkle.plist needs a positive particleLifespan");
    }
    return maxParticles;
  }

  /** `CCRANDOM_MINUS1_1()`: preserve the draw even when the authored variance is zero. */
  private signed(): number { return f32(f32(this.rand() * 2) - 1); }

  private varied(base: string, variance: string): number {
    return f32(this.number(base) + f32(this.number(variance) * this.signed()));
  }

  private variedOptional(base: string, variance: string): number {
    return f32(this.optionalNumber(base) + f32(this.optionalNumber(variance) * this.signed()));
  }

  private variedColor(prefix: "start" | "finish"): [number, number, number, number] {
    const channel = (name: "Red" | "Green" | "Blue" | "Alpha"): number => f32(Math.max(0, Math.min(1,
      f32(this.number(`${prefix}Color${name}`) +
      f32(this.optionalNumber(`${prefix}ColorVariance${name}`) * this.signed())),
    )));
    return [channel("Red"), channel("Green"), channel("Blue"), channel("Alpha")];
  }

  private spawn(): void {


    const totalLifeSeconds = f32(Math.max(0,
      this.varied("particleLifespan", "particleLifespanVariance"),
    ));
    // Placement is in the port's normalized point space. The child chest's 1/2 HD fold maps
    // these native-framebuffer coordinates 1:1 through dungeonPointRoot's CSF-2 scale.
    const x = f32(f32(this.positionVariance.x * CONTENT_SCALE_FACTOR) * this.signed());
    const y = f32(-f32(f32(this.positionVariance.y * CONTENT_SCALE_FACTOR) * this.signed()));
    const start = this.variedColor("start");
    const finish = this.variedColor("finish");
    const startSize = dungeonSparkleFramebufferSize(
      Math.max(0, this.varied("startParticleSize", "startParticleSizeVariance")),
      this.mode,
    );
    const finishSize = dungeonSparkleFramebufferSize(
      Math.max(0, this.varied("finishParticleSize", "finishParticleSizeVariance")),
      this.mode,
    );
    const startSpin = this.varied("rotationStart", "rotationStartVariance");
    const endSpin = this.varied("rotationEnd", "rotationEndVariance");
    const angle = f32(this.varied("angle", "angleVariance") * f32(Math.PI / 180));
    const speed = f32(this.varied("speed", "speedVariance") * this.nativeSpatialScale);
    const radialAcceleration = f32(
      this.variedOptional("radialAcceleration", "radialAccelVariance") * this.nativeSpatialScale,
    );
    const tangentialAcceleration = f32(
      this.variedOptional("tangentialAcceleration", "tangentialAccelVariance") * this.nativeSpatialScale,
    );
    const divisor = totalLifeSeconds > 0 ? totalLifeSeconds : 1;
    this.particles.push({
      lifeSeconds: totalLifeSeconds,
      totalLifeSeconds,
      vx: f32(Math.cos(angle) * speed),
      vy: f32(-Math.sin(angle) * speed),
      x,
      y,
      emitterWorldAtBirth: this.emitterWorldPosition(),
      radialAcceleration,
      tangentialAcceleration,
      sizePx: startSize,
      sizeDeltaPerSecond: f32(f32(finishSize - startSize) / divisor),
      color: [...start],
      colorDeltaPerSecond: [
        f32(f32(finish[0] - start[0]) / divisor),
        f32(f32(finish[1] - start[1]) / divisor),
        f32(f32(finish[2] - start[2]) / divisor),
        f32(f32(finish[3] - start[3]) / divisor),
      ],
      spinDegrees: startSpin,
      spinDeltaPerSecond: f32(f32(endSpin - startSpin) / divisor),
    });
  }

  private update(dtSeconds: number): void {
    const emissionRate = f32(this.maxParticles / this.number("particleLifespan"));
    const emission = advanceDungeonSparkleEmission(
      this.emissionCounterSeconds,
      dtSeconds,
      emissionRate,
      this.maxParticles - this.particles.length,
    );
    this.emissionCounterSeconds = emission.counterSeconds;
    for (let i = 0; i < emission.spawnCount; i++) this.spawn();

    const gravityX = f32(this.number("gravityx") * this.nativeSpatialScale);
    const gravityY = f32(-this.number("gravityy") * this.nativeSpatialScale);
    const currentEmitter = this.emitterWorldPosition();
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index]!;
      particle.lifeSeconds = f32(particle.lifeSeconds - dtSeconds);
      if (particle.lifeSeconds <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      const magnitude = f32(Math.hypot(particle.x, particle.y));
      const rx = magnitude === 0 ? 0 : f32(particle.x / magnitude);
      const ry = magnitude === 0 ? 0 : f32(particle.y / magnitude);
      const ax = f32(f32(rx * particle.radialAcceleration) -
        f32(ry * particle.tangentialAcceleration) + gravityX);
      const ay = f32(f32(ry * particle.radialAcceleration) +
        f32(rx * particle.tangentialAcceleration) + gravityY);
      particle.vx = f32(particle.vx + f32(ax * dtSeconds));
      particle.vy = f32(particle.vy + f32(ay * dtSeconds));
      particle.x = f32(particle.x + f32(particle.vx * dtSeconds));
      particle.y = f32(particle.y + f32(particle.vy * dtSeconds));
      particle.sizePx = f32(Math.max(0,
        f32(particle.sizePx + f32(particle.sizeDeltaPerSecond * dtSeconds)),
      ));
      for (let channel = 0; channel < 4; channel++) {
        particle.color[channel] = f32(particle.color[channel]! +
          f32(particle.colorDeltaPerSecond[channel]! * dtSeconds));
      }
      particle.spinDegrees = f32(particle.spinDegrees + f32(particle.spinDeltaPerSecond * dtSeconds));
    }
    this.writePointBuffers(currentEmitter);
  }

  private writePointBuffers(currentEmitter: Readonly<{ x: number; y: number }>): void {
    this.positions.fill(0);
    this.sizes.fill(1);
    this.colors.fill(0);
    const presentationScale = this.presentationScale();
    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index]!;
      const positionOffset = index * 2;
      this.positions[positionOffset] = f32(particle.x -
        f32(currentEmitter.x - particle.emitterWorldAtBirth.x));
      this.positions[positionOffset + 1] = f32(particle.y -
        f32(currentEmitter.y - particle.emitterWorldAtBirth.y));
      this.sizes[index] = f32(particle.sizePx * presentationScale);
      const colorOffset = index * 4;
      this.colors[colorOffset] = sourceColorByte(particle.color[0]);
      this.colors[colorOffset + 1] = sourceColorByte(particle.color[1]);
      this.colors[colorOffset + 2] = sourceColorByte(particle.color[2]);
      this.colors[colorOffset + 3] = sourceColorByte(particle.color[3]);
    }
    this.particleMesh.updateBuffers();
  }

  private dungeonPointRoot(): Container {
    for (let node = this.parent; node !== null; node = node.parent) {
      if (node.label === "dungeonPointRoot") return node;
    }
    throw new Error("Dungeon chest sparkle must be attached below dungeonPointRoot before ticking");
  }

  /** Position type 0 (`kCCPositionTypeFree`) samples native framebuffer coordinates. */
  private emitterWorldPosition(): Readonly<{ x: number; y: number }> {
    const pointRoot = this.dungeonPointRoot();
    const local = pointRoot.toLocal(this.toGlobal({ x: 0, y: 0 }));
    return Object.freeze({
      x: f32(local.x * CONTENT_SCALE_FACTOR),
      y: f32(local.y * CONTENT_SCALE_FACTOR),
    });
  }

  /** FixedStage's browser-only presentation scale is the only transform that scales GL points. */
  private presentationScale(): number {
    const pointRoot = this.dungeonPointRoot();
    const matrix = pointRoot.parent?.getGlobalTransform();
    return matrix ? f32(Math.hypot(matrix.a, matrix.b)) : 1;
  }
}

/** `vcvt.s32.f32` truncates each clamped float32 channel after its float32 `* 255`. */
function sourceColorByte(value: number): number {
  return Math.trunc(f32(f32(Math.max(0, Math.min(1, value))) * 255));
}
