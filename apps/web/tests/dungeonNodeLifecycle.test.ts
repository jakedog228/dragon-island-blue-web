import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "DIB test", platform: "Win32" },
    });
  }
  // The Abyss's corner label reads its own `contentSize` before laying out the Scale9 backing, so
  // this file needs Pixi's canvas text measurement to resolve. Same minimal 2D-context stub the
  // loot-page provider test uses; the numbers only have to be stable, not real.
  if (!("document" in globalThis)) {
    Object.defineProperty(globalThis, "CanvasRenderingContext2D", {
      configurable: true,
      value: class CanvasRenderingContext2D {},
    });
    const context2d = {
      font: "",
      measureText: () => ({
        width: 40,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 40,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2,
        fontBoundingBoxAscent: 10,
        fontBoundingBoxDescent: 2,
      }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      clearRect: () => undefined,
      fillText: () => undefined,
      strokeText: () => undefined,
      scale: () => undefined,
      setTransform: () => undefined,
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => ({ width: 1, height: 1, getContext: () => context2d }),
      },
    });
  }
});

import { Container, Texture } from "pixi.js";
import { SceneCoordinator } from "../src/sceneCoordinator.js";
import { DungeonNode, type DungeonNodeDeps } from "../src/dungeon/dungeonNode.js";
import {
  FOREST_TREE_ALL_VALUES_ORDER_CODE,
  FOREST_TREE_ALL_VALUES_ORDER_DIAGNOSTIC,
  LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC,
  LEADERBOARD_PLATFORM_HOOK_MESSAGE,
  isVolcanoInfiniteDungeonInstance,
} from "../src/dungeon/dungeonDiagnostics.js";
import { infiniteDungeonFloorEntry } from "@dib/player-domain";

