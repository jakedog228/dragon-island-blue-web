import { describe, expect, it } from "vitest";
import {
  SOURCE_FULLSCREEN_SIZE_PT,
  SOURCE_FULLSCREEN_TEXTURE_RECT_PX,
  sourceFullscreenPosition,
} from "./sourceFullscreenMath.js";

describe("source full-screen helper", () => {
  it("uses the forced POT crop and exact iPhone bleed", () => {
    expect(SOURCE_FULLSCREEN_TEXTURE_RECT_PX).toEqual({ x: 0, y: 0, w: 1024, h: 768 });
    expect(SOURCE_FULLSCREEN_SIZE_PT).toEqual({ w: 512, h: 384 });
    expect(sourceFullscreenPosition("iphone")).toEqual({ x: -16, y: -32 });
  });

  it("normalizes the native iPad surface to an exact fit", () => {
    expect(sourceFullscreenPosition("ipad")).toEqual({ x: 0, y: 0 });
  });
});
