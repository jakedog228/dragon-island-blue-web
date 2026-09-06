// Pure animation-metadata resolution (no PixiJS import — usable from Node tests and tooling).
import { pickTier } from "./frames.js";

export interface AnimationEntry {
  fps: number;
  numFrames: number;
  spriteframeFormat: string;
  startFrame: number;
  spritesheets: string[];
}
export type AnimationsData = Record<string, Record<string, AnimationEntry>>;

export function resolveAnimation(
  anims: AnimationsData,
  name: string,
  tier: number,
): { entry: AnimationEntry; tierKey: string } {
  const tiers = anims[name];
  if (!tiers) throw new Error(`unknown animation: ${name}`);
  const tierKey = pickTier(Object.keys(tiers), tier);
  const entry = tiers[tierKey];
  if (!entry) throw new Error(`animation ${name} has no tier ${tierKey}`);
  return { entry, tierKey };
}

export function animationDurationMs(entry: AnimationEntry): number {
  return (entry.numFrames / entry.fps) * 1000;
}
