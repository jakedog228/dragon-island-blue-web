/** Durable one-shot registry shared by local Collection flow and future authoritative aggregates. */
export class CollectionClaims {
  readonly #claimedGoalIds = new Set<string>();

  constructor(claimedGoalIds: readonly string[] = []) {
    for (const goalId of claimedGoalIds) {
      requireGoalId(goalId);
      if (this.#claimedGoalIds.has(goalId)) {
        throw new Error(`CollectionClaims: duplicate claimed goal ID ${goalId}`);
      }
      this.#claimedGoalIds.add(goalId);
    }
  }

  has(goalId: string): boolean {
    return this.#claimedGoalIds.has(goalId);
  }

  claim(goalId: string): void {
    requireGoalId(goalId);
    if (this.#claimedGoalIds.has(goalId)) {
      throw new Error(`CollectionClaims: goal ${goalId} is already claimed`);
    }
    this.#claimedGoalIds.add(goalId);
  }

  snapshot(): readonly string[] {
    return Object.freeze([...this.#claimedGoalIds].sort(compareText));
  }
}

function requireGoalId(goalId: unknown): asserts goalId is string {
  if (typeof goalId !== "string" || goalId.length === 0) {
    throw new Error("CollectionClaims: goal ID must be a non-empty string");
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
