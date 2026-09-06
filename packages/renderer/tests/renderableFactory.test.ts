import { Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  createRenderableSpriteNode,
  renderableScaledContentSize,
  renderableSprite,
} from "../src/renderableFactory.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

describe("createRenderableSpriteNode", () => {
  it("keeps the CCSprite point fold on the child and authored scale on the factory root", () => {
    const root = createRenderableSpriteNode({
      texture: Texture.EMPTY,
      rendererData: { scale: 0.5 },
      label: "renderable:FireCub",
    });
    const sprite = renderableSprite(root);
    const local = root.getLocalBounds();

    expect(root.label).toBe("renderable:FireCub");
    expect({ x: sprite.anchor.x, y: sprite.anchor.y }).toEqual({ x: 0, y: 0 });
    expect({ x: sprite.scale.x, y: sprite.scale.y }).toEqual({ x: 0.5, y: 0.5 });
    expect({ x: root.scale.x, y: root.scale.y }).toEqual({ x: 0.5, y: 0.5 });
    expect({ x: local.x, y: local.y }).toEqual({ x: 0, y: 0 });
    expect(root.width).toBeCloseTo(local.width * 0.5, 10);
    expect(renderableScaledContentSize(root)).toEqual({
      w: local.width * 0.5,
      h: local.height * 0.5,
    });
  });

  it("defaults an absent rendererData scale to one", () => {
    const root = createRenderableSpriteNode({ texture: Texture.EMPTY });
    expect({ x: root.scale.x, y: root.scale.y }).toEqual({ x: 1, y: 1 });
  });

  it("fails loudly on renderer shapes outside the shipped monster CCSprite corpus", () => {
    expect(() => createRenderableSpriteNode({
      texture: Texture.EMPTY,
      rendererData: { class: "AnimatedNode" },
    })).toThrow(/unsupported rendererData keys class/);
    expect(() => createRenderableSpriteNode({
      texture: Texture.EMPTY,
      rendererData: { scale: Number.NaN },
    })).toThrow(/scale must be finite/);
  });
});
