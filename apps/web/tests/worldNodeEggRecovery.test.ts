import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgent: "vitest" },
  });
});

function harness(official = true) {
  let pending: object | undefined = { phase: "spinning" };
  const node = Object.assign(Object.create(WorldNode.prototype), {
    deps: { authority: official ? { egg: { pendingEgg: () => pending } } : undefined },
    tutorialClaims: new Map(),
    lifecycle: { disposed: false }, locked: false, modalOpening: false,
  }) as {
    scheduleTownEntryNotifications(present: () => void): void;
    flushDeferredTownEntryNotifications(): void;
    hasModal(): boolean;
    activeEggHatch?: object;
    lifecycle: { disposed: boolean };
  };
  return { node, finish: () => { pending = undefined; } };
}

describe("town entry behind a restored Official Egg", () => {
  it("blocks controls before hatch mount and presents deferred entry only after settlement and close", () => {
    const { node, finish } = harness();
    const present = vi.fn();
    node.scheduleTownEntryNotifications(present);
    expect(node.hasModal()).toBe(true);
    node.flushDeferredTownEntryNotifications();
    expect(present).not.toHaveBeenCalled();
    node.activeEggHatch = {};
    finish();
    node.flushDeferredTownEntryNotifications();
    expect(present).not.toHaveBeenCalled();
    delete node.activeEggHatch;
    node.flushDeferredTownEntryNotifications();
    node.flushDeferredTownEntryNotifications();
    expect(present).toHaveBeenCalledTimes(1);
    expect(node.hasModal()).toBe(false);
  });

  it("does not start town commands on a disposed scene", () => {
    const { node, finish } = harness();
    const present = vi.fn();
    node.scheduleTownEntryNotifications(present);
    finish();
    node.lifecycle.disposed = true;
    node.flushDeferredTownEntryNotifications();
    expect(present).not.toHaveBeenCalled();
  });

  it("keeps Offline entry notifications immediate", () => {
    const { node } = harness(false);
    const present = vi.fn();
    node.scheduleTownEntryNotifications(present);
    expect(present).toHaveBeenCalledTimes(1);
  });
});
