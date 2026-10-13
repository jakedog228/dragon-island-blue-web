import { AudioPlayer } from "../src/audio.js";
import { BattleRoster } from "../src/battle/battleRoster.js";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import {
  BattleNode,
  createRetryableTerminalExit,
  projectOriginalEnemySurvivorConstructionIndices,
  terminalPresentationWinner,
  type DefeatRecoveryAdapter,
} from "../src/battle/battleNode.js";
import { createDungeonBattleLifecycleDiagnosticReporter } from "../src/dungeon/dungeonBattle.js";
import {
  pacingDelayMs,
  removalLogicHoldMs,
  terminalPacingDelayMs,
  terminalPresentationDelayMs,
  timeDelayGateFrames,
  timeDelayResidueMs,
  REMOVED_LIVING_LOGIC_HOLD_MS,
  VICTORY_AWARD_STATE_HOLD_MS,
  DEFEAT_LOGIC_DELAY_MS,
  PACING_FRIENDLY_MS,
  PACING_ENEMY_MS,
  sceneManifest,
  backgroundPosCocos,
  turnOrderPosCocos,
  BACKGROUND_SIZE,
  BACKGROUND_POS_COCOS,
  BACKGROUND_TEXTURE_RECT_PX,
  TURN_ORDER_POS_COCOS,
  FRIENDLY_ATTACK_SPOTLIGHT_Z,
  type SceneChild,
} from "../src/battle/battleNodeScene.js";
import {
  turnOrderResolutionPlan,
  type TurnOrderResolutionPlan,
} from "../src/battle/turnOrderFlow.js";

const handleSwitched = (BattleNode.prototype as unknown as {
  handleSwitched(this: object, event: { type: "switched"; out: string; in: string; team: 0 | 1 }): void;
}).handleSwitched;
const handleDeaths = (BattleNode.prototype as unknown as {
  handleDeaths(this: object, events: readonly object[]): Promise<void>;
}).handleDeaths;
const applyRosterEvents = (BattleNode.prototype as unknown as {
  applyRosterEvents(this: object, events: readonly object[]): Promise<void>;
}).applyRosterEvents;
const handleMonsterAdded = (BattleNode.prototype as unknown as {
  handleMonsterAdded(this: object, event: object, warmup?: Promise<void>, defer?: boolean): Promise<void>;
}).handleMonsterAdded;
const settleDisplayRegistrations = (BattleNode.prototype as unknown as {
  settleDisplayRegistrations(this: object): Promise<void>;
}).settleDisplayRegistrations;
const trackDisplayRegistration = (BattleNode.prototype as unknown as {
  trackDisplayRegistration(this: object, registration: Promise<void>): void;
}).trackDisplayRegistration;
const startRosterAssetWarmups = (BattleNode.prototype as unknown as {
  startRosterAssetWarmups(this: object, events: readonly object[]): ReadonlyMap<string, Promise<void>>;
}).startRosterAssetWarmups;
const commitTurnOrderForTurn = (BattleNode.prototype as unknown as {
  commitTurnOrderForTurn(
    this: object,
    plan: TurnOrderResolutionPlan,
    addedIds: readonly string[],
    preAdvanceQueue: readonly string[],
  ): Promise<void>;
}).commitTurnOrderForTurn;
const playMusicTrack = (BattleNode.prototype as unknown as {
  playMusicTrack(this: object, category: string, trackCount: number, loop: boolean): void;
}).playMusicTrack;
const sourceRandom = (BattleNode.prototype as unknown as {
  sourceRandom(this: object): number;
}).sourceRandom;

const popupHarness = vi.hoisted(() => ({
  calls: [] as Array<{
    readonly title: string | undefined;
    readonly content: { readonly message: string };
    readonly buttons: ReadonlyArray<{
      readonly label: string;
      readonly onPress: () => void | Promise<void>;
    }>;
  }>,
  events: [] as string[],
}));

describe("BattleNode source RNG ownership", () => {
  it("consumes the local battle stream for track selection, including one-track music", () => {
    const intBelow = vi.fn((count: number) => count - 1);
    const playMusic = vi.fn();
    const harness = {
      sourceRng: { intBelow },
      game: { assets: { audioUrl: (name: string) => `asset:${name}` } },
      audio: { playMusic, requestMusic: AudioPlayer.prototype.requestMusic },
    };

    playMusicTrack.call(harness, "Battle", 7, true);
    playMusicTrack.call(harness, "Win", 1, false);

    expect(intBelow.mock.calls).toEqual([[7], [1]]);
    expect(playMusic).toHaveBeenNthCalledWith(1, "asset:Battle7", {
      loop: true,
      assetName: "Battle7.mp3",
    });
    expect(playMusic).toHaveBeenNthCalledWith(2, "asset:Win1", {
      loop: false,
      assetName: "Win1.mp3",
    });
  });

  it("uses the local shared stream but never an Official mechanic tape for presentation draws", () => {
    const next = vi.fn(() => 0.25);
    expect(sourceRandom.call({ sourceRng: { next } })).toBe(0.25);
    expect(next).toHaveBeenCalledOnce();

    const platformRandom = vi.spyOn(Math, "random").mockReturnValue(0.75);
    expect(sourceRandom.call({ sourceRng: undefined })).toBe(0.75);
    expect(platformRandom).toHaveBeenCalledOnce();
    platformRandom.mockRestore();
  });
});

describe("BattleNode terminal turn routing", () => {
  it("leaves Utility.Escape winnerless for the loop's onBattleRetreated handoff", () => {
    expect(terminalPresentationWinner([
      { type: "escaped", living: "hero" },
    ], true)).toBeUndefined();
  });

  it("preserves the battleEnded winner guard for victory and defeat terminals", () => {
    expect(terminalPresentationWinner([
      { type: "battleEnded", winner: 0, time: 12 },
    ], false)).toBe(0);
    expect(() => terminalPresentationWinner([
      { type: "escaped", living: "hero" },
    ], false)).toThrow(/battleEnded winner/);
    expect(() => terminalPresentationWinner([
      { type: "battleEnded", winner: "draw", time: 12 },
    ], false)).toThrow(/battleEnded winner/);
  });
});

describe("BattleNode source-overlapped Switch presentation", () => {
  it("starts the incoming add before the outgoing removal animation settles", async () => {
    let finishRemoval!: () => void;
    const removal = new Promise<void>((resolve) => { finishRemoval = resolve; });
    let finishAddition!: () => void;
    const addition = new Promise<void>((resolve) => { finishAddition = resolve; });
    const notifyDied = vi.fn(() => removal);
    const notifyAddedMany = vi.fn(() => addition);
    const refreshHostsFor = vi.fn();
    let presentationTask: Promise<void> | undefined;
    const harness = {
      friendlyDisplay: { notifyDied, notifyAddedMany },
      enemyDisplay: { notifyDied: vi.fn(), notifyAddedMany: vi.fn(), setBenchCount: vi.fn() },
      hp: { set: vi.fn() },
      session: { hpOf: vi.fn(() => 17), benchCountOf: vi.fn(() => 0) },
      friendlySnapshotOf: vi.fn(() => ({ id: "in", hp: 17 })),
      statusOverlays: { refreshHostsFor },
      lifecycle: { disposed: false },
      startPresentationTask: vi.fn((task: Promise<void>) => { presentationTask = task; }),
      trackDisplayRegistration: vi.fn(),
    };

    handleSwitched.call(harness, { type: "switched", out: "out", in: "in", team: 0 });

    expect(notifyDied).toHaveBeenCalledWith("out");
    expect(notifyAddedMany).toHaveBeenCalledOnce();
    expect(harness.startPresentationTask).toHaveBeenCalledOnce();
    // The card build is joined at the turn boundary (settleDisplayRegistrations) so the
    // switched-in member always resolves through nodeOf; only the entrance is fire-and-forget.
    expect(harness.trackDisplayRegistration).toHaveBeenCalledOnce();
    expect(refreshHostsFor).not.toHaveBeenCalled();

    finishAddition();
    await Promise.resolve();
    expect(refreshHostsFor).toHaveBeenCalledWith("in");
    finishRemoval();
    await expect(presentationTask).resolves.toBeUndefined();
  });
});

