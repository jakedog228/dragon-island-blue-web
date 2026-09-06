import { AudioPlayer } from "../src/audio.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { infiniteDungeonFloorEntry } from "@dib/player-domain";

vi.hoisted(() => {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "DIB test" },
    });
  }
});

const waypointHarness = vi.hoisted(() => ({
  choose: vi.fn(),
}));
const catchQuestHarness = vi.hoisted(() => ({
  show: vi.fn(),
}));

vi.mock("../src/dungeon/dungeonDialogs.js", async () => {
  const actual = await vi.importActual<typeof import("../src/dungeon/dungeonDialogs.js")>(
    "../src/dungeon/dungeonDialogs.js",
  );
  return { ...actual, chooseDungeonWaypoint: waypointHarness.choose };
});
vi.mock("../src/dungeon/dungeonCatchQuestDisplay.js", () => ({
  showDungeonCatchQuestDisplay: catchQuestHarness.show,
}));

import {
  DungeonNode,
  type DungeonNodeDeps,
} from "../src/dungeon/dungeonNode.js";
import {
  DungeonFeatureController,
  type DungeonFeatureHost,
} from "../src/dungeon/installDungeonFeature.js";
import { SceneCoordinator } from "../src/sceneCoordinator.js";

afterEach(() => {
  vi.restoreAllMocks();
  waypointHarness.choose.mockReset();
  catchQuestHarness.show.mockReset();
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function dungeonNodeHarness(
  overrides: Partial<DungeonNodeDeps> = {},
): { readonly node: DungeonNode; readonly namePlate: ReturnType<typeof vi.fn> } {
  const namePlate = vi.fn();
  const deps: DungeonNodeDeps = {
    stage: { app: { ticker: {} } } as never,
    game: {
      strings: {
        DungeonLevelKey: "Level",
        DungeonMonstersCaughtFormatString: "Caught %d/%d",
      },
    } as never,
    audio: {} as never,
    definition: {
      instanceName: "TestDungeon",
      sourceFile: "Dungeon_Test.plist",
      typeName: "Test",
      creation: { lastFloor: 10 },
      presentation: { wallFrameCount: 1, floorFrameCount: 1 },
      floorPopulations: [],
    } as never,
    session: {} as never,
    route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    onEncounter: () => undefined,
    onActivateZone: () => undefined,
    onTransition: () => undefined,
    onWaypoint: () => [],
    onWaypointTravel: () => undefined,
    claimTutorialFlag: () => false,
    claimFloorPresence: () => false,
    // `TestDungeon` is not the Abyss, so this never runs; the dep is required, not optional.
    onInfiniteDungeonFloor: (floor) => infiniteDungeonFloorEntry(0, floor),
    onLoot: () => [],
    heroLevel: 1,
    heroTotalHighestLevels: 1,
    isMonsterRegistered: () => false,
    isCollectionMonsterEligible: () => true,
    onMenu: () => undefined,
    onStateChanged: () => undefined,
    ...overrides,
  };
  const NodeConstructor = DungeonNode as unknown as new (value: DungeonNodeDeps) => DungeonNode;
  const node = new NodeConstructor(deps);
  const internals = node as unknown as {
    startPrepared: boolean;
    preparedEntryActions: readonly [];
    initialHeroAssignment: Promise<void>;
    notifications: { showNamePlate: typeof namePlate };
  };
  internals.startPrepared = true;
  internals.preparedEntryActions = [];
  internals.initialHeroAssignment = Promise.resolve();
  internals.notifications = { showNamePlate: namePlate };
  return { node, namePlate };
}

function dungeonControllerHarness(
  takeChangedCatchQuestProgress: () => unknown,
  options: {
    readonly fidelityRng?: DungeonFeatureHost<"shell">["fidelityRng"];
    readonly rooms?: readonly unknown[];
    readonly advanceTweens?: boolean;
  } = {},
) {
  const audio = { playMusic: vi.fn(), requestMusic: AudioPlayer.prototype.requestMusic };
  const checkpoint = vi.fn();
  const run = {
    definition: {
      instanceName: "TestDungeon",
      sourceFile: "Dungeon_Test.plist",
      typeName: "Test",
      creation: { lastFloor: 10 },
      presentation: { wallFrameCount: 1, floorFrameCount: 1 },
      floorPopulations: [],
    },
    route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
    session: {
      state: {
        definitionId: "TestDungeon",
        floor: 1,
        rooms: options.rooms ?? [],
      },
    },
    takeChangedCatchQuestProgress: vi.fn(takeChangedCatchQuestProgress),
    claimCurrentFloorPresence: () => false,
  } as any;
  const scenes = new SceneCoordinator<any, "shell">("shell");
  const host = {
    stage: {
      app: {
        screen: { width: 960, height: 640 },
        ticker: {
          deltaMS: options.advanceTweens === true ? 1_000 : 0,
          add: vi.fn((step: () => void) => {
            if (options.advanceTweens === true) step();
          }),
          remove: vi.fn(),
        },
      },
      root: new Container(),
    },
    game: {
      strings: {
        DungeonLevelKey: "Level",
        DungeonMonstersCaughtFormatString: "Caught %d/%d",
      },
      assets: { audioUrl: (name: string) => name },
    },
    audio,
    keyboard: { register: () => () => undefined },
    content: { hasDungeonCapability: true },
    scenes,
    player: () => ({ party: {}, profile: {} }),
    nextBattleSeed: () => 1,
    nextRunSeed: () => 1,
    ...(options.fidelityRng === undefined ? {} : { fidelityRng: options.fidelityRng }),
    checkpoint,
    checkpointAsync: async () => undefined,
    onWorldExit: () => undefined,
    onDefeat: () => undefined,
    onMainMenu: () => undefined,
    onPresentationChange: () => undefined,
  } as unknown as DungeonFeatureHost<"shell">;
  const controller = new DungeonFeatureController<"shell">(host);
  vi.spyOn(DungeonNode, "create").mockImplementation(async (deps) => {
    const { node } = dungeonNodeHarness(deps);
    // Scene activation is tested by the real SceneCoordinator; this harness only avoids the
    // unbuilt node's HeroXp activation side effect while retaining the real start() method.
    node.setSceneVisible = vi.fn();
    return node;
  });
  const privateController = controller as unknown as {
    run: unknown;
    startDungeonScene: (entry: {
      readonly kind: "restore" | "battleReturn";
      readonly presentationResume?: boolean;
      readonly actions?: readonly [];
    }) => Promise<void>;
  };
  privateController.run = run;
  return { audio, checkpoint, privateController };
}

describe("Dungeon music transition timing", () => {
  it("uses real DungeonNode.start order and does not await deferred catch-quest construction", async () => {
    const events: string[] = [];
    const catchQuest = deferred<void>();
    let catchQuestFinished = false;
    const { node, namePlate } = dungeonNodeHarness({
      allowWaypointSelection: true,
      onWaypoint: () => {
        events.push("waypoint dispatch");
        return [];
      },
      onCatchQuest: () => {
        events.push("catch-quest dispatch");
        void catchQuest.promise.then(() => { catchQuestFinished = true; });
      },
      onMusic: () => events.push("music"),
    });
    namePlate.mockImplementation(() => events.push("name plate"));

    await node.start([]);
    events.push("room entry complete");

    expect(events).toEqual([
      "waypoint dispatch",
      "catch-quest dispatch",
      "name plate",
      "music",
      "room entry complete",
    ]);
    expect(catchQuestFinished).toBe(false);
    catchQuest.resolve();
    await catchQuest.promise;
    node.destroy();
  });

  it("suppresses catch-quest dispatch only when waypoint selection actually opens", async () => {
    const selection = deferred<undefined>();
    waypointHarness.choose.mockReturnValue(selection.promise);
    const events: string[] = [];
    const { node, namePlate } = dungeonNodeHarness({
      allowWaypointSelection: true,
      onWaypoint: () => [{ typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 2 }],
      onCatchQuest: () => events.push("catch-quest dispatch"),
      onMusic: () => events.push("music"),
    });
    namePlate.mockImplementation(() => events.push("name plate"));

    await node.start([]);

    expect(waypointHarness.choose).toHaveBeenCalledOnce();
    expect(events).toEqual(["name plate", "music"]);
    selection.resolve(undefined);
    await selection.promise;
    node.destroy();
  });

  it("proves music precedes initiation of nonempty room-entry processing", async () => {
    const events: string[] = [];
    const { node, namePlate } = dungeonNodeHarness({
      onMusic: () => events.push("music"),
    });
    namePlate.mockImplementation(() => events.push("name plate"));
    const entryActions = [{ kind: "waypoint" as const, floor: 1, roomId: "room-1" }];
    const internals = node as unknown as { preparedEntryActions: readonly unknown[] };
    internals.preparedEntryActions = entryActions;
    vi.spyOn(
      node as unknown as {
        processEntryActions: (actions: readonly unknown[]) => Promise<void>;
      },
      "processEntryActions",
    ).mockImplementation(async (actions) => {
      expect(actions).toEqual(entryActions);
      events.push("room entry processing initiated");
    });

    await node.start();

    expect(events).toEqual(["name plate", "music", "room entry processing initiated"]);
    node.destroy();
  });

  it("keeps the controller's real startDungeonScene seam nonblocking for catch-quest popup construction", async () => {
    const popup = deferred<void>();
    catchQuestHarness.show.mockReturnValue(popup.promise);
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    const { audio, checkpoint, privateController } = dungeonControllerHarness(() => ({
      complete: false,
      rewardCollected: false,
      captured: [],
      required: ["Slime"],
    }));
    const start = privateController.startDungeonScene({ kind: "restore" });
    await vi.waitFor(() => expect(catchQuestHarness.show).toHaveBeenCalledOnce());
    let startFinished = false;
    void start.then(() => { startFinished = true; });
    await Promise.resolve();

    expect(DungeonNode.create).toHaveBeenCalledOnce();
    expect(startFinished).toBe(true);
    expect(audio.playMusic).toHaveBeenCalledWith("Dungeon2.mp3", { loop: true, assetName: "Dungeon2.mp3" });
    expect(checkpoint).toHaveBeenCalled();
    popup.resolve();
    await popup.promise;
    await start;
  });

  it("does not invoke music selection/play on a production presentation resume", async () => {
    const { audio, checkpoint, privateController } = dungeonControllerHarness(() => undefined);

    await privateController.startDungeonScene({ kind: "restore", presentationResume: true });

    expect(DungeonNode.create).toHaveBeenCalledOnce();
    expect(audio.playMusic).not.toHaveBeenCalled();
    expect(checkpoint).toHaveBeenCalled();
  });

  it("materializes Silver initializer RNG once per cached floor, not again after battle", async () => {
    let draws = 0;
    const next = (): number => {
      draws += 1;
      return 0;
    };
    const fidelityRng = {
      next,
      intBelow: (_n: number) => {
        next();
        return 0;
      },
      chance: (p: number) => next() < p,
    };
    const { privateController } = dungeonControllerHarness(() => undefined, {
      fidelityRng,
      advanceTweens: true,
      rooms: [{
        treasure: { loot: [{ kind: "silver", amount: 7 }] },
      }],
    });

    await privateController.startDungeonScene({ kind: "restore" });
    expect(draws).toBe(3); // Silver initializer, DungeonNode wall frame, dungeon music.

    await privateController.startDungeonScene({ kind: "battleReturn", actions: [] });
    expect(draws).toBe(5); // A fresh scene redraws wall/music only; Item instances persist.
  });
});
