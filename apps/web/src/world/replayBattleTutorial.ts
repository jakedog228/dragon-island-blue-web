import type { WorldArrivalResult } from "@dib/engine";
import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  showMonsterHatchPopup,
  type MonsterHatchPopupEnvironment,
} from "../ui/monsterHatchPopup.js";
import type { Popup } from "../ui/popup.js";


export const REPLAY_BATTLE_TUTORIAL_FLAG = "RevistPOI";


export function shouldShowReplayBattleTutorial(arrival: WorldArrivalResult): boolean {
  return arrival.kind === "skipped" && arrival.reason === "easy-ordinary-encounter";
}


export function showReplayBattleTutorial(
  environment: MonsterHatchPopupEnvironment,
  strings: LocalizedStrings,
): Promise<Popup> {
  const content = buildLocalizedMonsterHatchMessageContent(
    strings,
    REPLAY_BATTLE_TUTORIAL_FLAG,
  );
  content.label = "replayBattleTutorial";
  return showMonsterHatchPopup(environment, {
    title: localizedString(strings, `${REPLAY_BATTLE_TUTORIAL_FLAG}TitleKey`),
    content,
    buttons: [{
      label: localizedString(strings, "OkButtonKey"),
      onPress: () => undefined,
    }],
  });
}
