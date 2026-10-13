import { AudioPlayer } from "../src/audio.js";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "DIB test" },
    });
  }
});
import { Container } from "pixi.js";
import { infiniteDungeonFloorEntry } from "@dib/player-domain";
import { SceneCoordinator } from "../src/sceneCoordinator.js";
import { WorldMenu } from "../src/world/worldMenu.js";
import { EggHatchFlow } from "../src/world/eggHatchFlow.js";
import { DungeonNode, type DungeonNodeDeps } from "../src/dungeon/dungeonNode.js";
import {
  DungeonFeatureController,
  isVolcanoInfiniteDungeonInstance,
  LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC,
  LEADERBOARD_PLATFORM_HOOK_MESSAGE,
  healDungeonPartyMonster,
  officialPendingDungeonEggReward,
  type DungeonFeatureHost,
} from "../src/dungeon/installDungeonFeature.js";

const popupHarness = vi.hoisted(() => ({
  calls: [] as Array<{ parent: Container; retry: () => void | Promise<void> }>,
}));
const battleHarness = vi.hoisted(() => ({
  deps: undefined as Record<string, any> | undefined,
}));

vi.mock("../src/ui/monsterHatchPopup.js", () => ({
  buildMonsterHatchMessageContent: (message: string) => ({ message }),
  showMonsterHatchPopup: async (
    environment: { readonly parent: Container },
    options: { readonly buttons?: ReadonlyArray<{ readonly label: string; readonly onPress: () => void | Promise<void> }> },
  ) => {
    const retry = options.buttons?.find(({ label }) => label === "Retry")?.onPress;
    if (retry === undefined) throw new Error("retry popup was not configured");
    popupHarness.calls.push({ parent: environment.parent, retry });
    return { isDismissed: false, dismiss: vi.fn() };
  },
}));

vi.mock("../src/battle/battleNode.js", async () => {
  const actual = await vi.importActual<typeof import("../src/battle/battleNode.js")>(
    "../src/battle/battleNode.js",
  );
  class TestBattleNode {
    constructor(deps: Record<string, any>) {
      battleHarness.deps = deps;
    }
    setSceneVisible(): void {}
    start(): Promise<never> {
      battleHarness.deps?.onReady();
      return new Promise(() => {});
    }
    notifyEnterTransitionDidFinish(): void {}
    terminalEnemyConstructionIndices(): readonly number[] { return []; }
    capturedShortTypes(): readonly string[] { return []; }
  }
  return { ...actual, BattleNode: TestBattleNode };
});

class TestScene {
  readonly notificationParent = new Container();
  readonly notificationOwner = this;
  visible = false;
  destroyed = false;

  constructor(readonly sceneKind: "battle" | "dungeon") {}

  setSceneVisible(visible: boolean): void { this.visible = visible; }
  renderGameState(): Record<string, unknown> { return { sceneKind: this.sceneKind }; }
  destroy(): void { this.destroyed = true; }
}

function controllerWithScenes(scenes: SceneCoordinator<TestScene, "shell">): DungeonFeatureController<"shell"> {
  return new DungeonFeatureController<"shell">({
    stage: { app: { ticker: {} } } as never,
    game: {} as never,
    audio: {} as never,
    keyboard: {} as never,
    content: { hasDungeonCapability: true } as never,
    scenes: scenes as unknown as DungeonFeatureHost<"shell">["scenes"],
    player: () => undefined as never,
    nextBattleSeed: () => 1,
    nextRunSeed: () => 1,
    checkpoint: () => undefined,
    checkpointAsync: async () => undefined,
    openGoldStore: async () => ({ closed: Promise.resolve() }),
    onWorldExit: () => undefined,
    onDefeat: () => undefined,
    onMainMenu: () => undefined,
    onPresentationChange: () => undefined,
  });
}

