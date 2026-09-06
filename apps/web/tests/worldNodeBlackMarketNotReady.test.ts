import { describe, expect, it, vi } from "vitest";
import { PlayerProfile } from "@dib/player-domain";
import { WorldNode } from "../src/world/worldNode.js";
import { createWorldPoiRoutingPolicy } from "../src/world/worldPoiRouting.js";
import {
  BLACK_MARKET_AVAILABILITY,
  blackMarketServiceReady,
} from "../src/world/blackMarketAvailability.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

interface RecordedPopup {
  readonly strings: unknown;
  readonly zIndex: unknown;
  readonly owner: unknown;
}

const popupHarness: { calls: RecordedPopup[] } = { calls: [] };

vi.mock("../src/world/blackMarketNotReadyPopup.js", () => ({
  BLACK_MARKET_NOT_READY_MESSAGE_NAME: "BlackMarketLoading",
  showBlackMarketNotReadyPopup: async (options: Record<string, unknown>) => {
    popupHarness.calls.push({
      strings: options["strings"],
      zIndex: options["zIndex"],
      owner: options["owner"],
    });
    return { isDismissed: false, visible: true, dismiss: () => undefined };
  },
}));

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

/** Deliberately supplies NO `blackMarketDemo` configuration and no readiness override: this is
 *  the shipped default in which `-[BlackMarketMenuItem activate:]`'s not-ready branch is the only
 *  reachable behavior. */
function makeNodeFixture(overrides: Record<string, unknown> = {}) {
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
    // Structural demo resources are entirely absent; the source destination is still reachable.
    hasSprite: vi.fn((_key: string) => false),
    sprite: vi.fn(async (_name: string) => {
      throw new Error("the not-ready dialog must not request Black Market demo sprites");
    }),
  };
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
  const strings = {
    BlackMarketLoadingTitleKey: "Not Yet Ready",
    BlackMarketLoadingMessageKey:
      "Please try back in a minute or two. If you have no internet access you will need to " +
      "restore it before you can use this.",
    OkButtonKey: "Ok",
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
  const deps = {
    world,
    trip,
    party,
    playerRuntime: { profile, party },
    game: { strings, assets, scale9: {} },
    stage: { app: { ticker: {} } },
    keyboard: { register: vi.fn() },
    audio,
    poiRouting: createWorldPoiRoutingPolicy(),
    authority,
    onStateChanged,
    ...overrides,
  };
  const construct = WorldNode as unknown as new (deps: never) => WorldNode;
  const node = new construct(deps as never);
  const internals = node as unknown as {
    activeTown: { poi: typeof world.pointsOfInterest[number]; display: unknown };
  };
  internals.activeTown = { poi: world.pointsOfInterest[0]!, display: {} };
  return { node, profile, party, world, trip, authority, onStateChanged, audio, assets, strings };
}

const activateTownBuilding = (WorldNode.prototype as unknown as {
  activateTownBuilding(this: WorldNode, definition: { className: string; sourceIndex: number }):
    Promise<void>;
}).activateTownBuilding;
const townBuildingIsEnabled = (WorldNode.prototype as unknown as {
  townBuildingIsEnabled(this: WorldNode, definition: { className: string }): boolean;
}).townBuildingIsEnabled;
const hasModal = (WorldNode.prototype as unknown as {
  hasModal(this: WorldNode): boolean;
}).hasModal;

describe("Black Market source not-ready branch", () => {
  it("ships blocked, matching the retired News/Deals fetch", () => {
    expect(BLACK_MARKET_AVAILABILITY.serviceReady).toBe(false);
    expect(blackMarketServiceReady()).toBe(false);
    expect(blackMarketServiceReady({ serviceReady: true })).toBe(true);
  });

  it("keeps the building reachable without any structural demo resources", () => {
    const fixture = makeNodeFixture();


    expect(townBuildingIsEnabled.call(fixture.node, { className: "BlackMarketMenuItem" }))
      .toBe(true);
  });

  it("shows the source dialog instead of the demo, and mutates nothing", async () => {
    const fixture = makeNodeFixture();
    popupHarness.calls.length = 0;
    const snapshot = () => ({
      profile: fixture.profile.stateSnapshot(),
      party: fixture.party.stateSnapshot(),
      world: {
        data: structuredClone(fixture.world),
        currentPoiName: fixture.trip.currentPoiName,
        states: [...fixture.trip.poiStates()],
      },
    });
    const before = snapshot();

    await activateTownBuilding.call(fixture.node, {
      className: "BlackMarketMenuItem",
      sourceIndex: 0,
    });

    expect(fixture.audio.playSfx).toHaveBeenCalledWith("click");
    expect(popupHarness.calls).toHaveLength(1);
    expect(popupHarness.calls[0]!.strings).toBe(fixture.strings);
    expect(popupHarness.calls[0]!.owner).toBe(fixture.node);
    // The dialog is not a WorldNode-owned modal: its own Scale9Popup layer swallows input.
    expect((fixture.node as any).activeBlackMarketDemo).toBeUndefined();
    expect(hasModal.call(fixture.node)).toBe(false);
    expect(fixture.assets.sprite).not.toHaveBeenCalled();

    expect(snapshot()).toEqual(before);
    for (const method of Object.values(fixture.authority)) expect(method).not.toHaveBeenCalled();
    expect(fixture.onStateChanged).not.toHaveBeenCalled();
  });

  it("does not re-enter while a dialog activation is already in flight", async () => {
    const fixture = makeNodeFixture();
    popupHarness.calls.length = 0;
    (fixture.node as any).modalOpening = true;

    await activateTownBuilding.call(fixture.node, {
      className: "BlackMarketMenuItem",
      sourceIndex: 0,
    });

    expect(popupHarness.calls).toHaveLength(0);
  });

  it("stops showing the dialog once the blocker is lifted in configuration", async () => {
    const fixture = makeNodeFixture({ blackMarketServiceReady: true });
    popupHarness.calls.length = 0;

    // No `blackMarketDemo` configuration is supplied, so the unblocked route simply returns; the
    // point is that the source dialog is no longer what the building presents.
    await activateTownBuilding.call(fixture.node, {
      className: "BlackMarketMenuItem",
      sourceIndex: 0,
    });

    expect(popupHarness.calls).toHaveLength(0);
    expect(townBuildingIsEnabled.call(fixture.node, { className: "BlackMarketMenuItem" }))
      .toBe(false);
  });
});
