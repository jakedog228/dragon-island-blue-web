



export function jobCreationLevel(requestedLevel: number): number {
  if (!Number.isSafeInteger(requestedLevel)) {
    throw new Error(`Job construction requires an integer level; got ${requestedLevel}`);
  }
  return Math.max(1, Math.min(150, requestedLevel));
}