describe("DungeonFeatureController terminal retry scene ownership", () => {
  it.each(["battle", "dungeon"] as const)(
    "mounts the controller-owned retry action while %s is current",
    async (kind) => {
      popupHarness.calls.length = 0;
      const scenes = new SceneCoordinator<TestScene, "shell">("shell");
      const scene = new TestScene(kind);
      await scenes.replace(scene);
      const controller = controllerWithScenes(scenes);
      let retries = 0;
      controller.handleAuthoritativeBattleExitFailure(() => { retries += 1; return true; });

      await vi.waitFor(() => expect(popupHarness.calls).toHaveLength(1));
      expect(popupHarness.calls[0]!.parent).toBe(scene.notificationParent);
      popupHarness.calls[0]!.retry();
      expect(retries).toBe(1);
    },
  );

  it("keeps the same retry owner through a real SceneCoordinator activation", async () => {
    popupHarness.calls.length = 0;
    const scenes = new SceneCoordinator<TestScene, "shell">("shell");
    const battle = new TestScene("battle");
    await scenes.replace(battle);
    const controller = controllerWithScenes(scenes);
    const dungeon = new TestScene("dungeon");
    await scenes.replace(dungeon, async ({ activate, retireOutgoing }) => {
      activate();
      retireOutgoing();
    });

    let retries = 0;
    controller.handleAuthoritativeBattleExitFailure(() => { retries += 1; return true; });
    await vi.waitFor(() => expect(popupHarness.calls).toHaveLength(1));
    expect(scenes.current).toBe(dungeon);
    expect(popupHarness.calls[0]!.parent).toBe(dungeon.notificationParent);
    popupHarness.calls[0]!.retry();
    expect(retries).toBe(1);
    expect((controller as unknown as { localTerminalRetryOwner: { hasPending(): boolean } })
      .localTerminalRetryOwner.hasPending()).toBe(false);
  });
});

describe("Official dungeon reconnect battle return", () => {
  it("seeds prior entry presentation and uses battle-return actions for victory and retreat", async () => {
    const controller = controllerWithScenes(new SceneCoordinator<TestScene, "shell">("shell"));
    const treasure = {
      kind: "treasure",
      roomId: "room-1",
      treasure: { id: "guarded-1", guarded: true, loot: [] },
    } as const;
    const claimCurrentFloorPresence = vi.fn(() => true);
    const takeChangedCatchQuestProgress = vi.fn(() => ({ captured: ["Slime"] }));
    const seedCurrentCatchQuestPresentation = vi.fn();
    const enterCurrentRoom = vi.fn(() => [treasure]);
    const returnedNode = {} as DungeonNode;
    const startDungeonScene = vi.fn(async () => returnedNode);
    const privateController = controller as unknown as {
      run: {
        claimCurrentFloorPresence: typeof claimCurrentFloorPresence;
        takeChangedCatchQuestProgress: typeof takeChangedCatchQuestProgress;
        seedCurrentCatchQuestPresentation: typeof seedCurrentCatchQuestPresentation;
        session: {
          state: { definitionId: string; floor: number; currentRoomId: string };
          enterCurrentRoom: typeof enterCurrentRoom;
        };
      };
      insideDungeon: boolean;
      startDungeonScene: typeof startDungeonScene;
    };
    privateController.run = {
      claimCurrentFloorPresence,
      takeChangedCatchQuestProgress,
      seedCurrentCatchQuestPresentation,
      session: {
        state: { definitionId: "Dungeon_1", floor: 3, currentRoomId: "room-1" },
        enterCurrentRoom,
      },
    };
    privateController.insideDungeon = false;
    privateController.startDungeonScene = startDungeonScene;

    controller.prepareAuthoritativeBattleReconnect();
    expect(claimCurrentFloorPresence).toHaveBeenCalledOnce();
    expect(takeChangedCatchQuestProgress).toHaveBeenCalledOnce();

    controller.prepareAuthoritativeBattleReturn({
      schemaVersion: 1,
      battleId: "battle-9",
      outcome: "victory",
      dungeonId: "Dungeon_1",
      floor: 3,
      roomId: "room-1",
      catchTypesBeforeBattle: ["Slime"],
    });
    expect(claimCurrentFloorPresence).toHaveBeenCalledTimes(2);
    expect(seedCurrentCatchQuestPresentation).toHaveBeenCalledWith(["Slime"]);
    expect(() => controller.prepareAuthoritativeBattleReturn({
      schemaVersion: 1,
      battleId: "battle-9",
      outcome: "victory",
      dungeonId: "Dungeon_1",
      floor: 3,
      roomId: "wrong-room",
      catchTypesBeforeBattle: ["Slime"],
    })).toThrow(/disagrees with its prepared run/i);

    await expect(controller.enterPreparedAuthoritativeFromBattle("victory"))
      .resolves.toBe(returnedNode);
    expect(privateController.insideDungeon).toBe(true);
    expect(enterCurrentRoom).toHaveBeenCalledOnce();
    expect(startDungeonScene).toHaveBeenLastCalledWith({
      kind: "battleReturn",
      actions: [treasure],
    });

    await expect(controller.enterPreparedAuthoritativeFromBattle("retreat"))
      .resolves.toBe(returnedNode);
    expect(enterCurrentRoom).toHaveBeenCalledOnce();
    expect(startDungeonScene).toHaveBeenLastCalledWith({
      kind: "battleReturn",
      actions: null,
    });

    await expect(controller.restorePreparedAuthoritativeBattleReturn("victory"))
      .resolves.toBe(returnedNode);
    expect(enterCurrentRoom).toHaveBeenCalledTimes(2);
    expect(startDungeonScene).toHaveBeenLastCalledWith({
      kind: "battleReturn",
      actions: [treasure],
      documentRestore: true,
    });
  });
});

