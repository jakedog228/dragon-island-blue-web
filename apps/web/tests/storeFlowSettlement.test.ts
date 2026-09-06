import {
  PlayerProfile,
  SOURCE_STORE_EGG_STOCK,
  SOURCE_STORE_GEM_STOCK,
  SOURCE_STORE_USABLE_STOCK,
  type StorePurchaseResult,
  type StoreReceivedItem,
  type StoreStock,
} from "@dib/player-domain";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const popupHarness = vi.hoisted(() => ({
  presses: [] as string[],
  presentations: [] as unknown[],
}));

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

vi.mock("../src/ui/monsterHatchPopup.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ui/monsterHatchPopup.js")>();
  return {
    ...actual,
    showMonsterHatchPopup: async (
    _environment: unknown,
    options: {
      readonly buttons?: ReadonlyArray<{
        readonly label: string;
        readonly onPress: () => void | Promise<void>;
      }>;
    },
    ) => {
      popupHarness.presentations.push(options);
      const label = popupHarness.presses.shift();
      if (label !== undefined) {
        const button = options.buttons?.find((candidate) => candidate.label === label);
        if (button === undefined) throw new Error(`Store popup omitted ${label}`);
        await button.onPress();
      }
      return { isDismissed: true, dismiss: () => undefined };
    },
  };
});

let Container: typeof import("pixi.js")["Container"];
let Texture: typeof import("pixi.js")["Texture"];
let StoreFlow: typeof import("../src/player/storeFlow.js")["StoreFlow"];
let PopupHost: typeof import("../src/ui/popup.js")["PopupHost"];

beforeAll(async () => {
  const [pixi, store, popup] = await Promise.all([
    import("pixi.js"),
    import("../src/player/storeFlow.js"),
    import("../src/ui/popup.js"),
  ]);
  Container = pixi.Container;
  Texture = pixi.Texture;
  StoreFlow = store.StoreFlow;
  PopupHost = popup.PopupHost;
});

beforeEach(() => {
  popupHarness.presses.length = 0;
  popupHarness.presentations.length = 0;
});

