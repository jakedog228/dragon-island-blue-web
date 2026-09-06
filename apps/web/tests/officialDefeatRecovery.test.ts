import { describe, expect, it, vi } from "vitest";
import type { DecisionViewV1, SlotProjectionV1 } from "@dib/game-protocol";
import {
  createOfficialDefeatRecoveryAdapter,
  officialDefeatResolutionCommand,
  officialPendingDefeatDecision,
  resolveOfficialDefeatReturn,
  type OfficialDefeatResolutionCommand,
} from "../src/authority/officialDefeatRecovery.js";
import { RemoteGameAuthorityError } from "../src/authority/gameAuthorityClient.js";

// Only `decision` is read, but the helpers take a whole installed projection, so the fixture is a
// real one with the decision swapped. Everything else is inert.
function projection(decision: DecisionViewV1): SlotProjectionV1 {
  return {
    slotId: "slot-1",
    revision: 7,
    logicPackId: `logic-v1:${"c".repeat(64)}`,
    simulationVersion: "official-game-v13",
    trustTier: "official",
    player: {
      heroLevel: 1,
      heroTotalHighestLevels: 1,
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      party: [],
      battingOrderSize: 6,
      battingOrderIds: [],
      ownedSoulStones: [],
      highestCapturedLevels: {},
      learnedCombineRecipes: [],
      tutorialFlags: [],
      catchQuestsDone: [],
      items: {},
      spirit: { energy: 0, savedXp: {}, usedThisTrip: [] },
    },
    location: { kind: "world", worldId: "World_1-1", poiId: "Town" },
    decision,
  };
}

const pendingDefeat = (canSaveMe: boolean): DecisionViewV1 => ({
  type: "battle.defeatRecovery",
  decisionId: "decision-7",
  battleId: "battle-3",
  canSaveMe,
});

const worldReady: DecisionViewV1 = {
  type: "world.ready",
  decisionId: "decision-7",
  selectablePoiIds: ["Town"],
};

describe("officialPendingDefeatDecision", () => {
  it("reads the deferred defeat decision off the committed projection", () => {
    expect(officialPendingDefeatDecision(projection(pendingDefeat(true)))).toEqual({
      type: "battle.defeatRecovery",
      decisionId: "decision-7",
      battleId: "battle-3",
      canSaveMe: true,
    });
  });

  it("reports no pending defeat for any other decision", () => {
    expect(officialPendingDefeatDecision(projection(worldReady))).toBeUndefined();
  });
});

describe("officialDefeatResolutionCommand", () => {
  it("targets the decision's own battle id", () => {
    expect(officialDefeatResolutionCommand(projection(pendingDefeat(false)), "return")).toEqual({
      type: "battle.resolveDefeat",
      battleId: "battle-3",
      recovery: "return",
    });
  });

  it("builds a Save Me resolution when the authority offered it", () => {
    expect(officialDefeatResolutionCommand(projection(pendingDefeat(true)), "saveMe")).toEqual({
      type: "battle.resolveDefeat",
      battleId: "battle-3",
      recovery: "saveMe",
    });
  });

  it("refuses Save Me locally when the authority did not offer it", () => {
    // Fails before the submit so an ineligible offer can never spend gold on a rejected command.
    expect(() => officialDefeatResolutionCommand(projection(pendingDefeat(false)), "saveMe"))
      .toThrow(/does not offer Save Me/);
  });

  it("yields nothing when the projection carries no decision to settle", () => {
    expect(officialDefeatResolutionCommand(projection(worldReady), "return")).toBeUndefined();
  });
});

describe("resolveOfficialDefeatReturn", () => {
  it("submits exactly one return resolution and reports that it settled", async () => {
    const submit = vi.fn(async (_command: OfficialDefeatResolutionCommand) => {});
    await expect(resolveOfficialDefeatReturn(projection(pendingDefeat(true)), submit))
      .resolves.toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      type: "battle.resolveDefeat",
      battleId: "battle-3",
      recovery: "return",
    });
  });

  it("is a no-op on a projection with nothing pending, so exits can call it unconditionally", async () => {
    // A v11 stack settles the loss inside the battle command and never exposes a decision; the same
    // path also covers a retried exit whose defeat was already resolved.
    const submit = vi.fn(async (_command: OfficialDefeatResolutionCommand) => {});
    await expect(resolveOfficialDefeatReturn(projection(worldReady), submit)).resolves.toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("createOfficialDefeatRecoveryAdapter", () => {
  it("reads the live offer and submits the authority-owned Save Me decision exactly once", async () => {
    let current = projection(pendingDefeat(true));
    const submit = vi.fn(async (_command: OfficialDefeatResolutionCommand) => {
      current = projection(worldReady);
    });
    const openGoldStore = vi.fn(async () => ({ closed: Promise.resolve() }));
    const adapter = createOfficialDefeatRecoveryAdapter({
      projection: () => current,
      submit,
      openGoldStore,
    });

    expect(adapter.canOffer()).toBe(true);
    expect(adapter.markTutorialSeen()).toBeUndefined();
    await expect(adapter.acceptSaveMe()).resolves.toBe("saved");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      type: "battle.resolveDefeat",
      battleId: "battle-3",
      recovery: "saveMe",
    });
    expect(adapter.canOffer()).toBe(false);
    await expect(adapter.openGoldStore()).resolves.toEqual({ closed: expect.any(Promise) });
    expect(openGoldStore).toHaveBeenCalledTimes(1);
  });

  it("maps the authority's insufficient-funds refusal back into BattleNode's Store loop", async () => {
    const adapter = createOfficialDefeatRecoveryAdapter({
      projection: () => projection(pendingDefeat(true)),
      submit: async () => {
        throw new RemoteGameAuthorityError(
          "INSUFFICIENT_FUNDS",
          "Save Me requires 100 gold",
          false,
        );
      },
      openGoldStore: async () => ({ closed: Promise.resolve() }),
    });
    await expect(adapter.acceptSaveMe()).resolves.toBe("insufficient-funds");
  });

  it("fails before submit when the projection no longer carries a defeat decision", async () => {
    const submit = vi.fn(async (_command: OfficialDefeatResolutionCommand) => {});
    const adapter = createOfficialDefeatRecoveryAdapter({
      projection: () => projection(worldReady),
      submit,
      openGoldStore: async () => ({ closed: Promise.resolve() }),
    });
    expect(adapter.canOffer()).toBe(false);
    await expect(adapter.acceptSaveMe()).rejects.toThrow(/pending defeat decision/i);
    expect(submit).not.toHaveBeenCalled();
  });
});