describe("DungeonFeatureController encounter diagnostics", () => {
  function productionEncounterController(onDiagnostic: ReturnType<typeof vi.fn>) {
    const scenes = new SceneCoordinator<any, "shell">("shell");
    const host = {
      stage: { app: { ticker: { add: vi.fn(), remove: vi.fn(), deltaMS: 0 } }, root: new Container() },
      game: {} as never,
      audio: {} as never,
      keyboard: {} as never,
      content: {
        hasDungeonCapability: true,
        combatBackgroundKeys: ["CaveCombat"],
        resources: { has: () => true, plist: () => ({}) },
      },
      scenes,
      player: () => ({
        party: { projectAliveBattingPrefix: () => [{ shortType: "Slime", level: 1 }] },
      }),
      nextBattleSeed: () => 1,
      nextRunSeed: () => 1,
      checkpoint: vi.fn(),
      checkpointAsync: async () => undefined,
      onWorldExit: vi.fn(),
      onDefeat: vi.fn(),
      onMainMenu: vi.fn(),
      onPresentationChange: vi.fn(),
      onDiagnostic,
    } as unknown as DungeonFeatureHost<"shell">;
    const controller = new DungeonFeatureController<"shell">(host);
    const privateController = controller as unknown as {
      run: unknown;
      preloadEncounter: (config: unknown) => Promise<void>;
      startEncounter: (node: DungeonNode, request: unknown) => Promise<void>;
    };
    privateController.run = {};
    vi.spyOn(privateController, "preloadEncounter").mockRejectedValue(new Error("stop before BattleNode"));
    return { controller, privateController };
  }

  const encounterRequest = (startEvent: Record<string, unknown>): unknown => ({
    roomId: "room-1",
    definition: {
      instanceName: "NorthCave",
      presentation: { combatBackgroundFile: "CaveCombat.png" },
    },
    encounter: {
      id: "encounter-1",
      kind: "fixed",
      monsters: [{ type: "Slime", level: 1 }],
      startEvent,
    },
  });

  it("records one unsupported non-chat start event at the production battle seam", async () => {
    const onDiagnostic = vi.fn();
    const { controller, privateController } = productionEncounterController(onDiagnostic);

    await expect(privateController.startEncounter({} as DungeonNode, encounterRequest({
      className: "PlotGameFlowEvent",
      data: { plot: "start" },
    }))).rejects.toThrow("stop before BattleNode");

    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.stringContaining("unsupported start event PlotGameFlowEvent"),
      expect.objectContaining({ code: "opaque-start-event", encounterId: "encounter-1" }),
    );
    expect(controller.diagnosticSnapshot().map(({ code }) => code)).toEqual(["opaque-start-event"]);
  });

  it("does not diagnose a supported ChatGameFlowEvent at the production battle seam", async () => {
    const onDiagnostic = vi.fn();
    const { controller, privateController } = productionEncounterController(onDiagnostic);

    await expect(privateController.startEncounter({} as DungeonNode, encounterRequest({
      className: "ChatGameFlowEvent",
      data: { chatKey: "DungeonStart" },
    }))).rejects.toThrow("stop before BattleNode");

    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(controller.diagnosticSnapshot()).toEqual([]);
  });

});

