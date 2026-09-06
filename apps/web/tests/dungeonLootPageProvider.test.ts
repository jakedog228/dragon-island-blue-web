import { Container, Texture, type Text } from "pixi.js";
import { Box, ttfLabelSourceContentSize } from "@dib/renderer";
import { describe, expect, it, vi } from "vitest";
import { replayableRng } from "@dib/engine";
import type { DungeonLoot } from "@dib/engine/dungeon";
import {
  PlayerProfile,
  purchaseStoreStock,
  SOURCE_STORE_GEM_STOCK,
  SOURCE_STORE_USABLE_STOCK,
} from "@dib/player-domain";
import {
  DUNGEON_LOOT_COLUMNS,
  DUNGEON_LOOT_ITEMS_PER_PAGE,
  DungeonLootPageModel,
  dungeonGemGlowAlpha,
  dungeonLootSelectionOpacity,
} from "../src/dungeon/dungeonLootPageModel.js";
import {
  showCommittedStoreLootManagement,
  showDungeonLootManagement,
} from "../src/dungeon/dungeonLootPageProvider.js";
import type { DungeonDialogContext } from "../src/dungeon/dungeonDialogs.js";
import { dungeonLootDisplayMetrics } from "../src/dungeon/dungeonDisplayMath.js";
import { roundSourcePoint } from "../src/displayMode.js";
import { DISPLAY_MODE } from "../src/runtimeSettings.js";

const popupCapture = vi.hoisted(() => ({ content: undefined as Container | undefined }));

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
  Object.defineProperty(globalThis, "CanvasRenderingContext2D", {
    configurable: true,
    value: class CanvasRenderingContext2D {},
  });
  const context2d = {
    font: "",
    measureText: () => ({
      width: 40,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 40,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 2,
    }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    clearRect: () => undefined,
    fillText: () => undefined,
    strokeText: () => undefined,
    scale: () => undefined,
    setTransform: () => undefined,
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        width: 1,
        height: 1,
        getContext: () => context2d,
      }),
    },
  });
});

vi.mock("../src/ui/monsterHatchPopup.js", () => ({
  showMonsterHatchPopup: async (
    _environment: unknown,
    options: {
      readonly content: Container;
      readonly onPresent?: () => void;
      readonly onDismiss?: () => void;
    },
  ) => {
    popupCapture.content = options.content;
    const popup = {
      isDismissed: false,
      dismiss(): void {
        if (this.isDismissed) return;
        this.isDismissed = true;
        options.onDismiss?.();
      },
    };
    options.onPresent?.();
    const stack: Container[] = [options.content];
    let takeAll: Container | undefined;
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.label === "popupButton:Take All") {
        takeAll = node;
        break;
      }
      for (const child of node.children) {
        if (child instanceof Container) stack.push(child);
      }
    }
    if (takeAll === undefined) throw new Error("provider did not render its Take All control");
    takeAll.emit(
      "pointertap",
      { stopPropagation: () => undefined } as unknown as import("pixi.js").FederatedPointerEvent,
    );
    return popup;
  },
}));

const loot = [
  { kind: "silver", amount: 10 },
  { kind: "gold", amount: 2 },
  { kind: "egg" },
  { kind: "monsterEgg" },
  { kind: "recipe", combineName: "Alpha" },
] as const;

