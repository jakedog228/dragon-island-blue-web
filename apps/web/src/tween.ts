import type { Ticker } from "pixi.js";

/** Minimal ticker surface for deterministic browser stepping. Keeping this structural makes the
 * stepping algorithm Node-testable without importing PixiJS. */
export interface ManuallyAdvanceableTicker {
  lastTime: number;
  /** Pixi reports zero after `Ticker.destroy()` nulls its listener head. Optional for structural
   * test doubles and alternate ticker implementations. */
  readonly count?: number;
  stop(): void;
  update(currentTime?: number): void;
}

export type TweenResult = "completed" | "cancelled";

/** A tween settles on elapsed time accumulated one frame delta at a time, so its total is a
 *  floating-point SUM rather than the driver's own duration. A deterministic driver that advances
 *  exactly the tween's duration in fixed 1000/60 frames lands a few ulps short -- 250ms arrives as
 *  249.99999999999773 -- leaving `t` at 0.9999999999999909 and the tween unsettled forever, with
 *  no further frames coming to rescue it. (Real rAF frames overshoot instead, which is why this
 *  only ever bit the manually driven path: the startup fade under `driveDeterministicTime` hung
 *  there, stalling every deterministic browser scenario at the preloader.) A nanosecond of slack
 *  is six orders of magnitude below a frame, so no tween observes a different frame count. */
const COMPLETION_TOLERANCE_MS = 1e-6;

/**
 * Has `elapsedMs` covered `durationMs`?
 *
 * Every timeline in the renderer accumulates `ticker.deltaMS` frame by frame, so its total is a
 * floating-point SUM that lands a few ulps either side of the duration it was built from. Compared
 * with `>=`, a shortfall of 1e-13 costs a whole 16.7ms frame -- and under a deterministic driver
 * that advances exactly the duration, it costs the completion entirely. Use this wherever an
 * accumulated elapsed decides that a timed presentation is finished.
 */
export function elapsedCovers(elapsedMs: number, durationMs: number): boolean {
  return elapsedMs + COMPLETION_TOLERANCE_MS >= durationMs;
}

/** Drive the same ticker that owns rendering, battle pacing, tweens, HP bars, and effects. */
export function createTickerAdvancer(
  ticker: ManuallyAdvanceableTicker,
  frameMs = 1000 / 60,
): (ms: number) => Promise<void> {
  if (!(frameMs > 0) || !Number.isFinite(frameMs)) throw new Error(`invalid manual frame size: ${frameMs}`);
  let manualTime = ticker.lastTime >= 0 ? ticker.lastTime : 0;
  return async (ms: number): Promise<void> => {
    if (!(ms >= 0) || !Number.isFinite(ms)) throw new Error(`invalid manual advance: ${ms}`);
    ticker.stop();
    let remaining = ms;
    while (remaining > 0) {
      // A scene/session restart may replace the application while an async continuation is still
      // inside this deterministic advance call. Never call update() again on Pixi's destroyed old
      // ticker (`_head === null`); the newly installed window.advanceTime owns the new ticker.
      if (ticker.count === 0) return;
      const step = Math.min(frameMs, remaining);
      manualTime = Math.max(manualTime, ticker.lastTime >= 0 ? ticker.lastTime : 0) + step;
      ticker.update(manualTime);
      remaining -= step;
      // Let nested async continuations register the next action before the next fixed frame.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}





export function tweenWithResult(
  ticker: Ticker,
  ms: number,
  onUpdate: (t: number) => void,
  ease: (t: number) => number = (t) => t,
  signal?: AbortSignal,
): Promise<TweenResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve("cancelled");
      return;
    }
    let elapsed = 0;
    let settled = false;
    const finish = (result: TweenResult) => {
      if (settled) return;
      settled = true;
      // A destroyed Pixi ticker reports `count === 0` because `Ticker.destroy()` nulls `_head`,
      // and `Ticker.remove()` opens with `this._head.next`. `step` is on the list until this
      // point, so a live ticker always reports at least 1 here and the removal still happens;
      // only a ticker that has already discarded every listener is skipped. Compared against 0
      // rather than `> 0` so a structural test double without a `count` still detaches normally. This keeps a
      // cancellation that arrives *after* the owning application was torn down from throwing
      // "Cannot read properties of null (reading 'next')" out of a destructor. Owners are still
      // expected to cancel before teardown -- see `registerDispose` in startupSequence.ts.
      if (ticker.count !== 0) ticker.remove(step);
      signal?.removeEventListener("abort", cancel);
      resolve(result);
    };
    const cancel = () => finish("cancelled");
    const step = () => {
      elapsed += ticker.deltaMS;
      const t = elapsed + COMPLETION_TOLERANCE_MS >= ms ? 1 : elapsed / ms;
      onUpdate(ease(t));
      if (t >= 1) finish("completed");
    };
    signal?.addEventListener("abort", cancel, { once: true });
    ticker.add(step);
  });
}

