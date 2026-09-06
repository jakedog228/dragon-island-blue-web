import { describe, expect, it } from "vitest";
import { secureUnitRandom } from "../src/secureRandom.js";

describe("secureUnitRandom", () => {
  it("returns non-repeating unit-interval draws from the operating-system CSPRNG", () => {
    const draws = Array.from({ length: 256 }, secureUnitRandom);
    expect(draws.every((draw) => draw >= 0 && draw < 1)).toBe(true);
    expect(new Set(draws).size).toBe(draws.length);
  });
});
