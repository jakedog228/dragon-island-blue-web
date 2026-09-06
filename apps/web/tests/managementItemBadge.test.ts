import { Texture, type Container, type Sprite } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});
vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));

const { buildManagementItemBadge } = await import("../src/ui/managementItemBadge.js");
const { MANAGEMENT_CARD_SIZE_PT } = await import("../src/battle/monsterManagementMath.js");

/** The shipped Soul Stone frames are 139x141 -hd pixels = 69.5x70.5 points. */
function soulStoneTexture(): Texture {
  return new Texture({ source: Texture.WHITE.source, frame: { x: 0, y: 0, width: 139, height: 141 } as never });
}

function scaledLayer(badge: Container): Container {
  return badge.children[0] as Container;
}

describe("buildManagementItemBadge (background @ 0xaad9e..0xaae4a)", () => {
  it("anchors the item at the card's Cocos (0,0) — the card's bottom-left corner", () => {
    const badge = buildManagementItemBadge(soulStoneTexture());
    expect(badge.position.x).toBe(-MANAGEMENT_CARD_SIZE_PT / 2);
    expect(badge.position.y).toBe(MANAGEMENT_CARD_SIZE_PT / 2);
  });

  it("shrink-fits into cardSize/5 with sub_65d50's single uniform setScale:", () => {
    const badge = buildManagementItemBadge(soulStoneTexture());
    const scaled = scaledLayer(badge);
    // fminf(1, fminf(16/69.5, 16/70.5)) — the height is the binding dimension.
    const expected = (MANAGEMENT_CARD_SIZE_PT / 5) / 70.5;
    expect(scaled.scale.x).toBeCloseTo(expected, 6);
    expect(scaled.scale.y).toBe(scaled.scale.x);
    const item = scaled.children.at(-1) as Sprite;
    expect(item.width * scaled.scale.x).toBeCloseTo(69.5 * expected, 6);
    expect(item.height * scaled.scale.y).toBeCloseTo(MANAGEMENT_CARD_SIZE_PT / 5, 6);
  });

  it("draws sub_660cc's 12 black copies behind the item at 30-degree steps", () => {
    const scaled = scaledLayer(buildManagementItemBadge(soulStoneTexture()));
    expect(scaled.children).toHaveLength(13);
    const outlines = scaled.children.slice(0, 12) as Sprite[];
    expect(outlines.every((sprite) => sprite.tint === 0x000000)).toBe(true);
    expect((scaled.children[12] as Sprite).tint).toBe(0xffffff);
    for (const [index, outline] of outlines.entries()) {
      const radians = index * 30 * Math.PI / 180;
      expect(Math.atan2(outline.position.y, outline.position.x)).toBeCloseTo(
        Math.atan2(Math.sin(radians), Math.cos(radians)),
        6,
      );
    }
  });

  it("keeps the 2.0 borderWidth in the item's own space, so the fit scales the halo too", () => {


    const badge = buildManagementItemBadge(soulStoneTexture());
    const scaled = scaledLayer(badge);
    const first = scaled.children[0] as Sprite;
    expect(Math.hypot(first.position.x, first.position.y)).toBeCloseTo(2, 6);
    expect(Math.hypot(first.position.x, first.position.y) * scaled.scale.x).toBeCloseTo(
      2 * ((MANAGEMENT_CARD_SIZE_PT / 5) / 70.5),
      6,
    );
  });
});
