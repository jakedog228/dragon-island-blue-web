import { Rectangle, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { AssetLibrary } from "@dib/renderer";
import { HeroDisplay } from "../src/battle/heroDisplay.js";
import { HERO_SHADER_UPDATE_MS } from "../src/battle/heroDisplayMath.js";
import type { BattlePlayerProfile } from "../src/player/battlePlayerState.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

function assets(): AssetLibrary {
  return { sprite: vi.fn(async () => Texture.EMPTY) } as unknown as AssetLibrary;
}

function profile(): BattlePlayerProfile {
  return {
    spiritSnapshot: () => ({
      energy: 100,
      readiness: 1,
      full: true,
      spirits: [{ shortType: "Fire", savedXp: 0, tierLevel: 0, usedThisTrip: false }],
    }),
  } as BattlePlayerProfile;
}

describe("HeroDisplay touch ownership", () => {
  it("owns the portrait-shaped swallowing target above its reveal/frame children", async () => {
    const pressed = vi.fn();
    const hero = await HeroDisplay.create(assets(), {
      profile: profile(),
      enabled: true,
      onPress: pressed,
    });
    expect(hero.eventMode).toBe("static");
    expect(hero.hitArea).toBeInstanceOf(Rectangle);
    expect(hero.children.every((child) => child.eventMode === "none")).toBe(true);
    const stopPropagation = vi.fn();
    hero.emit("pointertap", { stopPropagation } as never);
    expect(pressed).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();

    hero.update(150);
    expect(hero.debugState.flashOpacity).toBe(51 / 255);
    hero.update(149);
    expect(hero.debugState.flashOpacity).toBe(101 / 255);
    hero.update(HERO_SHADER_UPDATE_MS - 299); // scheduler fires after the action-manager step
    expect(hero.debugState.flashOpacity).toBe(0);
    hero.update(150);
    expect(hero.debugState.flashOpacity).toBe(51 / 255);

    hero.setEnabled(false);
    hero.emit("pointertap", { stopPropagation } as never);
    expect(pressed).toHaveBeenCalledOnce();
    hero.destroy({ children: true });
  });
});
