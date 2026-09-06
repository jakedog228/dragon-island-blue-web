import { GameData } from "@dib/gamedata/browser";
import type { JobAbilityRef, StatName } from "@dib/gamedata";
import type { BattleTeamMemberSetup, EncounterConfig } from "../battle/encounter.js";
import {
  DEMO_ENCOUNTER,
  DEMO_ENCOUNTER_BACKGROUND_KEY,
} from "../battle/encounter.js";
import { rosterRng, sampleEncounter } from "../battle/rosterSampler.js";
import type {
  ImportedContentPackage,
  ImportedGameData,
} from "../content/archivePackage.js";
import { localizedRenderableName } from "../localization.js";
import { DEMO_PLAYER_PROFILE_DEFAULTS } from "../player/demoPlayerProfile.js";
import {
  SCENARIO_COMBAT_EXAMPLES,
  SCENARIO_USABLE_SLOTS,
  type ScenarioBattleResourcesConfiguration,
  type ScenarioCombatantConfiguration,
  type ScenarioCombatExample,
  type ScenarioFixedCombatConfiguration,
  type ScenarioJobAbilityConfiguration,
  type ScenarioPassiveAbilityConfiguration,
} from "./scenarioMode.js";

type Dict = Record<string, unknown>;

export interface ScenarioCatalogEntry {
  readonly value: string;
  readonly label: string;
}

export interface ScenarioExampleCatalogEntry extends ScenarioCatalogEntry {
  readonly available: boolean;
  readonly unavailableReason?: string;
}

export interface NativeScenarioKit {
  readonly kitSlots: readonly (ScenarioJobAbilityConfiguration | null)[];
  readonly passiveAbilities: readonly ScenarioPassiveAbilityConfiguration[];
}

export interface FixedCombatScenarioCatalog {
  readonly monsters: readonly ScenarioCatalogEntry[];
  readonly combatAbilities: readonly ScenarioCatalogEntry[];
  readonly allAbilities: readonly ScenarioCatalogEntry[];
  readonly backgrounds: readonly string[];
  readonly examples: readonly ScenarioExampleCatalogEntry[];
  readonly nativeKits: Readonly<Record<string, NativeScenarioKit>>;
  readonly soulStonesAvailable: boolean;
  readonly spirits: readonly ScenarioCatalogEntry[];
}

export interface PreparedFixedCombatScenario {
  /** A shallow package copy whose mechanical data contains transient per-combatant aliases. */
  readonly gameContent: ImportedContentPackage;
  /** The encounter names kit aliases while retaining the selected monsters' art and names. */
  readonly encounter: EncounterConfig;
}

export const MAX_SCENARIO_TEAM_SIZE = 9;
export const ICE_STORM_SCENARIO_ABILITY = "Offensive.IceStorm";
export const ICE_STORM_SCENARIO_HOLDER = "SnowCub";
export const ICE_STORM_SCENARIO_SIDEKICK = "SphinxMaster";
export const ICE_STORM_SCENARIO_TARGET_ABILITY = "Utility.Delay";

export const DEFAULT_SCENARIO_BATTLE_RESOURCES: ScenarioBattleResourcesConfiguration =
  Object.freeze({
    heroLevel: 30,
    silver: 50_000,
    gold: 10_000,
    captureCards: Object.freeze({ 1: 20, 2: 20, 3: 20 }),
    spiritReadiness: 0.9,
    equippedGems: Object.freeze([null, null, null, null]),
    spiritTierLevels: Object.freeze({}),
    skillPoints: Object.freeze({}),
  });

const EXAMPLE_LABELS: Readonly<Record<ScenarioCombatExample, string>> = Object.freeze({
  random: "Seeded random roster",
  reserve: "Reserve promotion 6v6",
  starter: "Starter dragons 3v3",
  "ice-storm": "Ice Storm mirror 2v2",
});

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneArguments(value: Readonly<Record<string, unknown>>): Dict {
  return structuredClone(value) as Dict;
}

