import { Texture, type Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { AssetLibrary } from "@dib/renderer";
import {
  nearestTurnOrderHit,
  TurnOrderDisplay,
  type TurnOrderMonsterInfo,
  type TurnOrderProvider,
} from "../src/battle/turnOrderDisplay.js";
import { turnOrderEntryY } from "../src/battle/displayShared.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});
vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));

class DisplayTicker {
  deltaMS = 16;
  readonly listeners = new Set<() => void>();

  add(listener: () => void): void { this.listeners.add(listener); }
  remove(listener: () => void): void { this.listeners.delete(listener); }
  tick(): void { for (const listener of [...this.listeners]) listener(); }
}

async function advance(ticker: DisplayTicker, frames: number): Promise<void> {
  for (let frame = 0; frame < frames; frame++) {
    ticker.tick();
    // Let nested async continuations (atlas loads, generation checks) register before the next
    // fixed frame -- the same allowance `createTickerAdvancer` makes in the browser harness.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

/** Frames needed to run `ms` of action time, including the opening elapsed-0 frame. */
function frames(ms: number): number {
  return Math.ceil(ms / 16) + 1;
}

function assets(): AssetLibrary {
  const general = {
    "monsterHpBarBack.png": Texture.EMPTY,
    "monsterHpBar.png": Texture.EMPTY,
  };
  const portraits = {
    "Gnoll_icon.png": Texture.EMPTY,
    "FireCub_icon.png": Texture.EMPTY,
    "SnowCub_icon.png": Texture.EMPTY,
  };
  return {
    atlas: vi.fn(async (name: string) => ({
      textures: name === "General-hd" ? general : portraits,
    })),
  } as unknown as AssetLibrary;
}

const NAMES: Record<string, string> = { gnoll: "Gnoll", fireCub: "FireCub", snowCub: "SnowCub" };

interface Harness {
  ticker: DisplayTicker;
  display: TurnOrderDisplay;
  provider: TurnOrderProvider;
  order: string[];
  delays: Map<string, number>;
  hp: Map<string, number>;
  setOrder(next: string[]): void;
  delayTextOf(id: string): string | undefined;
  hpRatioOf(id: string): number | undefined;
  scaleXOf(id: string): number | undefined;
}

/** Builds a column of `fireCub, gnoll, snowCub` and drives its `onEnter` slide-in to rest. */
async function harness(initial = ["fireCub", "gnoll", "snowCub"]): Promise<Harness> {
  const state: Harness = {
    ticker: new DisplayTicker(),
    order: [...initial],
    delays: new Map([["fireCub", 0], ["gnoll", 40], ["snowCub", 80]]),
    hp: new Map([["fireCub", 10], ["gnoll", 10], ["snowCub", 10]]),
  } as Harness;

  state.provider = {
    order: vi.fn(() => [...state.order]),
    delayOf: vi.fn((id: string) => state.delays.get(id) ?? 0),
    infoOf: vi.fn((id: string): TurnOrderMonsterInfo => ({
      name: NAMES[id] ?? id,
      hp: state.hp.get(id) ?? 10,
      maxHp: 10,
      team: id === "gnoll" ? 1 : 0,
      colorTint: 0xff6464,
    })),
  };
  state.display = new TurnOrderDisplay({
    assets: assets(),
    ticker: state.ticker as unknown as Ticker,
    provider: state.provider,
  });
  state.setOrder = (next) => {
    state.order = [...next];
  };
  state.delayTextOf = (id) => state.display.liveEntryState.find((e) => e.id === id)?.delayText;
  state.hpRatioOf = (id) => state.display.liveEntryState.find((e) => e.id === id)?.hpRatio;
  state.scaleXOf = (id) => state.display.liveEntryState.find((e) => e.id === id)?.scaleX;

  const init = state.display.initialize();
  // The three sequential entry builds consume frames of their own before the slide-in starts.
  await advance(state.ticker, frames(500) + 30);
  await init;
  return state;
}

describe("TurnOrderDisplay battle-scene lifecycle", () => {
  it("uses the source 55pt origin rect and nearest-center arbitration in overlapping entries", () => {
    const entries = [
      { id: "front", team: 0 as const, x: 12, y: 34 },
      { id: "second", team: 1 as const, x: 12, y: 68 },
    ];

    // Both 55pt rectangles contain y=52, but the second origin is closer.
    expect(nearestTurnOrderHit(entries, { x: 12, y: 52 })).toEqual({ id: "second", team: 1 });
    expect(nearestTurnOrderHit(entries, { x: 12, y: 50 })).toEqual({ id: "front", team: 0 });
    expect(nearestTurnOrderHit(entries, { x: 12, y: 51 })).toEqual({ id: "front", team: 0 });
    expect(nearestTurnOrderHit(entries, { x: 40, y: 34 })).toBeUndefined();
  });

  it("cancels a removed entry's three-second fall before destroying its Pixi transform", async () => {
    const h = await harness(["gnoll"]);

    h.setOrder([]);
    await h.display.notifyTeamRemovedMonsters(["gnoll"]);
    expect(h.display.fallingEntryState.map((e) => e.id)).toEqual(["gnoll"]);
    // The whole widget now schedules through one CCActionManager slot, so the fall is a live
    // action inside that single listener rather than two independent tween listeners.
    expect(h.ticker.listeners.size).toBe(1);

    h.display.destroy({ children: true });
    expect(h.ticker.listeners.size).toBe(0);
    expect(() => h.ticker.tick()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.ticker.listeners.size).toBe(0);
  });

  it("compacts a terminal removal without sampling the already-advanced provider state", async () => {
    const h = await harness();
    const frontBefore = h.display.liveEntryState.find((entry) => entry.id === "fireCub")!;
    const trailingBefore = h.display.liveEntryState.find((entry) => entry.id === "snowCub")!;
    const orderCallsBefore = vi.mocked(h.provider.order).mock.calls.length;
    const delayCallsBefore = vi.mocked(h.provider.delayOf).mock.calls.length;

    // The engine queue has already committed the turn and now differs from the frozen terminal UI.
    h.setOrder(["snowCub", "fireCub"]);
    h.delays.set("fireCub", 60);
    h.delays.set("snowCub", 0);
    const removal = h.display.freezeTerminalRemoval(["gnoll"]);
    await advance(h.ticker, frames(500) + 2);
    await removal;

    const frontAfter = h.display.liveEntryState.find((entry) => entry.id === "fireCub")!;
    const trailingAfter = h.display.liveEntryState.find((entry) => entry.id === "snowCub")!;
    expect(h.display.displayedOrder).toEqual(["fireCub", "snowCub"]);
    expect(h.display.fallingEntryState.map((entry) => entry.id)).toEqual(["gnoll"]);
    expect({ x: frontAfter.x, y: frontAfter.y, scaleX: frontAfter.scaleX }).toEqual({
      x: frontBefore.x,
      y: frontBefore.y,
      scaleX: frontBefore.scaleX,
    });
    expect({ x: trailingAfter.x, y: trailingAfter.y, scaleX: trailingAfter.scaleX }).toEqual({
      x: trailingBefore.x,
      y: trailingBefore.y - 34,
      scaleX: trailingBefore.scaleX,
    });
    expect(vi.mocked(h.provider.order)).toHaveBeenCalledTimes(orderCallsBefore);
    expect(vi.mocked(h.provider.delayOf)).toHaveBeenCalledTimes(delayCallsBefore);

    h.display.destroy({ children: true });
  });

  it("admits every battle-time notification immediately instead of queueing them", async () => {
    const h = await harness();

    // Three legal acknowledgments inside 32ms. `-[Battle advanceQueWithCounter:]` notifies its
    // listeners synchronously and never waits for the sidebar, so all three must reach runAction:.
    h.setOrder(["gnoll", "snowCub", "fireCub"]);
    void h.display.notifyBattleTimePassed();
    await advance(h.ticker, 1);
    h.setOrder(["snowCub", "fireCub", "gnoll"]);
    void h.display.notifyBattleTimePassed();
    await advance(h.ticker, 1);
    h.setOrder(["gnoll", "fireCub", "snowCub"]);
    void h.display.notifyBattleTimePassed();

    expect(h.display.counters.battleTimeNotifications).toBe(3);
    expect(h.display.counters.frontSequencesAdmitted).toBe(3);
    // All three peel the SAME still-displayed front, because `nodeOrder` is only committed by the
    // live callback -- three overlapping sequences on one node, exactly as `runAction:` allows.
    // A FIFO would have dispatched only the first within 32ms of the burst.
    expect(h.display.isAnimatingFrontChange).toBe(true);

    h.display.destroy({ children: true });
  });

  it("samples the LIVE queue and delays in the delayed callback, not the dispatch snapshot", async () => {
    const h = await harness();

    // Dispatch a front change against B,C,A.
    h.setOrder(["gnoll", "snowCub", "fireCub"]);
    h.delays.set("gnoll", 0);
    h.delays.set("snowCub", 40);
    h.delays.set("fireCub", 80);
    void h.display.notifyBattleTimePassed();

    // Still inside the 1.0s flip+slide: the column has NOT committed the new order yet, exactly as
    // `nodeOrder` is only replaced from `warpNodesExcludingObject:`.
    await advance(h.ticker, frames(900));
    expect(h.display.displayedOrder).toEqual(["fireCub", "gnoll", "snowCub"]);

    // The engine moves on again before that callback runs.
    h.setOrder(["snowCub", "fireCub", "gnoll"]);
    h.delays.set("snowCub", 0);
    h.delays.set("fireCub", 25);
    h.delays.set("gnoll", 55);

    await advance(h.ticker, frames(1050) - frames(900) + 4);

    expect(h.display.displayedOrder).toEqual(["snowCub", "fireCub", "gnoll"]);
    expect(h.delayTextOf("snowCub")).toBe("  0");
    expect(h.delayTextOf("fireCub")).toBe(" 25");
    expect(h.delayTextOf("gnoll")).toBe(" 55");

    h.display.destroy({ children: true });
  });

  it("converges one callback horizon after a burst rather than replaying every request", async () => {
    const h = await harness();
    const rotations = [
      ["gnoll", "snowCub", "fireCub"],
      ["snowCub", "fireCub", "gnoll"],
      ["fireCub", "gnoll", "snowCub"],
      ["gnoll", "snowCub", "fireCub"],
      ["snowCub", "fireCub", "gnoll"],
    ];
    for (const next of rotations) {
      h.setOrder(next);
      void h.display.notifyBattleTimePassed();
      await advance(h.ticker, 2); // ~32ms apart, the legal acknowledgment cadence
    }
    h.delays.set("snowCub", 0);
    h.delays.set("fireCub", 30);
    h.delays.set("gnoll", 70);

    // Under the old FIFO this state needed 5 x 1.5s to drain. One callback horizon is enough here.
    await advance(h.ticker, frames(1100));
    expect(h.display.displayedOrder).toEqual(["snowCub", "fireCub", "gnoll"]);
    expect(h.delayTextOf("snowCub")).toBe("  0");
    expect(h.delayTextOf("gnoll")).toBe(" 70");

    h.display.destroy({ children: true });
  });

  it("takes the same-front arm straight into a live warp with no flip or slide", async () => {
    const h = await harness();
    const orderCallsBefore = vi.mocked(h.provider.order).mock.calls.length;

    // Front identity is unchanged; only the tail and the delays moved.
    h.setOrder(["fireCub", "snowCub", "gnoll"]);
    h.delays.set("snowCub", 12);
    h.delays.set("gnoll", 90);
    void h.display.notifyBattleTimePassed();
    await advance(h.ticker, 2);

    // `updateOrder`'s same-front arm calls `warpNodesExcludingObject:nil` immediately, so the
    // labels and the logical order are current within a frame -- no 1.0s wait.
    expect(h.display.displayedOrder).toEqual(["fireCub", "snowCub", "gnoll"]);
    expect(h.delayTextOf("snowCub")).toBe(" 12");
    expect(h.delayTextOf("gnoll")).toBe(" 90");
    expect(vi.mocked(h.provider.order).mock.calls.length).toBeGreaterThan(orderCallsBefore);
    expect(h.scaleXOf("fireCub")).toBe(1);

    h.display.destroy({ children: true });
  });

  it("continues a second flip from the live scale instead of snapping back to +1", async () => {
    const h = await harness();

    h.setOrder(["gnoll", "snowCub", "fireCub"]);
    void h.display.notifyBattleTimePassed();
    await advance(h.ticker, frames(250)); // fireCub is mid-flip, around scaleX 0

    const midFlip = h.scaleXOf("fireCub")!;
    expect(midFlip).toBeLessThan(0.2);
    expect(midFlip).toBeGreaterThan(-0.2);

    // A second acknowledgment lands while the first sequence is still running. `nodeOrder` has not
    // been committed yet, so fireCub is peeled again -- and `CCScaleTo` must capture where it IS.
    h.setOrder(["snowCub", "fireCub", "gnoll"]);
    void h.display.notifyBattleTimePassed();
    await advance(h.ticker, 1);

    const afterAdmission = h.scaleXOf("fireCub")!;
    expect(Math.abs(afterAdmission - midFlip)).toBeLessThan(0.1);
    expect(afterAdmission).toBeLessThan(0.2);

    h.display.destroy({ children: true });
  });

  it("never writes HP from a queue callback -- syncLivingHp owns it", async () => {
    const h = await harness();
    expect(h.hpRatioOf("gnoll")).toBe(1);

    h.setOrder(["gnoll", "snowCub", "fireCub"]);
    void h.display.notifyBattleTimePassed();

    // The engine's HP moves while the front sequence is in flight, but no health event is
    // delivered. `notifyLiving:healthChangedTo:delta:` is a separate source listener, so the
    // column must not pick this up from its queue reconciliation.
    await advance(h.ticker, frames(400));
    h.hp.set("gnoll", 3);
    await advance(h.ticker, frames(1200) - frames(400));
    expect(h.display.displayedOrder[0]).toBe("gnoll"); // the live callback did run
    expect(h.hpRatioOf("gnoll")).toBe(1);

    // ...and the real health event applies immediately.
    h.display.syncLivingHp("gnoll");
    expect(h.hpRatioOf("gnoll")).toBe(0.3);

    // A later callback must not rewind it either.
    h.setOrder(["snowCub", "fireCub", "gnoll"]);
    void h.display.notifyBattleTimePassed();
    await advance(h.ticker, frames(1600));
    expect(h.hpRatioOf("gnoll")).toBe(0.3);

    h.display.destroy({ children: true });
  });

  it("lets a pre-terminal sequence finish its own restore without touching the frozen column", async () => {
    const h = await harness();

    h.setOrder(["gnoll", "snowCub", "fireCub"]);
    void h.display.notifyBattleTimePassed();
    await advance(h.ticker, frames(400)); // mid-flip, callback still ~600ms away

    // Terminal turn resolves first. The port's engine has already rotated the survivors and
    // relabelled them, and native suppresses the post-advance battle-time notification.
    h.setOrder(["snowCub", "fireCub"]);
    h.delays.set("fireCub", 60);
    h.delays.set("snowCub", 0);
    const terminal = h.display.freezeTerminalRemoval(["gnoll"]);
    const orderCallsAtFreeze = vi.mocked(h.provider.order).mock.calls.length;

    await advance(h.ticker, frames(1600));
    await terminal;

    // The retired callback neither resurrected gnoll, nor rotated, nor relabelled the survivors.
    expect(h.display.displayedOrder).toEqual(["fireCub", "snowCub"]);
    expect(h.delayTextOf("fireCub")).toBe("  0");
    expect(h.delayTextOf("snowCub")).toBe(" 80");
    expect(vi.mocked(h.provider.order).mock.calls.length).toBe(orderCallsAtFreeze);
    // It DID finish its own transform restore, so nothing is left permanently mirrored.
    expect(h.scaleXOf("fireCub")).toBeCloseTo(1, 5);
    // And a later notification is refused outright.
    await h.display.notifyBattleTimePassed();
    expect(vi.mocked(h.provider.order).mock.calls.length).toBe(orderCallsAtFreeze);

    h.display.destroy({ children: true });
  });

  it("slides a promoted reserve in from its own add notification, not the front-change callback", async () => {
    const h = await harness();
    (NAMES as Record<string, string>)["snowCub2"] = "SnowCub";
    h.delays.set("snowCub2", 120);


    const preAdvance = ["fireCub", "snowCub", "snowCub2"];
    const removal = h.display.notifyTeamRemovedMonsters(["gnoll"]);
    h.setOrder(["snowCub", "snowCub2", "fireCub"]);
    const orderCallsBeforeAdd = vi.mocked(h.provider.order).mock.calls.length;

    const added = h.display.notifyTeamAddedMonsters(["snowCub2"], { projectedOrder: preAdvance });
    await advance(h.ticker, 2);
    await added;

    // The add resolves on ADMISSION: the node exists, the projection is the committed order, and
    // the post-turn provider was never sampled for it.
    expect(h.display.displayedOrder).toEqual(preAdvance);
    expect(vi.mocked(h.provider.order).mock.calls.length).toBe(orderCallsBeforeAdd);
    expect(h.display.liveEntryState.some((entry) => entry.id === "snowCub2")).toBe(true);

    // Only now does the battle-time update admit the 1.5s front change, exactly as
    // `advanceQueWithCounter:` follows `fireMonsterEntered:`.
    const battleTime = h.display.notifyBattleTimePassed();
    await advance(h.ticker, 4);
    const joining = h.display.liveEntryState.find((entry) => entry.id === "snowCub2");
    // Under 70ms in, the joiner is already off its `addNodeForMonster:` origin -- the whole point.
    expect(joining!.y).toBeGreaterThan(0);
    expect(joining!.y).toBeLessThan(turnOrderEntryY(2));

    await advance(h.ticker, frames(500));
    // Half a second in: the front sequence is still peeling/sliding, and the joiner has ALREADY
    // finished its 0.5s slide -- the source ordering the port used to invert.
    expect(h.display.isAnimatingFrontChange).toBe(true);
    expect(h.display.liveEntryState.find((entry) => entry.id === "snowCub2")!.y)
      .toBeCloseTo(turnOrderEntryY(2), 3);

    // Past the front change AND past gnoll's 3s removal fall, so nothing is left outstanding.
    await advance(h.ticker, frames(3100));
    await Promise.all([removal, battleTime]);
    await h.display.whenSettled();


    expect(h.display.displayedOrder).toEqual(["snowCub", "snowCub2", "fireCub"]);
    expect(h.display.liveEntryState.find((entry) => entry.id === "snowCub2")!.y)
      .toBeCloseTo(turnOrderEntryY(1), 3);
    // The joiner arrived through the team listener, so the non-source net found nothing to do.
    expect(h.display.counters.membershipSafetyNet).toBe(0);

    h.display.destroy({ children: true });
  });

  it("peels at the add when the column is still a front behind the projected queue", async () => {
    const h = await harness();
    (NAMES as Record<string, string>)["snowCub2"] = "SnowCub";
    h.delays.set("snowCub2", 120);


    h.setOrder(["gnoll", "snowCub", "fireCub"]);
    const battleTime = h.display.notifyBattleTimePassed();
    await advance(h.ticker, 2);
    expect(h.display.displayedOrder[0]).toBe("fireCub");
    const sequencesBeforeAdd = h.display.counters.frontSequencesAdmitted;

    // Now a reserve joins inside that window. The source's `updateOrder` compares against the
    // stale `nodeOrder` at EVERY dispatch, the team-add listener included, so this add takes the
    // front-changed arm rather than the same-front warp -- the asymmetric case a projection must
    // not assume away.
    const projected = ["gnoll", "snowCub", "snowCub2", "fireCub"];
    h.setOrder(projected);
    const added = h.display.notifyTeamAddedMonsters(["snowCub2"], { projectedOrder: projected });
    await advance(h.ticker, 2);
    await added;

    expect(h.display.counters.frontSequencesAdmitted).toBe(sequencesBeforeAdd + 1);
    // The peel does not commit `nodeOrder` -- only the live callback does, exactly as in the source.
    expect(h.display.displayedOrder[0]).toBe("fireCub");

    await advance(h.ticker, frames(3100));
    await battleTime;
    await h.display.whenSettled();

    // Both callbacks converge on the live queue, and the joiner still arrived through the team
    // listener rather than the non-source net.
    expect(h.display.displayedOrder).toEqual(projected);
    expect(h.display.counters.membershipSafetyNet).toBe(0);

    h.display.destroy({ children: true });
  });

  it("discards an entry load whose subject left the queue while the atlas was in flight", async () => {
    const h = await harness();

    // A summon joins, then is removed before its portrait resolves.
    h.setOrder(["fireCub", "gnoll", "snowCub", "snowCub2"]);
    h.delays.set("snowCub2", 120);
    (NAMES as Record<string, string>)["snowCub2"] = "SnowCub";
    const added = h.display.notifyTeamAddedMonsters(["snowCub2"]);
    h.setOrder(["fireCub", "gnoll", "snowCub"]);
    await h.display.notifyTeamRemovedMonsters(["snowCub2"]);

    await advance(h.ticker, frames(600));
    await added;
    await h.display.whenSettled();

    expect(h.display.liveEntryState.map((e) => e.id).sort()).toEqual(["fireCub", "gnoll", "snowCub"]);
    expect(h.display.displayedOrder).toEqual(["fireCub", "gnoll", "snowCub"]);
    expect(h.display.counters.membershipSafetyNet).toBe(0);

    h.display.destroy({ children: true });
  });
});
