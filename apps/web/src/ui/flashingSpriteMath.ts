

export function flashActionOpacity(progress: number, flashes: number): number {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error(`flash progress must be between 0 and 1; got ${progress}`);
  }
  if (!Number.isInteger(flashes) || flashes <= 0) {
    throw new Error(`flash count must be a positive integer; got ${flashes}`);
  }
  const interval = Math.fround(1 / Math.fround(flashes));
  const phase = Math.fround(Math.fround(progress) / interval);
  const ratio = Math.fround(phase - Math.floor(phase));
  return Math.trunc(Math.fround(ratio * 255)) / 255;
}


export function flashForeverOpacity(elapsedMs: number, speedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(`flash elapsed time must be non-negative; got ${elapsedMs}`);
  }
  if (!Number.isFinite(speedMs) || speedMs <= 0) {
    throw new Error(`flash speed must be positive; got ${speedMs}`);
  }
  const timer = Math.fround(Math.fround(elapsedMs) % Math.fround(speedMs));
  const half = Math.fround(Math.fround(speedMs) * 0.5);
  const ratio = timer < half
    ? Math.fround(timer / half)
    : Math.fround(1 - Math.fround(Math.fround(timer - half) / half));
  return Math.trunc(Math.fround(ratio * 255)) / 255;
}