/** Compatibility wrapper for presentation actions whose callers do not own cancellation policy. */
export function tween(
  ticker: Ticker,
  ms: number,
  onUpdate: (t: number) => void,
  ease: (t: number) => number = (t) => t,
  signal?: AbortSignal,
): Promise<void> {
  return tweenWithResult(ticker, ms, onUpdate, ease, signal).then(() => {});
}





export function easeSineInOut(t: number): number {
  return -0.5 * (Math.cos(Math.PI * t) - 1);
}








export function easeExponentialInOut(t: number): number {
  if (t === 0) return 0;
  if (t === 1) return 1;
  const s = t * 2;
  if (s < 1) return 0.5 * Math.pow(2, 10 * (s - 1));
  return 0.5 * (-Math.pow(2, -10 * (s - 1)) + 2);
}

/** Cocos2d `CCEaseExponentialIn` (rate 10). */
export function easeExponentialIn(t: number): number {
  if (t === 0) return 0;
  return Math.pow(2, 10 * (t - 1));
}

/** Cocos2d `CCEaseExponentialOut` (rate 10). */
export function easeExponentialOut(t: number): number {
  if (t === 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}





export function easeElasticIn(t: number, period = 0.3): number {
  if (t === 0 || t === 1) return t;
  const s = period / 4;
  const u = t - 1;
  return -Math.pow(2, 10 * u) * Math.sin(((u - s) * Math.PI * 2) / period);
}

/** Cocos2d `CCEaseElasticOut` with the caller-supplied period. */
export function easeElasticOut(t: number, period = 0.3): number {
  if (t === 0 || t === 1) return t;
  const s = period / 4;
  return Math.pow(2, -10 * t) * Math.sin(((t - s) * Math.PI * 2) / period) + 1;
}

/** Cocos2d `CCEaseElasticInOut` with the default action period supplied by the caller. */
export function easeElasticInOut(t: number, period = 0.3): number {
  if (t === 0 || t === 1) return t;
  const s = period / 4;
  const doubled = t * 2;
  if (doubled < 1) {
    const u = doubled - 1;
    return -0.5 * Math.pow(2, 10 * u) * Math.sin(((u - s) * Math.PI * 2) / period);
  }
  const u = doubled - 1;
  return Math.pow(2, -10 * u) * Math.sin(((u - s) * Math.PI * 2) / period) * 0.5 + 1;
}

/** Three MoveBy legs used by `ActionFactory shakeNodeEvenly...`, before its outer ease. */
export function evenlyShakenOffset(sequenceProgress: number, offset: number): number {
  if (sequenceProgress < 0.25) return offset * (sequenceProgress / 0.25);
  if (sequenceProgress < 0.75) return offset + (-2 * offset) * ((sequenceProgress - 0.25) / 0.5);
  return -offset + offset * ((sequenceProgress - 0.75) / 0.25);
}








export function shakenOffset(sequenceProgress: number, offset: number): number {
  if (sequenceProgress < 0.5) return offset * (sequenceProgress / 0.5);
  return offset * (1 - (sequenceProgress - 0.5) / 0.5);
}
