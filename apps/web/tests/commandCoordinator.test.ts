import { describe, expect, it, vi } from "vitest";
import {
  GAME_PROTOCOL_VERSION,
  type GameCommandEnvelopeV1,
  type GameCommandResultV1,
  type LogicPackDescriptorV1,
  type SlotProjectionV1,
} from "@dib/game-protocol";
import {
  CommandBusyError,
  CommandCoordinator,
  CommandRecoveredBeforeNewIntentError,
  CommandStateResyncedError,
} from "../src/authority/commandCoordinator.js";
import {
  RemoteGameAuthorityError,
  type GameAuthority,
} from "../src/authority/gameAuthorityClient.js";

const pack: LogicPackDescriptorV1 = {
  logicPackId: `logic-v1:${"c".repeat(64)}`,
  simulationVersion: "dib-sim-v1",
  trustTier: "official",
  capabilities: {
    slot: true, world: true, battle: false, capture: false, spirit: false, party: false,
    economy: false, dungeon: false, quests: false, plot: false, tournaments: false,
    commandTypes: ["slot.create", "world.navigate"],
  },
};

function projection(revision: number, poi = "Town"): SlotProjectionV1 {
  return {
    slotId: "slot-1",
    revision,
    logicPackId: pack.logicPackId,
    simulationVersion: pack.simulationVersion,
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
    location: { kind: "world", worldId: "World_1-1", poiId: poi },
    decision: {
      type: "world.ready",
      decisionId: `decision-${revision}`,
      selectablePoiIds: ["Town", "Forest"],
    },
  };
}

function result(envelope: GameCommandEnvelopeV1): GameCommandResultV1 {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    commandId: envelope.commandId,
    previousRevision: envelope.expectedRevision,
    revision: envelope.expectedRevision + 1,
    eventCursorStart: 1,
    eventCursorEnd: 1,
    events: [{
      seq: 1,
      type: "world.arrived",
      worldId: "World_1-1",
      poiId: "Forest",
      movement: "walk",
      randomDraws: [],
    }],
    projection: projection(envelope.expectedRevision + 1, "Forest"),
    idempotentReplay: false,
  };
}

function authority(
  command: GameAuthority["command"],
  bootstrap: GameAuthority["bootstrap"] = async () => projection(1),
): GameAuthority {
  return {
    trustTier: "official",
    pack,
    slots: [],
    bootstrap,
    command,
    deleteSlot: async () => {},
    refreshSlots: async () => [],
    close: async () => {},
  };
}

describe("CommandCoordinator", () => {
  it("acknowledges reversible input before waiting for the network", async () => {
    let release!: (value: GameCommandResultV1) => void;
    const response = new Promise<GameCommandResultV1>((resolve) => { release = resolve; });
    let captured!: GameCommandEnvelopeV1;
    const coordinator = new CommandCoordinator(authority(async (_slot, envelope) => {
      captured = envelope;
      return response;
    }), "slot-1", projection(1), { commandId: () => "command_nav_forest_1" });
    const order: string[] = [];
    const submitted = coordinator.submit(
      { type: "world.navigate", targetPoiId: "Forest" },
      { onIntentAccepted: () => { order.push("feedback"); } },
    );
    order.push("returned");
    expect(order).toEqual(["feedback", "returned"]);
    expect(coordinator.pending).toBe(true);
    release(result(captured));
    await submitted;
    expect(coordinator.projection.location).toMatchObject({ poiId: "Forest" });
    expect(coordinator.pending).toBe(false);
  });

  it("retries a lost response with the exact same command envelope", async () => {
    const seen: GameCommandEnvelopeV1[] = [];
    const coordinator = new CommandCoordinator(authority(async (_slot, envelope) => {
      seen.push(envelope);
      if (seen.length === 1) throw new RemoteGameAuthorityError("INTERNAL", "socket reset", true);
      return { ...result(envelope), idempotentReplay: true };
    }), "slot-1", projection(1), {
      commandId: () => "command_nav_forest_1",
      retryAttempts: 1,
    });
    await coordinator.submit({ type: "world.navigate", targetPoiId: "Forest" });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
  });

  it("rejects a second mutation while one is pending", async () => {
    let release!: (value: GameCommandResultV1) => void;
    let captured!: GameCommandEnvelopeV1;
    const response = new Promise<GameCommandResultV1>((resolve) => { release = resolve; });
    const coordinator = new CommandCoordinator(authority(async (_slot, envelope) => {
      captured = envelope;
      return response;
    }), "slot-1", projection(1), { commandId: () => "command_nav_forest_1" });
    const first = coordinator.submit({ type: "world.navigate", targetPoiId: "Forest" });
    await expect(coordinator.submit({ type: "world.navigate", targetPoiId: "Town" }))
      .rejects.toBeInstanceOf(CommandBusyError);
    release(result(captured));
    await first;
  });

  it("never fabricates a commit after a rejected command", async () => {
    const committed = vi.fn();
    const rejected = vi.fn();
    const coordinator = new CommandCoordinator(authority(
      async () => {
        throw new RemoteGameAuthorityError("DECISION_STALE", "stale", false, 2);
      },
      async () => projection(2, "Forest"),
    ), "slot-1", projection(1), { commandId: () => "command_nav_forest_1" });
    await expect(coordinator.submit(
      { type: "world.navigate", targetPoiId: "Forest" },
      { onCommitted: committed, onRejected: rejected },
    )).rejects.toBeInstanceOf(CommandStateResyncedError);
    expect(committed).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledOnce();
    expect(coordinator.projection.revision).toBe(2);
  });

  it("recovers an uncertain response before admitting a new intent", async () => {
    const seen: GameCommandEnvelopeV1[] = [];
    let reachable = false;
    const coordinator = new CommandCoordinator(authority(async (_slot, envelope) => {
      seen.push(envelope);
      if (!reachable) throw new RemoteGameAuthorityError("INTERNAL", "offline", true);
      return { ...result(envelope), idempotentReplay: true };
    }), "slot-1", projection(1), {
      commandId: () => "command_nav_forest_1",
      retryAttempts: 0,
    });
    await expect(coordinator.submit({ type: "world.navigate", targetPoiId: "Forest" }))
      .rejects.toMatchObject({ retryable: true });
    expect(coordinator.pending).toBe(true);
    await expect(coordinator.submit({ type: "world.navigate", targetPoiId: "Town" }))
      .rejects.toMatchObject({ retryable: true });
    reachable = true;
    await expect(coordinator.submit({ type: "world.navigate", targetPoiId: "Town" }))
      .rejects.toBeInstanceOf(CommandRecoveredBeforeNewIntentError);
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    expect(coordinator.pending).toBe(false);
    expect(coordinator.projection.revision).toBe(2);
  });
});
