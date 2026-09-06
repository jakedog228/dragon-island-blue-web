import type { GameData } from "@dib/gamedata/browser";
import type { OwnedSoulStoneEntry, SoulStoneSetup } from "@dib/engine";
import {
  Box,
  buttonHitRectLocal,
  makeTtfLabel,
  minimumHitRectLocal,
  nearestMinimumHit,
  OUTLINE_FADE_ALPHA,
  OUTLINE_FADE_BORDER_PT,
  placeTtfLabelInk,
  pointSprite,
  rectContainsPoint,
  ttfLabelSourceContentSize,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import {
  Container,
  Graphics,
  Rectangle,
  type Text,
  type Texture,
  type Ticker,
} from "pixi.js";
import { soulStoneSmallItemStatRows } from "../battle/soulStoneInfoMath.js";
import { dungeonLootDisplayMetrics } from "../dungeon/dungeonDisplayMath.js";
import {
  idiomPairPt,
  roundSourcePoint,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { Popup } from "../ui/popup.js";
import { pagedNodePageNumberLayout } from "../ui/pagedNodeDisplayMath.js";
import {
  buildMonsterHatchMessageBlock,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  inventoryPageLayout,
  inventoryPagedClosePosition,
} from "../player/inventoryPageLayoutMath.js";
import { LIVING_STAT_NAMES } from "../battle/infoDisplays.js";
import { PartySoulStonePickerModel } from "./partySoulStonePickerModel.js";


export const PARTY_SOUL_STONE_PICKER_Z_INDEX = 1_000;
export const PARTY_SOUL_STONE_PICKER_NESTED_Z_INDEX = 1_100;

export interface PartySoulStonePickerOptions {
  readonly parent: Container;
  readonly owner: object;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly data: GameData;
  readonly title: string;
  readonly entries: () => readonly OwnedSoulStoneEntry[];
  readonly soulStoneTextures: ReadonlyMap<string, Texture>;
  readonly statTextures: ReadonlyMap<string, Texture>;
  readonly onClick: () => void;
  readonly onBlocked: () => void;
  readonly onDrop?: (token: string) => void | Promise<void>;
  readonly onInfo: (stone: SoulStoneSetup) => void | Promise<void>;
  /**
   * One owned stone's `SmallItemDisplay` content, when the host composes it itself.
   *
   * The paged screen keeps ownership of the row wrapper, selection highlight, nearest/minimum hit
   * arbitration, and the Drop/Insert/Info actions either way — only the item's own body is
   * delegated, which is what a host carrying an item the shipped stat strip cannot describe needs.
   * Defaults to `buildPartySoulStonePickerRowDisplay`.
   */
  readonly buildRowDisplay?: (
    opts: PartySoulStonePickerOptions,
    entry: OwnedSoulStoneEntry,
  ) => Box;
}

/**
 * Source `InventoryPageProvider(type:1)` presentation used by Insert Soul Stone.
 *
 * This deliberately uses the same `PagedNodeDisplay` geometry as Gem/Items management: one
 * retained, top-aligned popup; four/five `SmallItemDisplay` rows; natural arrow/action/close
 * sprites; selection pulse; optional three-page label; and Drop/Insert actions in the bottom Box.
 */
export async function showPartySoulStonePicker(
  opts: PartySoulStonePickerOptions,
): Promise<string | null> {
  const model = new PartySoulStonePickerModel(opts.entries(), DISPLAY_MODE);
  let popup: Popup | undefined;
  let picked: string | null = null;
  let closed = false;
  let mutating = false;
  let presenting = false;
  let refreshQueued = false;
  let selectionElapsedMs = 0;
  let selectionColumn: Container | undefined;
  let selectionTicker: ((ticker: Ticker) => void) | undefined;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });

  const removeSelectionTicker = (): void => {
    if (selectionTicker === undefined) return;
    opts.ticker.remove(selectionTicker);
    selectionTicker = undefined;
  };
  const finish = (dismiss: boolean): void => {
    if (closed) return;
    closed = true;
    removeSelectionTicker();
    const live = popup;
    popup = undefined;
    if (dismiss) live?.dismiss();
    resolveClosed();
  };

  const presentPage = async (): Promise<void> => {
    if (closed) return;
    const layout = inventoryPageLayout(DISPLAY_MODE);
    const [closeTexture, arrowTexture, actionTexture] = await Promise.all([
      opts.assets.sprite("PopupMenuCloseButton-hd"),
      opts.assets.sprite("rightArrow-hd"),
      opts.assets.sprite("PopupMenuButton2-hd"),
    ]);
    if (closed) return;

    const itemColumn = new Box({
      gap: layout.itemGap,
      positiveAlignDirection: true,
      horizontalAlignment: 0,
      roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
    });
    itemColumn.label = "soulStonePicker:items";
    const liveRows: Array<{
      entry: OwnedSoulStoneEntry;
      row: PartySoulStonePickerRowBuild;
    }> = [];
    for (const entry of model.pageEntries()) {
      const row = buildPartySoulStonePickerRow(opts, entry);
      row.root.eventMode = "none";
      liveRows.push({ entry, row });
      itemColumn.addBoxChild(row.root, { contentSize: row.contentSize });
    }
    const nearestRow = (point: Readonly<{ x: number; y: number }>) => nearestMinimumHit(
      liveRows.map(({ entry, row }) => ({
        value: { entry, row },
        contentRect: {
          x: row.root.x,
          y: row.root.y,
          w: row.contentSize.w,
          h: row.contentSize.h,
        },
        ownScale: { x: 1, y: 1 },
      })),
      point,
    );
    itemColumn.eventMode = "static";
    itemColumn.cursor = "pointer";
    itemColumn.hitArea = { contains: (x, y) => nearestRow({ x, y }) !== undefined };
    itemColumn.on("pointertap", (event) => {
      if (closed || mutating || itemColumn.destroyed) return;
      const hit = nearestRow(event.getLocalPosition(itemColumn));
      if (hit === undefined) return;
      event.stopPropagation();
      if (model.select(hit.entry.token) === "info") {
        void opts.onInfo(hit.entry.stone);
        return;
      }
      selectionElapsedMs = 0;
      void refresh();
    });

    const requireSelected = async (): Promise<OwnedSoulStoneEntry | undefined> => {
      const selected = model.selectedEntry();
      if (selected === undefined) await showNamedMessage(opts, "NothingSelected");
      return selected;
    };

    const previous = buildPageArrow(arrowTexture, true, model.page > 0);
    previous.on("pointertap", async (event) => {
      event.stopPropagation();
      if (closed || mutating || !model.previous()) return;
      opts.onClick();
      await refresh();
    });
    const next = buildPageArrow(
      arrowTexture,
      false,
      model.page + 1 < model.pageCount,
    );
    next.on("pointertap", async (event) => {
      event.stopPropagation();
      if (closed || mutating || !model.next()) return;
      opts.onClick();
      await refresh();
    });
    const drop = buildPagedActionButton(
      opts,
      actionTexture,
      localizedString(opts.strings, "DropKey"),
      opts.onDrop !== undefined,
      async () => {
        if (mutating) return;
        const selected = await requireSelected();
        if (selected === undefined || opts.onDrop === undefined) return;
        if (!await confirmDrop(opts, selected)) return;
        mutating = true;
        try {
          await opts.onDrop(selected.token);
          if (closed) return;
          model.replaceEntries(opts.entries());
          await refresh();
        } finally {
          mutating = false;
        }
      },
    );
    const insert = buildPagedActionButton(
      opts,
      actionTexture,
      localizedString(opts.strings, "EquipSoulStoneKey"),
      true,
      async () => {
        if (mutating) return;
        const selected = await requireSelected();
        if (selected === undefined || closed) return;
        picked = selected.token;
        finish(true);
      },
    );
    const controls = new Box({
      horizontal: true,
      gap: layout.controlGap,
      positiveAlignDirection: true,
      roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
    });
    controls.label = "soulStonePicker:controls";
    controls.addBoxChild(previous);
    controls.addBoxChild(drop.node, {
      gapBefore: layout.controlSpacer,
      contentSize: drop.layoutContentSize,
    });
    controls.addBoxChild(insert.node, { contentSize: insert.layoutContentSize });
    controls.addBoxChild(next, { gapBefore: layout.controlSpacer });

    // PagedNodeDisplay retains an intermediate horizontal-positive columns Box even for this
    // one-column provider. Its nested item-column placement owns another native half-height
    // round before the outer main Box sees the completed columns frame.
    const columns = new Box({
      horizontal: true,
      gap: layout.controlSpacer,
      positiveAlignDirection: true,
      roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
    });
    columns.label = "soulStonePicker:columns";
    columns.addBoxChild(itemColumn, { contentSize: itemColumn.boxContentSize });
    itemColumn.position.y = -sourceHalfRoundDelta(itemColumn.boxContentSize.h);

    const main = new Box({
      gap: layout.mainGap,
      positiveAlignDirection: true,
      roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
    });
    main.label = "soulStonePicker:main";
    const title = makeTtfLabel(opts.title, layout.titleFont, {
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    title.label = "soulStonePicker:title";
    // Native outlineFadeBackgroundNode is a separate child and never enlarges the
    // CCLabelTTF.contentSize that Box packs. Pixi folds the stroke into Text bounds.
    main.addBoxChild(title, {
      contentSize: partySoulStonePickerSourceLabelContentSize(
        title,
        opts.title,
        layout.titleFont,
        "title",
        DISPLAY_MODE,
      ),
    });
    main.addBoxChild(columns, { contentSize: columns.boxContentSize });
    main.addBoxChild(controls, { contentSize: controls.boxContentSize });
    // Source positions the vertical-negative main Box at roundf(H/2). Rebasing its signed
    // authored frame to Pixi's y-down top-left retains only the conditional half-point shift.
    const pageLayout = pagedNodePageNumberLayout(DISPLAY_MODE, main.boxContentSize);
    main.position.y = pageLayout.mainPositionY;
    placeTtfLabelInk(
      title,
      title.x,
      title.y,
      unscaledIdiomPt(OUTLINE_FADE_BORDER_PT, DISPLAY_MODE),
    );

    const content = new Container();
    content.label = "soulStonePicker";
    content.boundsArea = new Rectangle(0, 0, main.boxContentSize.w, main.boxContentSize.h);
    content.addChild(main);
    const close = buildClose(closeTexture, main.boxContentSize.w, pageLayout.mainPositionY);
    close.on("pointertap", (event) => {
      event.stopPropagation();
      if (closed) return;
      opts.onClick();
      finish(true);
    });
    content.addChild(close);
    if (model.displayedPageCount >= 3) {
      const pageLabel = makeTtfLabel(
        formatPage(
          localizedString(opts.strings, "PageFormatKey"),
          model.page + 1,
          model.displayedPageCount,
        ),
        layout.actionFont,
        {
          outline: true,
          outlineAlpha: OUTLINE_FADE_ALPHA,
          outlineWidthPt: pageLayout.outlineWidthPt,
        },
      );
      pageLabel.label = "soulStonePicker:pageLabel";
      pageLabel.anchor.set(pageLayout.anchor.x, pageLayout.anchor.y);
      pageLabel.position.set(pageLayout.position.x, pageLayout.position.y);
      content.addChild(pageLabel);
    }

    if (closed) {
      content.destroy({ children: true });
      return;
    }
    if (popup !== undefined) {
      await popup.newConfiguration({ content });
      if (closed) return;
      selectionColumn = itemColumn;
      selectionElapsedMs = 0;
      return;
    }
    const created = await Popup.show(opts.parent, {
      assets: opts.assets,
      scale9: opts.scale9,
      ticker: opts.ticker,
      owner: opts.owner,
      zIndex: PARTY_SOUL_STONE_PICKER_Z_INDEX,
      content,
      topInset: layout.topInset,
      dismissOnTap: false,
      hidesWhenNotOnTop: false,
      sfx: { onButtonPress: opts.onClick, onButtonBlocked: opts.onBlocked },
      onDismiss: () => finish(false),
    });
    if (closed) {
      created.dismiss();
      return;
    }
    if (created.isDismissed) {
      finish(false);
      return;
    }
    popup = created;
    selectionColumn = itemColumn;
    selectionTicker = (ticker) => {
      const column = selectionColumn;
      if (column === undefined || column.destroyed) return;
      selectionElapsedMs = (selectionElapsedMs + ticker.deltaMS) % 2_000;
      const unit = selectionElapsedMs <= 1_000
        ? selectionElapsedMs / 1_000
        : (2_000 - selectionElapsedMs) / 1_000;
      refreshHighlights(column, model.selectedToken, unit * (100 / 255));
    };
    opts.ticker.add(selectionTicker);
  };

  const refresh = async (): Promise<void> => {
    if (closed) return;
    if (presenting) {
      refreshQueued = true;
      return;
    }
    presenting = true;
    try {
      do {
        refreshQueued = false;
        await presentPage();
      } while (refreshQueued && !closed);
    } finally {
      presenting = false;
    }
  };

  await refresh();
  if (!closed) await closedPromise;
  return picked;
}

/** Exported for layout proof; callers should present rows through `showPartySoulStonePicker`. */
export interface PartySoulStonePickerRowBuild {
  readonly root: Container;
  readonly display: Box;
  readonly contentSize: Readonly<{ w: number; h: number }>;
}

export function buildPartySoulStonePickerRow(
  opts: PartySoulStonePickerOptions,
  entry: OwnedSoulStoneEntry,
): PartySoulStonePickerRowBuild {
  const { token } = entry;
  const row = (opts.buildRowDisplay ?? buildPartySoulStonePickerRowDisplay)(opts, entry);

  // SmallItemDisplay returns a plain wrapper with the completed Box at
  // `(0, roundf(H/2))`. In the port's y-down frame the retained half-rounding moves the row's
  // visual subtree upward while its authored wrapper frame and page pitch stay unchanged.
  const root = new Container();
  const contentSize = Object.freeze({ ...row.boxContentSize });
  root.label = `stonePickerRow:${token}`;
  root.boundsArea = new Rectangle(0, 0, contentSize.w, contentSize.h);
  root.sortableChildren = true;
  row.label = `stonePickerRowDisplay:${token}`;
  row.position.y = -sourceHalfRoundDelta(contentSize.h);
  root.addChild(row);
  const highlight = new Graphics()
    .rect(0, 0, contentSize.w, contentSize.h)
    .fill({ color: 0xffffff, alpha: 1 });
  highlight.label = `stonePickerHighlight:${token}`;
  highlight.alpha = 0;
  highlight.zIndex = -1;
  root.addChild(highlight);
  return Object.freeze({ root, display: row, contentSize });
}

/**
 * The source `SmallItemDisplay` body of one owned-stone row: the item frame and its stat strip.
 *
 * Split from the wrapper above so a host can supply a different body for one item (see
 * `PartySoulStonePickerOptions.buildRowDisplay`) without restating the paged row's own contract.
 */
export function buildPartySoulStonePickerRowDisplay(
  opts: PartySoulStonePickerOptions,
  { token, stone }: OwnedSoulStoneEntry,
): Box {
  const metrics = dungeonLootDisplayMetrics(DISPLAY_MODE);
  const row = new Box({
    horizontal: true,
    gap: metrics.rowGap,
    positiveAlignDirection: true,
    roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
  });
  row.label = `stonePickerRowDisplay:${token}`;

  const itemSlot = new Container();
  itemSlot.boundsArea = new Rectangle(0, 0, metrics.iconSide, metrics.iconSide);
  const itemTexture = opts.soulStoneTextures.get(stone.element);
  if (itemTexture === undefined) {
    throw new Error(`Insert Soul Stone: missing ${stone.element} Soul Stone picker texture`);
  }
  const item = pointSprite(itemTexture);
  item.label = `stonePickerItem:${token}:${stone.element}`;
  const itemFit = metrics.iconSide / Math.max(item.width, item.height);
  item.scale.set(item.scale.x * itemFit, item.scale.y * itemFit);
  item.anchor.set(0.5);
  item.position.set(metrics.iconSide / 2, metrics.iconSide / 2);
  itemSlot.addChild(item);
  row.addBoxChild(itemSlot, { contentSize: { w: metrics.iconSide, h: metrics.iconSide } });

  const definition = opts.data.soulStoneByElement(stone.element);
  const stats = soulStoneSmallItemStatRows(stone.level, definition.enabledStats);
  if (stats.length === 0) {
    throw new Error(`Insert Soul Stone: ${stone.element} Soul Stone has no positive picker stats`);
  }
  const strip = new Box({
    horizontal: true,
    gap: metrics.rowGap,
    positiveAlignDirection: true,
    roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
  });
  for (const stat of stats) {
    const statName = LIVING_STAT_NAMES[stat.statType]!;
    const cell = new Box({
      gap: metrics.rowGap,
      positiveAlignDirection: true,
      roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
    });
    const iconSlot = new Container();
    iconSlot.boundsArea = new Rectangle(0, 0, metrics.bonusIconSide, metrics.bonusIconSide);
    const statTexture = opts.statTextures.get(statName);
    if (statTexture === undefined) {
      throw new Error(`Insert Soul Stone: General-hd is missing Stat${statName}.png`);
    }
    const icon = pointSprite(statTexture);
    const iconFit = metrics.bonusIconSide / Math.max(icon.width, icon.height);
    icon.scale.set(icon.scale.x * iconFit, icon.scale.y * iconFit);
    icon.anchor.set(0.5);
    icon.position.set(metrics.bonusIconSide / 2, metrics.bonusIconSide / 2);
    iconSlot.addChild(icon);
    cell.addBoxChild(iconSlot, {
      contentSize: { w: metrics.bonusIconSide, h: metrics.bonusIconSide },
    });
    const valueText = String(stat.value);
    const value = makeTtfLabel(valueText, metrics.bonusValueFontSize, {
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    value.label = `stonePickerStat:${token}:${statName}:${stat.value}`;
    cell.addBoxChild(value, {
      contentSize: partySoulStonePickerSourceLabelContentSize(
        value,
        valueText,
        metrics.bonusValueFontSize,
        "statValue",
        DISPLAY_MODE,
      ),
    });
    placeTtfLabelInk(
      value,
      value.x,
      value.y,
      unscaledIdiomPt(OUTLINE_FADE_BORDER_PT, DISPLAY_MODE),
    );
    const slot = new Container();
    cell.position.set(
      roundSourcePoint((metrics.bonusCellWidth - cell.boxContentSize.w) / 2, DISPLAY_MODE),
      -sourceHalfRoundDelta(cell.boxContentSize.h),
    );
    slot.addChild(cell);
    slot.boundsArea = new Rectangle(0, 0, metrics.bonusCellWidth, cell.boxContentSize.h);
    strip.addBoxChild(slot, {
      contentSize: { w: metrics.bonusCellWidth, h: cell.boxContentSize.h },
    });
  }
  row.addBoxChild(strip, { contentSize: strip.boxContentSize });
  return row;
}

function refreshHighlights(
  column: Container,
  selectedToken: string | undefined,
  selectedAlpha: number,
): void {
  for (const child of column.children) {
    if (!child.label?.startsWith("stonePickerRow:")) continue;
    const selected = child.label === `stonePickerRow:${selectedToken}`;
    const highlight = child.children.find(({ label }) => label?.startsWith("stonePickerHighlight:"));
    if (highlight !== undefined) highlight.alpha = selected ? selectedAlpha : 0;
  }
}

/** `roundf(H/2)-H/2` in source-native points, normalized back to the active port tier. */
function sourceHalfRoundDelta(height: number): number {
  return roundSourcePoint(height / 2, DISPLAY_MODE) - height / 2;
}

export type PartySoulStonePickerLabelRole = "title" | "statValue";

/**
 * Captured source `CCLabelTTF.contentSize.height`, not browser font ink/bounds.
 *
 * HSCENE prints the resulting frames as 20pt for the Paged 18pt title and 11pt for every
 * SmallItemDisplay 10pt decimal value. The underlying touchHLE/UIKit path is exactly 1.125*F:
 * 20.25/11.25 phone and 40.5/18 native iPad. Keeping the fractional source frame prevents host
 * Arial metrics from changing authored Box height and accumulating one extra point per row.
 */
export function partySoulStonePickerSourceLabelHeight(
  role: PartySoulStonePickerLabelRole,
  mode: DisplayMode,
): number {
  return role === "title"
    ? idiomPairPt(20.25, 40.5, mode)
    : idiomPairPt(11.25, 18, mode);
}

function partySoulStonePickerSourceLabelContentSize(
  label: Text,
  text: string,
  fontSizePt: number,
  role: PartySoulStonePickerLabelRole,
  mode: DisplayMode,
): Readonly<{ w: number; h: number }> {
  const browserBare = ttfLabelSourceContentSize(text, fontSizePt, {
    outlineAlpha: OUTLINE_FADE_ALPHA,
  });
  const scaleY = Math.abs(label.scale.y);
  if (!(scaleY > 0)) throw new Error("Insert Soul Stone label must have positive Y scale");
  return Object.freeze({
    w: browserBare.w,
    // Box applies the node's own scale after reading this pre-transform contentSize.
    h: partySoulStonePickerSourceLabelHeight(role, mode) / scaleY,
  });
}

function buildPageArrow(texture: Texture, flipped: boolean, enabled: boolean): Container {
  const root = new Container();
  const sprite = pointSprite(texture);
  const expected = inventoryPageLayout(DISPLAY_MODE).arrowSize;
  if (sprite.width !== expected.w || sprite.height !== expected.h) {
    throw new Error(
      `Insert Soul Stone arrow size ${sprite.width}x${sprite.height} != ${expected.w}x${expected.h}`,
    );
  }
  sprite.anchor.set(0.5);
  sprite.position.set(sprite.width / 2, sprite.height / 2);
  if (flipped) sprite.scale.x *= -1;
  sprite.tint = enabled ? 0xffffff : 0x505050;
  root.label = flipped ? "soulStonePicker:previous" : "soulStonePicker:next";
  root.boundsArea = new Rectangle(0, 0, expected.w, expected.h);
  root.hitArea = minimumAuthoredHitArea(root, { x: 0, y: 0, w: expected.w, h: expected.h });
  root.eventMode = enabled ? "static" : "none";
  root.cursor = enabled ? "pointer" : "default";
  root.addChild(sprite);
  return root;
}

function buildPagedActionButton(
  opts: PartySoulStonePickerOptions,
  texture: Texture,
  labelText: string,
  enabled: boolean,
  action: () => void | Promise<void>,
): {
  readonly node: Container;
  readonly label: Text;
  readonly layoutContentSize: { readonly w: number; readonly h: number };
} {
  const layout = inventoryPageLayout(DISPLAY_MODE);
  const background = pointSprite(texture);
  if (background.width !== layout.actionSize.w || background.height !== layout.actionSize.h) {
    throw new Error(
      `Insert Soul Stone action size ${background.width}x${background.height} != `
      + `${layout.actionSize.w}x${layout.actionSize.h}`,
    );
  }
  const label = makeTtfLabel(labelText, layout.actionFont, {
    outline: true,
    outlineAlpha: OUTLINE_FADE_ALPHA,
  });
  label.anchor.set(0.5);
  label.position.set(background.width / 2, background.height / 2);
  const node = new Container();
  node.label = `popupButton:${labelText}`;
  node.boundsArea = new Rectangle(0, 0, background.width, background.height);
  node.hitArea = minimumAuthoredHitArea(node, {
    x: 0,
    y: 0,
    w: background.width,
    h: background.height,
  });
  node.eventMode = "static";
  node.cursor = enabled ? "pointer" : "default";
  node.addChild(background, label);
  let invoking = false;
  node.on("pointertap", (event) => {
    event.stopPropagation();
    if (invoking) return;
    if (!enabled) {
      opts.onBlocked();
      return;
    }
    invoking = true;
    opts.onClick();
    let result: void | Promise<void>;
    try {
      result = action();
    } catch (error) {
      invoking = false;
      throw error;
    }
    if (result === undefined) {
      invoking = false;
      return;
    }
    void result.then(
      () => { invoking = false; },
      (error: unknown) => {
        invoking = false;
        queueMicrotask(() => { throw error; });
      },
    );
  });
  return {
    node,
    label,
    layoutContentSize: { w: background.width, h: background.height },
  };
}

function buildClose(texture: Texture, mainWidth: number, mainPositionY: number): Container {
  const layout = inventoryPageLayout(DISPLAY_MODE);
  const close = pointSprite(texture);
  if (close.width !== layout.closeSize.w || close.height !== layout.closeSize.h) {
    throw new Error(
      `Insert Soul Stone close size ${close.width}x${close.height} != `
      + `${layout.closeSize.w}x${layout.closeSize.h}`,
    );
  }
  close.anchor.set(1, 0.5);
  const bounds = close.getLocalBounds();
  close.hitArea = minimumAuthoredHitArea(close, {
    x: bounds.x,
    y: bounds.y,
    w: bounds.width,
    h: bounds.height,
  });
  const position = inventoryPagedClosePosition(DISPLAY_MODE, mainWidth, mainPositionY);
  close.position.set(position.x, position.y);
  close.label = "soulStonePicker:close";
  close.eventMode = "static";
  close.cursor = "pointer";
  return close;
}

function minimumAuthoredHitArea(
  node: Container,
  contentRect: { x: number; y: number; w: number; h: number },
): { contains(x: number, y: number): boolean } {
  return {
    contains: (x, y) => rectContainsPoint(
      contentRect.x === 0 && contentRect.y === 0
        ? buttonHitRectLocal(
          { w: contentRect.w, h: contentRect.h },
          { x: node.scale.x, y: node.scale.y },
        )
        : minimumHitRectLocal(contentRect, { x: node.scale.x, y: node.scale.y }),
      { x, y },
    ),
  };
}

async function confirmDrop(
  opts: PartySoulStonePickerOptions,
  entry: OwnedSoulStoneEntry,
): Promise<boolean> {
  let confirmed = false;
  await new Promise<void>((resolve) => {
    void showMonsterHatchPopup({
      parent: opts.parent,
      assets: opts.assets,
      scale9: opts.scale9,
      ticker: opts.ticker,
      owner: opts.owner,
      zIndex: PARTY_SOUL_STONE_PICKER_NESTED_Z_INDEX,
      sfx: { onButtonPress: opts.onClick, onButtonBlocked: opts.onBlocked },
    }, {
      title: localizedString(opts.strings, "ConfirmDropTitleFormatKey")
        .replace("%@", soulStoneName(opts, entry.stone)),
      content: buildMonsterHatchMessageBlock(
        localizedString(opts.strings, "ConfirmDropMessageKey"),
      ).root,
      buttons: [
        {
          label: localizedString(opts.strings, "YesButtonKey"),
          onPress: () => { confirmed = true; },
        },
        {
          label: localizedString(opts.strings, "NoButtonKey"),
          onPress: () => undefined,
        },
      ],
      onDismiss: () => resolve(),
    });
  });
  return confirmed;
}

async function showNamedMessage(
  opts: PartySoulStonePickerOptions,
  name: string,
): Promise<void> {
  await new Promise<void>((resolve) => {
    void showMonsterHatchPopup({
      parent: opts.parent,
      assets: opts.assets,
      scale9: opts.scale9,
      ticker: opts.ticker,
      owner: opts.owner,
      zIndex: PARTY_SOUL_STONE_PICKER_NESTED_Z_INDEX,
      sfx: { onButtonPress: opts.onClick, onButtonBlocked: opts.onBlocked },
    }, {
      title: localizedString(opts.strings, `${name}TitleKey`),
      content: buildMonsterHatchMessageBlock(
        localizedString(opts.strings, `${name}MessageKey`),
      ).root,
      buttons: [{
        label: localizedString(opts.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
      onDismiss: () => resolve(),
    });
  });
}

function soulStoneName(opts: PartySoulStonePickerOptions, stone: SoulStoneSetup): string {
  const key = `Renderable${stone.element}SoulStoneNameKey`;
  const localized = localizedString(opts.strings, key);
  return localized === key ? `${stone.element} Soul Stone` : localized;
}

function formatPage(template: string, page: number, count: number): string {
  let index = 0;
  return template.replace(/%d/g, () => String([page, count][index++] ?? 0));
}
