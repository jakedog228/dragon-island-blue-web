import { Container, Texture, type FederatedPointerEvent } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { showDungeonLootManagement } from "../src/dungeon/dungeonLootPageProvider.js";
import type { DungeonDialogContext } from "../src/dungeon/dungeonDialogs.js";

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
    }),
    fillText: () => undefined,
    strokeText: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
    translate: () => undefined,
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

/**
 * The real `showMonsterHatchPopup` resolves only after a 0.2s scaleY entrance. This stand-in makes
 * that window explicit: the provider's Take All control is published to the test before `show`
 * resolves, so a tap can be delivered either inside the entrance (no handle yet) or after it.
 */
interface MountedLoot {
  readonly tapTakeAll: () => void;
  readonly takeAllEnabled: () => boolean;
  readonly arrowsEnabled: () => boolean;
  readonly isDismissed: () => boolean;
  readonly finishEntrance: () => void;
}

let mounted: ((loot: MountedLoot) => void) | undefined;
const nextMount = (): Promise<MountedLoot> =>
  new Promise<MountedLoot>((resolve) => { mounted = resolve; });

vi.mock("../src/ui/monsterHatchPopup.js", () => ({
  showMonsterHatchPopup: async (
    _environment: unknown,
    options: {
      readonly content: Container;
      readonly onPresent?: () => void;
      readonly onDismiss?: () => void;
    },
  ) => {
    const popup = {
      isDismissed: false,
      dismiss(): void {
        if (this.isDismissed) return;
        this.isDismissed = true;
        options.onDismiss?.();
      },
    };
    options.onPresent?.();
    const find = (label: string): Container => {
      const stack: Container[] = [options.content];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.label === label) return node;
        for (const child of node.children) {
          if (child instanceof Container) stack.push(child);
        }
      }
      throw new Error(`provider did not render ${label}`);
    };
    const takeAll = find("popupButton:Take All");
    const nextArrow = find("dungeonLootNext");
    let releaseEntrance!: () => void;
    const entrance = new Promise<void>((resolve) => { releaseEntrance = resolve; });
    mounted?.({
      tapTakeAll: () => takeAll.emit(
        "pointertap",
        { stopPropagation: () => undefined } as unknown as FederatedPointerEvent,
      ),
      takeAllEnabled: () => takeAll.eventMode === "static",
      arrowsEnabled: () => nextArrow.eventMode === "static",
      isDismissed: () => popup.isDismissed,
      finishEntrance: releaseEntrance,
    });
    await entrance;
    return popup;
  },
}));

/** Five items is two pages, so the page arrows are live before a claim disables them. */
const dungeonLoot = [
  { kind: "silver" as const, amount: 10 },
  { kind: "silver" as const, amount: 20 },
  { kind: "silver" as const, amount: 30 },
  { kind: "silver" as const, amount: 40 },
  { kind: "silver" as const, amount: 50 },
];

/** Lets the provider's own microtasks (commit resolution, dismissal, continuation) drain. */
const settleMicrotasks = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};

describe("dungeon loot claim lifecycle", () => {
  it("settles behind the live card and only then removes it", async () => {
    const context = providerContext();
    const order: string[] = [];
    let releaseCommit!: () => void;
    const commitBlocked = new Promise<void>((resolve) => { releaseCommit = resolve; });

    const mount = nextMount();
    const flow = showDungeonLootManagement(context, dungeonLoot, {
      commit: async (items) => {
        order.push(`commit:${items.length}:dismissed=${String(loot.isDismissed())}`);
        await commitBlocked;
        order.push("commit-resolved");
      },
      afterDismiss: async () => {
        order.push(`afterDismiss:dismissed=${String(loot.isDismissed())}`);
      },
    });
    const loot = await mount;
    loot.finishEntrance();
    await settleMicrotasks();

    loot.tapTakeAll();
    await settleMicrotasks();
    // The whole point of the fix: the authority round trip runs with the loot card still up.
    expect(loot.isDismissed()).toBe(false);
    expect(order).toEqual(["commit:5:dismissed=false"]);

    releaseCommit();
    await flow;
    expect(order).toEqual([
      "commit:5:dismissed=false",
      "commit-resolved",
      "afterDismiss:dismissed=true",
    ]);
  });

  it("refuses every Take All after the first, and disables paging while the claim is in flight",
    async () => {
      const context = providerContext();
      let commits = 0;
      let clicks = 0;
      let releaseCommit!: () => void;
      const commitBlocked = new Promise<void>((resolve) => { releaseCommit = resolve; });

      const mount = nextMount();
      const flow = showDungeonLootManagement(
        {
          ...context,
          audio: { playSfx: () => { clicks += 1; } },
        } as unknown as DungeonDialogContext,
        dungeonLoot,
        {
          commit: async () => { commits += 1; await commitBlocked; },
        },
      );
      const loot = await mount;
      loot.finishEntrance();
      await settleMicrotasks();
      expect(loot.arrowsEnabled()).toBe(true);

      loot.tapTakeAll();
      await settleMicrotasks();
      expect(loot.takeAllEnabled()).toBe(false);
      expect(loot.arrowsEnabled()).toBe(false);

      loot.tapTakeAll();
      loot.tapTakeAll();
      await settleMicrotasks();
      expect(commits).toBe(1);
      expect(clicks).toBe(1);

      releaseCommit();
      await flow;
      expect(commits).toBe(1);
    });

  it("commits a tap that lands inside the entrance, before the handle is published", async () => {
    const context = providerContext();
    const order: string[] = [];

    const mount = nextMount();
    const flow = showDungeonLootManagement(context, dungeonLoot, {
      commit: () => { order.push("commit"); },
      afterDismiss: () => { order.push("afterDismiss"); },
    });
    const loot = await mount;

    // No handle exists yet; the old code dropped this tap's dismissal onto `popup?.dismiss()`.
    loot.tapTakeAll();
    await settleMicrotasks();
    expect(order).toEqual([]);

    loot.finishEntrance();
    await flow;
    expect(order).toEqual(["commit", "afterDismiss"]);
  });

  it("propagates a rejected commit without running the post-dismiss continuation", async () => {
    const context = providerContext();
    let continued = false;
    const failure = new Error("authority rejected dungeon.openTreasure");

    const mount = nextMount();
    const flow = showDungeonLootManagement(context, dungeonLoot, {
      commit: () => Promise.reject(failure),
      afterDismiss: () => { continued = true; },
    });
    const loot = await mount;
    loot.finishEntrance();
    await settleMicrotasks();
    loot.tapTakeAll();

    await expect(flow).rejects.toBe(failure);
    expect(continued).toBe(false);
    expect(loot.isDismissed()).toBe(true);
  });

  it("keeps the bare-function form settling after removal", async () => {
    const context = providerContext();
    let dismissedAtSettlement: boolean | undefined;
    let settled: number | undefined;

    const mount = nextMount();
    const flow = showDungeonLootManagement(context, dungeonLoot, (items) => {
      dismissedAtSettlement = loot.isDismissed();
      settled = items.length;
    });
    const loot = await mount;
    loot.finishEntrance();
    await settleMicrotasks();
    loot.tapTakeAll();
    await flow;

    expect(dismissedAtSettlement).toBe(true);
    expect(settled).toBe(dungeonLoot.length);
  });
});

function providerContext(): DungeonDialogContext {
  const inventory = {
    textures: {
      "pileSilver.png": Texture.WHITE,
      "Item_Card1.png": Texture.WHITE,
    },
  };
  const general = { textures: {} };
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
