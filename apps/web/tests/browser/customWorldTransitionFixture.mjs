import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import * as plist from "plist";

const SOURCE_WORLD = "World_1-1";
const TARGET_WORLD = "World_1-2";
export const CARDINAL_TARGET_WORLD = TARGET_WORLD;
export const NON_CARDINAL_TARGET_WORLD = "World_5-1";
export const CUSTOM_SOURCE_WORLD = "ModWorld_1-1";
export const CUSTOM_TARGET_WORLD = "ModWorld_1-2";
export const NORMAL_TO_CUSTOM_EXIT = "1-1_Zone_Change_1";
export const CUSTOM_SOURCE_EXIT = "ModWorld_1-1_Zone_Change";
export const CUSTOM_TARGET_ENTRY = "1-2_Zone_Change_1";
export const CUSTOM_MONSTER_SHORT_TYPE = "InheritedMetalSlime";

const clone = (value) => JSON.parse(JSON.stringify(value));

function appRootEntry(files, leafName) {
  const suffix = new RegExp(`Payload/[^/]+\\.app/${leafName.replace(".", "\\.")}$`, "i");
  const entry = Object.keys(files).find((candidate) => suffix.test(candidate));
  assert(entry, `fixture source archive has no app-root ${leafName}`);
  return entry;
}

/**
 * Build a temporary modified IPA matching the playtester's three-world report:
 *
 * - a nonadjacent `World_1-1 -> World_5-1` link;
 * - a normal-world `World_1-1 -> ModWorld_1-1` link;
 * - a `ModWorld_1-1 -> ModWorld_1-2` link;
 * - empty table / empty populator encounter shapes on those exits; and
 * - a custom monster whose matching Jobs child contains only `parent`.
 */
