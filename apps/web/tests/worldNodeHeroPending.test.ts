import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";
import { showMonsterHatchPopup } from "../src/ui/monsterHatchPopup.js";

vi.hoisted(() => Object.defineProperty(globalThis, "navigator", {
  configurable: true, value: { userAgent: "vitest" },
}));
vi.mock("../src/ui/monsterHatchPopup.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/ui/monsterHatchPopup.js")>(),
  showMonsterHatchPopup: vi.fn(),
  buildMonsterHatchMessageBlock: () => ({ root: {} }),
}));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const methods = WorldNode.prototype as unknown as {
  showFirstGemDisplay(this: unknown): Promise<void>;
  mutateInventory(this: unknown, action: "equip" | "drop" | "unequip", itemId: string): Promise<void>;
  leaveTown(this: unknown): Promise<void>;
};
function receiver() {
  return {
    locked: false, lifecycle: { disposed: false }, pointRoot: {},
    activeTown: { poi: { name: "First_City" } }, hasModal: () => false,
    claimTutorialFlag: vi.fn(),
    deps: { game: { assets: {}, scale9: {}, strings: { FirstCharacterDisplayTitleKey: "Gems", FirstCharacterDisplayMessageKey: "Help", OkButtonKey: "OK" } }, stage: { app: { ticker: {} } },
      audio: { playSfx: vi.fn() }, authority: { leaveTown: vi.fn(), submitPlayer: vi.fn() },
      playerRuntime: { equipGem: vi.fn(), profile: { unequipGem: vi.fn(), inventory: { drop: vi.fn() } } },
      onStateChanged: vi.fn() },
  };
}
describe("Hero pending work retains town input ownership", () => {
  it("holds departure through the tutorial claim and asynchronous popup mounting", async () => {
    const node = receiver(), claim = deferred<string>(), mount = deferred<never>();
    node.claimTutorialFlag.mockReturnValue(claim.promise);
    vi.mocked(showMonsterHatchPopup).mockReturnValue(mount.promise);
    const pending = methods.showFirstGemDisplay.call(node);
    expect(node.locked).toBe(true);
    await methods.leaveTown.call(node);
    expect(node.deps.authority.leaveTown).not.toHaveBeenCalled();
    claim.resolve("claimed"); await Promise.resolve();
    expect(node.locked).toBe(true);
    await methods.leaveTown.call(node);
    expect(node.deps.authority.leaveTown).not.toHaveBeenCalled();
    mount.resolve(undefined as never); await pending;
    expect(node.locked).toBe(false);
  });
  it.each(["failed", "existing"])("releases ownership after a %s tutorial claim", async outcome => {
    const node = receiver(); node.claimTutorialFlag.mockResolvedValue(outcome);
    await methods.showFirstGemDisplay.call(node);
    expect(node.locked).toBe(false);
  });
  it.each(["equip", "drop", "unequip"] as const)("keeps town locked through %s even if the inventory closes", async action => {
    const node = receiver(), command = deferred<void>();
    node.deps.authority.submitPlayer.mockReturnValue(command.promise);
    const pending = methods.mutateInventory.call(node, action, "gem-1");
    expect(node.locked).toBe(true);
    await methods.leaveTown.call(node);
    expect(node.deps.authority.leaveTown).not.toHaveBeenCalled();
    expect(node.deps.onStateChanged).not.toHaveBeenCalled();
    command.resolve(); await pending;
    expect(node.deps.onStateChanged).toHaveBeenCalledOnce();
    expect(node.locked).toBe(false);
  });
  it("releases a rejected inventory command without mirroring it", async () => {
    const node = receiver(); node.deps.authority.submitPlayer.mockRejectedValue(new Error("refused"));
    await expect(methods.mutateInventory.call(node, "equip", "gem-1")).rejects.toThrow("refused");
    expect(node.locked).toBe(false);
    expect(node.deps.playerRuntime.equipGem).not.toHaveBeenCalled();
  });
});
