import { describe, expect, it, vi } from "vitest";
import { MonsterpediaFlow } from "../src/world/monsterpediaFlow.js";
vi.hoisted(() => Object.defineProperty(globalThis, "navigator", {
  configurable: true, value: { userAgent: "vitest" },
}));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const methods = MonsterpediaFlow.prototype as unknown as {
  showCurrentScreenTutorial(this: unknown): Promise<void>;
  requestBack(this: unknown): void;
};
function receiver() {
  return { busy: false, disposed: false, category: 0, expanded: false,
    strokeRecognizer: { setEnabled: vi.fn() }, popupHost: { dismissTop: () => false },
    handleClose: vi.fn(), showMessage: vi.fn(),
    opts: { claimTutorialFlag: vi.fn(),
      profile: { hasTutorialFlag: () => false, claimTutorialFlag: vi.fn(() => true) } } };
}
describe("Monsterpedia first-use input ownership", () => {
  it("blocks tabs/swipes/back from initial claim through tutorial dismissal", async () => {
    const node = receiver(), claim = deferred<void>(), popup = deferred<void>();
    node.opts.claimTutorialFlag.mockReturnValue(claim.promise);
    node.showMessage.mockReturnValue(popup.promise);
    const pending = methods.showCurrentScreenTutorial.call(node);
    expect(node.busy).toBe(true);
    expect(node.strokeRecognizer.setEnabled).toHaveBeenLastCalledWith(false);
    methods.requestBack.call(node);
    expect(node.handleClose).not.toHaveBeenCalled();
    claim.resolve(); await Promise.resolve();
    expect(node.showMessage).toHaveBeenCalledWith("FirstMonsterpedia");
    expect(node.busy).toBe(true);
    popup.resolve(); await pending;
    expect(node.busy).toBe(false);
    expect(node.strokeRecognizer.setEnabled).toHaveBeenLastCalledWith(true);
  });
  it("does not release a page transition's pre-existing busy ownership", async () => {
    const node = receiver(); node.busy = true; node.category = 5;
    await methods.showCurrentScreenTutorial.call(node);
    expect(node.opts.claimTutorialFlag).toHaveBeenCalledWith("FirstAllMonsterpedia");
    expect(node.busy).toBe(true);
    expect(node.strokeRecognizer.setEnabled).not.toHaveBeenCalled();
  });
  it("does not mount a popup or re-enable input after disposal during the claim", async () => {
    const node = receiver(), claim = deferred<void>();
    node.opts.claimTutorialFlag.mockReturnValue(claim.promise);
    const pending = methods.showCurrentScreenTutorial.call(node);
    node.disposed = true; claim.resolve(); await pending;
    expect(node.showMessage).not.toHaveBeenCalled();
    expect(node.opts.profile.claimTutorialFlag).not.toHaveBeenCalled();
    expect(node.strokeRecognizer.setEnabled).toHaveBeenLastCalledWith(false);
  });
  it("surfaces a refused claim and releases its own input lock", async () => {
    const node = receiver(); node.opts.claimTutorialFlag.mockRejectedValue(new Error("refused"));
    await expect(methods.showCurrentScreenTutorial.call(node)).rejects.toThrow("refused");
    expect(node.busy).toBe(false);
    expect(node.showMessage).not.toHaveBeenCalled();
  });
});
