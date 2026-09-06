import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { GameData, loadWorldData } from "@dib/gamedata";
import { loadDungeonData } from "@dib/gamedata/dungeon";
import { generateDungeonFloor } from "@dib/engine/dungeon";
import { importContentArchive, importedResourceMimeType } from "../src/content/archivePackage.js";
import { readFileSync as readSourceFile } from "node:fs";
import {
  createDungeonScenarioArchive,
  DUNGEON_SCENARIO_FIXTURES,
} from "./browser/dungeonScenarioArchive.mjs";

const root = resolve(import.meta.dirname, "../../..");
const scenarioPath = resolve(root, "apps/web/tests/browser/dungeon-all-themes.playwright.mjs");

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes: Uint8Array, name: string): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)], name).toEqual(PNG_SIGNATURE);
  let offset = 8;
  let width = 0;
  let height = 0;
  let idat = new Uint8Array();
  let sawIhdr = false;
  let sawIend = false;
  while (offset < bytes.length) {
    expect(bytes.length - offset, name).toBeGreaterThanOrEqual(12);
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const end = offset + 12 + length;
    expect(end, name).toBeLessThanOrEqual(bytes.length);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    const body = bytes.subarray(offset + 4, offset + 8 + length);
    const actualCrc = new DataView(bytes.buffer, bytes.byteOffset + offset + 8 + length, 4).getUint32(0);
    expect(actualCrc, `${name} ${type} CRC`).toBe(crc32(body));
    if (type === "IHDR") {
      expect(sawIhdr, name).toBe(false);
      expect(length, name).toBe(13);
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      width = view.getUint32(0);
      height = view.getUint32(4);
      expect(payload[8], name).toBe(8);
      expect(payload[9], name).toBe(6);
      expect(payload[10], name).toBe(0);
      expect(payload[11], name).toBe(0);
      expect(payload[12], name).toBe(0);
      sawIhdr = true;
    } else if (type === "IDAT") {
      const next = new Uint8Array(idat.length + payload.length);
      next.set(idat);
      next.set(payload, idat.length);
      idat = next;
    } else if (type === "IEND") {
      expect(length, name).toBe(0);
      sawIend = true;
      expect(end, name).toBe(bytes.length);
    }
    offset = end;
  }
  expect(sawIhdr, name).toBe(true);
  expect(sawIend, name).toBe(true);
  expect(idat.length, name).toBeGreaterThan(0);
  const scanlines = inflateSync(idat);
  expect(scanlines.byteLength, name).toBe((width * 4 + 1) * height);
  return { width, height };
}

function validateWav(bytes: Uint8Array, name: string): void {
  expect(new TextDecoder().decode(bytes.subarray(0, 4)), name).toBe("RIFF");
  expect(new TextDecoder().decode(bytes.subarray(8, 12)), name).toBe("WAVE");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(16, true), name).toBe(16);
  expect(view.getUint16(20, true), name).toBe(1);
  expect(view.getUint16(22, true), name).toBe(1);
  expect(new TextDecoder().decode(bytes.subarray(36, 40)), name).toBe("data");
  const dataLength = view.getUint32(40, true);
  expect(dataLength, name).toBe(bytes.length - 44);
  expect(dataLength, name).toBeGreaterThan(0);
}

