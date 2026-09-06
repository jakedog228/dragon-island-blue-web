import {
  completeSourceTutorialCatalog,
  type SourceTutorialTopic,
} from "@dib/gamedata/browser";
import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";
import { popupMenuColumns } from "../ui/popupMenuMath.js";

export const TUTORIAL_MENU_TITLE_FONT_SIZE = 25;
export const TUTORIAL_MENU_TITLE_COLOR = 0xffff88;

export type TutorialMenuEntry =
  | { readonly kind: "topic"; readonly topic: SourceTutorialTopic; readonly label: string }
  | { readonly kind: "back"; readonly label: string };

export function buildTutorialMenuModel(
  topics: readonly SourceTutorialTopic[],
  strings: LocalizedStrings,
): {
  readonly title: string;
  readonly columns: readonly (readonly TutorialMenuEntry[])[];
} {
  if (!completeSourceTutorialCatalog(topics)) {
    throw new Error("TutorialMenu requires the complete ordered Tutorial0..Tutorial8 catalog");
  }
  const entries: TutorialMenuEntry[] = [
    ...topics.map((topic): TutorialMenuEntry => ({
      kind: "topic",
      topic,
      label: localizedString(strings, topic.titleLocalizationKey),
    })),
    {
      kind: "back",
      label: localizedString(strings, "BackButtonKey"),
    },
  ];
  return {
    title: localizedString(strings, "TutorialMenuTitleKey"),
    columns: popupMenuColumns(entries, 2),
  };
}
