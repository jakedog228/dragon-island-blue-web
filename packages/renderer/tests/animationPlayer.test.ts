import { describe, it, expect } from "vitest";
import { resolveAnimation, animationDurationMs, type AnimationsData } from "../src/animations.js";

const anims: AnimationsData = {
  Air: {
    "2": { fps: 45, numFrames: 35, spriteframeFormat: "Turbulance%d.png", startFrame: 0, spritesheets: ["Turbulance"] },
    "4": { fps: 28, numFrames: 25, spriteframeFormat: "SonicBlast%d.png", startFrame: 0, spritesheets: ["SonicBlast"] },
  },
};

describe("resolveAnimation", () => {
  it("exact tier", () => {
    const r = resolveAnimation(anims, "Air", 4);
    expect(r.tierKey).toBe("4");
    expect(r.entry.spriteframeFormat).toBe("SonicBlast%d.png");
  });
  it("falls back to the highest tier below the request", () => {
    expect(resolveAnimation(anims, "Air", 3).tierKey).toBe("2");
  });
  it("unknown animation name throws with the name", () => {
    expect(() => resolveAnimation(anims, "Nope", 4)).toThrow(/Nope/);
  });
});

describe("animationDurationMs", () => {
  it("numFrames/fps in ms", () => {
    expect(animationDurationMs(anims["Air"]!["4"]!)).toBeCloseTo((25 / 28) * 1000, 3);
  });
});
