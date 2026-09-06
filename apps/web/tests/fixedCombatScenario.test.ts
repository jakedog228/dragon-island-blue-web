import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata/browser";
import type {
  ImportedContentPackage,
  ImportedGameData,
} from "../src/content/archivePackage.js";
import type { LoadedGame } from "../src/loadGame.js";
import {
  fixedCombatScenarioCatalog,
  fixedCombatScenarioExample,
  prepareFixedCombatScenario,
  scenarioCombatantForMonster,
} from "../src/debug/fixedCombatScenario.js";
import { buildScenarioRuntime } from "../src/debug/scenarioRuntime.js";
import {
  parseFixedCombatScenarioDocument,
  stringifyFixedCombatScenarioDocument,
} from "../src/debug/fixedCombatScenarioDocument.js";

const stats = {
  Attack: 3,
  Defense: 4,
  Magic: 5,
  MaxHP: 12,
  Resist: 4,
  Speed: 6,
};

function fixture(): ImportedContentPackage {
  const data = {
    monsters: {
      RootMonster: { class: "Monster", category: "Normal" },
      Cat: {
        SnowCub: {
          parent: "RootMonster",
          element: "Water",
          index: 100,
          quality: 4,
          stars: 3,
          rootStats: stats,
          rendererData: { scale: 0.5 },
          unarmedAttackType: "Slash",
          evolveData: { levelReq: 20, newType: "SnowPanther" },
        },
      },
      Misc: {
        SphinxMaster: {
          parent: "RootMonster",
          element: "Air",
          index: 200,
          quality: 4,
          stars: 3,
          rootStats: { ...stats, MaxHP: 35, Resist: 19, Speed: 1 },
          unarmedAttackType: "Slash",
        },
      },
      Spirit: {
        Thought: {
          parent: "RootMonster",
          category: "Summon",
          element: "Arcane",
          index: 300,
          quality: 4,
          stars: 3,
          rootStats: stats,
          unarmedAttackType: "Slash",
        },
      },
    },
    combines: {},
    jobs: {
      RootJob: { class: "Job", slots: ["Monster"], xpPenalty: 1, jobAbilities: {} },
      Cat: {
        SnowCub: {
          parent: "RootJob",
          jobAbilities: {
            usable1: { type: "Offensive.Attack", arguments: { aiChance: 2 } },
            usable3: { type: "Utility.Delay", arguments: {} },
            nativePassive: { type: "Passive.EasyTarget", arguments: { adjustment: 3 } },
          },
        },
      },
      Misc: {
        SphinxMaster: {
          parent: "RootJob",
          jobAbilities: { usable1: { type: "Offensive.Attack", arguments: {} } },
        },
      },
      Spirit: {
        Thought: {
          parent: "RootJob",
          jobAbilities: { usable1: { type: "Offensive.Attack", arguments: {} } },
        },
      },
      Creature: {
        parent: "RootJob",
        jobAbilities: { usable4: { type: "Offensive.IceStorm", arguments: {} } },
      },
    },
    abilities: {
      Offensive: {
        Attack: {
          class: "CombatAbility",
          activationLength: "{4}",
          components: [{ type: "Offensive.MagicAttack" }],
          targetPicker: { class: "TargetPickerGui", enemyTargets: 1 },
        },
        IceStorm: {
          class: "CombatAbility",
          activationLength: "{4}",
          components: [{ type: "Offensive.MagicAttack" }],
          enemyBuffs: [{ type: "Offensive.Sleep", arguments: { duration: 500 } }],
          targetPicker: { class: "TargetPickerGui", allEnemies: true },
        },
      },
      Utility: {
        Delay: {
          class: "CombatAbility",
          activationLength: "{4}",
          components: [],
          targetPicker: { class: "TargetPickerGui", selfOnly: true },
        },
      },
      Passive: {
        EasyTarget: { class: "Ability" },
      },
    },
    abilityComponents: {
      Offensive: {
        MagicAttack: {
          class: "DamageDealingAbilityComponent",
          roll: { relatedStat: "Magic" },
        },
      },
    },
    buffs: {
      Offensive: {
        Sleep: { class: "RemoveOnHurtBuff", statusEffects: { Sleep: true } },
      },
    },
    items: {
      SoulStones: {
        LifeSoulStone: { class: "SoulStone", slot: "Monster", stats: { MaxHP: true } },
        DeathSoulStone: { class: "SoulStone", slot: "Monster", stats: { Attack: true } },
        WaterSoulStone: { class: "SoulStone", slot: "Monster", stats: { Magic: true } },
        FireSoulStone: { class: "SoulStone", slot: "Monster", stats: { Attack: true } },
        EarthSoulStone: { class: "SoulStone", slot: "Monster", stats: { Defense: true } },
        AirSoulStone: { class: "SoulStone", slot: "Monster", stats: { Speed: true } },
        ArcaneSoulStone: { class: "SoulStone", slot: "Monster", stats: { Magic: true } },
      },
    },
    anims: {},
    meleeAttacks: {},
    scale9: {},
    strings: {
      RenderableSnowCubNameKey: "Snow Cub",
      RenderableSphinxMasterNameKey: "Sphinx Master",
      RenderableAttackNameKey: "Attack",
      RenderableIceStormNameKey: "Ice Storm",
      RenderableDelayNameKey: "Delay",
      RenderableEasyTargetNameKey: "Easy Target",
      RenderableThoughtNameKey: "Thought",
    },
  } as unknown as ImportedGameData;
  return {
    sourceKind: "app-archive",
    archiveName: "fixture.zip",
    appDirectory: "Fixture.app/",
    data,
    resources: {} as ImportedContentPackage["resources"],
    manifest: {} as ImportedContentPackage["manifest"],
    combatBackgroundKeys: ["ForestCombat", "CaveCombat"],
    worldNames: [],
    hasTownCapability: false,
    hasDungeonCapability: false,
    dungeonTypes: [],
    dungeonFiles: [],
    hasProvenanceDocument: false,
    urlFor: (path) => path,
    dispose: () => undefined,
  };
}

