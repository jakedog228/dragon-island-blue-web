import type { QuestDefinition } from "@dib/gamedata/browser";
import type { GuildQuestRuntime } from "@dib/engine";
import {
  localizedRenderableName,
  localizedString,
  type LocalizedStrings,
} from "../localization.js";

export function guildQuestTitle(
  strings: LocalizedStrings,
  quest: QuestDefinition,
): string {
  return localizedString(strings, `Quest${quest.name}TitleKey`);
}

export function guildQuestDescription(
  strings: LocalizedStrings,
  quest: QuestDefinition,
): string {
  return objectiveCFormat(
    localizedString(strings, `Quest${quest.name}DescriptionChatKey`),
    questDescriptionArguments(strings, quest),
  );
}

export function guildQuestProgress(
  strings: LocalizedStrings,
  runtime: GuildQuestRuntime,
  quest: QuestDefinition,
): string {
  return objectiveCFormat(
    localizedString(strings, `Quest${quest.name}ProgressKey`),
    questProgressArguments(strings, runtime, quest),
  );
}

export function questDescriptionArguments(
  strings: LocalizedStrings,
  quest: QuestDefinition,
): readonly (string | number)[] {
  const type = (name: string): string => localizedRenderableName(strings, [name]);
  switch (quest.className) {
    case "DefeatMonstersQuest":
    case "CatchMonstersQuest":
      return [...(quest.type === undefined ? [] : [type(quest.type)]), quest.quantity];
    case "GetSpiritTotemQuest":
      return [...(quest.type === undefined ? [] : [type(quest.type)]), quest.quantity];
    case "PromoteMonsterQuest":
      return [
        ...(quest.type === undefined ? [] : [type(quest.type)]),
        ...(quest.quantity >= 2 ? [quest.quantity] : []),
      ];
    case "MakeSoulstonesQuest":
    case "WinBattleQuest":
      return quest.quantity >= 2 ? [quest.quantity] : [];
    case "CombineMonstersQuest":
      return [type(quest.type1!), type(quest.type2!), quest.quantity];
    case "ClearWorldQuest":
      return [displayPercent(quest.percent), type(quest.type)];
    case "ClearDungeonQuest":
      return quest.startFloor === quest.endFloor
        ? [type(quest.type), quest.startFloor]
        : [type(quest.type), quest.startFloor, quest.endFloor];
    case "ReachDungeonFloorQuest":

      return [quest.floor, type(quest.type)];
    case "VisitTownQuest":
      return [type(quest.townName)];
    case "WinBattleListQuest":
      return [quest.battleKeys.map((key) => localizedString(strings, key)).join(", ")];
  }
}

export function questProgressArguments(
  strings: LocalizedStrings,
  runtime: GuildQuestRuntime,
  quest: QuestDefinition,
): readonly (string | number)[] {
  const data = runtime.questProgress(quest.name);
  const type = (name: string): string => localizedRenderableName(strings, [name]);
  const quantity = numeric(data["quantity"]);
  switch (quest.className) {
    case "DefeatMonstersQuest":
    case "PromoteMonsterQuest":
    case "CatchMonstersQuest":
      return [...(quest.type === undefined ? [] : [type(quest.type)]), quantity, quest.quantity];
    case "GetSpiritTotemQuest":
      // Source order is saved, target, then optional localized spirit type.
      return [quantity, quest.quantity, ...(quest.type === undefined ? [] : [type(quest.type)])];
    case "MakeSoulstonesQuest":
    case "WinBattleQuest":
      return [quantity, quest.quantity];
    case "CombineMonstersQuest":
      return [type(quest.type1!), type(quest.type2!), quantity, quest.quantity];
    case "ClearWorldQuest":
      return [
        displayPercent(numeric(data["percent"])),
        type(quest.type),
        displayPercent(quest.percent),
      ];
    case "ClearDungeonQuest": {
      if (quest.startFloor === quest.endFloor && quest.showMonsterCount) {
        return [
          type(quest.type),
          numeric(data[`monstersLeftOnFloor:${quest.startFloor}`]),
        ];
      }
      const total = quest.endFloor - quest.startFloor + 1;
      let cleared = 0;
      for (let floor = quest.startFloor; floor <= quest.endFloor; floor++) {
        if (numeric(data[`monstersLeftOnFloor:${floor}`]) === 0 &&
          data[`monstersLeftOnFloor:${floor}`] !== undefined) {
          cleared++;
        }
      }
      return [type(quest.type), cleared, total];
    }
    case "ReachDungeonFloorQuest":
      return questDescriptionArguments(strings, quest);
    case "VisitTownQuest":
      return [type(quest.townName)];
    case "WinBattleListQuest":
      return [
        quest.battleKeys.filter((key) => runtime.hasCompletedFixedEncounter(key)).length,
        quest.battleKeys.length,
      ];
  }
}

export function objectiveCFormat(
  template: string,
  values: readonly (string | number)[],
): string {
  let index = 0;
  const result = template.replace(/%%|%@|%d/g, (token) => {
    if (token === "%%") return "%";
    const value = values[index++];
    if (value === undefined) {
      throw new Error(`Quest localization "${template}" has more placeholders than arguments`);
    }
    return token === "%d" ? String(Math.trunc(Number(value))) : String(value);
  });
  if (index !== values.length) {
    throw new Error(
      `Quest localization "${template}" consumed ${index} of ${values.length} arguments`,
    );
  }
  return result;
}

function displayPercent(value: number): number {
  return Math.min(100, Math.round(Math.fround(value) * 100));
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}
