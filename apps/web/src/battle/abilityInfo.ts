


import type { Element, GameData, JobAbilityRef, StatName } from "@dib/gamedata";
import {
  activationLengthScale,
  createStatOnlyBuff,
  divideForTargets,
  statOnlyBonus,
  type PlayerChoice,
} from "@dib/engine";
import { localizedRenderableName, localizedString, type LocalizedStrings } from "../localization.js";

const f = Math.fround;

export interface AbilityInfoContext {
  level: number;
  stats: Readonly<Record<StatName, number>>;
  element: Element;
  timeInCombat?: number;
  friendlyDeadCount?: number;
  enemyDeadCount?: number;
  friendlyActiveCount?: number;
  killsMade?: number;
}

export interface AbilityInfoModel {
  name: string;
  /** Renderable.localizedExtraDescription, shown by LivingProviderCommonDisplay when present. */
  commonDescription?: string;
  /** UsableAbility.localizedAbilityExtraDescriptionForLivingContext:, already newline-joined. */
  extraDescription: string;
  lines: readonly string[];
}

type Dict = Record<string, unknown>;
type ComponentRef = { type: string; arguments?: Dict };
type BuffRef = { type: string; arguments?: Dict };

const recordOf = (v: unknown): Dict => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Dict : {};
const numberOr = (v: unknown, fallback: number): number => typeof v === "number" ? v : fallback;

function sourceRef(data: GameData, shortType: string, choice: PlayerChoice): JobAbilityRef {
  const ref = data.jobAbilities(shortType).find((candidate) =>
    candidate.slot === choice.slot && candidate.type === choice.abilityPath
  );
  if (!ref) throw new Error(`ability info: ${shortType} has no ${choice.slot} -> ${choice.abilityPath} job reference`);
  return ref;
}

function objectiveCFormat(template: string, ...values: Array<string | number>): string {
  let index = 0;
  return template.replace(/%(?:\d+\.\d+|0\.1|2\.2)?(?:@|d|f)|%%/g, (token) => {
    if (token === "%%") return "%";
    const value = values[index++];
    if (value === undefined) throw new Error(`ability info: too few values for ${JSON.stringify(template)}`);
    if (token.endsWith("d")) return String(Math.trunc(Number(value)));
    if (token.includes(".1")) return Number(value).toFixed(1);
    if (token.includes(".2")) return Number(value).toFixed(2);
    return String(value);
  });
}

function numberOfEnemyTargets(choice: PlayerChoice): number {
  if (choice.targeting.kind === "allEnemies") return 3;
  if (choice.targeting.kind === "mixed") return choice.targeting.allEnemies ? 3 : choice.targeting.enemyCount;
  return choice.targeting.kind === "enemies" ? choice.targeting.count : 0;
}


function rollRange(
  relatedStat: StatName | undefined,
  randomness: number,
  abilityScalor: number,
  activationLength: number | undefined,
  numTargets: number,
  context: AbilityInfoContext,
): string {
  let stat = relatedStat === undefined ? 0 : context.stats[relatedStat];
  if (activationLength !== undefined) stat = f(f(stat) * activationLengthScale(activationLength));
  let value = f(f(abilityScalor) * f(stat));
  if (numTargets >= 2) value = f(value / f(f(numTargets) * f(0.84)));
  const base = Math.round(value);
  const spread = f(f(base) * f(randomness));
  const min = Math.max(1, Math.trunc(f(f(base) + f(spread * f(-0.5)))));
  const max = Math.max(1, Math.trunc(f(f(base) + f(spread * f(0.5)))));
  return min === max ? String(min) : `${min}-${max}`;
}

function statDisplayName(strings: LocalizedStrings, stat: StatName): string {
  return localizedString(strings, `Stat${stat}InfoTitleKey`);
}

function elementDisplayName(strings: LocalizedStrings, element: Element): string {
  return localizedString(strings, `Element${element}Key`);
}

