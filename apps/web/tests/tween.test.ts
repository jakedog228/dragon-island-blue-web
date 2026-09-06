import { describe, expect, it } from "vitest";
import {
  createTickerAdvancer,
  easeElasticInOut,
  easeElasticOut,
  easeExponentialIn,
  easeExponentialOut,
  evenlyShakenOffset,
  shakenOffset,
  tweenWithResult,
  type ManuallyAdvanceableTicker,
  type TweenResult,
} from "../src/tween.js";

class FakeTicker implements ManuallyAdvanceableTicker {
  lastTime = 100;
  stopped = false;
  updates: number[] = [];
  stop(): void { this.stopped = true; }
  update(currentTime = this.lastTime): void {
    this.lastTime = currentTime;
    this.updates.push(currentTime);
  }
}

class TweenTicker {
  deltaMS = 16;
  readonly listeners = new Set<() => void>();
  add(listener: () => void): void { this.listeners.add(listener); }
  remove(listener: () => void): void { this.listeners.delete(listener); }
  tick(): void { for (const listener of [...this.listeners]) listener(); }
  get count(): number { return this.listeners.size; }
}

/**
 * Pixi's `Ticker.destroy()` nulls `_head`, after which `count` reports 0 and `remove()` throws on
 * `this._head.next`. `Application.destroy` destroys the TickerPlugin BEFORE it recursively
 * destroys the stage children, so a child destructor that aborts a ticker-backed action reaches
 * exactly this state.
 */
class DestroyedTicker extends TweenTicker {
  destroyed = false;
  override get count(): number { return this.destroyed ? 0 : this.listeners.size; }
  override remove(listener: () => void): void {
    if (this.destroyed) throw new TypeError("Cannot read properties of null (reading 'next')");
    super.remove(listener);
  }
  destroy(): void { this.destroyed = true; this.listeners.clear(); }
}

describe("createTickerAdvancer", () => {
  it("stops real time and advances fixed frames plus the exact remainder", async () => {
    const ticker = new FakeTicker();
    const advance = createTickerAdvancer(ticker, 10);
    await advance(25);
    expect(ticker.stopped).toBe(true);
    expect(ticker.updates).toEqual([110, 120, 125]);
  });

  it("rejects invalid durations", async () => {
    const advance = createTickerAdvancer(new FakeTicker());
    await expect(advance(-1)).rejects.toThrow("invalid manual advance");
    await expect(advance(Number.NaN)).rejects.toThrow("invalid manual advance");
  });

  it("stops advancing when a session restart destroys the captured ticker", async () => {
    class ReplacedTicker extends FakeTicker {
      count = 1;
      override update(currentTime = this.lastTime): void {
        super.update(currentTime);
        this.count = 0;
      }
    }
    const ticker = new ReplacedTicker();
    const advance = createTickerAdvancer(ticker, 10);

    await advance(25);

    expect(ticker.updates).toEqual([110]);
  });
});

describe("tween lifecycle", () => {
  it("survives a cancellation that arrives after the owning application destroyed the ticker", async () => {
    const ticker = new DestroyedTicker();
    const controller = new AbortController();
    const pending = tweenWithResult(
      ticker as unknown as Parameters<typeof tweenWithResult>[0],
      500,
      () => {},
      (progress) => progress,
      controller.signal,
    );

    // Pixi order: TickerPlugin.destroy() first, recursive child destruction (which aborts) second.
    ticker.destroy();
    controller.abort();

    await expect(pending).resolves.toBe("cancelled");
  });

  it("detaches and reports cancellation without an update when its owning scene is aborted", async () => {
    const ticker = new TweenTicker();
    const controller = new AbortController();
    const updates: number[] = [];
    const pending = tweenWithResult(
      ticker as unknown as Parameters<typeof tweenWithResult>[0],
      100,
      (progress) => updates.push(progress),
      (progress) => progress,
      controller.signal,
    );

    expect(ticker.listeners.size).toBe(1);
    controller.abort();
    await expect(pending).resolves.toBe("cancelled");
    ticker.tick();

    expect(ticker.listeners.size).toBe(0);
    expect(updates).toEqual([]);
  });

  it("distinguishes a completed action from cancellation", async () => {
    const ticker = new TweenTicker();
    ticker.deltaMS = 50;
    const pending = tweenWithResult(
      ticker as unknown as Parameters<typeof tweenWithResult>[0],
      100,
      () => {},
    );

    ticker.tick();
    ticker.tick();

    await expect(pending).resolves.toBe("completed");
    expect(ticker.listeners.size).toBe(0);
  });
});

/** A Pixi-shaped ticker: `update` publishes the measured delta and dispatches, exactly the pair
 *  `createTickerAdvancer` drives in the browser. `lastTime` starts on a page-clock-like fraction
 *  rather than a round number so the per-frame deltas carry the same rounding the real app sees. */