function gameDataFromImported(data: ImportedGameData): GameData {
  return GameData.fromRaw({
    monsters: data.monsters,
    jobs: data.jobs,
    abilities: data.abilities,
    abilityComponents: data.abilityComponents,
    buffs: data.buffs,
    ...(data.items === undefined ? {} : { items: data.items }),
    ...(data.combines === undefined ? {} : { combines: data.combines }),
    ...(data.licenses === undefined ? {} : { licenses: data.licenses }),
    ...(data.tournaments === undefined ? {} : { tournaments: data.tournaments }),
    ...(data.thingsInWorld === undefined ? {} : { thingsInWorld: data.thingsInWorld }),
  });
}

function abilityDefinitionCandidates(abilities: Dict): readonly string[] {
  const found: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (!isDict(value)) return;
    if (path !== "" && ("class" in value || "parent" in value)) found.push(path);
    for (const [key, child] of Object.entries(value)) {
      visit(child, path === "" ? key : `${path}.${key}`);
    }
  };
  visit(abilities, "");
  return found.sort();
}

function configuredRef(ref: JobAbilityRef): ScenarioJobAbilityConfiguration {
  return {
    abilityPath: ref.type,
    arguments: cloneArguments(ref.arguments),
  };
}

function nativeKit(data: GameData, shortType: string): NativeScenarioKit {
  const refs = data.jobAbilities(shortType);
  const bySlot = new Map(refs.map((ref) => [ref.slot, ref]));
  return {
    kitSlots: SCENARIO_USABLE_SLOTS.map((slot) => {
      const ref = bySlot.get(slot);
      return ref === undefined ? null : configuredRef(ref);
    }),
    passiveAbilities: refs.flatMap((ref): ScenarioPassiveAbilityConfiguration[] =>
      SCENARIO_USABLE_SLOTS.includes(ref.slot as typeof SCENARIO_USABLE_SLOTS[number])
        ? []
        : [{ slot: ref.slot, ...configuredRef(ref) }]),
  };
}

function cloneKit(kit: NativeScenarioKit): NativeScenarioKit {
  return {
    kitSlots: kit.kitSlots.map((slot) => slot === null
      ? null
      : { abilityPath: slot.abilityPath, arguments: cloneArguments(slot.arguments) }),
    passiveAbilities: kit.passiveAbilities.map((ref) => ({
      slot: ref.slot,
      abilityPath: ref.abilityPath,
      arguments: cloneArguments(ref.arguments),
    })),
  };
}

function defaultBattleResources(data: GameData): ScenarioBattleResourcesConfiguration {
  const spiritTypes = new Set(
    data.allMonsters()
      .filter(({ path }) => path.startsWith("Spirit."))
      .map(({ shortType }) => shortType),
  );
  return {
    ...structuredClone(DEFAULT_SCENARIO_BATTLE_RESOURCES),
    spiritTierLevels: Object.fromEntries(
      Object.entries(DEMO_PLAYER_PROFILE_DEFAULTS.spiritTierLevels ?? {})
        .filter(([shortType]) => spiritTypes.has(shortType)),
    ),
  };
}

function hasTypes(data: GameData, types: readonly string[]): boolean {
  const known = new Set(data.allMonsters().map(({ shortType }) => shortType));
  return types.every((type) => known.has(type));
}

