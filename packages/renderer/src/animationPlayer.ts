import { AnimatedSprite, type Spritesheet, type Texture } from "pixi.js";
import { expandFrameNames } from "./frames.js";
import type { AnimationEntry } from "./animations.js";

/** loop=false; caller positions, plays, and destroys it. animationSpeed assumes a 60fps ticker. */
export function buildAnimation(entry: AnimationEntry, sheets: Spritesheet[]): AnimatedSprite {
  const names = expandFrameNames(entry.spriteframeFormat, entry.startFrame, entry.numFrames);
  const textures: Texture[] = names.map((n) => {
    for (const sheet of sheets) {
      const t = sheet.textures[n];
      if (t) return t;
    }
    throw new Error(`animation frame not found in provided sheets: ${n}`);
  });
  const sprite = new AnimatedSprite(textures);
  sprite.loop = false;
  sprite.animationSpeed = entry.fps / 60;
  sprite.anchor.set(0.5);
  return sprite;
}
