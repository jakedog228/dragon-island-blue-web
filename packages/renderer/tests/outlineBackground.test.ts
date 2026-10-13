import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

import { Container, Sprite, Texture } from "pixi.js";
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


describe("cached outline teardown", () => {
  it("bounds instruction identities across repeated parent teardown and rebuild", () => {
    const instructionIds = new Set<number>();
    for (let lifetime = 0; lifetime < 12; lifetime++) {
      const parent = new Container();
      const outlines = Array.from({ length: 3 }, () => outlineBackgroundNode({
        sample: () => new Sprite(Texture.WHITE),
        contentSize: { w: 90, h: 61.5 },
        sourcePointsPerLocalPoint: 1, radiusPt: 3, color: 0xffffff,
      }));
      for (const outline of outlines) {
        parent.addChild(outline);
        expect(outline.isCachedAsTexture).toBe(true);
        expect(outline.renderGroup?.root).toBe(outline);
        instructionIds.add(outline.renderGroup!.instructionSet.uid);
      }
      parent.destroy({ children: true });
      for (const outline of outlines) {
        expect(outline.destroyed).toBe(true);
        expect(outline.renderGroup).toBeNull();
      }
    }
    // Pixi's batch pipe retains buffers by instruction uid. Retiring each outline must
    // make that identity reusable, bounded by the maximum simultaneously live outlines.
    expect(instructionIds.size).toBeLessThanOrEqual(3);
    expect(Texture.WHITE.destroyed).toBe(false);
  });
});
