import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadGameData } from "@dib/gamedata";
import {
  loadWorldData,
  QuestCatalog,
  type QuestDefinition,
  type TownBuildingDefinition,
  type WorldResourceSource,
} from "@dib/gamedata/browser";
import {
  emptyGuildQuestStateSnapshot,
  GuildQuestRuntime,
} from "@dib/engine";
import { describe, expect, it } from "vitest";
import {
  guildTownConditionsPass,
  townBuildingIsRevealed,
  townBuildingRevealChanges,
} from "../src/world/guildQuestConditions.js";

const quest: QuestDefinition = {
  name: "Liberate",
  className: "DefeatMonstersQuest",
  source: "First_City",
  questKey: "Liberate",
  challengeLevel: 1,
  treasureData: {},
  eraseDataAtTown: false,
  quantity: 1,
};

function runtime(): GuildQuestRuntime {
  return new GuildQuestRuntime(new QuestCatalog([quest]), emptyGuildQuestStateSnapshot());
}

describe("guildTownConditionsPass", () => {
  it("uses the durable dialogsSeen set for authored chat predicates", () => {
    const quests = runtime();
    expect(guildTownConditionsPass({ chats: "LeslieSaved" }, quests)).toBe(false);
    quests.requestChatPresentation("LeslieSaved");
    expect(guildTownConditionsPass({ chats: "LeslieSaved" }, quests)).toBe(true);
    expect(guildTownConditionsPass({ chats: "!LeslieSaved" }, quests)).toBe(false);
  });

  it("combines positive and negated source quest predicates", () => {
    const quests = runtime();
    quests.requestChatPresentation("LeslieSaved");
    expect(guildTownConditionsPass({
      chats: "LeslieSaved",
      inProgressQuests: "!Liberate",
      quests: "!Liberate",
    }, quests)).toBe(true);

    expect(quests.startQuest("Liberate")).toBe(true);
    expect(guildTownConditionsPass({ inProgressQuests: "Liberate" }, quests)).toBe(true);
    expect(guildTownConditionsPass({ inProgressQuests: "!Liberate" }, quests)).toBe(false);

    quests.fireEvent({
      id: 0,
      target: { shortType: "Any", inEnemyDeadMembers: true },
    });
    expect(guildTownConditionsPass({ inProgressQuests: "Liberate" }, quests)).toBe(false);
    // Objective-complete but unclaimed is still absent from finishedQuests. The six shipped
    // later-game Guilds therefore briefly reappear between the last liberation battle and claim.
    expect(guildTownConditionsPass({
      inProgressQuests: "!Liberate",
      quests: "!Liberate",
    }, quests)).toBe(true);
    expect(quests.completeQuest("Liberate")).toBe(true);
    expect(guildTownConditionsPass({ quests: "Liberate" }, quests)).toBe(true);
    expect(guildTownConditionsPass({ quests: "!Liberate" }, quests)).toBe(false);
    // Claiming moves only Liberate to finishedQuests; that durable condition removes those Guilds.
    expect(guildTownConditionsPass({
      inProgressQuests: "!Liberate",
      quests: "!Liberate",
    }, quests)).toBe(false);
  });
});


const DATA_DIR = resolve(import.meta.dirname, "../../../extracted/data");
const dataNames = new Set(readdirSync(DATA_DIR));
const plistCache = new Map<string, unknown>();
const asJson = (relative: string): string => relative.replace(/\.plist$/, ".json");
const shippedSource: WorldResourceSource = {
  has: (relative) => dataNames.has(asJson(relative)) || /\.(png|mp3|m4a)$/.test(relative),
  plist: (relative) => {
    const name = asJson(relative);
    if (!plistCache.has(name)) {
      plistCache.set(name, JSON.parse(readFileSync(resolve(DATA_DIR, name), "utf8")));
    }
    return plistCache.get(name);
  },
};

interface ConditionalBuilding {
  readonly world: string;
  readonly town: string;
  readonly building: TownBuildingDefinition;
}

function shippedConditionalBuildings(): ConditionalBuilding[] {
  // Monsters.json nests short types arbitrarily deep, so the real GameData walk is the only
  // correct source of the loader's known-type set.
  const knownMonsterTypes = new Set(
    loadGameData().allMonsters().map((monster) => monster.shortType),
  );
  const worlds = shippedSource.plist("Worlds.plist") as Record<string, unknown>;
  const found: ConditionalBuilding[] = [];
  for (const world of Object.keys(worlds).sort()) {
    for (const poi of loadWorldData(shippedSource, world, knownMonsterTypes).pointsOfInterest) {
      for (const building of poi.town?.buildings ?? []) {
        if (building.conditions !== undefined) found.push({ world, town: poi.name, building });
      }
    }
  }
  return found;
}

describe("shipped conditional town buildings", () => {



  it("is exactly the seven Guilds plus the Westguard Hero house", () => {
    expect(shippedConditionalBuildings().map(({ world, town, building }) => ({
      world,
      town,
      className: building.className,
      conditions: building.conditions,
    }))).toEqual([
      {
        world: "World_1-1",
        town: "First_City",
        className: "TavernMenuItem",
        conditions: { chats: "LeslieSaved" },
      },
      {
        world: "World_1-2",
        town: "Capital_City",
        className: "CharacterDisplayMenuItem",
        conditions: { chats: "HaraldDefeated" },
      },
      ...([
        ["World_1-2", "Capital_City"],
        ["World_2-1", "Ancient_City"],
        ["World_2-2", "Rainy_City"],
        ["World_2-3", "Valley_City"],
        ["World_3-3", "Longdale_City"],
        ["World_4-1", "HolyCity"],
      ] as const).map(([world, town]) => ({
        world,
        town,
        className: "TavernMenuItem",
        conditions: {
          inProgressQuests: "!LiberateTownsQuest",
          quests: "!LiberateTownsQuest",
        },
      })),
    ]);
  });

  it("gates only real services, so every rejection removes a real icon and name plate", () => {
    for (const { building } of shippedConditionalBuildings()) {
      expect(building.fake).toBe(false);
      expect(building.iconSpriteFile).toBeDefined();
      expect(building.nameLabel).toBeDefined();
    }
  });
});