function load(data: ImportedGameData): GameData {
  return GameData.fromRaw({
    monsters: data.monsters,
    jobs: data.jobs,
    abilities: data.abilities,
    abilityComponents: data.abilityComponents,
    buffs: data.buffs,
    ...(data.items === undefined ? {} : { items: data.items }),
    combines: data.combines,
  });
}

describe("fixed combat Scenario generator", () => {
  it("builds archive-driven pickers, native four-slot kits, passives, and example availability", () => {
    const catalog = fixedCombatScenarioCatalog(fixture());
    expect(catalog.monsters).toEqual([
      { value: "SnowCub", label: "Snow Cub" },
      { value: "SphinxMaster", label: "Sphinx Master" },
      { value: "Thought", label: "Thought" },
    ]);
    expect(catalog.combatAbilities.map(({ value }) => value)).toEqual([
      "Offensive.Attack",
      "Utility.Delay",
      "Offensive.IceStorm",
    ]);
    expect(catalog.allAbilities.map(({ value }) => value)).toContain("Passive.EasyTarget");
    expect(catalog.backgrounds).toEqual(["ForestCombat", "CaveCombat"]);
    expect(catalog.soulStonesAvailable).toBe(true);
    expect(catalog.spirits).toEqual([{ value: "Thought", label: "Thought" }]);
    expect(catalog.examples.map(({ value, available }) => ({ value, available }))).toEqual([
      { value: "random", available: true },
      { value: "reserve", available: false },
      { value: "starter", available: false },
      { value: "ice-storm", available: true },
    ]);
    expect(catalog.nativeKits["SnowCub"]).toEqual({
      kitSlots: [
        { abilityPath: "Offensive.Attack", arguments: { aiChance: 2 } },
        null,
        { abilityPath: "Utility.Delay", arguments: {} },
        null,
      ],
      passiveAbilities: [
        { slot: "nativePassive", abilityPath: "Passive.EasyTarget", arguments: { adjustment: 3 } },
      ],
    });
  });

  it("materializes every example as editable fixed data with complete slot arrays", () => {
    const content = fixture();
    const random = fixedCombatScenarioExample(content, "random", 17);
    expect(random.playerTeam).toHaveLength(1);
    expect(random.enemyTeam).toHaveLength(1);
    expect(random.playerTeam[0]?.kitSlots).toHaveLength(4);

    const ice = fixedCombatScenarioExample(content, "ice-storm", 17);
    expect(ice.playerTeam.map(({ shortType }) => shortType)).toEqual(["SnowCub", "SphinxMaster"]);
    expect(ice.enemyTeam.map(({ shortType }) => shortType)).toEqual(["SnowCub", "SphinxMaster"]);
    expect(ice.playerTeam[0]?.kitSlots).toEqual([
      { abilityPath: "Offensive.IceStorm", arguments: {} },
      null,
      null,
      null,
    ]);
    expect(ice.playerTeam[0]?.passiveAbilities).toEqual([
      { slot: "nativePassive", abilityPath: "Passive.EasyTarget", arguments: { adjustment: 3 } },
    ]);
    expect(ice.resources.spiritTierLevels).toEqual({ Thought: 11 });
  });

  it("round-trips versioned encounter JSON and validates it against the selected archive", () => {
    const content = fixture();
    const fixed = fixedCombatScenarioExample(content, "ice-storm", 17);
    const text = stringifyFixedCombatScenarioDocument(fixed);
    expect(JSON.parse(text)).toMatchObject({
      kind: "dragon-island-blue-fixed-combat",
      version: 1,
      encounter: { backgroundKey: "ForestCombat" },
    });
    expect(parseFixedCombatScenarioDocument(text, content)).toEqual(fixed);

    const incompatible = JSON.parse(text) as {
      encounter: { playerTeam: Array<{ shortType: string }> };
    };
    incompatible.encounter.playerTeam[0]!.shortType = "MissingMonster";
    expect(() => parseFixedCombatScenarioDocument(JSON.stringify(incompatible), content))
      .toThrow(/incompatible.*unknown monster shortType: MissingMonster/i);
    expect(() => parseFixedCombatScenarioDocument("[]", content))
      .toThrow(/object document/);
  });

  it("keeps native rows native and aliases independently edited four-slot/passive kits", () => {
    const content = fixture();
    const catalog = fixedCombatScenarioCatalog(content);
    const nativeSnow = scenarioCombatantForMonster(catalog, "SnowCub", { level: 21 });
    const editedSnow = {
      ...nativeSnow,
      kitSlots: [
        nativeSnow.kitSlots[0]!,
        { abilityPath: "Offensive.IceStorm", arguments: { aiChance: 7 } },
        nativeSnow.kitSlots[2]!,
        { abilityPath: "Utility.Delay", arguments: {} },
      ],
      passiveAbilities: [
        { slot: "nativePassive", abilityPath: "Passive.EasyTarget", arguments: { adjustment: 9 } },
      ],
      soulStone: { sourceType: "SphinxMaster", level: 11 },
      flatStatBonuses: { Attack: 5, Speed: -1 },
      currentHp: 7,
      capturable: false,
    };

    const prepared = prepareFixedCombatScenario(content, {
      backgroundKey: "ForestCombat",
      allowRetreat: false,
      blockCapture: false,
      breederXpBonus: 1.5,
      resources: {
        heroLevel: 20,
        silver: 123,
        gold: 45,
        captureCards: { 1: 2, 2: 3, 3: 4 },
        spiritReadiness: 0.75,
        equippedGems: [
          { level: 11, quality: 2, enabledStats: ["Defense", "Magic"] },
          null,
          null,
          null,
        ],
        spiritTierLevels: { Thought: 14 },
        skillPoints: { Attack: 5, Magic: 2 },
      },
      playerTeam: [nativeSnow],
      enemyTeam: [editedSnow],
    });

    expect(prepared.encounter.playerTeam[0]).toEqual({ shortType: "SnowCub", level: 21 });
    expect(prepared.encounter.enemyTeam[0]).toMatchObject({
      shortType: "DIBScenarioE1",
      originalShortType: "SnowCub",
      level: 21,
      capturable: false,
      currentHp: 7,
      flatStatBonuses: { Attack: 5, Speed: -1 },
      soulStone: { sourceType: "SphinxMaster", element: "Air", level: 11 },
      displayName: "Snow Cub",
      rendererData: { scale: 0.5, spriteFile: "SnowCub.png" },
    });
    expect(prepared.encounter).toMatchObject({
      allowRetreat: false,
      blockCapture: false,
      blockSaveMe: true,
      breederXpBonus: 1.5,
    });

    const gd = load(prepared.gameContent.data);
    expect(gd.jobAbilities("DIBScenarioE1")).toEqual([
      { slot: "nativePassive", type: "Passive.EasyTarget", arguments: { adjustment: 9 } },
      { slot: "usable1", type: "Offensive.Attack", arguments: { aiChance: 2 } },
      { slot: "usable2", type: "Offensive.IceStorm", arguments: { aiChance: 7 } },
      { slot: "usable3", type: "Utility.Delay", arguments: {} },
      { slot: "usable4", type: "Utility.Delay", arguments: {} },
    ]);
    expect(gd.jobAbilities("SnowCub")).toEqual([
      { slot: "nativePassive", type: "Passive.EasyTarget", arguments: { adjustment: 3 } },
      { slot: "usable1", type: "Offensive.Attack", arguments: { aiChance: 2 } },
      { slot: "usable3", type: "Utility.Delay", arguments: {} },
    ]);
    expect(content.data.jobs).not.toHaveProperty("DIBScenarioE1");

    const runtime = buildScenarioRuntime(
      {} as LoadedGame,
      content,
      {
        kind: "combat",
        transport: "offline",
        randomize: false,
        seed: 17,
        eggKind: "silver",
        combatExample: "random",
        fixedCombat: {
          backgroundKey: "ForestCombat",
          allowRetreat: false,
          blockCapture: false,
          resources: {
            heroLevel: 20,
            silver: 123,
            gold: 45,
            captureCards: { 1: 2, 2: 3, 3: 4 },
            spiritReadiness: 0.75,
            equippedGems: [
              { level: 11, quality: 2, enabledStats: ["Defense", "Magic"] },
              null,
              null,
              null,
            ],
            spiritTierLevels: { Thought: 14 },
            skillPoints: { Attack: 5, Magic: 2 },
          },
          playerTeam: [nativeSnow],
          enemyTeam: [editedSnow],
        },
      },
      prepared.encounter,
    );
    expect(runtime.state.player.profile).toMatchObject({
      silver: 123,
      gold: 45,
      inventory: {
        equippedGems: {
          0: { level: 11, quality: 2, slot: 0, enabledStats: ["Defense", "Magic"] },
        },
      },
    });
    expect(runtime.state.player.profile.spiritSavedXp).toHaveProperty("Thought");
  });

  it("rejects unknown species, empty kits, invalid resources, and oversized teams before boot", () => {
    const content = fixture();
    const catalog = fixedCombatScenarioCatalog(content);
    const member = scenarioCombatantForMonster(catalog, "SnowCub");
    const base = {
      backgroundKey: "ForestCombat",
      allowRetreat: true,
      blockCapture: false,
      resources: {
        heroLevel: 12,
        silver: 0,
        gold: 0,
        captureCards: { 1: 0, 2: 0, 3: 0 },
        spiritReadiness: 0,
        equippedGems: [null, null, null, null],
        spiritTierLevels: {},
        skillPoints: {},
      },
      playerTeam: [member],
      enemyTeam: [member],
    };
    expect(() => prepareFixedCombatScenario(content, {
      ...base,
      enemyTeam: [{ ...member, shortType: "Missing" }],
    })).toThrow(/unknown monster shortType: Missing/);
    expect(() => prepareFixedCombatScenario(content, {
      ...base,
      enemyTeam: [{ ...member, kitSlots: [null, null, null, null] }],
    })).toThrow(/needs at least one usable ability/);
    expect(() => prepareFixedCombatScenario(content, {
      ...base,
      resources: { ...base.resources, spiritReadiness: 2 },
    })).toThrow(/spirit readiness must be between 0 and 1/);
    expect(() => prepareFixedCombatScenario(content, {
      ...base,
      enemyTeam: Array.from({ length: 10 }, () => structuredClone(member)),
    })).toThrow(/1 to 9 combatants/);
  });
});
