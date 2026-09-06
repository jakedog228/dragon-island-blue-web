import type { PlayerGameStateSnapshot } from "./gameState.js";

/**
 * Whether state written under a historical content identity still has a defined meaning today.
 *
 * `localStorage` slots are namespaced by the content fingerprint, and each namespace bump has to
 * decide what to do with the previous one's records. Identities v1-v6 predate reachable Collection
 * claims, so their digests never covered Collection mechanics: only claim-free state has an
 * unambiguous interpretation under the v7 definition.
 *
 * This deliberately does not live with the save-file code. File import no longer carries a
 * fingerprint at all — the native format has no envelope to put one in, so a file is validated by
 * resolving its contents against the loaded archive instead. This rule governs only the browser's
 * own historical storage namespaces.
 */
export function isHistoricalContentStateEligible(state: PlayerGameStateSnapshot): boolean {
  return state.player.schemaVersion === 1 || state.player.claimedCollectionGoalIds.length === 0;
}
