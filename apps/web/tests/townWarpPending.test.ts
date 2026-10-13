import { describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { TownWarpFlow } from "../src/world/townWarpFlow.js";
import { WorldNode } from "../src/world/worldNode.js";
import { showMonsterHatchPopup } from "../src/ui/monsterHatchPopup.js";
vi.hoisted(() => Object.defineProperty(globalThis, "navigator", {
  configurable: true, value: { userAgent: "vitest" },
}));
vi.mock("../src/ui/monsterHatchPopup.js", async original => ({
  ...await original<typeof import("../src/ui/monsterHatchPopup.js")>(),
  showMonsterHatchPopup: vi.fn(), buildLocalizedMonsterHatchMessageContent: () => ({}),
}));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
describe("Warp first-use input ownership", () => {
  it("blocks travel, unknown-town help and close until the owner's claim/mount finishes", () => {
    let pending = true;
    const options = { parent: new Container(), isInputBlocked: () => pending,
      onClose: vi.fn(), onClick: vi.fn(), onTravel: vi.fn(), onUnknownTown: vi.fn() };
    const flow = Object.assign(Object.create(TownWarpFlow.prototype), { options, closed: false, invoking: false });
    flow.invoke({ townName: "First_City", visited: true });
    flow.invoke({ townName: "Unknown", visited: false });
    flow.requestClose();
    expect(options.onTravel).not.toHaveBeenCalled();
    expect(options.onUnknownTown).not.toHaveBeenCalled();
    expect(options.onClose).not.toHaveBeenCalled();
    pending = false;
    flow.invoke({ townName: "First_City", visited: true });
    flow.invoke({ townName: "First_City", visited: true });
    expect(options.onTravel).toHaveBeenCalledOnce();
    expect(options.onTravel).toHaveBeenCalledWith("First_City");
    expect(options.onClose).toHaveBeenCalledOnce();
  });
  it.each(["claimed", "existing", "failed"] as const)("holds the actual scene's picker for a %s claim", async outcome => {
    const claim = deferred<"claimed" | "existing" | "failed">(), mount = deferred<never>();
    const flow = { dispose: vi.fn() };
    let blocked: (() => boolean) | undefined;
    const show = vi.spyOn(TownWarpFlow, "show").mockImplementation(async options => {
      blocked = options.isInputBlocked;
      return flow as unknown as TownWarpFlow;
    });
    vi.mocked(showMonsterHatchPopup).mockReturnValue(mount.promise);
    const node = { modalOpening: false, locked: false, lifecycle: { disposed: false },
      activeTown: { poi: { name: "First_City" } }, hasModal: () => false,
      sourceConditionContext: () => ({ goldPurchased: 0 }), claimTutorialFlag: () => claim.promise,
      deps: { townWarp: { destinations: [{ townName: "First_City" }] },
        game: { assets: {}, scale9: {}, strings: { TownWarpTutorialTitleKey: "Warp", OkButtonKey: "OK" } },
        stage: { app: { ticker: {} } }, onStateChanged: vi.fn() } };
    const pending = (WorldNode.prototype as unknown as { openTownWarp(this: unknown): Promise<void> }).openTownWarp.call(node);
    await Promise.resolve();
    expect(blocked?.()).toBe(true);
    claim.resolve(outcome); await Promise.resolve(); await Promise.resolve();
    if (outcome === "claimed") {
      expect(blocked?.()).toBe(true);
      mount.resolve(undefined as never);
    }
    await pending;
    expect(blocked?.()).toBe(false);
    show.mockRestore();
  });
});