describe("production DungeonNode entry lifecycle", () => {
  it("starts entered-room logic while fallback movement is still in flight", async () => {
    let finishEntry!: () => void;
    const entry = new Promise<void>((resolve) => { finishEntry = resolve; });
    const callbacks = new Set<() => void>();
    const ticker = {
      deltaMS: 250,
      add: (callback: () => void) => { callbacks.add(callback); },
      remove: (callback: () => void) => { callbacks.delete(callback); },
    };
    const before = {
      id: "before", x: 0, y: 0, width: 1, height: 1,
    };
    const after = {
      id: "after", x: 2, y: 0, width: 1, height: 1,
    };
    const processEntryActions = vi.fn(() => entry);
    const hero = {
      alpha: 1,
      position: { set: vi.fn() },
      stop: vi.fn(),
    };
    const onStateChanged = vi.fn();
    const controller = Object.assign(Object.create(DungeonNode.prototype), {
      deps: {
        session: { state: { rooms: [before] }, currentRoom: after },
        stage: { app: { ticker } },
        onStateChanged,
      },
      lifecycle: { signal: new AbortController().signal },
      hero,
      locked: false,
      renderFloor: vi.fn(),
      processEntryActions,
    }) as unknown as {
      animateRoomSelection(result: unknown): Promise<void>;
      locked: boolean;
    };

    const movement = controller.animateRoomSelection({
      kind: "changed-room",
      fromRoomId: "before",
      toRoomId: "after",
      transition: "fade-teleport",
      actions: [{ kind: "encounter", roomId: "after", encounter: {} }],
    });

    // Native `RoomNode.enterLogic` runs at selection time; neither the 250 ms fade-out nor the
    // complete 500 ms fallback movement is a prerequisite.
    expect(processEntryActions).toHaveBeenCalledOnce();
    expect(hero.stop).not.toHaveBeenCalled();
    expect(controller.locked).toBe(true);

    for (let leg = 0; leg < 2; leg++) {
      for (const callback of [...callbacks]) callback();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(hero.stop).toHaveBeenCalledOnce();
    expect(onStateChanged).toHaveBeenCalledOnce();
    expect(controller.locked).toBe(true);

    finishEntry();
    await movement;
    expect(controller.locked).toBe(false);
  });

  it("hands pending browser preparation to the transition at the fixed flourish boundary", async () => {
    let resolvePreparation!: () => void;
    const preparation = new Promise<void>((resolve) => { resolvePreparation = resolve; });
    const events: string[] = [];
    const onEncounter = vi.fn(async (
      _request: unknown,
      pendingPreparation: Promise<void>,
    ) => {
      events.push("transition-started");
      await pendingPreparation;
      events.push("preparation-finished");
    });
    const { node } = await createProductionDungeonNode("NorthCave", [], {
      onPrepareEncounter: () => preparation,
      onEncounter,
    });
    const encounter = {
      id: "encounter-1",
      kind: "random",
      monsters: [{ type: "Testling", level: 1 }],
    } as never;

    const entry = (node as unknown as {
      triggerEncounter(roomId: string, value: typeof encounter): Promise<void>;
    }).triggerEncounter("room-1", encounter);
    await vi.waitFor(() => expect(onEncounter).toHaveBeenCalledOnce());

    // Before the correction triggerEncounter awaited this promise itself, visibly pinning the
    // monster at centre after the source's one-second callback. The transition now owns the wait.
    expect(events).toEqual(["transition-started"]);
    expect(onEncounter.mock.calls[0]?.[1]).toBe(preparation);
    resolvePreparation();
    await entry;
    expect(events).toEqual(["transition-started", "preparation-finished"]);
    node.destroy();
  });

  it("keeps preparation ownership fresh across repeated Abyss scene entries", async () => {
    const handedPreparations: Promise<void>[] = [];

    for (const instanceName of ["Volcano", "VolcanoB"] as const) {
      let resolvePreparation!: () => void;
      const preparation = new Promise<void>((resolve) => { resolvePreparation = resolve; });
      const onEncounter = vi.fn(async (
        _request: unknown,
        pendingPreparation: Promise<void>,
      ) => {
        handedPreparations.push(pendingPreparation);
        await pendingPreparation;
      });
      const { node } = await createProductionDungeonNode(instanceName, [], {
        onPrepareEncounter: () => preparation,
        onEncounter,
      });
      const encounter = {
        id: `encounter-${instanceName}`,
        kind: "random",
        monsters: [{ type: "Testling", level: 1 }],
      } as never;

      const entry = (node as unknown as {
        triggerEncounter(roomId: string, value: typeof encounter): Promise<void>;
      }).triggerEncounter(`room-${instanceName}`, encounter);
      await vi.waitFor(() => expect(onEncounter).toHaveBeenCalledOnce());
      expect(onEncounter.mock.calls[0]?.[1]).toBe(preparation);
      resolvePreparation();
      await entry;
      node.destroy();
    }

    expect(handedPreparations).toHaveLength(2);
    expect(handedPreparations[0]).not.toBe(handedPreparations[1]);
  });

  it.each(["Volcano", "VolcanoB", "NorthCave", "Forest"] as const)(
    "%s reports only after scene activation and preserves source entry ordering",
    async (instanceName) => {
      const events: string[] = [];
      const { node, stage } = await createProductionDungeonNode(instanceName, events);

      // DungeonNode.create -> build and prepareStart are production methods. Neither construction
      // nor the hidden pre-transition hero assignment may emit the post-transition diagnostic or
      // any of the later entry phases.
      expect(events).toEqual([]);
      const scenes = new SceneCoordinator<typeof node, "shell">("shell");
      await scenes.replace(node, ({ activate }) => {
        events.push("transition");
        events.push("activate");
        activate();
      });
      expect(events).toEqual(["transition", "activate"]);

      await node.start([{ kind: "waypoint", floor: 1, roomId: "room-1" }]);

      if (isVolcanoInfiniteDungeonInstance(instanceName)) {
        expect(events).toEqual([
          "transition",
          "activate",
          "diagnostic",
          "catch",
          "nameplate",
          "music",
          "waypoint",
          "room-entry",
        ]);
        expect(events.filter((event) => event === "diagnostic")).toHaveLength(1);
      } else if (instanceName === "Forest") {
        expect(events).toEqual([
          "transition",
          "activate",
          "diagnostic",
          "catch",
          "nameplate",
          "music",
          "waypoint",
          "room-entry",
        ]);
        expect(events.filter((event) => event === "diagnostic")).toHaveLength(1);
      } else {
        expect(events).toEqual([
          "transition",
          "activate",
          "catch",
          "nameplate",
          "music",
          "waypoint",
          "room-entry",
        ]);
        expect(events).not.toContain("diagnostic");
      }
      node.destroy();
      expect(stage.root.destroyed).toBe(false);
    },
  );
});

async function createProductionDungeonNode(
  instanceName: "Volcano" | "VolcanoB" | "NorthCave" | "Forest",
  events: string[],
  encounterOverrides: Partial<Pick<
    DungeonNodeDeps,
    "onEncounter" | "onPrepareEncounter"
  >> = {},
): Promise<{ readonly node: DungeonNode; readonly stage: { readonly root: Container } }> {
  const root = new Container();
  const ticker = {
    deltaMS: 5_000,
    add(callback: () => void): void { callback(); },
    remove: vi.fn(),
  };
  const stage = {
    root,
    app: { ticker, screen: { width: 960, height: 640 } },
  };
  const frameNames = [
    "floor1.png", "wall1.png", "door1.png", "northDoor.png", "chest.png", "portal.png",
    "stairsUp.png", "stairsDown.png",
  ];
  const themeSheet = { textures: Object.fromEntries(frameNames.map((name) => [name, Texture.WHITE])) };
  const heroSheet = {
    textures: Object.fromEntries([
      "Front", "Back", "Left", "Right",
    ].flatMap((direction) => Array.from({ length: 8 }, (_, index) => [
      `herowalk${direction}_${index + 1}.png`, Texture.WHITE,
    ]))),
  };
  const generalSheet = {
    textures: {
      "heroXpFrame.png": Texture.WHITE,
      "heroXpBar.png": Texture.WHITE,
    },
  };
  const assets = {
    atlas: async (name: string) => name === "HeroWalkFrames-hd"
      ? heroSheet
      : name === "General-hd" ? generalSheet : themeSheet,
    hasSprite: (name: string) => name === "Icon@2x" || name === "PopupBackgroundThin-hd",
    sprite: async () => Texture.WHITE,
    particle: async () => ({ config: {
      maxParticles: 18, particleLifespan: 0.8553, particleLifespanVariance: 0.06,
      duration: -1, emitterType: 0, angle: 0, angleVariance: 360,
      speed: 10, speedVariance: 0.1, gravityx: 0, gravityy: 0,
      startParticleSize: 2, startParticleSizeVariance: 9,
      finishParticleSize: 16.8421059, finishParticleSizeVariance: 0,
      rotationStart: 0, rotationStartVariance: 0, rotationEnd: 0, rotationEndVariance: 0,
      startColorRed: 0.8, startColorGreen: 0.8, startColorBlue: 0, startColorAlpha: 1,
      finishColorRed: 1, finishColorGreen: 1, finishColorBlue: 0, finishColorAlpha: 0,
      blendFuncSource: 770, blendFuncDestination: 1,
    }, texture: Texture.WHITE }),
    audioUrl: (name: string) => name,
  };
  const room = {
    id: "room-1",
    sourceIndex: 0,
    templateKey: "fixture",
    x: 0,
    y: 0,
    width: 2,
    height: 2,
    rotation: 0,
    links: [],
    zones: [],
    waypoint: false,
    explored: true,
  };
  const state = {
    definitionId: "fixture",
    floor: 1,
    seed: 1,
    challengeLevel: 1,
    startRoomId: "room-1",
    currentRoomId: "room-1",
    rooms: [room],
    diagnostics: [],
  };
  const session = {
    state,
    currentRoom: room,
    enterCurrentRoom: () => [{ kind: "waypoint", floor: 1, roomId: "room-1" }] as const,
    snapshot: () => ({
      seed: 1,
      clearedEncounterIds: [],
      collectedTreasureIds: [],
    }),
    isWaypointRegistered: () => false,
    catchQuestProgress: () => undefined,
  };
  const definition = {
    instanceName,
    sourceFile: "Dungeon_fixture.plist",
    typeName: "Cave",
    creation: { lastFloor: 999 },
    presentation: {
      style: instanceName === "Forest" ? "forest" : "cave",
      atlasNames: ["DungeonFrames"],
      wallFrameCount: 1,
      floorFrameCount: 1,
      floorFrameFormat: "floor%d.png",
      wallFrameFormat: "wall%d.png",
      doorFrameFormat: "door%d.png",
      northDoorFrame: "northDoor.png",
      chestFrame: "chest.png",
      portalFrame: "portal.png",
      stairsUpFrame: "stairsUp.png",
      stairsDownFrame: "stairsDown.png",
    },
    floorPopulations: [],
  };
  const deps: DungeonNodeDeps = {
    stage: stage as never,
    game: {
      assets,
      gd: { monsterByShortType: () => ({}) },
      scale9: {
        PopupBackgroundThin: {
          contentRect: "{{20,20},{42,14}}",
          image: "PopupBackgroundThin.png",
        },
      },
      strings: {
        LevelShortKey: "Lv",
        DungeonLevelKey: "Level",
        DungeonMonstersCaughtFormatString: "Caught %d/%d",
        InfiniteDungeonUnlockFormatKey: "Next bonus at floor: %d",
        NewInfiniteMonsterSlotTitleKey: "New Monster Slot Unlocked!",
        NewInfiniteMonsterSlotMessageShortKey: "+1 Max Monsters!",
      },
    } as never,
    audio: { hasSfx: () => true, preloadSfx: vi.fn(), playSfx: vi.fn() } as never,
    definition: definition as never,
    session: session as never,
    route: {
      typeName: "Cave",
      sourceFile: "Dungeon_fixture.plist",
      floor: 1,
    },
    initiallyHidden: true,
    allowWaypointSelection: true,
    onEncounter: vi.fn(),
    ...encounterOverrides,
    onActivateZone: vi.fn(),
    onTransition: vi.fn(),
    onWaypoint: (firstReach) => {
      if (firstReach) events.push("waypoint");
      return [];
    },
    onWaypointTravel: vi.fn(),
    onCatchQuest: () => events.push("catch"),
    onMusic: () => events.push("music"),
    claimTutorialFlag: () => false,
    claimFloorPresence: () => false,
    // A fresh profile: floor 1 is a strictly deeper floor but stays under the first threshold of 10,
    // so the branch writes and submits without unlocking a monster slot.
    onInfiniteDungeonFloor: (floor) => infiniteDungeonFloorEntry(0, floor),
    onLoot: () => [],
    heroLevel: 1,
    heroTotalHighestLevels: 1,
    isMonsterRegistered: () => false,
    isCollectionMonsterEligible: () => false,
    onMenu: vi.fn(),
    onStateChanged: () => events.push("room-entry"),
    onNotificationHostReady: (host) => {
      const original = host.showNamePlate.bind(host);
      vi.spyOn(host, "showNamePlate").mockImplementation((...args) => {
        events.push("nameplate");
        original(...args);
      });
    },
    onDiagnostic: (message, detail) => {
      if (instanceName === "Forest") {
        expect(message).toBe(FOREST_TREE_ALL_VALUES_ORDER_DIAGNOSTIC);
        expect(detail).toEqual({
          code: FOREST_TREE_ALL_VALUES_ORDER_CODE,
          sourceClass: "RoomNode",
          style: "forest",
        });
      } else {


        expect(message).toBe(LEADERBOARD_PLATFORM_HOOK_MESSAGE);
        expect(detail).toEqual({
          code: LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC,
          sourceMethod: "DungeonNode.onEnterTransitionDidFinish",
          instanceName,
          category: "DIBlueInfiniteDungeon",
          score: 1,
        });
      }
      events.push("diagnostic");
    },
  };
  const node = await DungeonNode.create(deps);
  await node.prepareStart([{ kind: "waypoint", floor: 1, roomId: "room-1" }]);
  return { node, stage };
}
