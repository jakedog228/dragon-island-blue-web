import type { QuestDefinition } from "@dib/gamedata/browser";
import type { PresentationEventV1 } from "@dib/game-protocol";
import {
  GuildQuestRuntime,
  MAX_ACTIVE_GUILD_QUESTS,
} from "@dib/engine";
import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";
import {
  guildQuestProgress,
  guildQuestTitle,
  objectiveCFormat,
} from "./guildQuestText.js";

export interface GuildQuestNotificationState {
  readonly kind: "accepted" | "progress";
  readonly questName: string;
  readonly title: string;
  readonly message: string;
  readonly image: "Icon@2x.png";
  visible: boolean;
}


export function acceptedGuildQuestNotification(
  strings: LocalizedStrings,
  runtime: GuildQuestRuntime,
  quest: QuestDefinition,
): GuildQuestNotificationState {
  return {
    kind: "accepted",
    questName: quest.name,
    title: objectiveCFormat(
      localizedString(strings, "QuestAcceptedFormatKey"),
      [guildQuestTitle(strings, quest), runtime.activeQuestNames().length, MAX_ACTIVE_GUILD_QUESTS],
    ),
    message: localizedString(strings, "QuestStartedMessageKey"),
    image: "Icon@2x.png",
    visible: false,
  };
}


export function progressGuildQuestNotification(
  strings: LocalizedStrings,
  runtime: GuildQuestRuntime,
  quest: QuestDefinition,
): GuildQuestNotificationState {
  return {
    kind: "progress",
    questName: quest.name,
    title: objectiveCFormat(
      localizedString(strings, "QuestProgressFormatKey"),
      [guildQuestTitle(strings, quest)],
    ),
    message: guildQuestProgress(strings, runtime, quest),
    image: "Icon@2x.png",
    visible: false,
  };
}

/**
 * Convert only the server's explicit source-notification events after the authoritative quest
 * projection has been synchronized. `quest.completed` is intentionally not a second banner:
 * native completion uses the same progress notification requested by saveQuestData.
 */
export function committedGuildQuestNotifications(
  strings: LocalizedStrings,
  runtime: GuildQuestRuntime,
  events: readonly PresentationEventV1[],
): readonly GuildQuestNotificationState[] {
  return events
    .filter((event) => event.type === "quest.progressed")
    .map((event) => progressGuildQuestNotification(
      strings,
      runtimeAtCommittedProgress(runtime, event),
      runtime.catalog.requireQuest(event.questId),
    ));
}

function runtimeAtCommittedProgress(
  runtime: GuildQuestRuntime,
  event: Extract<PresentationEventV1, { type: "quest.progressed" }>,
): GuildQuestRuntime {
  const quest = runtime.catalog.requireQuest(event.questId);
  const key = quest.className === "ClearWorldQuest"
    ? "percent"
    : (
        quest.className === "DefeatMonstersQuest" ||
        quest.className === "MakeSoulstonesQuest" ||
        quest.className === "GetSpiritTotemQuest" ||
        quest.className === "PromoteMonsterQuest" ||
        quest.className === "CombineMonstersQuest" ||
        quest.className === "WinBattleQuest" ||
        quest.className === "CatchMonstersQuest"
      )
      ? "quantity"
      : undefined;
  if (key === undefined) return runtime;
  const snapshot = runtime.stateSnapshot();
  return new GuildQuestRuntime(runtime.catalog, {
    ...snapshot,
    progressByQuestName: {
      ...snapshot.progressByQuestName,
      [event.questId]: {
        ...(snapshot.progressByQuestName[event.questId] ?? {}),
        [key]: key === "percent" ? event.current / 100 : event.current,
      },
    },
  });
}
