import { describe, expect, it } from "vitest";
import { rehydrateOfficialBattleWinChat } from "../src/authority/battleLifecycleChat.js";

const resources = {
  has: (path: string) => path === "Chats.plist",
  plist: (path: string) => {
    if (path !== "Chats.plist") throw new Error(`unexpected plist ${path}`);
    return {
      DrakeDefeated: {
        alwaysShow: true,
        images: ["LocalLeslie.png"],
        messages: ["LocalMessageKey"],
      },
    };
  },
};

describe("Official battle lifecycle chat rehydration", () => {
  it("uses authoritative semantics and only the local portrait", () => {
    expect(rehydrateOfficialBattleWinChat({
      winChat: {
        name: "DrakeDefeated",
        alwaysShow: false,
        messageKeys: ["DrakeDefeatedChatKey"],
      },
    }, resources)).toEqual({
      name: "DrakeDefeated",
      alwaysShow: false,
      messageKeys: ["DrakeDefeatedChatKey"],
      imageFile: "LocalLeslie.png",
    });
  });

  it("keeps historical active-battle projections chatless", () => {
    expect(rehydrateOfficialBattleWinChat({}, resources)).toBeUndefined();
  });
});
