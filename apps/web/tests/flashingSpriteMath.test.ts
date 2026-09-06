import { describe, expect, it } from "vitest";
import { flashActionOpacity, flashForeverOpacity } from "../src/ui/flashingSpriteMath.js";

describe("FlashForeverAction math", () => {
  it("runs the source byte-quantized triangle over the requested speed", () => {
    expect(flashForeverOpacity(0, 1_000)).toBe(0);
    expect(flashForeverOpacity(250, 1_000)).toBe(Math.trunc(127.5) / 255);
    expect(flashForeverOpacity(500, 1_000)).toBe(1);
    expect(flashForeverOpacity(750, 1_000)).toBe(Math.trunc(127.5) / 255);
    expect(flashForeverOpacity(1_000, 1_000)).toBe(0);
  });

  it("wraps elapsed time and rejects invalid action inputs", () => {
    expect(flashForeverOpacity(1_250, 1_000)).toBe(flashForeverOpacity(250, 1_000));
    expect(() => flashForeverOpacity(-1, 1_000)).toThrow(/non-negative/);
    expect(() => flashForeverOpacity(0, 0)).toThrow(/positive/);
  });
});

describe("flashActionOpacity", () => {
  it("repeats the source rising sawtooth without hiding the base sprite", () => {
    expect(flashActionOpacity(0, 2)).toBe(0);
    expect(flashActionOpacity(0.25, 2)).toBe(Math.trunc(127.5) / 255);
    expect(flashActionOpacity(0.5, 2)).toBe(0);
    expect(flashActionOpacity(0.75, 2)).toBe(Math.trunc(127.5) / 255);
    expect(flashActionOpacity(1, 2)).toBe(0);
  });

  it("preserves the native float32 reset at each flash boundary", () => {
    expect(flashActionOpacity(Math.fround(0.5 - 2 ** -25), 2)).toBeGreaterThan(0.99);
    expect(flashActionOpacity(0.5, 2)).toBe(0);
    expect(flashActionOpacity(Math.fround(0.5 + 2 ** -23), 2)).toBe(0);
  });

  it("rejects values outside the CCActionInterval contract", () => {
    expect(() => flashActionOpacity(-0.01, 2)).toThrow(/between 0 and 1/);
    expect(() => flashActionOpacity(1.01, 2)).toThrow(/between 0 and 1/);
    expect(() => flashActionOpacity(0.5, 0)).toThrow(/positive integer/);
    expect(() => flashActionOpacity(0.5, 1.5)).toThrow(/positive integer/);
  });
});