describe("Official dungeon party adapters", () => {
  it("mirrors the committed injury cost and balance instead of pricing locally", async () => {
    const healPartyMonster = vi.fn();
    const healPartyMonsterAtCost = vi.fn(() => ({ ok: true as const, cost: 7 }));
    const submit = vi.fn(async () => ({
      events: [
        { type: "party.injuryHealed", instanceId: "party-1", goldCost: 7 },
        { type: "player.currencyChanged", currency: "gold", balance: 93 },
      ],
    }));

    await expect(healDungeonPartyMonster(
      { healPartyMonster, healPartyMonsterAtCost } as never,
      { submit } as never,
      "party-1",
      123,
    )).resolves.toEqual({ ok: true, cost: 7 });
    expect(submit).toHaveBeenCalledWith({ type: "party.healInjury", instanceId: "party-1" });
    expect(healPartyMonsterAtCost).toHaveBeenCalledWith("party-1", 7, 93);
    expect(healPartyMonster).not.toHaveBeenCalled();
  });
});

describe("Official dungeon Egg handoff", () => {
  it("derives the presentation token only from the committed continuation", () => {
    expect(officialPendingDungeonEggReward({
      egg: { pendingEgg: () => ({ kind: "silver" }) },
    } as never)).toEqual({ kind: "egg" });
    expect(officialPendingDungeonEggReward({
      egg: { pendingEgg: () => ({ kind: "gold" }) },
    } as never)).toEqual({ kind: "monsterEgg" });
    expect(officialPendingDungeonEggReward({
      egg: { pendingEgg: () => undefined },
    } as never)).toBeUndefined();
  });
});

describe("Dungeon document restore presentation", () => {
  it.each(["restore", "battleReturn"] as const)("reveals %s after preparation but before player-owned loot settlement", async kind => {
    const order: string[] = [];
    let prepared!: () => void, collected!: () => void;
    const preparation = new Promise<void>(resolve => { prepared = resolve; });
    const loot = new Promise<void>(resolve => { collected = resolve; });
    const node = {
      lifecycleSignal: new AbortController().signal, onDestroy: vi.fn(),
      prepareStart: vi.fn(() => preparation),
      start: vi.fn(async () => { order.push("entry"); await loot; }),
    };
    const create = vi.spyOn(DungeonNode, "create").mockResolvedValue(node as unknown as DungeonNode);
    const scenes = { current: undefined as unknown, replace: vi.fn(async (incoming: unknown) => {
      scenes.current = incoming; order.push("activate");
    }) };
    const host = {
      player: () => ({ party: {}, profile: {} }), game: {}, audio: {}, content: { hasDungeonCapability: true }, scenes,
      stage: { app: { ticker: { add: vi.fn(), remove: vi.fn() } } },
      keyboard: { register: vi.fn(() => vi.fn()) }, checkpoint: vi.fn(),
    } as unknown as DungeonFeatureHost<"shell">;
    const controller = new DungeonFeatureController(host) as unknown as {
      run: unknown; startDungeonScene: (entry: object) => Promise<unknown>;
    };
    controller.run = { session: {}, route: {}, definition: {} };
    const ready = vi.fn(async () => { expect(scenes.current).toBe(node); order.push("reveal"); });
    try {
      let finished = false;
      const restoration = controller.startDungeonScene({ kind, actions: [], documentRestore: true, onSceneReady: ready })
        .then(() => { finished = true; });
      await vi.waitFor(() => expect(node.prepareStart).toHaveBeenCalled());
      expect(ready).not.toHaveBeenCalled();
      prepared();
      await vi.waitFor(() => expect(node.start).toHaveBeenCalled());
      expect(order).toEqual(["activate", "reveal", "entry"]);
      expect(finished).toBe(false); // The reward still owns its normal completion boundary.
      collected(); await restoration;
      expect(finished).toBe(true);
    } finally { create.mockRestore(); }
  });
});

