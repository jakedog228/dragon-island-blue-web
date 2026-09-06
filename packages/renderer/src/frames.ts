/** Frame-name expansion for Animations.json entries: `"Turbulance%d.png"` + startFrame/numFrames. */
export function expandFrameNames(format: string, startFrame: number, numFrames: number): string[] {
  if (!format.includes("%d")) throw new Error(`spriteframeFormat has no %d: ${format}`);
  if (!Number.isInteger(numFrames) || numFrames < 1) throw new Error(`bad numFrames: ${numFrames}`);
  return Array.from({ length: numFrames }, (_, i) => format.replace("%d", String(startFrame + i)));
}


export function pickTier(available: string[], requested: number): string {
  const tiers = available.map(Number).sort((a, b) => a - b);
  if (tiers.some((t) => !Number.isFinite(t))) {
    throw new Error(`pickTier: non-numeric tier key among [${available.join(", ")}]`);
  }
  if (tiers.length === 0) throw new Error("pickTier: no tiers available");
  let best: number | undefined;
  for (const t of tiers) if (t <= requested) best = t;
  return String(best ?? tiers[0]);
}