describe("townBuildingIsRevealed", () => {
  it("removes the Westguard Hero house from the town's services until Harald is beaten", () => {
    const quests = runtime();
    const conditions = { chats: "HaraldDefeated" };

    expect(townBuildingIsRevealed(conditions, quests)).toBe(false);
    quests.requestChatPresentation("HaraldDefeated");
    expect(townBuildingIsRevealed(conditions, quests)).toBe(true);
  });

  it("removes the Corova Guild until LeslieSaved", () => {
    const quests = runtime();
    expect(townBuildingIsRevealed({ chats: "LeslieSaved" }, quests)).toBe(false);
    quests.requestChatPresentation("LeslieSaved");
    expect(townBuildingIsRevealed({ chats: "LeslieSaved" }, quests)).toBe(true);
  });

  it("removes the six later Guilds while the Liberate quest is usable, then after the claim", () => {
    const quests = runtime();
    const conditions = {
      inProgressQuests: "!Liberate",
      quests: "!Liberate",
    };

    expect(townBuildingIsRevealed(conditions, quests)).toBe(true);
    expect(quests.startQuest("Liberate")).toBe(true);
    expect(townBuildingIsRevealed(conditions, quests)).toBe(false);

    // Objective-complete but unclaimed is neither usable nor finished, so the Guild returns.
    quests.fireEvent({ id: 0, target: { shortType: "Any", inEnemyDeadMembers: true } });
    expect(townBuildingIsRevealed(conditions, quests)).toBe(true);

    expect(quests.completeQuest("Liberate")).toBe(true);
    expect(townBuildingIsRevealed(conditions, quests)).toBe(false);
  });

  it("reveals an unconditional building and hides a conditional one without a quest runtime", () => {
    expect(townBuildingIsRevealed(undefined, undefined)).toBe(true);
    expect(townBuildingIsRevealed({ chats: "LeslieSaved" }, undefined)).toBe(false);
  });
});

describe("townBuildingRevealChanges", () => {


  const townBuildings = (world: string, town: string): readonly TownBuildingDefinition[] => {
    const knownMonsterTypes = new Set(
      loadGameData().allMonsters().map((monster) => monster.shortType),
    );
    const poi = loadWorldData(shippedSource, world, knownMonsterTypes).pointsOfInterest
      .find(({ name }) => name === town);
    if (poi?.town === undefined) throw new Error(`missing shipped town ${world}/${town}`);
    return poi.town.buildings;
  };
  const verdicts = (
    buildings: readonly TownBuildingDefinition[],
    quests: GuildQuestRuntime,
  ): boolean[] => buildings.map((building) =>
    !building.fake && townBuildingIsRevealed(building.conditions, quests));

  it("rebuilds only the Corova Guild after the Leslie fight's LeslieSaved win chat", () => {
    const buildings = townBuildings("World_1-1", "First_City");
    const quests = runtime();
    const built = verdicts(buildings, quests).map((revealed) => ({ revealed }));
    const guild = buildings.findIndex(({ className }) => className === "TavernMenuItem");
    expect(built[guild]?.revealed).toBe(false);

    expect(townBuildingRevealChanges(built, verdicts(buildings, quests))).toEqual([]);
    quests.requestChatPresentation("LeslieSaved");
    expect(townBuildingRevealChanges(built, verdicts(buildings, quests))).toEqual([guild]);
  });

  it("hides then restores a Liberate Guild so the completed quest can be claimed", () => {
    const buildings = townBuildings("World_2-1", "Ancient_City").map((building) =>
      building.conditions?.inProgressQuests === "!LiberateTownsQuest"
        ? { ...building, conditions: { inProgressQuests: "!Liberate", quests: "!Liberate" } }
        : building);
    const guild = buildings.findIndex(({ conditions }) => conditions !== undefined);
    expect(guild).toBeGreaterThanOrEqual(0);
    const quests = runtime();
    let built = verdicts(buildings, quests).map((revealed) => ({ revealed }));
    expect(built[guild]?.revealed).toBe(true);

    // Accepted at a Tavern: the next battle return removes the Guild service.
    expect(quests.startQuest("Liberate")).toBe(true);
    expect(townBuildingRevealChanges(built, verdicts(buildings, quests))).toEqual([guild]);
    built = verdicts(buildings, quests).map((revealed) => ({ revealed }));

    // The last liberation victory completes the objective; that battle's return must restore the
    // Guild, or the quest can never be claimed in this session.
    quests.fireEvent({ id: 0, target: { shortType: "Any", inEnemyDeadMembers: true } });
    expect(townBuildingRevealChanges(built, verdicts(buildings, quests))).toEqual([guild]);
  });

  it("refuses mismatched verdict lists", () => {
    expect(() => townBuildingRevealChanges([{ revealed: true }], [])).toThrow(/1 buildings/);
  });
});
