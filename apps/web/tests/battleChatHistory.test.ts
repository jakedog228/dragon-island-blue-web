import { describe, expect, it } from "vitest";
import { BattleChatHistory } from "../src/authority/battleChatHistory.js";

describe("committed battle chat presentation", () => {
  it("shows first-use start and win chats despite intervening commits and terminal adoption", () => {
    const history = new BattleChatHistory({ quests: { dialogsSeen: ["old"] } });
    history.observe({ battle: { battleId: "b1" }, quests: { dialogsSeen: ["old", "start"] } });
    history.observe({ battle: { battleId: "b1" }, quests: { dialogsSeen: ["old", "start"] } });
    expect(history.request("start", false)).toBe(true);
    expect(history.request("start", false)).toBe(false);
    history.observe({ quests: { dialogsSeen: ["old", "start", "win"] } });
    expect(history.request("win", false)).toBe(true);
    expect(history.request("old", false)).toBe(false);
    history.observe({ battle: { battleId: "b2" }, quests: { dialogsSeen: ["old", "start", "win"] } });
    expect(history.request("start", false)).toBe(false);
    expect(history.request("start", true)).toBe(true);
  });

  it("uses persisted seen bits on reconnect while allowing the not-yet-committed win chat", () => {
    const history = new BattleChatHistory({ battle: { battleId: "b1" }, quests: { dialogsSeen: ["start"] } });
    expect(history.request("start", false)).toBe(false);
    history.observe({ quests: { dialogsSeen: ["start", "win"] } });
    expect(history.request("win", false)).toBe(true);
  });
});
