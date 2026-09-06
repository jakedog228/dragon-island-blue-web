import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

import { BufferImageSource, Sprite, Texture } from "pixi.js";
import type { AssetLibrary } from "../src/assetLibrary.js";
import { Scale9 } from "../src/scale9.js";

describe("Scale9 native draw traversal", () => {
  it("builds two complete nine-patch passes like Scale9Sprite.draw plus its batch child visit", async () => {
    const texture = new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array(16 * 16 * 4),
        width: 16,
        height: 16,
      }),
    });
    const assets = {
      hasSprite: (name: string) => name === "Test-hd",
      sprite: async () => texture,
    } as unknown as AssetLibrary;

    const scale9 = await Scale9.fromConfig(
      { Test: { image: "Test.png", contentRect: "{{2,2},{4,4}}" } },
      "Test",
      assets,
      { w: 20, h: 10 },
    );

    expect(scale9.children).toHaveLength(18);
    for (let i = 0; i < 9; i += 1) {
      const first = scale9.children[i]! as Sprite;
      const second = scale9.children[i + 9]! as Sprite;
      expect({ x: second.position.x, y: second.position.y }).toEqual({
        x: first.position.x,
        y: first.position.y,
      });
      expect({ x: second.scale.x, y: second.scale.y }).toEqual({
        x: first.scale.x,
        y: first.scale.y,
      });
      expect(second.texture.frame).toMatchObject({
        x: first.texture.frame.x,
        y: first.texture.frame.y,
        width: first.texture.frame.width,
        height: first.texture.frame.height,
      });
    }
  });
});