export function buildCustomWorldTransitionFixture({
  sourceArchive,
  outputArchive,
  sourceRoute = "custom",
}) {
  assert(
    sourceRoute === "custom" || sourceRoute === "noncardinal",
    `unsupported custom-world source route ${sourceRoute}`,
  );
  const resolvedSource = path.resolve(sourceArchive);
  const resolvedOutput = path.resolve(outputArchive);
  assert(fs.existsSync(resolvedSource), `fixture source archive is missing: ${resolvedSource}`);

  const files = unzipSync(new Uint8Array(fs.readFileSync(resolvedSource)));
  const worldsEntry = appRootEntry(files, "Worlds.plist");
  const sourceEntry = appRootEntry(files, `${SOURCE_WORLD}.plist`);
  const targetEntry = appRootEntry(files, `${TARGET_WORLD}.plist`);
  const monstersEntry = appRootEntry(files, "Monsters.plist");
  const jobsEntry = appRootEntry(files, "Jobs.plist");
  const appRoot = worldsEntry.slice(0, -"Worlds.plist".length);

  const worlds = plist.parse(Buffer.from(files[worldsEntry]));
  assert(worlds[SOURCE_WORLD], `fixture Worlds.plist has no ${SOURCE_WORLD}`);
  assert(worlds[TARGET_WORLD], `fixture Worlds.plist has no ${TARGET_WORLD}`);
  worlds[NON_CARDINAL_TARGET_WORLD] = clone(worlds[TARGET_WORLD]);
  worlds[CUSTOM_SOURCE_WORLD] = clone(worlds[SOURCE_WORLD]);
  worlds[CUSTOM_TARGET_WORLD] = clone(worlds[TARGET_WORLD]);

  const originalSourceWorld = plist.parse(Buffer.from(files[sourceEntry]));
  const sourceWorld = clone(originalSourceWorld);
  const sourceExit = sourceWorld.pointsOfInterest?.find(
    (poi) => poi?.arguments?.instanceName === NORMAL_TO_CUSTOM_EXIT,
  );
  assert(sourceExit, `fixture ${SOURCE_WORLD} has no ${NORMAL_TO_CUSTOM_EXIT}`);
  const zoneArguments = sourceExit.arguments.zoneChange?.arguments;
  assert(zoneArguments?.world, `fixture ${NORMAL_TO_CUSTOM_EXIT} has no world destination`);
  assert.equal(zoneArguments.targetZoneChange, CUSTOM_TARGET_ENTRY);
  if (sourceRoute === "custom") {
    zoneArguments.world.type = CUSTOM_SOURCE_WORLD;
    zoneArguments.targetZoneChange = CUSTOM_SOURCE_EXIT;
    // This is the playtester's likely empty-populator shape: the typed populator exists, but its
    // arguments contain no ordinary types or fixed encounters. Native setup returns nil data.
    sourceExit.arguments.encounters = {
      table: {
        "1": {
          monsterPopulator: {
            class: "DefaultMonsterPopulator",
            arguments: {},
          },
        },
      },
    };
  } else {
    zoneArguments.world.type = NON_CARDINAL_TARGET_WORLD;
    zoneArguments.targetZoneChange = CUSTOM_TARGET_ENTRY;
    sourceExit.arguments.encounters = { table: {} };
  }

  const customSourceWorld = clone(originalSourceWorld);
  const customExit = customSourceWorld.pointsOfInterest?.find(
    (poi) => poi?.arguments?.instanceName === NORMAL_TO_CUSTOM_EXIT,
  );
  assert(customExit, `fixture custom source has no ${NORMAL_TO_CUSTOM_EXIT}`);
  customExit.arguments.instanceName = CUSTOM_SOURCE_EXIT;
  customExit.arguments.encounters = {
    table: { "1": { monsterPopulator: {} } },
  };
  customExit.arguments.zoneChange.arguments.world.type = CUSTOM_TARGET_WORLD;
  customExit.arguments.zoneChange.arguments.targetZoneChange = CUSTOM_TARGET_ENTRY;

  const monsters = plist.parse(Buffer.from(files[monstersEntry]));
  const jobs = plist.parse(Buffer.from(files[jobsEntry]));
  monsters.Mod ??= {};
  jobs.Mod ??= {};
  monsters.Mod[CUSTOM_MONSTER_SHORT_TYPE] = {
    parent: "Slime.Metal.MetalSlime",
    index: 9_999_999,
  };
  jobs.Mod[CUSTOM_MONSTER_SHORT_TYPE] = { parent: "Slime.Metal.MetalSlime" };
  const inheritedMonsterSprite = `${appRoot}MetalSlime-hd.png`;
  assert(files[inheritedMonsterSprite], `fixture source has no ${inheritedMonsterSprite}`);
  for (const portraitLeaf of ["MonsterPortraits-hd.plist", "MonsterPortraits.plist"]) {
    const portraitEntry = appRootEntry(files, portraitLeaf);
    const portraitAtlas = plist.parse(Buffer.from(files[portraitEntry]));
    const inheritedPortrait = portraitAtlas.frames?.["MetalSlime_icon.png"];
    assert(inheritedPortrait, `${portraitLeaf} has no MetalSlime portrait`);
    portraitAtlas.frames[`${CUSTOM_MONSTER_SHORT_TYPE}_icon.png`] = clone(inheritedPortrait);
    files[portraitEntry] = strToU8(plist.build(portraitAtlas));
  }

  files[worldsEntry] = strToU8(plist.build(worlds));
  files[sourceEntry] = strToU8(plist.build(sourceWorld));
  files[monstersEntry] = strToU8(plist.build(monsters));
  files[jobsEntry] = strToU8(plist.build(jobs));
  files[`${appRoot}${CUSTOM_MONSTER_SHORT_TYPE}-hd.png`] = files[inheritedMonsterSprite];
  files[`${appRoot}${NON_CARDINAL_TARGET_WORLD}.plist`] = files[targetEntry];
  files[`${appRoot}${CUSTOM_SOURCE_WORLD}.plist`] = strToU8(plist.build(customSourceWorld));
  files[`${appRoot}${CUSTOM_TARGET_WORLD}.plist`] = files[targetEntry];
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, zipSync(files, {
    level: 6,
    mtime: new Date("2000-01-01T00:00:00.000Z"),
  }));

  return Object.freeze({ outputArchive: resolvedOutput, sourceRoute, worldsEntry });
}
