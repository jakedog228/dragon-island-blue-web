import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

describe("WorldNode Official transition recovery", () => {
  it("rebinds every mutable projection aggregate before retained-world input resumes", async () => {
    const old = {
      trip: { currentPoiName: "Field" },
      party: {},
      playerRuntime: {},
      guildQuests: {},
      questRewardRng: {},
      refreshState: {},
      heroProgress: {},
    };
    const party = {};
    const replacement = {
      world: { name: "World_1-1" },
      trip: { currentPoiName: "Field" },
      party,
      playerRuntime: { party },
      guildQuests: {},
      questRewardRng: {},
      refreshState: {},
      heroProgress: { level: 2, totalHighestLevels: 3 },
    };
    const receiver = {
      deps: { world: replacement.world, ...old },
      byName: new Map([["Field", {}]]),
      isAlive: () => true,
    };

    WorldNode.prototype.rebindRetainedSession.call(
      receiver as never,
      replacement as never,
    );

    expect(receiver.deps).toMatchObject({
      trip: replacement.trip,
      party: replacement.party,
      playerRuntime: replacement.playerRuntime,
      guildQuests: replacement.guildQuests,
      questRewardRng: replacement.questRewardRng,
      refreshState: replacement.refreshState,
      heroProgress: replacement.heroProgress,
    });
  });

  it("removes the stale Guild runtime when the adopted projection has none", async () => {
    const party = {};
    const receiver = {
      deps: {
        world: { name: "World_1-1" },
        guildQuests: { stale: true },
      },
      byName: new Map([["Field", {}]]),
      isAlive: () => true,
    };

    WorldNode.prototype.rebindRetainedSession.call(receiver as never, {
      world: { name: "World_1-1" },
      trip: { currentPoiName: "Field" },
      party,
      playerRuntime: { party },
      questRewardRng: {},
      refreshState: {},
      heroProgress: { level: 2, totalHighestLevels: 3 },
    } as never);

    expect(receiver.deps).not.toHaveProperty("guildQuests");
  });

  it.each([
    {
      label: "destroyed retained node",
      receiver: {
        deps: { world: { name: "World_1-1" } },
        byName: new Map([["Field", {}]]),
        isAlive: () => false,
      },
      replacement: {
        world: { name: "World_1-1" },
        trip: { currentPoiName: "Field" },
      },
      message: "cannot rebind a destroyed retained world",
    },
    {
      label: "different world",
      receiver: {
        deps: { world: { name: "World_1-1" } },
        byName: new Map([["Field", {}]]),
        isAlive: () => true,
      },
      replacement: {
        world: { name: "World_1-2" },
        trip: { currentPoiName: "Field" },
      },
      message: "retained world World_1-1 cannot adopt World_1-2",
    },
    {
      label: "split player and party aggregates",
      receiver: {
        deps: { world: { name: "World_1-1" } },
        byName: new Map([["Field", {}]]),
        isAlive: () => true,
      },
      replacement: {
        world: { name: "World_1-1" },
        trip: { currentPoiName: "Field" },
        party: {},
        playerRuntime: { party: {} },
      },
      message: "retained player runtime and party must share one aggregate",
    },
    {
      label: "unknown projected POI",
      receiver: {
        deps: { world: { name: "World_1-1" } },
        byName: new Map([["Field", {}]]),
        isAlive: () => true,
      },
      replacement: {
        world: { name: "World_1-1" },
        trip: { currentPoiName: "Missing" },
      },
      message: "retained session references unknown POI Missing",
    },
  ])("rejects a $label before mutating retained dependencies", async ({ receiver, replacement, message }) => {
    const originalDeps = { ...receiver.deps };
    const party = "party" in replacement ? replacement.party : {};
    const completeReplacement = {
      party,
      playerRuntime: { party },
      questRewardRng: {},
      refreshState: {},
      heroProgress: { level: 2, totalHighestLevels: 3 },
      ...replacement,
    };

    expect(() => WorldNode.prototype.rebindRetainedSession.call(
      receiver as never,
      completeReplacement as never,
    )).toThrow(message);
    expect(receiver.deps).toEqual(originalDeps);
  });

  it("rebuilds from the committed projection instead of unlocking the stale world", async () => {
    const restartPresentation = vi.fn();
    const receiver = {
      deps: {
        authority: {},
        onPresentationChange: restartPresentation,
      },
      transitionFailure: undefined as { route: string; message: string } | undefined,
      locked: true,
      activeTown: undefined,
      isAlive: () => true,
      cancelMovement: vi.fn(),
      refreshPoiStates: vi.fn(),
      settleMarkerAt: vi.fn(),
    };
    const recoverTransitionFailure = (WorldNode.prototype as unknown as {
      recoverTransitionFailure(
        this: typeof receiver,
        route: string,
        target: object,
        error: unknown,
      ): void;
    }).recoverTransitionFailure;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    recoverTransitionFailure.call(
      receiver,
      "encounter",
      {},
      new Error("battle presentation failed after commit"),
    );

    expect(receiver.transitionFailure).toEqual({
      route: "encounter",
      message: "battle presentation failed after commit",
    });
    expect(receiver.cancelMovement).toHaveBeenCalledOnce();
    expect(restartPresentation).toHaveBeenCalledOnce();
    expect(receiver.refreshPoiStates).not.toHaveBeenCalled();
    expect(receiver.settleMarkerAt).not.toHaveBeenCalled();
    expect(receiver.locked).toBe(true);
    consoleError.mockRestore();
  });
});