class DispatchingTicker implements ManuallyAdvanceableTicker {
  lastTime = 3427.7999999999997;
  deltaMS = 0;
  count = 1;
  readonly listeners = new Set<() => void>();
  stop(): void {}
  update(currentTime = this.lastTime): void {
    this.deltaMS = currentTime - this.lastTime;
    this.lastTime = currentTime;
    for (const listener of [...this.listeners]) listener();
  }
  add(listener: () => void): void { this.listeners.add(listener); }
  remove(listener: () => void): void { this.listeners.delete(listener); }
}

describe("deterministically driven tweens", () => {
  it("settles a tween the driver advances by exactly its duration", async () => {
    // The startup fade drives its own clock: `Promise.all([tween(ms), advanceTime(ms)])`. Summing
    // fifteen 1000/60 frames reaches 249.99999999999773, not 250, so a tween that demands the full
    // duration never settles and no later frame arrives to save it -- that hang stalled every
    // deterministic browser scenario at the preloader.
    const ticker = new DispatchingTicker();
    const advance = createTickerAdvancer(ticker);
    const progress: number[] = [];
    let result: TweenResult | undefined;
    void tweenWithResult(
      ticker as unknown as Parameters<typeof tweenWithResult>[0],
      250,
      (t) => progress.push(t),
    ).then((settled) => { result = settled; });

    await advance(250);
    await Promise.resolve();

    expect(result).toBe("completed");
    expect(progress.at(-1)).toBe(1);
    expect(ticker.listeners.size).toBe(0);
  });

  it("does not let the float slack finish a tween that is genuinely short", async () => {
    // The slack absorbs rounding, nothing more: a microsecond of missing time is a thousand times
    // the tolerance and must still leave the tween running.
    const ticker = new DispatchingTicker();
    const advance = createTickerAdvancer(ticker);
    const progress: number[] = [];
    let result: TweenResult | undefined;
    void tweenWithResult(
      ticker as unknown as Parameters<typeof tweenWithResult>[0],
      250,
      (t) => progress.push(t),
    ).then((settled) => { result = settled; });

    await advance(250 - 1e-3);
    await Promise.resolve();
    expect(result).toBeUndefined();
    expect(progress.at(-1)).toBeLessThan(1);

    await advance(1e-3);
    await Promise.resolve();
    expect(result).toBe("completed");
    expect(progress.at(-1)).toBe(1);
  });
});

describe("easeElasticOut", () => {
  it("pins the Cocos action endpoints", () => {
    expect(easeElasticOut(0, 0.1)).toBe(0);
    expect(easeElasticOut(1, 0.1)).toBe(1);
    expect(easeElasticOut(0.5, 0.1)).toBeGreaterThan(0.9);
  });

  it("pins the recovered quarter/half/quarter shake sequence", () => {
    expect(evenlyShakenOffset(0, 3)).toBe(0);
    expect(evenlyShakenOffset(0.25, 3)).toBe(3);
    expect(evenlyShakenOffset(0.75, 3)).toBe(-3);
    expect(evenlyShakenOffset(1, 3)).toBe(0);
  });
});




describe("shakenOffset (two-leg non-Evenly ActionFactory shake)", () => {
  it("pins the half/half there-and-back legs", () => {
    expect(shakenOffset(0, 2)).toBe(0);
    expect(shakenOffset(0.25, 2)).toBe(1);
    expect(shakenOffset(0.5, 2)).toBe(2);
    expect(shakenOffset(0.75, 2)).toBe(1);
    expect(shakenOffset(1, 2)).toBe(0);
  });

  it("extrapolates linearly for elastic overshoot beyond the sequence range (Cocos MoveBy t>1)", () => {
    expect(shakenOffset(1.25, 2)).toBeCloseTo(-1);
    expect(shakenOffset(-0.25, 2)).toBeCloseTo(-1);
  });
});

describe("easeElasticInOut", () => {
  it("pins the Cocos action endpoints and midpoint", () => {
    expect(easeElasticInOut(0)).toBe(0);
    expect(easeElasticInOut(0.5)).toBeCloseTo(0.5);
    expect(easeElasticInOut(1)).toBe(1);
  });
});

describe("Cocos exponential one-way eases", () => {
  it("pins endpoints and gives fall a slow-in / rotation a fast-out midpoint", () => {
    expect(easeExponentialIn(0)).toBe(0);
    expect(easeExponentialIn(0.5)).toBeCloseTo(0.03125);
    expect(easeExponentialIn(1)).toBe(1);
    expect(easeExponentialOut(0)).toBe(0);
    expect(easeExponentialOut(0.5)).toBeCloseTo(0.96875);
    expect(easeExponentialOut(1)).toBe(1);
  });
});