describe("Volcano infinite progression proof gate", () => {
  it("proves the production callback/wiring seam for repeated Volcano scenes and excludes other dungeons", async () => {
    // This is the controller-only wiring seam: the durable `infiniteHighestLevel` decision, the
    // checkpoint it triggers, the one-shot banner, and the leaderboard report. The decisive real
    // DungeonNode.create/build/prepareStart/start lifecycle proof (including the corner label)
    // lives in dungeonNodeLifecycle.test.ts, so the label presentation is stubbed here.
    expect(isVolcanoInfiniteDungeonInstance("Volcano")).toBe(true);
    expect(isVolcanoInfiniteDungeonInstance("VolcanoB")).toBe(true);
    expect(isVolcanoInfiniteDungeonInstance("NorthCave")).toBe(false);

    const hostDiagnostic = vi.fn();
    const checkpoint = vi.fn();
    // The real `PlayerProfile.recordInfiniteDungeonFloor` semantics, kept local so the harness does
    // not need a whole profile: the tutorial flag stays unclaimed on purpose, because the source
    // posts the banner outside `showTutorialForFlag:`'s already-claimed early return.
    const banners: unknown[] = [];
    let highest = 0;
    const profile = {
      get infiniteDungeonHighestLevel(): number { return highest; },
      recordInfiniteDungeonFloor: (floor: number) => {
        const entry = infiniteDungeonFloorEntry(highest, floor);
        highest = entry.highestLevel;
        return entry;
      },
      hasTutorialFlag: () => true,
      claimTutorialFlag: () => false,
    };
    const ticker = { add: vi.fn(), remove: vi.fn(), deltaMS: 0 };
    const scenes = new SceneCoordinator<any, "shell">("shell");
    const host = {
      stage: { app: { ticker, screen: { width: 960, height: 640 } }, root: new Container() },
      game: {
        strings: {
          DungeonLevelKey: "Level",
          DungeonMonstersCaughtFormatString: "Caught %d/%d",
          NewInfiniteMonsterSlotTitleKey: "New Monster Slot Unlocked!",
          NewInfiniteMonsterSlotMessageShortKey: "+1 Max Monsters!",
        },
        assets: { audioUrl: (name: string) => name },
      },
      audio: { playMusic: vi.fn(), requestMusic: AudioPlayer.prototype.requestMusic },
      keyboard: { register: vi.fn(() => vi.fn()) },
      content: { hasDungeonCapability: true },
      scenes,
      player: () => ({ party: {}, profile }),
      nextBattleSeed: () => 1,
      nextRunSeed: () => 1,
      checkpoint,
      checkpointAsync: async () => undefined,
      onWorldExit: vi.fn(),
      onDefeat: vi.fn(),
      onMainMenu: vi.fn(),
      onPresentationChange: vi.fn(),
      onDiagnostic: hostDiagnostic,
    } as unknown as DungeonFeatureHost<"shell">;
    const controller = new DungeonFeatureController<"shell">(host);
    const privateController = controller as unknown as {
      run: unknown;
      startDungeonScene: (entry: { readonly kind: "restore" }) => Promise<void>;
    };
    const capturedCallbacks: Array<{
      readonly instanceName: string;
      readonly callback: ReturnType<typeof vi.fn>;
    }> = [];
    const lifecycleEvents: string[] = [];
    vi.spyOn(DungeonNode, "create").mockImplementation(async (deps) => {
      lifecycleEvents.push(`create:${deps.definition.instanceName}`);
      const onDiagnostic = vi.fn((...args: Parameters<NonNullable<DungeonNodeDeps["onDiagnostic"]>>) => {
        lifecycleEvents.push(`diagnostic:${deps.definition.instanceName}`);
        deps.onDiagnostic?.(...args);
      });
      capturedCallbacks.push({ instanceName: deps.definition.instanceName, callback: onDiagnostic });
      const NodeConstructor = DungeonNode as unknown as new (value: DungeonNodeDeps) => DungeonNode;
      const node = new NodeConstructor({ ...deps, onDiagnostic });
      (node as unknown as { prepareStart: () => Promise<void> }).prepareStart = vi.fn(async () => undefined);
      (node as unknown as {
        notifications: {
          showNamePlate: () => void;
          enqueueLocalizedMessage: (state: unknown) => void;
        };
      }).notifications = {
        showNamePlate: vi.fn(),
        enqueueLocalizedMessage: (state: unknown) => { banners.push(state); },
      };
      // The corner label needs a built scene (chrome, atlases, a live ticker); this harness has
      // none. dungeonNodeLifecycle.test.ts drives the real one.
      (node as unknown as {
        presentInfiniteDungeonUnlockLabel: (floor: number) => Promise<void>;
      }).presentInfiniteDungeonUnlockLabel = vi.fn(async () => undefined);
      (node as unknown as { processEntryActions: () => Promise<void> }).processEntryActions =
        vi.fn(async () => undefined);
      (node as unknown as { presentFloorDetectionChat: () => Promise<void> }).presentFloorDetectionChat =
        vi.fn(async () => undefined);
      (node as unknown as { setSceneVisible: (visible: boolean) => void }).setSceneVisible = vi.fn();
      return node;
    });

    const definition = (instanceName: string) => ({
      instanceName,
      sourceFile: instanceName === "NorthCave" ? "Dungeon_1.plist" : "Dungeon_15.plist",
      typeName: "Cave",
      creation: { lastFloor: instanceName === "VolcanoB" ? 999 : 210 },
      presentation: { wallFrameCount: 1, floorFrameCount: 1 },
      floorPopulations: [],
    });
    const setRun = (instanceName: string, floor = 1): void => {
      privateController.run = {
        definition: definition(instanceName),
        route: {
          typeName: "Cave",
          sourceFile: instanceName === "NorthCave" ? "Dungeon_1.plist" : "Dungeon_15.plist",
          floor,
        },
        session: {},
        takeChangedCatchQuestProgress: () => undefined,
      };
    };

    // `host.checkpoint` is shared with the scene-start path, so the durable write is measured as a
    // delta against a scene that provably never writes (the NorthCave entry) rather than a total.
    const checkpointDeltas: number[] = [];
    for (const [instanceName, floor] of [
      ["Volcano", 1],
      ["VolcanoB", 211],
      ["Volcano", 2],
      ["VolcanoB", 212],
      ["NorthCave", 1],
    ] as const) {
      if (scenes.current !== undefined) scenes.clear("shell");
      setRun(instanceName, floor);
      const before = checkpoint.mock.calls.length;
      await privateController.startDungeonScene({ kind: "restore" });
      checkpointDeltas.push(checkpoint.mock.calls.length - before);
    }

    expect(lifecycleEvents.filter((event) => event.startsWith("create:"))).toHaveLength(5);
    expect(lifecycleEvents.filter((event) => event.startsWith("diagnostic:"))).toHaveLength(4);
    for (const instanceName of ["Volcano", "VolcanoB"] as const) {
      const createIndex = lifecycleEvents.findIndex((event) => event === `create:${instanceName}`);
      const diagnosticIndex = lifecycleEvents.findIndex((event) => event === `diagnostic:${instanceName}`);
      expect(createIndex, instanceName).toBeGreaterThanOrEqual(0);
      expect(diagnosticIndex, instanceName).toBeGreaterThan(createIndex);
    }

    expect(LEADERBOARD_PLATFORM_HOOK_MESSAGE).toBe(
      "Dungeon leaderboard/platform score hook is unavailable in this port.",
    );
    expect(LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC).toBe("leaderboard-platform-hook-unavailable");
    expect(hostDiagnostic).toHaveBeenCalledTimes(4);

    for (const instanceName of ["Volcano", "VolcanoB"] as const) {
      const callbacks = capturedCallbacks.filter((entry) => entry.instanceName === instanceName);
      expect(callbacks).toHaveLength(2);
      for (const { callback } of callbacks) {
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(
          LEADERBOARD_PLATFORM_HOOK_MESSAGE,
          expect.objectContaining({ instanceName, category: "DIBlueInfiniteDungeon" }),
        );
      }
    }
    const nonVolcanoCallback = capturedCallbacks.find(({ instanceName }) => instanceName === "NorthCave")!.callback;
    expect(nonVolcanoCallback).toHaveBeenCalledTimes(0);



    const detail = (instanceName: string, score: number) => ({
      code: LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC,
      message: LEADERBOARD_PLATFORM_HOOK_MESSAGE,
      detail: {
        code: LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC,
        sourceMethod: "DungeonNode.onEnterTransitionDidFinish",
        instanceName,
        category: "DIBlueInfiniteDungeon",
        score,
      },
    });
    const diagnostics = controller.diagnosticSnapshot();
    expect(diagnostics).toEqual([
      detail("Volcano", 1),
      detail("VolcanoB", 211),
      detail("Volcano", 211),
      detail("VolcanoB", 212),
    ]);
    expect(diagnostics.every(({ detail: entry }) => entry?.instanceName !== "NorthCave")).toBe(true);



    expect(highest).toBe(212);
    expect(checkpointDeltas).toHaveLength(5);
    // The NorthCave entry: a scene start that provably cannot write the Abyss property.
    const baseline = checkpointDeltas[4]!;
    expect(checkpointDeltas[2]).toBe(baseline);
    expect(checkpointDeltas).toEqual([
      baseline + 1,
      baseline + 1,
      baseline,
      baseline + 1,
      baseline,
    ]);


    expect(banners).toEqual([{
      kind: "localized-message",
      title: "New Monster Slot Unlocked!",
      message: "+1 Max Monsters!",
      image: "Icon@2x.png",
      visible: false,
    }]);
  });

  it("does not globally deduplicate unrelated diagnostics or detail changes", () => {
    const controller = controllerWithScenes(new SceneCoordinator<TestScene, "shell">("shell"));
    const record = (message: string, detail?: Readonly<Record<string, unknown>>): void => {
      (controller as unknown as {
        recordDiagnostic: (message: string, detail?: Readonly<Record<string, unknown>>) => void;
      }).recordDiagnostic.call(controller, message, detail);
    };

    record("same mechanic", { code: "mechanic-a", detail: "one" });
    record("same mechanic", { code: "mechanic-a", detail: "one" });
    record("same mechanic", { code: "mechanic-a", detail: "two" });

    expect(controller.diagnosticSnapshot()).toHaveLength(3);
    expect(controller.diagnosticSnapshot().map(({ detail }) => detail?.detail)).toEqual([
      "one", "one", "two",
    ]);
  });
});


