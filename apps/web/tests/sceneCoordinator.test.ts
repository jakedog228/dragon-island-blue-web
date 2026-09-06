import { describe, expect, it } from "vitest";
import {
  SceneCoordinator,
  SceneHandlerRegistry,
  type ManagedScene,
} from "../src/sceneCoordinator.js";

class TestScene implements ManagedScene<"world" | "battle" | "town"> {
  readonly events: string[] = [];

  constructor(readonly sceneKind: "world" | "battle" | "town") {}

  setSceneVisible(visible: boolean): void {
    this.events.push(`visible:${visible}`);
  }

  renderGameState(): Record<string, unknown> {
    return { mode: this.sceneKind };
  }

  destroy(): void {
    this.events.push("destroy");
  }
}

describe("SceneCoordinator", () => {
  it("publishes one active scene and owns exactly-once outgoing retirement", async () => {
    const coordinator = new SceneCoordinator<TestScene, "content" | "start">("content");
    coordinator.setShellMode("start");
    const world = new TestScene("world");
    await coordinator.replace(world);
    expect(coordinator.mode).toBe("world");
    expect(coordinator.renderGameState()).toEqual({ mode: "world" });

    const battle = new TestScene("battle");
    await coordinator.replace(battle, async ({ outgoing, activate, retireOutgoing }) => {
      expect(outgoing).toBe(world);
      expect(coordinator.current).toBe(world);
      activate();
      expect(coordinator.current).toBe(battle);
      retireOutgoing();
      retireOutgoing();
    });
    expect(world.events).toEqual(["visible:true", "destroy"]);
    expect(battle.events).toEqual(["visible:true"]);
  });

  it("rejects overlapping transitions without disturbing either scene", async () => {
    const coordinator = new SceneCoordinator<TestScene, "start">("start");
    const world = new TestScene("world");
    await coordinator.replace(world);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const battle = new TestScene("battle");
    const transition = coordinator.replace(battle, async () => gate);
    expect(coordinator.transitionInProgress).toBe(true);
    await expect(coordinator.replace(new TestScene("town"))).rejects.toThrow(/already in progress/);
    expect(coordinator.current).toBe(world);
    release();
    await transition;
    expect(coordinator.current).toBe(battle);
  });

  it("lets a nested scene request wait for the active transition to finish", async () => {
    const coordinator = new SceneCoordinator<TestScene, "start">("start");
    const world = new TestScene("world");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transition = coordinator.replace(world, async ({ activate }) => {
      activate();
      await gate;
    });

    let idle = false;
    const waiting = coordinator.whenIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);

    release();
    await transition;
    await waiting;
    expect(idle).toBe(true);
    expect(coordinator.current).toBe(world);
  });

  it("retains an outgoing scene for a source-style battle return", async () => {
    const coordinator = new SceneCoordinator<TestScene, "start">("start");
    const world = new TestScene("world");
    await coordinator.replace(world);

    const battle = new TestScene("battle");
    await coordinator.replace(battle, ({ retainOutgoing, activate }) => {
      retainOutgoing();
      activate();
    });
    expect(coordinator.current).toBe(battle);
    expect(world.events).toEqual(["visible:true", "visible:false"]);

    await coordinator.replace(world);
    expect(coordinator.current).toBe(world);
    expect(world.events).toEqual(["visible:true", "visible:false", "visible:true"]);
    expect(battle.events).toEqual(["visible:true", "destroy"]);
  });

  it("restores retained outgoing visibility when activation fails", async () => {
    const coordinator = new SceneCoordinator<TestScene, "start">("start");
    const world = new TestScene("world");
    await coordinator.replace(world);
    const battle = new TestScene("battle");

    await expect(coordinator.replace(battle, ({ retainOutgoing }) => {
      retainOutgoing();
      throw new Error("covered transition failed");
    })).rejects.toThrow("covered transition failed");
    expect(coordinator.current).toBe(world);
    expect(world.events).toEqual(["visible:true", "visible:false", "visible:true"]);
    expect(battle.events).toEqual(["destroy"]);
  });

  it("keeps a retained incoming scene caller-owned when restoration fails", async () => {
    const coordinator = new SceneCoordinator<TestScene, "start">("start");
    const world = new TestScene("world");
    await coordinator.replace(world);
    const battle = new TestScene("battle");
    await coordinator.replace(battle, ({ retainOutgoing, activate }) => {
      retainOutgoing();
      activate();
    });

    await expect(coordinator.replace(world, () => {
      throw new Error("return fade failed");
    }, { preserveIncomingOnFailure: true })).rejects.toThrow("return fade failed");
    expect(coordinator.current).toBe(battle);
    expect(world.events).toEqual(["visible:true", "visible:false"]);

    await coordinator.replace(world);
    expect(coordinator.current).toBe(world);
    expect(battle.events).toEqual(["visible:true", "destroy"]);
  });

  it("destroys an unpublished incoming scene and preserves the outgoing scene on failure", async () => {
    const coordinator = new SceneCoordinator<TestScene, "start">("start");
    const world = new TestScene("world");
    await coordinator.replace(world);
    const battle = new TestScene("battle");
    await expect(coordinator.replace(battle, () => {
      throw new Error("prepare failed");
    })).rejects.toThrow("prepare failed");
    expect(coordinator.current).toBe(world);
    expect(world.events).toEqual(["visible:true"]);
    expect(battle.events).toEqual(["destroy"]);
  });
});

describe("SceneHandlerRegistry", () => {
  it("dispatches open scene ids and fails loudly for missing or duplicate handlers", async () => {
    const registry = new SceneHandlerRegistry<{ route: { sceneId: string }; value: number }>();
    const values: number[] = [];
    const unregister = registry.register("town", ({ value }) => { values.push(value); });
    await registry.dispatch({ route: { sceneId: "town" }, value: 7 });
    expect(values).toEqual([7]);
    expect(() => registry.register("town", () => undefined)).toThrow(/duplicate/);
    unregister();
    await expect(registry.dispatch({ route: { sceneId: "town" }, value: 8 })).rejects.toThrow(/no handler/);
  });
});
