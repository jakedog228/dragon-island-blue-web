import { Container } from "pixi.js";
import { EggReel, mulberry32, type EggHatchPrize } from "@dib/engine";
import { describe, expect, it, vi } from "vitest";
import { EggHatchFlow } from "../src/world/eggHatchFlow.js";
import type { EggReleaseCommitment } from "../src/world/eggHatchSession.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgent: "vitest" },
  });
});

describe("Egg release presentation authority", () => {
  it("does not award a stopped provisional coast; displays the committed slot once", async () => {
    let resolveRelease!: (commitment: EggReleaseCommitment) => void;
    const released = new Promise<EggReleaseCommitment>(resolve => { resolveRelease = resolve; });
    const prizes: EggHatchPrize[] = [
      { kind: "monster", shortType: "Spikey", level: 1, prizeMonster: false },
      { kind: "monster", shortType: "Wolf", level: 1, prizeMonster: false },
    ];
    const parent = new Container();
    const ticker = { deltaMS: 1000 / 60, remove: vi.fn() };
    const session = { release: vi.fn(() => released) };
    const flow = Reflect.construct(EggHatchFlow, [{
      kind: "silver", parent, ticker, session,
      player: { profile: { heroLevel: 1 } },
    }]) as {
      tick(): void;
      commitRelease(): void;
      readonly debugState: EggHatchFlow["debugState"];
    };
    const presentPrize = vi.fn(async () => undefined);
    const root = new Container();
    parent.addChild(root);
    Object.assign(flow, {
      root, reel: new EggReel(2, mulberry32(7)),
      pool: { kind: "silver", providers: prizes, reel: prizes },
      entries: prizes.map(prize => ({ prize, root: new Container() })),
      presentPrize,
    });
    // Exercise the actual tick/reel, outlasting the complete fastest provisional coast.
    for (let i = 0; i < 100; i++) flow.tick();
    flow.commitRelease();
    for (let i = 0; i < 1000; i++) flow.tick();
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(flow.debugState.reel?.stopped).toBe(true);
    expect(flow.debugState.phase).toBe("rolling");
    expect(flow.debugState.selected).toBeNull();
    expect(presentPrize).not.toHaveBeenCalled();
    expect(root.parent).toBe(parent);
    const committedIndex = (flow.debugState.reel!.centerIndex + 1) % 2;
    resolveRelease({ friction: 2.9, finalReelState: {
      elapsedSeconds: 10, index: 10 + committedIndex, speed: 0, friction: 2.9,
      centerIndex: committedIndex, stopped: true,
    } });
    await Promise.resolve();
    for (let i = 0; i < 100; i++) flow.tick();
    expect(flow.debugState.phase).toBe("reward");
    expect(flow.debugState.selected).toEqual(prizes[committedIndex]);
    expect(presentPrize).toHaveBeenCalledTimes(1);
    expect(presentPrize).toHaveBeenCalledWith(prizes[committedIndex]);
    expect(root.parent).toBeNull();
  });
});
