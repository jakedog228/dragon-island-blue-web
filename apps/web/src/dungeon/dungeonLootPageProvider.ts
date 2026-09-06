import {
  Box,
  buttonHitRectLocal,
  createRenderableSpriteNode,
  makeTtfLabel,
  OUTLINE_FADE_ALPHA,
  nearestMinimumHit,
  pointSprite,
  rectContainsPoint,
  ttfLabelSourceContentSize,
} from "@dib/renderer";
import {
  DUNGEON_GEM_STATS,
  dungeonGemBonusForStat,
  dungeonGemItemTier,
  type DungeonGemLoot,
  type DungeonLoot,
} from "@dib/engine/dungeon";
import type { StoreReceivedItem } from "@dib/player-domain";
import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  type Spritesheet,
  type Text,
  type Texture,
} from "pixi.js";
import { localizedRenderableName, localizedString } from "../localization.js";
import { Popup } from "../ui/popup.js";
import { showMonsterHatchPopup } from "../ui/monsterHatchPopup.js";
import { pagedNodePageNumberLayout } from "../ui/pagedNodeDisplayMath.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import {
  dungeonPopupEnvironment,
  type DungeonDialogContext,
} from "./dungeonDialogs.js";
import { dungeonLootDisplayMetrics } from "./dungeonDisplayMath.js";
import {
  DUNGEON_LOOT_ITEMS_PER_PAGE,
  DungeonLootPageModel,
  dungeonGemGlowAlpha,
  dungeonLootSelectionOpacity,
} from "./dungeonLootPageModel.js";




let LOOT_LAYOUT = dungeonLootDisplayMetrics(DISPLAY_MODE);
let ROUNDING_SCALE = LOOT_LAYOUT.roundingScale;
let MAIN_GAP = LOOT_LAYOUT.mainGap;
let PAGE_COLUMN_GAP = LOOT_LAYOUT.pageColumnGap;
let ROW_GAP = LOOT_LAYOUT.rowGap;
let ICON_SIDE = LOOT_LAYOUT.iconSide;
let TITLE_FONT_SIZE = LOOT_LAYOUT.titleFontSize;
let NAME_FONT_SIZE = LOOT_LAYOUT.nameFontSize;
let BONUS_VALUE_FONT_SIZE = LOOT_LAYOUT.bonusValueFontSize;
let BONUS_CELL_WIDTH = LOOT_LAYOUT.bonusCellWidth;
let BONUS_ICON_SIDE = LOOT_LAYOUT.bonusIconSide;
let PAGE_FONT_SIZE = LOOT_LAYOUT.pageFontSize;
let TAKE_ALL_FONT_SIZE = LOOT_LAYOUT.takeAllFontSize;
let POPUP_TOP_INSET = LOOT_LAYOUT.popupTopInset;
registerRuntimeSettingsRefresh(() => {
  LOOT_LAYOUT = dungeonLootDisplayMetrics(DISPLAY_MODE);
  ROUNDING_SCALE = LOOT_LAYOUT.roundingScale;
  MAIN_GAP = LOOT_LAYOUT.mainGap;
  PAGE_COLUMN_GAP = LOOT_LAYOUT.pageColumnGap;
  ROW_GAP = LOOT_LAYOUT.rowGap;
  ICON_SIDE = LOOT_LAYOUT.iconSide;
  TITLE_FONT_SIZE = LOOT_LAYOUT.titleFontSize;
  NAME_FONT_SIZE = LOOT_LAYOUT.nameFontSize;
  BONUS_VALUE_FONT_SIZE = LOOT_LAYOUT.bonusValueFontSize;
  BONUS_CELL_WIDTH = LOOT_LAYOUT.bonusCellWidth;
  BONUS_ICON_SIDE = LOOT_LAYOUT.bonusIconSide;
  PAGE_FONT_SIZE = LOOT_LAYOUT.pageFontSize;
  TAKE_ALL_FONT_SIZE = LOOT_LAYOUT.takeAllFontSize;
  POPUP_TOP_INSET = LOOT_LAYOUT.popupTopInset;
});
const DISABLED_ARROW_TINT = 0x505050;
type LootPageItem = DungeonLoot | StoreReceivedItem;

interface LootRow {
  readonly root: Container;
  readonly highlight: Graphics;
  readonly index: number;
  readonly item: LootPageItem;
  readonly contentSize: { readonly w: number; readonly h: number };
  readonly gemGlow?: Sprite;
}

interface ArrowControl {
  readonly root: Container;
  setEnabled(enabled: boolean): void;
}

