function componentDescription(
  data: GameData,
  strings: LocalizedStrings,
  ref: ComponentRef,
  commonArgs: Dict,
  choice: PlayerChoice,
  abilityScalor: number,
  context: AbilityInfoContext,
): string[] {
  const def = data.abilityComponent(ref.type);
  const args = { ...recordOf(ref.arguments), ...commonArgs };
  const roll = { ...recordOf(def.raw["roll"]), ...recordOf(args["roll"]) };
  const relatedStat = typeof roll["relatedStat"] === "string" ? roll["relatedStat"] as StatName : undefined;
  const randomness = numberOr(roll["randomness"], 0.2);
  const enemyTargets = numberOfEnemyTargets(choice);
  const damageLine = (): string => objectiveCFormat(
    localizedString(strings, "DescriptionDamageFormatKey"),
    rollRange(relatedStat, randomness, abilityScalor, choice.activationLength, enemyTargets, context),
    elementDisplayName(strings, context.element),
    localizedString(strings, relatedStat === "Magic" ? "MagicalDamageKey" : "PhysicalDamageKey"),
  );

  switch (def.className) {
    case "AttackAbilityComponent":
    case "DamageDealingAbilityComponent": {
      const descriptionKey = args["modDescriptionKey"];
      return typeof descriptionKey === "string" && descriptionKey.length > 0
        ? [damageLine(), localizedString(strings, descriptionKey)]
        : [damageLine()];
    }
    case "DrainLifeAbilityComponent": {
      const percent = Math.round(Math.abs(numberOr(args["healPercent"], 0)) * 100);
      const key = numberOr(args["healPercent"], 0) >= 0 ? "DrainHealthFormatKey" : "RecklessAttackFormatKey";
      return [damageLine(), objectiveCFormat(localizedString(strings, key), percent)];
    }
    case "DiceAbilityComponent": {
      const bonus = Math.round(numberOr(args["matchMagnification"], 0.5) * 100);
      return [damageLine(), objectiveCFormat(localizedString(strings, "DiceFormatKey"), bonus)];
    }
    case "HealingAbilityComponent":
      return [objectiveCFormat(
        localizedString(strings, "DescriptionHealingFormatKey"),
        rollRange(relatedStat, randomness, abilityScalor, choice.activationLength, 1, context),
      )];
    case "StunAbilityComponent": {
      const scaled = Math.trunc(f(f(Math.trunc(f(f(choice.activationLength) * activationLengthScale(choice.activationLength)))) * f(abilityScalor)));
      return [objectiveCFormat(localizedString(strings, "StunEffectFormatKey"), Math.round(divideForTargets(scaled, enemyTargets)))];
    }
    case "ParalyzeAbilityComponent":
    case "SleepAbilityComponent":
    case "ConfuseAbilityComponent": {
      const factor = def.className === "ParalyzeAbilityComponent" ? 1.3 : def.className === "SleepAbilityComponent" ? 1.5 : 1.75;
      const first = Math.trunc(f(f(choice.activationLength) * f(factor)));
      const length = Math.round(divideForTargets(Math.trunc(f(f(first) * f(abilityScalor))), enemyTargets));
      const key = def.className === "ParalyzeAbilityComponent" ? "ParalyzeEffectFormatKey"
        : def.className === "SleepAbilityComponent" ? "SleepEffectFormatKey" : "ConfuseEffectFormatKey";
      return [objectiveCFormat(localizedString(strings, key), length)];
    }
    case "StatModAbilityComponent": {
      const stat = args["stat"] as StatName;
      if (!(stat in context.stats)) throw new Error(`ability info: unknown StatMod stat ${String(args["stat"])}`);
      const help = args["help"] !== false;
      const buff = createStatOnlyBuff({ sourceId: "info", sourceLevel: context.level, stats: [stat], statsHelp: help });
      const amount = Math.round(Math.abs(statOnlyBonus(buff, stat)));
      return [objectiveCFormat(localizedString(strings, help ? "StatBuffFormatKey" : "StatDebuffFormatKey"), statDisplayName(strings, stat), amount)];
    }
    case "HasteAbilityComponent": {
      const help = args["help"] !== false;
      // Native text reports the actual TU change produced by applyMod, not the raw haste ivar.
      const percent = help ? Math.round(100 - 100 / 1.6) : Math.round(130 - 100);
      return [objectiveCFormat(localizedString(strings, help ? "HasteBuffFormatKey" : "HasteDebuffFormatKey"), percent)];
    }
    case "StatusRemoveAbilityComponent": {
      const statuses = Array.isArray(args["statusTypes"]) ? args["statusTypes"].map(String).join(", ") : "";
      return [`${localizedString(strings, "RemoveEffectsKey")}: ${statuses}`];
    }
    case "RemoveAllBuffsAbilityComponent":
      return [localizedString(strings, "RemoveAllBuffsKey")];
    case "SwitchAbilityComponent":
      return [localizedString(strings, "ReplaceMonsterKey")];
    case "MoveToFrontAbilityComponent":
      return [localizedString(strings, "MoveToFrontKey")];
    case "AddMonsterAbilityComponent": {
      const addType = typeof args["addType"] === "string" ? args["addType"] : undefined;
      const monster = addType
        ? localizedRenderableName(strings, [addType])
        : localizedString(strings, "CopyOfTargetKey");
      const hpStyle = args["hpStyle"] === "match" ? localizedString(strings, "EqualKey")
        : args["hpStyle"] === "split" ? localizedString(strings, "SharedKey") : "100%";
      return [objectiveCFormat(localizedString(strings, "AddMonsterHelpFormatKey"), monster, hpStyle)];
    }
    case "CallMonsterAbilityComponent": {
      const monsterType = typeof args["monsterType"] === "string" ? args["monsterType"] : undefined;
      const monster = monsterType ? localizedRenderableName(strings, [monsterType]) : localizedString(strings, "RandomMonsterKey");
      return [objectiveCFormat(localizedString(strings, "CallMonsterFormatKey"), monster)];
    }
    case "SacrificeAbilityComponent":
      return [objectiveCFormat(localizedString(strings, "SacrificeFormatKey"), numberOr(args["levelMultiplier"], 0) * 100)];
    case "SpendSilverAbilityComponent":
      return [objectiveCFormat(localizedString(strings, "SpendSilverAbilityFormatKey"), context.level * 10, Math.round(numberOr(args["damageMagnifier"], 0) * 100))];
    case "MagnifyAbilityComponent":
      return magnifyDescription(strings, args, context);
    // These classes inherit the base component's empty description.
    case "AnalyzeAbilityComponent":
    case "CaptureAbilityComponent":
    case "DesoulAbilityComponent":
    case "EscapeAbilityComponent":
    case "FeatherAbilityComponent":
      return [];
    default:
      throw new Error(`ability info: unsupported component class ${def.className} (${ref.type})`);
  }
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function magnifyDescription(strings: LocalizedStrings, args: Dict, context: AbilityInfoContext): string[] {
  const lines = [localizedString(strings, "MagnificationPrefixKey")];
  for (const [target, amount] of Object.entries(recordOf(args["targetMultipliers"]))) {


    if (typeof amount === "number") lines.push(objectiveCFormat("%d%% VS %@\n", Math.round(amount * 100), strings[target] ?? target));
  }
  for (const [status, amount] of Object.entries(recordOf(args["statusMultipliers"]))) {
    const statusName = strings[`StatusEffect${status}Key`] ?? "";
    if (typeof amount === "number") lines.push(objectiveCFormat("%d%% VS %@\n", Math.round(amount * 100), statusName));
  }
  const formatted = (key: string, amount: number, current: number): string => objectiveCFormat(
    localizedString(strings, key), amount * 100, current === 0 ? "" : `[${signedPercent(current)}]`,
  );
  if (typeof args["timeInCombatMultiplier"] === "number") {
    const amount = args["timeInCombatMultiplier"] as number;
    lines.push(formatted("MagnifyTimeInCombatFormatKey", amount * 100, amount * (context.timeInCombat ?? 0)));
  }
  if (typeof args["friendlyDeadMultiplier"] === "number") {
    const amount = args["friendlyDeadMultiplier"] as number;
    lines.push(formatted("MagnifyPerFriendlyCasualtyFormatKey", amount, amount * (context.friendlyDeadCount ?? 0)));
  }
  if (typeof args["enemyDeadMultiplier"] === "number") {
    const amount = args["enemyDeadMultiplier"] as number;
    lines.push(formatted("MagnifyPerEnemyCasualtyFormatKey", amount, amount * (context.enemyDeadCount ?? 0)));
  }
  if (typeof args["aloneMultiplier"] === "number") {
    const amount = args["aloneMultiplier"] as number;
    lines.push(formatted("MagnifyIfAloneFormatKey", amount, (context.friendlyActiveCount ?? 0) === 1 ? amount : 0));
  }
  if (typeof args["teamSizeMultiplier"] === "number") {
    const amount = args["teamSizeMultiplier"] as number;
    if (amount < 0) lines.push(localizedString(strings, "MagnifyTeamMembersPenaltyKey"));
    else lines.push(formatted("MagnifyTeamMembersFormatKey", amount, amount * Math.max(0, (context.friendlyActiveCount ?? 1) - 1)));
  }
  if (typeof args["myKillsMultiplier"] === "number") {
    const amount = args["myKillsMultiplier"] as number;
    lines.push(formatted("MagnifyMyKillsFormatKey", amount, amount * (context.killsMade ?? 0)));
  }
  return [lines.join("\n")];
}


const STAT_ENUM_ORDER: readonly StatName[] = ["MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist"];


function buffDescription(
  data: GameData,
  strings: LocalizedStrings,
  ref: BuffRef,
  activationLength: number | undefined,
  abilityScalor: number,
  sourceLevel: number,
  context: AbilityInfoContext,
): string {
  const def = data.buff(ref.type);
  const args = recordOf(ref.arguments);
  const parts: string[] = [];


  const statsDict = { ...recordOf(def.raw["stats"]), ...recordOf(args["stats"]) };
  const enabledStats = STAT_ENUM_ORDER.filter((stat) => statsDict[stat] === true);
  let providerSegment = "";
  if (enabledStats.length > 0) {
    const projection = createStatOnlyBuff({
      sourceId: "info",
      sourceLevel,
      sourceLevelScalor: numberOr(args["sourceLevelScalor"], 1),
      stats: enabledStats,
      statsHelp: args["statsHelp"] !== false,
    });
    for (const stat of enabledStats) {
      const bonus = Math.trunc(statOnlyBonus(projection, stat));
      providerSegment += `${bonus > 0 ? "+" : "-"}${Math.abs(bonus)} ${statDisplayName(strings, stat)}\n`;
    }
  }
  const priority = numberOr(args["targetPriorityAdjustment"], 0);
  if (priority > 0) providerSegment += localizedString(strings, "TauntDescriptionKey");
  else if (priority < 0) providerSegment += localizedString(strings, "DetauntDescriptionKey");
  if (providerSegment.length > 0) parts.push(providerSegment);
  const statuses = Object.entries(recordOf(def.raw["statusEffects"]))
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name);
  if (statuses.length > 0) parts.push(statuses.join(", "));
  const duration = numberOr(args["duration"], 0);
  if (duration >= 1) parts.push(objectiveCFormat(localizedString(strings, "BuffDurationFormatKey"), duration));
  if (def.className === "DamageOverTimeBuff") {
    const roll = recordOf(args["roll"]);
    const stat = typeof roll["relatedStat"] === "string" ? roll["relatedStat"] as StatName : undefined;
    parts.push(objectiveCFormat(
      localizedString(strings, "DescriptionDamageOverTimeFormatKey"),
      rollRange(stat, numberOr(roll["randomness"], 0.2), abilityScalor, activationLength, 1, context),
      elementDisplayName(strings, context.element),
    ));
  } else if (def.className === "DeathSentenceBuff") {
    parts.push(localizedString(strings, "DeathSentenceKey"));
  } else if (def.className === "StatShiftBuff") {
    const source = args["sourceStat"] as StatName;
    const destination = args["destinationStat"] as StatName;
    parts.push(objectiveCFormat(localizedString(strings, "StatShiftBuffFormatKey"), statDisplayName(strings, source), statDisplayName(strings, destination)));
  } else if (def.className === "ReflectiveBuff") {


    if (def.raw["fixedReflect"] === true) {
      parts.push(objectiveCFormat(localizedString(strings, "FixedReflectFormatKey"), Math.round(f(sourceLevel))));
    } else {
      parts.push(objectiveCFormat(localizedString(strings, "PercentReflectFormatKey"), f(f(sourceLevel) * f(0.01)) * 100));
    }
  } else if (def.className === "SlowProcBuff") {


    parts.push(objectiveCFormat(
      localizedString(strings, "SlowEffectFormatKey"),
      Math.trunc(f(f(f(f(sourceLevel) / f(60)) + 1) * f(100))),
    ));
  } else if (def.className === "StunProcBuff") {

    parts.push(objectiveCFormat(localizedString(strings, "StunEffectFormatKey"), sourceLevel * 20));
  } else if (def.className !== "Buff" && def.className !== "RemoveOnHurtBuff") {
    throw new Error(`ability info: unsupported buff class ${def.className} (${ref.type})`);
  }
  return parts.join("\n");
}

