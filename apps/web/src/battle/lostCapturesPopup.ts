import { Container } from "pixi.js";
import {
  Box,
  createRenderableSpriteNode,
  makeTtfLabel,
  type AssetLibrary,
} from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { idiomPairPt } from "../displayMode.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import {
  showMonsterHatchPopup,
  type MonsterHatchPopupEnvironment,
} from "../ui/monsterHatchPopup.js";
import type { Popup } from "../ui/popup.js";
import { SCREEN_H, SCREEN_W } from "./displayShared.js";
import { lostCaptureNodeScale } from "./lostCapturesMath.js";


export interface LostCaptureEntry {
  /** `battleSpriteKey(setup)` — the same key the enemy's own battle display used. */
  readonly spriteKey: string;
  readonly rendererData?: unknown;
}


let LABEL_FONT_SIZE_PT = idiomPairPt(18, 36, DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  LABEL_FONT_SIZE_PT = idiomPairPt(18, 36, DISPLAY_MODE);
});


export async function buildLostCapturesContent(
  assets: AssetLibrary,
  strings: LocalizedStrings,
  entries: readonly LostCaptureEntry[],
): Promise<Container> {
  if (entries.length === 0) {
    throw new Error("showLostCaptures: the source returns before building any content for an empty capture list");
  }
  const row = new Box({ horizontal: true, positiveAlignDirection: true });
  row.label = "lostCapturesRow";
  for (const entry of entries) {
    const node = createRenderableSpriteNode({
      texture: await assets.sprite(entry.spriteKey),
      ...(entry.rendererData === undefined ? {} : { rendererData: entry.rendererData }),
      label: "lostCaptureMonster",
    });
    // `[node contentSize]` — authored and scale-independent in Cocos, so the fit ratios must read
    // the factory root's boundsArea rather than its already-scaled bounds.
    const authored = node.boundsArea;
    if (authored === null) {
      throw new Error("showLostCaptures: renderable root is missing its authored boundsArea");
    }
    node.scale.set(
      lostCaptureNodeScale(authored.width, authored.height, entries.length, SCREEN_W, SCREEN_H),
    );
    row.addBoxChild(node, { contentSize: { w: authored.width, h: authored.height } });
  }

  const label = makeTtfLabel(
    localizedString(strings, "CaptureLostTextKey"),
    LABEL_FONT_SIZE_PT,
    { outline: false },
  );
  label.label = "lostCapturesLabel";

  const content = new Box({ horizontal: false, positiveAlignDirection: true });
  content.label = "lostCapturesContent";
  content.addBoxChild(label);
  content.addBoxChild(row, { contentSize: row.boxContentSize });
  return content;
}


export async function showLostCapturesPopup(
  environment: MonsterHatchPopupEnvironment,
  assets: AssetLibrary,
  strings: LocalizedStrings,
  entries: readonly LostCaptureEntry[],
  onDismiss?: (popup: Popup) => void,
): Promise<Popup | undefined> {
  if (entries.length === 0) return undefined;
  const content = await buildLostCapturesContent(assets, strings, entries);
  let popup!: Popup;
  popup = await showMonsterHatchPopup(environment, {
    content,
    buttons: [{ label: localizedString(strings, "CloseButtonKey"), onPress: () => {} }],
    onDismiss: () => onDismiss?.(popup),
  });
  return popup;
}
