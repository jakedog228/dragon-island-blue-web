import { describe, expect, it } from "vitest";
import { resolveAppViewportSize } from "../src/platform/gameViewport.js";

describe("mobile app viewport sizing", () => {
  it("uses settled window geometry for an installed app when VisualViewport is stale", () => {
    expect(resolveAppViewportSize({
      standalone: true,
      innerWidth: 844,
      innerHeight: 390,
      visualWidth: 390,
      visualHeight: 844,
      documentWidth: 390,
      documentHeight: 844,
    })).toEqual({ width: 844, height: 390, source: "window" });
  });

  it("uses the actually visible area in a normal browser tab", () => {
    expect(resolveAppViewportSize({
      standalone: false,
      innerWidth: 844,
      innerHeight: 390,
      visualWidth: 844,
      visualHeight: 338,
      documentWidth: 844,
      documentHeight: 390,
    })).toEqual({ width: 844, height: 338, source: "visual-viewport" });
  });

  it("falls through invalid API measurements as coherent width/height pairs", () => {
    expect(resolveAppViewportSize({
      standalone: true,
      innerWidth: 0,
      innerHeight: 390,
      visualWidth: Number.NaN,
      visualHeight: 338,
      documentWidth: 800,
      documentHeight: 600,
    })).toEqual({ width: 800, height: 600, source: "document" });
    expect(() => resolveAppViewportSize({
      standalone: false,
      innerWidth: 0,
      innerHeight: 0,
      documentWidth: 0,
      documentHeight: 0,
    })).toThrow(/No positive browser viewport dimensions/);
  });
});
