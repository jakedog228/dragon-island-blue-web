// Player monster-collection surface used by source `highestLevelMonsterOfSimpleType:` queries.
// The interface belongs to shared player state, not to battle presentation: a durable
// save/Monsterpedia implementation can replace the demo set without changing BattleNode.

export interface PlayerCollection {
  /** Has the player ever captured or otherwise owned this simple monster type? */
  hasCapturedSimpleType(shortType: string): boolean;
}

/** Demo stand-in. Everything absent from the fixed list renders as first-capture `NEW!`. */
export function demoPlayerCollection(capturedTypes: readonly string[]): PlayerCollection {
  const captured = new Set(capturedTypes);
  return {
    hasCapturedSimpleType: (shortType: string): boolean => captured.has(shortType),
  };
}

/** Browser-fixture stand-in: every simple type counts as captured, so all evolve-chain rows pass
 * their unlock gate and no capture card is NEW. */
export function allUnlockedPlayerCollection(): PlayerCollection {
  return { hasCapturedSimpleType: (): boolean => true };
}
