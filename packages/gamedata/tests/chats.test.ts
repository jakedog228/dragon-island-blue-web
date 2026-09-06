import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it } from "vitest";
const shippedChats = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Chats.json", import.meta.url), "utf8"));
import { loadChatDefinition, type ChatResourceSource } from "../src/chats.js";

function source(chats: Record<string, unknown>): ChatResourceSource {
  const files = new Map<string, unknown>([
    ["Chats.plist", chats],
    ["portrait.png", true],
  ]);
  return {
    has: (path) => files.has(path),
    plist: (path) => files.get(path),
  };
}

describe("source chat definitions", () => {
  it("retains authored portrait/message data and the omitted alwaysShow=true default", () => {
    expect(loadChatDefinition(source({
      Felix: { images: ["portrait.png"], messages: ["FelixLine"] },
    }), "Felix")).toEqual({
      name: "Felix",
      alwaysShow: true,
      imageFile: "portrait.png",
      messageKeys: ["FelixLine"],
    });
  });

  it("models native nil messaging for a referenced key absent from Chats.plist", () => {
    expect(loadChatDefinition(source({}), "ShenronDefeated")).toEqual({
      name: "ShenronDefeated",
      alwaysShow: true,
      messageKeys: [],
    });
  });








  it("leaves every Arena chat name out of the shipped catalog, so none can carry a portrait", () => {
    const catalog = shippedChats as Record<string, unknown>;
    const arenaChats = [
      "Arena",
      "ArenaNoLicense",
      "ArenaLicenseDescription",
      "ArenaHighestLicense",
      "LicenseUpgradeFail",
      "ArenaWon",
      "ArenaLost",
    ];
    const shippedSource = source(catalog);
    for (const name of arenaChats) {
      expect(catalog).not.toHaveProperty(name);
      expect(loadChatDefinition(shippedSource, name)).toEqual({
        name,
        alwaysShow: true,
        messageKeys: [],
      });
    }
  });
});
