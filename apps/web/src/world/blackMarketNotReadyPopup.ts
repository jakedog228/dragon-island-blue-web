import { localizedString, type LocalizedStrings } from "../localization.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  showMonsterHatchPopup,
  type MonsterHatchPopupEnvironment,
} from "../ui/monsterHatchPopup.js";
import type { Popup } from "../ui/popup.js";


export const BLACK_MARKET_NOT_READY_MESSAGE_NAME = "BlackMarketLoading";

export interface BlackMarketNotReadyPopupOptions extends MonsterHatchPopupEnvironment {
  readonly strings: LocalizedStrings;
}

/**
 * Presents the source Black Market not-ready dialog.
 *
 * The class the source sends this to is `MonsterHatchPopup`, so the popup carries that family's
 * configuration — `+[MonsterHatchPopup popupConfigurationForContent:closeButtonName:...]`
 * overlays (ClerkGirl / TutorialRightSide), `+[MonsterHatchPopup popupTextConfiguration]`
 * (Arial-BoldMT, 16pt title / 14pt message, no outline, no bmLabel), and the standard modal
 * Scale9 card. That is exactly what `showMonsterHatchPopup` reproduces here; the nil
 * target/selector becomes a close button with no side effect.
 */
export function showBlackMarketNotReadyPopup(
  options: BlackMarketNotReadyPopupOptions,
): Promise<Popup> {
  const { strings, ...environment } = options;
  return showMonsterHatchPopup(environment, {
    title: localizedString(strings, `${BLACK_MARKET_NOT_READY_MESSAGE_NAME}TitleKey`),
    content: buildLocalizedMonsterHatchMessageContent(
      strings,
      BLACK_MARKET_NOT_READY_MESSAGE_NAME,
    ),
    buttons: [{
      label: localizedString(strings, "OkButtonKey"),
      onPress: () => undefined,
    }],
  });
}
