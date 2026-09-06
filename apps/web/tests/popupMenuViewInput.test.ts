import { Container, Rectangle } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

vi.mock("@dib/renderer", async () => {
  const { Container: MockContainer } = await import("pixi.js");
  return {
    makeTtfLabel: (value: string, fontSize: number) => {
      const label = new MockContainer() as Container & {
        anchor: { set(x: number, y?: number): void };
        text: string;
        tint: number;
      };
      Object.defineProperties(label, {
        width: { configurable: true, get: () => value.length * 10 },
        height: { configurable: true, get: () => fontSize },
      });
      label.anchor = { set: () => undefined };
      label.text = value;
      label.tint = 0xffffff;
      return label;
    },
  };
});

vi.mock("../src/ui/menuButton2.js", async () => {
  const { Container: MockContainer } = await import("pixi.js");
  return {
    prepareMenuButton2: async (options: {
      readonly label: Container;
      readonly layoutContentSize: { readonly w: number; readonly h: number };
    }) => {
      const node = new MockContainer();
      node.addChild(options.label);
      return {
        node,
        label: options.label,
        layoutContentSize: options.layoutContentSize,
        visibleRect: { x: 0, y: 0, ...options.layoutContentSize },
        hitRect: { x: 0, y: 0, ...options.layoutContentSize },
      };
    },
  };
});

import { buildPopupMenuView } from "../src/ui/popupMenuView.js";

const goalKeys = [
  "UsualSuspects",
  "RecipeForDestruction",
  "Eggxactly",
  "Collector",
] as const;
const layouts = goalKeys.map((_key, row) => ({
  column: 0,
  row,
  label: { x: 100, y: 50 + row * 40, w: 180, h: 20 },
  background: { x: 91, y: 44 + row * 40, w: 198, h: 32 },
}));

async function build(parent: Container) {
  return buildPopupMenuView({
    parent,
    assets: {} as never,
    scale9: {} as never,
    columns: [goalKeys.map((value) => ({ value, label: value, enabled: true }))],
    itemStyle: () => ({ fontSize: 20, fill: 0xffffff, outlineWidth: 0 }),
    backgroundMarginX: 9,
    backgroundMarginY: 6,
    geometry: () => ({
      title: null,
      content: { x: 91, y: 44, w: 198, h: 152 },
      buttons: [layouts],
    }),
  });
}

describe("PopupMenu parent-owned input", () => {
  it("makes an otherwise-passive nested content parent own the finalized row targets", async () => {
    const parent = new Container();
    const view = await build(parent);
    const selected = goalKeys.map(() => vi.fn());
    view.buttons.forEach((button, index) => button.onPress?.(selected[index]!));

    expect(parent.eventMode).toBe("static");
    for (const [index, layout] of layouts.entries()) {
      const point = {
        x: layout.label.x + layout.label.w / 2,
        y: layout.label.y + layout.label.h / 2,
      };
      expect(parent.hitArea?.contains(point.x, point.y)).toBe(true);
      const event = { getLocalPosition: () => point, stopPropagation: vi.fn() };
      parent.emit("pointertap", event as never);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
      expect(selected[index]).toHaveBeenCalledTimes(1);
      for (const [otherIndex, handler] of selected.entries()) {
        if (otherIndex !== index) expect(handler).not.toHaveBeenCalled();
      }
      selected[index]!.mockClear();
    }
    const plateEdge = { x: layouts[0]!.background.x + 0.01, y: layouts[0]!.background.y + 0.01 };
    expect(plateEdge.x).toBeLessThan(layouts[0]!.label.x);
    expect(plateEdge.y).toBeLessThan(layouts[0]!.label.y);
    expect(parent.hitArea?.contains(plateEdge.x, plateEdge.y)).toBe(true);
    const event = { getLocalPosition: () => plateEdge, stopPropagation: vi.fn() };
    parent.emit("pointertap", event as never);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(selected[0]).toHaveBeenCalledTimes(1);
    expect(parent.hitArea?.contains(20, 20)).toBe(false);
  });

  it("preserves a caller-owned full-screen modal hit area", async () => {
    const parent = new Container();
    const modalHitArea = new Rectangle(0, 0, 480, 320);
    parent.hitArea = modalHitArea;

    await build(parent);

    expect(parent.eventMode).toBe("static");
    expect(parent.hitArea).toBe(modalHitArea);
  });
});
