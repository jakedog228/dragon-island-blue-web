import { describe, expect, it } from "vitest";

import { runInsufficientFundsStoreHandoff } from "../src/player/goldStoreHandoff.js";

describe("insufficient-funds category-3 Store handoff", () => {
  it("mounts Store before CannotAffordThing and resumes only after Store closes", async () => {
    const events: string[] = [];
    let closeStore!: () => void;
    const closed = new Promise<void>((resolve) => { closeStore = resolve; });

    const run = runInsufficientFundsStoreHandoff({
      openStore: async () => {
        events.push("store-mounted");
        return { closed };
      },
      presentCannotAfford: async () => { events.push("cannot-afford-dismissed"); },
      resume: async () => { events.push("owner-resumed"); },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["store-mounted", "cannot-afford-dismissed"]);

    closeStore();
    await run;
    expect(events).toEqual([
      "store-mounted",
      "cannot-afford-dismissed",
      "owner-resumed",
    ]);
  });
});
