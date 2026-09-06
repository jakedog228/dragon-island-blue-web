import { describe, expect, it } from "vitest";
import type { ImportedContentPackage, ReadonlyPlistValue } from "../src/content/archivePackage.js";
import { fingerprintContentPackage } from "../src/content/contentFingerprint.js";

function content(overrides: Record<string, ReadonlyPlistValue> = {}, archiveName = "first.ipa"): ImportedContentPackage {
  const files: Record<string, ReadonlyPlistValue> = {
    "Monsters.plist": { Cub: { index: 1 } },
    "Combines.plist": {},
    "Jobs.plist": { Cub: { xpPenalty: 1 } },
    "Abilities.plist": { Attack: { power: 2 } },
    "AbilityComponents.plist": { Damage: { class: "Damage" } },
    "Quests.plist": [{ name: "First", class: "VisitTownQuest" }],
    "Licenses.plist": { Novice: { gemSlots: 0 } },
    "Tournaments.plist": [],
    "Towns.plist": { Town: { world: "World_1", sortOrder: 0 } },
    "Worlds.plist": { World_1: {} },
    "World_1.plist": { Points: ["Town", "Field"] },
    ...overrides,
  };
  return {
    sourceKind: "app-archive",
    archiveName,
    appDirectory: "/",
    data: {
      monsters: files["Monsters.plist"] as Record<string, unknown>,
      combines: files["Combines.plist"] as Record<string, unknown>,
      jobs: files["Jobs.plist"] as Record<string, unknown>,
      abilities: files["Abilities.plist"] as Record<string, unknown>,
      abilityComponents: files["AbilityComponents.plist"] as Record<string, unknown>,
      buffs: (files["Buffs.plist"] ?? {}) as Record<string, unknown>,
      ...(files["Items.plist"] === undefined
        ? {}
        : { items: files["Items.plist"] as Record<string, unknown> }),
      ...(files["Licenses.plist"] === undefined
        ? {}
        : { licenses: files["Licenses.plist"] as Record<string, unknown> }),
      ...(files["Tournaments.plist"] === undefined
        ? {}
        : { tournaments: files["Tournaments.plist"] as readonly unknown[] }),
      anims: {},
      meleeAttacks: {},
      scale9: {},
      strings: {},
    },
    resources: {
      list: () => [...Object.keys(files), "different-picture.png"],
      has: (path) => path in files,
      plist: (path) => files[path]!,
      text: () => "",
      url: () => "blob:test",
    },
    manifest: { atlases: {}, sprites: {}, fonts: {}, audio: {}, particles: {} },
    combatBackgroundKeys: ["FieldCombat"],
    worldNames: ["World_1"],
    hasTownCapability: false,
    hasDungeonCapability: false,
    dungeonTypes: [],
    dungeonFiles: [],
    hasProvenanceDocument: false,
    urlFor: () => "blob:test",
    dispose: () => {},
  };
}

