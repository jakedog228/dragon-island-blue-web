import type { SourceConditions } from "@dib/gamedata";

export interface SourceConditionContext {
  readonly hasSeenChat: (name: string) => boolean;
  readonly hasCompletedBattle: (name: string) => boolean;
  readonly hasCompletedQuest: (name: string) => boolean;
  readonly canUseQuest: (name: string) => boolean;
  readonly hasCompletedPoi: (name: string) => boolean;
  /** Source `GlobalSavedData.goldPurchased`; server-owned and zero when no IAP service exists. */
  readonly goldPurchased: number;
}


export function sourceConditionsAreMet(
  conditions: SourceConditions | undefined,
  context: SourceConditionContext,
): boolean {
  if (conditions === undefined) return true;
  if (!Number.isSafeInteger(context.goldPurchased) || context.goldPurchased < 0) {
    throw new Error(`source condition goldPurchased must be a nonnegative integer; got ${context.goldPurchased}`);
  }
  if (
    conditions.andCondition !== undefined &&
    !sourceConditionsAreMet(conditions.andCondition, context)
  ) return false;
  if (
    conditions.orCondition !== undefined &&
    sourceConditionsAreMet(conditions.orCondition, context)
  ) return true;
  return (
    expressionsPass(conditions.chats, context.hasSeenChat) &&
    expressionsPass(conditions.battles, context.hasCompletedBattle) &&
    expressionsPass(conditions.quests, context.hasCompletedQuest) &&
    expressionsPass(conditions.inProgressQuests, context.canUseQuest) &&
    expressionsPass(conditions.pois, context.hasCompletedPoi) &&
    (conditions.maxIAPMade === undefined || context.goldPurchased <= conditions.maxIAPMade) &&
    (conditions.minIAPMade === undefined || context.goldPurchased >= conditions.minIAPMade)
  );
}

function expressionsPass(
  expressions: readonly string[] | undefined,
  predicate: (name: string) => boolean,
): boolean {
  if (expressions === undefined) return true;
  for (const expression of expressions) {
    const negated = expression.startsWith("!");
    const name = negated ? expression.slice(1) : expression;
    if (name.length === 0) throw new Error("source condition contains an empty identity");
    const result = predicate(name);
    if (negated ? result : !result) return false;
  }
  return true;
}
