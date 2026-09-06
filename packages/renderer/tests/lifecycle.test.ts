import { describe, expect, it, vi } from "vitest";
import { LifecycleScope } from "../src/lifecycle.js";

describe("LifecycleScope", () => {
  it("aborts first, then cleans up once in reverse ownership order", () => {
    const scope = new LifecycleScope();
    const order: string[] = [];
    scope.signal.addEventListener("abort", () => order.push("abort"));
    scope.add(() => order.push("first"));
    scope.add(() => order.push("second"));

    scope.dispose();
    scope.dispose();

    expect(scope.disposed).toBe(true);
    expect(scope.signal.aborted).toBe(true);
    expect(order).toEqual(["abort", "second", "first"]);
  });

  it("immediately cleans up resources registered after disposal", () => {
    const scope = new LifecycleScope();
    const cleanup = vi.fn();
    scope.dispose();
    scope.add(cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("runs every cleanup before reporting failures", () => {
    const scope = new LifecycleScope();
    const completed = vi.fn();
    scope.add(completed);
    scope.add(() => {
      throw new Error("broken cleanup");
    });
    expect(() => scope.dispose()).toThrow(AggregateError);
    expect(completed).toHaveBeenCalledOnce();
  });
});