export interface DungeonLootClaim<T> {
  commit(loot: readonly T[]): void | Promise<void>;
  afterDismiss?(): void | Promise<void>;
}












export type DungeonLootTakeAll<T> =
  | ((loot: readonly T[]) => void | Promise<void>)
  | DungeonLootClaim<T>;

/**
 * Native `LootPageProvider`: a single live popup containing a one-column/four-item page display.
 * Paging rebuilds the live display in place; it does not dismiss and pop a new dialog.
 */
export async function showDungeonLootManagement(
  context: DungeonDialogContext,
  loot: readonly DungeonLoot[],
  onTakeAll: DungeonLootTakeAll<DungeonLoot>,
): Promise<void> {
  await showLootManagement(context, loot, onTakeAll);
}

/** Store checkout has already committed these Item/Gem objects. This presentation never transfers
 * them again; source Store normally leaves transfer to LootPageProvider, but authority commits at
 * command time and the local port preserves that settled boundary. */
export async function showCommittedStoreLootManagement(
  context: DungeonDialogContext,
  loot: readonly StoreReceivedItem[],
): Promise<void> {
  await showLootManagement(context, loot, () => undefined);
}

async function showLootManagement<T extends LootPageItem>(
  context: DungeonDialogContext,
  loot: readonly T[],
  onTakeAll: DungeonLootTakeAll<T>,
): Promise<void> {
  if (loot.length === 0) return;

  const [inventory, general, rightArrowTexture, takeAllTexture] = await Promise.all([
    context.game.assets.atlas("InventoryItemFrames-hd"),
    context.game.assets.atlas("General-hd"),
    context.game.assets.sprite(
      context.game.assets.hasSprite("rightArrow-hd") ? "rightArrow-hd" : "rightArrow",
    ),
    context.game.assets.sprite(
      context.game.assets.hasSprite("PopupMenuButton2-hd")
        ? "PopupMenuButton2-hd"
        : "PopupMenuButton2",
    ),
  ]);
  const model = new DungeonLootPageModel(loot);
  const rows = await Promise.all(model.items.map((item, index) =>
    buildSmallItemDisplay(context, inventory, general, item, index)));
  const pages = buildPages(rows, model.pageCount);
  const viewport = buildPageViewport(pages);
  const previous = buildArrow(rightArrowTexture, true);
  const next = buildArrow(rightArrowTexture, false);
  const takeAll = buildTakeAllButton(context, takeAllTexture);
  const controls = new Box({
    horizontal: true,
    gap: ROW_GAP,
    positiveAlignDirection: true,
    roundingScale: ROUNDING_SCALE,
  });
  controls.label = "dungeonLootControls";
  controls.addBoxChild(previous.root);
  controls.addBoxChild(horizontalSpacer(PAGE_COLUMN_GAP), {
    contentSize: { w: PAGE_COLUMN_GAP, h: 0 },
  });
  controls.addBoxChild(takeAll.root);
  controls.addBoxChild(horizontalSpacer(PAGE_COLUMN_GAP), {
    contentSize: { w: PAGE_COLUMN_GAP, h: 0 },
  });
  controls.addBoxChild(next.root);

  // Native Box advances toward -Y in Cocos' Y-up frame. The equivalent visual order in Pixi's
  // Y-down frame advances toward +Y: title, item page, then the bottom navigation/Take All row.
  const main = new Box({
    gap: MAIN_GAP,
    positiveAlignDirection: true,
    roundingScale: ROUNDING_SCALE,
  });
  main.label = "dungeonLootMain";
  const titleText = localizedString(context.game.strings, "NewItemsKey");
  const title = makeTtfLabel(titleText, TITLE_FONT_SIZE, {
    outline: true,
    outlineAlpha: OUTLINE_FADE_ALPHA,
  });
  title.label = "dungeonLootTitle";
  main.addBoxChild(title, {
    contentSize: ttfLabelSourceContentSize(titleText, TITLE_FONT_SIZE, {
      outlineAlpha: OUTLINE_FADE_ALPHA,
    }),
  });
  const viewportBounds = viewport.boundsArea;
  if (viewportBounds === null) throw new Error("Dungeon loot page viewport has no authored bounds");
  main.addBoxChild(viewport, {
    contentSize: { w: viewportBounds.width, h: viewportBounds.height },
  });
  main.addBoxChild(controls, { contentSize: controls.boxContentSize });

  const pageLayout = pagedNodePageNumberLayout(DISPLAY_MODE, main.boxContentSize);
  main.position.y = pageLayout.mainPositionY;
  const pageLabel = model.pageCount >= 3
    ? makeTtfLabel(formatPageLabel(context, model), PAGE_FONT_SIZE, {
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
      outlineWidthPt: pageLayout.outlineWidthPt,
    })
    : undefined;
  const content = composePopupContent(main, pageLabel);
  content.label = "dungeonLootPage";

  let selectionElapsedMs = 0;
  let glowElapsedMs = 0;
  // One claim for the whole display, not one per rendered control: the source has a single
  // `notifyClosing` and no command to race, so a second Take All (or a page turn under it) must be
  // refused locally rather than reaching the authority twice. Held behind a mutable box because
  // every transition happens inside a closure this function then observes.
  const claimPhase: { current: "idle" | "claiming" | "settled" } = { current: "idle" };
  const refreshSelection = (): void => {
    const alpha = dungeonLootSelectionOpacity(selectionElapsedMs);
    for (const row of rows) {
      row.highlight.alpha = row.index === model.selectedIndex ? alpha : 0;
    }
  };
  const refreshPage = (): void => {
    const live = claimPhase.current === "idle";
    pages.forEach((page, index) => { page.visible = index === model.page; });
    previous.setEnabled(live && model.canPrevious);
    next.setEnabled(live && model.canNext);
    takeAll.setEnabled(live);
    viewport.eventMode = live ? "static" : "none";
    if (pageLabel !== undefined) pageLabel.text = formatPageLabel(context, model);
    selectionElapsedMs = 0;
    refreshSelection();
  };
  const pulseTick = (): void => {
    selectionElapsedMs = (selectionElapsedMs + context.ticker.deltaMS) % 2_000;
    glowElapsedMs = (glowElapsedMs + context.ticker.deltaMS) % 2_000;
    refreshSelection();
    const glowAlpha = dungeonGemGlowAlpha(glowElapsedMs);
    for (const row of rows) {
      if (row.gemGlow !== undefined) row.gemGlow.alpha = glowAlpha;
    }
  };

  const nearestVisibleRow = (point: Readonly<{ x: number; y: number }>): LootRow | undefined => {
    const first = model.page * DUNGEON_LOOT_ITEMS_PER_PAGE;
    return nearestMinimumHit(
      rows.slice(first, first + DUNGEON_LOOT_ITEMS_PER_PAGE).map((row) => {
        const origin = viewport.toLocal(row.root.toGlobal({ x: 0, y: 0 }));
        return {
          value: row,
          contentRect: { x: origin.x, y: origin.y, w: row.contentSize.w, h: row.contentSize.h },
          ownScale: { x: 1, y: 1 },
        };
      }),
      point,
    );
  };
  // PagedNodeDisplay owns one targeted delegate and passes its current page's allNodes through
  // the shared nearest-node helper. Compact 32pt rows therefore receive the 55pt floor and can
  // overlap; resolve at the viewport instead of letting Pixi choose by reverse child order.
  viewport.eventMode = "static";
  viewport.cursor = "pointer";
  viewport.hitArea = { contains: (x, y) => nearestVisibleRow({ x, y }) !== undefined };
  viewport.on("pointertap", (event) => {
    const row = nearestVisibleRow(event.getLocalPosition(viewport));
    if (!row) return;
    event.stopPropagation();
    const action = model.select(row.index);
    selectionElapsedMs = 0;
    refreshSelection();
    if (action === "info") void showLootInfo(context, row.item);
  });
  previous.root.on("pointertap", (event) => {
    event.stopPropagation();
    if (!model.canPrevious) return;
    context.audio.playSfx("click");
    model.previous();
    refreshPage();
  });
  next.root.on("pointertap", (event) => {
    event.stopPropagation();
    if (!model.canNext) return;
    context.audio.playSfx("click");
    model.next();
    refreshPage();
  });

  const claim = typeof onTakeAll === "function" ? undefined : onTakeAll;
  const settleAfterRemoval = typeof onTakeAll === "function" ? onTakeAll : undefined;
  let popup: Popup | undefined;
  let claimRun: Promise<void> | undefined;
  let claimFailure: { readonly error: unknown } | undefined;

  /** `closePopup`'s order: settle behind the live card, then remove it. */
  const runClaim = async (live: Popup): Promise<void> => {
    try {
      if (claim !== undefined) {
        await claim.commit(model.items);
        // The one-shot is spent on the committed transition, not on the tap. A commit that never
        // answers leaves a provider the caller can still reason about.
        model.closeTakeAll();
      }
      claimPhase.current = "settled";
    } catch (error) {
      claimFailure = { error };
    }
    if (!live.isDismissed) live.dismiss();
  };

  takeAll.root.on("pointertap", (event) => {
    event.stopPropagation();
    if (claimPhase.current !== "idle") return;
    context.audio.playSfx("click");
    claimPhase.current = "claiming";
    refreshPage();
    // A tap can land during the card's 0.2s entrance, before `show` has published the handle. The
    // claim is owned by this flow either way; only the removal waits for the handle to exist.
    if (popup !== undefined) claimRun = runClaim(popup);
  });
  refreshPage();

  let resolveDismissed!: () => void;
  const dismissed = new Promise<void>((resolve) => { resolveDismissed = resolve; });
  popup = await showMonsterHatchPopup(dungeonPopupEnvironment(context), {
    content,
    hideOverlays: true,



    hidesWhenNotOnTop: false,
    topInset: POPUP_TOP_INSET,
    onPresent: () => context.ticker.add(pulseTick),
    onDismiss: () => {
      context.ticker.remove(pulseTick);
      resolveDismissed();
    },
  });
  if (claimPhase.current !== "idle" && claimRun === undefined) claimRun = runClaim(popup);
  await dismissed;
  // An external teardown can dismiss the card while a commit is still outstanding. The command is
  // already in flight; finish observing it rather than leaving an unowned promise behind.
  await claimRun;
  if (claimFailure !== undefined) throw claimFailure.error;
  if (settleAfterRemoval !== undefined) await settleAfterRemoval(model.closeTakeAll());
  else if (claimPhase.current === "settled") await claim?.afterDismiss?.();
}

