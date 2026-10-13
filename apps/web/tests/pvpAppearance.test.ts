import { describe, expect, it, vi } from "vitest";
import { AssetLibrary } from "@dib/renderer";
import { pvpCssSlices, pvpViewportUnit } from "../src/pvp/pvpAppearance.js";

vi.hoisted(() => Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest" } }));

describe("PvP shared artwork", () => {
  it.each([
    ["iphone", "min(0.20833333333333334vw, 0.3125dvh)"],
    ["ipad", "min(0.1953125vw, 0.2604166666666667dvh)"],
  ] as const)("matches the %s game window scale", (mode, css) => {
    expect(pvpViewportUnit(mode)).toBe(css);
  });
  it("converts asymmetric bottom-left point cuts to CSS top/right/bottom/left pixels", () => {
    expect(pvpCssSlices({ x: 3, y: 5, w: 20, h: 11 }, 60, 50)).toEqual([18, 14, 10, 6]);
  });
  it("resolves DOM artwork through the same local manifest and rejects missing roles", () => {
    const assets = AssetLibrary.fromManifest({ sprites: { button: "own-button.png" }, atlases: {}, fonts: {}, audio: {}, particles: {} }, file => `blob:local/${file}`);
    expect(assets.spriteUrl("button")).toBe("blob:local/own-button.png");
    expect(() => assets.spriteUrl("absent")).toThrow("unknown sprite: absent");
  });
});
