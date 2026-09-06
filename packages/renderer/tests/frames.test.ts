import { describe, it, expect } from "vitest";
import { expandFrameNames, pickTier } from "../src/frames.js";

describe("expandFrameNames", () => {
  it("expands Turbulance%d.png from 0 for 3 frames", () => {
    expect(expandFrameNames("Turbulance%d.png", 0, 3)).toEqual([
      "Turbulance0.png",
      "Turbulance1.png",
      "Turbulance2.png",
    ]);
  });
  it("respects a nonzero startFrame", () => {
    expect(expandFrameNames("F%d.png", 5, 2)).toEqual(["F5.png", "F6.png"]);
  });
  it("throws on a format without %d", () => {
    expect(() => expandFrameNames("Fire.png", 0, 1)).toThrow(/%d/);
  });
  it("throws on numFrames < 1", () => {
    expect(() => expandFrameNames("F%d.png", 0, 0)).toThrow(/numFrames/);
  });
});

describe("pickTier (spec: highest authored <= requested, else lowest authored)", () => {
  it("exact match wins", () => {
    expect(pickTier(["2", "3", "4", "5"], 4)).toBe("4");
  });
  it("falls back to highest tier below the request", () => {
    expect(pickTier(["1", "4"], 3)).toBe("1");
  });
  it("request below all tiers takes the lowest", () => {
    expect(pickTier(["2", "4"], 1)).toBe("2");
  });
  it("throws on an empty tier list", () => {
    expect(() => pickTier([], 4)).toThrow(/tier/);
  });
  it("throws on a non-numeric tier key (fail loud, never silently drop)", () => {
    expect(() => pickTier(["2", "high"], 4)).toThrow(/non-numeric/);
  });
});
