import type { Container, Ticker } from "pixi.js";
import type { AssetLibrary, Scale9SpritesData } from "@dib/renderer";
import { localizedString, type LocalizedStrings } from "../localization.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";

export interface MainMenuConfirmationOptions {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly owner?: object;
  readonly onClick: () => void;
  readonly onConfirm: () => void | Promise<void>;
}


export async function showMainMenuConfirmation(
  options: MainMenuConfirmationOptions,
): Promise<void> {
  await showMonsterHatchPopup({
    parent: options.parent,
    assets: options.assets,
    scale9: options.scale9,
    ticker: options.ticker,
    ...(options.owner === undefined ? {} : { owner: options.owner }),
    zIndex: 90,
    sfx: { onButtonPress: options.onClick },
  }, {
    title: localizedString(options.strings, "MainMenuWarningTitleKey"),
    content: buildLocalizedMonsterHatchMessageContent(options.strings, "MainMenuWarning"),
    runScaleAction: false,
    buttons: [
      {
        label: localizedString(options.strings, "YesButtonKey"),
        // The confirmed app restart destroys the owning scene and therefore this popup.
        closesPopup: false,
        onPress: options.onConfirm,
      },
      {
        label: localizedString(options.strings, "NoButtonKey"),
        onPress: () => {},
      },
    ],
  });
}
