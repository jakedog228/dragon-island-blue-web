import { describe, expect, it, vi } from "vitest";
import { Container, EventBoundary, Rectangle, extensions, FederatedContainer } from "pixi.js";
import { AbilityRenderer } from "../src/battle/abilityRenderer.js";

vi.hoisted(() => Object.defineProperty(globalThis, "navigator", {
  configurable: true, value: { userAgent: "vitest" },
}));
// The browser registers this through Application; these tests use Pixi's real event boundary.
extensions.mixin(Container, FederatedContainer);

describe("combat effects over live input", () => {
  it.each(["passive", "static"] as const)("keeps controls and targets clickable under %s effect descendants", mode => {
    const scene = new Container();
    scene.eventMode = "static";
    scene.hitArea = new Rectangle(0, 0, 100, 100);
    const ability = new Container(), target = new Container();
    ability.eventMode = target.eventMode = "static";
    ability.hitArea = new Rectangle(0, 0, 20, 20);
    target.hitArea = new Rectangle(40, 40, 20, 20);
    scene.addChild(ability, target);
    const effects = new Container(), floater = new Container(), animation = new Container();
    floater.eventMode = animation.eventMode = mode;
    floater.hitArea = new Rectangle(0, 0, 20, 20);
    animation.hitArea = new Rectangle(40, 40, 20, 20);
    effects.addChild(floater, animation);
    scene.addChild(effects);
    const renderer = new AbilityRenderer({
      gameData: {} as never, animations: {} as never, meleeAttacks: {} as never,
      assets: {} as never, audio: { playSfx: () => {} }, effectLayer: effects, ticker: {} as never,
    });
    try {
      const boundary = new EventBoundary(scene);
      expect(boundary.hitTest(10, 10)).toBe(ability);
      expect(boundary.hitTest(50, 50)).toBe(target);
      expect(boundary.hitTest(90, 90)).toBe(scene);
      expect(effects.visible && floater.visible && animation.visible).toBe(true);
    } finally {
      renderer.dispose();
      scene.destroy({ children: true });
    }
  });
});
