import { describe, expect, it, vi } from "vitest";
import { Rectangle, Sprite, Texture, TextureSource } from "pixi.js";
import { ProgressBar } from "../src/progressBar.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest" } });
});

function assets() {
  const source = new TextureSource({ width: 512, height: 512 });
  const backgroundTexture = new Texture({ source, frame: new Rectangle(2, 107, 200, 26) });
  const foregroundTexture = new Texture({ source, frame: new Rectangle(2, 135, 180, 22) });
  return { source, backgroundTexture, foregroundTexture };
}

describe("ProgressBar texture ownership", () => {
  it("bounds source listeners while HP animates and releases them on repeated teardown", () => {
    const shared = assets();
    const listeners = shared.source.listenerCount("resize");
    for (let lifetime = 0; lifetime < 12; lifetime++) {
      const bar = new ProgressBar({ ...shared, labelFontFile: null });
      const foreground = bar.children[0] as Sprite;
      const owned = foreground.texture;
      expect(shared.source.listenerCount("resize")).toBe(listeners + 1);
      for (let cycle = 0; cycle < 5; cycle++) {
        bar.setRatio(cycle % 2);
        for (let tick = 0; tick < 41; tick++) bar.update(16);
        expect(shared.source.listenerCount("resize")).toBe(listeners + 1);
        expect(foreground.texture).toBe(owned);
      }
      bar.destroy({ children: true });
      expect(owned.destroyed).toBe(true);
      expect(shared.source.listenerCount("resize")).toBe(listeners);
      expect(shared.foregroundTexture.destroyed).toBe(false);
      expect(shared.backgroundTexture.destroyed).toBe(false);
      expect(shared.source.destroyed).toBe(false);
    }
  });

  it.each([false, true])("updates crop UVs and sprite bounds, backwards=%s", backwards => {
    const shared = assets();
    const bar = new ProgressBar({ ...shared, labelFontFile: null, textureRevalBackwards: backwards });
    const foreground = bar.children[0] as Sprite;
    for (const ratio of [1, .5, .125, 0, .75]) {
      bar.setRatio(ratio);
      bar.snapToTarget();
      expect(foreground.texture.frame.width).toBe(180 * ratio);
      expect(foreground.texture.frame.x).toBe(backwards ? 182 - 180 * ratio : 2);
      expect(foreground.texture.uvs.x0).toBeCloseTo(foreground.texture.frame.x / 512);
      expect(foreground.texture.uvs.x1).toBeCloseTo((foreground.texture.frame.x + 180 * ratio) / 512);
      expect(foreground.getLocalBounds().width).toBeCloseTo(180 * ratio);
      expect(foreground.width).toBeCloseTo(90 * ratio);
      expect(foreground.height).toBe(11);
      expect(shared.foregroundTexture.frame).toEqual(new Rectangle(2, 135, 180, 22));
    }
    bar.destroy({ children: true });
  });
});