describe("Dungeon first-use tutorial authority ownership", () => {
  it.each(["WaypointReached", "NewInfiniteMonsterSlot"])("claims %s once and waits for authority before mirroring", async flag => {
    const flags = new Set<string>([flag]);
    let resolveClaim!: () => void;
    let rejectClaim!: (error: Error) => void;
    const authorityClaim = vi.fn(() => new Promise<void>((resolve, reject) => {
      resolveClaim = resolve; rejectClaim = reject;
    }));
    const profile = { hasTutorialFlag: (key: string) => flags.has(key),
      claimTutorialFlag: vi.fn((key: string) => {
        if (flags.has(key)) return false;
        flags.add(key); return true;
      }) };
    let captured!: DungeonNodeDeps;
    const node = { lifecycleSignal: new AbortController().signal, onDestroy: vi.fn(),
      prepareStart: vi.fn(async () => undefined), start: vi.fn(async () => undefined) };
    const create = vi.spyOn(DungeonNode, "create").mockImplementation(async deps => {
      captured = deps; return node as unknown as DungeonNode;
    });
    const scenes = { current: undefined as unknown, replace: vi.fn(async (incoming: unknown) => { scenes.current = incoming; }) };
    const controller = new DungeonFeatureController({
      player: () => ({ party: {}, profile }), game: {}, audio: {}, content: { hasDungeonCapability: true }, scenes,
      stage: { app: { ticker: { add: vi.fn(), remove: vi.fn() } } },
      keyboard: { register: vi.fn(() => vi.fn()) }, checkpoint: vi.fn(),
      authority: { claimTutorialFlag: authorityClaim },
    } as unknown as DungeonFeatureHost<"shell">) as unknown as {
      run: unknown; startDungeonScene: (entry: object) => Promise<unknown>;
    };
    controller.run = { session: {}, route: {}, definition: {} };
    try {
      await controller.startDungeonScene({ kind: "restore", actions: [], documentRestore: true });
      const alreadySeen = captured.claimTutorialFlag(flag);
      expect(authorityClaim).not.toHaveBeenCalled();
      await expect(alreadySeen).resolves.toBe(false);
      flags.delete(flag);
      const first = captured.claimTutorialFlag(flag);
      expect(authorityClaim).toHaveBeenCalledTimes(1);
      expect(profile.claimTutorialFlag).not.toHaveBeenCalled();
      expect(flags.has(flag)).toBe(false);
      resolveClaim(); await expect(first).resolves.toBe(true);
      await expect(captured.claimTutorialFlag(flag)).resolves.toBe(false);
      expect(authorityClaim).toHaveBeenCalledTimes(1);
      flags.delete(flag);
      const failure = captured.claimTutorialFlag(flag);
      rejectClaim(new Error("claim rejected"));
      await expect(failure).rejects.toThrow("claim rejected");
      expect(flags.has(flag)).toBe(false);
      const retry = captured.claimTutorialFlag(flag);
      resolveClaim(); await expect(retry).resolves.toBe(true);
      expect(authorityClaim).toHaveBeenCalledTimes(3);
    } finally { create.mockRestore(); }
  });
});


