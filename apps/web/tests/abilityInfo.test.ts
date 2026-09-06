import { describe, expect, it } from "vitest";
import { buildPlayerChoices, type PlayerChoice } from "@dib/engine";
import { loadGameData, loadRawJson, resolveDataDir, type JobAbilityRef, type StatName } from "@dib/gamedata";
import { buildAbilityInfoModel, buildPassiveAbilityInfoModel, type AbilityInfoContext } from "../src/battle/abilityInfo.js";
import { localizedRenderableName, type LocalizedStrings } from "../src/localization.js";

const gd = loadGameData();
const strings = loadRawJson(resolveDataDir(), "LocalizableStrings.json") as LocalizedStrings;
const stats: Record<StatName, number> = {
  MaxHP: 100,
  Attack: 30,
  Magic: 25,
  Speed: 20,
  Defense: 15,
  Resist: 12,
};
const context: AbilityInfoContext = { level: 12, stats, element: "Fire" };

function localizedChoices(shortType: string): PlayerChoice[] {
  return buildPlayerChoices(gd, shortType).map((choice) => ({
    ...choice,
    displayName: localizedRenderableName(strings, [
      choice.displayName,
      choice.abilityPath.split(".").at(-1)!,
    ]),
  }));
}

/** Mirrors battleNode.openLivingInfo's passive-row construction. */
function passiveRefs(shortType: string): Array<{ ref: JobAbilityRef; displayName: string }> {
  return gd.jobAbilitiesOrEmpty(shortType)
    .filter((ref) => !/^usable\d+$/.test(ref.slot))
    .map((ref) => {
      const typeName = ref.type.split(".").at(-1)!;
      const instanceName = ref.arguments["instanceName"];
      return {
        ref,
        displayName: localizedRenderableName(strings, [
          typeof instanceName === "string" ? instanceName : typeName,
          typeName,
        ]),
      };
    });
}

function passiveModelOf(shortType: string, slot: string) {
  const row = passiveRefs(shortType).find((entry) => entry.ref.slot === slot);
  if (!row) throw new Error(`no passive slot ${slot} on ${shortType}`);
  return buildPassiveAbilityInfoModel(gd, strings, row.ref, row.displayName, context);
}

describe("native ability-info projection", () => {
  it("covers every usable combat move on every shipped monster without a special-case demo list", () => {
    let characterMoves = 0;
    const uniqueMoves = new Set<string>();
    for (const monster of gd.allMonsters()) {
      const hasCombatMove = gd.jobAbilitiesOrEmpty(monster.shortType).some((ref) =>
        /^usable\d+$/.test(ref.slot) && gd.ability(ref.type).className === "CombatAbility"
      );
      if (!hasCombatMove) continue;
      for (const choice of localizedChoices(monster.shortType)) {
        const model = buildAbilityInfoModel(gd, strings, monster.shortType, choice, {
          ...context,
          element: monster.element,
        });
        expect(model.name.length).toBeGreaterThan(0);
        expect(model.extraDescription).toContain(`Time Units(TU): ${choice.activationLength}`);
        expect(model.lines.every((line) => line.length > 0)).toBe(true);
        characterMoves++;
        uniqueMoves.add(choice.abilityPath);
      }
    }
    expect(characterMoves).toBeGreaterThan(500);
    expect(uniqueMoves.size).toBeGreaterThan(70);
  });

  it("builds calculated damage, target, and TU rows for a normal elemental move", () => {
    const choice = localizedChoices("FireCub").find((entry) => entry.slot === "usable1")!;
    const model = buildAbilityInfoModel(gd, strings, "FireCub", choice, context);
    expect(model.name).toBe("Claw");
    expect(model.lines[0]).toBe("This ability targets 1 foe(s)");
    expect(model.extraDescription).toMatch(/Deals \d+(?:-\d+)? Fire damage \(Physical\)/);
    expect(model.extraDescription).toContain(`Time Units(TU): ${choice.activationLength}`);
  });

  it("uses LivingProviderCommonDisplay's shipped ExtraDescription key when one exists", () => {
    const owner = gd.allMonsters().find((monster) =>
      gd.jobAbilitiesOrEmpty(monster.shortType).some((ref) => ref.type === "Utility.Analyze")
    )!;
    const choice = localizedChoices(owner.shortType).find((entry) => entry.abilityPath === "Utility.Analyze")!;
    const model = buildAbilityInfoModel(gd, strings, owner.shortType, choice, context);
    expect(model.commonDescription).toBe(strings["ExtraDescriptionAnalyze"]);
  });

  it("preserves Magnify's native target/status `%d%% VS %@` formatting and lookup behavior", () => {
    const categoryChoice = localizedChoices("DonPen").find((entry) => entry.slot === "usable1")!;
    const categoryModel = buildAbilityInfoModel(gd, strings, "DonPen", categoryChoice, context);
    // The source passes an empty fallback to NSBundle, and NSBundle echoes the KEY back when
    // the key misses and the fallback is empty. `Humanoid` is absent from the shipped strings
    // table, so the original renders the raw category name after `VS`.
    expect(categoryModel.extraDescription).toContain("100% VS Humanoid\n");

    const statusChoice = localizedChoices("DreamEater").find((entry) => entry.slot === "usable1")!;
    const statusModel = buildAbilityInfoModel(gd, strings, "DreamEater", statusChoice, context);
    expect(statusModel.extraDescription).toContain("400% VS Sleep\n");

    // Ninja's Metal Slash: Offensive.Attack + argument-side Magnify {Metal: 3}.
    const metalChoice = localizedChoices("Ninja").find((entry) => entry.displayName === "Metal Slash")!;
    const metalModel = buildAbilityInfoModel(gd, strings, "Ninja", metalChoice, context);
    expect(metalModel.extraDescription).toContain("300% VS Metal\n");
  });
});

