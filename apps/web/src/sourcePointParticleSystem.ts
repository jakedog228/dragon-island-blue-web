import {
  Container,
  Geometry,
  Mesh,
  Shader,
  State,
  type Ticker,
} from "pixi.js";
import { CONTENT_SCALE_FACTOR, type ParticleAsset } from "@dib/renderer";
import { sourcePointsPerPortPoint, type DisplayMode } from "./displayMode.js";

const f32 = Math.fround;
const SOURCE_POINT_SIZE_LIMIT_PX = 64;

interface PointParticle {
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly radial: number;
  readonly tangential: number;
  size: number;
  readonly sizeDelta: number;
  readonly color: [number, number, number, number];
  readonly colorDelta: [number, number, number, number];
  spin: number;
  readonly spinDelta: number;
}

const POINT_VERTEX = `
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
  float logicalToFramebuffer = abs(uProjectionMatrix[0][0]) * uResolution.x * 0.5;
  gl_PointSize = max(1.0, aPointSize * logicalToFramebuffer);
  vParticleColor = aColor;
}
`;

const POINT_FRAGMENT = `
uniform sampler2D uTexture;
varying vec4 vParticleColor;
void main(void) {
  vec4 mask = texture2D(uTexture, gl_PointCoord);
  gl_FragColor = vec4(mask.rgb * vParticleColor.rgb, mask.a * vParticleColor.a);
}
`;

function blendMode(source: number, destination: number): "add-npm" | "normal-npm" | "add" {
  const pair = `${source}/${destination}`;
  if (pair === "770/1") return "add-npm";
  if (pair === "770/771") return "normal-npm";
  if (pair === "1/1") return "add";
  throw new Error(`Unsupported CCParticleSystemPoint blend factors ${pair}`);
}

class SourcePointMesh extends Mesh<Geometry, Shader> {
  private readonly ownedGeometry: Geometry;
  private readonly ownedShader: Shader;

  constructor(asset: ParticleAsset, positions: Float32Array, sizes: Float32Array, colors: Uint8Array) {
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: positions, format: "float32x2" },
        aPointSize: { buffer: sizes, format: "float32" },
        aColor: { buffer: colors, format: "unorm8x4" },
      },
      topology: "point-list",
    });
    const shader = Shader.from({
      gl: { name: "source-cc-particle-point-list", vertex: POINT_VERTEX, fragment: POINT_FRAGMENT },
      resources: { uTexture: asset.texture.source },
    });
    super({ geometry, shader, texture: asset.texture, state: State.for2d() });
    this.ownedGeometry = geometry;
    this.ownedShader = shader;
    this.blendMode = blendMode(
      requireNumber(asset, "blendFuncSource"),
      requireNumber(asset, "blendFuncDestination"),
    );
    this.label = "sourcePointParticles:pointList";
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

export interface SourcePointParticleOptions {
  readonly asset: ParticleAsset;
  readonly configName: string;
  readonly mode: DisplayMode;
  readonly ticker?: Ticker;
  readonly rand?: () => number;
  readonly autoRemoveOnFinish?: boolean;
  /** The native callers overwrite the plist's editor-time sourcePosition through setPosition:. */
  readonly positionVariance?: Readonly<{ x: number; y: number }>;
  /** Browser-only scale outside the source point root. GL point diameter ignores node transforms. */
  readonly presentationScale?: () => number;
}

/**
 * Shared port of shipped `CCParticleSystemPoint` gravity emitters. It intentionally models the
 * source's float32 state, strict emission threshold, 19 libc `random()` draws per gravity
 * particle, byte colors, GL point-list primitive, and authored blend factors. Rotation-bearing
 * plist files must use the native quad path instead and are rejected here.
 */
