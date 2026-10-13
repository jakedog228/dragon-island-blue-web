import {
  Box,
  buttonHitRectLocal,
  makeTtfLabel,
  minimumHitRectLocal,
  nearestMinimumHit,
  OUTLINE_FADE_ALPHA,
  pointSprite,
  rectContainsPoint,
  ttfLabelSourceContentSize,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type {
  GemInventoryItem,
  GemSlot,
  InventoryItemId,
  PlayerInventoryItem,
  PlayerProfile,
  PlayerStatName,
} from "@dib/player-domain";
import { dungeonGemItemTier } from "@dib/engine/dungeon";
import {
  Container,
  Graphics,
  Rectangle,
  type Spritesheet,
  type Text,
  type Texture,
  type Ticker,
} from "pixi.js";
import type { GameData } from "@dib/gamedata/browser";
import { idiomPairPt, screenPointsForMode, unscaledIdiomPt } from "../displayMode.js";
import {
  localizedRenderableName,
  localizedString,
  type LocalizedStrings,
} from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { MONSTER_HATCH_OVERLAYS, Popup } from "../ui/popup.js";
import {
  buildMonsterHatchMessageBlock,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import { pagedNodePageNumberLayout } from "../ui/pagedNodeDisplayMath.js";
import { InventoryPageModel, type InventoryPageEntry, type InventoryPageType } from "./inventoryPageModel.js";
import {
  inventoryGemDisplayLayout,
  inventoryPageLayout,
  inventoryPagedClosePosition,
} from "./inventoryPageLayoutMath.js";

export interface InventoryManagementOptions {
  readonly parent: Container;
  readonly owner: object;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly data: GameData;
  readonly profile: PlayerProfile;
  readonly type: InventoryPageType;
  readonly title: string;
  readonly onClick: () => void;
  readonly onBlocked: () => void;
  readonly onClose: () => void;
  readonly mutate?: (
    action: "drop" | "equip" | "unequip",
    itemId: InventoryItemId,
  ) => void | Promise<void>;
}

export interface InventoryManagementHandle {
  requestClose(): void;
  readonly debugState: Record<string, unknown>;
}

/** Source `InventoryPageProvider` type 0/2 adapter. Durable identity and mutations stay in
 * PlayerInventory; the provider owns only grouping, pages, selection, info, and confirmation. */
export async function showInventoryManagement(
  opts: InventoryManagementOptions,
): Promise<InventoryManagementHandle | undefined> {
  const model = new InventoryPageModel(opts.profile.inventory, opts.type, DISPLAY_MODE);
  if (model.entries.length === 0 && model.equippedEntries.length === 0) {
    await showNamedMessage(opts, "NoInventory");
    return undefined;
  }




  let popup: Popup | undefined;
  let closed = false;
  let selectionElapsedMs = 0;
  let selectionTicker: ((ticker: Ticker) => void) | undefined;

  let selectionColumn: Container | undefined;
  /** A configuration build is in flight. */
  let presenting = false;
  /** A page/selection change arrived during a build; the model already carries it. */
  let refreshQueued = false;
  /** One durable mutation at a time, for the whole flow rather than one rendered button. Offline
   *  mutations settle within a microtask, so this is only observable under authority latency —
   *  where the alternative is a second command colliding with the one-command coordinator. */
  let mutating = false;
  // Native owns one LicenseDisplay for this PagedNodeDisplay's complete lifetime. Keep its action
  // clock outside the port's temporary presentation roots so page/mutation rebuilds cannot replay
  // the one-shot 3s hold + 1s fade.
  const licenseInstructionClock = { elapsedMs: 0 };

  /** Runs one durable mutation for the whole flow. A second intent — from this page's other action
   *  button or from a page the player turned to while a command was in flight — is refused here
   *  rather than at `CommandCoordinator.submit`, which permits only one in-flight command per slot
   *  and would reject the second with `CommandBusyError`. */
  const runMutation = async (body: () => Promise<void>): Promise<void> => {
    if (closed || mutating) return;
    mutating = true;
    try {
      await body();
    } finally {
      mutating = false;
    }
  };

  const removeSelectionTicker = (): void => {
    if (selectionTicker === undefined) return;
    opts.ticker.remove(selectionTicker);
    selectionTicker = undefined;
  };
  /** The one close path: the exact retained popup is dismissed once and the flow ends. */
  const closeFlow = (): void => {
    if (closed) return;
    closed = true;
    removeSelectionTicker();
    const live = popup;
    popup = undefined;
    live?.dismiss();
    opts.onClose();
  };

  const presentPage = async (): Promise<void> => {
    if (closed) return;
    const layout = inventoryPageLayout(DISPLAY_MODE);
    const [inventoryAtlas, general, closeTexture, rightArrowTexture, actionTexture] = await Promise.all([
      opts.assets.atlas("InventoryItemFrames-hd"),
      opts.assets.atlas("General-hd"),
      opts.assets.sprite("PopupMenuCloseButton-hd"),
      opts.assets.sprite("rightArrow-hd"),
      opts.assets.sprite("PopupMenuButton2-hd"),
    ]);
    if (closed) return;
    const itemColumn = new Box({
      gap: layout.itemGap,
      positiveAlignDirection: true,
      roundingScale: layout.roundingScale,
    });
    itemColumn.label = opts.type === 0 ? "gemInventoryItems" : "itemInventoryItems";
    let refreshSelectionControls = (): void => {};
    const liveRows: Array<{ entry: InventoryPageEntry; row: Box }> = [];
    // Equipped gems are rendered only by LicenseDisplay; they are never pager elements.
    const rows = model.pageEntries();
    for (const entry of rows) {
      const row = buildRow(opts, inventoryAtlas, general, entry);
      row.eventMode = "none";
      liveRows.push({ entry, row });
      // SmallItemDisplay returns a wrapper whose contentSize is copied from its completed Box.
      // Descendant outline ink is deliberately allowed to paint outside that authored frame.
      itemColumn.addBoxChild(row, { contentSize: row.boxContentSize });
    }
    const nearestRow = (point: Readonly<{ x: number; y: number }>) => nearestMinimumHit(
      liveRows.map(({ entry, row }) => ({
        value: { entry, row },
        contentRect: { x: row.x, y: row.y, w: row.boxContentSize.w, h: row.boxContentSize.h },
        ownScale: { x: 1, y: 1 },
      })),
      point,
    );
    itemColumn.eventMode = "static";
    itemColumn.cursor = "pointer";
    itemColumn.hitArea = { contains: (x, y) => nearestRow({ x, y }) !== undefined };
    itemColumn.on("pointertap", (event) => {
      // A pointer already in flight can still reach a page this configuration replaced.
      if (closed || mutating || itemColumn.destroyed) return;
      const hit = nearestRow(event.getLocalPosition(itemColumn));
      if (!hit) return;
      event.stopPropagation();
      if (model.select(hit.entry.id) === "info") {
        void showItemInfo(opts, hit.entry.item);
        return;
      }
      selectionElapsedMs = 0;
      refreshHighlights(itemColumn, model.selectedId, 0);
      refreshSelectionControls();
    });

    const pageText = model.pageCount >= 3
      ? formatPage(localizedString(opts.strings, "PageFormatKey"), model.page + 1, model.pageCount)
      : undefined;

    const reopen = async (): Promise<void> => {
      model.refreshAfterMutation();
      if (model.entries.length === 0 && model.equippedEntries.length === 0) {
        closeFlow();
        return;
      }
      await refresh();
    };
    const selected = (): InventoryPageEntry | undefined =>
      [...model.entries, ...model.equippedEntries].find(({ id }) => id === model.selectedId);
    const requireSelected = async (): Promise<InventoryPageEntry | undefined> => {
      const value = selected();
      if (value === undefined) await showNamedMessage(opts, "NothingSelected");
      return value;
    };
    const close = pointSprite(closeTexture);
    const expectedClose = layout.closeSize;
    if (close.width !== expectedClose.w || close.height !== expectedClose.h) {
      throw new Error(
        `PagedNodeDisplay close size ${close.width}x${close.height} != `
        + `${expectedClose.w}x${expectedClose.h}`,
      );
    }
    close.anchor.set(1, 0.5);
    const closeLocalBounds = close.getLocalBounds();
    close.hitArea = minimumAuthoredHitArea(close, {
      x: closeLocalBounds.x,
      y: closeLocalBounds.y,
      w: closeLocalBounds.width,
      h: closeLocalBounds.height,
    });
    close.label = "inventory:close";
    close.eventMode = "static";
    close.cursor = "pointer";
    close.on("pointertap", (event) => {
      event.stopPropagation();
      if (closed) return;
      opts.onClick();
      // Close stays live through a pending mutation: a command that never answers must not be able
      // to trap the player behind a modal. Its completion is discarded by the `closed` check.
      closeFlow();
    });
    const screenChildren: Array<{
      node: Container;
      x: number;
      y: number;
    }> = [];
    if (opts.type === 0) {
      const equipment = await buildLicenseDisplay(
        opts,
        inventoryAtlas,
        licenseInstructionClock,
      );
      const screen = screenPointsForMode(DISPLAY_MODE);
      const equipmentBounds = equipment.boundsArea;
      if (equipmentBounds === null) {
        throw new Error("LicenseDisplay has no authored bounds");
      }
      screenChildren.push({
        node: equipment,
        x: 0,
        y: screen.h - equipmentBounds.height,
      });
    }

    const previous = buildPageArrow(rightArrowTexture, true, model.page > 0);
    previous.on("pointertap", async (event) => {
      event.stopPropagation();
      if (closed || mutating) return;
      if (!model.previous()) return;
      opts.onClick();
      await refresh();
    });
    const next = buildPageArrow(
      rightArrowTexture,
      false,
      model.page + 1 < model.pageCount,
    );
    next.on("pointertap", async (event) => {
      event.stopPropagation();
      if (closed || mutating) return;
      if (!model.next()) return;
      opts.onClick();
      await refresh();
    });
    const drop = await buildPagedActionButton(
      opts,
      actionTexture,
      localizedString(opts.strings, "DropKey"),
      async () => {
        await runMutation(async () => {
          const entry = await requireSelected();
          if (entry === undefined) return;
          await confirmDrop(opts, entry, async () => {
            await mutate(opts, "drop", entry.id);
            await reopen();
          });
        });
      },
    );
    const equip = opts.type === 0
      ? await buildPagedActionButton(
        opts,
        actionTexture,
        localizedString(
          opts.strings,
          selected()?.equipped ? "UnequipGemKey" : "EquipGemKey",
        ),
        async () => {
          await runMutation(async () => {
            const entry = await requireSelected();
            if (entry === undefined) return;
            // Refuse the known license restriction before an Official round trip. The authority
            // still validates admitted commands; the source refusal is a local read-only popup.
            if (!entry.equipped && entry.item.kind === "gem" && entry.item.slot >= opts.profile.licenseGemSlots) {
              await showNamedMessage(opts, "NoSlotEquipFailure");
              return;
            }
            try {
              await mutate(opts, entry.equipped ? "unequip" : "equip", entry.id);
              await reopen();
            } catch (error) {
              if (error instanceof Error && /license does not allow/.test(error.message)) {
                await showNamedMessage(opts, "NoSlotEquipFailure");
                return;
              }
              throw error;
            }
          });
        },
      )
      : undefined;
    refreshSelectionControls = (): void => {
      if (equip === undefined) return;
      const labelText = localizedString(
        opts.strings,
        selected()?.equipped ? "UnequipGemKey" : "EquipGemKey",
      );
      equip.label.text = labelText;
      equip.node.label = `popupButton:${labelText}`;
    };
    refreshSelectionControls();
    const controls = new Box({
      horizontal: true,
      gap: layout.controlGap,
      positiveAlignDirection: true,
      roundingScale: layout.roundingScale,
    });
    controls.label = "inventoryControls";
    controls.addBoxChild(previous);
    // Source NSNumber children become GapNodes: they REPLACE the uniform transition gap rather
    // than contributing their width plus a default gap on both sides.
    controls.addBoxChild(drop.node, {
      gapBefore: layout.controlSpacer,
      contentSize: drop.layoutContentSize,
    });
    if (equip !== undefined) {
      controls.addBoxChild(equip.node, { contentSize: equip.layoutContentSize });
    }
    controls.addBoxChild(next, { gapBefore: layout.controlSpacer });

    const main = new Box({
      gap: layout.mainGap,
      positiveAlignDirection: true,
      roundingScale: layout.roundingScale,
    });
    main.label = "inventoryMain";
    const pageTitle = makeTtfLabel(opts.title, layout.titleFont, {
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    pageTitle.label = "inventory:title";
    main.addBoxChild(pageTitle, {
      contentSize: ttfLabelSourceContentSize(opts.title, layout.titleFont, {
        outlineAlpha: OUTLINE_FADE_ALPHA,
      }),
    });
    main.addBoxChild(itemColumn, { contentSize: itemColumn.boxContentSize });
    main.addBoxChild(controls, { contentSize: controls.boxContentSize });
    const pageLayout = pagedNodePageNumberLayout(DISPLAY_MODE, main.boxContentSize);
    main.position.y = pageLayout.mainPositionY;

    const content = new Container();
    content.label = opts.type === 0 ? "gemInventoryPage" : "itemInventoryPage";
    content.boundsArea = new Rectangle(0, 0, main.boxContentSize.w, main.boxContentSize.h);
    content.addChild(main);
    const closePosition = inventoryPagedClosePosition(
      DISPLAY_MODE,
      main.boxContentSize.w,
      pageLayout.mainPositionY,
    );
    close.position.set(closePosition.x, closePosition.y);
    content.addChild(close);
    if (pageText !== undefined) {
      const pageLabel = makeTtfLabel(pageText, idiomPairPt(14, 28, DISPLAY_MODE), {
        outline: true,
        outlineAlpha: OUTLINE_FADE_ALPHA,
        outlineWidthPt: pageLayout.outlineWidthPt,
      });
      pageLabel.label = "pagedNodeDisplay:pageNumber";
      pageLabel.anchor.set(pageLayout.anchor.x, pageLayout.anchor.y);
      pageLabel.position.set(pageLayout.position.x, pageLayout.position.y);
      content.addChild(pageLabel);
    }

    // Close/Back/disposal can also land inside the later awaits above (LicenseDisplay, action
    // buttons); never mount a presentation for a flow that has already ended.
    if (closed) return;
    if (popup !== undefined) {
      // The retained popup keeps its host-stack slot, its dim, and its full-screen input ownership
      // across this swap, and does not replay the one-time pop-in.
      await popup.newConfiguration({ content, screenChildren });
      if (closed) return;
      selectionColumn = itemColumn;
      selectionElapsedMs = 0;
      return;
    }
    const nextPopup = await Popup.show(opts.parent, {
      assets: opts.assets,
      scale9: opts.scale9,
      ticker: opts.ticker,
      content,
      dismissOnTap: false,
      owner: opts.owner,
      zIndex: 1000,
      topInset: layout.topInset,
      hidesWhenNotOnTop: false,
      sfx: { onButtonPress: opts.onClick, onButtonBlocked: opts.onBlocked },
      screenChildren,
      // One instance now serves the whole presentation, so its dismissal — ours, an owner
      // disposal, or a host `dismissTop` — always ends the flow. Our own `closeFlow` sets `closed`
      // before dismissing, so this only runs for a dismissal the flow did not initiate.
      onDismiss: () => {
        if (closed) return;
        closed = true;
        popup = undefined;
        removeSelectionTicker();
        opts.onClose();
      },
    });
    // Close, Back, an owner disposal, or a host dismissal can all land during the 200 ms entrance,
    // before this assignment exists to be dismissed or checked.
    if (closed) {
      nextPopup.dismiss();
      return;
    }
    if (nextPopup.isDismissed) {
      closed = true;
      opts.onClose();
      return;
    }
    popup = nextPopup;
    selectionColumn = itemColumn;
    selectionElapsedMs = 0;
    // One ticker for the flow. Native's SelectionNode pulse belongs to the persistent display, not
    // to a page, so it is registered once here and removed once by `closeFlow`.
    selectionTicker = (ticker) => {
      const column = selectionColumn;
      if (column === undefined || column.destroyed) return;
      selectionElapsedMs = (selectionElapsedMs + ticker.deltaMS) % 2_000;
      const unit = selectionElapsedMs <= 1_000
        ? selectionElapsedMs / 1_000
        : (2_000 - selectionElapsedMs) / 1_000;
      refreshHighlights(column, model.selectedId, unit * (100 / 255));
    };
    opts.ticker.add(selectionTicker);
  };

  /** Serializes presentation. The model mutation behind a page turn is synchronous, exactly as
   *  `nextPage:`/`previousPage:` are, so rapid taps still advance page-by-page; only the rebuild
   *  coalesces onto the latest state instead of overlapping. */
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
  // An early Close/Back/host dismissal during the initial entrance ends the flow before it ever
  // became visible to the caller. Publishing a handle here would leave callers holding a closed
  // reference that still reads as an open modal (`WorldNode.hasModal`).
  if (closed) return undefined;
  return {
    requestClose(): void {
      closeFlow();
    },
    get debugState(): Record<string, unknown> {
      return {
        open: !closed,
        type: opts.type,
        page: model.page,
        pageCount: model.pageCount,
        selectedId: model.selectedId ?? null,
        entries: model.pageEntries().map(({ id, item, count }) => ({
          id,
          kind: item.kind,
          instanceName: item.instanceName,
          count,
        })),
        equipped: model.equippedEntries.map(({ id }) => id),
      };
    },
  };
}

function buildPageArrow(texture: Texture, flipped: boolean, enabled: boolean): Container {
  const root = new Container();
  const sprite = pointSprite(texture);
  const width = sprite.width;
  const height = sprite.height;
  const expected = inventoryPageLayout(DISPLAY_MODE).arrowSize;
  if (width !== expected.w || height !== expected.h) {
    throw new Error(`PagedNodeDisplay arrow size ${width}x${height} != ${expected.w}x${expected.h}`);
  }
  sprite.anchor.set(0.5);
  sprite.position.set(width / 2, height / 2);
  if (flipped) sprite.scale.x *= -1;
  sprite.tint = enabled ? 0xffffff : 0x505050;
  root.label = flipped ? "inventory:previous" : "inventory:next";
  root.boundsArea = new Rectangle(0, 0, width, height);
  root.hitArea = minimumButtonHitArea(root, width, height);
  root.eventMode = enabled ? "static" : "none";
  root.cursor = enabled ? "pointer" : "default";
  root.addChild(sprite);
  return root;
}

async function buildPagedActionButton(
  opts: InventoryManagementOptions,
  texture: Texture,
  labelText: string,
  action: () => void | Promise<void>,
): Promise<{
  readonly node: Container;
  readonly label: Text;
  readonly layoutContentSize: { readonly w: number; readonly h: number };
}> {
  const label = makeTtfLabel(labelText, inventoryPageLayout(DISPLAY_MODE).actionFont, {
    outline: true,
    outlineAlpha: OUTLINE_FADE_ALPHA,
  });
  const background = pointSprite(texture);
  const layoutContentSize = { w: background.width, h: background.height };
  const expected = inventoryPageLayout(DISPLAY_MODE).actionSize;
  if (background.width !== expected.w || background.height !== expected.h) {
    throw new Error(
      `PagedNodeDisplay action size ${background.width}x${background.height} != `
      + `${expected.w}x${expected.h}`,
    );
  }
  label.anchor.set(0.5);
  label.position.set(background.width / 2, background.height / 2);
  const node = new Container();
  node.addChild(background, label);
  node.boundsArea = new Rectangle(0, 0, background.width, background.height);
  node.hitArea = minimumButtonHitArea(node, background.width, background.height);
  node.label = `popupButton:${labelText}`;
  node.eventMode = "static";
  node.cursor = "pointer";
  let invoking = false;
  node.on("pointertap", (event) => {
    event.stopPropagation();
    if (invoking) return;
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
    // Observe the rejection instead of discarding a `.finally` chain that would surface as an
    // unhandled rejection. Same policy as `Popup.buildButtonRow`'s buttons: restore the control,
    // then rethrow out of band so a real failure stays loud.
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
    layoutContentSize,
  };
}

function minimumButtonHitArea(
  node: Container,
  width: number,
  height: number,
): { contains(x: number, y: number): boolean } {
  return minimumAuthoredHitArea(node, { x: 0, y: 0, w: width, h: height });
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

async function buildLicenseDisplay(
  opts: InventoryManagementOptions,
  inventoryAtlas: Spritesheet,
  instructionClock: { elapsedMs: number },
): Promise<Container> {
  const backgroundTexture = await opts.assets.sprite(
    DISPLAY_MODE === "ipad"
      ? "HeroEquipmentBackground-ipadhd"
      : "HeroEquipmentBackground-hd",
  );
  const background = pointSprite(backgroundTexture);
  const root = new Container();
  root.label = "licenseDisplay";
  root.boundsArea = new Rectangle(0, 0, background.width, background.height);
  root.addChild(background);

  const phone = [
    { x: 53, y: 3 },
    { x: 169, y: 3 },
    { x: 286, y: 3 },
    { x: 402, y: 3 },
  ] as const;
  const ipad = [
    { x: 58, y: 4.5 },
    { x: 180.5, y: 4.5 },
    { x: 306.5, y: 4.5 },
    { x: 430, y: 4 },
  ] as const;
  const positions = DISPLAY_MODE === "ipad" ? ipad : phone;
  for (let slot = 0; slot < positions.length; slot += 1) {
    const gem = opts.profile.inventory.gemInSlot(slot as GemSlot);
    if (gem === undefined) continue;
    const icon = buildGemNodeStack(inventoryAtlas, gem);
    const stackScale = inventoryGemDisplayLayout(DISPLAY_MODE).equipmentScale;
    icon.scale.set(stackScale);
    const bounds = icon.boundsArea;
    if (bounds === null) throw new Error("GemNodeStack is missing authored bounds");
    icon.position.set(
      positions[slot]!.x,
      background.height - positions[slot]!.y - bounds.height * stackScale,
    );
    icon.label = `licenseDisplay:slot:${slot}`;
    root.addChild(icon);
  }

  const instruction = makeTtfLabel(
    localizedString(opts.strings, "LicenseScreenTextKey"),
    idiomPairPt(20, 40, DISPLAY_MODE),
    { outline: true },
  );
  instruction.anchor.set(0.5, 1);
  instruction.position.set(
    background.width / 2,
    background.height - idiomPairPt(10, 20, DISPLAY_MODE),
  );
  instruction.label = "licenseDisplay:instruction";
  const instructionTiming = inventoryGemDisplayLayout(DISPLAY_MODE);
  instruction.alpha = instructionClock.elapsedMs <= instructionTiming.instructionHoldMs
    ? 1
    : Math.max(
      0,
      1 - (instructionClock.elapsedMs - instructionTiming.instructionHoldMs) /
        instructionTiming.instructionFadeMs,
    );
  root.addChild(instruction);
  const fadeInstruction = (ticker: Ticker): void => {
    if (root.destroyed) {
      opts.ticker.remove(fadeInstruction);
      return;
    }
    if (
      instructionClock.elapsedMs >=
      instructionTiming.instructionHoldMs + instructionTiming.instructionFadeMs
    ) {
      instruction.alpha = 0;
      opts.ticker.remove(fadeInstruction);
      return;
    }
    instructionClock.elapsedMs += ticker.deltaMS;
    if (instructionClock.elapsedMs <= instructionTiming.instructionHoldMs) return;
    instruction.alpha = Math.max(
      0,
      1 - (instructionClock.elapsedMs - instructionTiming.instructionHoldMs) /
        instructionTiming.instructionFadeMs,
    );
    if (
      instructionClock.elapsedMs >=
      instructionTiming.instructionHoldMs + instructionTiming.instructionFadeMs
    ) {
      opts.ticker.remove(fadeInstruction);
      instruction.alpha = 0;
    }
  };
  if (instruction.alpha > 0) opts.ticker.add(fadeInstruction);
  return root;
}

async function mutate(
  opts: InventoryManagementOptions,
  action: "drop" | "equip" | "unequip",
  id: InventoryItemId,
): Promise<void> {
  if (opts.mutate !== undefined) {
    await opts.mutate(action, id);
    return;
  }
  if (action === "drop") opts.profile.inventory.drop(id);
  else if (action === "equip") opts.profile.equipGem(id);
  else opts.profile.unequipGem(id);
}

function buildRow(
  opts: InventoryManagementOptions,
  inventoryAtlas: Spritesheet,
  general: Spritesheet,
  entry: InventoryPageEntry,
): Box {
  const row = new Box({
    horizontal: true,
    gap: idiomPairPt(5, 10, DISPLAY_MODE),
    positiveAlignDirection: true,
    roundingScale: inventoryPageLayout(DISPLAY_MODE).roundingScale,
  });
  row.label = `inventoryItem:${entry.id}`;
  const iconSlot = new Container();
  const side = inventoryGemDisplayLayout(DISPLAY_MODE).rowIconSide;
  iconSlot.boundsArea = new Rectangle(0, 0, side, side);
  const icon = pointSprite(itemTexture(opts, inventoryAtlas, entry.item));
  const fit = Math.min(1, side / icon.width, side / icon.height);
  icon.scale.set(icon.scale.x * fit, icon.scale.y * fit);
  icon.anchor.set(0.5);
  icon.position.set(side / 2, side / 2);
  iconSlot.addChild(icon);
  row.addBoxChild(iconSlot, { contentSize: { w: side, h: side } });

  if (entry.item.kind === "gem") {
    const bonuses = buildGemBonusStrip(general, entry.item);
    row.addBoxChild(bonuses, { contentSize: bonuses.boxContentSize });
  } else {
    const labelText = `${itemName(opts, entry.item)}${entry.count > 1 ? ` x${entry.count}` : ""}`;
    const label = makeTtfLabel(
      labelText,
      idiomPairPt(14, 20, DISPLAY_MODE),
      { outline: true, outlineAlpha: OUTLINE_FADE_ALPHA },
    );
    row.addBoxChild(label, {
      contentSize: ttfLabelSourceContentSize(
        labelText,
        idiomPairPt(14, 20, DISPLAY_MODE),
        { outlineAlpha: OUTLINE_FADE_ALPHA },
      ),
    });
  }
  const highlight = new Graphics()
    .rect(0, 0, row.boxContentSize.w, row.boxContentSize.h)
    // SelectionNode flashes the completed white rectangle by changing node opacity. The paint
    // itself must stay opaque: a zero-alpha fill multiplied by a changing container alpha can
    // never become visible.
    .fill({ color: 0xffffff, alpha: 1 });
  highlight.label = `inventoryHighlight:${entry.id}`;
  highlight.alpha = 0;
  highlight.zIndex = -1;
  row.sortableChildren = true;
  row.addChild(highlight);
  return row;
}

function refreshHighlights(
  content: Container,
  selectedId: string | undefined,
  selectedAlpha: number,
): void {
  for (const child of content.children) {
    if (!(child instanceof Box) || !child.label?.startsWith("inventoryItem:")) continue;
    const selected = child.label === `inventoryItem:${selectedId}`;
    const highlight = child.children.find(({ label }) => label?.startsWith("inventoryHighlight:"));
    if (highlight !== undefined) highlight.alpha = selected ? selectedAlpha : 0;
  }
}

function buildGemNodeStack(
  inventoryAtlas: Spritesheet,
  gem: GemInventoryItem,
): Container {
  const base = pointSprite(itemTextureFromAtlas(inventoryAtlas, gem));
  const root = new Container();
  root.sortableChildren = true;
  root.boundsArea = new Rectangle(0, 0, base.width, base.height);
  root.addChild(base);
  if (gem.quality > 0) {
    const glowTexture = inventoryAtlas.textures[`${gemSlotName(gem)}GemGlow.png`];
    if (glowTexture === undefined) {
      throw new Error(`InventoryItemFrames-hd is missing ${gemSlotName(gem)}GemGlow.png`);
    }
    const glow = pointSprite(glowTexture);
    glow.anchor.set(0.5);
    glow.position.set(base.width / 2, base.height / 2);
    glow.tint = 0x3ff1ff;
    glow.zIndex = -1;
    root.addChild(glow);
  }
  return root;
}

function buildGemBonusStrip(general: Spritesheet, gem: GemInventoryItem): Box {
  const gap = unscaledIdiomPt(5, DISPLAY_MODE);
  const gemLayout = inventoryGemDisplayLayout(DISPLAY_MODE);
  const iconSide = gemLayout.rowStatIconSide;
  const valueFont = gemLayout.rowValueFont;
  const roundingScale = inventoryPageLayout(DISPLAY_MODE).roundingScale;
  const strip = new Box({ horizontal: true, gap, positiveAlignDirection: true, roundingScale });
  for (const stat of gem.enabledStats) {
    const cell = new Box({ gap, positiveAlignDirection: true, roundingScale });
    const iconSlot = new Container();
    iconSlot.boundsArea = new Rectangle(0, 0, iconSide, iconSide);
    const texture = general.textures[`Stat${stat}.png`];
    if (texture === undefined) throw new Error(`General-hd is missing Stat${stat}.png`);
    const icon = pointSprite(texture);
    const fit = iconSide / Math.max(icon.width, icon.height);
    icon.scale.set(icon.scale.x * fit, icon.scale.y * fit);
    icon.anchor.set(0.5);
    icon.position.set(iconSide / 2, iconSide / 2);
    iconSlot.addChild(icon);
    cell.addBoxChild(iconSlot, { contentSize: { w: iconSide, h: iconSide } });
    const valueText = String(Math.round(gemBonus(gem, stat)));
    const value = makeTtfLabel(
      valueText,
      valueFont,
      { outline: true, outlineAlpha: OUTLINE_FADE_ALPHA },
    );
    value.label = `inventoryGemBonusValue:${stat}`;
    cell.addBoxChild(value, {
      contentSize: ttfLabelSourceContentSize(valueText, valueFont, {
        outlineAlpha: OUTLINE_FADE_ALPHA,
      }),
    });
    const slot = new Container();
    slot.boundsArea = new Rectangle(0, 0, iconSide, cell.boxContentSize.h);
    cell.position.set((iconSide - cell.boxContentSize.w) / 2, 0);
    slot.addChild(cell);
    strip.addBoxChild(slot, { contentSize: { w: iconSide, h: cell.boxContentSize.h } });
  }
  if (strip.children.length === 0) {
    throw new Error(`Gem ${gem.id} has no enabled stats`);
  }
  return strip;
}

function itemTexture(
  opts: InventoryManagementOptions,
  inventoryAtlas: Spritesheet,
  item: PlayerInventoryItem,
) {
  const frame = item.kind === "gem"
    ? `${gemSlotName(item)}Gem${dungeonGemItemTier(item.level)}.png`
    : rendererFrame(opts, item);
  const texture = inventoryAtlas.textures[frame];
  if (texture === undefined) throw new Error(`InventoryItemFrames-hd is missing ${frame}`);
  return texture;
}

function itemTextureFromAtlas(inventoryAtlas: Spritesheet, gem: GemInventoryItem): Texture {
  const frame = `${gemSlotName(gem)}Gem${dungeonGemItemTier(gem.level)}.png`;
  const texture = inventoryAtlas.textures[frame];
  if (texture === undefined) throw new Error(`InventoryItemFrames-hd is missing ${frame}`);
  return texture;
}

function gemBonus(gem: GemInventoryItem, stat: PlayerStatName): number {
  return gem.level * (stat === "Defense" || stat === "Resist" ? 1.5 : 1);
}

function rendererFrame(opts: InventoryManagementOptions, item: PlayerInventoryItem): string {
  const renderer = opts.data.item(item.definitionPath).rendererData as
    | { readonly spriteFrame?: unknown }
    | undefined;
  if (typeof renderer?.spriteFrame !== "string") {
    throw new Error(`Inventory item ${item.definitionPath} has no spriteFrame`);
  }
  return renderer.spriteFrame;
}

function itemName(opts: InventoryManagementOptions, item: PlayerInventoryItem): string {
  if (item.kind === "gem") {
    return `${localizedString(opts.strings, `${gemSlotName(item)}SlotKey`)} ${
      localizedString(opts.strings, `GemItemLevel${dungeonGemItemTier(item.level)}Key`)
    }`;
  }
  return localizedRenderableName(opts.strings, [
    item.instanceName,
    item.definitionPath.slice(item.definitionPath.lastIndexOf(".") + 1),
  ]);
}

function gemSlotName(gem: Pick<GemInventoryItem, "slot">):
  "Novice" | "Veteran" | "Elite" | "Grandmaster" {
  return ["Novice", "Veteran", "Elite", "Grandmaster"][gem.slot] as
    "Novice" | "Veteran" | "Elite" | "Grandmaster";
}

async function showItemInfo(
  opts: InventoryManagementOptions,
  item: PlayerInventoryItem,
): Promise<void> {
  const roundingScale = inventoryPageLayout(DISPLAY_MODE).roundingScale;
  const content = new Box({ gap: 0, positiveAlignDirection: true, roundingScale });
  content.label = "inventoryItemInfo";
  const title = makeTtfLabel(itemName(opts, item), idiomPairPt(18, 36, DISPLAY_MODE), {
    outline: true,
    outlineAlpha: OUTLINE_FADE_ALPHA,
  });
  title.label = "inventoryItemInfo:title";
  content.addBoxChild(title, {
    contentSize: ttfLabelSourceContentSize(
      itemName(opts, item),
      idiomPairPt(18, 36, DISPLAY_MODE),
      { outlineAlpha: OUTLINE_FADE_ALPHA },
    ),
  });
  if (item.kind === "gem") {
    const spacer = new Container();
    const spacerHeight = idiomPairPt(10, 20, DISPLAY_MODE);
    spacer.boundsArea = new Rectangle(0, 0, 0, spacerHeight);
    content.addBoxChild(spacer, { contentSize: { w: 0, h: spacerHeight } });
    const stats = await buildGemInfoStats(opts, item);
    content.addBoxChild(stats, { contentSize: stats.boxContentSize });
  }
  await Popup.show(opts.parent, {
    assets: opts.assets,
    scale9: opts.scale9,
    ticker: opts.ticker,
    owner: opts.owner,
    zIndex: 1100,
    content,
    gapBeforeButtons: unscaledIdiomPt(40, DISPLAY_MODE),
    dismissOnTap: false,
    overlays: MONSTER_HATCH_OVERLAYS,
    sfx: { onButtonPress: opts.onClick, onButtonBlocked: opts.onBlocked },
    buttons: [{
      label: localizedString(opts.strings, "OkButtonKey"),
      onPress: () => undefined,
    }],
  });
}

async function buildGemInfoStats(
  opts: InventoryManagementOptions,
  gem: GemInventoryItem,
): Promise<Box> {
  const general = await opts.assets.atlas("General-hd");
  const gap = unscaledIdiomPt(5, DISPLAY_MODE);
  const gemLayout = inventoryGemDisplayLayout(DISPLAY_MODE);
  const slotHeight = gemLayout.infoStatIconSide;
  const roundingScale = inventoryPageLayout(DISPLAY_MODE).roundingScale;
  const icons = new Box({ gap, positiveAlignDirection: true, roundingScale });
  const values = new Box({ gap, positiveAlignDirection: true, roundingScale });
  for (const stat of gem.enabledStats) {
    const iconSlot = new Container();
    iconSlot.boundsArea = new Rectangle(0, 0, slotHeight, slotHeight);
    const texture = general.textures[`Stat${stat}.png`];
    if (texture === undefined) throw new Error(`General-hd is missing Stat${stat}.png`);
    const icon = pointSprite(texture);
    const fit = slotHeight / Math.max(icon.width, icon.height);
    icon.scale.set(icon.scale.x * fit, icon.scale.y * fit);
    icon.anchor.set(0.5);
    icon.position.set(slotHeight / 2, slotHeight / 2);
    iconSlot.addChild(icon);
    icons.addBoxChild(iconSlot, { contentSize: { w: slotHeight, h: slotHeight } });

    const valueSlot = new Container();
    valueSlot.boundsArea = new Rectangle(0, 0, 0, slotHeight);
    const value = makeTtfLabel(
      String(Math.trunc(gemBonus(gem, stat))),
      gemLayout.infoValueFont,
      { outline: false },
    );
    value.anchor.set(0, 0.5);
    value.position.set(0, slotHeight / 2);
    valueSlot.addChild(value);
    valueSlot.boundsArea = new Rectangle(0, 0, value.width, slotHeight);
    values.addBoxChild(valueSlot, { contentSize: { w: value.width, h: slotHeight } });
  }
  const root = new Box({ horizontal: true, gap, positiveAlignDirection: true, roundingScale });
  root.addBoxChild(icons, { contentSize: icons.boxContentSize });
  root.addBoxChild(values, { contentSize: values.boxContentSize });
  return root;
}

async function confirmDrop(
  opts: InventoryManagementOptions,
  entry: InventoryPageEntry,
  onConfirm: () => void | Promise<void>,
): Promise<void> {
  const title = localizedString(opts.strings, "ConfirmDropTitleFormatKey")
    .replace("%@", itemName(opts, entry.item));
  const content = buildMonsterHatchMessageBlock(
    localizedString(opts.strings, "ConfirmDropMessageKey"),
  ).root;
  await showMonsterHatchPopup({
    parent: opts.parent,
    assets: opts.assets,
    scale9: opts.scale9,
    ticker: opts.ticker,
    owner: opts.owner,
    zIndex: 1100,
    sfx: { onButtonPress: opts.onClick, onButtonBlocked: opts.onBlocked },
  }, {
    title,
    content,
    buttons: [
      {
        label: localizedString(opts.strings, "YesButtonKey"),
        onPress: onConfirm,
      },
      {
        label: localizedString(opts.strings, "NoButtonKey"),
        onPress: () => undefined,
      },
    ],
  });
}

async function showNamedMessage(opts: InventoryManagementOptions, name: string): Promise<void> {
  await showMonsterHatchPopup({
    parent: opts.parent,
    assets: opts.assets,
    scale9: opts.scale9,
    ticker: opts.ticker,
    owner: opts.owner,
    zIndex: 1100,
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
  });
}

function formatPage(template: string, page: number, count: number): string {
  let index = 0;
  return template.replace(/%d/g, () => String([page, count][index++] ?? 0));
}
