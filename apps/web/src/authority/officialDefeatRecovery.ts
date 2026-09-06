import type { BattleDefeatDecisionV1, GameCommandV1 } from "@dib/game-protocol";

import type { DefeatRecoveryAdapter } from "../battle/battleNode.js";
import {
  RemoteGameAuthorityError,
  type InstalledSlotProjection,
} from "./gameAuthorityClient.js";

export type OfficialDefeatResolutionCommand = Extract<
  GameCommandV1,
  { type: "battle.resolveDefeat" }
>;
export type OfficialDefeatRecovery = OfficialDefeatResolutionCommand["recovery"];

/**
 * The server-owned defeat decision a committed projection is waiting on.
 *
 * v12 defers defeat recovery: the battle command that ends a fight in a loss commits with
 * `pendingDefeat` set, and the slot then admits nothing but `battle.resolveDefeat` for that battle
 * id. Every Official battle exit has to settle that decision before it adopts a projection or
 * derives a return scene, or the slot stays wedged and every later command is rejected.
 *
 * A v11 stack settles the loss inside the battle command itself and exposes no decision at all, so
 * an absent decision means "already resolved" rather than an error. `decision` is read instead of
 * `pendingDefeat` because it is the one shape present on every installed projection version.
 */
export function officialPendingDefeatDecision(
  projection: InstalledSlotProjection,
): BattleDefeatDecisionV1 | undefined {
  const decision = projection.decision;
  return decision.type === "battle.defeatRecovery" ? decision : undefined;
}

/**
 * The resolution command for a pending defeat, or `undefined` when the projection is not waiting on
 * one. Save Me is refused locally when the authority did not offer it, so an ineligible offer can
 * never spend the player's gold on a command the reducer would reject anyway.
 */
export function officialDefeatResolutionCommand(
  projection: InstalledSlotProjection,
  recovery: OfficialDefeatRecovery,
): OfficialDefeatResolutionCommand | undefined {
  const pending = officialPendingDefeatDecision(projection);
  if (pending === undefined) return undefined;
  if (recovery === "saveMe" && !pending.canSaveMe) {
    throw new Error("official defeat decision does not offer Save Me");
  }
  return { type: "battle.resolveDefeat", battleId: pending.battleId, recovery };
}

/**
 * Settle a pending defeat by returning to town. Resolves to `true` when a decision was committed
 * and `false` when the projection carried none.
 */
export async function resolveOfficialDefeatReturn(
  projection: InstalledSlotProjection,
  submit: (command: OfficialDefeatResolutionCommand) => Promise<unknown>,
): Promise<boolean> {
  const command = officialDefeatResolutionCommand(projection, "return");
  if (command === undefined) return false;
  await submit(command);
  return true;
}

/** Adapt the server-owned continuation to BattleNode's shared defeat popup. Projection reads are
 * live because submitting Save Me replaces the battle and advances the coordinator atomically. */
export function createOfficialDefeatRecoveryAdapter(options: {
  readonly projection: () => InstalledSlotProjection;
  readonly submit: (command: OfficialDefeatResolutionCommand) => Promise<unknown>;
  readonly openGoldStore: DefeatRecoveryAdapter["openGoldStore"];
}): DefeatRecoveryAdapter {
  return {
    canOffer: () => officialPendingDefeatDecision(options.projection())?.canSaveMe === true,
    // v12+ claims the tutorial flag in the same transaction that creates the pending decision.
    // The admission gate permits only `battle.resolveDefeat` until that decision is settled.
    markTutorialSeen: () => undefined,
    acceptSaveMe: async () => {
      const command = officialDefeatResolutionCommand(options.projection(), "saveMe");
      if (command === undefined) {
        throw new Error("Official Save Me requires a pending defeat decision");
      }
      try {
        await options.submit(command);
        return "saved";
      } catch (error) {
        if (error instanceof RemoteGameAuthorityError && error.code === "INSUFFICIENT_FUNDS") {
          return "insufficient-funds";
        }
        throw error;
      }
    },
    openGoldStore: options.openGoldStore,
  };
}
