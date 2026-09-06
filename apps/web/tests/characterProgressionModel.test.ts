import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata/browser";
import { PlayerProfile } from "@dib/player-domain";
const licenses = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Licenses.json", import.meta.url), "utf8"));
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
import {
  characterLicenseQualification,
  characterSkillBonus,
  characterStatRows,
  nextLicense,
} from "../src/player/characterProgressionModel.js";

const data = GameData.fromRaw({ monsters, jobs, abilities, abilityComponents, buffs, licenses });

function profile(): PlayerProfile {
  return new PlayerProfile({
    heroLevel: 3,
    monsterPartyLevels: [1],
    silver: 0,
    gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  });
}

describe("character progression model", () => {
  it("projects six source-ordered rows and weighted bonuses", () => {
    const player = profile();
    player.incrementSkill("Defense");
    expect(characterStatRows(player).map(({ stat }) => stat)).toEqual([
      "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
    ]);
    expect(characterStatRows(player)[4]).toMatchObject({
      skillValue: 1,
      bonus: 1.5,
      canDecrement: true,
    });
    expect(characterSkillBonus(player, "Defense")).toBe(1.5);
    expect(characterSkillBonus(player, "Attack")).toBe(0);
  });

  it("walks the shipped license path and exact Apprentice requirements", () => {
    const player = profile();
    expect(nextLicense(data, player)).toMatchObject({
      type: "Apprentice",
      heroLevelRequired: 3,
      completedQuestsRequired: 5,
      challengeLevel: 8,
      battingOrderSize: 7,
      gemSlots: 1,
    });
    expect(characterLicenseQualification(data, player, 5).qualifies).toBe(true);
  });
});
