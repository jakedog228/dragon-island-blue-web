import { describe, it, expect } from "vitest";
import type { Element } from "@dib/gamedata";
import { ELEMENT_ORDER, weaknessOf, weaknessFactor, elementMultiplier } from "../src/elements.js";

describe("ELEMENT_ORDER", () => {
  it("matches the binary's enum order (sub_88020)", () => {
    expect(ELEMENT_ORDER).toEqual(["Life", "Death", "Water", "Fire", "Earth", "Air", "Arcane"]);
  });
});

describe("weaknessOf", () => {
  it("matches the weakness cycle from sub_88158", () => {
    expect(weaknessOf("Life")).toBe("Water");
    expect(weaknessOf("Death")).toBe("Life");
    expect(weaknessOf("Water")).toBe("Air");
    expect(weaknessOf("Fire")).toBe("Water");
    expect(weaknessOf("Earth")).toBe("Fire");
    expect(weaknessOf("Air")).toBe("Earth");
    expect(weaknessOf("Arcane")).toBe("Arcane");
  });
});

describe("weaknessFactor", () => {
  it("is 3.5 for Death and 1.5 for everything else (sub_8819c)", () => {
    expect(weaknessFactor("Death")).toBe(3.5);
    for (const e of ["Life", "Water", "Fire", "Earth", "Air", "Arcane"] as Element[]) {
      expect(weaknessFactor(e)).toBe(1.5);
    }
  });
});

describe("elementMultiplier", () => {


  const THIRD = 1 / 1.5; // 0.6666...
  const matrix: Record<Element, Record<Element, number>> = {
    Life: { Life: 1, Death: 3.5, Water: THIRD, Fire: 1, Earth: 1, Air: 1, Arcane: 1 },
    Death: { Life: THIRD, Death: 1, Water: 1, Fire: 1, Earth: 1, Air: 1, Arcane: 1 },
    Water: { Life: 1.5, Death: 1, Water: 1, Fire: 1.5, Earth: 1, Air: THIRD, Arcane: 1 },
    Fire: { Life: 1, Death: 1, Water: THIRD, Fire: 1, Earth: 1.5, Air: 1, Arcane: 1 },
    Earth: { Life: 1, Death: 1, Water: 1, Fire: THIRD, Earth: 1, Air: 1.5, Arcane: 1 },
    Air: { Life: 1, Death: 1, Water: 1.5, Fire: 1, Earth: THIRD, Air: 1, Arcane: 1 },
    Arcane: { Life: 1, Death: 1, Water: 1, Fire: 1, Earth: 1, Air: 1, Arcane: 1.5 },
  };

  for (const attacker of ELEMENT_ORDER) {
    for (const defender of ELEMENT_ORDER) {
      it(`${attacker} -> ${defender} = ${matrix[attacker][defender]}`, () => {
        expect(elementMultiplier(attacker, defender)).toBeCloseTo(matrix[attacker][defender], 10);
      });
    }
  }

  it("uses the Death-specific 3.5 factor only when Death is the defender's weakness target", () => {
    // Life is weak to Water, but Death's weakness factor (3.5) only applies when Death is
    // the *defender* being hit by its own weakness element (Life).
    expect(elementMultiplier("Life", "Death")).toBeCloseTo(3.5, 10);
    expect(elementMultiplier("Water", "Life")).toBeCloseTo(1.5, 10); // not 3.5 - Death not involved
  });
});
