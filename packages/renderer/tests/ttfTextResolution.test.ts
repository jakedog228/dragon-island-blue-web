import { afterEach, describe, expect, it } from "vitest";
import {
  configureTtfTextResolution,
  currentTtfBakeResolution,
  setTtfTextPresentationScale,
  ttfBakeResolution,
  ttfTextPresentationScale,
  ttfTextResolutionMode,
} from "../src/ttfTextResolution.js";

afterEach(() => {
  // Restore process defaults so other suites (and parallel files) see "original" / scale 1.
  configureTtfTextResolution("original");
  setTtfTextPresentationScale(1);
});

describe("ttfBakeResolution", () => {
  it("original mode always returns null (Pixi auto-resolution)", () => {
    expect(ttfBakeResolution("original", 1, 1)).toBeNull();
    expect(ttfBakeResolution("original", 2, 3)).toBeNull();
    expect(ttfBakeResolution("original", 3, 0.5)).toBeNull();
  });

  it("modern multiplies dpr by letterbox scale when letterbox >= 1", () => {
    expect(ttfBakeResolution("modern", 2, 1)).toBe(2);
    expect(ttfBakeResolution("modern", 2, 1.5)).toBe(3);
    expect(ttfBakeResolution("modern", 1, 2.5)).toBe(2.5);
  });

  it("modern floors letterbox scale at 1 so tiny windows match auto density", () => {
    expect(ttfBakeResolution("modern", 2, 0.5)).toBe(2);
    expect(ttfBakeResolution("modern", 1, 0.25)).toBe(1);
  });

  it("modern treats non-positive dpr/scale as 1", () => {
    expect(ttfBakeResolution("modern", 0, 2)).toBe(2);
    expect(ttfBakeResolution("modern", Number.NaN, 2)).toBe(2);
    expect(ttfBakeResolution("modern", 2, 0)).toBe(2);
    expect(ttfBakeResolution("modern", 2, Number.NaN)).toBe(2);
  });
});

describe("configureTtfTextResolution / presentation scale", () => {
  it("defaults to original at scale 1", () => {
    expect(ttfTextResolutionMode()).toBe("original");
    expect(ttfTextPresentationScale()).toBe(1);
    expect(currentTtfBakeResolution()).toBeNull();
  });

  it("modern current bake tracks configured mode and presentation scale", () => {
    configureTtfTextResolution("modern");
    setTtfTextPresentationScale(2);
    const dpr =
      typeof globalThis.devicePixelRatio === "number" && globalThis.devicePixelRatio > 0
        ? globalThis.devicePixelRatio
        : 1;
    expect(currentTtfBakeResolution()).toBe(dpr * 2);
  });

  it("rejects unknown modes and non-positive presentation scales", () => {
    expect(() => configureTtfTextResolution("fancy" as "modern")).toThrow(/unsupported mode/);
    expect(() => setTtfTextPresentationScale(0)).toThrow(/positive finite/);
    expect(() => setTtfTextPresentationScale(-1)).toThrow(/positive finite/);
  });
});
