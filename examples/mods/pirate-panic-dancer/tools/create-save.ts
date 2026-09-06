import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  encodeNativeSaveDocument,
  type NativeRenderableRecord,
  type NativeSaveDocument,
} from "../../../../apps/web/src/player/nativeSave/nativeSaveDocument.js";
import type { PlistValue } from "../../../../apps/web/src/player/nativeSave/binaryPlist.js";

const level = 30;
const dict = (entries: ReadonlyArray<readonly [string, PlistValue]> = []) =>
  new Map<string, PlistValue>(entries);
const int = (value: number): PlistValue => ({ kind: "int", value });
const string = (value: string): PlistValue => ({ kind: "string", value });
const array = (value: PlistValue[]): PlistValue => ({ kind: "array", value });

const pirate: NativeRenderableRecord = {
  name: "ModPirate.PirateMan",
  creationFile: "Monsters.plist",
  creationArguments: dict([
    ["jobArguments", { kind: "dict", value: dict([["level", int(level)]]) }],
  ]),
  properties: dict([["JobLevelProp", { kind: "real", value: level }]]),
  monsterSaveData: dict(),
  children: [],
};

const document: NativeSaveDocument = {
  silver: 1000,
  goldFound: 0,
  goldSpent: 0,
  options: dict(),
  variables: dict(),
  tutorialFlags: dict(),
  waypoints: dict(),
  poiData: dict(),
  props: dict([
    ["highestLevelMonsters", { kind: "dict", value: dict([["PirateMan", int(level)]]) }],
    ["lastTown", string("First_City")],
    ["visitedWorlds", array([string("World_1-1")])],
    ["visitedTowns", array([string("First_City")])],
    ["dayNumber", int(1)],
  ]),
  player: {
    savedLicenseType: "Novice",
    savedMonsters: [pirate],
    savedItems: [],
    savedGemsInLicense: [],
  },
};

async function main(): Promise<void> {
  const outputDirectory = resolve(
    process.cwd(),
    "../../examples/mods/pirate-panic-dancer/save",
  );
  await mkdir(outputDirectory, { recursive: true });
  const output = resolve(outputDirectory, "pirate-savefile0");
  const bytes = encodeNativeSaveDocument(document);
  await writeFile(output, bytes);
  console.log(`wrote ${output} (${bytes.byteLength} bytes)`);
}

void main();