describe("StoreFlow settlement presentation gates", () => {
  it("authors checkout with the source StoreNode and Incramenter topology", async () => {
    const { flow } = await confirmationFlow({
      purchase: () => { throw new Error("layout-only checkout must not purchase"); },
      present: () => undefined,
    });

    await confirm(flow);

    const presentation = popupHarness.presentations.at(-1) as {
      readonly hideOverlays?: boolean;
      readonly runScaleAction?: boolean;
      readonly contentLayoutBounds?: { x: number; y: number; w: number; h: number };
      readonly content: {
        readonly label: string;
        readonly gap: number;
        readonly roundingScale: number;
        readonly horizontalAlignment?: number;
        readonly boxLayoutBounds: { x: number; y: number; w: number; h: number };
        readonly children: ReadonlyArray<{
          readonly label?: string;
          readonly gap?: number;
          readonly x: number;
          readonly y: number;
          readonly children?: ReadonlyArray<{
            readonly label?: string;
            readonly gap?: number;
            readonly y: number;
            readonly children?: ReadonlyArray<{ readonly label?: string; readonly y: number }>;
            readonly text?: string;
            readonly style?: { readonly stroke?: unknown; readonly align?: string };
          }>;
          readonly text?: string;
          readonly style?: { readonly stroke?: unknown; readonly align?: string };
        }>;
      };
    };
    expect(presentation.hideOverlays).toBe(true);
    expect(presentation.runScaleAction).toBe(false);
    expect(presentation.contentLayoutBounds).toEqual(presentation.content.boxLayoutBounds);
    expect(presentation.content.label).toBe("store:purchase");
    expect(presentation.content.gap).toBe(
      presentation.content.roundingScale === 2 ? 2.5 : 5,
    );
    expect(presentation.content.horizontalAlignment).toBe(0);

    const children = presentation.content.children;
    expect(children.map(({ label }) => label)).toEqual([
      "store:purchase:name",
      "store:purchase:description",
      "store:purchase:quantity",
      "store:purchase:price",
    ]);
    expect(children.map(({ x }) => x)).toEqual([0, 0, 0, 0]);
    expect(children[0]!.y).toBeLessThan(children[1]!.y);
    expect(children[1]!.y).toBeLessThan(children[2]!.y);
    expect(children[2]!.y).toBeLessThan(children[3]!.y);
    expect(Boolean(children[0]!.style?.stroke)).toBe(false);
    expect(children[1]!.style?.align).toBe("left");
    expect(Boolean(children[1]!.style?.stroke)).toBe(false);

    const quantityChildren = children[2]!.children!;
    expect(children[2]!.gap).toBe(20);
    expect(quantityChildren.map(({ label }) => label)).toEqual([
      "store:purchase:quantity:arrows",
      "store:purchase:quantity:value",
    ]);
    expect(quantityChildren[1]!.text).toBe("How Many: 1");
    expect(Boolean(quantityChildren[1]!.style?.stroke)).toBe(true);
    const arrows = quantityChildren[0]!.children!;
    expect(quantityChildren[0]!.gap).toBe(
      presentation.content.roundingScale === 2 ? 15 : 30,
    );
    expect(arrows.map(({ label }) => label)).toEqual([
      "store:quantity:plus",
      "store:quantity:minus",
    ]);
    expect(arrows[0]!.y).toBeLessThan(arrows[1]!.y);

    const priceValue = children[3]!.children![1]!;
    expect(children[3]!.gap).toBe(
      presentation.content.roundingScale === 2 ? 2.5 : 5,
    );
    expect(priceValue.label).toBe("store:purchase:price:value");
    expect(priceValue.text).toBe("50");
    expect(Boolean(priceValue.style?.stroke)).toBe(true);
  });

  it("retains an empty description and omits only the Incramenter for single-buy stock", async () => {
    const { flow } = await confirmationFlow({
      purchase: () => { throw new Error("layout-only checkout must not purchase"); },
      present: () => undefined,
    });

    await confirm(flow, SOURCE_STORE_GEM_STOCK[0]!);
    const gemContent = (popupHarness.presentations.at(-1) as {
      readonly content: { readonly children: ReadonlyArray<{ readonly label?: string; readonly text?: string }> };
    }).content;
    expect(gemContent.children.map(({ label }) => label)).toEqual([
      "store:purchase:name",
      "store:purchase:description",
      "store:purchase:quantity",
      "store:purchase:price",
    ]);
    expect(gemContent.children[1]!.text).toBe("");

    await confirm(flow, SOURCE_STORE_EGG_STOCK[0]!);
    const eggContent = (popupHarness.presentations.at(-1) as {
      readonly content: { readonly children: ReadonlyArray<{ readonly label?: string }> };
    }).content;
    expect(eggContent.children.map(({ label }) => label)).toEqual([
      "store:purchase:name",
      "store:purchase:description",
      "store:purchase:price",
    ]);
  });

  it("leaves checkout and receipt presentation inert when confirmation is cancelled", async () => {
    popupHarness.presses.push("Close");
    let purchaseCalls = 0;
    let presentationCalls = 0;
    const { flow, profile } = await confirmationFlow({
      purchase: () => {
        purchaseCalls += 1;
        throw new Error("cancelled checkout must not purchase");
      },
      present: () => { presentationCalls += 1; },
    });
    const before = profile.stateSnapshot();

    await confirm(flow);

    expect(purchaseCalls).toBe(0);
    expect(presentationCalls).toBe(0);
    expect(profile.stateSnapshot()).toEqual(before);
  });

  it("does not present rewards or mutate the profile when checkout is rejected", async () => {
    popupHarness.presses.push("Purchase");
    let purchaseCalls = 0;
    let presentationCalls = 0;
    const { flow, profile } = await confirmationFlow({
      purchase: () => {
        purchaseCalls += 1;
        throw new Error("Store: insufficient silver");
      },
      present: () => { presentationCalls += 1; },
    });
    const before = profile.stateSnapshot();

    await confirm(flow);

    expect(purchaseCalls).toBe(1);
    expect(presentationCalls).toBe(0);
    expect(profile.stateSnapshot()).toEqual(before);
  });

  it("fails closed before checkout when a pending authority decision forbids purchases", async () => {
    let purchaseCalls = 0;
    let blockedCalls = 0;
    const { flow } = await confirmationFlow({
      purchaseUnavailableMessage: "Purchases are unavailable during recovery.",
      onBlocked: () => { blockedCalls += 1; },
      purchase: () => {
        purchaseCalls += 1;
        throw new Error("authority-pinned Store must not submit a purchase");
      },
      present: () => undefined,
    });
    const internal = flow as {
      category: number;
      selectedIndex: number;
      performBuy(): Promise<void>;
      showPurchaseError(message: string): Promise<void>;
    };
    internal.category = 1;
    internal.selectedIndex = 0;
    const purchaseError = vi.spyOn(internal, "showPurchaseError").mockResolvedValue();

    await internal.performBuy();

    expect(blockedCalls).toBe(1);
    expect(purchaseCalls).toBe(0);
    expect(purchaseError).toHaveBeenCalledWith("Purchases are unavailable during recovery.");
  });

  it("closes checkout, presents the Egg receipt, then mounts the hatch without closing Store", async () => {
    popupHarness.presses.push("Purchase");
    const order: string[] = [];
    const dismiss = vi.spyOn(PopupHost.prototype, "dismissTopOwnedBy")
      .mockImplementation(() => {
        order.push("checkout-dismissed");
        return true;
      });
    const stock = SOURCE_STORE_EGG_STOCK[1]!;
    const { flow } = await confirmationFlow({
      purchase: () => {
        order.push("purchased");
        return {
          stockId: stock.id,
          quantity: 1,
          currency: stock.currency,
          spent: stock.unitPrice,
          balance: 19_702,
          receivedItems: [{ kind: "monsterEgg" }],
          pendingEggKind: "gold",
        };
      },
      present: (items) => {
        expect(items).toEqual([{ kind: "monsterEgg" }]);
        order.push("new-items-closed");
      },
      onEggPurchased: (kind) => {
        expect(kind).toBe("gold");
        order.push("hatch-mounted");
      },
    });
    const internal = flow as {
      refreshPlayerAssets(): void;
      refreshSelection(): Promise<void>;
    };
    vi.spyOn(internal, "refreshPlayerAssets").mockImplementation(() => undefined);
    vi.spyOn(internal, "refreshSelection").mockResolvedValue();

    await confirm(flow, stock);

    expect(order).toEqual([
      "purchased",
      "checkout-dismissed",
      "new-items-closed",
      "hatch-mounted",
    ]);
    expect((flow as { closed: boolean }).closed).toBe(false);
    dismiss.mockRestore();
  });
});

