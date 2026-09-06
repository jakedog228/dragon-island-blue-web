import { GameData, loadWorldData } from "@dib/gamedata/browser";
import type { NativeSaveContext } from "../player/nativeSave/index.js";
import type { ImportedContentPackage } from "./archivePackage.js";

/**
 * The archive-resolved identities native save import/export needs.
 *
 * Deliberately narrower than {@link import("../loadGame.js").loadGame}: the save panel opens before
 * the game boots and must not depend on assets, animations, localization, or the Collection
 * catalog. It needs exactly two things — the definition tables to resolve species, jobs and items,
 * and the world -> POI index that maps `props.lastTown` back to the world that owns it.
 */
export function nativeSaveContextFor(content: ImportedContentPackage): NativeSaveContext {
  const {
    monsters, combines, jobs, abilities, abilityComponents, buffs,
    items, licenses, tournaments, thingsInWorld,
  } = content.data;
  const data = GameData.fromRaw({
    monsters,
    combines,
    jobs,
    abilities,
    abilityComponents,
    buffs,
    ...(items !== undefined ? { items } : {}),
    ...(licenses !== undefined ? { licenses } : {}),
    ...(tournaments !== undefined ? { tournaments } : {}),
    ...(thingsInWorld !== undefined ? { thingsInWorld } : {}),
  });
  const knownMonsterTypes = new Set(data.allMonsters().map(({ shortType }) => shortType));
  const worldPoiNames = new Map(content.worldNames.map((worldName) => [
    worldName,
    loadWorldData(content.resources, worldName, knownMonsterTypes)
      .pointsOfInterest.map(({ name }) => name),
  ] as const));
  return { data, worldPoiNames };
}
