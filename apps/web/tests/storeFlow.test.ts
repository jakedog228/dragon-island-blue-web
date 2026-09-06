import { describe, expect, it, vi } from "vitest";
import { StoreFlow } from "../src/player/storeFlow.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

describe("StoreFlow category-3 close seam", () => {
  it("enters Currency as the initial route and resolves through the first close request", async () => {
    const events: string[] = [];
    const flow = Reflect.construct(StoreFlow, [{
      ticker: { remove: () => events.push("ticker-removed") },
      onClose: () => events.push("on-close"),
    }]) as StoreFlow;
    const internal = flow as unknown as {
      category: number;
      selectedIndex: number;
      refreshSelection(): Promise<void>;
      showGoldPurchaseCategoryAndWait(): Promise<void>;
      requestBack(): boolean;
    };
    internal.refreshSelection = vi.fn(async () => undefined);

    let settled = false;
    const closed = internal.showGoldPurchaseCategoryAndWait().then(() => {
      settled = true;
      events.push("resolved");
    });

    expect(internal.category).toBe(3);
    expect(internal.selectedIndex).toBe(2);
    await Promise.resolve();
    expect(settled).toBe(false);

    expect(internal.requestBack()).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(true);
    await closed;

    expect(events).toEqual(["ticker-removed", "on-close", "resolved"]);
  });
});