describe("BattleNode promoted-reserve display registration", () => {
  it.each([0, 1] as const)("releases a sacrificed team-%i display before presenting its Reincarnation replacement", async (team) => {
    const displayed = new Set(["a", "caster", "c"]);
    const order: string[] = [];
    let finishDeath!: () => void;
    const removal = new Promise<void>(resolve => { finishDeath = resolve; });
    const notifyDied = vi.fn((id: string) => { displayed.delete(id); order.push(`remove:${id}`); return removal; });
    const add = vi.fn((snapshots: readonly { id: string }[]) => {
      for (const { id } of snapshots) {
        expect(displayed.size, "the full row still owns all display slots").toBeLessThan(3);
        displayed.add(id); order.push(`add:${id}`);
      }
      return Promise.resolve();
    });
    const display = { notifyDied, hasMonster: (id: string) => displayed.has(id), notifyAddedMany: add,
      notifyAddedManyPhases: (snapshots: readonly { id: string }[]) => ({ registered: add(snapshots), entrance: Promise.resolve() }),
      setBenchCount: vi.fn() };
    const empty = { ...display, notifyAddedMany: vi.fn(() => Promise.resolve()),
      notifyAddedManyPhases: vi.fn(() => ({ registered: Promise.resolve(), entrance: Promise.resolve() })) };
    const harness = {
      roster: { registerMidBattle: vi.fn(() => order.push("register:new")) }, hp: { set: vi.fn() },
      session: { hpOf: () => 153, teamOf: () => team, benchCountOf: () => 0,
        activeIdsOf: (which: number) => which === team ? ["a", "c", "new"] : [] },
      lifecycle: { disposed: false }, preloadDynamicRosterType: async () => {}, handleMonsterAdded,
      friendlyDisplay: team === 0 ? display : empty, enemyDisplay: team === 1 ? display : empty,
      friendlySnapshotOf: (id: string) => ({ id }), enemySnapshotOf: (id: string) => ({ id }),
      statusOverlays: { refreshHostsFor: vi.fn() }, trackDisplayRegistration: vi.fn(), startPresentationTask: vi.fn(),
    };
    // Exact Reincarnation order: add is initially benched, then caster sacrifice promotes it.
    const events = [{ type: "monsterAdded", living: "new", shortType: "ThunderMage", level: 20, team, summoner: "caster" },
      { type: "died", living: "caster" }];
    await applyRosterEvents.call(harness, events);
    expect(order).toEqual(["register:new"]);
    const settled = handleDeaths.call(harness, events);
    expect(order).toEqual(["register:new", "remove:caster", "add:new"]);
    expect(displayed).toEqual(new Set(["a", "c", "new"]));
    finishDeath(); await settled;
    expect(notifyDied).toHaveBeenCalledOnce();
  });

  // Regression: `EnemyTeamDisplay.nodeOf: unknown monster id "t1mN:..."` thrown from showPanel's
  // capture-host build. A promoted reserve's display construction used to ride entirely on the
  // fire-and-forget entrance task, so the next turn panel could resolve a live enemy id whose
  // display had not been built yet (and, if that build rejected, never would be).
  it("tracks the enemy build as a joinable registration and leaves only the entrance free-standing", async () => {
    let finishBuild!: () => void;
    const registered = new Promise<void>((resolve) => { finishBuild = resolve; });
    let finishEntrance!: () => void;
    const entrance = new Promise<void>((resolve) => { finishEntrance = resolve; });
    const notifyAddedManyPhases = vi.fn(() => ({ registered, entrance }));
    const tracked: Promise<void>[] = [];
    const presentationTasks: Promise<void>[] = [];
    const harness = {
      session: {
        teamOf: vi.fn(() => 1),
        activeIdsOf: vi.fn((team: 0 | 1) => (team === 0 ? [] : ["t1m3:ThunderMage"])),
        benchCountOf: vi.fn(() => 2),
      },
      friendlyDisplay: { notifyDied: vi.fn(), notifyAddedMany: vi.fn(() => Promise.resolve()) },
      enemyDisplay: {
        notifyDied: vi.fn(() => Promise.resolve()),
        notifyAddedManyPhases,
        setBenchCount: vi.fn(),
        hasMonster: vi.fn(() => false),
      },
      enemySnapshotOf: vi.fn((id: string) => ({ id })),
      friendlySnapshotOf: vi.fn((id: string) => ({ id })),
      statusOverlays: { refreshHostsFor: vi.fn() },
      trackDisplayRegistration: vi.fn((p: Promise<void>) => { tracked.push(p); }),
      startPresentationTask: vi.fn((task: Promise<void>) => { presentationTasks.push(task); }),
    };

    const deaths = handleDeaths.call(harness, [{ type: "died", living: "t1m0:Imp" }]);

    expect(notifyAddedManyPhases).toHaveBeenCalledWith([{ id: "t1m3:ThunderMage" }]);
    // Both promotion rows are joinable; the deferred 1.0s entrance is the only free-standing task.
    expect(tracked).toContain(registered);
    expect(harness.startPresentationTask).toHaveBeenCalledOnce();
    finishBuild();
    finishEntrance();
    await deaths;
    await Promise.all(presentationTasks);
  });

  it("settleDisplayRegistrations drains registrations queued while draining, and rethrows", async () => {
    const harness = { pendingDisplayRegistrations: [] as Promise<void>[] };
    const order: string[] = [];
    const first = Promise.resolve().then(() => {
      order.push("first");
      trackDisplayRegistration.call(harness, Promise.resolve().then(() => { order.push("second"); }));
    });
    trackDisplayRegistration.call(harness, first);
    await settleDisplayRegistrations.call(harness);
    expect(order).toEqual(["first", "second"]);
    expect(harness.pendingDisplayRegistrations).toEqual([]);

    trackDisplayRegistration.call(harness, Promise.reject(new Error("texture gone")));
    await expect(settleDisplayRegistrations.call(harness)).rejects.toThrow(/texture gone/);
  });
});

describe("BattleNode dynamic-roster asset overlap", () => {
  it("starts one hidden preload per committed species before impact", () => {
    const preloadDynamicRosterType = vi.fn((shortType: string) => Promise.resolve());
    const roster = new BattleRoster({ backgroundKey: "FieldCombat", playerTeam: [], enemyTeam: [] });
    const warmups = startRosterAssetWarmups.call({ preloadDynamicRosterType, roster }, [
      { type: "monsterAdded", living: "t1m0:Mask", team: 1, shortType: "Mask", level: 10 },
      { type: "monsterAdded", living: "t1m1:Mask", team: 1, shortType: "Mask", level: 11 },
      { type: "summonChanged", added: "t0m0:Griffin", team: 0, shortType: "Griffin", level: 12 },
      { type: "summonChanged", added: undefined, shortType: "Ignored" },
      { type: "switched", out: "a", in: "b", team: 0 },
    ]);

    expect(preloadDynamicRosterType.mock.calls).toEqual([["Mask"], ["Griffin"]]);
    expect([...warmups.keys()]).toEqual(["Mask", "Griffin"]);
    expect(roster.entryOf("t1m1:Mask").setup.level).toBe(11);
  });

  it("makes a split identity readable by an older queue callback before its asset or impact settles", async () => {
    const roster = new BattleRoster({ backgroundKey: "FieldCombat", playerTeam: [],
      enemyTeam: [{ shortType: "KingSlime", level: 80 }] });
    let resolveAsset!: () => void;
    const asset = new Promise<void>(resolve => { resolveAsset = resolve; });
    const preloadDynamicRosterType = vi.fn(() => asset);
    const hp = new Map([["t1m0:KingSlime", 2000]]);
    const warmups = startRosterAssetWarmups.call({ roster, hp, preloadDynamicRosterType }, [
      { type: "monsterAdded", living: "t1m1:KingSlime", team: 1, shortType: "KingSlime", level: 80 },
    ]);
    // warpLive synchronously reads every identity in the engine's already-resolved queue.
    expect(["t1m0:KingSlime", "t1m1:KingSlime"].map(id => roster.entryOf(id).setup.shortType))
      .toEqual(["KingSlime", "KingSlime"]);
    expect(hp.has("t1m1:KingSlime")).toBe(false);
    resolveAsset();
    await warmups.get("KingSlime");
  });
});

