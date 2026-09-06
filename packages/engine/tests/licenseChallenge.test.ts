import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata";
import { buildLicenseChallengeEncounter } from "../src/licenseChallenge.js";
import { readFileSync } from "node:fs";

const raw = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../extracted/data/${name}.json`, import.meta.url), "utf8"));
const data = GameData.fromRaw({
  monsters: raw("Monsters"),
  jobs: raw("Jobs"),
  abilities: raw("Abilities"),
  abilityComponents: raw("AbilityComponents"),
  buffs: raw("Buffs"),
  licenses: raw("Licenses"),
});

describe("BaseLicense challengeEncounter", () => {
  it("builds every shipped license challenge at its authored challenge level", () => {
    expect(data.allLicenses().map((license) => {
      const challenge = buildLicenseChallengeEncounter(license);
      return {
        type: license.type,
        challenge: challenge.encounter.challengeLevel,
        count: challenge.encounter.monsters.length,
        start: challenge.startChatKey,
        win: challenge.winChatKey,
      };
    })).toEqual([
      { type: "Novice", challenge: 1, count: 5, start: "Cyrus", win: "CyrusDefeated" },
      { type: "Apprentice", challenge: 8, count: 6, start: "Harald", win: "HaraldDefeated" },
      { type: "Veteran", challenge: 24, count: 3, start: "May", win: "MayDefeated" },
      { type: "Expert", challenge: 47, count: 7, start: "Nemo2", win: "NemoDefeated2" },
      { type: "Elite", challenge: 52, count: 9, start: "Ivo3", win: "IvoDefeated3" },
      { type: "Master", challenge: 60, count: 17, start: "Harald2", win: "HaraldDefeated2" },
      { type: "Grandmaster", challenge: 80, count: 3, start: "Seth", win: "SethDefeated" },
    ]);
  });
});