describe("asset-pack save identity", () => {
  it("is stable across archive repacking/naming and ignores presentation bytes", async () => {
    expect(await fingerprintContentPackage(content({}, "one.ipa")))
      .toEqual(await fingerprintContentPackage(content({}, "repacked.zip")));
  });

  it("changes when an identity-bearing data resource changes", async () => {
    const original = await fingerprintContentPackage(content());
    const changed = await fingerprintContentPackage(content({ "Jobs.plist": { Cub: { xpPenalty: 2 } } }));
    expect(original.scope).toBe("dib-identity-plists-v7");
    expect(original.previousV6.scope).toBe("dib-identity-plists-v6");
    expect(original.previousV6.digest)
      .toBe("0dbf02618bbd56d287d68ec7c5759b41a24c601e780a0dae896934f76e52c051");
    expect(original.previousV5.scope).toBe("dib-identity-plists-v5");
    expect(original.previousV4.scope).toBe("dib-identity-plists-v4");
    expect(original.previousV3.scope).toBe("dib-identity-plists-v3");
    expect(original.previousV2.scope).toBe("dib-identity-plists-v2");
    expect(original.legacyV1.scope).toBe("dib-identity-plists-v1");
    expect(original.legacyV1.digest)
      .toBe("03e341672a738cc3c88e8a56d387a099371e312587b202f3ff989dd215fecc4c");
    expect(changed.digest).not.toBe(original.digest);
    expect(changed.previousV2.digest).not.toBe(original.previousV2.digest);
    expect(changed.legacyV1.digest).not.toBe(original.legacyV1.digest);
  });

  it("does not strand saves for code-only or presentation-only mod profile changes", async () => {
    const base = content();
    const first = {
      ...base,
      modProfile: {
        schemaVersion: 4 as const,
        digest: "a".repeat(64),
        packages: [],
      },
      mods: {} as never,
    };
    const second = {
      ...base,
      modProfile: {
        schemaVersion: 4 as const,
        digest: "b".repeat(64),
        packages: [],
      },
      mods: {} as never,
    };
    const unmodded = await fingerprintContentPackage(base);
    const firstIdentity = await fingerprintContentPackage(first);
    const secondIdentity = await fingerprintContentPackage(second);
    expect(firstIdentity).toEqual(unmodded);
    expect(secondIdentity).toEqual(unmodded);
  });

  it("binds the effective mechanics data produced by a mod, independent of package bytes", async () => {
    const base = content();
    const changedData = {
      ...base,
      data: { ...base.data, jobs: { Cub: { xpPenalty: 2 } } },
      modProfile: { schemaVersion: 4 as const, digest: "a".repeat(64), packages: [] },
      mods: {} as never,
    };
    const repackedSameData = {
      ...changedData,
      modProfile: { schemaVersion: 4 as const, digest: "b".repeat(64), packages: [] },
    };
    const unmodded = await fingerprintContentPackage(base);
    const firstIdentity = await fingerprintContentPackage(changedData);
    const secondIdentity = await fingerprintContentPackage(repackedSameData);
    expect(firstIdentity.digest).not.toBe(unmodded.digest);
    expect(secondIdentity).toEqual(firstIdentity);
  });

  it("binds Collection goal ids, monster vectors, and rewards only in v7", async () => {
    const baseCollection = {
      Base: [{
        class: "MonsterCollectionQuest",
        key: "Base1",
        monsters: ["Cub"],
        treasureData: { items: [] },
      }],
    };
    const original = await fingerprintContentPackage(content({
      "Collection.plist": baseCollection,
    }));
    const changes = [
      { Base: [{ ...baseCollection.Base[0], key: "Base2" }] },
      { Base: [{ ...baseCollection.Base[0], monsters: ["Wolf"] }] },
      { Base: [{ ...baseCollection.Base[0], treasureData: { items: [{ item: "Gold", count: 1 }] } }] },
    ];

    for (const collection of changes) {
      const changed = await fingerprintContentPackage(content({ "Collection.plist": collection }));
      expect(changed.digest).not.toBe(original.digest);
      expect(changed.previousV6).toEqual(original.previousV6);
      expect(changed.previousV5).toEqual(original.previousV5);
      expect(changed.previousV4).toEqual(original.previousV4);
      expect(changed.previousV3).toEqual(original.previousV3);
      expect(changed.previousV2).toEqual(original.previousV2);
      expect(changed.legacyV1).toEqual(original.legacyV1);
    }
  });

  it("distinguishes absent, present-empty, and present-nonempty Collection files in v7", async () => {
    const absent = await fingerprintContentPackage(content());
    const empty = await fingerprintContentPackage(content({ "Collection.plist": {} }));
    const nonempty = await fingerprintContentPackage(content({
      "Collection.plist": { Base: [] },
    }));

    expect(new Set([absent.digest, empty.digest, nonempty.digest]).size).toBe(3);
    expect(empty.previousV6).toEqual(absent.previousV6);
    expect(nonempty.previousV6).toEqual(absent.previousV6);
    expect(absent.previousV5.digest)
      .toBe("e597272357afe45224355ebc6f267dcb2e24aac9bdca84d2a1e50efe0db82ac5");
    expect(empty.previousV5).toEqual(absent.previousV5);
    expect(nonempty.previousV5).toEqual(absent.previousV5);
  });

  it("treats combine recipes as required identity-bearing gameplay data", async () => {
    const original = await fingerprintContentPackage(content());
    const changed = await fingerprintContentPackage(content({
      "Combines.plist": { Carnoraptor: ["Bitewing", "Wolf"] },
    }));
    expect(changed.digest).not.toBe(original.digest);
    expect(changed.previousV2.digest).not.toBe(original.previousV2.digest);
    expect(changed.legacyV1).toEqual(original.legacyV1);

    const complete = content();
    const missing: ImportedContentPackage = {
      ...complete,
      resources: {
        ...complete.resources,
        list: () => complete.resources.list().filter((path) => path !== "Combines.plist"),
      },
    };
    await expect(fingerprintContentPackage(missing)).rejects.toThrow(/Combines\.plist/);
  });

  it("binds authored Guild quests while preserving the exact v2 migration projection", async () => {
    const original = await fingerprintContentPackage(content());
    const changed = await fingerprintContentPackage(content({
      "Quests.plist": [{ name: "Second", class: "VisitTownQuest" }],
    }));
    expect(changed.digest).not.toBe(original.digest);
    expect(changed.previousV2).toEqual(original.previousV2);
    expect(changed.legacyV1).toEqual(original.legacyV1);
  });

  it("binds license progression while preserving the exact v3 migration projection", async () => {
    const original = await fingerprintContentPackage(content());
    const changed = await fingerprintContentPackage(content({
      "Licenses.plist": { Novice: { gemSlots: 1 } },
    }));
    expect(changed.digest).not.toBe(original.digest);
    expect(changed.previousV3).toEqual(original.previousV3);
    expect(changed.previousV2).toEqual(original.previousV2);
    expect(changed.legacyV1).toEqual(original.legacyV1);
  });

  it("binds Tournament progression while preserving the exact v4 migration projection", async () => {
    const original = await fingerprintContentPackage(content());
    const changed = await fingerprintContentPackage(content({
      "Tournaments.plist": [{ name: "K", challengeLevel: 1 }],
    }));
    expect(changed.digest).not.toBe(original.digest);
    expect(changed.previousV4).toEqual(original.previousV4);
    expect(changed.previousV3).toEqual(original.previousV3);
    expect(changed.previousV2).toEqual(original.previousV2);
    expect(changed.legacyV1).toEqual(original.legacyV1);
  });

  it("binds town waypoint conditions while preserving the exact v5 migration projection", async () => {
    const original = await fingerprintContentPackage(content());
    const changed = await fingerprintContentPackage(content({
      "Towns.plist": {
        Town: {
          world: "World_1",
          sortOrder: 0,
          portalConditions: { pois: "Field" },
        },
      },
    }));
    expect(changed.digest).not.toBe(original.digest);
    expect(changed.previousV5).toEqual(original.previousV5);
    expect(changed.previousV4).toEqual(original.previousV4);
  });
});