describe("Dungeon menu owner guard wiring", () => {
  it("retains pointer ownership after the menu closes until Town Portal finishes", async () => {
    let captured!: DungeonNodeDeps;
    let menuOptions!: Parameters<typeof WorldMenu.show>[1];
    let finishPortal!: () => void;
    const portal = vi.fn(() => new Promise<void>(resolve => { finishPortal = resolve; }));
    const node = { lifecycleSignal: new AbortController().signal, onDestroy: vi.fn(),
      prepareStart: vi.fn(async () => undefined), start: vi.fn(async () => undefined) };
    const create = vi.spyOn(DungeonNode, "create").mockImplementation(async deps => {
      captured = deps; return node as unknown as DungeonNode;
    });
    const show = vi.spyOn(WorldMenu, "show").mockImplementation(async (_parent, options) => {
      menuOptions = options; return {} as WorldMenu;
    });
    const scenes = { current: undefined as unknown, replace: vi.fn(async (incoming: unknown) => { scenes.current = incoming; }) };
    const controller = new DungeonFeatureController({
      player: () => ({ party: {}, profile: {} }), game: { sourceTutorialTopics: [] }, audio: {},
      content: { hasDungeonCapability: true }, scenes, onTownPortal: portal,
      stage: { app: { ticker: { add: vi.fn(), remove: vi.fn() } } },
      keyboard: { register: vi.fn(() => vi.fn()) }, checkpoint: vi.fn(),
    } as unknown as DungeonFeatureHost<"shell">) as unknown as {
      run: unknown; startDungeonScene: (entry: object) => Promise<unknown>;
    };
    controller.run = { session: {}, route: {}, definition: {} };
    try {
      await controller.startDungeonScene({ kind: "restore", actions: [], documentRestore: true });
      expect(captured.isInputBlocked?.()).toBe(false);
      await captured.onMenu();
      menuOptions.onClose?.();
      menuOptions.onSelect("townPortal");
      expect(captured.isInputBlocked?.()).toBe(true);
      await vi.waitFor(() => expect(portal).toHaveBeenCalledOnce());
      expect(captured.isInputBlocked?.()).toBe(true);
      finishPortal();
      await vi.waitFor(() => expect(captured.isInputBlocked?.()).toBe(false));
    } finally { create.mockRestore(); show.mockRestore(); }
  });
});

