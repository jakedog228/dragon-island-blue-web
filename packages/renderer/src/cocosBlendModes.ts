import type { Renderer } from "pixi.js";

interface MutableGlBlendState {
  readonly blendModesMap: Record<string, number[]>;
}

/**
 * Install Cocos2d's ordinary `glBlendFunc(GL_SRC_ALPHA, GL_ONE)` behind the Pixi label used by
 * source non-premultiplied additive sprites. Pixi 8's stock map uses `blendFuncSeparate` and
 * accumulates source alpha as A instead of the native A², which changes translucent outline and
 * flash edges after the render texture is normally composited.
 *
 * FixedStage pins WebGL. The context runner listener is appended after Pixi's state system, so a
 * restored GL context receives the same two-factor map after Pixi recreates its defaults.
 */
export function installCocosSourceAlphaAddBlend(renderer: Renderer): () => void {
  if (!("gl" in renderer) || !("state" in renderer)) {
    throw new Error("Cocos source-alpha additive blending requires the pinned WebGL renderer");
  }
  const apply = (): void => {
    const state = renderer.state as unknown as MutableGlBlendState;
    state.blendModesMap["add-npm"] = [renderer.gl.SRC_ALPHA, renderer.gl.ONE];
  };
  const listener = { contextChange: apply };
  apply();
  renderer.runners.contextChange.add(listener);
  return () => { renderer.runners.contextChange.remove(listener); };
}
