import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

import { Sprite, Texture } from "pixi.js";
import { outlineBackgroundNode } from "../src/outlineBackground.js";

describe("outlineBackgroundNode native render-texture composition", () => {
  it("bakes additive-npm stamps into the truncated centered Bitewing viewport", () => {
    const outline = outlineBackgroundNode({
      sample: () => new Sprite(Texture.WHITE),
      contentSize: { w: 90, h: 61.5 },
      sourcePointsPerLocalPoint: 1,
      radiusPt: 3,
      color: 0xff0000,
    });

    expect(outline.isCachedAsTexture).toBe(true);
    expect(outline.boundsArea).toMatchObject({ x: -3, y: -2.75, width: 96, height: 67 });
    expect(outline.children).toHaveLength(12);
    for (const child of outline.children) {
      expect(child.tint).toBe(0xff0000);
      expect(child.blendMode).toBe("add-npm");
    }
    expect(outline.children[0]!.position).toMatchObject({ x: 3, y: 0.25 });
    expect(outline.children[6]!.position.x).toBeCloseTo(-3);
    expect(outline.children[6]!.position.y).toBeCloseTo(0.25);
    // Only the visits are additive; the returned CCRenderTexture sprite is scene-composited normally.
    expect(outline.blendMode).toBe("normal");
  });
});
