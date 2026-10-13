import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGameData, resolveDataDir } from "@dib/gamedata";
import { earnedDungeonBattleDialogs } from "../src/dungeon/earnedDungeonBattleDialogs.js";

const directory = resolveDataDir();
const file = (name: string) => resolve(directory, name.replace(/\.plist$/, ".json"));
const read = (name: string) => JSON.parse(readFileSync(file(name), "utf8"));
const worlds = Object.keys(read("Worlds.plist"));
const monsters = new Set(loadGameData().allMonsters().map(monster => monster.shortType));
const source = {
  has: (name: string) => existsSync(file(name)) ||
    existsSync(resolve(directory, "../../Payload/DragonIsland.app", name)),
  plist: read,
};

describe("earned dungeon dialogue repair", () => {
  it("repairs both authored finale chats only when the final fixed victory was earned", () => {
    expect(earnedDungeonBattleDialogs(source, worlds, monsters, [])).toEqual([]);
    expect(earnedDungeonBattleDialogs(source, worlds, monsters, ["FinalBattle5"]))
      .not.toContain("CaiusDefeated");
    expect(earnedDungeonBattleDialogs(source, worlds, monsters, ["FinalBattle6"]))
      .toEqual(["Caius", "CaiusDefeated"]);
    expect(earnedDungeonBattleDialogs(source, worlds, monsters, ["UnknownVictory"]))
      .toEqual([]);
  });

  it.each(["duplicate", "cadence"])("does not infer chats from %s encounter identities", (kind) => {
    const modified = {
      ...source,
      plist: (name: string) => {
        const value = read(name);
        if (name === "Dungeon_14.plist") {
          const visit = (node: any): void => {
            if (!node || typeof node !== "object") return;
            if (node.uniqueKey === "FinalBattle5") {
              node.uniqueKey = kind === "duplicate" ? "FinalBattle6" : "FinalBattle";
              if (kind === "cadence") node.everyXFloors = 1;
            }
            for (const child of Object.values(node)) visit(child);
          };
          visit(value);
        }
        return value;
      },
    };
    expect(earnedDungeonBattleDialogs(modified, worlds, monsters, ["FinalBattle6"]))
      .not.toContain("CaiusDefeated");
  });
});
