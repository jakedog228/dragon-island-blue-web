import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";
vi.hoisted(() => Object.defineProperty(globalThis, "navigator", {
  configurable: true, value: { userAgent: "vitest" },
}));
const methods = WorldNode.prototype as unknown as {
  claimTutorialFlag(this: unknown, flag: string): Promise<string>;
  hasModal(this: unknown): boolean;
  handlePoiTap(this: unknown, name: string): Promise<void>;
};
describe("tutorial commands own conflicting world input", () => {
  it.each(["flashTownExit", "FirstTavernFlash"])("owns input and deduplicates pending %s", async flag => {
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    const flags = new Set<string>();
    const node = Object.assign(Object.create(WorldNode.prototype), {
      tutorialClaims: new Map(), locked: false, walking: false, modalOpening: false,
      deps: { authority: { claimTutorialFlag: vi.fn(() => pending), egg: { pendingEgg: () => undefined } },
        trip: { poiState: vi.fn() }, audio: { playSfx: vi.fn() }, onStateChanged: vi.fn(),
        playerRuntime: { profile: { hasTutorialFlag: (key: string) => flags.has(key),
          claimTutorialFlag: (key: string) => { flags.add(key); return true; } } } },
    });
    const first = methods.claimTutorialFlag.call(node, flag);
    const second = methods.claimTutorialFlag.call(node, flag);
    expect(methods.hasModal.call(node)).toBe(true);
    await methods.handlePoiTap.call(node, "next-field");
    expect(node.deps.trip.poiState).not.toHaveBeenCalled();
    expect(node.deps.authority.claimTutorialFlag).toHaveBeenCalledOnce();
    resolve();
    expect(await first).toBe("claimed"); expect(await second).toBe("claimed");
    expect(methods.hasModal.call(node)).toBe(false);
    expect(flags.has(flag)).toBe(true);
    expect(node.deps.onStateChanged).toHaveBeenCalledOnce();
  });
});
