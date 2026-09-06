import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileLogicPackIdentityV1,
  findPresentationLeaks,
  type LogicPackResourceSource,
  type ReadonlyLogicValue,
} from "../src/index.js";

function source(overrides: Record<string, ReadonlyLogicValue> = {}): LogicPackResourceSource {
  const files: Record<string, ReadonlyLogicValue> = {
    "Monsters.plist": { Cub: { index: 1, rendererData: { spriteFile: "Cub.png" } } },
    "Jobs.plist": { Cub: { xpPenalty: 1 } },
    "Abilities.plist": { Attack: { class: "CombatAbility", power: 2, sound: "hit.m4a" } },
    "AbilityComponents.plist": { Damage: { class: "DamageAbilityComponent" } },
    "Buffs.plist": {},
    "Items.plist": {},
    "Combines.plist": {},
    "Worlds.plist": { World_1: { class: "World", rendererData: { spriteFile: "map.png" } } },
    "PointsOfInterest.plist": {},
    "World_1.plist": { challengeLevel: 2 },
    "Dungeon_1.plist": { creationData: { lastFloor: 3 } },
    "AirshipConfig.plist": { apiSecret: "must-never-enter-the-pack" },
    "Scale9Sprites.plist": { popup: { spriteFile: "popup.png" } },
    ...overrides,
  };
  return {
    list: () => Object.keys(files),
    read: (path) => files[path]!,
  };
}

const digest = async (bytes: Uint8Array) =>
  new Uint8Array(createHash("sha256").update(bytes).digest());

describe("LogicPackV1 identity", () => {
  it("is stable under presentation-only sprite/audio changes", async () => {
    const original = await compileLogicPackIdentityV1(source(), digest);
    const changed = await compileLogicPackIdentityV1(source({
      "Monsters.plist": { Cub: { index: 1, rendererData: { spriteFile: "Different.png" } } },
      "Abilities.plist": { Attack: { class: "CombatAbility", power: 2, sound: "different.m4a" } },
    }), digest);
    expect(changed.logicPackId).toBe(original.logicPackId);
  });

  it("changes for core, world, or dungeon mechanics", async () => {
    const original = await compileLogicPackIdentityV1(source(), digest);
    for (const override of [
      { "Jobs.plist": { Cub: { xpPenalty: 2 } } },
      { "World_1.plist": { challengeLevel: 3 } },
      { "Dungeon_1.plist": { creationData: { lastFloor: 4 } } },
    ]) {
      expect((await compileLogicPackIdentityV1(source(override), digest)).logicPackId)
        .not.toBe(original.logicPackId);
    }
  });

  it("excludes secrets and presentation-only root files from its projection", async () => {
    const identity = await compileLogicPackIdentityV1(source(), digest);
    expect(identity.mechanicalPaths).not.toContain("AirshipConfig.plist");
    expect(identity.mechanicalPaths).not.toContain("Scale9Sprites.plist");
  });

  it("fails loudly when a required mechanical family is missing", async () => {
    const complete = source();
    const missing: LogicPackResourceSource = {
      list: () => complete.list().filter((path) => path !== "Abilities.plist"),
      read: complete.read,
    };
    await expect(compileLogicPackIdentityV1(missing, digest)).rejects.toThrow(/Abilities\.plist/);
  });
});

describe("presentation leak detection", () => {
  it("reports media references anywhere in an authoritative tree", () => {
    const leaks = findPresentationLeaks({
      battle: { backgroundKey: "ForestCombat.png" },
      receipts: [{ result: { projection: { battle: { backgroundKey: "CaveCombat.png" } } } }],
      audioCue: "Hit.m4a",
    });
    expect(leaks.map((leak) => leak.path)).toEqual([
      "battle.backgroundKey",
      "receipts[0].result.projection.battle.backgroundKey",
      "audioCue",
    ]);
    expect(leaks.every((leak) => leak.reason === "media-reference")).toBe(true);
  });

  it("allows a mechanical rules file and rejects a bundle-qualified or presentation one", () => {
    expect(findPresentationLeaks({ route: { sourceFile: "Dungeon_1.plist" } })).toEqual([]);
    expect(findPresentationLeaks({ world: "World_1-1.plist" })).toEqual([]);
    expect(findPresentationLeaks({ atlas: "ForestCombat-hd.plist" })).toEqual([
      {
        path: "atlas",
        reason: "non-mechanical-plist",
        detail: "ForestCombat-hd.plist is not a mechanical rules file",
      },
    ]);
    expect(findPresentationLeaks({ bundled: "Payload/Dungeon_1.plist" })[0]?.reason)
      .toBe("non-mechanical-plist");
  });

  it("reports a classified presentation key even when its value looks like an id", () => {
    const leaks = findPresentationLeaks({ poi: { combatBackground: "Forest", sprite: "Forest" } });
    expect(leaks.map((leak) => [leak.path, leak.reason])).toEqual([
      ["poi.combatBackground", "presentation-key"],
      ["poi.sprite", "presentation-key"],
    ]);
    // An identifier under a non-presentation key is exactly what the authority is allowed to hold.
    expect(findPresentationLeaks({ poi: { poiId: "Forest" } })).toEqual([]);
  });

  it("passes a clean authoritative payload and survives a cycle", () => {
    expect(findPresentationLeaks({
      battle: { battleId: "battle-1", scene: { kind: "world", worldId: "World_1-1", poiId: "Forest" } },
      party: [{ shortType: "GoldBabyDragon", level: 3 }],
    })).toEqual([]);
    const cyclic: Record<string, unknown> = { name: "ok" };
    cyclic["self"] = cyclic;
    expect(findPresentationLeaks(cyclic)).toEqual([]);
  });
});
