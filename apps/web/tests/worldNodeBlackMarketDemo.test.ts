import { Container, Rectangle, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { PlayerProfile } from "@dib/player-domain";
import { WorldNode } from "../src/world/worldNode.js";
import { createWorldPoiRoutingPolicy } from "../src/world/worldPoiRouting.js";
import {
  BLACK_MARKET_DEMO_CARDS,
  type DemoImageLoader,
  type ExternalPageOpener,
} from "../src/world/blackMarketDemoModel.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

function texture(width: number, height: number): Texture {
  return new Texture({
    source: Texture.WHITE.source,
    frame: new Rectangle(0, 0, width, height),
  });
}

function deferredLoader() {
  const requests: Array<{
    readonly url: string;
    readonly onLoad: Parameters<DemoImageLoader<Texture>["load"]>[1];
    readonly onError: Parameters<DemoImageLoader<Texture>["load"]>[2];
    readonly cancel: ReturnType<typeof vi.fn>;
  }> = [];
  const loader: DemoImageLoader<Texture> = {
    load: (url, onLoad, onError) => {
      const request = { url, onLoad, onError, cancel: vi.fn() };
      requests.push(request);
      return request;
    },
  };
  return { loader, requests };
}

function townPoi() {
  return {
    name: "First_City",
    type: "Town",
    sourceClass: "PopupMenuPointOfInterest",
    position: { x: 10, y: 20 },
    renderer: { className: "PopupMenuPOINode", spriteFile: "empty.png" },
    hasEncounterTable: false,
    randomPopulators: [],
    unusedEncounterFixedEncounters: [],
    demoSkipped: ["customInteraction"],
  } as never;
}

function makeNodeFixture() {
  const profile = new PlayerProfile({
    heroLevel: 3,
    monsterPartyLevels: [1],
    silver: 1_234,
    gold: 56,
    captureCards: { 1: 2, 2: 1, 3: 0 },
  });
  const party = {
    monsters: vi.fn(() => [{ instanceId: "m-1", shortType: "FireCub", level: 1 }]),
    stateSnapshot: vi.fn(() => ({
      schemaVersion: 1,
      battingOrderSize: 1,
      monsters: [{ instanceId: "m-1", shortType: "FireCub", level: 1 }],
      ownedSoulStones: [],
    })),
  };
  const assets = {
    hasSprite: vi.fn((_key: string) => true),
    sprite: vi.fn(async (name: string) =>
      name === "NewsScreen" ? texture(1024, 768) : texture(220, 120)),
  };
  const image = deferredLoader();
  const open = vi.fn();
  const audio = { playSfx: vi.fn() };
  const onStateChanged = vi.fn();
  const authority = {
    navigate: vi.fn(),
    leaveTown: vi.fn(),
    claimTutorialFlag: vi.fn(),
    claimDialog: vi.fn(),
    submitParty: vi.fn(),
    submitQuest: vi.fn(),
    submitPlayer: vi.fn(),
    submitStore: vi.fn(),
  };
  const world = {
    name: "World_Test",
    map: { className: "CCSprite", spriteFile: "world.png", anchor: { x: 0, y: 0 } },
    pointsOfInterest: [townPoi()],
    connections: [],
  };
  const trip = {
    currentPoiName: "First_City",
    poiStates: vi.fn(() => new Map([["First_City", 2]])),
  };
  const keyboard = { register: vi.fn() };
  const deps = {
    world,
    trip,
    party,
    playerRuntime: { profile, party },
    game: {
      strings: {},
      assets,
      scale9: {
        MenuButton2: {
          contentRect: "{{9,6},{84,17}}",
          image: "PopupMenuButton2.png",
        },
      },
    },
    keyboard,
    audio,
    poiRouting: createWorldPoiRoutingPolicy(),
    // These cases exercise the screen BEHIND the source blocker, so they lift it explicitly. The
    // shipped default (`blackMarketAvailability.ts`) keeps `-[BlackMarketMenuItem activate:]`'s
    // not-ready branch instead; `worldNodeBlackMarketNotReady.test.ts` covers that.
    blackMarketServiceReady: true,
    blackMarketDemo: {
      backgroundSpriteKey: "NewsScreen",
      imageLoader: image.loader,
      opener: { open } satisfies ExternalPageOpener,
    },
    authority: { ...authority, egg: { pendingEgg: () => undefined } },
    onStateChanged,
  };
  const construct = WorldNode as unknown as new (deps: never) => WorldNode;
  const node = new construct(deps as never);
  const internals = node as unknown as {
    activeTown: { poi: typeof world.pointsOfInterest[number]; display: unknown };
  };
  internals.activeTown = { poi: world.pointsOfInterest[0]!, display: {} };
  return { node, profile, party, world, trip, authority, onStateChanged, image, open, audio, assets };
}

describe("WorldNode Black Market demo integration", () => {
  it("owns one modal, blocks town input, and leaves all durable and authority state unchanged", async () => {
    const fixture = makeNodeFixture();
    // Intentional narrow seam: this fixture does not construct the full animated TownPoiDisplay
    // (which also needs the scene ticker, town-entry transition, and every authored building
    // sprite). Calling the private activation route after installing the same active-town guard
    // proves the Black Market action, modal ownership/swallowing, close/Escape routing, and
    // mutation boundary. It is not a claim of full pointer-coordinate proof; that remains a
    // later browser-level check through the real town display event.
    const activateTownBuilding = (WorldNode.prototype as unknown as {
      activateTownBuilding(this: WorldNode, definition: { className: string; sourceIndex: number }):
        Promise<void>;
    }).activateTownBuilding;
    const openBlackMarket = (WorldNode.prototype as unknown as {
      openBlackMarketDemo(this: WorldNode): Promise<void>;
    }).openBlackMarketDemo;
    const handleKeyboardShortcut = (fixture.node as any).handleKeyboardShortcut as
      (shortcut: { key: string }) => boolean;
    const hasModal = (WorldNode.prototype as unknown as {
      hasModal(this: WorldNode): boolean;
    }).hasModal;
    const snapshot = () => ({
      profile: fixture.profile.stateSnapshot(),
      inventory: fixture.profile.stateSnapshot().inventory,
      party: fixture.party.stateSnapshot(),
      world: {
        data: structuredClone(fixture.world),
        currentPoiName: fixture.trip.currentPoiName,
        states: [...fixture.trip.poiStates()],
      },
      authority: Object.fromEntries(
        Object.entries(fixture.authority).map(([name, method]) => [name, method.mock.calls.length]),
      ),
    });
    const before = snapshot();

    await activateTownBuilding.call(fixture.node, {
      className: "BlackMarketMenuItem",
      sourceIndex: 0,
    });
    expect(fixture.audio.playSfx).toHaveBeenCalledWith("click");
    const active = (fixture.node as any).activeBlackMarketDemo as Container;
    await openBlackMarket.call(fixture.node);
    expect((fixture.node as any).activeBlackMarketDemo).toBe(active);
    expect(fixture.image.requests).toHaveLength(2);
    expect(hasModal.call(fixture.node)).toBe(true);
    expect((fixture.node as any).overlayDebugState({ depth: 0, stack: [] })).toMatchObject({
      kind: "black-market-demo",
      adaptation: "DEMO CONTENT",
      cardIds: BLACK_MARKET_DEMO_CARDS.map(({ id }) => id),
    });

    const underlyingTownInput = vi.fn();
    const stopPropagation = vi.fn();
    active.emit("pointertap", { stopPropagation } as never);
    if (stopPropagation.mock.calls.length === 0) underlyingTownInput();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(underlyingTownInput).not.toHaveBeenCalled();

    const card = active.children.find((child) => child.label === "blackMarketDemo:card:community")!;
    card.emit("pointertap", { stopPropagation: vi.fn() } as never);
    expect(fixture.open).toHaveBeenCalledWith(
      "https://example.org/",
      "_blank",
      "noopener,noreferrer",
    );

    expect(handleKeyboardShortcut({ key: "escape" })).toBe(false);
    (fixture.node as any).keyboardActive = true;
    expect(handleKeyboardShortcut({ key: "escape" })).toBe(true);
    expect(hasModal.call(fixture.node)).toBe(false);
    expect(snapshot()).toEqual(before);
    for (const method of Object.values(fixture.authority)) expect(method).not.toHaveBeenCalled();
    expect(fixture.onStateChanged).not.toHaveBeenCalled();

    fixture.node.destroy();
    expect(fixture.onStateChanged).not.toHaveBeenCalled();
  });

  it.each([
    ["configuration", (fixture: ReturnType<typeof makeNodeFixture>) => {
      (fixture.node as any).deps.blackMarketDemo = undefined;
    }],
    ["background", (fixture: ReturnType<typeof makeNodeFixture>) => {
      fixture.assets.hasSprite.mockImplementation((key: string) => key !== "NewsScreen");
    }],
    ["MenuButton2 configuration", (fixture: ReturnType<typeof makeNodeFixture>) => {
      (fixture.node as any).deps.game.scale9.MenuButton2 = undefined;
    }],
    ["resolved MenuButton2 sprite", (fixture: ReturnType<typeof makeNodeFixture>) => {
      fixture.assets.hasSprite.mockImplementation((key: string) => key !== "PopupMenuButton2-hd");
    }],
    ["both close-button variants", (fixture: ReturnType<typeof makeNodeFixture>) => {
      fixture.assets.hasSprite.mockImplementation((key: string) =>
        key !== "PopupMenuCloseButton-hd" && key !== "PopupMenuCloseButton");
    }],
  ] as const)("keeps the concrete building fail-closed without %s", (_missing, configure) => {
    const fixture = makeNodeFixture();
    const townBuildingIsEnabled = (WorldNode.prototype as unknown as {
      townBuildingIsEnabled(this: WorldNode, definition: { className: string }): boolean;
    }).townBuildingIsEnabled;
    configure(fixture);

    expect(townBuildingIsEnabled.call(fixture.node, { className: "BlackMarketMenuItem" }))
      .toBe(false);
  });

  it.each([
    ["hd", "PopupMenuCloseButton"],
    ["base", "PopupMenuCloseButton-hd"],
  ] as const)("accepts the shipped %s close-button variant when the other is absent", (_variant, missing) => {
    const fixture = makeNodeFixture();
    fixture.assets.hasSprite.mockImplementation((key: string) => key !== missing);
    const townBuildingIsEnabled = (WorldNode.prototype as unknown as {
      townBuildingIsEnabled(this: WorldNode, definition: { className: string }): boolean;
    }).townBuildingIsEnabled;

    expect(townBuildingIsEnabled.call(fixture.node, { className: "BlackMarketMenuItem" }))
      .toBe(true);
  });

  it("releases modal ownership after an active structural rejection and permits a successful retry", async () => {
    const fixture = makeNodeFixture();
    const expected = new Error("MenuButton2 frame failed");
    let rejectFrame = true;
    fixture.assets.sprite.mockImplementation(async (name: string) => {
      if (name === "PopupMenuButton2-hd" && rejectFrame) throw expected;
      if (name === "NewsScreen") return texture(1024, 768);
      if (name === "PopupMenuCloseButton-hd") return texture(64, 64);
      return texture(220, 120);
    });
    const openBlackMarket = (WorldNode.prototype as unknown as {
      openBlackMarketDemo(this: WorldNode): Promise<void>;
    }).openBlackMarketDemo;
    const hasModal = (WorldNode.prototype as unknown as {
      hasModal(this: WorldNode): boolean;
    }).hasModal;

    await expect(openBlackMarket.call(fixture.node)).rejects.toBe(expected);
    expect((fixture.node as any).activeBlackMarketDemo).toBeUndefined();
    expect(hasModal.call(fixture.node)).toBe(false);

    rejectFrame = false;
    await openBlackMarket.call(fixture.node);
    expect((fixture.node as any).activeBlackMarketDemo).toBeDefined();
    expect(fixture.image.requests).toHaveLength(2);

    fixture.node.destroy();
    expect((fixture.node as any).activeBlackMarketDemo).toBeUndefined();
  });

  it("suppresses a rejected structural asset after WorldNode disposal during mounting", async () => {
    const fixture = makeNodeFixture();
    let rejectBackground!: (reason: unknown) => void;
    const pendingBackground = new Promise<Texture>((_resolve, reject) => {
      rejectBackground = reject;
    });
    fixture.assets.sprite.mockImplementation(async (name: string) => {
      if (name === "NewsScreen") return pendingBackground;
      if (name === "PopupMenuCloseButton-hd") return texture(64, 64);
      return texture(220, 120);
    });
    const activateTownBuilding = (WorldNode.prototype as unknown as {
      activateTownBuilding(this: WorldNode, definition: { className: string; sourceIndex: number }):
        Promise<void>;
    }).activateTownBuilding;
    const hasModal = (WorldNode.prototype as unknown as {
      hasModal(this: WorldNode): boolean;
    }).hasModal;

    const activation = activateTownBuilding.call(fixture.node, {
      className: "BlackMarketMenuItem",
      sourceIndex: 0,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (fixture.assets.sprite.mock.calls.some(([name]) => name === "NewsScreen")) break;
      await Promise.resolve();
    }
    expect(fixture.assets.sprite).toHaveBeenCalledWith("NewsScreen");

    fixture.node.destroy();
    rejectBackground(new Error("background rejected after WorldNode disposal"));
    await expect(activation).resolves.toBeUndefined();

    expect((fixture.node as any).activeBlackMarketDemo).toBeUndefined();
    expect(hasModal.call(fixture.node)).toBe(false);
    expect(fixture.image.requests).toHaveLength(0);
    expect(fixture.onStateChanged).not.toHaveBeenCalled();
  });

  it("cancels the WorldNode-owned pending image requests during scene disposal", async () => {
    const fixture = makeNodeFixture();
    const openBlackMarket = (WorldNode.prototype as unknown as {
      openBlackMarketDemo(this: WorldNode): Promise<void>;
    }).openBlackMarketDemo;
    await openBlackMarket.call(fixture.node);
    expect(fixture.image.requests).toHaveLength(2);

    fixture.node.destroy();

    expect(fixture.image.requests.every(({ cancel }) => cancel)).toBe(true);
    expect(fixture.image.requests.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
  });
});
