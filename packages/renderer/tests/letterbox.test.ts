import { describe, it, expect } from "vitest";
import { computeFit } from "../src/letterbox.js";

describe("computeFit (960x640 stage)", () => {
  it("wide viewport pillarboxes horizontally", () => {
    const fit = computeFit(1920, 640, 960, 640);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(480);
    expect(fit.offsetY).toBe(0);
  });
  it("tall viewport letterboxes vertically", () => {
    const fit = computeFit(960, 1280, 960, 640);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(320);
  });
  it("scales down to fit a small viewport", () => {
    const fit = computeFit(480, 320, 960, 640);
    expect(fit.scale).toBe(0.5);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(0);
  });
  it("throws on a nonpositive viewport", () => {
    expect(() => computeFit(0, 100, 960, 640)).toThrow(/viewport/);
  });
});