describe("LootPageProvider model", () => {
  it("pins one column, four copied items per page, and page selection reset", () => {
    expect(DUNGEON_LOOT_COLUMNS).toBe(1);
    expect(DUNGEON_LOOT_ITEMS_PER_PAGE).toBe(4);
    const model = new DungeonLootPageModel(loot);
    expect(model.pageCount).toBe(2);
    expect(model.pageItems().map((entry) => entry.item)).toEqual(loot.slice(0, 4));
    expect(model.select(2)).toBe("selected");
    expect(model.selectedIndex).toBe(2);
    model.next();
    expect(model.page).toBe(1);
    expect(model.selectedIndex).toBeUndefined();
    expect(model.pageItems().map((entry) => entry.item)).toEqual(loot.slice(4));
    model.previous();
    expect(model.page).toBe(0);
  });

  it("opens info only on repeat selection and Take All transfers the copied list once", () => {
    const model = new DungeonLootPageModel(loot);
    expect(model.select(1)).toBe("selected");
    expect(model.select(1)).toBe("info");
    expect(model.select(3)).toBe("selected");
    expect(model.closeTakeAll()).toEqual(loot);
    expect(model.closeTakeAll()).toEqual([]);
  });

  it("renders and dismisses committed Store Item/Gem receipts without replaying settlement", () => {
    const profile = new PlayerProfile({
      heroLevel: 10,
      monsterPartyLevels: [1],
      silver: 1_000,
      gold: 100,
      captureCards: { 1: 0, 2: 0, 3: 0 },
    });
    const card = purchaseStoreStock(profile, SOURCE_STORE_USABLE_STOCK[0]!);
    const gem = purchaseStoreStock(profile, SOURCE_STORE_GEM_STOCK[0]!, 1, replayableRng([0, 0]));
    const receipt = [...card.receivedItems, ...gem.receivedItems];
    const settled = profile.snapshot();

    const presentation = new DungeonLootPageModel(receipt);
    expect(presentation.pageItems().map(({ item }) => item.kind)).toEqual(["usable", "gem"]);
    presentation.select(0);
    presentation.select(0);
    expect(presentation.closeTakeAll()).toEqual(receipt);
    expect(presentation.closeTakeAll()).toEqual([]);

    // A later render/reopen reads the same committed receipt; it never receives a profile mutator.
    const reopened = new DungeonLootPageModel(receipt);
    expect(reopened.pageItems().map(({ item }) => item.kind)).toEqual(["usable", "gem"]);
    reopened.closeTakeAll();
    expect(profile.snapshot()).toEqual(settled);
    expect(profile.inventory.countByInstanceName("Card")).toBe(1);
    expect(profile.inventory.looseItems().filter((item) => item.kind === "gem")).toHaveLength(1);
  });

  it("invokes the dungeon provider Take All transfer exactly once", async () => {
    const context = providerContext();
    const dungeonLoot = [{ kind: "silver" as const, amount: 10 }];
    let transferCalls = 0;
    let transferred: readonly DungeonLoot[] | undefined;

    await showDungeonLootManagement(context, dungeonLoot, (items) => {
      transferCalls += 1;
      transferred = [...items];
    });

    expect(transferCalls).toBe(1);
    expect(transferred).toEqual(dungeonLoot);
  });

  it("uses the same source page-label origin for a three-page New Items receipt", async () => {
    popupCapture.content = undefined;
    const threePages = Array.from({ length: 9 }, (_, index) => ({
      kind: "silver" as const,
      amount: index + 1,
    }));

    await showDungeonLootManagement(providerContext(), threePages, () => undefined);

    const content = Reflect.get(popupCapture, "content") as Container | undefined;
    if (content === undefined) throw new Error("loot popup content was not captured");
    const find = (label: string): Container => {
      const stack = [content];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.label === label) return node;
        for (const child of node.children) if (child instanceof Container) stack.push(child);
      }
      throw new Error(`missing ${label}`);
    };
    const main = find("dungeonLootMain") as Box;
    const pageNumber = find("pagedNodeDisplay:pageNumber") as Text;
    expect(pageNumber.parent).toBe(content);
    expect(main.parent).toBe(content);
    expect({ x: pageNumber.anchor.x, y: pageNumber.anchor.y }).toEqual({ x: 0, y: 0.5 });
    const expectedMainY = main.boxContentSize.h / 2
      - roundSourcePoint(main.boxContentSize.h / 2, DISPLAY_MODE);
    expect(main.y).toBe(expectedMainY);
    expect({ x: pageNumber.x, y: pageNumber.y }).toEqual({
      x: DISPLAY_MODE === "iphone" ? -12 : -11,
      y: expectedMainY,
    });
    expect((pageNumber.style.stroke as { width: number }).width)
      .toBe(DISPLAY_MODE === "iphone" ? 8 : 4);
    expect(content.boundsArea).toMatchObject({
      x: 0,
      y: 0,
      width: main.boxContentSize.w,
      height: main.boxContentSize.h,
    });
  });

  it("packs generated Gem rows from bare label frames with the separate five-point row gap", async () => {
    popupCapture.content = undefined;
    const gems = Array.from({ length: 4 }, () => ({
      kind: "gem" as const,
      level: 10,
      quality: 0 as const,
      slot: 0 as const,
      enabledStats: ["Attack" as const],
    }));

    await showDungeonLootManagement(providerContext(), gems, () => undefined);

    const content = Reflect.get(popupCapture, "content") as Container | undefined;
    if (content === undefined) throw new Error("loot popup content was not captured");
    const rows: Container[] = [];
    const values: Text[] = [];
    const stack = [content];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.label?.startsWith("dungeonLootItem:") === true) rows.push(node);
      if (node.label === "dungeonLootGemBonusValue:Attack") values.push(node as Text);
      for (const child of node.children) if (child instanceof Container) stack.push(child);
    }
    rows.sort((a, b) => a.y - b.y);
    expect(rows).toHaveLength(4);
    expect(values).toHaveLength(4);
    const layout = dungeonLootDisplayMetrics(DISPLAY_MODE);
    const sourceValueSize = ttfLabelSourceContentSize(values[0]!.text, layout.bonusValueFontSize, {
      outlineAlpha: 128 / 255,
    });
    const expectedRowHeight = roundSourcePoint(
      layout.bonusIconSide + layout.rowGap + sourceValueSize.h * values[0]!.scale.y,
      DISPLAY_MODE,
    );
    const expectedPitch = roundSourcePoint(expectedRowHeight + layout.rowGap, DISPLAY_MODE);
    expect(values[0]!.getLocalBounds().height).toBeGreaterThan(sourceValueSize.h);
    expect(rows.map((row) => row.boundsArea?.height))
      .toEqual([expectedRowHeight, expectedRowHeight, expectedRowHeight, expectedRowHeight]);
    expect(rows.slice(1).map((row, index) => row.y - rows[index]!.y))
      .toEqual([expectedPitch, expectedPitch, expectedPitch]);
  });

  it("dismisses the Store provider without invoking any durable transfer", async () => {
    const profile = new PlayerProfile({
      heroLevel: 10,
      monsterPartyLevels: [1],
      silver: 1_000,
      gold: 100,
      captureCards: { 1: 0, 2: 0, 3: 0 },
    });
    const purchased = purchaseStoreStock(profile, SOURCE_STORE_USABLE_STOCK[0]!);
    const settled = profile.stateSnapshot();

    await showCommittedStoreLootManagement(providerContext(), purchased.receivedItems);

    expect(profile.stateSnapshot()).toEqual(settled);
    expect(profile.inventory.countByInstanceName("Card")).toBe(1);
  });

  it("uses the source two-second white-selection opacity pulse", () => {
    expect(dungeonLootSelectionOpacity(0)).toBe(0);
    expect(dungeonLootSelectionOpacity(500)).toBeCloseTo(50 / 255);
    expect(dungeonLootSelectionOpacity(1_000)).toBeCloseTo(100 / 255);
    expect(dungeonLootSelectionOpacity(1_500)).toBeCloseTo(50 / 255);
    expect(dungeonLootSelectionOpacity(2_000)).toBe(0);
  });

  it("uses the source two-second quality-one Gem glow pulse", () => {
    expect(dungeonGemGlowAlpha(0)).toBe(1);
    expect(dungeonGemGlowAlpha(1_000)).toBeCloseTo(150 / 255);
    expect(dungeonGemGlowAlpha(2_000)).toBe(1);
  });
});

function providerContext(): DungeonDialogContext {
  const inventory = {
    textures: new Proxy({
      "pileSilver.png": Texture.WHITE,
      "Item_Card1.png": Texture.WHITE,
    }, { get: (target, key) => Reflect.get(target, key) ?? Texture.WHITE }),
  };
  const general = {
    textures: new Proxy({}, { get: () => Texture.WHITE }),
  };
  return {
    parent: new Container(),
    owner: {},
    game: {
      assets: {
        atlas: async (name: string) => name === "InventoryItemFrames-hd" ? inventory : general,
        sprite: async () => Texture.WHITE,
        hasSprite: () => false,
      },
      scale9: {},
      strings: {
        NewItemsKey: "New Items",
        TakeAllKey: "Take All",
        PageFormatKey: "Pg %d/%d",
        Card: "Card",
        RenderableSilverNameKey: "%d Silver",
      },
      gd: {
        item: () => ({ rendererData: { spriteFrame: "Item_Card1.png" } }),
      },
    },
    ticker: {
      deltaMS: 16,
      add: () => undefined,
      remove: () => undefined,
    },
    audio: { playSfx: () => undefined },
  } as unknown as DungeonDialogContext;
}
