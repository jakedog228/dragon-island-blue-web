import { describe, expect, it } from "vitest";
import { touchHleArc4Random } from "../src/rng.js";

describe("TouchHLE arc4random fidelity stream", () => {
  it("matches the maintained emulator's xorshift32 sequence from its zero/default state", () => {
    const rng = touchHleArc4Random();
    const raw = Array.from({ length: 5 }, () => Math.round(rng.next() * 4294967296));
    expect(raw).toEqual([270369, 67634689, 2647435461, 307599695, 2398689233]);
    expect(rng.cursor).toBe(5);
    expect(rng.rawState).toBe(2398689233);
  });

  it("uses the native raw-integer modulo channel instead of float scaling", () => {
    const modulo = touchHleArc4Random();
    const normalized = touchHleArc4Random();
    expect(modulo.intBelow(10)).toBe(9); // 270369 % 10
    expect(Math.floor(normalized.next() * 10)).toBe(0);
  });

  it("forks exact state and supports a known native draw offset", () => {
    const skipped = touchHleArc4Random(0, 2);
    const direct = touchHleArc4Random();
    direct.next();
    direct.next();
    expect(skipped.next()).toBe(direct.next());
    const fork = skipped.fork();
    expect(fork.next()).toBe(skipped.next());
  });

  it("rejects invalid states and offsets", () => {
    expect(() => touchHleArc4Random(-1)).toThrow(/uint32/);
    expect(() => touchHleArc4Random(0, -1)).toThrow(/nonnegative/);
  });
});
