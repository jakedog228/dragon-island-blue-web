import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";

vi.hoisted(() => Object.defineProperty(globalThis, "navigator", {
  configurable: true, value: { userAgent: "vitest" },
}));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const methods = WorldNode.prototype as unknown as {
  presentReplayBattleTutorial(this: unknown): void;
  handlePoiTap(this: unknown, name: string): Promise<void>;
  openWorldMenu(this: unknown): Promise<void>;
};
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function receiver() {
  return {
    modalOpening: false, locked: false, walking: false, lifecycle: { disposed: false },
    hasModal: () => false, claimTutorialFlag: vi.fn(), mountReplayBattleTutorial: vi.fn(),
    deps: { authority: {}, trip: { poiState: vi.fn() },
      playerRuntime: { profile: { hasTutorialFlag: () => false, claimTutorialFlag: vi.fn() } } },
  };
}
describe("Replay Battle tutorial owns arrival input", () => {
  it("blocks another POI through the online claim and popup mount, with one presentation", async () => {
    const node = receiver(), claim = deferred<string>(), mount = deferred<void>();
    node.claimTutorialFlag.mockReturnValue(claim.promise);
    node.mountReplayBattleTutorial.mockReturnValue(mount.promise);
    methods.presentReplayBattleTutorial.call(node);
    methods.presentReplayBattleTutorial.call(node);
    expect(node.modalOpening).toBe(true);
    await methods.handlePoiTap.call(node, "next-field");
    expect(node.deps.trip.poiState).not.toHaveBeenCalled();
    expect(node.claimTutorialFlag).toHaveBeenCalledOnce();
    claim.resolve("claimed"); await flush();
    expect(node.modalOpening).toBe(true);
    await methods.handlePoiTap.call(node, "next-field");
    expect(node.deps.trip.poiState).not.toHaveBeenCalled();
    expect(node.mountReplayBattleTutorial).toHaveBeenCalledOnce();
    mount.resolve(); await flush();
    expect(node.modalOpening).toBe(false);
  });
  it.each(["failed", "existing"])("releases ownership on a %s claim without mounting", async outcome => {
    const node = receiver(); node.claimTutorialFlag.mockResolvedValue(outcome);
    methods.presentReplayBattleTutorial.call(node); await flush();
    expect(node.modalOpening).toBe(false);
    expect(node.mountReplayBattleTutorial).not.toHaveBeenCalled();
  });
});