describe("dungeon all-theme scenario source contract", () => {
  it("is opt-in, task-owned, muted, isolated, and text-state-only", () => {
    const source = readFileSync(scenarioPath, "utf8");
    expect(source).toContain("mkdtemp");
    expect(source).toContain("writeFile");
    expect(source).toContain("newContext");
    expect(source).toContain('const routeDirectory = await mkdtemp(join(directory, "route-"));');
    expect(source).toContain("await writeFile(archivePath, createDungeonScenarioArchive());");
    expect(source).toContain("await rm(routeDirectory, { recursive: true, force: true });");
    expect(source).not.toContain('const archivePath = join(directory, "task-owned-dungeon-scenario.zip");');
    const fixtureLoop = source.indexOf("for (const fixture of fixtures)");
    const archiveWrite = source.indexOf("await writeFile(archivePath, createDungeonScenarioArchive());");
    expect(fixtureLoop).toBeGreaterThanOrEqual(0);
    expect(archiveWrite).toBeGreaterThan(fixtureLoop);
    expect(source).toContain("entryZoneName");
    expect(source).not.toContain("DIB_CONTENT_ARCHIVE");
    expect(source).not.toContain("readdirSync");
    expect(source).not.toContain("repositoryRoot");
    expect(source).toContain('"--mute-audio"');
    expect(source).not.toContain("page.screenshot");
    expect(source).not.toMatch(/Dragon_Island_Blue_1\.1\.0\.ipa/);
    expect(source).toContain("window.render_game_to_text");
  });

  it("generates a strict compatible package with six exact route fixtures", () => {
    const archive = createDungeonScenarioArchive();
    const files = unzipSync(archive);
    const pngSizes = new Map<string, { width: number; height: number }>();
    for (const [name, bytes] of Object.entries(files)) {
      if (name.endsWith(".png")) pngSizes.set(name, validatePng(bytes, name));
      if (/\.wav$/.test(name)) validateWav(bytes, name);
    }
    expect(pngSizes.size).toBeGreaterThan(40);
    expect(pngSizes.get("SlotBackground-hd.png")).toEqual({ width: 960, height: 640 });
    expect(pngSizes.get("SlotBackground-ipadhd.png")).toEqual({ width: 1024, height: 768 });
    expect(pngSizes.get("SlotBacking-hd.png")).toEqual({ width: 364, height: 203 });
    expect(pngSizes.get("SlotBacking-ipadhd.png")).toEqual({ width: 426, height: 238 });
    expect(pngSizes.get("SlotArrow-hd.png")).toEqual({ width: 94, height: 62 });
    expect(pngSizes.get("largeRarityStar-hd.png")).toEqual({ width: 64, height: 59 });
    expect(pngSizes.get("mainscreenBackground.png")).toEqual({ width: 1024, height: 768 });
    expect(pngSizes.get("saveSlotBackground.png")).toEqual({ width: 1024, height: 768 });

    const content = importContentArchive(archive, "task-owned-scenario.zip");
    try {
      expect(content.hasDungeonCapability).toBe(true);
      expect(content.hasTownCapability).toBe(false);
      const gameData = GameData.fromRaw({
        monsters: content.data.monsters,
        jobs: content.data.jobs,
        abilities: content.data.abilities,
        abilityComponents: content.data.abilityComponents,
        buffs: content.data.buffs,
      });
      expect(gameData.allMonsters()).toHaveLength(19);
      for (const monster of gameData.allMonsters()) {
        expect(gameData.jobXpPenalty(monster.shortType), `${monster.shortType} Jobs entry`).toBe(1);
      }
      const world = loadWorldData(content.resources, "Harbor", new Set(["Testling"]));
      expect(world.pointsOfInterest.map(({ name }) => name)).toEqual(["ScenarioStart"]);
      expect(world.pointsOfInterest[0]?.randomPopulators).toEqual([]);
      expect(content.dungeonTypes).toEqual(["Cave", "Dungeon", "Forest", "Water"]);
      expect(content.dungeonFiles).toEqual([
        "Dungeon_1.plist", "Dungeon_15.plist", "Dungeon_15b.plist", "Dungeon_3.plist",
        "Dungeon_7.plist", "Dungeon_9.plist",
      ]);
      expect(DUNGEON_SCENARIO_FIXTURES).toHaveLength(6);
      expect(Object.keys(content.manifest.fonts).sort()).toEqual([
        "arial_14-hd", "arial_14_bold-hd", "arial_18_bold-hd", "arial_20_bold-hd",
      ]);
      for (const name of [
        "PopupMenuCloseButton-hd", "MMScreen", "inBattingOrderBkg-hd", "sleepZ-hd",
        "confusionStatus-hd", "paralyzeBolt-hd",
      ]) expect(content.manifest.sprites[name], name).toBeDefined();
      expect(content.manifest.atlases["FXSheet-hd"]).toBeDefined();
      expect(content.manifest.particles["PoisonParticles.plist"]).toBeDefined();
      expect(content.manifest.particles["Sparkle.plist"]).toBeDefined();
      for (const name of [
        "Encounter", "click", "notAllowed", "CaptureSuccess", "CaptureFail", "Escape",
        "Stairs_EnterDungeon", "Field1", "Dungeon1", "Dungeon2", "Casino1",
      ]) expect(content.manifest.audio[name], name).toBeDefined();
      for (const [name, url] of Object.entries(content.manifest.audio)) {
        expect(name, "audio manifest key").not.toMatch(/\.(?:mp3|m4a|wav)$/i);
        expect(url, `audio manifest URL ${name}`).toMatch(/\.wav$/i);
        expect(importedResourceMimeType(url), `audio MIME ${name}`).toBe("audio/wav");
      }
      const audioSource = readSourceFile(resolve(root, "apps/web/src/audio.ts"), "utf8");
      const sfxPreloadStart = audioSource.indexOf("  async preloadSfx(");
      const sfxPlaybackStart = audioSource.indexOf("  playSfx(");
      const musicPlaybackStart = audioSource.indexOf("  playMusic(");
      expect(sfxPreloadStart).toBeGreaterThanOrEqual(0);
      expect(sfxPlaybackStart).toBeGreaterThan(sfxPreloadStart);
      expect(musicPlaybackStart).toBeGreaterThan(sfxPlaybackStart);
      const sfxPreload = audioSource.slice(sfxPreloadStart, sfxPlaybackStart);
      const sfxPlayback = audioSource.slice(sfxPlaybackStart, musicPlaybackStart);
      const musicPlayback = audioSource.slice(musicPlaybackStart);
      expect(sfxPreload).toContain("decodeAudioData");
      expect(sfxPreload).toContain("/\\.mp3$/i.test(name)");
      expect(sfxPreload).toContain("/\\.mp3$/i.test(url)");
      expect(sfxPlayback).toContain("createBufferSource");
      expect(sfxPlayback).not.toContain("new Audio");
      expect(musicPlayback).toContain("new Audio(url)");
      expect(musicPlayback).not.toContain("decodeAudioData");
      const assetLibrarySource = readSourceFile(
        resolve(root, "packages/renderer/src/assetLibrary.ts"), "utf8",
      );
      expect(assetLibrarySource).toContain("name.replace(/\\.(m4a|mp3|wav)$/");
      for (const fixture of DUNGEON_SCENARIO_FIXTURES) {
        const definition = loadDungeonData(
          content.resources,
          fixture.route.typeName,
          fixture.route.sourceFile,
          fixture.route.floor,
          new Set(["Testling"]),
        );
        expect(definition.instanceName, fixture.label).toBe(fixture.instanceName);
        const floor = generateDungeonFloor(definition, fixture.route.floor, 0xD06E00D, {
          monsterTypes: ["Testling"],
          entryZoneName: fixture.route.entryZoneName,
        });
        const start = floor.rooms.find((room) => room.id === floor.startRoomId);
        expect(start?.zones.some((zone) =>
          "instanceName" in zone.change && zone.change.instanceName === fixture.route.entryZoneName,
        ), fixture.label)
          .toBe(true);
      }
    } finally {
      content.dispose();
    }
  });
});
