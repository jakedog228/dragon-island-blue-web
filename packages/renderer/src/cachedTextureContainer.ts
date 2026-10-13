import { Container, type DestroyOptions } from "pixi.js";

/** A cached render target whose render group can be reused after scene teardown. */
export class CachedTextureContainer extends Container {
  override destroy(options?: DestroyOptions): void {
    if (this.destroyed) return;
    // Pixi 8.19 keeps batch buffers keyed by instruction-set uid. Container.destroy()
    // discards its render group, whereas disabling the cache returns that group to
    // Pixi's pool. Reuse its identity so transient outlines cannot grow the buffer map.
    // Do this before super: the destroyed event runs after effects/children are cleared.
    this.cacheAsTexture(false);
    super.destroy(options);
  }
}