describe("BattleNode dungeon survivor projection", () => {
  it("keeps only original active/reserve enemies, excluding dead, captured, and summons", () => {
    expect(projectOriginalEnemySurvivorConstructionIndices([
      { constructionIndex: 0, createdMidBattle: false, status: "dead" },
      { constructionIndex: 1, createdMidBattle: false, status: "active" },
      { constructionIndex: 2, createdMidBattle: false, status: "captured" },
      { constructionIndex: 3, createdMidBattle: true, status: "active" },
      { constructionIndex: 4, createdMidBattle: false, status: "reserve" },
    ])).toEqual([1, 4]);
  });
});

describe("retryable BattleNode terminal exit", () => {
  it.each(["victory", "retreat", "defeat"] as const)(
    "invokes the production committed-terminal callback only after %s handoff succeeds",
    async (outcome) => {
      const stage = {
        root: new Container(),
        app: {
          stage: new Container(),
          screen: { width: 960, height: 640 },
          ticker: { add: vi.fn(), remove: vi.fn() },
        },
      };
      const events: string[] = [];
      const keyboard = { register: vi.fn(() => () => undefined) };
      const node = new BattleNode({
        stage: stage as never,
        game: {} as never,
        audio: { playSfx: vi.fn() } as never,
        keyboard: keyboard as never,
        encounter: {
          backgroundKey: "CaveCombat",
          blockSaveMe: true,
          playerTeam: [{ shortType: "Testling", level: 1 }],
          enemyTeam: [{ shortType: "Testling", level: 1 }],
        },
        playerState: {
          collection: {} as never,
          profile: { battleStatBonuses: () => ({}) } as never,
        },
        onExit: async (value) => { events.push(`exit:${value}`); },
        onCommittedTerminal: async (value) => { events.push(`committed:${value}`); },
      });
      (node as unknown as { finishBattle(value: typeof outcome): void }).finishBattle(outcome);
      await vi.waitFor(() => expect(events).toHaveLength(2));
      expect(events).toEqual([`exit:${outcome}`, `committed:${outcome}`]);
      expect(keyboard.register).toHaveBeenCalledOnce();
      node.destroy();
    },
  );

  it("leaves standalone/rematch completion unchanged when no production onExit exists", async () => {
    const committed = vi.fn();
    const node = realTerminalNode({
      onCommittedTerminal: committed,
    });
    const start = vi.spyOn(node, "start").mockResolvedValue(undefined);
    const finish = (node as unknown as { finishBattle(value: "victory"): void }).finishBattle;

    finish.call(node, "victory");
    await vi.waitFor(() => expect(terminalState(node).completed).toBe("victory"));

    expect(start).toHaveBeenCalledOnce();
    expect((node as unknown as { onCommittedTerminal: unknown }).onCommittedTerminal).toBeDefined();
    expect(committed).not.toHaveBeenCalled();
    expect((node as unknown as { terminalExit: { dispatch(value: "victory"): boolean } }).terminalExit.dispatch("victory"))
      .toBe(false);
    expect(nodeDisposed(node)).toBe(false);
    node.destroy();
  });

  it("retries a rejected production handoff without rerunning settlement, then notifies once after destruction", async () => {
    let node!: BattleNode;
    let attempts = 0;
    let adopted = false;
    const committed = vi.fn(() => {
      expect(adopted).toBe(true);
      expect(nodeDisposed(node)).toBe(true);
    });
    const retry = vi.fn<() => boolean>();
    node = realTerminalNode({
      onExit: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("handoff unavailable");
        adopted = true;
        node.destroy();
      },
      onExitFailure: (_outcome, _error, retryExit) => {
        retry.mockImplementation(() => retryExit());
        queueMicrotask(() => { retry(); });
      },
      onCommittedTerminal: committed,
    });

    finishRealTerminal(node, "victory");
    await vi.waitFor(() => expect(terminalState(node).completed).toBe("victory"));

    expect(attempts).toBe(2);
    expect(retry).toHaveBeenCalledOnce();
    expect(committed).toHaveBeenCalledOnce();
  });

  it.each(["throws synchronously", "rejects asynchronously"] as const)(
    "does not retry a successful handoff when the committed notification %s",
    async (failure) => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      let handoffCalls = 0;
      let notificationCalls = 0;
      const node = realTerminalNode({
        onExit: () => { handoffCalls += 1; },
        onCommittedTerminal: () => {
          notificationCalls += 1;
          if (failure === "throws synchronously") throw new Error("observer throw");
          return Promise.reject(new Error("observer rejection"));
        },
      });
      finishRealTerminal(node, "victory");
      await vi.waitFor(() => expect(terminalState(node).completed).toBe("victory"));
      await vi.waitFor(() => expect(errors).toHaveBeenCalled());
      expect(handoffCalls).toBe(1);
      expect(notificationCalls).toBe(1);
      expect(terminalDispatch(node, "victory")).toBe(false);
      errors.mockRestore();
      node.destroy();
    },
  );

  it.each(["local", "official"] as const)(
    "adopts %s terminal state before the committed notification boundary",
    async (owner) => {
      let node!: BattleNode;
      let localSettled = false;
      let officialAdopted = false;
      const committed = vi.fn(() => {
        expect(owner === "local" ? localSettled : officialAdopted).toBe(true);
        expect(nodeDisposed(node)).toBe(true);
      });
      node = realTerminalNode({
        onExit: async () => {
          if (owner === "local") localSettled = true;
          else officialAdopted = true;
          node.destroy();
        },
        onCommittedTerminal: committed,
      });
      finishRealTerminal(node, "victory");
      await vi.waitFor(() => expect(terminalState(node).completed).toBe("victory"));
      expect(committed).toHaveBeenCalledOnce();
    },
  );

  it.each(["retreat", "defeat"] as const)(
    "keeps the dungeon reporter silent for %s",
    async (outcome) => {
      const diagnostics: unknown[] = [];
      const report = createDungeonBattleLifecycleDiagnosticReporter(
        {
          id: `report-${outcome}`,
          winEvent: { className: "UnsupportedWinEvent", data: {} },
          achievement: "UnsupportedAchievement",
        },
        (diagnostic) => diagnostics.push(diagnostic),
      );
      const node = realTerminalNode({
        onExit: async () => undefined,

        onCommittedTerminal: (committed) => {
          if (committed !== "saveMe") report(committed);
        },
      });
      finishRealTerminal(node, outcome);
      await vi.waitFor(() => expect(terminalState(node).completed).toBe(outcome));
      expect(diagnostics).toEqual([]);
      node.destroy();
    },
  );

  it("clears a rejected exit latch, retries the same outcome, and suppresses later duplicates", async () => {
    let fail = true;
    let attempts = 0;
    const errors: unknown[] = [];
    const exit = createRetryableTerminalExit(async (outcome) => {
      expect(outcome).toBe("retreat");
      attempts += 1;
      if (fail) {
        fail = false;
        throw new Error("route callback unavailable");
      }
    }, (error) => errors.push(error));

    expect(exit.dispatch("retreat")).toBe(true);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(exit.inFlight).toBeUndefined();
    expect(exit.completed).toBeUndefined();

    expect(exit.dispatch("retreat")).toBe(true);
    await vi.waitFor(() => expect(exit.completed).toBe("retreat"));
    expect(exit.dispatch("retreat")).toBe(false);
    expect(attempts).toBe(2);
  });

  it("retries a rejected checkpoint through the BattleNode terminal popup action", async () => {
    let rejectCheckpoint = true;
    let checkpointAttempts = 0;
    let dungeonCommitted = false;
    let questCommitted = false;
    let cacheCommitted = false;
    const node = Object.create(BattleNode.prototype) as unknown as {
      terminalExit: ReturnType<typeof createRetryableTerminalExit>;
      terminalRetryOutcome: "retreat" | undefined;
      lastTerminalExitOutcome: "retreat" | undefined;
      activeTerminalRetryPopup: { readonly isDismissed: boolean; dismiss(): void } | undefined;
      lifecycle: { readonly disposed: boolean };
      scene: Container;
      monsterHatchEnvironment(parent: Container): object;
      finishBattle(outcome: "retreat"): void;
      showTerminalExitRetryPopup(): Promise<void>;
      retryTerminalExit(): boolean;
    };
    node.lifecycle = { disposed: false };
    node.scene = new Container();
    node.terminalRetryOutcome = undefined;
    node.lastTerminalExitOutcome = undefined;
    node.activeTerminalRetryPopup = undefined;
    node.monsterHatchEnvironment = () => ({});
    node.terminalExit = createRetryableTerminalExit(async () => {
      checkpointAttempts += 1;
      if (rejectCheckpoint) {
        rejectCheckpoint = false;
        throw new Error("checkpoint rejected");
      }
      dungeonCommitted = true;
      questCommitted = true;
      cacheCommitted = true;
    }, (error) => {
      expect(error).toMatchObject({ message: "checkpoint rejected" });
      node.terminalRetryOutcome = node.lastTerminalExitOutcome;
      void node.showTerminalExitRetryPopup();
    });

    node.finishBattle("retreat");
    await vi.waitFor(() => expect(popupHarness.calls).toHaveLength(1));
    expect(popupHarness.calls[0]!.buttons.map(({ label }) => label)).toEqual(["Retry"]);
    expect({ dungeonCommitted, questCommitted, cacheCommitted }).toEqual({
      dungeonCommitted: false,
      questCommitted: false,
      cacheCommitted: false,
    });

    popupButton(0, "Retry").onPress();
    await vi.waitFor(() => expect(node.terminalExit.completed).toBe("retreat"));
    expect(checkpointAttempts).toBe(2);
    expect({ dungeonCommitted, questCommitted, cacheCommitted }).toEqual({
      dungeonCommitted: true,
      questCommitted: true,
      cacheCommitted: true,
    });
  });

  it.each(["victory", "retreat", "defeat"] as const)(
    "uses the actual Retry action to resume a committed %s continuation without re-settlement",
    async (outcome) => {
    let continuationFailed = true;
    let settlementCalls = 0;
    let continuationCalls = 0;
    let terminalCommitted = false;
    const node = Object.create(BattleNode.prototype) as unknown as {
      terminalExit: ReturnType<typeof createRetryableTerminalExit>;
      terminalRetryOutcome: "victory" | "retreat" | "defeat" | undefined;
      lastTerminalExitOutcome: "victory" | "retreat" | "defeat" | undefined;
      activeTerminalRetryPopup: { readonly isDismissed: boolean; dismiss(): void } | undefined;
      lifecycle: { readonly disposed: boolean };
      scene: Container;
      monsterHatchEnvironment(parent: Container): object;
      finishBattle(outcome: "victory" | "retreat" | "defeat"): void;
      showTerminalExitRetryPopup(): Promise<void>;
    };
    node.lifecycle = { disposed: false };
    node.scene = new Container();
    node.terminalRetryOutcome = undefined;
    node.lastTerminalExitOutcome = undefined;
    node.activeTerminalRetryPopup = undefined;
    node.monsterHatchEnvironment = () => ({});
    node.terminalExit = createRetryableTerminalExit(async () => {
      if (!terminalCommitted) {
        settlementCalls += 1;
        terminalCommitted = true;
      }
      continuationCalls += 1;
      if (continuationFailed) {
        continuationFailed = false;
        throw new Error("battle return scene unavailable");
      }
    }, (error) => {
      expect(error).toMatchObject({ message: "battle return scene unavailable" });
      node.terminalRetryOutcome = node.lastTerminalExitOutcome;
      void node.showTerminalExitRetryPopup();
    });

    node.finishBattle(outcome);
    await vi.waitFor(() => expect(popupHarness.calls).toHaveLength(1));
    popupButton(0, "Retry").onPress();
    await vi.waitFor(() => expect(node.terminalExit.completed).toBe(outcome));

    expect({ settlementCalls, continuationCalls }).toEqual({ settlementCalls: 1, continuationCalls: 2 });
    },
  );
});

