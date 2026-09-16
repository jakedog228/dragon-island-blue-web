import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadGameData, loadWorldData, resolveDataDir, type WorldResourceSource } from "@dib/gamedata";
import { loadDungeonData } from "@dib/gamedata/dungeon";
import { DungeonRuntimeController, dungeonDefinitionId, type DungeonSession } from "@dib/engine";
import { canonicalLogicValue } from "@dib/logic-pack";
import { FixedBattleEncounterV1Schema } from "@dib/game-protocol";
import { officialReconnectEnemyTeam, restoreFixedMonsterAppearance, restoreOfficialDungeonAppearance, restoreOfficialDungeonRun } from "../src/authority/battleAppearance.js";
import { battlePortraitFrame, battleSpriteKey } from "../src/battle/encounter.js";

const monsterTypes = loadGameData().allMonsters().map((monster) => monster.shortType);
const source: WorldResourceSource = {
  has: (path) => !path.endsWith(".plist") || /-hd\.plist$/.test(path) || existsSync(resolve(resolveDataDir(), path.replace(/\.plist$/, ".json"))),
  plist: (path) => JSON.parse(readFileSync(resolve(resolveDataDir(), path.replace(/\.plist$/, ".json")), "utf8")),
};
const neutral = <T>(value: T): T => canonicalLogicValue(value as Parameters<typeof canonicalLogicValue>[0]) as T;

it("restores all shipped named world bosses by exact POI/table and preserves replay mechanics", () => {
  let named = 0;
  for (const name of Object.keys(source.plist("Worlds.plist") as object)) {
    const world = loadWorldData(source, name, new Set(monsterTypes));
    for (const poi of world.pointsOfInterest) for (const row of poi.randomPopulators) {
      const fixed = row.fixedEncounters[0];
      if (!fixed?.monsters.some((monster) => monster.extraLivingArguments?.displayName)) continue;
      const members = fixed.monsters.map((monster) => ({ type: monster.type, level: 99,
        ...(monster.extraLivingArguments === undefined ? {} : { extraLivingArguments: neutral(monster.extraLivingArguments) }) }));
      const committed = members.map((member) => ({ shortType: member.type, level: 99, currentHp: 17, boss: true, flatStatBonuses: { MaxHP: 1234 } }));
      const battle = { scene: { kind: "world", worldId: name, poiId: poi.name },
        fixedEncounter: FixedBattleEncounterV1Schema.parse({ source: { kind: "world", tableKey: String(row.tier) }, members }) };
      const restored = officialReconnectEnemyTeam(battle, committed, { world: () => world, dungeon: () => undefined });
      fixed.monsters.forEach((monster, index) => {
        expect(restored[index]).toMatchObject(committed[index]!);
        expect(restored[index]?.displayName).toBe(monster.extraLivingArguments?.displayName);
        expect(restored[index]?.rendererData).toEqual(monster.extraLivingArguments?.rendererData);
        expect(battlePortraitFrame(restored[index]!)).toBe(`${monster.type}_icon.png`);
        if (restored[index]?.displayName === "Arkanis") expect(battleSpriteKey(restored[index]!)).toBe("MegaDragon-hd");
        if (restored[index]?.displayName === "Quetzalcoatl") expect(battleSpriteKey(restored[index]!)).toBe("GreenDragon-hd");
      });
      expect(committed.some((member) => "rendererData" in member)).toBe(false);
      named++;
    }
  }
  expect(named).toBe(15);
});

