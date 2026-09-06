


import type { Element } from "@dib/gamedata";


export const ELEMENT_ORDER: readonly Element[] = [
  "Life",
  "Death",
  "Water",
  "Fire",
  "Earth",
  "Air",
  "Arcane",
];


const WEAKNESS_CYCLE: Record<Element, Element> = {
  Life: "Water",
  Death: "Life",
  Water: "Air",
  Fire: "Water",
  Earth: "Fire",
  Air: "Earth",
  Arcane: "Arcane",
};


export function weaknessOf(e: Element): Element {
  return WEAKNESS_CYCLE[e];
}


export function weaknessFactor(e: Element): number {
  return e === "Death" ? 3.5 : 1.5;
}


export function elementMultiplier(attacker: Element, defender: Element): number {
  if (weaknessOf(defender) === attacker) {
    // Defender is weak to the incoming (attacker's) element.
    return weaknessFactor(defender);
  }
  if (weaknessOf(attacker) === defender) {
    // Attacker's element is weak against the defender -> resisted.
    return 1 / weaknessFactor(defender);
  }
  return 1.0;
}