function realTerminalNode(deps: {
  readonly onExit?: BattleNodeDepsForTest["onExit"];
  readonly onExitFailure?: BattleNodeDepsForTest["onExitFailure"];
  readonly onCommittedTerminal?: BattleNodeDepsForTest["onCommittedTerminal"];
}): BattleNode {
  const stage = {
    root: new Container(),
    app: {
      stage: new Container(),
      screen: { width: 960, height: 640 },
      ticker: { add: vi.fn(), remove: vi.fn() },
    },
  };
  const keyboard = { register: vi.fn(() => () => undefined) };
  const base = {
    stage: stage as never,
    game: {} as never,
    audio: { playSfx: vi.fn() } as never,
    keyboard: keyboard as never,
    encounter: {
      backgroundKey: "CaveCombat",
      blockSaveMe: true,
      playerTeam: [{ shortType: "Testling", level: 1 }],
      enemyTeam: [{ shortType: "Testling", level: 1 }],
    },
    playerState: {
      collection: {} as never,
      profile: { battleStatBonuses: () => ({}) } as never,
    },
  } satisfies Omit<BattleNodeDepsForTest, "onExit" | "onExitFailure" | "onCommittedTerminal">;
  return new BattleNode({
    ...base,
    ...(deps.onExit === undefined ? {} : { onExit: deps.onExit }),
    ...(deps.onExitFailure === undefined ? {} : { onExitFailure: deps.onExitFailure }),
    ...(deps.onCommittedTerminal === undefined ? {} : { onCommittedTerminal: deps.onCommittedTerminal }),
  });
}

type BattleNodeDepsForTest = ConstructorParameters<typeof BattleNode>[0];

function finishRealTerminal(node: BattleNode, outcome: "victory" | "retreat" | "defeat" | "saveMe"): void {
  (node as unknown as { finishBattle(value: typeof outcome): void }).finishBattle(outcome);
}

function terminalState(node: BattleNode): {
  readonly completed: "victory" | "retreat" | "defeat" | "saveMe" | undefined;
} {
  return (node as unknown as {
    terminalExit: { readonly completed: "victory" | "retreat" | "defeat" | undefined };
  }).terminalExit;
}

function terminalDispatch(node: BattleNode, outcome: "victory" | "retreat" | "defeat" | "saveMe"): boolean {
  return (node as unknown as {
    terminalExit: { dispatch(value: typeof outcome): boolean };
  }).terminalExit.dispatch(outcome);
}

function nodeDisposed(node: BattleNode): boolean {
  return (node as unknown as { lifecycle: { readonly disposed: boolean } }).lifecycle.disposed;
}

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

vi.mock("../src/ui/monsterHatchPopup.js", () => ({
  buildLocalizedMonsterHatchMessageContent: (
    strings: Readonly<Record<string, string>>,
    name: string,
  ) => ({ message: strings[`${name}MessageKey`] }),
  buildMonsterHatchMessageContent: (message: string) => ({ message }),
  showMonsterHatchPopup: async (
    _environment: unknown,
    options: {
      readonly title?: string;
      readonly content: { readonly message: string };
      readonly buttons?: ReadonlyArray<{
        readonly label: string;
        readonly onPress: () => void | Promise<void>;
      }>;
    },
  ) => {
    popupHarness.calls.push({
      title: options.title,
      content: options.content,
      buttons: options.buttons ?? [],
    });
    popupHarness.events.push(`popup:${options.content.message}`);
    return { isDismissed: false, visible: true, dismiss: () => undefined };
  },
}));