function buildPages(rows: readonly LootRow[], pageCount: number): readonly Container[] {
  const pages: Container[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const column = new Box({
      gap: ROW_GAP,
      positiveAlignDirection: true,
      roundingScale: ROUNDING_SCALE,
    });
    for (const row of rows.slice(
      pageIndex * DUNGEON_LOOT_ITEMS_PER_PAGE,
      (pageIndex + 1) * DUNGEON_LOOT_ITEMS_PER_PAGE,
    )) {
      column.addBoxChild(row.root, { contentSize: row.contentSize });
    }
    const page = new Box({
      horizontal: true,
      gap: PAGE_COLUMN_GAP,
      positiveAlignDirection: true,
      roundingScale: ROUNDING_SCALE,
    });
    page.label = `dungeonLootPage:${pageIndex + 1}`;
    page.addBoxChild(column, { contentSize: column.boxContentSize });
    pages.push(page);
  }
  return Object.freeze(pages);
}

function buildPageViewport(pages: readonly Container[]): Container {
  const viewport = new Container();
  viewport.label = "dungeonLootPageViewport";
  let width = 0;
  let height = 0;
  for (const page of pages) {
    const bounds = page.getLocalBounds();
    width = Math.max(width, bounds.width);
    height = Math.max(height, bounds.height);
    viewport.addChild(page);
  }
  for (const page of pages) {
    const bounds = page.getLocalBounds();
    page.position.set((width - bounds.width) / 2 - bounds.x, (height - bounds.height) / 2 - bounds.y);
  }
  viewport.boundsArea = new Rectangle(0, 0, width, height);
  return viewport;
}

