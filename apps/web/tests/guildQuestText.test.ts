import {
  loadQuestCatalog,
  loadRawJson,
  resolveDataDir,
  type QuestDataSource,
} from "@dib/gamedata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  emptyGuildQuestStateSnapshot,
  GuildQuestRuntime,
} from "@dib/engine";
import { describe, expect, it } from "vitest";
import type { LocalizedStrings } from "../src/localization.js";
import {
  guildQuestDescription,
  guildQuestProgress,
  guildQuestTitle,
  objectiveCFormat,
} from "../src/world/guildQuestText.js";
import {
  acceptedGuildQuestNotification,
  committedGuildQuestNotifications,
  progressGuildQuestNotification,
} from "../src/world/guildQuestNotifications.js";

const dataDir = resolveDataDir();
const rawQuests = JSON.parse(readFileSync(resolve(dataDir, "Quests.json"), "utf8")) as unknown;
const strings = loadRawJson(dataDir, "LocalizableStrings.json") as LocalizedStrings;
const source: QuestDataSource = {
  has: (path) => path === "Quests.plist",
  plist: (path) => {
    if (path !== "Quests.plist") throw new Error(`unexpected plist ${path}`);
    return rawQuests;
  },
};
const catalog = loadQuestCatalog(source);

describe("Guild quest localized text", () => {
  it("matches every shipped quest template to the source-derived argument shape", () => {
    for (const quest of catalog.definitions) {
      const runtime = new GuildQuestRuntime(catalog, {
        ...emptyGuildQuestStateSnapshot(),
        activeQuestNames: [quest.name],
      });
      expect(guildQuestTitle(strings, quest), quest.name).not.toHaveLength(0);
      expect(guildQuestDescription(strings, quest), quest.name).not.toMatch(/%@|%d/);
      expect(guildQuestProgress(strings, runtime, quest), quest.name).not.toMatch(/%@|%d/);
    }
  });

  it("implements the Objective-C placeholder subset used by quest strings", () => {
    expect(objectiveCFormat("%@ %d 100%%", ["Wolf", 2.9])).toBe("Wolf 2 100%");
    expect(() => objectiveCFormat("%@ %@", ["Wolf"])).toThrow(/more placeholders/);
    expect(() => objectiveCFormat("%@", ["Wolf", 2])).toThrow(/consumed 1 of 2/);
  });

  it("builds the source acceptance and live progress banners", () => {
    const quest = catalog.requireQuest("Defeat20Monsters");
    const runtime = new GuildQuestRuntime(catalog);
    expect(runtime.startQuest(quest.name)).toBe(true);
    expect(acceptedGuildQuestNotification(strings, runtime, quest)).toMatchObject({
      kind: "accepted",
      questName: "Defeat20Monsters",
      title: "Quest Defeat 10 Monsters Accepted! (1/3 quests)",
      message: "Return to town once you finish the quest.",
      image: "Icon@2x.png",
      visible: false,
    });

    runtime.fireEvent({
      id: 0,
      target: { shortType: "Any", inEnemyDeadMembers: true },
    });
    expect(progressGuildQuestNotification(strings, runtime, quest)).toMatchObject({
      kind: "progress",
      title: 'Progress On Quest "Defeat 10 Monsters"',
      message: "1 of 10 monsters defeated",
    });
  });

  it("presents committed progress once and does not duplicate it for completion", () => {
    const quest = catalog.requireQuest("MacworldCatch");
    const runtime = new GuildQuestRuntime(catalog);
    runtime.startQuest(quest.name);
    runtime.fireEvent({ id: 7, monsterShortType: "Goblin" });

    expect(committedGuildQuestNotifications(strings, runtime, [
      {
        seq: 1,
        type: "quest.progressed",
        questId: quest.name,
        current: 1,
        required: 1,
      },
      {
        seq: 2,
        type: "quest.completed",
        questId: quest.name,
      },
    ])).toEqual([
      expect.objectContaining({
        kind: "progress",
        questName: quest.name,
        message: "Monsters caught: 1 of 1",
      }),
    ]);
  });

  it("preserves each intermediate quantity message from one committed event batch", () => {
    const quest = catalog.requireQuest("Defeat20Monsters");
    const runtime = new GuildQuestRuntime(catalog);
    runtime.startQuest(quest.name);
    runtime.fireEvent({
      id: 0,
      target: { shortType: "Goblin", inEnemyDeadMembers: true },
    });
    runtime.fireEvent({
      id: 0,
      target: { shortType: "Goblin", inEnemyDeadMembers: true },
    });

    expect(committedGuildQuestNotifications(strings, runtime, [
      {
        seq: 1,
        type: "quest.progressed",
        questId: quest.name,
        current: 1,
        required: 10,
      },
      {
        seq: 2,
        type: "quest.progressed",
        questId: quest.name,
        current: 2,
        required: 10,
      },
    ]).map(({ message }) => message)).toEqual([
      "1 of 10 monsters defeated",
      "2 of 10 monsters defeated",
    ]);
  });
});
