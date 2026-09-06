import { describe, it, expect, beforeEach, vi } from "vitest";

const poisonRandCallbacks = vi.hoisted(() => [] as Array<() => number>);

// pixi.js can't be imported for real under vitest (module-scope browser sniffing) — same mock
// approach as abilityRendererDispatch.test.ts, extended with addChildAt (the status subsystem's
// behind-monster insert). These tests pin the MULTI-HOST reconciliation logic added for Gap 1:
// every registered display gets its OWN overlay for a living (status-effects.md §1 — N displays ⇒
// N overlays), which is what lets the turn panel's acting-card FriendlyMonsterDisplay show a
// poisoned/slept actor's overlay even while the field friendly row is hidden. The Pixi mount
// mechanics themselves are proven by the browser scenarios; here the tween loop simply hangs under
// a no-op ticker, so each mount leaves exactly its holder behind for us to observe.
vi.mock("pixi.js", () => {
  const makePoint = (v: number) => ({
    x: v,
    y: v,
    set(a: number, b: number = a) {
      this.x = a;
      this.y = b;
    },
  });
  class Container {
    children: Container[] = [];
    label = "";
    sortableChildren = false;
    width = 100;
    height = 100;
    position = makePoint(0);
    scale = makePoint(1);
    anchor = makePoint(0.5);
    alpha = 1;
    tint = 0xffffff;
    visible = true;
    destroyed = false;
    addChild<T extends Container>(c: T): T {
      this.children.push(c);
      return c;
    }
    addChildAt<T extends Container>(c: T, index: number): T {
      this.children.splice(index, 0, c);
      return c;
    }
    removeChild<T extends Container>(c: T): T {
      this.children = this.children.filter((x) => x !== c);
      return c;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class Graphics extends Container {}
  class Sprite extends Container {}
  class Texture {}
  return { Container, Graphics, Sprite, Texture };
});

vi.mock("@dib/renderer", async () => {
  const { Sprite } = await import("pixi.js");
  return {
    // pointSprite just needs the anchor/scale/position surface the mount functions touch.
    pointSprite: () => new Sprite(),
    CONTENT_SCALE_FACTOR: 2,
  };
});

// The exact point-particle simulation has its own focused suite. These controller tests need a
// deterministic mounted emitter so they can pin Poison-specific host/hydration reconciliation.
vi.mock("../src/battle/poisonStatusEmitter.js", async () => {
  const { Container } = await import("pixi.js");
  return {
    PoisonStatusEmitter: class extends Container {
      particleCount = 3;
      constructor(_asset: unknown, _ticker: unknown, _mode: unknown, rand: () => number) {
        super();
        poisonRandCallbacks.push(rand);
        this.label = "statusOverlay:poison";
      }
      start() {}
    },
  };
});

import { Sprite, Container } from "pixi.js";
import type { Ticker } from "pixi.js";
import { StatusOverlayController, type StatusOverlayHost } from "../src/battle/statusOverlay.js";

/** A no-op ticker — tween's `step` never fires, so every spawn loop parks after its first mount. */
const ticker = { add: () => undefined, remove: () => undefined, deltaMS: 16 } as unknown as Ticker;

/** Minimal AssetLibrary: only sprite() is exercised by the non-poison overlays used here. */
const assets = {
  sprite: () => Promise.resolve(new (class {})()),
  particle: () => Promise.resolve({ config: {}, texture: {} }),
} as unknown as ConstructorParameters<typeof StatusOverlayController>[0]["assets"];

/** One display node standing in for a monster sprite the overlay mounts onto. */
function makeDisplay(id: string): { host: StatusOverlayHost; sprite: Sprite } {
  const sprite = new Sprite();
  const host: StatusOverlayHost = {
    monsterSpriteOf: (queryId) => (queryId === id ? sprite : null),
    attachBehindMonster: (queryId, node) => {
      if (queryId !== id) return false;
      sprite.addChildAt(node as unknown as Container, 0);
      return true;
    },
  };
  return { host, sprite };
}

/** Count live (non-destroyed) status-overlay holders mounted on a display's sprite. */
function overlayHolders(sprite: Sprite): Container[] {
  return sprite.children.filter((c) => !c.destroyed && String(c.label).startsWith("statusOverlay"));
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const ID = "t0m0:FireCub";

describe("StatusOverlayController — multi-host (N displays ⇒ N overlays, Gap 1)", () => {
  let field: ReturnType<typeof makeDisplay>;
  let controller: StatusOverlayController;

  beforeEach(() => {
    poisonRandCallbacks.length = 0;
    field = makeDisplay(ID);
    controller = new StatusOverlayController({
      assets,
      ticker,
      host: field.host,
      statusRandom: () => 0.5,
    });
  });

  it("mounts on the field host when a status becomes active", async () => {
    controller.onBuffAdded(ID, ["Sleep"]);
    await flush();
    expect(overlayHolders(field.sprite)).toHaveLength(1);
    expect(controller.debugStateOf(ID).Sleep).toBe(true);
  });

  it("uses the shared source RNG once per Sleep/Confuse host spawn", async () => {
    let draws = 0;
    const statusRandom = () => { draws += 1; return 0.5; };
    const shared = new StatusOverlayController({ assets, ticker, host: field.host, statusRandom });
    shared.onBuffAdded(ID, ["Sleep"]);
    await flush();
    expect(draws).toBe(1);

    const acting = makeDisplay(ID);
    shared.addHost(acting.host);
    await flush();
    expect(draws).toBe(2);
  });

  it("keeps Poison's libc-random stream separate from the shared Sleep/Confuse stream", async () => {
    const statusRandom = vi.fn(() => 0.75);
    const particleRandom = () => 0.25;
    const shared = new StatusOverlayController({
      assets,
      ticker,
      host: field.host,
      statusRandom,
      particleRandom,
    });
    shared.onBuffAdded(ID, ["Poison"]);
    await flush();
    expect(poisonRandCallbacks).toEqual([particleRandom]);
    expect(statusRandom).not.toHaveBeenCalled();
  });

  it("a display registered WHILE a status is already active catches up (acting-card path)", async () => {
    // The actor was already slept on a previous turn; the panel's acting card registers now.
    controller.onBuffAdded(ID, ["Sleep"]);
    await flush();
    const acting = makeDisplay(ID);
    const dispose = controller.addHost(acting.host);
    await flush();
    // Both the field card AND the freshly-registered acting card carry their own overlay.
    expect(overlayHolders(field.sprite)).toHaveLength(1);
    expect(overlayHolders(acting.sprite)).toHaveLength(1);

    // Unregistering the acting card tears down ONLY its overlay; the field one keeps running.
    dispose();
    expect(overlayHolders(acting.sprite)).toHaveLength(0);
    expect(overlayHolders(field.sprite)).toHaveLength(1);
    expect(controller.debugStateOf(ID).Sleep).toBe(true);
  });

  it("a status that turns on AFTER a second display is registered mounts on both", async () => {
    const acting = makeDisplay(ID);
    controller.addHost(acting.host);
    controller.onBuffAdded(ID, ["Paralyze"]);
    await flush();
    expect(overlayHolders(field.sprite)).toHaveLength(1);
    expect(overlayHolders(acting.sprite)).toHaveLength(1);
  });

  it("removing the status tears down every host's overlay", async () => {
    const acting = makeDisplay(ID);
    controller.addHost(acting.host);
    controller.onBuffAdded(ID, ["Sleep"]);
    await flush();
    controller.onBuffRemoved(ID, ["Sleep"]);
    expect(overlayHolders(field.sprite)).toHaveLength(0);
    expect(overlayHolders(acting.sprite)).toHaveLength(0);
    expect(controller.debugStateOf(ID).Sleep).toBe(false);
  });

  it("stacking a second same-status buff never doubles the overlay on any host", async () => {
    const acting = makeDisplay(ID);
    controller.addHost(acting.host);
    controller.onBuffAdded(ID, ["Sleep"]);
    controller.onBuffAdded(ID, ["Sleep"]); // second Poison/Sleep stack — 1→2, no new transition
    await flush();
    expect(overlayHolders(field.sprite)).toHaveLength(1);
    expect(overlayHolders(acting.sprite)).toHaveLength(1);
  });

  it("hydrates an exact reconnect stack and hides only after its final removal", async () => {
    controller.hydrateCounts(ID, { Sleep: 2, Paralyze: 0, Poison: 0, Confuse: 0 });
    await flush();
    expect(overlayHolders(field.sprite)).toHaveLength(1);

    controller.onBuffRemoved(ID, ["Sleep"]);
    expect(overlayHolders(field.sprite)).toHaveLength(1);
    controller.onBuffRemoved(ID, ["Sleep"]);
    expect(overlayHolders(field.sprite)).toHaveLength(0);
  });

  it("mounts live Poison particles and keeps one emitter for a stacked status", async () => {
    controller.onBuffAdded(ID, ["Poison"]);
    controller.onBuffAdded(ID, ["Poison"]);
    await flush();
    expect(overlayHolders(field.sprite)).toHaveLength(1);
    expect(controller.debugStateOf(ID).Poison).toBe(true);
    expect(controller.debugPoisonParticleCountOf(ID)).toBe(3);

    controller.onBuffRemoved(ID, ["Poison"]);
    expect(controller.debugStateOf(ID).Poison).toBe(true);
    controller.onBuffRemoved(ID, ["Poison"]);
    expect(controller.debugStateOf(ID).Poison).toBe(false);
    expect(controller.debugPoisonParticleCountOf(ID)).toBe(0);
  });

  it("hydrates Poison onto every display and disposes every rebuilt emitter", async () => {
    controller.hydrateCounts(ID, { Sleep: 0, Paralyze: 0, Poison: 2, Confuse: 0 });
    const acting = makeDisplay(ID);
    controller.addHost(acting.host);
    await flush();
    expect(overlayHolders(field.sprite)).toHaveLength(1);
    expect(overlayHolders(acting.sprite)).toHaveLength(1);
    expect(controller.debugPoisonParticleCountOf(ID)).toBe(6);

    controller.dispose();
    expect(overlayHolders(field.sprite)).toHaveLength(0);
    expect(overlayHolders(acting.sprite)).toHaveLength(0);
    expect(controller.debugPoisonParticleCountOf(ID)).toBe(0);
  });

  it("retries a hydrated overlay when its living later enters this host", async () => {
    const sprite = new Sprite();
    let visible = false;
    const lateHost: StatusOverlayHost = {
      monsterSpriteOf: (queryId) => queryId === ID && visible ? sprite : null,
      attachBehindMonster: () => false,
    };
    const lateController = new StatusOverlayController({
      assets,
      ticker,
      host: lateHost,
      statusRandom: () => 0.5,
    });
    lateController.hydrateCounts(ID, { Sleep: 1, Paralyze: 0, Poison: 0, Confuse: 0 });
    await flush();
    expect(overlayHolders(sprite)).toHaveLength(0);

    visible = true;
    lateController.refreshHostsFor(ID);
    await flush();
    expect(overlayHolders(sprite)).toHaveLength(1);
  });

  it("retries a hydrated Poison emitter after an initially absent host appears", async () => {
    const sprite = new Sprite();
    let visible = false;
    const lateHost: StatusOverlayHost = {
      monsterSpriteOf: (queryId) => queryId === ID && visible ? sprite : null,
      attachBehindMonster: (queryId, node) => {
        if (queryId !== ID || !visible) return false;
        sprite.addChildAt(node as unknown as Container, 0);
        return true;
      },
    };
    const lateController = new StatusOverlayController({
      assets,
      ticker,
      host: lateHost,
      statusRandom: () => 0.5,
    });
    lateController.hydrateCounts(ID, { Sleep: 0, Paralyze: 0, Poison: 1, Confuse: 0 });
    await flush();
    expect(lateController.debugStateOf(ID).Poison).toBe(false);

    visible = true;
    lateController.refreshHostsFor(ID);
    await flush();
    expect(lateController.debugStateOf(ID).Poison).toBe(true);
    expect(lateController.debugPoisonParticleCountOf(ID)).toBe(3);
  });
});
