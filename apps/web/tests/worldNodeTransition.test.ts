import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

class TransitionTicker {
  deltaMS = 0;
  readonly listeners = new Set<() => void>();
  get count(): number { return this.listeners.size; }
  add(listener: () => void): void { this.listeners.add(listener); }
  remove(listener: () => void): void { this.listeners.delete(listener); }
  tick(deltaMS: number): void {
    this.deltaMS = deltaMS;
    for (const listener of [...this.listeners]) listener();
  }
}

describe("WorldNode inter-world marker transition", () => {
  it("starts the hidden marker's 0.5-second fade only when the transition owner releases it", async () => {
    const ticker = new TransitionTicker();
    const marker = { visible: false, alpha: 0, destroyed: false };
    const receiver = {
      deps: { stage: { app: { ticker } } },
      marker,
      markerRevealAbort: undefined,
      isAlive: () => true,
    };
    const revealMarkerAfterTransition = (WorldNode.prototype as unknown as {
      revealMarkerAfterTransition(this: typeof receiver): void;
    }).revealMarkerAfterTransition;

    // Scene construction leaves the source-hidden marker alone. The transition owner invokes the
    // reveal only after `slideEndAtPOIName:`'s one-second screen movement has completed.
    expect(marker).toMatchObject({ visible: false, alpha: 0 });
    revealMarkerAfterTransition.call(receiver);
    expect(marker).toMatchObject({ visible: true, alpha: 0 });

    ticker.tick(250);
    expect(marker.alpha).toBeCloseTo(0.5, 12);
    ticker.tick(250);
    await Promise.resolve();
    await Promise.resolve();

    expect(marker.alpha).toBe(1);
    expect(ticker.listeners.size).toBe(0);
    expect(receiver.markerRevealAbort).toBeUndefined();
  });
});

