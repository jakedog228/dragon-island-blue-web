import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (!("navigator" in globalThis)) Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgent: "DIB test", platform: "Win32" },
  });
});
import { GuildQuestFlow } from "../src/world/guildQuestFlow.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
type Harness = {
  actionPending: boolean;
  activateTavernAction(action: "newQuest" | "claimReward" | "dropQuests"): Promise<void>;
};

describe("Guild asynchronous action ownership", () => {
  it("holds the claim through chat dismissal and the loot-to-Egg mount gap", async () => {
    const reward = deferred();
    const chat = vi.fn(async () => {});
    const accept = vi.fn(async () => {});
    const checkpoint = vi.fn();
    const flow = Object.assign(Object.create(GuildQuestFlow.prototype), {
      disposed: false, actionPending: false,
      options: {
        runtime: {
          completedActiveQuestNames: () => ["earned-quest"],
          catalog: { requireQuest: () => ({ name: "earned-quest" }) },
          completeQuest: () => true,
        },
        beginRewardCheckpoint: () => checkpoint,
        onClaimReward: (_quest: unknown, presented: () => void) => { presented(); return reward.promise; },
        onStateChanged: vi.fn(),
      },
      newQuest: accept,
      refreshTavernBadges: vi.fn(),
      showNamedChat: chat,
    }) as Harness;
    const claim = flow.activateTavernAction("claimReward");
    await vi.waitFor(() => expect(chat).toHaveBeenCalledWith("TavernQuestFinished"));
    expect(flow.actionPending).toBe(true);
    await flow.activateTavernAction("newQuest");
    expect(accept).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
    reward.resolve(); await claim;
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(flow.actionPending).toBe(false);
    await flow.activateTavernAction("newQuest");
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("serializes duplicate taps while an authority command is unresolved", async () => {
    const accepted = deferred();
    const accept = vi.fn(() => accepted.promise);
    const flow = Object.assign(Object.create(GuildQuestFlow.prototype), {
      disposed: false, actionPending: false, newQuest: accept,
    }) as Harness;
    const first = flow.activateTavernAction("newQuest");
    await flow.activateTavernAction("newQuest");
    expect(accept).toHaveBeenCalledTimes(1);
    accepted.resolve(); await first;
    expect(flow.actionPending).toBe(false);
  });

  it("releases command ownership after a surfaced failure", async () => {
    const flow = Object.assign(Object.create(GuildQuestFlow.prototype), {
      disposed: false, actionPending: false,
      newQuest: async () => { throw new Error("authority unavailable"); },
    }) as Harness;
    await expect(flow.activateTavernAction("newQuest")).rejects.toThrow("authority unavailable");
    expect(flow.actionPending).toBe(false);
  });
});
