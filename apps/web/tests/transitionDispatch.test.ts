import { describe, expect, it, vi } from "vitest";
import { dispatchTransition } from "../src/world/transitionDispatch.js";

describe("dispatchTransition", () => {
  it("routes a synchronous throw to recovery without invoking the handler twice", () => {
    const error = new Error("sync failure");
    const invoke = vi.fn(() => { throw error; });
    const recover = vi.fn();

    dispatchTransition(invoke, recover);

    expect(invoke).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith(error);
  });

  it("routes a returned rejection to the same recovery path", async () => {
    const error = new Error("async failure");
    const invoke = vi.fn(() => Promise.reject(error));
    const recover = vi.fn();

    dispatchTransition(invoke, recover);
    await Promise.resolve();
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith(error);
  });

  it("does not recover a successful handler", async () => {
    const invoke = vi.fn(() => Promise.resolve());
    const recover = vi.fn();

    dispatchTransition(invoke, recover);
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();
  });
});