export function buildAbilityInfoModel(
  data: GameData,
  strings: LocalizedStrings,
  shortType: string,
  choice: PlayerChoice,
  context: AbilityInfoContext,
): AbilityInfoModel {
  const ref = sourceRef(data, shortType, choice);
  const ability = data.ability(choice.abilityPath);
  const commonArgs = recordOf(ref.arguments["commonComponentArguments"]);
  const abilityScalor = numberOr(ref.arguments["abilityScalor"], numberOr(ability.raw["abilityScalor"], 1));
  const lines: string[] = [];

  switch (choice.targeting.kind) {
    case "self": lines.push(localizedString(strings, "SelfOnlyAbilityKey")); break;
    case "allEnemies": lines.push(localizedString(strings, "AllEnemiesAbilityKey")); break;
    case "enemies": lines.push(objectiveCFormat(localizedString(strings, "NumberEnemyTargetsFormatKey"), choice.targeting.count)); break;
    case "allFriends": lines.push(localizedString(strings, "AllFriendsAbilityKey")); break;
    case "friends": lines.push(objectiveCFormat(localizedString(strings, "NumberFreindlyTargetsFormatKey"), choice.targeting.count)); break;
    case "mixed":
      lines.push(choice.targeting.allEnemies
        ? localizedString(strings, "AllEnemiesAbilityKey")
        : objectiveCFormat(localizedString(strings, "NumberEnemyTargetsFormatKey"), choice.targeting.enemyCount));
      lines.push(choice.targeting.allFriends
        ? localizedString(strings, "AllFriendsAbilityKey")
        : objectiveCFormat(localizedString(strings, "NumberFreindlyTargetsFormatKey"), choice.targeting.friendlyCount));
      break;
  }

  const argumentComponents = Array.isArray(ref.arguments["components"]) ? ref.arguments["components"] as ComponentRef[] : [];
  for (const component of [...argumentComponents, ...ability.components as ComponentRef[]]) {
    lines.push(...componentDescription(data, strings, component, commonArgs, choice, abilityScalor, context));
  }

  for (const [key, headerKey] of [
    ["sourceBuffs", "SourceBuffHeaderKey"],
    ["enemyBuffs", "EnemyBuffHeaderKey"],
    ["friendlyBuffs", "FriendlyBuffHeaderKey"],
  ] as const) {
    const refs = [
      ...(Array.isArray(ability.raw[key]) ? ability.raw[key] as BuffRef[] : []),
      ...(Array.isArray(ref.arguments[key]) ? ref.arguments[key] as BuffRef[] : []),
    ];
    if (refs.length > 0) {
      lines.push(localizedString(strings, headerKey));
      for (const buff of refs) lines.push(buffDescription(data, strings, buff, choice.activationLength, abilityScalor, context.level, context));
    }
  }

  lines.push(objectiveCFormat(localizedString(strings, "AbilityActivationLengthFormatKey"), choice.activationLength));
  const typeName = ability.path.split(".").at(-1)!;
  const commonDescription = strings[`ExtraDescription${typeName}`];
  return {
    name: choice.displayName,
    ...(commonDescription !== undefined ? { commonDescription } : {}),
    lines,
    extraDescription: lines.join("\n"),
  };
}