describe("Dungeon Egg presentation input ownership", () => {
  it("refuses room input for the whole Egg presentation, including authority round-trips", async () => {


    let captured!: DungeonNodeDeps;
    let finishFlow!: () => void;
    const node = { lifecycleSignal: new AbortController().signal, onDestroy: vi.fn(),
      prepareStart: vi.fn(async () => undefined), start: vi.fn(async () => undefined),
      notificationParent: new Container(), notificationOwner: {} };
    const create = vi.spyOn(DungeonNode, "create").mockImplementation(async deps => {
      captured = deps; return node as unknown as DungeonNode;
    });
    const show = vi.spyOn(EggHatchFlow, "show").mockImplementation(async () => ({
      finished: new Promise<void>(resolve => { finishFlow = resolve; }), dispose: vi.fn(),
    }) as unknown as EggHatchFlow);
    const scenes = { current: undefined as unknown, replace: vi.fn(async (incoming: unknown) => { scenes.current = incoming; }) };
    const controller = new DungeonFeatureController({
      player: () => ({ party: {}, profile: {} }), game: { sourceTutorialTopics: [] }, audio: {},
      content: { hasDungeonCapability: true }, scenes, nextRunSeed: () => 1,
      stage: { app: { ticker: { add: vi.fn(), remove: vi.fn() } } },
      keyboard: { register: vi.fn(() => vi.fn()) }, checkpoint: vi.fn(),
    } as unknown as DungeonFeatureHost<"shell">) as unknown as {
      run: unknown; startDungeonScene: (entry: object) => Promise<unknown>;
      presentDungeonEggs: (node: unknown, eggs: readonly object[]) => Promise<void>;
    };
    controller.run = { session: {}, route: {}, definition: {} };
    try {
      await controller.startDungeonScene({ kind: "restore", actions: [], documentRestore: true });
      expect(captured.isInputBlocked?.()).toBe(false);
      const presenting = controller.presentDungeonEggs(node, [{ kind: "monsterEgg" }]);
      expect(captured.isInputBlocked?.()).toBe(true);
      await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
      expect(captured.isInputBlocked?.()).toBe(true);
      finishFlow();
      await presenting;
      expect(captured.isInputBlocked?.()).toBe(false);
    } finally { create.mockRestore(); show.mockRestore(); }
  });
});