const LOSS_STRINGS = {
  AllDeadTitleKey: "Defeated",
  AllDeadMessageKey: "Return to town.",
  AllDeadSaveMeMessageKey: "Spend %d gold to recover?",
  NotEnoughGoldTitleKey: "Not Enough Gold",
  NotEnoughGoldMessageKey: "You do not have enough gold.",
  OkButtonKey: "OK",
  YesButtonKey: "Yes",
  NoButtonKey: "No",
} as const;

interface DefeatRecoveryHarness {
  readonly adapter: DefeatRecoveryAdapter;
  readonly canOffer: ReturnType<typeof vi.fn>;
  readonly markTutorialSeen: ReturnType<typeof vi.fn>;
  readonly acceptSaveMe: ReturnType<typeof vi.fn>;
  readonly openGoldStore: ReturnType<typeof vi.fn>;
}

interface LossNodeHarness {
  readonly finishBattle: ReturnType<typeof vi.fn>;
  readonly showLostCaptures: ReturnType<typeof vi.fn>;
  destroy(): void;
  showReturnToTownPopup(): Promise<void>;
}

function defeatRecoveryHarness(input?: {
  readonly canOffer?: boolean;
  readonly accepted?: ReadonlyArray<"saved" | "insufficient-funds">;
  readonly markTutorialSeen?: () => void | Promise<void>;
  readonly acceptSaveMe?: () => Promise<"saved" | "insufficient-funds">;
  readonly openGoldStore?: () =>
    | { readonly closed: Promise<void> }
    | Promise<{ readonly closed: Promise<void> }>;
}): DefeatRecoveryHarness {
  const accepted = [...(input?.accepted ?? ["saved"])] as Array<"saved" | "insufficient-funds">;
  const canOffer = vi.fn(() => input?.canOffer ?? true);
  const markTutorialSeen = vi.fn(input?.markTutorialSeen ?? (() => undefined));
  const acceptSaveMe = vi.fn(async () => {
    if (input?.acceptSaveMe !== undefined) return input.acceptSaveMe();
    const result = accepted.shift();
    if (result === undefined) throw new Error("Unexpected Save Me acceptance attempt");
    return result;
  });
  const openGoldStore = vi.fn(async () => {
    return await input?.openGoldStore?.() ?? { closed: Promise.resolve() };
  });
  return {
    adapter: { canOffer, markTutorialSeen, acceptSaveMe, openGoldStore },
    canOffer,
    markTutorialSeen,
    acceptSaveMe,
    openGoldStore,
  };
}

function lossNode(
  blockSaveMe: boolean,
  defeatRecovery?: DefeatRecoveryAdapter,
): LossNodeHarness {
  const node = Object.create(BattleNode.prototype) as unknown as {
    encounter: { readonly blockSaveMe: boolean };
    defeatRecovery?: DefeatRecoveryAdapter;
    game: { readonly strings: typeof LOSS_STRINGS };
    scene: Container | undefined;
    activePostBattlePopup: unknown;
    postBattlePopupKind: string | null;
    lifecycle: { disposed: boolean; dispose(): void };
    notifyEnterTransitionDidFinish(): void;
    disposeActingCardStatusOverlays(): void;
    monsterHatchEnvironment(parent: object): object;
    finishBattle: ReturnType<typeof vi.fn>;
    showLostCaptures: ReturnType<typeof vi.fn>;
    destroy(): void;
    showReturnToTownPopup(): Promise<void>;
  };
  node.encounter = { blockSaveMe };
  if (defeatRecovery !== undefined) node.defeatRecovery = defeatRecovery;
  node.game = { strings: LOSS_STRINGS };
  node.scene = new Container();
  node.activePostBattlePopup = undefined;
  node.postBattlePopupKind = null;
  node.lifecycle = {
    disposed: false,
    dispose() { this.disposed = true; },
  };
  node.notifyEnterTransitionDidFinish = vi.fn();
  node.disposeActingCardStatusOverlays = vi.fn();
  node.monsterHatchEnvironment = () => ({});
  node.finishBattle = vi.fn();
  node.showLostCaptures = vi.fn(async () => {
    popupHarness.events.push("lost-captures");
  });
  return node;
}

function popupButton(callIndex: number, label: string) {
  const button = popupHarness.calls[callIndex]?.buttons.find((candidate) => candidate.label === label);
  if (button === undefined) throw new Error(`Popup ${callIndex} omitted ${label}`);
  return button;
}

beforeEach(() => {
  popupHarness.calls.length = 0;
  popupHarness.events.length = 0;
});






describe("pacingDelayMs (state-1 turn-start pacing)", () => {
  it("friendly (team 0) turn start adds +1.0s", () => {
    expect(pacingDelayMs(0)).toBe(1000);
    expect(PACING_FRIENDLY_MS).toBe(1000);
  });
  it("enemy (team 1) turn start adds +2.25s", () => {
    expect(pacingDelayMs(1)).toBe(2250);
    expect(PACING_ENEMY_MS).toBe(2250);
  });

  it("treats Save Me as a neutral terminal handoff, leaving the host to choose its lifecycle", async () => {
    const exits: string[] = [];
    const node = realTerminalNode({
      onExit: async (outcome) => {
        exits.push(outcome);
      },
    });

    finishRealTerminal(node, "saveMe");
    await vi.waitFor(() => expect(terminalState(node).completed).toBe("saveMe"));

    expect(exits).toEqual(["saveMe"]);
    expect(nodeDisposed(node)).toBe(false);
    node.destroy();
  });

});

describe("removalLogicHoldMs (notifyLivingRemoved logic gate)", () => {
  it("adds the source 0.5 second hold once per removed living", () => {
    expect(REMOVED_LIVING_LOGIC_HOLD_MS).toBe(500);
    expect(removalLogicHoldMs(0)).toBe(0);
    expect(removalLogicHoldMs(1)).toBe(500);
    expect(removalLogicHoldMs(3)).toBe(1500);
  });

  it("rejects invalid event counts", () => {
    expect(() => removalLogicHoldMs(-1)).toThrow(/invalid removed-living count/);
    expect(() => removalLogicHoldMs(1.5)).toThrow(/invalid removed-living count/);
  });
});