export function buildPassiveAbilityInfoModel(
  data: GameData,
  strings: LocalizedStrings,
  ref: JobAbilityRef,
  displayName: string,
  context: AbilityInfoContext,
): AbilityInfoModel {
  const ability = data.ability(ref.type);
  const abilityScalor = numberOr(ref.arguments["abilityScalor"], numberOr(ability.raw["abilityScalor"], 1));
  const lines: string[] = [];

  const passiveBuffs = Array.isArray(ability.raw["passiveBuffs"]) ? ability.raw["passiveBuffs"] as BuffRef[] : [];
  for (const buff of passiveBuffs) {
    const text = buffDescription(data, strings, buff, undefined, abilityScalor, context.level, context);
    if (text.length > 0) lines.push(text);
  }

  const revengeBuffs = [
    ...(Array.isArray(ability.raw["revengeBuffs"]) ? ability.raw["revengeBuffs"] as BuffRef[] : []),
    ...(Array.isArray(ref.arguments["revengeBuffs"]) ? ref.arguments["revengeBuffs"] as BuffRef[] : []),
  ];
  if (revengeBuffs.length > 0) {
    lines.push(localizedString(strings, "RevengeBuffHeaderKey"));
    for (const buff of revengeBuffs) {
      lines.push(buffDescription(data, strings, buff, undefined, abilityScalor, context.level, context));
    }
  }


  if (ref.arguments["stats"] !== undefined || ability.raw["stats"] !== undefined) {
    throw new Error(`passive ability info: provider-level stats on ${ref.type} — port the LivingProvider stat-bonus lines first`);
  }
  const priority = numberOr(
    ref.arguments["targetPriorityAdjustment"],
    numberOr(ability.raw["targetPriorityAdjustment"], 0),
  );
  if (priority >= 1) lines.push(localizedString(strings, "TauntDescriptionKey"));
  else if (priority <= -1) lines.push(localizedString(strings, "DetauntDescriptionKey"));

  if (ability.className === "AuraAbility") {
    lines.push(...auraDescriptionLines(data, strings, ref, abilityScalor, context));
  } else if (ability.className === "BerserkAbility") {
    lines.push(localizedString(strings, "BerserkAbilityDescriptionKey"));
  } else if (ability.className !== "Ability") {
    // SelfDestructAbility exists in Abilities.json but no Jobs.json leaf references it.
    throw new Error(`passive ability info: unsupported ability class ${ability.className} (${ref.type})`);
  }

  const typeName = ability.path.split(".").at(-1)!;
  const commonDescription = strings[`ExtraDescription${typeName}`];
  return {
    name: displayName,
    ...(commonDescription !== undefined ? { commonDescription } : {}),
    lines,
    extraDescription: lines.join("\n"),
  };
}


function auraDescriptionLines(
  data: GameData,
  strings: LocalizedStrings,
  ref: JobAbilityRef,
  abilityScalor: number,
  context: AbilityInfoContext,
): string[] {
  if (ref.arguments["hurt"] === true) {
    throw new Error(`passive ability info: AuraAbility ${ref.type} sets hurt:true — zero shipped carriers (buffs.md §9), not implemented`);
  }
  const types = ref.arguments["buffTypes"];
  const argsList = ref.arguments["buffArguments"];
  if (!Array.isArray(types) || !Array.isArray(argsList) || types.length !== argsList.length) return [];
  if (ref.arguments["help"] !== true) return [];
  // The desc buffs are built WITHOUT setupBuffFromLivingProvider: (unlike every other
  // description path) — nil source, so `-[Buff level]` falls back to playerBuffLevel == 1.
  const descriptions = types.map((type, i) => buffDescription(
    data,
    strings,
    { type: String(type), arguments: recordOf(argsList[i]) },
    undefined,
    abilityScalor,
    1,
    context,
  ));
  return [localizedString(strings, "AuraBuffsFriendsKey"), ...descriptions];
}
