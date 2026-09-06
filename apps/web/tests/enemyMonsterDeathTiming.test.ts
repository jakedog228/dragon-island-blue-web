import { describe, expect, it, vi } from "vitest";
import { EnemyMonsterDisplay } from "../src/battle/enemyMonsterDisplay.js";
import { ENEMY_SLOT_HEIGHT, ENEMY_SLOT_WIDTH } from "../src/battle/displayShared.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});
vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));

class FakeTicker {
  deltaMS = 500;
  private readonly listeners = new Set<() => void>();
  add(listener: () => void): void { this.listeners.add(listener); }
  remove(listener: () => void): void { this.listeners.delete(listener); }
  tick(): void { for (const listener of [...this.listeners]) listener(); }
}

type DeathHarness = {
  stopped: boolean;
  ticker: FakeTicker;
  baseSpriteY: number;
  monsterNode: {
    destroyed: boolean;
    position: { x: number; y: number; set(x: number, y: number): void };
    scale: { x: number; y: number; set(x: number, y: number): void };
    rotation: number;
  };
  shake(ms: number, offset: number): Promise<void>;
};

const prototype = EnemyMonsterDisplay.prototype as unknown as {
  performDeathAnimation(this: DeathHarness, captureSuccess: boolean): Promise<void>;
  shake(this: DeathHarness, ms: number, offset: number): Promise<void>;
};

async function flushActions(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("EnemyMonsterDisplay source-parallel death lifetime", () => {
  it("removes the complete widget at two seconds while the sprite animation finishes", async () => {
    const ticker = new FakeTicker();
    const position = {
      x: 999,
      y: 999,
      set(x: number, y: number): void { this.x = x; this.y = y; },
    };
    const scale = {
      x: 1,
      y: 1,
      set(x: number, y: number): void { this.x = x; this.y = y; },
    };
    const harness: DeathHarness = {
      stopped: false,
      ticker,
      baseSpriteY: ENEMY_SLOT_HEIGHT / 2,
      monsterNode: { destroyed: false, position, scale, rotation: 0 },
      shake: prototype.shake,
    };

    let finished = false;
    const pending = prototype.performDeathAnimation.call(harness, false).then(() => { finished = true; });
    expect(position).toMatchObject({ x: ENEMY_SLOT_WIDTH / 2, y: ENEMY_SLOT_HEIGHT / 2 });

    ticker.tick(); // 0.5s
    await flushActions();
    ticker.tick(); // 1.0s: shake ends; shrink/spin begin
    await flushActions();
    ticker.tick(); // 1.5s
    await flushActions();
    expect(finished).toBe(false);

    ticker.tick(); // 2.0s: sprite sequence and parent removal timer end together
    await pending;
    expect(finished).toBe(true);
    expect(scale.y).toBe(0);
    expect(harness.monsterNode.rotation).toBeCloseTo(Math.PI * 4);
  });

  it("retires the death action when terminal scene teardown destroys its Pixi transform", async () => {
    const ticker = new FakeTicker();
    const position = {
      x: 999,
      y: 999,
      set(x: number, y: number): void { this.x = x; this.y = y; },
    };
    const scale = {
      x: 1,
      y: 1,
      set(x: number, y: number): void { this.x = x; this.y = y; },
    };
    const harness: DeathHarness = {
      stopped: false,
      ticker,
      baseSpriteY: ENEMY_SLOT_HEIGHT / 2,
      monsterNode: { destroyed: false, position, scale, rotation: 0 },
      shake: prototype.shake,
    };

    let finished = false;
    const pending = prototype.performDeathAnimation.call(harness, false).then(() => { finished = true; });

    ticker.tick(); // 0.5s
    await flushActions();
    ticker.tick(); // 1.0s: shake ends and spin/shrink listeners are installed
    await flushActions();

    // Pixi's recursive Container.destroy({ children:true }) leaves the object reference and
    // destroyed flag in place but releases the transform members used by position/scale.
    harness.monsterNode.destroyed = true;
    (harness.monsterNode as unknown as { position: null }).position = null;
    (harness.monsterNode as unknown as { scale: null }).scale = null;

    expect(() => ticker.tick()).not.toThrow(); // 1.5s: used to throw at scale.set(...)
    await flushActions();
    expect(() => ticker.tick()).not.toThrow(); // 2.0s: action lifetime still settles normally
    await pending;
    expect(finished).toBe(true);
  });
});
