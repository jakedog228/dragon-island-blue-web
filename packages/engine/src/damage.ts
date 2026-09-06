


import type { Element, StatName } from "@dib/gamedata";
import type { Rng } from "./rng.js";
import { weaknessFactor, weaknessOf } from "./elements.js";
import { applyMod } from "./fmath.js";

const f = Math.fround;


const C_MT = 0.84;

const C_AL = 0.01;

const AL_EXPONENT = 0.86;

const C_MIT_SCALE = 0.35;
const C_MIT_CAP = 0.9;

export function activationLengthScale(activationLength: number): number {
  return f(Math.pow(f(activationLength * C_AL), AL_EXPONENT));
}

export function divideForTargets(value: number, numTargets: number): number {
  return numTargets >= 2 ? f(f(value) / f(f(numTargets) * f(C_MT))) : f(value);
}

export interface RollParams {
  /** ability.abilityScalor, default 1.0. */
  abilityScalor: number;
  /** Attacker's effective stat for the roll's relatedStat (integer, from baseStat). Callers
   *  pass 0 when relatedStat is "none" (DiceRoller stat enum 6), per the binary. */
  stat: number;
  /** Raw numeric activation length (Task 8 resolves "{N}" -> number; here it's already a number). */
  activationLength: number;
  /** True when the provider is a UsableAbility (gates the activationLength scaling). */
  scaleByActivationLength: boolean;
  /** roll.randomness, default 0.2. */
  randomness: number;
  /** >= 1. */
  numTargets: number;
}


export function rollDamage(p: RollParams, rng: Rng): number {
  let stat = f(p.stat);
  if (p.scaleByActivationLength) {


    stat = f(stat * activationLengthScale(p.activationLength));
  }
  let value = f(f(p.abilityScalor) * stat);
  if (p.numTargets >= 2) {

    value = divideForTargets(value, p.numTargets);
  }
  const base = Math.round(value);

  const u = rng.next();
  const min = f(base * f(1 - f(p.randomness / 2))); // fround each op (matches the roll line below)
  const roll = Math.round(f(min + f(f(u * base) * p.randomness)));

  return roll > 1 ? roll : 1;
}


export function applyMagnification(roll: number, magnification: number): number {
  const m = applyMod(roll, magnification);
  const amt = Math.trunc(m);
  return amt >= 1 ? amt : 0;
}

export interface HitParams {
  /** Post-magnification integer base damage. */
  amount: number;
  damageElement: Element;
  /** "Magic" -> mitigate with Resist; anything else -> Defense. */
  sourceStat: StatName;
  defenderElement: Element;
  /** Defender's effective Defense (from baseStat). */
  defenderDefense: number;
  /** Defender's effective Resist. */
  defenderResist: number;
  defenderCurrentHp: number;
  /** max(attackerLevel, defenderLevel) — resolved by the caller. */
  level: number;
}


export function applyDamage(p: HitParams): number {


  let amount = p.amount;
  if (weaknessOf(p.defenderElement) === p.damageElement) {
    // Defender is weak to the incoming element.
    amount = Math.trunc(f(weaknessFactor(p.defenderElement) * amount));
  } else if (weaknessOf(p.damageElement) === p.defenderElement) {
    // Attacker's element is weak against the defender -> resisted.
    amount = Math.trunc(f(amount / weaknessFactor(p.defenderElement)));
  }


  const def = p.sourceStat === "Magic" ? p.defenderResist : p.defenderDefense;
  const threshold = 9 * p.level + 1;
  let reduction: number;
  if (def >= threshold) {
    reduction = Math.trunc(def / threshold);
  } else {
    // = 2*def/threshold - 1; can be NEGATIVE, which amplifies damage below.
    reduction = f(f(2 * def - threshold) / threshold);
  }
  const mitFrac = Math.min(C_MIT_CAP, f(C_MIT_SCALE * reduction));
  let final = Math.trunc(f(amount - f(mitFrac * amount))); // amount*(1-mitFrac), truncated

  final = Math.min(final, p.defenderCurrentHp); // can't exceed remaining HP
  final = Math.max(final, 0);
  return final;
}