describe("timeDelayGateFrames / timeDelayResidueMs (raw update: gate @ 0xc4b38..0xc4b52)", () => {
  const FRAME = 1000 / 60;

  it("costs the extra dispatch frame the `ble`-then-return shape forces", () => {



    expect(timeDelayGateFrames(2500, FRAME)).toBe(151);
    expect(timeDelayGateFrames(1000, FRAME)).toBe(61);
    expect(timeDelayGateFrames(500, FRAME)).toBe(31);
    expect(timeDelayGateFrames(2250, FRAME)).toBe(136);
  });

  it("dispatches on the very next frame when the ivar is already spent", () => {
    expect(timeDelayGateFrames(0, FRAME)).toBe(1);
    expect(timeDelayGateFrames(-4, FRAME)).toBe(1);
  });

  it("retains the overshoot as a negative residue instead of clamping to zero", () => {

    expect(timeDelayResidueMs(2500, FRAME)).toBeCloseTo(0, 9);
    expect(timeDelayResidueMs(1000, FRAME)).toBeCloseTo(1000 - 61 * FRAME + FRAME, 9);
    expect(timeDelayResidueMs(1000, 17)).toBeCloseTo(1000 - 59 * 17, 9);
    expect(timeDelayResidueMs(1000, 17)).toBeLessThan(0);
  });

  it("self-corrects across a battle instead of accumulating a per-gate rounding error", () => {
    // Twenty consecutive 1.0s pacings on a frame size that divides badly. Because the residue
    // carries, total elapsed tracks the nominal sum; independently-rounded timers would drift
    // by up to a frame each.
    const frameMs = 17;
    const gates = 20;
    let residue = 0;
    let frames = 0;
    for (let i = 0; i < gates; i++) {
      const pending = 1000 + residue;
      frames += timeDelayGateFrames(pending, frameMs);
      residue = timeDelayResidueMs(pending, frameMs);
    }
    const elapsed = frames * frameMs;
    const nominal = gates * 1000;
    const dispatchOverhead = gates * frameMs; // the one unavoidable extra frame per dispatch
    // Carried residue keeps the rounding error bounded by a SINGLE frame no matter how many
    // gates run.
    const carriedDrift = elapsed - nominal - dispatchOverhead;
    expect(carriedDrift).toBeGreaterThanOrEqual(0);
    expect(carriedDrift).toBeLessThan(frameMs);

    // A per-gate timer that discards its overshoot drifts by ceil-rounding EVERY gate, so its
    // error grows with the gate count and is unbounded over a run.
    const naiveDrift = gates * Math.ceil(1000 / frameMs) * frameMs - nominal;
    expect(naiveDrift).toBe(gates * (Math.ceil(1000 / frameMs) * frameMs - 1000));
    expect(naiveDrift).toBeGreaterThan(carriedDrift + frameMs * 2);
  });

  it("rejects a non-finite pending value or a non-positive frame size", () => {
    expect(() => timeDelayGateFrames(Number.NaN, FRAME)).toThrow(/invalid timeDelay/);
    expect(() => timeDelayGateFrames(1000, 0)).toThrow(/invalid frame size/);
    expect(() => timeDelayResidueMs(Number.POSITIVE_INFINITY, FRAME)).toThrow(/invalid timeDelay/);
    expect(() => timeDelayResidueMs(1000, -1)).toThrow(/invalid frame size/);
  });
});

describe("terminalPacingDelayMs (state-1 pacing survives the terminal advance)", () => {
  it("still charges the ordinary team-keyed pacing on the winning turn", () => {

    expect(terminalPacingDelayMs(0)).toBe(PACING_FRIENDLY_MS);
    expect(terminalPacingDelayMs(1)).toBe(PACING_ENEMY_MS);
  });

  it("adds nothing when the queue has no front left", () => {
    expect(terminalPacingDelayMs(undefined)).toBe(0);
  });
});

describe("terminalPresentationDelayMs (raw state-4/state-5 timing)", () => {
  it("combines the 1.0 second award-state hold with every victory removal and the pacing", () => {
    expect(VICTORY_AWARD_STATE_HOLD_MS).toBe(1000);


    expect(terminalPresentationDelayMs(0, 0, 0)).toBe(2000);
    expect(terminalPresentationDelayMs(0, 1, 0)).toBe(2500);
    expect(terminalPresentationDelayMs(0, 3, 0)).toBe(3500);
  });

  it("charges the 2.25 second pacing when a non-team-0 living still fronts the queue", () => {


    expect(terminalPresentationDelayMs(0, 1, 1)).toBe(3750);
  });

  it("omits the pacing entirely for an empty post-advance queue", () => {
    expect(terminalPresentationDelayMs(0, 1, undefined)).toBe(1500);
  });

  it("keeps defeat on Encounter's independent 1.5 second callback", () => {
    // State 5 has no BattleNode body and `performLooseLogic` is a scheduler action, so neither the
    // removal holds nor state 1's pacing can gate it.
    expect(DEFEAT_LOGIC_DELAY_MS).toBe(1500);
    expect(terminalPresentationDelayMs(1, 0, 0)).toBe(1500);
    expect(terminalPresentationDelayMs(1, 3, 1)).toBe(1500);
    expect(terminalPresentationDelayMs(1, 3, undefined)).toBe(1500);
  });
});

describe("sceneManifest (battle-node.md scene-tree table)", () => {
  const manifest = sceneManifest();
  const byKey = new Map<string, SceneChild>(manifest.map((c) => [c.key, c]));

  it("declares every documented BattleNode child with its cited z-order", () => {
    expect(byKey.get("background")!.z).toBe(-999);
    expect(byKey.get("enemyTeamDisplay")!.z).toBe(1);
    expect(byKey.get("turnOrderDisplay")!.z).toBe(2);
    expect(byKey.get("friendlyTeamDisplay")!.z).toBe(3);
    expect(byKey.get("monsterTurnPanel")!.z).toBe(3);
    expect(byKey.get("abilityRenderer")!.z).toBe(10);
    expect(byKey.get("statusText")!.z).toBe(11);
  });

  it("puts the dynamic friendly attack spotlight at BattleNode z=2 below the friendly team z=3", () => {
    expect(FRIENDLY_ATTACK_SPOTLIGHT_Z).toBe(2);
    expect(FRIENDLY_ATTACK_SPOTLIGHT_Z).toBeLessThan(byKey.get("friendlyTeamDisplay")!.z);
  });

  it("paints back-to-front in the binary's add order", () => {
    expect(manifest.map((c) => c.z)).toEqual([-999, 1, 2, 3, 3, 10, 11]);
  });

  it("background: Cocos (-16,-32), anchor (0,0), forced 512x384pt rect", () => {
    const bg = byKey.get("background")!;
    expect(bg.posCocos).toEqual(BACKGROUND_POS_COCOS);
    expect(BACKGROUND_POS_COCOS).toEqual({ x: -16, y: -32 });
    expect(bg.anchorCocos).toEqual({ x: 0, y: 0 });
    expect(bg.sizePt).toEqual(BACKGROUND_SIZE);
    expect(BACKGROUND_SIZE).toEqual({ w: 512, h: 384 });
  });

  it("turnOrderDisplay: Cocos (0, winSize.height-5) = (0,315)", () => {
    expect(byKey.get("turnOrderDisplay")!.posCocos).toEqual(TURN_ORDER_POS_COCOS);
    expect(TURN_ORDER_POS_COCOS).toEqual({ x: 0, y: 315 });
  });

  it("background forced texture rect is the disasm's {0,0,1024,768} pixels", () => {
    expect(BACKGROUND_TEXTURE_RECT_PX).toEqual({ x: 0, y: 0, w: 1024, h: 768 });
    // rect / CSF=2 is exactly the forced point size.
    expect(BACKGROUND_TEXTURE_RECT_PX.w / 2).toBe(BACKGROUND_SIZE.w);
    expect(BACKGROUND_TEXTURE_RECT_PX.h / 2).toBe(BACKGROUND_SIZE.h);
  });

  it("backgroundPosCocos reproduces the iPhone immediates at 480x320 and centers on iPad's 512x384", () => {
    expect(backgroundPosCocos(480, 320)).toEqual(BACKGROUND_POS_COCOS);
    // Experimental iPad mode: the 512x384pt rect exactly fills the canvas.
    expect(backgroundPosCocos(512, 384)).toEqual({ x: 0, y: 0 });
  });

  it("turnOrderPosCocos reproduces the cited winSize.height-5 form", () => {
    expect(turnOrderPosCocos(320)).toEqual(TURN_ORDER_POS_COCOS);
    expect(turnOrderPosCocos(384)).toEqual({ x: 0, y: 379 });
  });

  it("MonsterTurnPanel is lazy (created on player turns only); self-laid children carry no posCocos", () => {
    expect(byKey.get("monsterTurnPanel")!.lazy).toBe(true);
    expect(byKey.get("enemyTeamDisplay")!.posCocos).toBeNull();
    expect(byKey.get("friendlyTeamDisplay")!.posCocos).toBeNull();
    expect(byKey.get("abilityRenderer")!.posCocos).toBeNull();
    expect(byKey.get("statusText")!.posCocos).toBeNull();
  });
});

