import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "DIB test", platform: "Win32" },
    });
  }
});

const shown = vi.hoisted(() => ({
  calls: [] as {
    readonly loot: readonly unknown[];
    readonly takeAll: unknown;
  }[],
}));

vi.mock("../src/dungeon/dungeonLootPageProvider.js", () => ({
  showDungeonLootManagement: async (
    _context: unknown,
    loot: readonly unknown[],
    takeAll: unknown,
  ) => {
    shown.calls.push({ loot, takeAll });
    // Stand in for the real provider's own claim sequence: settle behind the live card, remove it,
    // then run the post-dismiss continuation.
    if (typeof takeAll === "function") {
      await (takeAll as (items: readonly unknown[]) => unknown)(loot);
      return;
    }
    const hooks = takeAll as {
      commit(items: readonly unknown[]): Promise<void>;
      afterDismiss?(): Promise<void>;
    };
    await hooks.commit(loot);
    await hooks.afterDismiss?.();
  },
}));

import { DungeonNode, type DungeonNodeDeps } from "../src/dungeon/dungeonNode.js";

const treasureAction = {
  kind: "treasure" as const,
  roomId: "room-1",
  treasure: { id: "treasure-1", loot: [] },
};

interface EntryActionHarness {
  processEntryActions(actions: readonly unknown[]): Promise<void>;
  pendingAction: unknown;
}

function harness(deps: Partial<DungeonNodeDeps>): EntryActionHarness {
  const loot = [{ kind: "silver", amount: 10 }];
  return Object.assign(Object.create(DungeonNode.prototype), {
    deps: {
      session: { collectTreasure: () => loot },
      onStateChanged: () => undefined,
      onLoot: () => [],
      ...deps,
    },
    lifecycle: { disposed: false },
    renderFloor: () => undefined,
    updateChrome: () => undefined,
    dialogContext: () => ({}),
  }) as unknown as EntryActionHarness;
}

describe("dungeon treasure claim", () => {
  it("splits the online claim into settlement and a post-dismiss continuation", async () => {
    shown.calls.length = 0;
    const order: string[] = [];
    const node = harness({
      onLoot: () => { order.push("onLoot"); return []; },
      onLootClaim: async (treasure) => {
        order.push(`claim:${treasure.id}`);
        return async () => { order.push("continuation"); };
      },
    });

    await node.processEntryActions([treasureAction]);

    expect(order).toEqual(["claim:treasure-1", "continuation"]);
    // Online settlement never routes through the post-removal callback any more.
    expect(order).not.toContain("onLoot");
    expect(typeof shown.calls[0]!.takeAll).toBe("object");
  });

  it("keeps the offline post-removal callback when there is no authority claim", async () => {
    shown.calls.length = 0;
    const order: string[] = [];
    const node = harness({ onLoot: () => { order.push("onLoot"); return []; } });

    await node.processEntryActions([treasureAction]);

    expect(order).toEqual(["onLoot"]);
    expect(typeof shown.calls[0]!.takeAll).toBe("function");
  });

  it("clears the pending action when the claim rejects", async () => {
    shown.calls.length = 0;
    const failure = new Error("authority rejected dungeon.openTreasure");
    const node = harness({ onLootClaim: () => Promise.reject(failure) });

    await expect(node.processEntryActions([treasureAction])).rejects.toBe(failure);

    // The success tail alone left `pendingAction` reporting a treasure the node had given up on,
    // which is what the dungeon's own debug state reports to a live trace.
    expect(node.pendingAction).toBeUndefined();
  });

  it("clears the pending action when the node is disposed mid-action", async () => {
    shown.calls.length = 0;
    const node = harness({
      onLootClaim: async () => {
        (node as unknown as { lifecycle: { disposed: boolean } }).lifecycle.disposed = true;
        return undefined;
      },
    });

    await node.processEntryActions([treasureAction]);

    expect(node.pendingAction).toBeUndefined();
  });
});
