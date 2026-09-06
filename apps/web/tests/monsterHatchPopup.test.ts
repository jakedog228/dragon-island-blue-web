import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { AssetLibrary, Scale9SpritesData } from "@dib/renderer";
import {
  MONSTER_HATCH_OVERLAYS,
  type PopupSfxHooks,
} from "../src/ui/popup.js";
import { monsterHatchPopupOptions } from "../src/ui/monsterHatchPopup.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

describe("shared MonsterHatchPopup constructor policy", () => {
  const parent = new Container();
  const assets = {} as AssetLibrary;
  const scale9 = {} as Scale9SpritesData;
  const ticker = {} as never;
  const content = new Container();
  const owner = {};
  const sfx: PopupSfxHooks = {};

  it("adds the source family overlays and modal defaults without replacing caller content", () => {
    const options = monsterHatchPopupOptions(
      { parent, assets, scale9, ticker, owner, sfx },
      { content, title: "Title" },
    );

    expect(options).toMatchObject({
      assets,
      scale9,
      ticker,
      content,
      title: "Title",
      overlays: MONSTER_HATCH_OVERLAYS,
      dismissOnTap: false,
      owner,
      sfx,
    });
    expect(options.zIndex).toBeUndefined();
  });

  it("preserves source hideOverlays and caller-specific animation/geometry choices", () => {
    const options = monsterHatchPopupOptions(
      { parent, assets, scale9, ticker, zIndex: 90 },
      {
        content,
        hideOverlays: true,
        runScaleAction: false,
        topInset: 10,
      },
    );

    expect(options.overlays).toBeUndefined();
    expect(options.dismissOnTap).toBe(false);
    expect(options.zIndex).toBe(90);
    expect(options.runScaleAction).toBe(false);
    expect(options.topInset).toBe(10);
  });

});
