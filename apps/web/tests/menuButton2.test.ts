import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

vi.mock("@dib/renderer", () => ({
  Scale9: {
    fromConfig: vi.fn(async (
      _scale9: unknown,
      name: string,
      _assets: unknown,
      contentSize: { w: number; h: number },
    ) => {
      expect(name).toBe("MenuButton2");
      const background = new Container() as Container & {
        contentWidth: number;
        contentHeight: number;
      };
      background.contentWidth = contentSize.w + 18;
      background.contentHeight = contentSize.h + 12;
      return background;
    }),
  },
}));

import { prepareMenuButton2 } from "../src/ui/menuButton2.js";

describe("prepareMenuButton2", () => {
  it("registers the complete brown Scale9 plate while retaining label-sized layout", async () => {
    const label = new Container();
    const prepared = await prepareMenuButton2({
      assets: {} as never,
      scale9: {} as never,
      label: label as never,
      layoutContentSize: { w: 80, h: 14 },
    });

    expect(prepared.layoutContentSize).toEqual({ w: 80, h: 14 });
    expect(prepared.visibleRect).toEqual({ x: -9, y: -6, w: 98, h: 26 });
    expect(prepared.hitRect).toEqual(prepared.visibleRect);
    expect(prepared.node.hitArea?.contains(-8.99, -5.99)).toBe(true);
    expect(prepared.node.hitArea?.contains(88.99, 19.99)).toBe(true);
    expect(prepared.node.hitArea?.contains(-9.01, 7)).toBe(false);
    expect(prepared.node.hitArea?.contains(89.01, 7)).toBe(false);
  });
});