describe("BattleNode defeat recovery presentation", () => {
  it("uses ordinary defeat for blocked encounters without requiring a recovery adapter", async () => {
    const node = lossNode(true);

    await node.showReturnToTownPopup();

    expect(popupHarness.calls).toHaveLength(1);
    expect(popupHarness.calls[0]).toMatchObject({
      title: "Defeated",
      content: { message: "Return to town." },
      buttons: [{ label: "OK" }],
    });
    expect(popupHarness.events).toEqual(["popup:Return to town.", "lost-captures"]);
    expect(node.showLostCaptures).toHaveBeenCalledTimes(1);

    await popupButton(0, "OK").onPress();
    expect(node.finishBattle).toHaveBeenCalledWith("defeat");
  });

  it("uses ordinary defeat when the injected adapter says the offer is ineligible", async () => {
    const recovery = defeatRecoveryHarness({ canOffer: false });
    const node = lossNode(false, recovery.adapter);

    await node.showReturnToTownPopup();

    expect(recovery.canOffer).toHaveBeenCalledTimes(1);
    expect(recovery.markTutorialSeen).not.toHaveBeenCalled();
    expect(popupHarness.calls[0]).toMatchObject({
      content: { message: "Return to town." },
      buttons: [{ label: "OK" }],
    });
    expect(node.showLostCaptures).toHaveBeenCalledTimes(1);
  });

  it("rejects an unblocked encounter that omits the required recovery adapter", async () => {
    const node = lossNode(false);

    await expect(node.showReturnToTownPopup()).rejects.toThrow(/defeatRecovery adapter/);
    expect(popupHarness.calls).toHaveLength(0);
    expect(node.showLostCaptures).not.toHaveBeenCalled();
  });

  it("tears down Tournament combat displays silently before the source loss chat", () => {
    const clearStatusText = vi.fn();
    const playSfx = vi.fn();
    const node = Object.create(BattleNode.prototype) as unknown as {
      statusText: { clearStatusText(): void };
      friendlyDisplay: { visible: boolean };
      enemyDisplay: { visible: boolean };
      effectLayer: { visible: boolean };
      audio: { playSfx(name: string): void };
      teardownCombatMonstersForReturn(): void;
    };
    node.statusText = { clearStatusText };
    node.friendlyDisplay = { visible: true };
    node.enemyDisplay = { visible: true };
    node.effectLayer = { visible: true };
    node.audio = { playSfx };

    node.teardownCombatMonstersForReturn();

    expect(clearStatusText).toHaveBeenCalledOnce();
    expect(node.friendlyDisplay.visible).toBe(false);
    expect(node.enemyDisplay.visible).toBe(false);
    expect(node.effectLayer.visible).toBe(false);
    expect(playSfx).not.toHaveBeenCalled();
  });

  it("awaits the tutorial claim before mounting the formatted Save Me choice and lost captures", async () => {
    let releaseTutorial!: () => void;
    const tutorialClaimed = new Promise<void>((resolve) => { releaseTutorial = resolve; });
    const recovery = defeatRecoveryHarness({
      markTutorialSeen: async () => {
        popupHarness.events.push("tutorial-seen");
        await tutorialClaimed;
      },
    });
    const node = lossNode(false, recovery.adapter);

    const showing = node.showReturnToTownPopup();
    await Promise.resolve();
    expect(popupHarness.events).toEqual(["tutorial-seen"]);
    expect(popupHarness.calls).toHaveLength(0);

    releaseTutorial();
    await showing;

    expect(popupHarness.calls[0]).toMatchObject({
      title: "Defeated",
      content: { message: "Spend 100 gold to recover?" },
      buttons: [{ label: "Yes" }, { label: "No" }],
    });
    expect(popupHarness.events).toEqual([
      "tutorial-seen",
      "popup:Spend 100 gold to recover?",
      "lost-captures",
    ]);
    expect(node.showLostCaptures).toHaveBeenCalledTimes(1);
  });

  it("does not resume loss presentation after destruction while the tutorial claim is pending", async () => {
    let releaseTutorial!: () => void;
    const tutorialClaimed = new Promise<void>((resolve) => { releaseTutorial = resolve; });
    const recovery = defeatRecoveryHarness({
      markTutorialSeen: () => tutorialClaimed,
    });
    const node = lossNode(false, recovery.adapter);

    const showing = node.showReturnToTownPopup();
    await Promise.resolve();
    expect(recovery.markTutorialSeen).toHaveBeenCalledTimes(1);

    node.destroy();
    releaseTutorial();
    await showing;

    expect(popupHarness.calls).toHaveLength(0);
    expect(node.showLostCaptures).not.toHaveBeenCalled();
    expect(node.finishBattle).not.toHaveBeenCalled();
  });

  it("routes Save Me decline to ordinary defeat", async () => {
    const recovery = defeatRecoveryHarness();
    const node = lossNode(false, recovery.adapter);
    await node.showReturnToTownPopup();

    await popupButton(0, "No").onPress();

    expect(node.finishBattle).toHaveBeenCalledTimes(1);
    expect(node.finishBattle).toHaveBeenCalledWith("defeat");
    expect(recovery.acceptSaveMe).not.toHaveBeenCalled();
  });

  it("routes a successful Save Me transaction through the neutral Save Me exit", async () => {
    const recovery = defeatRecoveryHarness({ accepted: ["saved"] });
    const node = lossNode(false, recovery.adapter);
    await node.showReturnToTownPopup();

    const action = popupButton(0, "Yes").onPress();

    expect(action).toBeUndefined();
    await vi.waitFor(() => expect(node.finishBattle).toHaveBeenCalledWith("saveMe"));
    expect(node.finishBattle).not.toHaveBeenCalledWith("retreat");
    expect(recovery.acceptSaveMe).toHaveBeenCalledTimes(1);
    expect(recovery.openGoldStore).not.toHaveBeenCalled();
  });

  it.each(["saved", "insufficient-funds"] as const)(
    "does not resume the %s payment branch after destruction while payment is pending",
    async (result) => {
      let settlePayment!: (value: "saved" | "insufficient-funds") => void;
      const payment = new Promise<"saved" | "insufficient-funds">((resolve) => {
        settlePayment = resolve;
      });
      const recovery = defeatRecoveryHarness({ acceptSaveMe: () => payment });
      const node = lossNode(false, recovery.adapter);
      await node.showReturnToTownPopup();

      expect(popupButton(0, "Yes").onPress()).toBeUndefined();
      await vi.waitFor(() => expect(recovery.acceptSaveMe).toHaveBeenCalledTimes(1));

      node.destroy();
      settlePayment(result);
      await payment;
      await Promise.resolve();
      await Promise.resolve();

      expect(node.finishBattle).not.toHaveBeenCalled();
      expect(recovery.openGoldStore).not.toHaveBeenCalled();
      expect(popupHarness.calls).toHaveLength(1);
    },
  );

  it("awaits Store mount before NotEnoughGold, then re-presents loss only after Store close", async () => {
    let releaseMount!: () => void;
    const storeMounted = new Promise<void>((resolve) => { releaseMount = resolve; });
    let releaseStore!: () => void;
    const storeClosed = new Promise<void>((resolve) => { releaseStore = resolve; });
    const recovery = defeatRecoveryHarness({
      accepted: ["insufficient-funds"],
      openGoldStore: async () => {
        popupHarness.events.push("gold-store-building");
        await storeMounted;
        popupHarness.events.push("gold-store-mounted");
        return { closed: storeClosed };
      },
    });
    const node = lossNode(false, recovery.adapter);
    await node.showReturnToTownPopup();

    const action = popupButton(0, "Yes").onPress();

    expect(action).toBeUndefined();
    await vi.waitFor(() => expect(recovery.openGoldStore).toHaveBeenCalledTimes(1));
    expect(popupHarness.calls).toHaveLength(1);
    expect(popupHarness.events.slice(-1)).toEqual(["gold-store-building"]);

    releaseMount();
    await vi.waitFor(() => expect(popupHarness.calls).toHaveLength(2));
    expect(recovery.openGoldStore).toHaveBeenCalledTimes(1);
    expect(recovery.acceptSaveMe).toHaveBeenCalledTimes(1);
    expect(popupHarness.calls[1]).toMatchObject({
      title: "Not Enough Gold",
      content: { message: "You do not have enough gold." },
      buttons: [{ label: "OK" }],
    });
    expect(popupHarness.events.slice(-2)).toEqual([
      "gold-store-mounted",
      "popup:You do not have enough gold.",
    ]);
    expect(popupButton(1, "OK").onPress()).toBeUndefined();
    expect(node.finishBattle).not.toHaveBeenCalled();
    expect(node.showLostCaptures).toHaveBeenCalledTimes(1);

    releaseStore();
    await vi.waitFor(() => expect(popupHarness.calls).toHaveLength(3));

    expect(popupHarness.calls[2]).toMatchObject({
      title: "Defeated",
      content: { message: "Spend 100 gold to recover?" },
      buttons: [{ label: "Yes" }, { label: "No" }],
    });
    expect(recovery.acceptSaveMe).toHaveBeenCalledTimes(1);
    expect(recovery.openGoldStore).toHaveBeenCalledTimes(1);
    expect(node.showLostCaptures).toHaveBeenCalledTimes(2);
    expect(popupHarness.events.slice(-2)).toEqual([
      "popup:Spend 100 gold to recover?",
      "lost-captures",
    ]);
  });

  it("does not debit newly bought gold until the player accepts the re-presented offer", async () => {
    let releaseStore!: () => void;
    const storeClosed = new Promise<void>((resolve) => { releaseStore = resolve; });
    const recovery = defeatRecoveryHarness({
      accepted: ["insufficient-funds", "saved"],
      openGoldStore: () => ({ closed: storeClosed }),
    });
    const node = lossNode(false, recovery.adapter);
    await node.showReturnToTownPopup();

    const action = popupButton(0, "Yes").onPress();

    expect(action).toBeUndefined();
    await vi.waitFor(() => expect(popupHarness.calls).toHaveLength(2));
    expect(node.finishBattle).not.toHaveBeenCalled();
    expect(recovery.acceptSaveMe).toHaveBeenCalledTimes(1);

    releaseStore();
    await vi.waitFor(() => expect(popupHarness.calls).toHaveLength(3));

    expect(node.finishBattle).not.toHaveBeenCalled();
    expect(recovery.openGoldStore).toHaveBeenCalledTimes(1);
    expect(recovery.acceptSaveMe).toHaveBeenCalledTimes(1);

    expect(popupButton(2, "Yes").onPress()).toBeUndefined();
    await vi.waitFor(() => expect(node.finishBattle).toHaveBeenCalledWith("saveMe"));
    expect(recovery.acceptSaveMe).toHaveBeenCalledTimes(2);
  });
});


