import { describe, expect, it, vi } from "vitest";
import { Container, Rectangle, Sprite, Texture, TextureSource } from "pixi.js";
import { setOwnedTexture } from "../src/ownedTexture.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest" } });
});

describe("exclusive sprite texture ownership", () => {
  it("releases replaced views and the final view while preserving the shared source", () => {
    const source = new TextureSource({ width: 100, height: 100 });
    const shared = new Texture({ source });
    const root = new Container();
    const sprite = root.addChild(new Sprite(shared));
    const baseline = source.listenerCount("resize");
    let previous: Texture | undefined;
    for (let width = 1; width <= 100; width++) {
      const view = new Texture({ source, frame: new Rectangle(0, 0, width, 100) });
      setOwnedTexture(sprite, view);
      setOwnedTexture(sprite, view);
      expect(source.listenerCount("resize")).toBe(baseline + 1);
      expect(sprite.listenerCount("destroyed")).toBe(1);
      expect(view.destroyed).toBe(false);
      if (previous) expect(previous.destroyed).toBe(true);
      previous = view;
    }
    root.destroy({ children: true });
    expect(previous?.destroyed).toBe(true);
    expect(source.listenerCount("resize")).toBe(baseline);
    expect(shared.destroyed).toBe(false);
    expect(source.destroyed).toBe(false);
  });

  it("releases an empty crop on teardown without requiring a rendered frame", () => {
    const source = new TextureSource({ width: 100, height: 100 });
    const view = new Texture({ source, frame: new Rectangle(0, 0, 100, 0) });
    const sprite = new Sprite(view);
    setOwnedTexture(sprite, view);
    sprite.destroy();
    expect(view.destroyed).toBe(true);
    expect(source.listenerCount("resize")).toBe(0);
    expect(source.destroyed).toBe(false);
  });
});
