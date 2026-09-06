import { Container, Sprite, type Ticker } from "pixi.js";
import { flashForeverOpacity } from "./flashingSpriteMath.js";








export class SourceFlashingSprite {
  private readonly copies: readonly [Sprite, Sprite];
  private elapsedMs = 0;
  private running = false;

  constructor(parent: Container, source: Sprite);
  constructor(parent: Container, source: Sprite, ticker: Ticker, speedMs: number);
  constructor(
    parent: Container,
    source: Sprite,
    private readonly ticker?: Ticker,
    private readonly speedMs?: number,
  ) {
    if ((ticker === undefined) !== (speedMs === undefined)) {
      throw new Error("SourceFlashingSprite requires both ticker and speed, or neither");
    }
    this.copies = [cloneForFlash(source), cloneForFlash(source)];
    try {
      const sourceIndex = parent.getChildIndex(source);
      parent.addChildAt(this.copies[0], sourceIndex + 1);
      parent.addChildAt(this.copies[1], sourceIndex + 2);
    } catch (error) {
      // Keep construction atomic: a failed second insertion must not leave one additive sibling in
      // the scene. This also lets fire-and-forget presentation callers safely degrade to the base.
      for (const copy of this.copies) destroyFlashCopy(copy);
      throw error;
    }
  }

  start(): void {
    if (this.ticker === undefined || this.speedMs === undefined) {
      throw new Error("A manually driven SourceFlashingSprite cannot start FlashForeverAction");
    }
    this.elapsedMs = 0;
    this.setFlashOpacity(0);
    if (this.running) return;
    this.running = true;
    this.ticker.add(this.tick);
  }

  /** Normalized counterpart of source `setFlashOpacity:` (the source property is an unsigned byte). */
  setFlashOpacity(opacity: number): void {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new Error(`flash opacity must be between 0 and 1; got ${opacity}`);
    }
    for (const copy of this.copies) {
      if (!copy.destroyed) copy.alpha = opacity;
    }
  }

  stop(): void {
    if (this.running) this.ticker?.remove(this.tick);
    this.running = false;
    this.elapsedMs = 0;
    this.setFlashOpacity(0);
  }

  destroy(): void {
    this.stop();
    for (const copy of this.copies) destroyFlashCopy(copy);
  }

  get debugState(): { running: boolean; elapsedMs: number; opacity: number; strength: 2 } {
    return {
      running: this.running,
      elapsedMs: Math.round(this.elapsedMs),
      opacity: this.copies[0].destroyed ? 0 : this.copies[0].alpha,
      strength: 2,
    };
  }

  private readonly tick = (): void => {
    if (this.ticker === undefined || this.speedMs === undefined) return;
    this.elapsedMs = Math.fround(this.elapsedMs + Math.fround(this.ticker.deltaMS));
    this.setFlashOpacity(flashForeverOpacity(this.elapsedMs, this.speedMs));
  };
}

function cloneForFlash(source: Sprite): Sprite {
  const copy = new Sprite(source.texture);
  copy.anchor.copyFrom(source.anchor);
  copy.position.copyFrom(source.position);
  copy.scale.copyFrom(source.scale);
  copy.skew.copyFrom(source.skew);
  copy.rotation = source.rotation;
  copy.tint = source.tint;
  copy.zIndex = source.zIndex;
  copy.blendMode = "add-npm";
  copy.alpha = 0;
  copy.eventMode = "none";
  return copy;
}

function destroyFlashCopy(copy: Sprite): void {
  if (copy.parent !== null) copy.parent.removeChild(copy);
  if (!copy.destroyed) copy.destroy();
}
