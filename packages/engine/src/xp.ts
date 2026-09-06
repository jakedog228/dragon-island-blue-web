


const f = Math.fround;
const INT32_MAX = 0x7fffffff;
const INT32_MIN = -0x80000000;
const UINT32_MAX = 0xffffffff;

export interface DefeatedMonsterXp {
  level: number;
  /** Full rarity stars plus 0.5 when `Monster.halfStar` is set. */
  stars: number;
  /** `Monster.noReward`; AddMonster/CallMonster creations set this true. */
  noReward?: boolean;
}

function sourceRoundf(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** ARM `vcvt.u32.f64`/`vcvt.U32.F32`: truncate toward zero with saturation. */
function uint32FromFloat(value: number): number {
  if (!Number.isFinite(value) || value >= UINT32_MAX) return UINT32_MAX;
  if (value <= 0) return 0;
  return Math.trunc(value);
}

/** ARM signed float/double-to-int conversion: truncate toward zero with saturation. */
function int32FromFloat(value: number): number {
  if (!Number.isFinite(value) || value >= INT32_MAX) return INT32_MAX;
  if (value <= INT32_MIN) return INT32_MIN;
  return Math.trunc(value);
}


export function monsterXpAward(level: number, stars: number, receiverLevel: number): number {
  const awardLevel = Math.min(Math.trunc(level), Math.trunc(receiverLevel) + 10);
  const powBase = Math.min(awardLevel, 20);


  const starFactor = f(f(1) + f(f(stars) * f(0.05)));
  const firstAward = uint32FromFloat(
    (Math.pow(powBase, 2.5) * 1200 * starFactor + 1000) / 200 + 40,
  );
  let award = firstAward;

  if (awardLevel >= 21) {


    award = uint32FromFloat(
      award * Math.pow(f(1.05), Math.min(awardLevel - 20, 50)),
    );
  }
  if (awardLevel >= 71) {
    const powerBase = uint32FromFloat(award + firstAward * -10.921308826727588);


    const exponent = f(f(f(awardLevel) / f(1800)) + f(1.4));
    award = uint32FromFloat(award + Math.pow(powerBase, exponent));
  }
  return award;
}


export function xpAwardPerParticipant(
  participantLevels: readonly number[],
  defeated: readonly DefeatedMonsterXp[],
  breederXpBonus?: number,
): number {
  if (participantLevels.length === 0) {
    throw new Error("XP award requires at least one participating monster");
  }
  if (breederXpBonus !== undefined && (!Number.isFinite(breederXpBonus) || breederXpBonus < 0)) {
    throw new Error(`breeder XP bonus must be a finite non-negative number; got ${breederXpBonus}`);
  }


  let levelSum = f(0);
  for (const level of participantLevels) levelSum = f(levelSum + f(level));
  const participantCount = f(participantLevels.length);
  const averageLevel = f(levelSum / participantCount);
  const receiverLevel = sourceRoundf(averageLevel);
  let total = 0;

  for (const enemy of defeated) {
    if (enemy.noReward) continue;
    const enemyLevel = f(enemy.level);
    let adjusted = f(monsterXpAward(enemy.level, enemy.stars, receiverLevel));

    if (enemyLevel > f(20) && averageLevel > f(20)) {
      let ratio = f(enemyLevel / averageLevel);
      if (ratio > f(2)) ratio = f(2);
      if (ratio < f(0.1)) ratio = f(0.1);

      if (ratio >= f(1)) {
        adjusted = f(adjusted * ratio);
      } else {
        const difference = f(averageLevel - enemyLevel);
        const exponent = f(f(1) + f(difference * f(0.05)));
        adjusted = f(adjusted * Math.pow(ratio, exponent));
      }
    }
    total = int32FromFloat(total + sourceRoundf(adjusted));
  }


  if (breederXpBonus !== undefined) {
    total = int32FromFloat(f(f(total) * f(breederXpBonus)));
  }


  return int32FromFloat(Math.ceil(f(f(total) / participantCount)));
}


export function jobXpForLevel(level: number, xpPenalty: number): number {
  const requestedLevel = Math.trunc(level);
  const penalty = f(xpPenalty);
  if (requestedLevel < 2) return 0;
  if (requestedLevel === 2) return uint32FromFloat(f(penalty * f(100)));

  const baseLevel = Math.min(requestedLevel, 20);
  const powBase = f(f(f(baseLevel) * f(8.9)) + f(-25));
  const curve =
    (((baseLevel * 8000 - 9000 + Math.pow(powBase, f(3.61))) / 400) * 2 +
      baseLevel * 300 -
      700) *
    penalty *
    0.8;
  let result = uint32FromFloat(curve);

  if (requestedLevel >= 21) {


    const resultF = f(result);
    const growing = f(resultF * f(3.5)) * Math.pow(f(1.06), requestedLevel - 20);
    const subtracting = f(resultF * f(-2.5));
    result = uint32FromFloat(growing + subtracting);
  }
  return result;
}


export function jobXpCostOfNextLevel(level: number, xpPenalty: number): number {
  return jobXpForLevel(level + 1, xpPenalty) - jobXpForLevel(level, xpPenalty);
}


export function jobCanLevelUp(level: number, cumulativeXp: number, xpPenalty: number): boolean {
  return level <= 149 && cumulativeXp >= jobXpForLevel(level + 1, xpPenalty);
}

/** `performAwardLogic`'s repeated `while ([job canLevelUp]) [job increaseLevel]`. */
export function jobLevelAfterAward(
  startLevel: number,
  cumulativeXp: number,
  xpPenalty: number,
): number {
  let level = Math.trunc(startLevel);
  while (jobCanLevelUp(level, cumulativeXp, xpPenalty)) level += 1;
  return level;
}
