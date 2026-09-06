


export type CaptureCardLevel = 1 | 2 | 3;
export type CaptureStatus = "available" | "alreadyTried" | "uncapturable";

export type CaptureCardCost =
  | { currency: "silver"; amount: number }
  | { currency: "gold"; amount: number };

export const CAPTURE_CARD_COSTS: Readonly<Record<CaptureCardLevel, CaptureCardCost>> = {
  1: { currency: "silver", amount: 50 },
  2: { currency: "silver", amount: 250 },
  3: { currency: "gold", amount: 100 },
};

const f = Math.fround;

/**
 * Returns the source probability in [0, 1]. `targetHealthPercent` is the native method's
 * fractional input (currentHP/maxHP), despite its name. `targetStarsOutOf20` is the integer
 * encoding used by Monster: two units per full star and one per half star.
 */
export function captureChance(
  cardLevel: CaptureCardLevel,
  myMonsterPartyAverageLevel: number,
  targetLevel: number,
  targetStarsOutOf20: number,
  targetHealthPercent: number,
): number {
  if (!Number.isFinite(myMonsterPartyAverageLevel) || myMonsterPartyAverageLevel <= 0) {
    throw new Error(`captureChance: invalid party level ${myMonsterPartyAverageLevel}`);
  }
  if (!Number.isFinite(targetLevel) || targetLevel <= 0) {
    throw new Error(`captureChance: invalid target level ${targetLevel}`);
  }
  if (!Number.isFinite(targetStarsOutOf20) || targetStarsOutOf20 < 0) {
    throw new Error(`captureChance: invalid target stars ${targetStarsOutOf20}`);
  }
  if (!Number.isFinite(targetHealthPercent)) {
    throw new Error(`captureChance: invalid target health ${targetHealthPercent}`);
  }

  let health = f(f(targetHealthPercent) * f(100));
  if (targetLevel <= 3) health = f(health / f(4 - targetLevel));
  health = Math.max(10, health);

  const cardFactor = cardLevel === 1 ? 5 : cardLevel === 2 ? 8 : 200;
  const displayedStars = f(f(targetStarsOutOf20) * f(0.5));
  const starPenalty = f(Math.pow(displayedStars, 1.4));
  const denominator = Math.max(f(starPenalty / f(cardFactor)), 0.0001);
  let percent = f(f(500 / health) / denominator);

  if (targetLevel <= myMonsterPartyAverageLevel) {
    percent = f(percent * f(Math.sqrt(f(myMonsterPartyAverageLevel / targetLevel))));
  } else {
    percent = f(percent - f(Math.pow(f(targetLevel - myMonsterPartyAverageLevel), 1.85)));
  }
  return Math.max(0, Math.min(1, f(percent / 100)));
}

/** The popup uses roundf(chance*100), not floor/trunc. */
export function captureChancePercent(chance: number): number {
  return Math.round(f(f(chance) * f(100)));
}
