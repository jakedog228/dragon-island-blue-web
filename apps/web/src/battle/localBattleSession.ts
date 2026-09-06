import { BattleSession, type BattleEvent, type Rng, type TeamMemberSetup } from "@dib/engine";
import type { GameData } from "@dib/gamedata";
import type { BattlePlayerProfile, CaptureCardSpendResult } from "@dib/player-domain";

/** Construct browser-local authority with the same durable wallet that native
 * `SpendSilverAbilityComponent` reads through `UserSavedData`. */
export function createLocalBattleSession(
  data: GameData,
  teams: [TeamMemberSetup[], TeamMemberSetup[]],
  rng: Rng,
  profile: Pick<BattlePlayerProfile, "snapshot">,
  options: { readonly blockCapture?: boolean } = {},
): BattleSession {
  return new BattleSession(data, teams, rng, {
    silver: profile.snapshot().silver,
    ...(options.blockCapture === undefined ? {} : { blockCapture: options.blockCapture }),
  });
}

/** Keep a local session's mirror aligned when capture-card auto-purchase spends the same silver
 * wallet outside BattleCore. Owned cards and gold purchases do not touch the silver mirror. */
export function mirrorLocalCapturePurchaseToBattleWallet(
  session: Pick<BattleSession, "applyExternalSilverDebit">,
  spent: CaptureCardSpendResult,
): void {
  if (
    spent.ok &&
    spent.source === "purchased" &&
    spent.cost?.currency === "silver"
  ) {
    session.applyExternalSilverDebit(spent.cost.amount);
  }
}

/** Mirror successful battle-owned wallet mutations into the local durable profile.
 * Official authority settles the same event in its reducer and must not call this seam. */
export function settleLocalBattleWalletEvents(
  profile: Pick<BattlePlayerProfile, "snapshot" | "spendSilver">,
  events: readonly BattleEvent[],
): void {
  for (const event of events) {
    if (event.type !== "silverSpent") continue;
    if (profile.snapshot().silver - event.amount !== event.remaining || !profile.spendSilver(event.amount)) {
      throw new Error("Local battle silver mirror diverged");
    }
  }
}