function exampleCatalog(data: GameData): ScenarioExampleCatalogEntry[] {
  const reserveTypes = [...DEMO_ENCOUNTER.playerTeam, ...DEMO_ENCOUNTER.enemyTeam]
    .map(({ shortType }) => shortType);
  const starterTypes = ["BlueBabyDragon", "RedBabyDragon", "WhiteBabyDragon", "GoldBabyDragon"];
  const iceTypes = [ICE_STORM_SCENARIO_HOLDER, ICE_STORM_SCENARIO_SIDEKICK];
  // Strict lookup is the availability proof and also rejects a non-Combat definition which happens
  // to occupy the same path in independently authored content.
  const hasCombatAbility = (path: string): boolean => {
    try {
      return data.ability(path).className === "CombatAbility";
    } catch {
      return false;
    }
  };
  const conditions: Record<ScenarioCombatExample, { available: boolean; reason: string }> = {
    reserve: {
      available: hasTypes(data, reserveTypes),
      reason: "The selected package does not contain every monster used by the 6v6 example.",
    },
    starter: {
      available: hasTypes(data, starterTypes),
      reason: "The selected package does not contain the four starter-dragon species.",
    },
    random: {
      available: data.allMonsters().length >= 2,
      reason: "A random mirror needs at least two distinct monsters.",
    },
    "ice-storm": {
      available: hasTypes(data, iceTypes) &&
        hasCombatAbility(ICE_STORM_SCENARIO_ABILITY) &&
        hasCombatAbility(ICE_STORM_SCENARIO_TARGET_ABILITY),
      reason: "This package needs SnowCub, SphinxMaster, Offensive.IceStorm, and Utility.Delay.",
    },
  };
  return SCENARIO_COMBAT_EXAMPLES.map((value) => ({
    value,
    label: EXAMPLE_LABELS[value],
    available: conditions[value].available,
    ...(conditions[value].available ? {} : { unavailableReason: conditions[value].reason }),
  }));
}