it.each([["Dungeon_15.plist", 100], ["Dungeon_15b.plist", 220]] as const)(
  "restores Fafnir in %s through strict runtime restore and battle reconnect", (sourceFile, floor) => {
    const context = { resources: source, monsterTypes, runSeed: 42 };
    const run = DungeonRuntimeController.enter({ ...context, legacyDungeonGenerationSemantics: true }, { typeName: "Cave", sourceFile, floor });
    const bossRoom = run.session.state.rooms.find((room) => room.encounter?.monsters.some((monster) => monster.extraLivingArguments?.displayName === "Fafnir"))!;
    expect(bossRoom).toBeDefined();
    run.session.enterCurrentRoom();
    walkTo(run.session, bossRoom.id);
    // A retreat/Save Me materializes the authoritative survivor roster in the run snapshot.
    run.session.prepareEncounterRoomRoster(bossRoom.encounter!.id, "retreat-1", bossRoom.encounter!.monsters).commit();
    const mechanical = neutral(run.snapshot());
    expect(() => DungeonRuntimeController.restore({ ...context, legacyDungeonGenerationSemantics: true }, mechanical)).toThrow(/ordered subsequence/);
    const restoredSnapshot = restoreOfficialDungeonAppearance(mechanical, source, monsterTypes);
    expect(() => DungeonRuntimeController.restore(context, restoredSnapshot)).toThrow();
    const restoredRun = restoreOfficialDungeonRun(context, mechanical);
    const encounter = restoredRun.session.currentRoom.encounter!;
    const definition = loadDungeonData(source, "Cave", sourceFile, floor, new Set(monsterTypes));
    const committed = encounter.monsters.map((monster) => ({ shortType: monster.type, level: monster.level, currentHp: 19, boss: true }));
    const battle = { scene: { kind: "dungeon", dungeonId: dungeonDefinitionId(definition) }, fixedEncounter:
      FixedBattleEncounterV1Schema.parse({ source: { kind: "dungeon", encounterId: encounter.id }, members: neutral(encounter.monsters) }) };
    const team = officialReconnectEnemyTeam(battle, committed, { world: () => undefined, dungeon: () => definition }, floor);
    const fafnir = team.find((member) => member.displayName === "Fafnir")!;
    expect(battleSpriteKey(fafnir)).toBe("BlackDragon-hd");
    expect(battlePortraitFrame(fafnir)).toBe("BoneDragon_icon.png");
    expect(fafnir.currentHp).toBe(19);
    expect(neutral(restoredSnapshot)).toEqual(mechanical);
    const cached = { ...mechanical, cachedFloors: [mechanical.current] };
    expect(restoreOfficialDungeonAppearance(cached, source, monsterTypes).cachedFloors[0]).toEqual(restoredSnapshot.current);
    expect(cached.cachedFloors[0]).toEqual(mechanical.current);
  });

it("aligns same-species survivors by arguments, supports Random, and rejects ambiguous art", () => {
  const authored = [
    { type: "BoneDragon", extraLivingArguments: { displayName: "First", rendererData: { spriteFile: "First.png" } } },
    { type: "BoneDragon", extraLivingArguments: { displayName: "Second", rendererData: { spriteFile: "Second.png" } } },
    { type: "Random" },
  ];
  const survivors = [{ type: "BoneDragon", level: 99, extraLivingArguments: { displayName: "Second" } }, { type: "FireCub", level: 5 }];
  expect(restoreFixedMonsterAppearance(survivors, authored)[0]?.extraLivingArguments?.rendererData).toEqual({ spriteFile: "Second.png" });
  expect(() => restoreFixedMonsterAppearance([{ type: "BoneDragon", level: 99 }], authored.map((monster) => ({ ...monster,
    extraLivingArguments: { rendererData: monster.extraLivingArguments?.rendererData } })))).toThrow(/ambiguous/);
  expect(() => restoreFixedMonsterAppearance([...survivors].reverse(), authored)).toThrow(/does not match/);
});

it("does not infer ordinary overrides or accept artwork fields on the wire", () => {
  const team = [{ shortType: "FireDragon", level: 99 }];
  const sources = { world: () => { throw new Error("unexpected lookup"); }, dungeon: () => undefined };
  expect(officialReconnectEnemyTeam({ scene: { kind: "world" }, fixedEncounter: null }, team, sources)).toEqual(team);
  expect(() => officialReconnectEnemyTeam({ scene: { kind: "world" } }, team, sources)).toThrow(/v24/);
  expect(() => FixedBattleEncounterV1Schema.parse({ source: { kind: "world", tableKey: "1" },
    members: [{ type: "FireDragon", level: 99, extraLivingArguments: { rendererData: { spriteFile: "MegaDragon.png" } } }] })).toThrow();
});

function walkTo(session: DungeonSession, target: string): void {
  const rooms = session.state.rooms;
  const start = session.state.currentRoomId;
  const queue = [start], seen = new Set([start]), previous = new Map<string, string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (id === target) break;
    for (const link of rooms.find((room) => room.id === id)!.links) {
      if (seen.has(link.targetRoomId)) continue;
      seen.add(link.targetRoomId); previous.set(link.targetRoomId, id); queue.push(link.targetRoomId);
    }
  }
  const path: string[] = [];
  for (let id = target; id !== start; id = previous.get(id)!) path.push(id);
  for (const id of path.reverse()) session.moveToRoom(id);
}
