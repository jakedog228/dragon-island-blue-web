import type { Ticker } from "pixi.js";
import type { ParticleAsset } from "@dib/renderer";
import type { DisplayMode } from "../displayMode.js";
import { SourcePointParticleSystem } from "../sourcePointParticleSystem.js";

/**
 * Native `PoisonEffect` owns a grouped `CCParticleSystemPoint` loaded from
 * `PoisonParticles.plist`. The shared source point-system port preserves its point-list drawing,
 * byte colors, float32 simulation, emission backlog, and exact 19-draw libc `random()`
 * initialization order.
 */
export class PoisonStatusEmitter extends SourcePointParticleSystem {
  constructor(
    asset: ParticleAsset,
    ticker: Ticker,
    mode: DisplayMode,
    particleRandom: () => number = Math.random,
  ) {
    super({
      asset,
      configName: "PoisonParticles.plist",
      mode,
      ticker,
      rand: particleRandom,
    });
    this.label = "statusOverlay:poison";
  }
}