/** Archive-backed catalog for every picker in the generalized encounter editor. */
export function fixedCombatScenarioCatalog(content: ImportedContentPackage): FixedCombatScenarioCatalog {
  const data = gameDataFromImported(content.data);
  const monsters = data.allMonsters()
    .map((monster) => ({
      value: monster.shortType,
      label: localizedRenderableName(content.data.strings, [monster.shortType]),
    }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
  const allAbilities = abilityDefinitionCandidates(content.data.abilities)
    .flatMap((path): Array<ScenarioCatalogEntry & { className: string }> => {
      try {
        const ability = data.ability(path);
        const shortName = path.split(".").at(-1)!;
        return [{
          value: path,
          label: localizedRenderableName(content.data.strings, [shortName]),
          className: ability.className,
        }];
      } catch {
        // Effect-builder dictionaries also carry `class`; only strict Ability definitions belong.
        return [];
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
  const nativeKits = Object.fromEntries(
    data.allMonsters().map(({ shortType }) => [shortType, nativeKit(data, shortType)]),
  );
  return {
    monsters,
    combatAbilities: allAbilities
      .filter(({ className }) => className === "CombatAbility")
      .map(({ value, label }) => ({ value, label })),
    allAbilities: allAbilities.map(({ value, label }) => ({ value, label })),
    backgrounds: [...content.combatBackgroundKeys],
    examples: exampleCatalog(data),
    nativeKits,
    soulStonesAvailable: content.data.items !== undefined,
    spirits: data.allMonsters()
      .filter(({ path }) => path.startsWith("Spirit."))
      .map(({ shortType }) => ({
        value: shortType,
        label: localizedRenderableName(content.data.strings, [shortType]),
      }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value)),
  };
}

export function scenarioCombatantForMonster(
  catalog: FixedCombatScenarioCatalog,
  shortType: string,
  options: {
    readonly level?: number;
    readonly boss?: boolean;
    readonly capturable?: boolean;
  } = {},
): ScenarioCombatantConfiguration {
  const kit = catalog.nativeKits[shortType];
  if (kit === undefined) throw new Error(`Scenario catalog has no native kit for ${shortType}.`);
  const cloned = cloneKit(kit);
  return {
    shortType,
    level: options.level ?? 12,
    boss: options.boss ?? false,
    capturable: options.capturable ?? true,
    kitSlots: cloned.kitSlots,
    passiveAbilities: cloned.passiveAbilities,
  };
}

function scenarioMember(
  data: GameData,
  setup: BattleTeamMemberSetup,
): ScenarioCombatantConfiguration {
  const kit = nativeKit(data, setup.shortType);
  return {
    shortType: setup.shortType,
    level: setup.level,
    boss: setup.boss ?? false,
    capturable: setup.capturable ?? true,
    ...(setup.currentHp === undefined ? {} : { currentHp: setup.currentHp }),
    kitSlots: cloneKit(kit).kitSlots,
    passiveAbilities: cloneKit(kit).passiveAbilities,
    ...(setup.soulStone === undefined
      ? {}
      : {
          soulStone: {
            sourceType: setup.soulStone.sourceType ?? setup.shortType,
            level: setup.soulStone.level,
          },
        }),
    ...(setup.flatStatBonuses === undefined
      ? {}
      : { flatStatBonuses: { ...setup.flatStatBonuses } }),
  };
}

function preferredBackground(content: ImportedContentPackage): string {
  return content.combatBackgroundKeys.includes(DEMO_ENCOUNTER_BACKGROUND_KEY)
    ? DEMO_ENCOUNTER_BACKGROUND_KEY
    : content.combatBackgroundKeys[0]!;
}

function fixedFromEncounter(
  data: GameData,
  content: ImportedContentPackage,
  encounter: EncounterConfig,
): ScenarioFixedCombatConfiguration {
  return {
    backgroundKey: content.combatBackgroundKeys.includes(encounter.backgroundKey)
      ? encounter.backgroundKey
      : preferredBackground(content),
    allowRetreat: encounter.allowRetreat ?? true,
    blockCapture: encounter.blockCapture ?? false,
    ...(encounter.breederXpBonus === undefined
      ? {}
      : { breederXpBonus: encounter.breederXpBonus }),
    resources: defaultBattleResources(data),
    playerTeam: encounter.playerTeam.map((member) => scenarioMember(data, member)),
    enemyTeam: encounter.enemyTeam.map((member) => scenarioMember(data, member)),
  };
}

/** Materialize an example immediately. From this point onward it is ordinary editable fixed data. */
export function fixedCombatScenarioExample(
  content: ImportedContentPackage,
  example: ScenarioCombatExample,
  seed: number,
): ScenarioFixedCombatConfiguration {
  const data = gameDataFromImported(content.data);
  const availability = exampleCatalog(data).find(({ value }) => value === example)!;
  if (!availability.available) throw new Error(availability.unavailableReason);
  const backgroundKey = preferredBackground(content);
  if (example === "reserve") {
    return fixedFromEncounter(data, content, { ...DEMO_ENCOUNTER, backgroundKey });
  }
  if (example === "starter") {
    const starters = ["BlueBabyDragon", "RedBabyDragon", "WhiteBabyDragon", "GoldBabyDragon"];
    return fixedFromEncounter(data, content, {
      backgroundKey,
      blockSaveMe: true,
      playerTeam: starters.slice(0, 3).map((shortType) => ({ shortType, level: 10 })),
      enemyTeam: starters.slice(1).map((shortType) => ({ shortType, level: 10 })),
    });
  }
  if (example === "random") {
    const sideSize = Math.min(MAX_SCENARIO_TEAM_SIZE, Math.floor(data.allMonsters().length / 2));
    return fixedFromEncounter(data, content, {
      ...sampleEncounter(data, rosterRng(seed), {
        playerTeamSize: sideSize,
        enemyTeamSize: sideSize,
      }),
      backgroundKey,
      blockSaveMe: true,
    });
  }

  const carrier = (): ScenarioCombatantConfiguration => {
    const member = scenarioMember(data, {
      shortType: ICE_STORM_SCENARIO_HOLDER,
      level: 12,
      boss: true,
    });
    return {
      ...member,
      kitSlots: [
        { abilityPath: ICE_STORM_SCENARIO_ABILITY, arguments: {} },
        null,
        null,
        null,
      ],
    };
  };
  const sidekick = (): ScenarioCombatantConfiguration => {
    const member = scenarioMember(data, {
      shortType: ICE_STORM_SCENARIO_SIDEKICK,
      level: 12,
    });
    return {
      ...member,
      kitSlots: [
        { abilityPath: ICE_STORM_SCENARIO_TARGET_ABILITY, arguments: {} },
        null,
        null,
        null,
      ],
    };
  };
  return {
    backgroundKey,
    allowRetreat: true,
    blockCapture: true,
    resources: defaultBattleResources(data),
    playerTeam: [carrier(), sidekick()],
    enemyTeam: [carrier(), sidekick()],
  };
}

function validateResources(data: GameData, resources: ScenarioBattleResourcesConfiguration): void {
  if (!Number.isSafeInteger(resources.heroLevel) || resources.heroLevel < 1) {
    throw new Error(`Scenario hero level must be a positive integer: ${resources.heroLevel}`);
  }
  for (const [name, value] of [
    ["silver", resources.silver],
    ["gold", resources.gold],
    ["capture cards 1", resources.captureCards[1]],
    ["capture cards 2", resources.captureCards[2]],
    ["capture cards 3", resources.captureCards[3]],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Scenario ${name} must be a non-negative integer: ${value}`);
    }
  }
  if (!Number.isFinite(resources.spiritReadiness) ||
      resources.spiritReadiness < 0 || resources.spiritReadiness > 1) {
    throw new Error(`Scenario spirit readiness must be between 0 and 1: ${resources.spiritReadiness}`);
  }
  if (resources.equippedGems.length !== 4) {
    throw new Error("Scenario must define exactly four equipped Gem slots.");
  }
  resources.equippedGems.forEach((gem, slot) => {
    if (gem === null) return;
    if (!Number.isSafeInteger(gem.level) || gem.level < 1) {
      throw new Error(`Scenario Gem ${slot + 1} level must be a positive integer: ${gem.level}`);
    }
    if (!Number.isSafeInteger(gem.quality) || gem.quality < 0) {
      throw new Error(`Scenario Gem ${slot + 1} quality must be a non-negative integer: ${gem.quality}`);
    }
    if (new Set(gem.enabledStats).size !== gem.enabledStats.length) {
      throw new Error(`Scenario Gem ${slot + 1} repeats an enabled stat.`);
    }
  });
  for (const [shortType, tier] of Object.entries(resources.spiritTierLevels)) {
    const spirit = data.monsterByShortType(shortType);
    if (!spirit.path.startsWith("Spirit.")) {
      throw new Error(`Scenario Spirit roster names non-Spirit monster ${shortType}.`);
    }
    if (!Number.isSafeInteger(tier) || tier < 0 || tier > 18) {
      throw new Error(`Scenario Spirit ${shortType} tier must be an integer from 0 to 18: ${tier}`);
    }
  }
  let allocated = 0;
  for (const [stat, points] of Object.entries(resources.skillPoints)) {
    if (!Number.isSafeInteger(points) || points < 0) {
      throw new Error(`Scenario hero ${stat} skill points must be a non-negative integer: ${points}`);
    }
    allocated += points;
  }
  if (allocated > resources.heroLevel) {
    throw new Error(`Scenario hero skill points ${allocated} exceed hero level ${resources.heroLevel}.`);
  }
}

function validateFixedCombat(
  data: GameData,
  backgrounds: readonly string[],
  fixed: ScenarioFixedCombatConfiguration,
): void {
  if (!backgrounds.includes(fixed.backgroundKey)) {
    throw new Error(`Fixed combat references unavailable background: ${fixed.backgroundKey}`);
  }
  validateResources(data, fixed.resources);
  if (fixed.breederXpBonus !== undefined &&
      (!Number.isFinite(fixed.breederXpBonus) || fixed.breederXpBonus < 0)) {
    throw new Error(`Fixed combat breeder XP multiplier must be finite and non-negative.`);
  }
  for (const [name, team] of [["player", fixed.playerTeam], ["enemy", fixed.enemyTeam]] as const) {
    if (team.length < 1 || team.length > MAX_SCENARIO_TEAM_SIZE) {
      throw new Error(
        `Fixed combat ${name} team must contain 1 to ${MAX_SCENARIO_TEAM_SIZE} combatants.`,
      );
    }
    for (const member of team) {
      if (!Number.isSafeInteger(member.level) || member.level < 1 || member.level > 150) {
        throw new Error(`Fixed combat level must be an integer from 1 to 150: ${member.level}`);
      }
      data.monsterByShortType(member.shortType);
      if (member.currentHp !== undefined &&
          (!Number.isSafeInteger(member.currentHp) || member.currentHp < 1)) {
        throw new Error(`Fixed combat starting HP must be a positive integer: ${member.currentHp}`);
      }
      if (member.kitSlots.length !== SCENARIO_USABLE_SLOTS.length) {
        throw new Error(`Fixed combat ${member.shortType} must define exactly four usable slots.`);
      }
      let usableCount = 0;
      for (const slot of member.kitSlots) {
        if (slot === null) continue;
        usableCount++;
        const ability = data.ability(slot.abilityPath);
        if (ability.className !== "CombatAbility") {
          throw new Error(`${slot.abilityPath} is ${ability.className}, not a CombatAbility.`);
        }
        if (!isDict(slot.arguments)) throw new Error(`${slot.abilityPath} arguments must be an object.`);
      }
      if (usableCount === 0) throw new Error(`${member.shortType} needs at least one usable ability.`);
      const passiveSlots = new Set<string>();
      for (const passive of member.passiveAbilities) {
        if (passive.slot.trim() === "" || /^usable[1-4]$/.test(passive.slot)) {
          throw new Error(`Invalid passive slot name: ${passive.slot}`);
        }
        if (passiveSlots.has(passive.slot)) throw new Error(`Duplicate passive slot: ${passive.slot}`);
        passiveSlots.add(passive.slot);
        data.ability(passive.abilityPath);
        if (!isDict(passive.arguments)) {
          throw new Error(`${passive.abilityPath} arguments must be an object.`);
        }
      }
      if (member.soulStone !== undefined) {
        if (!Number.isSafeInteger(member.soulStone.level) || member.soulStone.level < 1) {
          throw new Error(`Soul-stone level must be a positive integer: ${member.soulStone.level}`);
        }
        const source = data.monsterByShortType(member.soulStone.sourceType);
        data.soulStoneByElement(source.element);
      }
      for (const [stat, value] of Object.entries(member.flatStatBonuses ?? {})) {
        if (!Number.isFinite(value)) throw new Error(`${member.shortType} ${stat} bonus must be finite.`);
      }
    }
  }
}

function scenarioAlias(team: "player" | "enemy", index: number): string {
  return `DIBScenario${team === "player" ? "P" : "E"}${index + 1}`;
}

function rendererArgumentsFor(originalShortType: string, rendererData: unknown): Dict {
  const authored = isDict(rendererData) ? rendererData : {};
  return {
    ...authored,
    spriteFile: typeof authored["spriteFile"] === "string"
      ? authored["spriteFile"]
      : `${originalShortType}.png`,
  };
}

function flatScenarioMonster(original: ReturnType<GameData["monsterByShortType"]>, index: number): Dict {
  return {
    class: "Monster",
    category: original.category,
    element: original.element,
    index,
    quality: original.quality,
    stars: original.stars,
    rootStats: { ...original.rootStats },
    unarmedAttackType: original.unarmedAttackType,
    // Always concrete on a loaded `MonsterDef` (the loader materializes the native
    // omitted-key default), so the round-trip writes the effective value explicitly.
    eggUnlockQuality: original.eggUnlockQuality,
    ...(original.summonXpBonus === undefined
      ? {}
      : { summonXpBonus: original.summonXpBonus }),
    ...(original.rendererData === undefined
      ? {}
      : { rendererData: original.rendererData }),
  };
}

function sameArguments(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasEditedKit(data: GameData, member: ScenarioCombatantConfiguration): boolean {
  const native = nativeKit(data, member.shortType);
  if (member.kitSlots.some((slot, index) => {
    const expected = native.kitSlots[index];
    if (expected === undefined) return true;
    if (slot === null || expected === null) return slot !== expected;
    return slot.abilityPath !== expected.abilityPath || !sameArguments(slot.arguments, expected.arguments);
  })) return true;
  if (member.passiveAbilities.length !== native.passiveAbilities.length) return true;
  return member.passiveAbilities.some((passive, index) => {
    const expected = native.passiveAbilities[index];
    return expected === undefined || passive.slot !== expected.slot ||
      passive.abilityPath !== expected.abilityPath ||
      !sameArguments(passive.arguments, expected.arguments);
  });
}

function teamMemberSetup(
  data: GameData,
  member: ScenarioCombatantConfiguration,
): BattleTeamMemberSetup {
  const soulStone = member.soulStone === undefined
    ? undefined
    : {
        sourceType: member.soulStone.sourceType,
        level: member.soulStone.level,
        element: data.monsterByShortType(member.soulStone.sourceType).element,
      };
  return {
    shortType: member.shortType,
    level: member.level,
    ...(member.boss ? { boss: true } : {}),
    ...(member.capturable ? {} : { capturable: false }),
    ...(member.currentHp === undefined ? {} : { currentHp: member.currentHp }),
    ...(member.flatStatBonuses === undefined
      ? {}
      : { flatStatBonuses: { ...member.flatStatBonuses } }),
    ...(soulStone === undefined ? {} : { soulStone }),
  };
}

/** Build per-member job aliases only when the editable usable/passive kit differs from native. */
export function prepareFixedCombatScenario(
  content: ImportedContentPackage,
  fixed: ScenarioFixedCombatConfiguration,
): PreparedFixedCombatScenario {
  const data = gameDataFromImported(content.data);
  validateFixedCombat(data, content.combatBackgroundKeys, fixed);
  const monsters: Dict = { ...content.data.monsters };
  const jobs: Dict = { ...content.data.jobs };
  const existingTypes = new Set(data.allMonsters().map(({ shortType }) => shortType));
  const maxIndex = Math.max(...data.allMonsters().map(({ index }) => index));
  let aliasOrdinal = 0;

  const prepareMember = (
    team: "player" | "enemy",
    index: number,
    member: ScenarioCombatantConfiguration,
  ): BattleTeamMemberSetup => {
    const original = data.monsterByShortType(member.shortType);
    const setup = teamMemberSetup(data, member);
    if (!hasEditedKit(data, member)) return setup;
    const alias = scenarioAlias(team, index);
    if (existingTypes.has(alias) || alias in monsters || alias in jobs) {
      throw new Error(`Fixed-combat alias collides with package data: ${alias}`);
    }
    existingTypes.add(alias);
    aliasOrdinal++;
    monsters[alias] = flatScenarioMonster(original, maxIndex + aliasOrdinal);
    const jobAbilities: Dict = {};
    member.kitSlots.forEach((slot, slotIndex) => {
      if (slot === null) return;
      jobAbilities[SCENARIO_USABLE_SLOTS[slotIndex]!] = {
        type: slot.abilityPath,
        arguments: cloneArguments(slot.arguments),
      };
    });
    for (const passive of member.passiveAbilities) {
      jobAbilities[passive.slot] = {
        type: passive.abilityPath,
        arguments: cloneArguments(passive.arguments),
      };
    }
    jobs[alias] = {
      class: "Job",
      slots: ["Monster"],
      xpPenalty: data.jobXpPenalty(member.shortType),
      jobAbilities,
    };
    return {
      ...setup,
      shortType: alias,
      originalShortType: member.shortType,
      displayName: localizedRenderableName(content.data.strings, [member.shortType]),
      rendererData: rendererArgumentsFor(member.shortType, original.rendererData),
    };
  };

  const encounter: EncounterConfig = {
    backgroundKey: fixed.backgroundKey,
    allowRetreat: fixed.allowRetreat,
    blockCapture: fixed.blockCapture,
    blockSaveMe: true,
    ...(fixed.breederXpBonus === undefined ? {} : { breederXpBonus: fixed.breederXpBonus }),
    playerTeam: fixed.playerTeam.map((member, index) => prepareMember("player", index, member)),
    enemyTeam: fixed.enemyTeam.map((member, index) => prepareMember("enemy", index, member)),
  };
  return {
    gameContent: {
      ...content,
      data: { ...content.data, monsters, jobs },
    },
    encounter,
  };
}
