import { Sprite, Texture } from "pixi.js";
import { CONTENT_SCALE_FACTOR } from "./scale9.js";

/**
 * The Task-3 point-space convention (see scale9.ts's header): sprites built from -hd (2x) textures
 * must fold `1/CONTENT_SCALE_FACTOR` into their own scale so the node measures in POINTS — the
 * widget kit's layout unit (Box gaps, Scale9 sizes, ProgressBar geometry, ...) — rather than raw hd
 * pixels. `scale9.ts`'s nine patches and `progressBar.ts`'s background/foreground sprites both
 * apply this exact fold by hand (each also anchored at (0,0), the bottom-left/Cocos2d-style origin
 * this widget kit builds everything from); this helper is the shared, one-line way to do it for any
 * new widget that just needs a plain, un-stretched point-space sprite from a single -hd texture —
 * `buttonSprite.ts` uses it directly, and `progressBar.ts`'s two hand-rolled folds are refactored
 * onto it (behavior-identical: same anchor, same scale, same texture).
 *
 * Not used by `scale9.ts`'s own patches: those additionally bake in a per-patch *layout* stretch
 * scale (`layoutScale9`'s `scale.x/y`) on top of the 1/CSF fold, so folding 1/CSF alone here
 * wouldn't save any code there.
 */
export function pointSprite(texture: Texture): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0, 0);
  sprite.scale.set(1 / CONTENT_SCALE_FACTOR);
  return sprite;
}