function composePopupContent(main: Box, pageLabel?: Text): Container {
  if (pageLabel === undefined) return main;
  const content = new Container();
  const pageLayout = pagedNodePageNumberLayout(DISPLAY_MODE, main.boxContentSize);
  pageLabel.label = "pagedNodeDisplay:pageNumber";
  pageLabel.anchor.set(pageLayout.anchor.x, pageLayout.anchor.y);
  pageLabel.position.set(pageLayout.position.x, pageLayout.position.y);
  content.addChild(pageLabel, main);
  content.boundsArea = new Rectangle(
    pageLayout.contentBounds.x,
    pageLayout.contentBounds.y,
    pageLayout.contentBounds.w,
    pageLayout.contentBounds.h,
  );
  return content;
}

async function buildSmallItemDisplay(
  context: DungeonDialogContext,
  inventory: Spritesheet,
  general: Spritesheet,
  item: LootPageItem,
  index: number,
): Promise<LootRow> {
  const iconSlot = new Container();
  iconSlot.boundsArea = new Rectangle(0, 0, ICON_SIDE, ICON_SIDE);
  const rendered = await buildLootRender(context, inventory, item);
  const icon = rendered.root;
  const iconBounds = icon.boundsArea;
  if (iconBounds === null || iconBounds.width <= 0 || iconBounds.height <= 0) {
    throw new Error(`Dungeon ${item.kind} loot render has no positive authored bounds`);
  }


  const fit = ICON_SIDE / Math.max(iconBounds.width, iconBounds.height);
  icon.scale.set(icon.scale.x * fit, icon.scale.y * fit);
  icon.position.set(
    (ICON_SIDE - iconBounds.width * Math.abs(icon.scale.x)) / 2,
    (ICON_SIDE - iconBounds.height * Math.abs(icon.scale.y)) / 2,
  );
  iconSlot.addChild(icon);

  const display = new Box({
    horizontal: true,
    gap: ROW_GAP,
    positiveAlignDirection: true,
    roundingScale: ROUNDING_SCALE,
  });
  display.addBoxChild(iconSlot, { contentSize: { w: ICON_SIDE, h: ICON_SIDE } });
  if (item.kind === "gem") {
    const bonuses = buildGemBonusStrip(general, item);
    display.addBoxChild(bonuses, { contentSize: bonuses.boxContentSize });
  } else {
    const nameText = dungeonLootLabel(context, item);
    const name = makeTtfLabel(nameText, NAME_FONT_SIZE, {
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    name.label = `dungeonLootName:${index}`;
    display.addBoxChild(name, {
      contentSize: ttfLabelSourceContentSize(nameText, NAME_FONT_SIZE, {
        outlineAlpha: OUTLINE_FADE_ALPHA,
      }),
    });
  }

  const size = display.boxContentSize;
  const root = new Container();
  root.label = `dungeonLootItem:${index}:${item.kind}`;
  const highlight = new Graphics().rect(0, 0, size.w, size.h).fill({ color: 0xffffff });
  highlight.label = `dungeonLootSelection:${index}`;
  highlight.alpha = 0;
  highlight.eventMode = "none";
  root.addChild(highlight, display);
  root.eventMode = "none";
  root.boundsArea = new Rectangle(0, 0, size.w, size.h);
  return Object.freeze({
    root,
    highlight,
    index,
    item,
    contentSize: size,
    ...(rendered.glow === undefined ? {} : { gemGlow: rendered.glow }),
  });
}

async function buildLootRender(
  context: DungeonDialogContext,
  inventory: Spritesheet,
  item: LootPageItem,
): Promise<{ readonly root: Container; readonly glow?: Sprite }> {
  if (item.kind === "monsterJoin") {
    const monster = context.game.gd.monsterByShortType(item.shortType);
    return {
      root: createRenderableSpriteNode({
        texture: await context.game.assets.sprite(`${item.shortType}-hd`),
        rendererData: monster.rendererData,
        label: "dungeonLootIcon:monsterJoin",
      }),
    };
  }
  if (item.kind !== "gem") {
    const frame = item.kind === "usable" || item.kind === "repeatEgg"
      ? itemDefinitionFrame(context, item.definitionPath)
      : lootFrameName(item);
    return {
      root: createRenderableSpriteNode({
        texture: requiredFrame(inventory, frame),
        label: `dungeonLootIcon:${item.kind}`,
      }),
    };
  }

  const slotName = gemSlotName(item);
  const tier = dungeonGemItemTier(item.level);
  const base = pointSprite(requiredFrame(inventory, `${slotName}Gem${tier}.png`));
  const root = new Container();
  root.label = "dungeonLootIcon:gem";
  root.sortableChildren = true;
  const width = base.width;
  const height = base.height;
  base.anchor.set(0.5);
  base.position.set(width / 2, height / 2);
  root.addChild(base);
  root.boundsArea = new Rectangle(0, 0, width, height);
  if (item.quality === 0) return { root };

  const glow = pointSprite(requiredFrame(inventory, `${slotName}GemGlow.png`));
  glow.anchor.set(0.5);
  glow.position.set(width / 2, height / 2);
  glow.tint = 0x3ff1ff;
  glow.alpha = 1;
  glow.zIndex = -1;
  glow.eventMode = "none";
  root.addChild(glow);
  return { root, glow };
}

function buildGemBonusStrip(general: Spritesheet, gem: DungeonGemLoot): Box {
  const strip = new Box({
    horizontal: true,
    gap: ROW_GAP,
    positiveAlignDirection: true,
    roundingScale: ROUNDING_SCALE,
  });
  strip.label = "dungeonLootGemBonuses";
  for (const stat of DUNGEON_GEM_STATS) {
    if (!gem.enabledStats.includes(stat)) continue;
    const cell = new Box({
      gap: ROW_GAP,
      positiveAlignDirection: true,
      roundingScale: ROUNDING_SCALE,
    });
    const iconSlot = new Container();
    iconSlot.boundsArea = new Rectangle(0, 0, BONUS_ICON_SIDE, BONUS_ICON_SIDE);
    const icon = pointSprite(requiredFrame(general, `Stat${stat}.png`));

    const fit = BONUS_ICON_SIDE / Math.max(icon.width, icon.height);
    icon.scale.set(icon.scale.x * fit, icon.scale.y * fit);
    icon.anchor.set(0.5);
    icon.position.set(BONUS_ICON_SIDE / 2, BONUS_ICON_SIDE / 2);
    iconSlot.addChild(icon);
    cell.addBoxChild(iconSlot, { contentSize: { w: BONUS_ICON_SIDE, h: BONUS_ICON_SIDE } });
    const value = makeTtfLabel(
      String(Math.round(dungeonGemBonusForStat(gem, stat))),
      BONUS_VALUE_FONT_SIZE,
      { outline: true, outlineAlpha: OUTLINE_FADE_ALPHA },
    );
    value.label = `dungeonLootGemBonusValue:${stat}`;
    cell.addBoxChild(value, {
      contentSize: ttfLabelSourceContentSize(value.text, BONUS_VALUE_FONT_SIZE, {
        outlineAlpha: OUTLINE_FADE_ALPHA,
      }),
    });

    const slot = new Container();
    const cellHeight = cell.boxContentSize.h;
    cell.position.set((BONUS_CELL_WIDTH - cell.boxContentSize.w) / 2, 0);
    slot.addChild(cell);
    slot.boundsArea = new Rectangle(0, 0, BONUS_CELL_WIDTH, cellHeight);
    strip.addBoxChild(slot, { contentSize: { w: BONUS_CELL_WIDTH, h: cellHeight } });
  }
  if (strip.children.length === 0) {
    throw new Error("Dungeon generated Gem must contain at least one enabled stat");
  }
  return strip;
}

function buildArrow(texture: Texture, flipped: boolean): ArrowControl {
  const root = new Container();
  const sprite = pointSprite(texture);
  const width = sprite.width;
  const height = sprite.height;
  sprite.anchor.set(0.5);
  sprite.position.set(width / 2, height / 2);
  if (flipped) sprite.scale.x *= -1;
  root.label = flipped ? "dungeonLootPrevious" : "dungeonLootNext";
  root.addChild(sprite);
  root.boundsArea = new Rectangle(0, 0, width, height);
  root.hitArea = minimumButtonHitArea(root, width, height);
  return {
    root,
    setEnabled(enabled: boolean): void {
      sprite.tint = enabled ? 0xffffff : DISABLED_ARROW_TINT;
      root.eventMode = enabled ? "static" : "none";
      root.cursor = enabled ? "pointer" : "default";
    },
  };
}

function horizontalSpacer(width: number): Container {
  const spacer = new Container();
  spacer.boundsArea = new Rectangle(0, 0, width, 0);
  return spacer;
}

function buildTakeAllButton(context: DungeonDialogContext, texture: Texture): ArrowControl {
  const labelText = localizedString(context.game.strings, "TakeAllKey");
  const label = makeTtfLabel(labelText, TAKE_ALL_FONT_SIZE, {
    outline: true,
    outlineAlpha: OUTLINE_FADE_ALPHA,
  });
  const background = pointSprite(texture);
  const root = new Container();
  root.label = `popupButton:${labelText}`;
  label.anchor.set(0.5);
  label.position.set(background.width / 2, background.height / 2);
  root.addChild(background, label);
  root.boundsArea = new Rectangle(0, 0, background.width, background.height);
  root.hitArea = minimumButtonHitArea(root, background.width, background.height);
  root.eventMode = "static";
  root.cursor = "pointer";
  return {
    root,
    // The source never disables Take All — it has no command to wait for. Reuse the page arrows'
    // own disabled tint rather than inventing a second idiom for the claim-in-flight state.
    setEnabled(enabled: boolean): void {
      background.tint = enabled ? 0xffffff : DISABLED_ARROW_TINT;
      label.tint = enabled ? 0xffffff : DISABLED_ARROW_TINT;
      root.eventMode = enabled ? "static" : "none";
      root.cursor = enabled ? "pointer" : "default";
    },
  };
}

function minimumButtonHitArea(
  node: Container,
  width: number,
  height: number,
): { contains(x: number, y: number): boolean } {
  return {
    contains: (x, y) => rectContainsPoint(
      buttonHitRectLocal({ w: width, h: height }, { x: node.scale.x, y: node.scale.y }),
      { x, y },
    ),
  };
}

async function showLootInfo(context: DungeonDialogContext, item: LootPageItem): Promise<void> {
  const content = new Box({
    gap: 0,
    positiveAlignDirection: true,
    roundingScale: ROUNDING_SCALE,
  });
  content.label = "dungeonLootInfo";
  const titleText = dungeonLootLabel(context, item);
  const title = makeTtfLabel(titleText, TITLE_FONT_SIZE, {
    outline: true,
    outlineAlpha: OUTLINE_FADE_ALPHA,
  });
  title.label = "dungeonLootInfoTitle";
  content.addBoxChild(title, {
    contentSize: ttfLabelSourceContentSize(titleText, TITLE_FONT_SIZE, {
      outlineAlpha: OUTLINE_FADE_ALPHA,
    }),
  });
  const description = dungeonLootDescription(context, item);
  const gemStats = item.kind === "gem"
    ? buildGemInfoStats(await context.game.assets.atlas("General-hd"), item)
    : undefined;
  if (description !== undefined || gemStats !== undefined) {
    const spacerHeight = LOOT_LAYOUT.infoSpacer;
    const spacer = new Container();
    spacer.boundsArea = new Rectangle(0, 0, 0, spacerHeight);
    content.addBoxChild(spacer, { contentSize: { w: 0, h: spacerHeight } });
    if (description !== undefined) {
      const descriptionOpts = {
        outline: true,
        outlineAlpha: OUTLINE_FADE_ALPHA,
        wordWrapWidth: 320,
        align: "center" as const,
      };
      const descriptionLabel = makeTtfLabel(
        description,
        LOOT_LAYOUT.infoDescriptionFontSize,
        descriptionOpts,
      );
      content.addBoxChild(descriptionLabel, {
        contentSize: ttfLabelSourceContentSize(
          description,
          LOOT_LAYOUT.infoDescriptionFontSize,
          descriptionOpts,
        ),
      });
    } else {
      content.addBoxChild(gemStats!, { contentSize: gemStats!.boxContentSize });
    }
  }
  let resolveDismissed!: () => void;
  const dismissed = new Promise<void>((resolve) => { resolveDismissed = resolve; });
  await Popup.show(context.parent, {
    assets: context.game.assets,
    scale9: context.game.scale9,
    ticker: context.ticker,
    content,
    buttons: [{
      label: localizedString(context.game.strings, "OkButtonKey"),
      onPress: () => undefined,
    }],
    gapBeforeButtons: LOOT_LAYOUT.infoButtonGap,
    dismissOnTap: false,
    zIndex: 1001,
    owner: context.owner,
    sfx: {
      onButtonPress: () => context.audio.playSfx("click"),
      onButtonBlocked: () => context.audio.playSfx("notAllowed"),
    },
    onDismiss: resolveDismissed,
  });
  await dismissed;
}

function buildGemInfoStats(general: Spritesheet, gem: DungeonGemLoot): Box {
  const rows = new Box({
    gap: ROW_GAP,
    positiveAlignDirection: true,
    roundingScale: ROUNDING_SCALE,
  });
  rows.label = "dungeonLootGemInfoStats";
  const iconSide = LOOT_LAYOUT.infoIconSide;
  const valueFont = LOOT_LAYOUT.infoValueFontSize;
  for (const stat of DUNGEON_GEM_STATS) {
    if (!gem.enabledStats.includes(stat)) continue;
    const row = new Box({
      horizontal: true,
      gap: ROW_GAP,
      positiveAlignDirection: true,
      roundingScale: ROUNDING_SCALE,
    });
    const iconSlot = new Container();
    iconSlot.boundsArea = new Rectangle(0, 0, iconSide, iconSide);
    const icon = pointSprite(requiredFrame(general, `Stat${stat}.png`));
    const fit = Math.min(1, iconSide / icon.width, iconSide / icon.height);
    icon.scale.set(icon.scale.x * fit, icon.scale.y * fit);
    icon.anchor.set(0.5);
    icon.position.set(iconSide / 2, iconSide / 2);
    iconSlot.addChild(icon);
    row.addBoxChild(iconSlot, { contentSize: { w: iconSide, h: iconSide } });
    row.addBoxChild(makeTtfLabel(
      String(Math.trunc(dungeonGemBonusForStat(gem, stat))),
      valueFont,
      { outline: false },
    ));
    rows.addBoxChild(row, { contentSize: row.boxContentSize });
  }
  return rows;
}

function dungeonLootDescription(
  context: DungeonDialogContext,
  item: LootPageItem,
): string | undefined {
  const key = (() => {
    switch (item.kind) {
      case "silver": return "ExtraDescriptionSilver";
      case "gold": return "ExtraDescriptionGold";
      case "recipe": return "ExtraDescriptionRecipe";
      case "spiritTotem": return "ExtraDescriptionSpiritTotem";
      case "monsterJoin":
      case "egg":
      case "monsterEgg":
      case "repeatEgg":
      case "gem":
      case "usable":
        return undefined;
    }
  })();
  return key === undefined ? undefined : localizedString(context.game.strings, key);
}

function dungeonLootLabel(context: DungeonDialogContext, item: LootPageItem): string {
  switch (item.kind) {
    case "silver":
      return formatLocalized(localizedString(context.game.strings, "RenderableSilverNameKey"), item.amount);
    case "gold":
      return formatLocalized(localizedString(context.game.strings, "RenderableGoldNameKey"), item.amount);
    case "spiritTotem":
      return formatLocalized(
        localizedString(context.game.strings, "RenderableSpiritTotemNameKey"),
        localizedRenderableName(context.game.strings, [item.shortType]),
      );
    case "recipe":
      return formatLocalized(
        localizedString(context.game.strings, "RenderableRecipeNameKey"),
        localizedRenderableName(context.game.strings, [item.combineName]),
      );
    case "egg":
      return localizedString(context.game.strings, "RenderableEggNameKey");
    case "monsterEgg":
      return localizedString(context.game.strings, "RenderableMonsterEggNameKey");
    case "repeatEgg":
      return `${localizedRenderableName(context.game.strings, [
        item.instanceName,
      ])} [${item.numRepeats} picks]`;
    case "monsterJoin":
      return localizedRenderableName(context.game.strings, [item.shortType]);
    case "gem":
      return `${localizedString(context.game.strings, `${gemSlotName(item)}SlotKey`)} ${
        localizedString(context.game.strings, `GemItemLevel${dungeonGemItemTier(item.level)}Key`)
      }`;
    case "usable":
      return localizedRenderableName(context.game.strings, [item.instanceName]);
  }
}

function lootFrameName(item: Exclude<LootPageItem, DungeonGemLoot>): string {
  switch (item.kind) {
    case "silver": return "pileSilver.png";
    case "gold": return "pileGold.png";
    case "spiritTotem": return "Item_Totem.png";
    case "recipe": return "Item_Recipe.png";
    case "egg": return "Egg.png";
    case "monsterEgg": return "MonsterEgg.png";
    case "repeatEgg":
      throw new Error("Clone Egg loot uses its Items.plist rendererData");
    case "monsterJoin":
      throw new Error("MonsterJoin loot uses its authored monster renderer, not an inventory frame");
    case "usable":
      throw new Error("Usable loot uses its Items.plist rendererData");
  }
}

function itemDefinitionFrame(context: DungeonDialogContext, definitionPath: string): string {
  const renderer = context.game.gd.item(definitionPath).rendererData as
    | { readonly spriteFrame?: unknown }
    | undefined;
  if (typeof renderer?.spriteFrame !== "string") {
    throw new Error(`Inventory item ${definitionPath} has no spriteFrame`);
  }
  return renderer.spriteFrame;
}

function gemSlotName(gem: Pick<DungeonGemLoot, "slot">):
  "Novice" | "Veteran" | "Elite" | "Grandmaster" {
  return ["Novice", "Veteran", "Elite", "Grandmaster"][gem.slot] as
    "Novice" | "Veteran" | "Elite" | "Grandmaster";
}

function formatPageLabel<T extends object>(
  context: DungeonDialogContext,
  model: DungeonLootPageModel<T>,
): string {
  let cursor = 0;
  const values = [model.page + 1, model.pageCount];
  return localizedString(context.game.strings, "PageFormatKey").replace(/%d/g, () =>
    String(values[cursor++] ?? 0));
}

function requiredFrame(sheet: Spritesheet, name: string): Texture {
  const texture = sheet.textures[name];
  if (texture === undefined) throw new Error(`InventoryItemFrames-hd is missing ${name}`);
  return texture;
}

function formatLocalized(template: string, value: string | number): string {
  const token = template.includes("%@") ? "%@" : template.includes("%d") ? "%d" : undefined;
  if (token === undefined) throw new Error(`localized dungeon format is missing a placeholder: ${template}`);
  return template.replace(token, String(value));
}
