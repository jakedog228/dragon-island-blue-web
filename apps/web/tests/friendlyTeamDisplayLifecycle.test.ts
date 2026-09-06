import { Container, Texture, type Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { AssetLibrary } from "@dib/renderer";
import type { BattlePlayerProfile } from "../src/player/battlePlayerState.js";
import { FriendlyTeamDisplay } from "../src/battle/friendlyTeamDisplay.js";
import type { FriendlyMonsterDisplay } from "../src/battle/friendlyMonsterDisplay.js";

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

describe("FriendlyTeamDisplay battle-scene lifecycle", () => {
  it("drops dying-card lookup ownership at player-turn start without destroying the node", () => {
    const display = new FriendlyTeamDisplay({
      assets: {} as AssetLibrary,
      ticker: new DisplayTicker() as unknown as Ticker,
      profile: {} as BattlePlayerProfile,
    });
    const destroy = vi.fn();
    const internal = display as unknown as {
      dyingCards: Map<string, FriendlyMonsterDisplay>;
    };
    internal.dyingCards.set("gone", { destroy } as unknown as FriendlyMonsterDisplay);

    display.notifyPlayerTurnStarted();

    expect(internal.dyingCards.size).toBe(0);
    expect(destroy).not.toHaveBeenCalled();
    display.destroy({ children: true });
  });

  it("never sends setMainLiving: to an ordinary field card", () => {
    const display = new FriendlyTeamDisplay({
      assets: {} as AssetLibrary,
      ticker: new DisplayTicker() as unknown as Ticker,
      profile: {} as BattlePlayerProfile,
    });
    const setMainLiving = vi.fn();
    const card = {
      contentHeight: 40,
      position: { x: 0, y: 0, set: vi.fn() },
      setMainLiving,
    } as unknown as FriendlyMonsterDisplay;
    const internal = display as unknown as {
      order: string[];
      cards: Map<string, FriendlyMonsterDisplay>;
      adjustMonsterSlots: (animate: boolean) => void;
    };
    internal.order.push("front");
    internal.cards.set("front", card);

    internal.adjustMonsterSlots(false);

    expect(setMainLiving).not.toHaveBeenCalled();
    display.destroy({ children: true });
  });

  it("cancels a source-owned pop-forward before its sibling scene node is destroyed", async () => {
    const ticker = new DisplayTicker();
    const display = new FriendlyTeamDisplay({
      assets: {} as AssetLibrary,
      ticker: ticker as unknown as Ticker,
      profile: {} as BattlePlayerProfile,
    });
    const internal = display as unknown as {
      cards: Map<string, FriendlyMonsterDisplay>;
    };
    internal.cards.set("metal", {
      monsterTexture: Texture.EMPTY,
    } as FriendlyMonsterDisplay);

    const scene = new Container();
    scene.addChild(display);
    const pending = display.popForward("metal", scene, 2);
    expect(ticker.listeners.size).toBe(1);

    // BattleNode's scene teardown destroys the display and its direct-scene spotlight together.
    // The display must detach the spotlight's ticker action before Pixi nulls either transform.
    display.destroy({ children: true });
    expect(ticker.listeners.size).toBe(0);
    scene.destroy({ children: true });
    expect(() => ticker.tick()).not.toThrow();

    await pending;
    expect(ticker.listeners.size).toBe(0);
  });
});
