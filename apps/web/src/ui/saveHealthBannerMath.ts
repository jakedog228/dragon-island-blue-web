import type { SaveHealthState } from "../player/saveHealth.js";

export interface SaveHealthBannerView {
  readonly visible: boolean;
  readonly conflictStyle: boolean;
  readonly text: string;
  readonly actionVisible: boolean;
}

/**
 * Pure banner projection, split out because `apps/web` has no DOM test environment and this is the
 * part with actual decisions in it: when to show, when to offer the destructive take-over, and how
 * a run of repeated failures reads.
 */
export function saveHealthBannerView(
  state: SaveHealthState,
  canTakeOver: boolean,
): SaveHealthBannerView {
  if (state.healthy) {
    return { visible: false, conflictStyle: false, text: "", actionVisible: false };
  }
  const repeated = state.consecutiveFailures > 1
    ? ` (${state.consecutiveFailures} failed saves)`
    : "";
  return {
    visible: true,
    conflictStyle: state.conflicted,
    text: `${state.detail ?? "Saving failed."}${repeated}`,
    // Offered only for a live conflict: taking over overwrites the other tab, so it must never
    // appear for a quota or transport failure where it would do nothing but lose the other save.
    actionVisible: state.conflicted && canTakeOver,
  };
}
