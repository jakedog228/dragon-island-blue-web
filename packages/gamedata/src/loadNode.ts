// Node-only filesystem loading (split from gameData.ts so the GameData class itself stays
// browser-safe — see the "@dib/gamedata/browser" package export).
import { GameData } from "./gameData.js";
import { resolveDataDir } from "./dataDir.js";
import { loadRawJson, loadRawJsonValue } from "./rawLoad.js";

export function loadGameData(dataDir?: string): GameData {
  const dir = resolveDataDir(dataDir);
  return GameData.fromRaw({
    monsters: loadRawJson(dir, "Monsters.json"),
    jobs: loadRawJson(dir, "Jobs.json"),
    abilities: loadRawJson(dir, "Abilities.json"),
    abilityComponents: loadRawJson(dir, "AbilityComponents.json"),
    buffs: loadRawJson(dir, "Buffs.json"),
    items: loadRawJson(dir, "Items.json"),
    combines: loadRawJson(dir, "Combines.json"),
    licenses: loadRawJson(dir, "Licenses.json"),
    tournaments: loadRawJsonValue(dir, "Tournaments.json"),
    thingsInWorld: loadRawJson(dir, "ThingsInWorld.json"),
  });
}