export class SourcePointParticleSystem extends Container {
  private readonly particles: PointParticle[] = [];
  private readonly asset: ParticleAsset;
  private readonly configName: string;
  private readonly ticker: Ticker | undefined;
  private readonly rand: () => number;
  private readonly spatialScale: number;
  private readonly framebufferScale: number;
  private readonly maxParticles: number;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly colors: Uint8Array;
  private readonly mesh: SourcePointMesh;
  private readonly updateFn = (): void => this.advance(f32((this.ticker?.deltaMS ?? 0) / 1000));
  private emissionCounter = 0;
  private elapsed = 0;
  private active = true;
  private started = false;
  private settled = false;
  private resolveCompletion!: () => void;

  readonly completion: Promise<void>;

  constructor(private readonly options: SourcePointParticleOptions) {
    super();
    this.asset = options.asset;
    this.configName = options.configName;
    this.ticker = options.ticker;
    this.rand = options.rand ?? Math.random;
    this.spatialScale = 1 / sourcePointsPerPortPoint(options.mode);
    this.framebufferScale = CONTENT_SCALE_FACTOR / sourcePointsPerPortPoint(options.mode);
    this.maxParticles = this.validateConfig();
    this.positions = new Float32Array(this.maxParticles * 2);
    this.sizes = new Float32Array(this.maxParticles);
    this.colors = new Uint8Array(this.maxParticles * 4);
    this.mesh = new SourcePointMesh(this.asset, this.positions, this.sizes, this.colors);
    this.addChild(this.mesh);
    this.label = `sourcePointParticles:${this.configName}`;
    this.completion = new Promise((resolve) => { this.resolveCompletion = resolve; });
  }

  get particleCount(): number { return this.particles.length; }
  get particleBlendMode(): string { return this.mesh.blendMode; }
  get particleTopology(): string { return this.mesh.geometry.topology; }

