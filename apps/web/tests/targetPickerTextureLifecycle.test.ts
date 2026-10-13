import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest", platform: "Win32" } });
});
import { Container, Sprite, Texture, type Renderer, type RenderTexture, type Ticker } from "pixi.js";
import { TargetPicker, type TargetPickerOpts } from "../src/battle/targetPicker.js";

function fixture(fail = false) {
  const ids = new Set<number>();
  const captures: { container: Container; target: RenderTexture }[] = [];
  const render = (options: { container: Container; target: RenderTexture }) => {
    // AbstractRenderer.render enables a render group even for a temporary Sprite target.
    options.container.enableRenderGroup();
    ids.add(options.container.renderGroup!.instructionSet.uid);
    captures.push(options);
    if (fail) throw new Error("render failed");
  };
  const picker = new TargetPicker({
    assets: {} as TargetPickerOpts["assets"], scale9: {} as TargetPickerOpts["scale9"], strings: {},
    ticker: { add: vi.fn(), remove: vi.fn() } as unknown as Ticker,
    renderer: { render } as unknown as Renderer,
  });
  const parent = new Container();
  const target = new Sprite(Texture.WHITE); parent.addChild(target);
  const highlight = () => Reflect.get(picker, "addHighlight").call(picker, "test", target, 0xff0000, "enemy");
  const clear = () => Reflect.get(picker, "clearHighlights").call(picker);
  return { picker, parent, target, ids, captures, highlight, clear };
}

describe("TargetPicker temporary render targets", () => {
  it("reuses render-buffer identities across repeated target highlights", () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) { f.highlight(); f.clear(); }
    expect(f.captures).toHaveLength(20 * 12);
    expect(f.ids.size).toBe(1);
    expect(f.captures.every(c => c.container.destroyed && c.container.renderGroup === null && c.target.destroyed)).toBe(true);
    expect(f.target.destroyed).toBe(false);
    expect(Texture.WHITE.destroyed).toBe(false);
    f.picker.destroy({ children: true }); f.parent.destroy({ children: true });
  });

  it("releases the temporary scene and output texture when rendering throws", () => {
    const f = fixture(true);
    expect(f.highlight).toThrow("render failed");
    expect(f.captures[0]!.container.destroyed).toBe(true);
    expect(f.captures[0]!.container.renderGroup).toBeNull();
    expect(f.captures[0]!.target.destroyed).toBe(true);
    expect(Texture.WHITE.destroyed).toBe(false);
    f.picker.destroy({ children: true }); f.parent.destroy({ children: true });
  });
});