describe("passive ability rows and info popups ([living abilities] parity)", () => {
  it("Shenron's info card lists all three original rows: Deep Impact, Earthquake, Immunity", () => {
    const names = [
      ...localizedChoices("Shenron").map((choice) => choice.displayName),
      ...passiveRefs("Shenron").map((row) => row.displayName),
    ].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(["Deep Impact", "Earthquake", "Immunity"]);
  });

  it("Immunity/PseudoImmunity popups show the name alone — the immunities argument is dead ObjC data", () => {
    const model = passiveModelOf("Shenron", "Immunity");
    expect(model.name).toBe("Immunity");
    expect(model.lines).toEqual([]);
    expect(model.extraDescription).toBe("");
    expect(model.commonDescription).toBeUndefined();

    const pseudo = passiveModelOf("Resistance", "PseudoImmunity");
    expect(pseudo.name).toBe("Pseudo Immunity");
    expect(pseudo.lines).toEqual([]);
  });

  it("Berserk appends BerserkAbilityDescriptionKey (override @ 0x10bb1c)", () => {
    const model = passiveModelOf("Yeti", "Berserk");
    expect(model.name).toBe("Berserk");
    expect(model.lines).toEqual([strings["BerserkAbilityDescriptionKey"]]);
  });

  it("targetPriorityAdjustment >= 1 renders the Taunt sentence, <= -1 the Detaunt sentence", () => {
    const taunt = passiveModelOf("CrabKing", "EasyTarget");
    expect(taunt.name).toBe("Easy Target");
    expect(taunt.lines).toEqual([strings["TauntDescriptionKey"]]);

    const detaunt = passiveModelOf("Goemon", "Detaunt");
    expect(detaunt.name).toBe("Ninjutsu");
    expect(detaunt.lines).toEqual([strings["DetauntDescriptionKey"]]);
  });

  it("revengeBuffs render under RevengeBuffHeaderKey with the un-scaled (non-UsableAbility) DOT roll", () => {
    const model = passiveModelOf("BabyNessie", "Curse");
    expect(model.lines[0]).toBe(strings["RevengeBuffHeaderKey"]);
    // Offensive.Poison, duration 500, roll relatedStat Attack (30): no activation-length fold
    // (DiceRoller's isKindOfClass:UsableAbility gate), abilityScalor 1 -> base 30, randomness
    // 0.2 -> 27-33.
    expect(model.lines[1]).toBe("Poison\nDuration: 500\nDeals 27-33 Fire damage over the duration");
  });

  it("Thorns pairs ExtraDescriptionThorns with the level-scaled FixedReflect line (@ 0x7e954)", () => {
    const model = passiveModelOf("SpikeBall", "ReturnDamage");
    expect(model.name).toBe("Thorns");
    expect(model.commonDescription).toBe(strings["ExtraDescriptionThorns"]);

    expect(model.lines).toEqual(["Reflects 12 damage"]);
  });

  it("SlowProc shows trunc((level/60 + 1) * 100) percent (@ 0x1078dc / sub_641b4)", () => {
    const model = passiveModelOf("KingSlime", "SlowProc");
    // level 12: (12/60 + 1) * 100 = 120.
    expect(model.lines).toEqual(["Slows target to 120% of normal"]);
  });

  it("auras describe their granted StatOnly buffs at playerBuffLevel == 1 (nil-source Buff.level)", () => {
    const model = passiveModelOf("CrabKing", "Charisma");
    expect(model.name).toBe("Charisma");


    expect(model.lines).toEqual([strings["AuraBuffsFriendsKey"], "+1 Attack\n"]);
  });

  it("builds a model for every passive ref on every shipped monster (no unsupported classes left)", () => {
    let passives = 0;
    for (const monster of gd.allMonsters()) {
      for (const row of passiveRefs(monster.shortType)) {
        const model = buildPassiveAbilityInfoModel(gd, strings, row.ref, row.displayName, {
          ...context,
          element: monster.element,
        });
        expect(model.name.length).toBeGreaterThan(0);
        // Passives are not UsableAbility descendants: never a target rule, never a TU line.
        expect(model.extraDescription).not.toContain("Time Units(TU)");
        passives++;
      }
    }
    expect(passives).toBeGreaterThanOrEqual(20);
  });
});
