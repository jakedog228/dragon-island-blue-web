import { describe, it, expect } from "vitest";
import { abilityStatusTextLine, localizedRenderableName, localizedString } from "../src/localization.js";
import {
  buildRegistry,
  loadGameData,
  loadRawJson,
  resolveDataDir,
  resolveNode,
  type RawNode,
} from "@dib/gamedata";
import type { LocalizedStrings } from "../src/localization.js";


const strings = {
  RenderableWhiteDragonlingNameKey: "White Dragonling",
  RenderableSonicBlastNameKey: "Sonic Blast",
  HPKey: "HP",
} as const;

describe("localizedRenderableName (localizedName @ 0x8e544 / sub_91580 @ 0x91580)", () => {
  it("resolves Renderable<name>NameKey for a monster shortType", () => {
    expect(localizedRenderableName(strings, ["WhiteDragonling"])).toBe("White Dragonling");
  });

  it("falls back to the raw shortType when the key is missing", () => {
    expect(localizedRenderableName(strings, ["Minotaur"])).toBe("Minotaur");
  });

  it("tries the instanceName first, then the type name (ability chain)", () => {
    expect(localizedRenderableName(strings, ["SonicBlast", "SomeAbilityType"])).toBe("Sonic Blast");
    expect(localizedRenderableName(strings, ["UnknownInstance", "SonicBlast"])).toBe("Sonic Blast");
  });

  it("full miss falls back to the LAST candidate (the raw type name, never the instanceName)", () => {
    expect(localizedRenderableName(strings, ["UnknownInstance", "UnknownType"])).toBe("UnknownType");
  });

  it("throws on an empty candidate list", () => {
    expect(() => localizedRenderableName(strings, [])).toThrow();
  });
});

describe("localizedString (structural UI keys)", () => {
  it("returns the shipped value", () => {
    expect(localizedString(strings, "HPKey")).toBe("HP");
  });

  it("fails loudly on a missing structural key", () => {
    expect(() => localizedString(strings, "NopeKey")).toThrow(/NopeKey/);
  });
});


describe("abilityStatusTextLine (statusTextLocalizationKey @ 0xe3e08)", () => {
  const statusStrings = {
    DanceKey: "@N dances around like a buffoon.",
    LoosesTurnKey: "@N loses its turn",
    AnalyzePerformedKey: "Analyze Successful",
    BadDamageKey: "@N takes @DAMAGE!",
    BadAbilityKey: "@N uses @A",
  } as const;

  it("substitutes @N with the living's localized name", () => {
    expect(abilityStatusTextLine(statusStrings, "DanceKey", "Yeti")).toBe(
      "Yeti dances around like a buffoon.",
    );
    expect(abilityStatusTextLine(statusStrings, "LoosesTurnKey", "Spark")).toBe("Spark loses its turn");
  });

  it("passes token-free templates through unchanged", () => {
    expect(abilityStatusTextLine(statusStrings, "AnalyzePerformedKey", "Yeti")).toBe("Analyze Successful");
  });

  it("fails loudly on @DAMAGE/@A templates (no real carrier; sub_66770 format un-RE'd)", () => {
    expect(() => abilityStatusTextLine(statusStrings, "BadDamageKey", "Yeti")).toThrow(/@DAMAGE/);
    expect(() => abilityStatusTextLine(statusStrings, "BadAbilityKey", "Yeti")).toThrow(/@A/);
  });

  it("fails loudly on a missing key", () => {
    expect(() => abilityStatusTextLine(statusStrings, "NopeKey", "Yeti")).toThrow(/NopeKey/);
  });

  it("REAL DATA: exactly 5 abilities declare the key, all in sourceEventData, all @N-only", () => {
    // The census the battleNode implementation is scoped to (its doc comment cites this): if a
    // data change ever adds a friends/enemy-phase key or an @A/@DAMAGE/@HEALING template, this
    // test fails and the source-phase-only implementation must be extended.
    const dataDir = resolveDataDir();
    const realStrings = loadRawJson(dataDir, "LocalizableStrings.json") as LocalizedStrings;
    // Walk the FULL resolved Abilities.json registry (not job-reachable abilities only —
    // Utility.{LooseTurn,Escape,CallMonster} are system abilities no job slot references),
    // inheritance applied so a parent-declared key would surface on every child.
    const registry = buildRegistry(loadRawJson(dataDir, "Abilities.json") as RawNode);
    const carriers: string[] = [];
    for (const path of registry.keys()) {
      const eventData = resolveNode(path, registry)["eventData"] as
        | Record<string, unknown>
        | undefined;
      for (const phaseKey of ["sourceEventData", "friendlyTargetEventData", "enemyTargetEventData"]) {
        const dict = (eventData?.[phaseKey] ?? {}) as Record<string, unknown>;
        const key = dict["statusTextLocalizationKey"];
        if (typeof key !== "string") continue;
        expect(phaseKey).toBe("sourceEventData");
        expect(() => abilityStatusTextLine(realStrings, key, "X")).not.toThrow();
        carriers.push(`${path}#${key}`);
      }
    }
    // battleNode reads the key from the resolved ability dict only — a job-ref `arguments`
    // override would bypass it, so pin that none exists.
    const gd = loadGameData();
    for (const monster of gd.allMonsters()) {
      for (const ref of gd.jobAbilitiesOrEmpty(monster.shortType)) {
        const argEventData = ref.arguments["eventData"];
        expect(JSON.stringify(argEventData ?? "")).not.toContain("statusTextLocalizationKey");
      }
    }
    expect(carriers.sort()).toEqual([
      "Utility.Analyze#AnalyzePerformedKey",
      "Utility.CallMonster#CallMonsterKey",
      "Utility.Dance#DanceKey",
      "Utility.Escape#UseEscapeKey",
      "Utility.LooseTurn#LoosesTurnKey",
    ]);
  });
});
