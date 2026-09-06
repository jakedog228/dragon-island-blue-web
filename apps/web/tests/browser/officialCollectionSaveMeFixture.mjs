import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, strToU8 } from "fflate";
import * as plist from "plist";

/**
 * Test-only structurally compatible Collection catalog.
 *
 * A fresh Water starter completes the one goal. Its committed level-105 join raises the hero above
 * Save Me's level-6 gate; the browser contract destroys that reserve through the semantic party
 * command before losing the next battle. Field 2 receives a test-only fixed Goblin so that proof
 * never depends on the shipped random-encounter occurrence roll.
 */
export const OFFICIAL_COLLECTION_SAVE_ME_CATALOG = Object.freeze({
  Base: Object.freeze([Object.freeze({
    key: "Collector",
    monsters: Object.freeze(["BlueBabyDragon"]),
    treasureData: Object.freeze({
      items: Object.freeze([Object.freeze({
        data: Object.freeze({
          arguments: Object.freeze({ jobLevel: 105, shortType: "Spikey" }),
          type: "DestroyOnPickup.MonsterJoin",
        }),
        spawnType: "fixed",
      })]),
    }),
  })]),
});

const FIXED_FIELD_TWO_ENCOUNTER = Object.freeze({
  breeder: Object.freeze({
    arguments: Object.freeze({
      stats: Object.freeze({ MaxHP: 1, Speed: 1 }),
      xpBonus: 3,
    }),
    type: "Normal",
  }),
  chanceToAppear: 1,
  exactFloor: 1,
  monsters: Object.freeze([Object.freeze({ type: "Goblin" })]),
});

function installFixedRecoveryEncounter(world) {
  const field = world.pointsOfInterest?.find((poi) =>
    poi?.arguments?.instanceName === "1-1_Field_2");
  assert(field, "fixture World_1-1 has no Field 2 POI");
  const populator = field.arguments.encounters?.table?.["1"]?.monsterPopulator;
  assert(populator?.arguments, "fixture Field 2 has no floor-1 monster populator");
  populator.arguments.fixedEncounters = [FIXED_FIELD_TWO_ENCOUNTER];
  return world;
}

export function buildOfficialCollectionSaveMeFixture(options) {
  const sourceArchive = path.resolve(options.sourceArchive);
  const sourceExtracted = path.resolve(options.sourceExtracted);
  const outputArchive = path.resolve(options.outputArchive);
  const outputExtracted = path.resolve(options.outputExtracted);
  assert(fs.existsSync(sourceArchive), `fixture source archive is missing: ${sourceArchive}`);
  assert(fs.existsSync(sourceExtracted), `fixture extracted directory is missing: ${sourceExtracted}`);

  fs.rmSync(outputExtracted, { recursive: true, force: true });
  fs.cpSync(sourceExtracted, outputExtracted, { recursive: true });
  fs.writeFileSync(
    path.join(outputExtracted, "data", "Collection.json"),
    `${JSON.stringify(OFFICIAL_COLLECTION_SAVE_ME_CATALOG, null, 2)}\n`,
  );
  const extractedWorldPath = path.join(outputExtracted, "data", "World_1-1.json");
  const extractedWorld = installFixedRecoveryEncounter(JSON.parse(fs.readFileSync(
    extractedWorldPath,
    "utf8",
  )));
  fs.writeFileSync(extractedWorldPath, `${JSON.stringify(extractedWorld, null, 2)}\n`);

  const files = unzipSync(new Uint8Array(fs.readFileSync(sourceArchive)));
  const collectionPath = Object.keys(files).find((entry) =>
    /Payload\/[^/]+\.app\/Collection\.plist$/i.test(entry));
  assert(collectionPath, "fixture source archive has no app-root Collection.plist");
  files[collectionPath] = strToU8(plist.build(OFFICIAL_COLLECTION_SAVE_ME_CATALOG));
  const worldPath = Object.keys(files).find((entry) =>
    /Payload\/[^/]+\.app\/World_1-1\.plist$/i.test(entry));
  assert(worldPath, "fixture source archive has no app-root World_1-1.plist");
  const archiveWorld = installFixedRecoveryEncounter(plist.parse(Buffer.from(files[worldPath])));
  files[worldPath] = strToU8(plist.build(archiveWorld));
  fs.mkdirSync(path.dirname(outputArchive), { recursive: true });
  fs.writeFileSync(outputArchive, zipSync(files, {
    level: 6,
    // fflate otherwise stamps every entry with the current time, making the fixture bytewise
    // different on every build even though its structural package content is identical.
    mtime: new Date("2000-01-01T00:00:00.000Z"),
  }));
  return Object.freeze({ outputArchive, outputExtracted, collectionPath, worldPath });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sourceArchive, sourceExtracted, outputArchive, outputExtracted] = process.argv.slice(2);
  assert(sourceArchive && sourceExtracted && outputArchive && outputExtracted,
    "usage: node officialCollectionSaveMeFixture.mjs <source.ipa> <source-extracted> <output.ipa> <output-extracted>");
  process.stdout.write(`${JSON.stringify(buildOfficialCollectionSaveMeFixture({
    sourceArchive,
    sourceExtracted,
    outputArchive,
    outputExtracted,
  }), null, 2)}\n`);
}
