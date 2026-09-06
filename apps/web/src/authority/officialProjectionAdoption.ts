export interface OfficialProjectionAdoptionPreparation<P, Q = P, W = P, D = P> {
  readonly player: P;
  readonly quests: Q;
  readonly world: W;
  readonly dungeon: D;
}

export type OfficialProjectionAdoptionSwap<P, Q, W, D> = (
  prepared: OfficialProjectionAdoptionPreparation<P, Q, W, D>,
) => void;

export interface OfficialProjectionAdoptionBuilders<P, Q = P, W = P, D = P> {
  readonly player: () => P;
  readonly quests: () => Q;
  readonly world: () => W;
  readonly dungeon: () => D;
}

/**
 * Build every replacement object before the caller performs its one live-reference swap.
 * Builders intentionally receive no live-state mutation hook: a thrown preflight leaves the
 * current browser authority untouched.
 */
export function prepareOfficialProjectionAdoption<P, Q = P, W = P, D = P>(
  builders: OfficialProjectionAdoptionBuilders<P, Q, W, D>,
): OfficialProjectionAdoptionPreparation<P, Q, W, D> {
  const player = builders.player();
  const quests = builders.quests();
  const world = builders.world();
  const dungeon = builders.dungeon();
  return Object.freeze({ player, quests, world, dungeon });
}

/**
 * The post-preflight boundary. The callback must contain only direct reference assignments to the
 * host's aggregate; all builders, listeners, restores, and transient transfers belong in prepare.
 */
export function commitOfficialProjectionAdoption<P, Q, W, D>(
  prepared: OfficialProjectionAdoptionPreparation<P, Q, W, D>,
  swap: OfficialProjectionAdoptionSwap<P, Q, W, D>,
): void {
  swap(prepared);
}