  debugParticleState(index: number): Readonly<{
    x: number;
    y: number;
    size: number;
    renderSize: number;
    rgbaBytes: readonly [number, number, number, number];
  }> | undefined {
    const particle = this.particles[index];
    if (!particle) return undefined;
    const offset = index * 4;
    return Object.freeze({
      x: particle.x,
      y: particle.y,
      size: particle.size,
      renderSize: this.sizes[index]!,
      rgbaBytes: Object.freeze([
        this.colors[offset]!, this.colors[offset + 1]!,
        this.colors[offset + 2]!, this.colors[offset + 3]!,
      ] as const),
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.ticker?.add(this.updateFn);
  }

  advance(dtSeconds: number): void {
    if (this.destroyed || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    const dt = f32(dtSeconds);
    if (this.active) {
      this.emissionCounter = f32(this.emissionCounter + dt);
      const baseLife = this.number("particleLifespan");
      const emissionRate = baseLife === 0 ? Number.POSITIVE_INFINITY : f32(this.maxParticles / baseLife);
      const interval = emissionRate === Number.POSITIVE_INFINITY ? 0 : f32(1 / emissionRate);
      while (this.emissionCounter > interval && this.particles.length < this.maxParticles) {
        this.spawn();
        this.emissionCounter = f32(this.emissionCounter - interval);
      }
      this.elapsed = f32(this.elapsed + dt);
      const duration = this.number("duration");
      if (duration !== -1 && this.elapsed > duration) this.stopSystem();
    }

    const gravityX = f32(this.number("gravityx") * this.spatialScale);
    const gravityY = f32(-this.number("gravityy") * this.spatialScale);
    let index = 0;
    while (index < this.particles.length) {
      const particle = this.particles[index]!;
      particle.life = f32(particle.life - dt);
      if (particle.life <= 0) {
        // Cocos keeps a packed C array: copy the last live record over the dead slot, decrement
        // particleCount, and process that replacement at the same index this update.
        const last = this.particles.pop()!;
        if (index < this.particles.length) this.particles[index] = last;
        continue;
      }
      const magnitude = f32(Math.hypot(particle.x, particle.y));
      const rx = magnitude === 0 ? 0 : f32(particle.x / magnitude);
      const ry = magnitude === 0 ? 0 : f32(particle.y / magnitude);
      const ax = f32(f32(rx * particle.radial) - f32(ry * particle.tangential) + gravityX);
      const ay = f32(f32(ry * particle.radial) + f32(rx * particle.tangential) + gravityY);
      particle.vx = f32(particle.vx + f32(ax * dt));
      particle.vy = f32(particle.vy + f32(ay * dt));
      particle.x = f32(particle.x + f32(particle.vx * dt));
      particle.y = f32(particle.y + f32(particle.vy * dt));
      particle.size = f32(Math.max(0, f32(particle.size + f32(particle.sizeDelta * dt))));
      for (let channel = 0; channel < 4; channel++) {
        particle.color[channel] = f32(particle.color[channel]! + f32(particle.colorDelta[channel]! * dt));
      }
      particle.spin = f32(particle.spin + f32(particle.spinDelta * dt));
      index += 1;
    }
    this.writeBuffers();
    if (!this.active && this.particles.length === 0) this.finish();
  }

  stopSystem(): void {
    this.active = false;
    this.elapsed = this.number("duration");
    this.emissionCounter = 0;
    if (this.particles.length === 0) this.finish();
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    if (this.started) this.ticker?.remove(this.updateFn);
    this.started = false;
    this.settle();
    super.destroy(options);
    this.particles.length = 0;
  }

  private validateConfig(): number {
    for (const key of [
      "maxParticles", "duration", "particleLifespan", "particleLifespanVariance", "angle",
      "angleVariance", "speed", "speedVariance", "gravityx", "gravityy", "startParticleSize",
      "startParticleSizeVariance", "finishParticleSize", "finishParticleSizeVariance",
      "startColorRed", "startColorGreen", "startColorBlue", "startColorAlpha",
      "finishColorRed", "finishColorGreen", "finishColorBlue", "finishColorAlpha",
      "blendFuncSource", "blendFuncDestination", "emitterType",
    ]) this.number(key);
    if (this.number("emitterType") !== 0) {
      throw new Error(`${this.configName} must use the gravity emitter type`);
    }
    for (const key of ["rotationStart", "rotationStartVariance", "rotationEnd", "rotationEndVariance"]) {
      if (this.optionalNumber(key) !== 0) {
        throw new Error(`${this.configName} has rotation and requires CCParticleSystemQuad`);
      }
    }
    blendMode(this.number("blendFuncSource"), this.number("blendFuncDestination"));
    const max = this.number("maxParticles");
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new Error(`${this.configName} maxParticles must be a positive safe integer`);
    }
    if (this.number("particleLifespan") < 0) {
      throw new Error(`${this.configName} particleLifespan cannot be negative`);
    }
    return max;
  }

  private number(key: string): number {
    return f32(requireNumber(this.asset, key, this.configName));
  }

  private optionalNumber(key: string): number {
    const value = this.asset.config[key];
    return typeof value === "number" && Number.isFinite(value) ? f32(value) : 0;
  }

  private signed(): number { return f32(f32(this.rand() * 2) - 1); }

  private varied(base: string, variance: string): number {
    return f32(this.number(base) + f32(this.optionalNumber(variance) * this.signed()));
  }

  private optionallyVaried(base: string, variance: string): number {
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
    const life = f32(Math.max(0, this.varied("particleLifespan", "particleLifespanVariance")));
    const variance = this.options.positionVariance;
    // `initWithDictionary:` initially feeds sourcePositionx/y to the particle system's
    // `setPosition:`, but every migrated caller then sets the runtime effect position. The root
    // Container represents that final position, so adding the plist's editor coordinates here
    // would apply a stale source position twice (most visibly Heal's 93.5,240).
    // Builder-supplied overrides were measured after the port's source-to-port conversion and
    // are already local coordinates. Plist values are still source points and need idiom scaling.
    const xVariance = variance?.x ?? f32(this.optionalNumber("sourcePositionVariancex") * this.spatialScale);
    const yVariance = variance?.y ?? f32(this.optionalNumber("sourcePositionVariancey") * this.spatialScale);
    const x = f32(f32(xVariance) * this.signed());
    const y = f32(-f32(f32(yVariance) * this.signed()));
    const start = this.variedColor("start");
    const finish = this.variedColor("finish");
    const startSize = f32(Math.max(0, this.varied("startParticleSize", "startParticleSizeVariance")) *
      this.framebufferScale);
    const finishSize = f32(Math.max(0, this.varied("finishParticleSize", "finishParticleSizeVariance")) *
      this.framebufferScale);
    // Particle Designer omits the complete rotation family for point emitters such as the
    // shipped Cast.plist. NSDictionary objectForKey: -> floatValue supplies 0 for those missing
    // values in the source loader. Keep the two RNG draws even when both coefficients are zero;
    // CCParticleSystem's particle-init draw order is unchanged by omission.
    const startSpin = this.optionallyVaried("rotationStart", "rotationStartVariance");
    const endSpin = this.optionallyVaried("rotationEnd", "rotationEndVariance");
    const angle = f32(this.varied("angle", "angleVariance") * f32(Math.PI / 180));
    const speed = f32(this.varied("speed", "speedVariance") * this.spatialScale);
    const radial = f32(this.varied("radialAcceleration", "radialAccelVariance") * this.spatialScale);
    const tangential = f32(this.varied("tangentialAcceleration", "tangentialAccelVariance") * this.spatialScale);
    const divisor = life > 0 ? life : 1;
    this.particles.push({
      life,
      x,
      y,
      vx: f32(Math.cos(angle) * speed),
      vy: f32(-Math.sin(angle) * speed),
      radial,
      tangential,
      size: startSize,
      sizeDelta: f32(f32(finishSize - startSize) / divisor),
      color: [...start],
      colorDelta: [
        f32(f32(finish[0] - start[0]) / divisor),
        f32(f32(finish[1] - start[1]) / divisor),
        f32(f32(finish[2] - start[2]) / divisor),
        f32(f32(finish[3] - start[3]) / divisor),
      ],
      spin: startSpin,
      spinDelta: f32(f32(endSpin - startSpin) / divisor),
    });
  }

  private writeBuffers(): void {
    this.positions.fill(0);
    this.sizes.fill(1);
    this.colors.fill(0);
    const presentationScale = f32(this.options.presentationScale?.() ?? this.defaultPresentationScale());
    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index]!;
      this.positions[index * 2] = particle.x;
      this.positions[index * 2 + 1] = particle.y;
      this.sizes[index] = f32(Math.min(SOURCE_POINT_SIZE_LIMIT_PX, particle.size) * presentationScale);
      const offset = index * 4;
      this.colors[offset] = colorByte(particle.color[0]);
      this.colors[offset + 1] = colorByte(particle.color[1]);
      this.colors[offset + 2] = colorByte(particle.color[2]);
      this.colors[offset + 3] = colorByte(particle.color[3]);
    }
    this.mesh.updateBuffers();
  }

  private finish(): void {
    if (this.started) this.ticker?.remove(this.updateFn);
    this.started = false;
    this.settle();
    if (this.options.autoRemoveOnFinish && !this.destroyed) this.destroy({ children: true });
  }

  private defaultPresentationScale(): number {
    for (let node = this.parent; node !== null; node = node.parent) {
      if (node.label === "battlePointRoot" || node.label === "dungeonPointRoot") {
        const matrix = node.parent?.getGlobalTransform();
        return matrix ? Math.hypot(matrix.a, matrix.b) : 1;
      }
    }
    return 1;
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveCompletion();
  }
}

function requireNumber(asset: ParticleAsset, key: string, configName = "particle plist"): number {
  const value = asset.config[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${configName} is missing finite numeric ${key}`);
  }
  return value;
}

function colorByte(value: number): number {
  return Math.trunc(f32(f32(Math.max(0, Math.min(1, value))) * 255));
}
