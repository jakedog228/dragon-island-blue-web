import { Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

vi.mock("../src/ui/popupMenuView.js", () => ({
  buildPopupMenuView: vi.fn(async () => ({
    geometry: {
      content: { x: 0, y: 0, w: 100, h: 50 },
      title: { x: 0, y: 0, w: 80, h: 20 },
      buttons: [[]],
    },
    buttons: [],
  })),
}));

import { SourcePopupMenu } from "../src/startup/sourcePopupMenu.js";
import { sourcePopupDimSpec } from "../src/ui/sourcePopupPresentation.js";

describe("source startup PopupMenu presentation", () => {
  it.each([
    ["iphone", { w: 480, h: 320 }],
    ["ipad", { w: 512, h: 384 }],
  ] as const)("covers the complete %s source display behind popup content", (mode, screen) => {
    expect(sourcePopupDimSpec(mode)).toEqual({
      x: 0,
      y: 0,
      ...screen,
      color: 0x000000,
      targetAlpha: 200 / 255,
      durationMs: 500,
      zIndex: -9_999,
    });
  });

  it("mounts and source-fades the black notification-layer dim behind menu content", async () => {
    const ticker = new Ticker();
    const parent = new (await import("pixi.js")).Container();
    const menu = await SourcePopupMenu.show({
      parent,
      assets: {} as never,
      scale9: {} as never,
      ticker,
      title: "Pick Save Slot",
      columns: [[{ id: "slot-1", label: "New Game", value: "slot-1" }]],
      overlays: false,
      onInvoke: () => {},
    } as never);

    const dim = menu.children.find((child) => child.label === "sourcePopupDim");
    expect(dim).toBeDefined();
    expect(dim!.zIndex).toBe(-9_999);
    expect(dim!.alpha).toBe(0);

    menu.present();
    ticker.lastTime = 0;
    for (let time = 100; time <= 500; time += 100) ticker.update(time);
    expect(dim!.alpha).toBeCloseTo(200 / 255, 6);

    menu.destroy({ children: true });
    ticker.destroy();
  });

  it("cancels the notification-layer fade when its owning menu is destroyed", async () => {
    const ticker = new Ticker();
    const parent = new (await import("pixi.js")).Container();
    const menu = await SourcePopupMenu.show({
      parent,
      assets: {} as never,
      scale9: {} as never,
      ticker,
      title: "Pick Save Slot",
      columns: [[{ id: "slot-1", label: "New Game", value: "slot-1" }]],
      overlays: false,
      onInvoke: () => {},
    } as never);

    menu.present();
    ticker.lastTime = 0;
    ticker.update(100);
    menu.destroy({ children: true });

    expect(menu.destroyed).toBe(true);
    expect(() => ticker.update(500)).not.toThrow();
    ticker.destroy();
  });
});
