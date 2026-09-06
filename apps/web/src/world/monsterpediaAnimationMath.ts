/**
 * Pure interval math shared by the Monsterpedia's source-timed actions.
 *
 * `CCActionInterval -step:` does not consume dt on its first scheduled tick. Learned recipe
 * ingredients run `CCRepeatForever(CCSequence(CCFadeOut(.5), CCFadeIn(.5)))`; Complete List's
 * selected label runs the inverse black->white->black tint sequence. Both ultimately write 8-bit
 * channels, truncating toward zero before Pixi normalization.
 */

export interface CocosIntervalStep {
  readonly elapsedMs: number;
  readonly firstTick: false;
}

export function stepMonsterpediaCocosInterval(
  elapsedMs: number,
  deltaMs: number,
  firstTick: boolean,
): CocosIntervalStep {
  return {
    elapsedMs: firstTick ? 0 : elapsedMs + Math.max(0, deltaMs),
    firstTick: false,
  };
}

/** Structural ticker surface keeps the source interval/cancellation contract unit-testable. */
export interface MonsterpediaIntervalTicker {
  readonly deltaMS: number;
  add(callback: () => void): unknown;
  remove(callback: () => void): unknown;
}

/** Generic source-style interval waiter retained for isolated clock/cancellation tests. The live
 * Monsterpedia page curl owns its visual and input lifetime together in monsterpediaPageTurn.ts. */
export function waitForMonsterpediaInputLock(
  ticker: MonsterpediaIntervalTicker,
  durationMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    let elapsedMs = 0;
    let firstTick = true;
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      ticker.remove(step);
      signal.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);
    const step = () => {
      const next = stepMonsterpediaCocosInterval(elapsedMs, ticker.deltaMS, firstTick);
      elapsedMs = next.elapsedMs;
      firstTick = next.firstTick;
      if (elapsedMs >= durationMs) finish(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    ticker.add(step);
  });
}

function repeatedHalfSecondTriangle(elapsedMs: number): { cycleMs: number; rising: boolean } {
  const cycleMs = ((elapsedMs % 1000) + 1000) % 1000;
  return { cycleMs, rising: cycleMs > 500 };
}

/** Source ingredient opacity as the exact GLubyte supplied to CCSprite.setOpacity:. */
export function monsterpediaIngredientFlashOpacity(elapsedMs: number): number {
  const { cycleMs, rising } = repeatedHalfSecondTriangle(elapsedMs);
  const value = rising
    ? 255 * ((cycleMs - 500) / 500)
    : 255 * (1 - cycleMs / 500);
  return Math.max(0, Math.min(255, Math.trunc(value)));
}

export function monsterpediaIngredientFlashAlpha(elapsedMs: number): number {
  return monsterpediaIngredientFlashOpacity(elapsedMs) / 255;
}

/** Selected Complete List label's black->white->black channel byte. */
export function monsterpediaSelectedLabelChannel(elapsedMs: number): number {
  const { cycleMs, rising } = repeatedHalfSecondTriangle(elapsedMs);
  const value = rising
    ? 255 * (1 - (cycleMs - 500) / 500)
    : 255 * (cycleMs / 500);
  return Math.max(0, Math.min(255, Math.trunc(value)));
}

export function monsterpediaSelectedLabelTint(elapsedMs: number): number {
  const channel = monsterpediaSelectedLabelChannel(elapsedMs);
  return (channel << 16) | (channel << 8) | channel;
}
