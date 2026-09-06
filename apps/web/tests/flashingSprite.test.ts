import { Container, Sprite, Texture, type Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { SourceFlashingSprite } from "../src/ui/flashingSprite.js";

// Pixi 8 probes `navigator` at module scope; supply it the way the other renderer suites do.
vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

describe("SourceFlashingSprite", () => {
  it("keeps the ordinary sprite visible and drives only two additive redraw copies", () => {
    const parent = new Container();
    parent.sortableChildren = true;
    const before = new Sprite(Texture.EMPTY);
    before.label = "before";
    before.zIndex = 4;
    const source = new Sprite(Texture.EMPTY);
    source.label = "source";
    source.alpha = 0.75;
    source.tint = 0xabcdef;
    source.zIndex = 4;
    const after = new Sprite(Texture.EMPTY);
    after.label = "after";
    after.zIndex = 4;
    parent.addChild(before, source, after);

    const flash = new SourceFlashingSprite(parent, source);
    flash.setFlashOpacity(127 / 255);
    parent.sortChildren();

    expect(source.alpha).toBe(0.75);
    const copies = parent.children.filter((child) => child !== before && child !== source && child !== after) as Sprite[];
    expect(copies).toHaveLength(2);
    expect(parent.children).toEqual([before, source, ...copies, after]);
    for (const copy of copies) {
      expect(copy.texture).toBe(source.texture);
      expect(copy.alpha).toBe(127 / 255);
      expect(copy.tint).toBe(0xabcdef);
      expect(copy.zIndex).toBe(4);
      expect(copy.blendMode).toBe("add-npm");
      expect(copy.eventMode).toBe("none");
    }

    flash.destroy();
    flash.destroy();
    expect(parent.children).toEqual([before, source, after]);
  });

  it("preserves the existing ticker-driven FlashForeverAction mode", () => {
    const callbacks = new Set<() => void>();
    const ticker = {
      deltaMS: 250,
      add(callback: () => void) { callbacks.add(callback); },
      remove(callback: () => void) { callbacks.delete(callback); },
    } as unknown as Ticker;
    const parent = new Container();
    const source = new Sprite(Texture.EMPTY);
    parent.addChild(source);
    const flash = new SourceFlashingSprite(parent, source, ticker, 1_000);

    flash.start();
    expect(callbacks.size).toBe(1);
    for (const callback of callbacks) callback();
    expect(flash.debugState).toEqual({
      running: true,
      elapsedMs: 250,
      opacity: Math.trunc(127.5) / 255,
      strength: 2,
    });

    flash.stop();
    expect(callbacks.size).toBe(0);
    expect(flash.debugState.opacity).toBe(0);
    flash.destroy();
  });

  it("rolls back a partially inserted overlay when construction fails", () => {
    const parent = new Container();
    const source = new Sprite(Texture.EMPTY);
    parent.addChild(source);
    const addChildAt = parent.addChildAt.bind(parent);
    let insertions = 0;
    parent.addChildAt = ((...args: Parameters<Container["addChildAt"]>) => {
      insertions += 1;
      if (insertions === 2) throw new Error("forced second insertion failure");
      return addChildAt(...args);
    }) as Container["addChildAt"];

    expect(() => new SourceFlashingSprite(parent, source)).toThrow(/forced second insertion/);
    expect(parent.children).toEqual([source]);
  });

  it("cleans up safely after a parent redraw already destroyed the copies", () => {
    const parent = new Container();
    const source = new Sprite(Texture.EMPTY);
    parent.addChild(source);
    const flash = new SourceFlashingSprite(parent, source);

    parent.destroy({ children: true });
    expect(() => flash.destroy()).not.toThrow();
  });

  it("does not let a manually driven overlay start the forever action", () => {
    const parent = new Container();
    const source = new Sprite(Texture.EMPTY);
    parent.addChild(source);
    const flash = new SourceFlashingSprite(parent, source);

    expect(() => flash.start()).toThrow(/manually driven/);
    expect(() => flash.setFlashOpacity(-0.01)).toThrow(/between 0 and 1/);
    expect(() => flash.setFlashOpacity(1.01)).toThrow(/between 0 and 1/);
    flash.destroy();
  });
});
