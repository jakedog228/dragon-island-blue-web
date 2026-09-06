import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng.js";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(1234), b = mulberry32(1234);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBe(8); // not constant
  });

  it("next() stays in [0,1)", () => {
    const r = mulberry32(42);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("intBelow(n) covers [0,n) roughly uniformly", () => {
    const r = mulberry32(7);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60_000; i++) counts[r.intBelow(6)]++;
    for (const c of counts) expect(c).toBeGreaterThan(9_000); // ~10k each
  });

  it("chance(p) approximates p", () => {
    const r = mulberry32(99);
    let hits = 0;
    for (let i = 0; i < 100_000; i++) if (r.chance(0.3)) hits++;
    expect(hits / 100_000).toBeGreaterThan(0.29);
    expect(hits / 100_000).toBeLessThan(0.31);
  });
});
