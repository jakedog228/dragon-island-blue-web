import type { StatName } from "@dib/gamedata";
import { createStatOnlyBuff, statOnlyBonus, type StatOnlyBuffSpec } from "./buff.js";

const f = Math.fround;

/**
 * Semantic form of the native AbilityResult `message`/`messageColor` parameters. Keeping the
 * localized text out of the pure engine lets the web tier use the shipped string table while
 * still preserving the exact producer-side amount and direction.
 */
export type AbilityEffectText =
  | { kind: "stat"; stat: StatName; direction: "up" | "down"; amount: number }
  | { kind: "haste"; direction: "up" | "down"; amount: number }
  | { kind: "miss" };


export function statEffectText(spec: StatOnlyBuffSpec, stat: StatName): AbilityEffectText {
  const amount = statOnlyBonus(createStatOnlyBuff(spec), stat);
  return {
    kind: "stat",
    stat,
    direction: amount >= 0 ? "up" : "down",
    amount: Math.abs(Math.trunc(amount)),
  };
}


export function hasteEffectText(haste: number): AbilityEffectText {
  const h = f(haste);
  const adjusted = h < 0 ? f(f(100) / f(f(1) - h)) : f(f(100) * f(f(1) + h));
  const delta = f(adjusted - f(100));
  return {
    kind: "haste",
    direction: delta < 0 ? "up" : "down",
    amount: Math.trunc(Math.abs(delta)),
  };
}