async function confirmationFlow(options: {
  readonly purchase: (stock: StoreStock, quantity: number) => StorePurchaseResult;
  readonly present: (items: readonly StoreReceivedItem[]) => void | Promise<void>;
  readonly onEggPurchased?: (kind: "silver" | "gold") => void | Promise<void>;
  readonly purchaseUnavailableMessage?: string;
  readonly onBlocked?: () => void;
}): Promise<{ readonly flow: object; readonly profile: PlayerProfile }> {
  const profile = new PlayerProfile({
    heroLevel: 10,
    monsterPartyLevels: [1],
    silver: 1_000,
    gold: 100,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  });
  const inventory = {
    textures: {
      "spendSilver.png": Texture.WHITE,
      "spendGold.png": Texture.WHITE,
    },
  };
  const flow = Reflect.construct(StoreFlow, [{
    parent: new Container(),
    owner: {},
    assets: {
      atlas: async () => inventory,
      sprite: async () => Texture.WHITE,
      hasSprite: () => false,
    },
    scale9: {},
    strings: {
      Card1LongDescriptionKey: "A capture card.",
      RandomGemKey: "Random Gem",
      NoviceSlotKey: "Novice",
      ItemTypeMagicKey: "Magic",
      GemLongDescriptionKey: "",
      RenderableEggNameKey: "Silver Egg",
      RenderableMonsterEggNameKey: "Golden Egg",
      SilverEggLongDescriptionKey: "A Silver Egg.",
      GoldEggLongDescriptionKey: "A Golden Egg.",
      PurchaseQuantityKey: "How Many: ",
      PurchaseKey: "Purchase",
      CloseButtonKey: "Close",
      NotEnoughSilverTitleKey: "Not enough Silver",
      NotEnoughSilverMessageKey: "You need more Silver.",
      OkButtonKey: "OK",
    },
    ticker: { add: () => undefined, remove: () => undefined },
    data: {},
    profile,
    onClick: () => undefined,
    onBlocked: options.onBlocked ?? (() => undefined),
    onClose: () => undefined,
    onFirstShop: () => undefined,
    ...(options.purchaseUnavailableMessage === undefined
      ? {}
      : { purchaseUnavailableMessage: options.purchaseUnavailableMessage }),
    purchase: options.purchase,
    presentCommittedRewards: options.present,
    onEggPurchased: options.onEggPurchased ?? (() => undefined),
  }]);
  return { flow, profile };
}

async function confirm(
  flow: object,
  stock: StoreStock = SOURCE_STORE_USABLE_STOCK[0]!,
): Promise<void> {
  await (flow as {
    confirmPurchase(stock: StoreStock): Promise<void>;
  }).confirmPurchase(stock);
}
