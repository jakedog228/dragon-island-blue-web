import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata/browser";
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
const combines = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Combines.json", import.meta.url), "utf8"));
const items = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Items.json", import.meta.url), "utf8"));
const licenses = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Licenses.json", import.meta.url), "utf8"));
import { earnedLicenseWinDialogs } from "../src/player/licenseDialogRepair.js";

const data = GameData.fromRaw({
  monsters, jobs, abilities, abilityComponents, buffs, combines, items, licenses,
});

describe("legacy license win-chat repair", () => {
  it("restores the source-implied Westguard Hero unlock for an Apprentice save", () => {
    expect(earnedLicenseWinDialogs(data, "Novice")).toEqual([]);
    expect(earnedLicenseWinDialogs(data, "Apprentice")).toEqual(["HaraldDefeated"]);
  });

  it("includes each prior challenge chat for later licenses", () => {
    expect(earnedLicenseWinDialogs(data, "Elite")).toEqual([
      "HaraldDefeated",
      "MayDefeated",
      "NemoDefeated2",
      "IvoDefeated3",
    ]);
  });
});
