import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";
vi.hoisted(() => Object.defineProperty(globalThis, "navigator", {
  configurable: true, value: { userAgent: "vitest" },
}));
const methods = WorldNode.prototype as unknown as {
  startArenaChallenge(this: unknown, license: unknown, questGiver?: string): void;
  dispatchOwnedTransition(this: unknown, route: string, target: unknown, invoke: () => Promise<void>): void;
  leaveTown(this: unknown): Promise<void>;
};
describe("Arena license handoff owns its retiring town", () => {
  it("blocks exposed-town departure and duplicate challenge while command and preload are pending", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    const node = { locked: false, lifecycle: { disposed: false },
      activeTown: { poi: { name: "Capital_City" } }, hasModal: () => false,
      transitionFailure: undefined, recoverTransitionFailure: vi.fn(),
      dispatchOwnedTransition: methods.dispatchOwnedTransition,
      deps: { onArenaChallenge: vi.fn(() => pending), authority: { leaveTown: vi.fn() } } };
    const license = { type: "Apprentice" };
    methods.startArenaChallenge.call(node, license, "KingMan.png");
    expect(node.locked).toBe(true);
    await methods.leaveTown.call(node);
    methods.startArenaChallenge.call(node, license);
    expect(node.deps.authority.leaveTown).not.toHaveBeenCalled();
    expect(node.deps.onArenaChallenge).toHaveBeenCalledOnce();
    expect(node.deps.onArenaChallenge).toHaveBeenCalledWith({
      license, townName: "Capital_City", questGiver: "KingMan.png",
    });
    resolve(); await pending; await Promise.resolve();
    expect(node.locked).toBe(true); // Success retires the outgoing WorldNode; never unlock it early.
    expect(node.recoverTransitionFailure).not.toHaveBeenCalled();
  });
  it.each(["throw", "reject"])("uses existing transition recovery after a synchronous/asynchronous %s", async failure => {
    const error = new Error("Arena start failed");
    const poi = { name: "Capital_City" };
    const node = { locked: false, lifecycle: { disposed: false }, activeTown: { poi },
      transitionFailure: undefined, recoverTransitionFailure: vi.fn(),
      dispatchOwnedTransition: methods.dispatchOwnedTransition,
      deps: { onArenaChallenge: () => { if (failure === "throw") throw error; return Promise.reject(error); } } };
    methods.startArenaChallenge.call(node, { type: "Apprentice" });
    await Promise.resolve();
    expect(node.recoverTransitionFailure).toHaveBeenCalledOnce();
    expect(node.recoverTransitionFailure).toHaveBeenCalledWith("arena-license-challenge", poi, error);
  });
});
