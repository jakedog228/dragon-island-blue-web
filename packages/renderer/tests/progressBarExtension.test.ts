import { describe, expect, it, vi } from "vitest";
import { Container, Graphics, NineSliceSprite, Rectangle, Texture, TextureSource } from "pixi.js";
import { ProgressBar } from "../src/progressBar.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest" } });
});

function fixture() {
  // Shipped General-hd frame sizes/offsets; no archive pixels are bundled in this test.
  const source = new TextureSource({ width: 512, height: 512 });
  const backgroundTexture = new Texture({ source, frame: new Rectangle(2, 107, 200, 26) });
  const foregroundTexture = new Texture({ source, frame: new Rectangle(2, 135, 180, 22) });
  const bar = new ProgressBar({ backgroundTexture, foregroundTexture, labelFontFile: null });
  bar.scale.set(.75);
  bar.setRatio(1);
  bar.update(16);
  return { bar, backgroundTexture, foregroundTexture };
}

function parts(bar: ProgressBar) {
  const root = bar.children[0] as Container;
  return { root, foreground: root.children[0] as NineSliceSprite,
    mask: root.children[1] as Graphics, background: root.children[2] as NineSliceSprite };
}

describe.each([410, 432])("extended ProgressBar at %s displayed points", width => {
  it("keeps both end regions, height and fill inset native while extending only the center", () => {
    const { bar, backgroundTexture, foregroundTexture } = fixture();
    bar.setExtendedWidth(width / .75);
    const { foreground, background } = parts(bar);
    expect(background.texture).toBe(backgroundTexture);
    expect(foreground.texture).toBe(foregroundTexture);
    expect(background.leftWidth).toBe(99);
    expect(background.rightWidth).toBe(99);
    expect(foreground.leftWidth).toBe(89);
    expect(foreground.rightWidth).toBe(89);
    expect(background.scale.x).toBe(.5);
    expect(background.scale.y).toBe(.5);
    expect(bar.getBounds().width).toBeCloseTo(width);
    expect(bar.getBounds().height).toBeCloseTo(9.75);
    expect(foreground.x * bar.scale.x).toBe(3.75);
    expect(foreground.y * bar.scale.y).toBe(.75);
    bar.destroy({ children: true });
    expect(backgroundTexture.destroyed).toBe(false);
    expect(foregroundTexture.destroyed).toBe(false);
  });

  it("clips exact HP fractions, including one-HP differences, without stretching caps as HP changes", () => {
    const { bar } = fixture();
    bar.setExtendedWidth(width / .75);
    const { mask, foreground, background } = parts(bar);
    const fullFillWidth = (width - 7.5) / .75;
    const capWidth = foreground.leftWidth;
    bar.setRatio(.5);
    bar.update(16);
    expect(bar.displayedRatio).toBe(.975);
    for (let i = 0; i < 20; i++) bar.update(16);
    expect(mask.getLocalBounds().width).toBeCloseTo(fullFillWidth / 2);
    const half = mask.getLocalBounds().width;
    bar.setRatio(4999 / 10000);
    bar.update(16);
    expect(half - mask.getLocalBounds().width).toBeCloseTo(fullFillWidth / 10000, 5);
    expect(foreground.leftWidth).toBe(capWidth);
    expect(background.getBounds().width).toBeCloseTo(width);
    bar.setTint(0xff7f00);
    expect(foreground.tint).toBe(0xff7f00);
    bar.setRatio(1 / 10000);
    bar.snapToTarget();
    expect(foreground.visible).toBe(true);
    expect(mask.getLocalBounds().width).toBeCloseTo(fullFillWidth / 10000, 5);
    bar.setRatio(0);
    bar.update(16);
    expect(foreground.visible).toBe(false);
    bar.setRatio(1);
    for (let i = 0; i < 41; i++) bar.update(16);
    expect(bar.displayedRatio).toBe(1);
    expect(mask.getLocalBounds().width).toBeCloseTo(fullFillWidth);
    expect(foreground.visible).toBe(true);
    bar.destroy({ children: true });
  });

  it("resizes while damaged without resetting animation and restores the native widget", () => {
    const { bar } = fixture();
    bar.setExtendedWidth(width / .75);
    const root = parts(bar).root;
    bar.setRatio(.4);
    bar.update(16);
    bar.setExtendedWidth((width + 10) / .75);
    expect(parts(bar).root).toBe(root);
    expect(bar.displayedRatio).toBe(.975);
    expect(bar.ratio).toBe(.4);
    bar.setExtendedWidth(undefined);
    expect(root.destroyed).toBe(true);
    expect(bar.children).toHaveLength(2);
    expect(bar.contentWidth * bar.scale.x).toBe(75);
    bar.update(16);
    expect(bar.displayedRatio).toBeCloseTo(.95);
    bar.destroy({ children: true });
  });
});
