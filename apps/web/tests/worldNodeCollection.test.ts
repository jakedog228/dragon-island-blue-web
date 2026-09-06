import type { WorldPointOfInterest } from "@dib/gamedata/browser";
import { describe, expect, it, vi } from "vitest";
import { createWorldPoiRoutingPolicy } from "../src/world/worldPoiRouting.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

function collectionPoi(name: string): WorldPointOfInterest {
  return {
    name,
    type: "Outdoor.CollectionHut",
    sourceClass: "PopupMenuPointOfInterest",
    position: { x: 10, y: 20 },
    renderer: { className: "PopupMenuPOINode", spriteFile: "empty.png" },
    hasEncounterTable: false,
    randomPopulators: [],
    unusedEncounterFixedEncounters: [],
    supportedInteraction: { kind: "monsterCollection", collectionType: "Base" },
    demoSkipped: ["customInteraction"],
  };
}

describe("WorldNode Collection integration", () => {
  it("fails construction when a promoted Collection route has no live local adapter", async () => {
    const { WorldNode } = await import("../src/world/worldNode.js");
    const poi = collectionPoi("hut");
    const party = {};
    const deps = {
      world: {
        name: "World_Test",
        map: { className: "CCSprite", spriteFile: "world.png", anchor: { x: 0, y: 0 } },
        pointsOfInterest: [poi],
        connections: [],
      },
      trip: { currentPoiName: "hut" },
      party,
      playerRuntime: { party },
      game: { strings: {} },
      keyboard: { register: vi.fn() },
      poiRouting: createWorldPoiRoutingPolicy({ collections: true }),
    };
    const construct = WorldNode as unknown as new (deps: never) => object;

    expect(() => new construct(deps as never)).toThrow(/Collection route hut.*adapter/i);
  }, 15_000);

  it("starts different-POI movement before synchronously opening the Collection flow", async () => {
    const { WorldNode } = await import("../src/world/worldNode.js");
    const previous = collectionPoi("start");
    const target = collectionPoi("hut");
    const order: string[] = [];
    const receiver = navigationReceiver(previous, target, order);
    const handlePoiTap = (WorldNode.prototype as unknown as {
      handlePoiTap(this: typeof receiver, poiName: string): Promise<void>;
    }).handlePoiTap;

    await handlePoiTap.call(receiver, "hut");

    expect(order).toEqual(["navigate", "checkpoint", "refresh", "movement", "collection:Base"]);
  });

  it("reopens a same-POI Collection without requiring synthetic marker movement", async () => {
    const { WorldNode } = await import("../src/world/worldNode.js");
    const target = collectionPoi("hut");
    const order: string[] = [];
    const receiver = navigationReceiver(target, target, order);
    const handlePoiTap = (WorldNode.prototype as unknown as {
      handlePoiTap(this: typeof receiver, poiName: string): Promise<void>;
    }).handlePoiTap;

    await handlePoiTap.call(receiver, "hut");

    expect(order).toEqual(["navigate", "checkpoint", "refresh", "collection:Base"]);
  });

  it("does not spend an Official navigation command when reopening a same-POI scene route", async () => {
    const { WorldNode } = await import("../src/world/worldNode.js");
    const target = collectionPoi("hut");
    const order: string[] = [];
    const receiver = navigationReceiver(target, target, order) as ReturnType<typeof navigationReceiver> & {
      deps: ReturnType<typeof navigationReceiver>["deps"] & { authority: { navigate: ReturnType<typeof vi.fn> } };
    };
    const navigate = vi.fn(async () => ({ movement: "same" as const, randomDraws: [] }));
    receiver.deps.authority = { navigate };
    const handlePoiTap = (WorldNode.prototype as unknown as {
      handlePoiTap(this: typeof receiver, poiName: string): Promise<void>;
    }).handlePoiTap;

    await handlePoiTap.call(receiver, "hut");

    expect(navigate).not.toHaveBeenCalled();
    expect(order).toEqual(["navigate", "checkpoint", "refresh", "collection:Base"]);
  });

  it("owns Collection modality, Escape, and disposal", async () => {
    const { WorldNode } = await import("../src/world/worldNode.js");
    const poi = collectionPoi("hut");
    const party = {};
    const deps = {
      world: {
        name: "World_Test",
        map: { className: "CCSprite", spriteFile: "world.png", anchor: { x: 0, y: 0 } },
        pointsOfInterest: [poi],
        connections: [],
      },
      trip: { currentPoiName: "hut" },
      party,
      playerRuntime: { party },
      game: { strings: {} },
      keyboard: { register: vi.fn() },
      poiRouting: createWorldPoiRoutingPolicy(),
    };
    const construct = WorldNode as unknown as new (deps: never) => { destroy(): void };
    const node = new construct(deps as never);
    const collection = {
      requestBack: vi.fn(() => true),
      dispose: vi.fn(),
      update: vi.fn(),
      debugState: { kind: "collection", open: true },
    };
    (node as any).activeCollection = collection;
    (node as any).locked = true;
    (node as any).keyboardActive = true;

    expect((node as any).hasModal()).toBe(true);
    expect((node as any).handleKeyboardShortcut({ key: "escape" })).toBe(true);
    expect(collection.requestBack).toHaveBeenCalledTimes(1);

    node.destroy();
    expect(collection.dispose).toHaveBeenCalledTimes(1);
  });

  it("publishes the active Collection flow through the world overlay debug state", async () => {
    const { WorldNode } = await import("../src/world/worldNode.js");
    const debugState = { kind: "collection", open: true, collectionType: "Base" };
    const receiver = {
      activeCollection: { debugState },
    };
    const overlayDebugState = (WorldNode.prototype as unknown as {
      overlayDebugState(this: typeof receiver, popups: {
        depth: number;
        stack: Array<{
          visible: boolean;
          dismissed: boolean;
          contentLabel: string | null;
          buttons: string[];
        }>;
      }): unknown;
    }).overlayDebugState;

    expect(overlayDebugState.call(receiver, {
      depth: 1,
      stack: [{ visible: true, dismissed: false, contentLabel: "description", buttons: ["OK"] }],
    })).toEqual({
      ...debugState,
      popupHost: {
        depth: 1,
        stack: [{ visible: true, dismissed: false, contentLabel: "description", buttons: ["OK"] }],
      },
    });
  });

  it("rejects a Collection adapter whose mode disagrees with the session before issuing any command", async () => {
    const { WorldNode } = await import("../src/world/worldNode.js");
    const poi = collectionPoi("hut");
    const navigate = vi.fn();
    const party = {};
    const deps = {
      world: {
        name: "World_Test",
        map: { className: "CCSprite", spriteFile: "world.png", anchor: { x: 0, y: 0 } },
        pointsOfInterest: [poi],
        connections: [],
      },
      trip: { currentPoiName: "hut" },
      party,
      playerRuntime: { party },
      game: { strings: {} },
      keyboard: { register: vi.fn() },
      poiRouting: createWorldPoiRoutingPolicy({ collections: true }),
      collection: {
        mode: "local",
        requestChatPresentation: vi.fn(),
        allocateMonsterInstanceId: vi.fn(),
      },
      authority: { navigate },
    };
    const construct = WorldNode as unknown as new (deps: never) => object;

    expect(() => new construct(deps as never))
      .toThrow(/official session requires a official Collection adapter, not local/i);
    // And the mirror image: an offline session has no authority to submit an official claim through.
    expect(() => new construct({
      ...deps,
      collection: { ...deps.collection, mode: "official" },
      authority: undefined,
    } as never)).toThrow(/local session requires a local Collection adapter, not official/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps a blocked Official Collection route command-free", async () => {
    const { WorldNode } = await import("../src/world/worldNode.js");
    const target = collectionPoi("hut");
    const navigate = vi.fn();
    const tripNavigate = vi.fn();
    const receiver = {
      locked: false,
      walking: false,
      modalOpening: false,
      hasModal: () => false,
      deps: {
        trip: { currentPoiName: "hut", poiState: () => 0, navigate: tripNavigate },
        poiRouting: createWorldPoiRoutingPolicy({ collections: false }),
        authority: { navigate },
      },
      requirePoi: () => target,
    };
    const handlePoiTap = (WorldNode.prototype as unknown as {
      handlePoiTap(this: typeof receiver, poiName: string): Promise<void>;
    }).handlePoiTap;

    await handlePoiTap.call(receiver, "hut");

    expect(navigate).not.toHaveBeenCalled();
    expect(tripNavigate).not.toHaveBeenCalled();
  });
});

function navigationReceiver(
  previous: WorldPointOfInterest,
  target: WorldPointOfInterest,
  order: string[],
) {
  return {
    locked: false,
    walking: false,
    modalOpening: false,
    hasModal: () => false,
    transitionFailure: undefined,
    deps: {
      trip: {
        currentPoiName: previous.name,
        poiState: () => 0,
        navigate: () => {
          order.push("navigate");
          return {
            kind: "none" as const,
            poiName: target.name,
            reason: "no-encounter-table" as const,
            movement: { adjacent: previous.name !== target.name, kind: "walk" as const },
          };
        },
      },
      poiRouting: createWorldPoiRoutingPolicy({ collections: true }),
      party: {
        projectAliveBattingPrefix: () => [{ level: 1 }],
      },
      world: {
        connections: previous.name === target.name
          ? []
          : [{ poi1: previous.name, poi2: target.name, demoSkipped: [] }],
      },
      onStateChanged: () => { order.push("checkpoint"); },
    },
    requirePoi: (name: string) => name === previous.name ? previous : target,
    refreshPoiStates: () => { order.push("refresh"); },
    playMovement: () => {
      order.push("movement");
      return new Promise<never>(() => {});
    },
    openCollection: (collectionType: string) => { order.push(`collection:${collectionType}`); },
  };
}
