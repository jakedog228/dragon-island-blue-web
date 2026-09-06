import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata";
import { battingOrderSizeFor } from "@dib/player-domain";
import { jobXpCostOfNextLevel, jobXpForLevel } from "@dib/engine";
import { decodeBinaryPlist, type PlistValue } from "../src/player/nativeSave/binaryPlist.js";
import {
  decodeNativeSaveDocument,
  encodeNativeSaveDocument,
} from "../src/player/nativeSave/nativeSaveDocument.js";
import {
  exportNativeSave,
  importNativeSave,
  type NativeSaveContext,
} from "../src/player/nativeSave/nativeSaveTranslate.js";
import {
  looksLikeNativeSave,
  nativeSaveFileName,
  readNativeSave,
  writeNativeSave,
} from "../src/player/nativeSave/index.js";
import type { PlayerGameStateSnapshot } from "../src/player/gameState.js";

const dataUrl = (name: string) => new URL(`../../../extracted/data/${name}.json`, import.meta.url);
const saveUrl = (name: string) => new URL(
  "../../../emulation/DragonIslandBlue-touchHLE-windows/touchHLE_sandbox/" +
    `jp.ne.goo.game.dragonislandblue/Documents/${name}`,
  import.meta.url,
);

const hasContent = existsSync(dataUrl("Monsters"));
const hasSaves = [0, 1, 2].every((slot) => existsSync(saveUrl(`savefile${slot}`)));
// The touchHLE directory is operator-owned live state, not an immutable repository fixture. Its
// saves legitimately change whenever the game is played, while the exact assertions below describe
// the original captured three-save corpus. Keep the corpus proof explicit so an ordinary workspace
// run cannot reinterpret a player's current save as that historical fixture.
const available = process.env.DIB_NATIVE_SAVE_FIXTURES === "1" && hasContent && hasSaves;

const raw = (name: string): unknown => JSON.parse(readFileSync(dataUrl(name), "utf8"));

function buildContext(): NativeSaveContext {
  const data = GameData.fromRaw({
    monsters: raw("Monsters"),
    combines: raw("Combines"),
    jobs: raw("Jobs"),
    abilities: raw("Abilities"),
    abilityComponents: raw("AbilityComponents"),
    buffs: raw("Buffs"),
    items: raw("Items"),
    licenses: raw("Licenses"),
    tournaments: raw("Tournaments"),
  } as Parameters<typeof GameData.fromRaw>[0]);
  const worldNames = Object.keys(raw("Worlds") as Record<string, unknown>);
  const worldPoiNames = new Map(worldNames.flatMap((worldName) => {
    if (!existsSync(dataUrl(worldName))) return [];
    const world = raw(worldName) as {
      pointsOfInterest?: readonly { arguments?: { instanceName?: string } }[];
    };
    const names = (world.pointsOfInterest ?? [])
      .map((poi) => poi.arguments?.instanceName)
      .filter((name): name is string => typeof name === "string");
    return [[worldName, names] as const];
  }));
  return { data, worldPoiNames };
}

const context = available ? buildContext() : undefined;


const SAVES_ON_HAND: readonly { label: string; url: URL }[] = [
  ...[0, 1, 2].flatMap((slot) => [`savefile${slot}`, `savefile${slot}.bak`])
    .map((name) => ({ label: name, url: saveUrl(name) })),
  ...[0, 1, 2].flatMap((slot) => [`savefile${slot}`, `savefile${slot}.bak`])
    .map((name) => ({ label: `working/saves/${name}`, url: new URL(`../../../working/saves/${name}`, import.meta.url) })),
  ...[0, 1, 2].flatMap((slot) => [`savefile${slot}`, `savefile${slot}.bak`])
    .map((name) => ({ label: `root/${name}`, url: new URL(`../../../${name}`, import.meta.url) })),
].filter(({ url }) => existsSync(url));

function saveBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(saveUrl(name)));
}

/**
 * `infiniteDungeonHighestLevel` only exists from profile schema v8 on, so the union has to be
 * narrowed before it can be read. Anything older would be a migration that did not run.
 */
