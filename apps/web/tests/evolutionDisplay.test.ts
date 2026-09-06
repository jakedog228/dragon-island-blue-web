import { Container, Rectangle, Texture, type Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { EvolutionOverlay, type EvolutionAssets } from "../src/battle/evolutionDisplay.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});
vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));

class OverlayTicker {
  deltaMS = 16;
  readonly listeners = new Set<() => void>();
  add(listener: () => void): void { this.listeners.add(listener); }
  remove(listener: () => void): void { this.listeners.delete(listener); }
}

function assets(): EvolutionAssets {
  return {
    banner: Texture.EMPTY,
    star: Texture.EMPTY,
    monsters: new Map([
      ["Old", Texture.EMPTY],
      ["New", Texture.EMPTY],
    ]),
  };
}

function overlayFixture(): { overlay: EvolutionOverlay; ticker: OverlayTicker } {
  const ticker = new OverlayTicker();
  const overlay = new EvolutionOverlay(ticker as unknown as Ticker);
  overlay.setAssets(assets());
  return { overlay, ticker };
}

describe("EvolutionOverlay source lifecycle", () => {
  it("owns a full-screen static hit area that swallows the locked evolution touch", () => {
    const { overlay } = overlayFixture();
    expect(overlay.eventMode).toBe("static");
    expect(overlay.hitArea).toBeInstanceOf(Rectangle);
    expect(overlay.hitArea).toMatchObject({ x: 0, y: 0, width: 480, height: 320 });
    let stopped = 0;
    overlay.emit("pointertap", { stopPropagation: () => { stopped++; } } as never);
    expect(stopped).toBe(1);
    overlay.destroy({ children: true });
  });

  it("composes RendererFactory scale into the old and evolved flip nodes", () => {
    const { overlay } = overlayFixture();
    overlay.showShake("Old", 0.6);
    const oldSprite = overlay.children[0]!;
    expect(oldSprite.scale.x).toBeCloseTo(0.3); // pointSprite 0.5 × rendererData.scale 0.6
    expect(oldSprite.scale.y).toBeCloseTo(0.3);

    overlay.showReveal({
      shortType: "New",
      displayName: "NEW",
      oldStars: 1,
      newStars: 2,
      rendererScale: 0.8,
    });
    const reveal = overlay.children[0] as Container;
    const monsterNode = reveal.children[0] as Container;
    expect(monsterNode.scale.x).toBeCloseTo(0.8);
    expect(monsterNode.scale.y).toBeCloseTo(0.8);
    overlay.destroy({ children: true });
  });

  it("places the 12-sample outlined name above the sprite at the source center", () => {
    const { overlay } = overlayFixture();
    overlay.showReveal({ shortType: "New", displayName: "NEW", oldStars: 1, newStars: 2 });
    const reveal = overlay.children[0] as Container;
    const monsterNode = reveal.children[0] as Container;
    const label = reveal.children[1] as Container;
    const spriteHeight = (monsterNode.children[0] as Container).height;
    expect(label.position.x).toBe(240);
    expect(label.position.y).toBeCloseTo(160 - spriteHeight / 2 - 10);
    expect(label.children).toHaveLength(2); // cached outline texture + original label
    const outlined = label.children[0] as Container;
    expect(outlined.children).toHaveLength(13); // 12 black samples + rendered center
    expect(outlined.isCachedAsTexture).toBe(true);
    overlay.destroy({ children: true });
  });

  it("detaches tag and banner ticker actions when source cleanup removes their nodes", () => {
    const { overlay, ticker } = overlayFixture();
    overlay.showShake("Old");
    expect(ticker.listeners.size).toBe(1);
    overlay.removeShake();
    expect(ticker.listeners.size).toBe(0);

    overlay.showBanner();
    expect(ticker.listeners.size).toBe(1);
    overlay.clearBanner();
    expect(ticker.listeners.size).toBe(0);
    overlay.destroy({ children: true });
  });
});