describe("WorldNode forced-repeat marker transition", () => {
  it("runs the source non-adjacent fade sequence without moving a same-POI marker", async () => {
    const ticker = new TransitionTicker();
    const position = {
      x: 72,
      y: 91,
      set(x: number, y: number): void {
        this.x = x;
        this.y = y;
      },
    };
    const marker = { alpha: 1, position };
    const poi = { name: "Field", position: { x: 72, y: 229 } };
    const receiver = {
      deps: {
        stage: { app: { ticker } },
        world: { map: { indent: undefined } },
        trip: { currentPoiName: poi.name },
      },
      marker,
      walking: false,
      movementAbort: undefined as AbortController | undefined,
      cancelMovement(): void {
        this.movementAbort?.abort();
        this.movementAbort = undefined;
        this.walking = false;
      },
      isMovementOwner(owner: AbortController): boolean {
        return !owner.signal.aborted && this.movementAbort === owner;
      },
      isAlive: () => true,
      settleMarkerAt(target: typeof poi): void {
        // The source ends on the same authored coordinate at full opacity.
        this.marker.position.set(target.position.x, 320 - target.position.y);
        this.marker.alpha = 1;
      },
      requirePoi: () => poi,
    };
    const playMovement = (WorldNode.prototype as unknown as {
      playMovement(
        this: typeof receiver,
        previous: typeof poi,
        target: typeof poi,
        kind: "walk" | "teleport",
      ): Promise<{ kind: "completed" | "cancelled" }>;
    }).playMovement;

    const movement = playMovement.call(receiver, poi, poi, "teleport");
    expect(receiver.walking).toBe(true);

    ticker.tick(125);
    expect(marker.alpha).toBeCloseTo(0.5, 12);
    expect(position).toMatchObject({ x: 72, y: 91 });
    ticker.tick(125);
    expect(marker.alpha).toBe(0);
    await Promise.resolve();
    await Promise.resolve();

    ticker.tick(250);
    expect(marker.alpha).toBeCloseTo(0.5, 12);
    expect(position).toMatchObject({ x: 72, y: 91 });
    ticker.tick(250);
    await expect(movement).resolves.toEqual({ kind: "completed" });

    expect(marker.alpha).toBe(1);
    expect(position).toMatchObject({ x: 72, y: 91 });
    expect(receiver.walking).toBe(false);
    expect(receiver.movementAbort).toBeUndefined();
    expect(ticker.count).toBe(0);
  });

  it("starts that teleport fade before dispatching a same-POI forced encounter", async () => {
    const calls: string[] = [];
    const poi = { name: "Field", randomPopulators: [{}] };
    const movement = new Promise<{ kind: "completed" }>(() => {});
    const arrival = {
      kind: "encounter",
      movement: { adjacent: false, kind: "teleport" },
    };
    const receiver = {
      locked: false,
      walking: false,
      modalOpening: false,
      transitionFailure: undefined,
      hasModal: () => false,
      requirePoi: () => poi,
      deps: {
        trip: {
          currentPoiName: poi.name,
          poiState: () => 2,
          navigate: () => {
            calls.push("navigate");
            return arrival;
          },
        },
        poiRouting: { route: () => ({ kind: "navigate" }) },
        party: { projectAliveBattingPrefix: () => [{}] },
        world: { connections: [] },
        onStateChanged: () => calls.push("checkpoint"),
        onEncounter: () => calls.push("encounter"),
      },
      refreshPoiStates: () => calls.push("refresh"),
      playMovement: (_previous: typeof poi, _target: typeof poi, kind: string) => {
        calls.push(`movement:${kind}`);
        return movement;
      },
      dispatchOwnedTransition: (_label: string, _target: typeof poi, invoke: () => void) => {
        calls.push("dispatch");
        invoke();
      },
      presentReplayBattleTutorial: () => calls.push("tutorial"),
    };
    const handlePoiTap = (WorldNode.prototype as unknown as {
      handlePoiTap(this: typeof receiver, poiName: string): Promise<void>;
    }).handlePoiTap;

    await handlePoiTap.call(receiver, poi.name);

    expect(calls).toEqual([
      "navigate",
      "checkpoint",
      "refresh",
      "movement:teleport",
      "dispatch",
      "encounter",
    ]);
    expect(receiver.locked).toBe(true);
  });

  it("starts the reversible same-POI fade on Official intent acceptance without duplicating it", async () => {
    const calls: string[] = [];
    const poi = { name: "Field", randomPopulators: [{}] };
    const movement = new Promise<{ kind: "completed" }>(() => {});
    const arrival = {
      kind: "encounter",
      movement: { adjacent: false, kind: "teleport" },
    };
    const receiver = {
      locked: false,
      walking: false,
      modalOpening: false,
      transitionFailure: undefined,
      authoritativeNowSeconds: undefined,
      hasModal: () => false,
      requirePoi: () => poi,
      deps: {
        trip: {
          currentPoiName: poi.name,
          poiState: () => 2,
          navigate: () => {
            calls.push("local-navigate");
            return arrival;
          },
        },
        poiRouting: { route: () => ({ kind: "navigate" }) },
        party: { projectAliveBattingPrefix: () => [{}] },
        world: { connections: [] },
        authority: {
          navigate: async (_poiName: string, onIntentAccepted: () => void) => {
            calls.push("authority-accept");
            onIntentAccepted();
            calls.push("authority-commit");
            return { movement: "same", randomDraws: [] };
          },
        },
        onStateChanged: () => calls.push("checkpoint"),
        onEncounter: () => calls.push("encounter"),
      },
      cancelMovement: () => calls.push("cancel"),
      settleMarkerAt: () => calls.push("settle"),
      refreshPoiStates: () => calls.push("refresh"),
      playMovement: (_previous: typeof poi, _target: typeof poi, kind: string) => {
        calls.push(`movement:${kind}`);
        return movement;
      },
      dispatchOwnedTransition: (_label: string, _target: typeof poi, invoke: () => void) => {
        calls.push("dispatch");
        invoke();
      },
      presentReplayBattleTutorial: () => calls.push("tutorial"),
    };
    const handlePoiTap = (WorldNode.prototype as unknown as {
      handlePoiTap(this: typeof receiver, poiName: string): Promise<void>;
    }).handlePoiTap;

    await handlePoiTap.call(receiver, poi.name);

    expect(calls).toEqual([
      "authority-accept",
      "movement:teleport",
      "authority-commit",
      "local-navigate",
      "checkpoint",
      "refresh",
      "dispatch",
      "encounter",
    ]);
    expect(receiver.locked).toBe(true);
  });
});
