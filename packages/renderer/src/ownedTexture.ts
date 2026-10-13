import type { Sprite, Texture } from "pixi.js";

const ownedTextures = new WeakMap<Sprite, Texture>();

/** Assign an exclusive crop/view to a sprite. Shared atlas textures remain caller-owned. */
export function setOwnedTexture(sprite: Sprite, texture: Texture): void {
  const previous = ownedTextures.get(sprite);
  if (previous === texture) return;
  if (!previous) {
    sprite.once("destroyed", () => {
      ownedTextures.get(sprite)?.destroy(false);
      ownedTextures.delete(sprite);
    });
  }
  ownedTextures.set(sprite, texture);
  sprite.texture = texture;
  previous?.destroy(false);
}
