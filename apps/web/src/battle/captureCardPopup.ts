import { Container, Rectangle, type Ticker } from "pixi.js";
import {
  Box,
  ButtonSprite,
  makeTtfLabel,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import {
  CAPTURE_CARD_COSTS,
  captureChancePercent,
  type CaptureCardLevel,
  type CaptureStatus,
} from "@dib/engine";
import { Popup, type PopupSfxHooks } from "../ui/popup.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import type { CaptureInventorySnapshot } from "../player/playerProfile.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { captureChooserMetrics } from "./captureCardPopupMath.js";

export interface CaptureCardPopupOption {
  level: CaptureCardLevel;
  status: CaptureStatus;
  chance: number;
}

export interface CaptureCardPopupOpts {
  parent: Container;
  assets: AssetLibrary;
  scale9: Scale9SpritesData;
  ticker: Ticker;
  strings: LocalizedStrings;
  inventory: CaptureInventorySnapshot;
  options: readonly CaptureCardPopupOption[];
  onChoose: (level: CaptureCardLevel) => void;
  onCancel: () => void;
  onDismiss?: () => void;
  sfx?: PopupSfxHooks;
}

function statusText(strings: LocalizedStrings, option: CaptureCardPopupOption): string {
  if (option.status === "uncapturable") return localizedString(strings, "UncapturableKey");
  if (option.status === "alreadyTried") return localizedString(strings, "AlreadyTriedCaptureKey");
  const percent = captureChancePercent(option.chance);
  if (percent === 0) return localizedString(strings, "NotHurtEnoughKey");
  return localizedString(strings, "CaptureFormatKey")
    .replace("%d", String(percent))
    .replace("%%", "%");
}


export async function showCaptureCardPopup(opts: CaptureCardPopupOpts): Promise<Popup> {
  const metrics = captureChooserMetrics(DISPLAY_MODE);
  // The source leaves this vertical Box at its default negative Cocos/Y-up alignment direction:
  // title, then cards below it, then balances below those. Pixi's local Y axis points down, so the
  // equivalent visual enumeration advances positively here. Its three measured children are
  // exactly title, card row, and balance row; chance/cost are card children and therefore cannot
  // inflate either the row or the popup's content bounds.
  const content = new Box({ gap: metrics.boxGap, positiveAlignDirection: true });
  content.label = "captureChooserContent";



  const title = makeTtfLabel(localizedString(opts.strings, "CaptureDialogTitleKey"), 18, {
    outline: true,
  });
  title.label = "captureChooserTitle";
  content.addBoxChild(title);

  const cardRow = new Box({ horizontal: true, gap: metrics.boxGap, positiveAlignDirection: true });
  cardRow.label = "captureChooserCards";
  const inventoryAtlas = await opts.assets.atlas("InventoryItemFrames-hd");
  const spendSilver = inventoryAtlas.textures["spendSilver.png"];
  const spendGold = inventoryAtlas.textures["spendGold.png"];
  if (!spendSilver || !spendGold) throw new Error("Capture popup: missing spendSilver/spendGold frames");

  for (const option of opts.options) {
    const texture = await opts.assets.sprite(`captureCard${option.level}-hd`);
    const button = new ButtonSprite({ normalTexture: texture, userObject: option.level });
    button.label = `captureCardChoice${option.level}`;
    button.onPress(() => opts.onChoose(option.level));
    const cardWidth = button.width;
    const cardHeight = button.height;
    // Cocos CCSprite.contentSize is the card frame alone; child labels do not change it. Pixi
    // normally recurses through children for bounds, so pin the equivalent content rectangle.
    button.boundsArea = new Rectangle(0, 0, cardWidth, cardHeight);

    // Fixed-dimension CCLabelTTF (70x70 phone / 100x100 pad) centered on the graphical card.
    // CCLabelTTF's dimensioned overload is top-vertically aligned and horizontally centered.
    const statusFrame = new Container({
      boundsArea: new Rectangle(0, 0, metrics.statusSquare, metrics.statusSquare),
    });
    statusFrame.label = `captureCardStatus${option.level}`;
    statusFrame.position.set(
      (cardWidth - metrics.statusSquare) / 2,
      (cardHeight - metrics.statusSquare) / 2,
    );

    const status = makeTtfLabel(statusText(opts.strings, option), 16, {
      wordWrapWidth: metrics.statusSquare,
      align: "center",
      outline: true,
    });
    status.label = `captureCardStatusText${option.level}`;
    status.position.x = (metrics.statusSquare - status.width) / 2;
    statusFrame.addChild(status);
    button.addChild(statusFrame);

    const owned = opts.inventory.captureCards[option.level];
    const costRow = new Box({ horizontal: true, gap: metrics.boxGap, positiveAlignDirection: true });
    costRow.label = `captureCardCost${option.level}`;

    const amount = makeTtfLabel(
      String(owned > 0 ? owned : CAPTURE_CARD_COSTS[option.level].amount),
      14,
      { outline: true },
    );
    amount.label = `captureCardCostAmount${option.level}`;
    costRow.addBoxChild(amount);
    if (owned === 0) {
      const cost = CAPTURE_CARD_COSTS[option.level];
      const icon = pointSprite(cost.currency === "silver" ? spendSilver : spendGold);
      icon.label = `captureCardCostCurrency${option.level}`;
      icon.scale.set(icon.scale.x * 0.5, icon.scale.y * 0.5);
      costRow.addBoxChild(icon);
    }
    const costBounds = costRow.getLocalBounds();
    costRow.position.set(
      Math.round((cardWidth - costBounds.width) / 2 - costBounds.x),
      Math.round(cardHeight - metrics.costBottomInset - costBounds.height - costBounds.y),
    );
    button.addChild(costRow);
    cardRow.addBoxChild(button);
  }
  content.addBoxChild(cardRow);

  const balanceRow = new Box({ horizontal: true, gap: metrics.boxGap, positiveAlignDirection: true });
  balanceRow.label = "captureBalances";
  for (const [frame, amount, label, iconLabel, gapBefore] of [
    ["pileSilver.png", opts.inventory.silver, "captureSilver", "captureSilverPile", undefined],
    ["pileGold.png", opts.inventory.gold, "captureGold", "captureGoldPile", metrics.balanceCurrencyGap],
  ] as const) {
    const iconTexture = inventoryAtlas.textures[frame];
    if (!iconTexture) throw new Error(`Capture popup: missing ${frame}`);
    const icon = pointSprite(iconTexture);
    icon.label = iconLabel;
    balanceRow.addBoxChild(icon, gapBefore === undefined ? undefined : { gapBefore });



    const amountLabel = makeTtfLabel(String(amount), 14, { outline: true });
    amountLabel.label = label;
    balanceRow.addBoxChild(amountLabel);
  }
  content.addBoxChild(balanceRow);

  return Popup.show(opts.parent, {
    assets: opts.assets,
    scale9: opts.scale9,
    ticker: opts.ticker,
    content,
    buttons: [{ label: localizedString(opts.strings, "CancelButtonKey"), onPress: opts.onCancel }],
    dismissOnTap: false,
    zIndex: 1000,
    ...(opts.sfx ? { sfx: opts.sfx } : {}),
    ...(opts.onDismiss ? { onDismiss: opts.onDismiss } : {}),
  });
}