describe("BattleNode turn-order admission order", () => {
  /** Spies that record the sequence of source notification points the column receives, and let
   *  the test hold the addition open the way an in-flight portrait build does. */
  const turnOrderHarness = () => {
    const calls: string[] = [];
    let releaseAdd: () => void = () => undefined;
    const turnOrder = {
      notifyTeamRemovedMonsters: vi.fn((ids: readonly string[]) => {
        calls.push(`removed:${ids.join(",")}`);
        return Promise.resolve();
      }),
      notifyTeamAddedMonsters: vi.fn((ids: readonly string[]) => {
        calls.push(`added:${ids.join(",")}`);
        return new Promise<void>((resolve) => { releaseAdd = resolve; });
      }),
      notifyBattleTimePassed: vi.fn(() => {
        calls.push("battleTime");
        return Promise.resolve();
      }),
    };
    const harness = { turnOrder, lifecycle: { disposed: false } };
    return { calls, harness, turnOrder, release: () => releaseAdd() };
  };

  it("admits removal, then the promoted reserve, and only then the battle-time update", async () => {



    const h = turnOrderHarness();
    const plan = turnOrderResolutionPlan([{ type: "died", living: "gnoll" }]);

    const commit = commitTurnOrderForTurn.call(
      h.harness, plan, ["reserve"], ["fireCub", "snowCub", "reserve"],
    );
    await Promise.resolve();

    // The battle-time update must still be waiting on the addition: racing them is what let the
    // 1.5s front change start first and stranded the joiner at its origin until the 1.0s callback.
    expect(h.calls).toEqual(["removed:gnoll", "added:reserve"]);
    expect(h.turnOrder.notifyTeamAddedMonsters).toHaveBeenCalledWith(["reserve"], {
      projectedOrder: ["fireCub", "snowCub", "reserve"],
    });

    h.release();
    await commit;
    expect(h.calls).toEqual(["removed:gnoll", "added:reserve", "battleTime"]);
  });

  it("presents a switch-out through the same team removal listener a death uses", async () => {
    const h = turnOrderHarness();
    const plan = turnOrderResolutionPlan([
      { type: "switched", out: "benched", in: "joiner", team: 0 },
    ]);

    const commit = commitTurnOrderForTurn.call(h.harness, plan, ["joiner"], ["fireCub", "joiner"]);
    await Promise.resolve();
    h.release();
    await commit;

    expect(h.calls).toEqual(["removed:benched", "added:joiner", "battleTime"]);
    // Uncaptured: the leaver takes the ordinary immediate fall, not the capture hold.
    expect(h.turnOrder.notifyTeamRemovedMonsters).toHaveBeenCalledWith(["benched"], {
      captureSuccessIds: [],
    });
  });

  it("still admits removal and the battle-time update on a turn that adds nobody", async () => {
    const h = turnOrderHarness();
    const plan = turnOrderResolutionPlan([{ type: "died", living: "gnoll" }]);

    await commitTurnOrderForTurn.call(h.harness, plan, [], ["fireCub", "snowCub"]);

    expect(h.calls).toEqual(["removed:gnoll", "battleTime"]);
    expect(h.turnOrder.notifyTeamAddedMonsters).not.toHaveBeenCalled();
  });

  it("drops the battle-time update when the node is disposed while the portrait builds", async () => {
    const h = turnOrderHarness();
    const plan = turnOrderResolutionPlan([{ type: "died", living: "gnoll" }]);

    const commit = commitTurnOrderForTurn.call(h.harness, plan, ["reserve"], ["fireCub", "reserve"]);
    await Promise.resolve();
    h.harness.lifecycle.disposed = true;
    h.release();
    await commit;

    expect(h.calls).toEqual(["removed:gnoll", "added:reserve"]);
    expect(h.turnOrder.notifyBattleTimePassed).not.toHaveBeenCalled();
  });
});


describe("automatic turn instance presentation", () => {
  it.each([0, 1] as const)("forwards the selected job slot for team %i AI", async (team) => {
    const lifecycle = { disposed: false };
    const resolved = { actorId: "dragon", abilityPath: "Offensive.Attack", slot: "usable4", tier: 4, events: [] };
    const playTurn = vi.fn(async () => { lifecycle.disposed = true; });
    const harness = {
      lifecycle, statusText: { hasText: false, waitForAcknowledgment: async () => undefined, clearStatusText: vi.fn() },
      session: { events: [], advanceForPresentation: () => ({ type: "awaitingEnemy", actorId: "dragon", forcedLooseTurn: false }),
        teamOf: () => team, submitEnemyAction: () => resolved },
      applyStatusOverlayEvents: vi.fn(), setPresentationState: vi.fn(), awaitTimeDelay: async () => undefined,
      turnOrder: { initialize: async () => undefined },
      friendlyDisplay: { notifyPlayerTurnStarted: vi.fn(), popForward: async () => undefined },
      startPresentationTask: vi.fn(), playTurn,
    };
    const loop = (BattleNode.prototype as unknown as { loop(this: object): Promise<void> }).loop;
    await loop.call(harness);
    expect(playTurn).toHaveBeenCalledWith([], "dragon", "Offensive.Attack", 4,
      team === 0 ? "none" : "enemyPulse", "usable4");
  });
});