function abyssFloorOf(state: PlayerGameStateSnapshot): number {
  const profile = state.player.profile;
  if (profile.schemaVersion !== 8) throw new Error("expected a schema-8 profile");
  return profile.infiniteDungeonHighestLevel;
}

function jobLevelProps(bytes: Uint8Array): Map<string, number> {
  const document = decodeNativeSaveDocument(bytes);
  const props = new Map<string, number>();
  for (const record of document.player.savedMonsters) {
    const value = record.properties.get("JobLevelProp");
    if (value?.kind === "real" || value?.kind === "int") props.set(record.name, value.value);
  }
  return props;
}

function plain(value: PlistValue): unknown {
  switch (value.kind) {
    case "array": return value.value.map(plain);
    case "dict":
      return Object.fromEntries(
        [...value.value].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, plain(item)]),
      );
    case "data": return [...value.value];
    default: return [value.kind, value.value];
  }
}

describe.skipIf(!available)("native save import", () => {
  it("restores savefile0's bench in order, at its exact XP", () => {
    const result = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const party = result.state.player.party;
    if (party.kind !== "world-trip-party") throw new Error("expected a world-trip party");

    expect(party.monsters.map(({ shortType, level }) => `${shortType}:${level}`)).toEqual([
      "GoldDragonling:7", "Bitewing:7", "Sludge:7", "BatSquirrel:6", "Penguin:4",
      "GiantWasp:7", "Stinger:2", "GiantTurtle:3", "FireCub:4", "Wolf:1",
    ]);
    // `BatSquirrel` at prop 6.947 and `Penguin` at 4.769 are the cases that prove the source
    // floors the property rather than rounding it.
    expect(party.monsters.map(({ cumulativeXp }) => cumulativeXp)).toEqual([
      4575, 4248, 3262, 3118, 845, 4143, 100, 220, 512, 0,
    ]);
  });

  it("puts every monster back at full health, as the source's load path does", () => {
    const result = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const party = result.state.player.party;
    if (party.kind !== "world-trip-party") throw new Error("expected a world-trip party");


    expect(party.monsters.every(({ currentHp }) => currentHp > 1)).toBe(true);
  });

  it("derives the hero level from the collection registry, matching lastSavedLevel", () => {
    for (const [slot, expected] of [[0, 4], [1, 1], [2, 1]] as const) {
      const result = importNativeSave(
        decodeNativeSaveDocument(saveBytes(`savefile${slot}`)),
        context!,
      );
      expect(result.summary.heroLevel).toBe(expected);
      expect(result.warnings.map(({ code }) => code)).not.toContain("hero-level-mismatch");
    }
  });

  it("reproduces the hero level every game-written save records", () => {


    let checked = 0;
    for (const save of SAVES_ON_HAND) {
      const document = decodeNativeSaveDocument(new Uint8Array(readFileSync(save.url)));
      const recorded = document.props.get("lastSavedLevel");
      if (recorded?.kind !== "int") continue;
      const result = importNativeSave(document, context!);
      expect(result.summary.heroLevel, `${save.label} hero level`).toBe(recorded.value);
      expect(result.warnings.map(({ code }) => code), `${save.label} warnings`)
        .not.toContain("hero-level-mismatch");
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it("sizes the batting order from the license and the hero level", () => {
    const result = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const party = result.state.player.party;
    if (party.kind !== "world-trip-party") throw new Error("expected a world-trip party");


    expect(party.battingOrderSize)
      .toBe(battingOrderSizeFor(context!.data.license("Novice").battingOrderSize, 4));
  });

  it("restores the wallet, license and inventory", () => {
    const result = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const profile = result.state.player.profile;
    if (profile.schemaVersion !== 8) throw new Error("expected a schema-8 profile");
    expect(profile.silver).toBe(719);
    expect(profile.gold).toBe(100);
    expect(profile.licenseType).toBe("Novice");
    expect(profile.inventory.looseItems.map((item) => ({
      kind: item.kind,
      path: item.definitionPath,
      ...(item.kind === "gem" ? { level: item.level, stats: item.enabledStats } : {}),
    }))).toEqual([
      { kind: "gem", path: "Gems.RandomNovice", level: 7, stats: ["Resist"] },
      { kind: "gem", path: "Gems.RandomNovice", level: 6, stats: ["Defense"] },
    ]);
    expect(profile.catchQuestsDone).toEqual(["NorthCave"]);
    expect(profile.dungeonWaypoints).toEqual({ NorthCave: [2, 4] });
    expect(profile.tutorialFlags).toContain("FirstShop");
  });

  it("restores world progress from poiData and the last town", () => {
    const result = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const world = result.state.world;
    expect(world?.worldName).toBe("World_1-1");
    expect(world?.currentPoiName).toBe("First_City");
    expect(world?.lastTownName).toBe("First_City");
    expect(world?.dayNumber).toBe(17);
    expect(world?.poiWins).toEqual({
      "1-1_Field_1": 8, "1-1_Field_2": 2, "1-1_Field_3": 3, "1-1_Field_4": 1, "1-1_Forest_1": 1,
    });
    expect(world?.everCompletedPois).toContain("Dungeon_1");
    // Per-trip refresh state is in no saved section, so a load always begins a fresh refresh.
    expect(world?.refresh).toEqual({ occurrenceByPoi: {}, completedPois: [] });
  });

  it("accepts a visitedTowns list in the visit order the game writes it in", () => {


    const document = decodeNativeSaveDocument(saveBytes("savefile0"));
    const props = new Map(document.props);
    props.set("visitedTowns", {
      kind: "array",
      value: ["Rainy_City", "First_City", "Capital_City", "First_City"]
        .map((value): PlistValue => ({ kind: "string", value })),
    });
    const result = importNativeSave({ ...document, props }, context!);
    const world = result.state.world;
    if (world?.schemaVersion !== 2) throw new Error("expected a schema-2 world snapshot");
    expect(world.visitedTownNames).toEqual(["Capital_City", "First_City", "Rainy_City"]);
  });

  it("reads the deepest Abyss floor, defaulting to 0 for the key the game never wrote", () => {
    // No shipped fixture ever entered the Infinite Dungeon, so every one of them exercises the
    // missing-key path: `intValue` of a nil property is 0 in the original too.
    const document = decodeNativeSaveDocument(saveBytes("savefile0"));
    expect(document.props.has("infiniteHighestLevel")).toBe(false);
    expect(abyssFloorOf(importNativeSave(document, context!).state)).toBe(0);

    const props = new Map(document.props);
    props.set("infiniteHighestLevel", { kind: "int", value: 212 });
    const deep = importNativeSave({ ...document, props }, context!);
    expect(abyssFloorOf(deep.state)).toBe(212);


    const shallow = importNativeSave(document, context!);
    if (deep.state.player.party.kind !== "world-trip-party") {
      throw new Error("expected a world-trip party");
    }
    if (shallow.state.player.party.kind !== "world-trip-party") {
      throw new Error("expected a world-trip party");
    }
    expect(deep.state.player.party.battingOrderSize)
      .toBe(shallow.state.player.party.battingOrderSize + 21);
  });

  it("clamps a floor the game's only writer could not have produced", () => {
    const document = decodeNativeSaveDocument(saveBytes("savefile0"));
    const props = new Map(document.props);
    props.set("infiniteHighestLevel", { kind: "int", value: -3 });
    const result = importNativeSave({ ...document, props }, context!);
    expect(abyssFloorOf(result.state)).toBe(0);
    expect(result.warnings.map(({ code }) => code)).toContain("infinite-dungeon-floor-invalid");
  });

  it("restores quests, dialogs and fixed encounters", () => {
    const result = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    expect(result.state.quests?.activeQuestNames)
      .toEqual(["BeatRigel", "BeatCyrus", "Evolution"]);
    expect(result.state.quests?.finishedQuestNames)
      .toEqual(["MacworldCatch", "Defeat20Monsters"]);
    expect(result.state.quests?.completedFixedEncounterKeys).toEqual(["ConanBattle"]);
    expect(result.state.quests?.dialogsSeen).toContain("LeslieSaved");
  });

  it("names the sections it cannot represent instead of dropping them silently", () => {
    const result = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const notModelled = result.warnings.find(({ code }) => code === "sections-not-modelled");
    expect(notModelled?.message).toContain("props.sparklesNeeded");
    expect(notModelled?.message).toContain("props.analyticsKeys");
  });

  it("rejects a save whose bench is empty", () => {
    const document = decodeNativeSaveDocument(saveBytes("savefile0"));
    expect(() => importNativeSave(
      { ...document, player: { ...document.player, savedMonsters: [] } },
      context!,
    )).toThrow(/no monsters on the bench/);
  });
});

describe.skipIf(!available)("native save export", () => {
  it("reproduces every original JobLevelProp bit-for-bit", () => {
    for (const slot of [0, 1, 2]) {
      const bytes = saveBytes(`savefile${slot}`);
      const imported = importNativeSave(decodeNativeSaveDocument(bytes), context!);
      const { document } = exportNativeSave(imported.state, context!);
      const exported = jobLevelProps(encodeNativeSaveDocument(document));
      const originals = jobLevelProps(bytes);
      expect(originals.size).toBeGreaterThan(0);
      expect(exported.size).toBe(originals.size);
      for (const [name, original] of originals) {
        // `levelAsDouble` on the way out must invert `loadFinishedWithRootParent:` on the way in
        // exactly, or a round trip would drift a monster's XP every time.
        expect(exported.get(name)).toBe(original);
      }
    }
  });

  it("writes exactly the ten sections the original game reads", () => {
    const imported = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const { document } = exportNativeSave(imported.state, context!);
    const root = decodeBinaryPlist(encodeNativeSaveDocument(document));
    if (root.kind !== "dict") throw new Error("expected a dictionary");
    expect([...root.value.keys()].sort()).toEqual([
      "goldFound", "goldSpent", "options", "playerData", "poiData",
      "props", "silver", "tutorialFlags", "variables", "waypoints",
    ]);
    const player = root.value.get("playerData");
    if (player?.kind !== "dict") throw new Error("expected playerData");
    expect([...player.value.keys()].sort()).toEqual([
      "savedGemsInLicense", "savedItems", "savedLicenseType", "savedMonsters",
    ]);
  });

  it("keeps a monster record shaped like one the game wrote", () => {
    const imported = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const { document } = exportNativeSave(imported.state, context!);
    const first = document.player.savedMonsters[0]!;
    expect(first.name).toBe("Dragon.GoldDragonling");
    expect(first.creationFile).toBe("Monsters.plist");
    expect(first.properties.get("JobLevelProp")).toEqual({
      kind: "real",
      value: 7.558252427184466,
    });
    // The original's record for this monster carries `jobArguments.level: 6` — its level when it
    // was created. Export writes the monster's current level instead, which is consistent with the
    // XP the same record carries and is what the game's own level-up loop would settle on.
    expect(plain({ kind: "dict", value: first.creationArguments }))
      .toEqual({ jobArguments: { level: ["int", 7] } });
  });

  it("round-trips a save through export and back to the same state", () => {
    for (const slot of [0, 1, 2]) {
      const first = importNativeSave(decodeNativeSaveDocument(saveBytes(`savefile${slot}`)), context!);
      const { document } = exportNativeSave(first.state, context!);
      const second = importNativeSave(
        decodeNativeSaveDocument(encodeNativeSaveDocument(document)),
        context!,
      );
      expect(second.state).toEqual(first.state);
    }
  });

  it("writes infiniteHighestLevel only once the Abyss has been entered", () => {
    const exportedProps = (state: PlayerGameStateSnapshot): ReadonlyMap<string, PlistValue> => {
      const { document } = exportNativeSave(state, context!);
      const root = decodeBinaryPlist(encodeNativeSaveDocument(document));
      if (root.kind !== "dict") throw new Error("expected a dictionary");
      const props = root.value.get("props");
      if (props?.kind !== "dict") throw new Error("expected a props dictionary");
      return props.value;
    };

    const imported = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const profile = imported.state.player.profile;
    if (profile.schemaVersion !== 8) throw new Error("expected a schema-8 profile");
    expect(profile.infiniteDungeonHighestLevel).toBe(0);


    expect(exportedProps(imported.state).has("infiniteHighestLevel")).toBe(false);

    const deepState: PlayerGameStateSnapshot = {
      ...imported.state,
      player: {
        ...imported.state.player,
        profile: { ...profile, infiniteDungeonHighestLevel: 212 },
      },
    };
    expect(exportedProps(deepState).get("infiniteHighestLevel"))
      .toEqual({ kind: "int", value: 212 });

    const { document } = exportNativeSave(deepState, context!);
    const reimported = importNativeSave(
      decodeNativeSaveDocument(encodeNativeSaveDocument(document)),
      context!,
    );
    expect(abyssFloorOf(reimported.state)).toBe(212);
    // Everything but the bench capacity survives untouched; that one field is derived from the
    // floor on the way back in, so it is deliberately larger than the state that was exported.
    expect(reimported.state.player.profile).toEqual(deepState.player.profile);
    expect(reimported.state.quests).toEqual(deepState.quests);
    expect(reimported.state.world).toEqual(deepState.world);
  });

  it("warns rather than silently flattening an in-progress dungeon run", () => {
    const imported = importNativeSave(decodeNativeSaveDocument(saveBytes("savefile0")), context!);
    const withDungeon = {
      ...imported.state,
      dungeon: { pretend: true },
    } as unknown as PlayerGameStateSnapshot;
    const { warnings } = exportNativeSave(withDungeon, context!);
    expect(warnings.map(({ code }) => code)).toContain("dungeon-run-dropped");
  });
});

describe.skipIf(!available)("native save file identity", () => {
  it("names exports the way the original game does", () => {
    expect(nativeSaveFileName("slot-1")).toBe("savefile0");
    expect(nativeSaveFileName("slot-2")).toBe("savefile1");
    expect(nativeSaveFileName("slot-3")).toBe("savefile2");
  });

  it("recognises a real save and rejects other files", () => {
    expect(looksLikeNativeSave(saveBytes("savefile0"))).toBe(true);
    expect(looksLikeNativeSave(new TextEncoder().encode('{"format":"dib-save-backup"}')))
      .toBe(false);
  });

  it("exports a slot as bytes the importer accepts back", () => {
    const imported = readNativeSave(saveBytes("savefile1"), context!);
    const file = writeNativeSave("slot-2", imported.state, context!);
    expect(file.fileName).toBe("savefile1");
    expect(looksLikeNativeSave(file.bytes)).toBe(true);
    expect(readNativeSave(file.bytes, context!).state).toEqual(imported.state);
  });
});

describe.skipIf(!hasContent)("job XP inversion", () => {
  it("agrees with the curve the port already uses", () => {
    // Guards the arithmetic itself, independent of any particular save file.
    const data = context?.data ?? GameData.fromRaw({
      monsters: raw("Monsters"),
      jobs: raw("Jobs"),
      abilities: raw("Abilities"),
      abilityComponents: raw("AbilityComponents"),
      buffs: raw("Buffs"),
    } as Parameters<typeof GameData.fromRaw>[0]);
    const penalty = data.jobXpPenalty("BatSquirrel");
    for (const level of [1, 2, 3, 6, 7, 20, 21, 40]) {
      const floor = jobXpForLevel(level, penalty);
      const cost = jobXpCostOfNextLevel(level, penalty);
      for (const offset of [0, 1, Math.floor(cost / 3), Math.max(0, cost - 1)]) {
        const cumulativeXp = floor + offset;
        const prop = level + (cumulativeXp - floor) / cost;
        const band = Math.floor(prop);
        const inverted = Math.round(
          jobXpForLevel(band, penalty) + (prop - band) * jobXpCostOfNextLevel(band, penalty),
        );
        expect(inverted).toBe(cumulativeXp);
      }
    }
  });
});
