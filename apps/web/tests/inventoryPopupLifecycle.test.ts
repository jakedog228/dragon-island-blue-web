import { Container, Rectangle, Texture, type FederatedPointerEvent, type Text } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { PlayerProfile } from "@dib/player-domain";
import { Box, ttfLabelSourceContentSize } from "@dib/renderer";
import { Popup, PopupHost } from "../src/ui/popup.js";
import { roundSourcePoint } from "../src/displayMode.js";
import { DISPLAY_MODE } from "../src/runtimeSettings.js";
import {
  showInventoryManagement,
  type InventoryManagementOptions,
} from "../src/player/inventoryManagementFlow.js";
import {
  inventoryGemDisplayLayout,
  inventoryPageLayout,
} from "../src/player/inventoryPageLayoutMath.js";




















vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
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
      createElement: () => ({ width: 1, height: 1, getContext: () => context2d }),
    },
  });
});

function texture(width: number, height: number): Texture {
  return new Texture({ source: Texture.WHITE.source, frame: new Rectangle(0, 0, width, height) });
}

/** Natural sprite sizes the flow hard-asserts (points x CONTENT_SCALE_FACTOR = 2). */
const SPRITE_PIXELS: Readonly<Record<string, readonly [number, number]>> = {
  "PopupMenuCloseButton-hd": [60, 59],
  "rightArrow-hd": [44, 64],
  "PopupMenuButton2-hd": [199, 52],
  "HeroEquipmentBackground-hd": [960, 120],
  "PopupBackgroundThin-hd": [64, 64],
};

/** Runs pending microtasks so async builders reach their next suspension point. */
async function settle(turns = 40): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

interface ManualTicker {
  deltaMS: number;
  add(fn: (ticker: ManualTicker) => void): void;
  remove(fn: (ticker: ManualTicker) => void): void;
  readonly listenerCount: number;
  frame(ms: number): Promise<void>;
  /** Runs long enough for every self-terminating presentation action to unregister: the 200 ms
   *  pop-in, the dim fade, and LicenseDisplay's 3 s hold + 1 s fade. What survives a drain is a
   *  page selection ticker, which has no terminating condition of its own. */
  drain(): Promise<void>;
}

function manualTicker(): ManualTicker {
  const listeners = new Set<(ticker: ManualTicker) => void>();
  const ticker: ManualTicker = {
    deltaMS: 0,
    add(fn) { listeners.add(fn); },
    remove(fn) { listeners.delete(fn); },
    get listenerCount() { return listeners.size; },
    async frame(ms) {
      ticker.deltaMS = ms;
      for (const fn of [...listeners]) fn(ticker);
      await settle();
    },
    async drain() {
      for (let i = 0; i < 30; i += 1) await ticker.frame(200);
    },
  };
  return ticker;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

function findAllByLabel(root: Container, label: string): Container[] {
  const found: Container[] = [];
  const walk = (node: Container): void => {
    if (node.label === label) found.push(node);
    for (const child of node.children) if (child instanceof Container) walk(child);
  };
  walk(root);
  return found;
}

/** Topmost match: `PopupHost` mounts each popup above the last, so the last hit is the live one. */
function topmost(root: Container, label: string): Container {
  const all = findAllByLabel(root, label);
  const node = all.at(-1);
  if (node === undefined) throw new Error(`no live "${label}" control is mounted`);
  return node;
}

function tap(node: Container): void {
  node.emit("pointertap", {
    stopPropagation: () => undefined,
    getLocalPosition: () => ({ x: 0, y: 0 }),
  } as unknown as FederatedPointerEvent);
}

/** `Popup.buildButtonRow` wires ONE listener on the row Box and dispatches by nearest-hit, so a
 *  popup button is pressed through its row with a local point inside that button. */
function tapPopupButton(root: Container, label: string): void {
  const node = topmost(root, `popupButton:${label}`);
  const row = node.parent;
  if (row === null) throw new Error(`"${label}" is not mounted in a button row`);
  row.emit("pointertap", {
    stopPropagation: () => undefined,
    getLocalPosition: () => ({ x: node.position.x + 1, y: node.position.y + 1 }),
  } as unknown as FederatedPointerEvent);
}

// Loose Gems page at 3 (iPhone) / 5 (iPad). Eleven reaches at least three pages either way, so a
// same-direction Next -> Next always has somewhere to go regardless of the runtime display mode.
const GEMS_FOR_THREE_PAGES = 11;

function harness(gemCount = GEMS_FOR_THREE_PAGES) {
  const parent = new Container();
  const host = PopupHost.for(parent);
  const ticker = manualTicker();
  const owner = {};
  let atlasGate: Promise<void> | undefined;

  const profile = new PlayerProfile({
    heroLevel: 10,
    monsterPartyLevels: [1],
    silver: 0,
    gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  });
  for (let i = 0; i < gemCount; i += 1) {
    profile.inventory.addGem({
      definitionPath: "Gems.Ruby",
      level: i + 1,
      quality: 0,
      slot: (i % 4) as 0 | 1 | 2 | 3,
      enabledStats: ["Attack"],
    });
  }

  const atlas = async (_name: string) => {
    if (atlasGate !== undefined) await atlasGate;
    return {
      textures: new Proxy({}, {
        get: (_target, key) => (typeof key === "string" ? texture(32, 32) : undefined),
      }),
    };
  };
  const assets = {
    atlas,
    sprite: async (name: string) => {
      const size = SPRITE_PIXELS[name];
      return size === undefined ? texture(2, 2) : texture(size[0], size[1]);
    },
    hasSprite: () => true,
  };

  const closes: number[] = [];
  /** Every authority mutation the flow submits, held open until the test resolves it — the shape
   *  of an online `submitPlayer` round trip (`WorldNode.mutateInventory`). */
  const commands: Array<{ action: string; id: string; resolve: () => void }> = [];
  const options = {
    parent,
    owner,
    assets: assets as never,
    scale9: {
      PopupBackgroundThin: { contentRect: "{{9,6},{84,17}}", image: "PopupBackgroundThin.png" },
      MenuButton2: { contentRect: "{{9,6},{84,17}}", image: "PopupMenuButton2.png" },
    } as never,
    strings: new Proxy({}, { get: (_t, key) => String(key) }) as never,
    ticker: ticker as never,
    data: { item: () => ({ rendererData: { spriteFrame: "Item_Card1.png" } }) } as never,
    profile,
    type: 0,
    title: "Gems",
    onClick: () => undefined,
    onBlocked: () => undefined,
    onClose: () => { closes.push(host.modalDepth); },
    mutate: async (action, id) => {
      const gate = deferred();
      commands.push({ action, id, resolve: gate.resolve });
      await gate.promise;
    },
  } satisfies InventoryManagementOptions as InventoryManagementOptions;

  return {
    host,
    ticker,
    options,
    closes,
    commands,
    gateAssets(): { release: () => void } {
      const gate = deferred();
      atlasGate = gate.promise;
      return {
        release: () => {
          atlasGate = undefined;
          gate.resolve();
        },
      };
    },
  };
}

/** Opens the flow and completes the one-time 200 ms entrance. */
async function openSettled(h: ReturnType<typeof harness>) {
  const pending = showInventoryManagement(h.options);
  await settle();
  await h.ticker.frame(200);
  const handle = await pending;
  return handle;
}


/** The one retained popup: `PopupHost` parents each mounted popup directly. */
function livePopup(h: ReturnType<typeof harness>): Container {
  const mounted = h.host.children.filter((child) => child.label !== "popupHostBackdrop");
  expect(mounted).toHaveLength(1);
  return mounted[0] as Container;
}

describe("inventory paging retains one popup", () => {
  it("mounts exactly one modal and one selection ticker for a settled page", async () => {
    const h = harness();
    const handle = await openSettled(h);

    expect(handle).toBeDefined();
    expect(h.host.modalDepth).toBe(1);
    expect(handle!.debugState).toMatchObject({ open: true, page: 0 });
    expect((handle!.debugState as { pageCount: number }).pageCount).toBeGreaterThanOrEqual(3);

    await h.ticker.drain();
    expect(h.ticker.listenerCount).toBe(1);
  });

  it("mounts the three-page label at the source left-edge origin", async () => {
    const h = harness();
    await openSettled(h);

    const content = topmost(h.host, "gemInventoryPage");
    const main = topmost(h.host, "inventoryMain") as Box;
    const pageNumber = topmost(h.host, "pagedNodeDisplay:pageNumber") as Text;
    const close = topmost(h.host, "inventory:close");
    expect(pageNumber.parent).toBe(content);
    expect(main.parent).toBe(content);
    expect({ x: pageNumber.anchor.x, y: pageNumber.anchor.y }).toEqual({ x: 0, y: 0.5 });
    const expectedMainY = main.boxContentSize.h / 2
      - roundSourcePoint(main.boxContentSize.h / 2, DISPLAY_MODE);
    expect(main.y).toBe(expectedMainY);
    expect({ x: close.x, y: close.y }).toEqual({
      x: main.boxContentSize.w + (DISPLAY_MODE === "iphone" ? 10 : 5),
      y: expectedMainY + (DISPLAY_MODE === "iphone" ? 10 : 5),
    });
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

  it("packs Gem rows from bare CCLabelTTF content instead of outline ink", async () => {
    const h = harness();
    await openSettled(h);

    const column = topmost(h.host, "gemInventoryItems") as Box;
    const rows = column.children.filter(
      (child): child is Box => child instanceof Box && child.label?.startsWith("inventoryItem:") === true,
    );
    const expectedPageSize = DISPLAY_MODE === "iphone" ? 3 : 5;
    expect(rows).toHaveLength(expectedPageSize);
    const values = findAllByLabel(h.host, "inventoryGemBonusValue:Attack") as Text[];
    expect(values).toHaveLength(expectedPageSize);

    const gemLayout = inventoryGemDisplayLayout(DISPLAY_MODE);
    const pageLayout = inventoryPageLayout(DISPLAY_MODE);
    const sourceValueSize = ttfLabelSourceContentSize(values[0]!.text, gemLayout.rowValueFont, {
      outlineAlpha: 128 / 255,
    });
    const expectedRowHeight = roundSourcePoint(
      gemLayout.rowStatIconSide + pageLayout.itemGap + sourceValueSize.h * values[0]!.scale.y,
      DISPLAY_MODE,
    );
    const expectedPitch = roundSourcePoint(
      expectedRowHeight + pageLayout.itemGap,
      DISPLAY_MODE,
    );
    // Pixi's visible stroke still paints beyond the source label frame; it just no longer becomes
    // layout padding. The stat-cell gap and the pager's between-row gap remain distinct.
    expect(values[0]!.getLocalBounds().height).toBeGreaterThan(sourceValueSize.h);
    expect(rows.map((row) => row.boxContentSize.h))
      .toEqual(Array.from({ length: expectedPageSize }, () => expectedRowHeight));
    expect(rows.slice(1).map((row, index) => row.y - rows[index]!.y))
      .toEqual(Array.from({ length: expectedPageSize - 1 }, () => expectedPitch));
    expect(column.boxContentSize.h).toBe(roundSourcePoint(
      expectedRowHeight * expectedPageSize + pageLayout.itemGap * (expectedPageSize - 1),
      DISPLAY_MODE,
    ));
  });

  it("keeps the modal shield mounted across a page turn, even while the rebuild is stalled", async () => {
    const h = harness();
    await openSettled(h);
    const retained = livePopup(h);
    const gate = h.gateAssets();

    tap(topmost(h.host, "inventory:next"));

    // Previously `closeCurrent()` ran first and depth fell to the scene baseline here, exposing
    // the scene beneath for as long as the rebuild took.
    expect(h.host.modalDepth).toBe(1);
    await settle();
    expect(h.host.modalDepth).toBe(1);

    gate.release();
    await settle();
    expect(h.host.modalDepth).toBe(1);
    expect(livePopup(h)).toBe(retained);
  });

  it("reconfigures in place without replaying the entrance", async () => {
    const h = harness();
    const handle = await openSettled(h);
    const retained = livePopup(h);

    tap(topmost(h.host, "inventory:next"));
    await settle();




    expect(livePopup(h)).toBe(retained);
    expect(topmost(h.host, "popupCard").scale.y).toBe(1);
    expect((handle!.debugState as { page: number }).page).toBe(1);
  });

  it("advances page-by-page under rapid taps and coalesces onto the final page", async () => {
    const h = harness();
    const handle = await openSettled(h);
    const retained = livePopup(h);

    // Both taps land before the first rebuild resolves — the burst that used to stack modals.
    tap(topmost(h.host, "inventory:next"));
    tap(topmost(h.host, "inventory:next"));
    await settle();

    expect(h.host.modalDepth).toBe(1);
    expect(livePopup(h)).toBe(retained);
    expect((handle!.debugState as { page: number }).page).toBe(2);

    await h.ticker.drain();
    expect(h.ticker.listenerCount).toBe(1);
  });

  it("closes once, leaving no popup and no ticker", async () => {
    const h = harness();
    await openSettled(h);

    tap(topmost(h.host, "inventory:next"));
    tap(topmost(h.host, "inventory:previous"));
    await settle();
    await h.ticker.drain();

    tap(topmost(h.host, "inventory:close"));
    expect(h.host.modalDepth).toBe(0);
    expect(h.ticker.listenerCount).toBe(0);
    expect(h.closes).toHaveLength(1);
  });

  it("publishes no handle when Close lands during the initial entrance", async () => {
    const h = harness();
    const pending = showInventoryManagement(h.options);
    await settle();

    // Mounted, entrance still running, neither the flow nor the caller owns a handle.
    expect(h.host.modalDepth).toBe(1);
    tap(topmost(h.host, "inventory:close"));

    await h.ticker.frame(200);
    const handle = await pending;

    // Previously the factory still returned a handle here, which callers stored as their modal
    // reference (`WorldNode.hasModal`) with no popup on screen.
    expect(h.host.modalDepth).toBe(0);
    expect(handle).toBeUndefined();
    expect(h.closes).toEqual([1]);

    // The dim fade and LicenseDisplay's instruction fade are still registered for one more tick
    // and end themselves; what must not survive is a selection ticker for a page nobody owns.
    await h.ticker.drain();
    expect(h.ticker.listenerCount).toBe(0);
  });

  it("ends the flow when the host dismisses the popup during the initial entrance", async () => {
    const h = harness();
    const pending = showInventoryManagement(h.options);
    await settle();

    // What `DungeonNode.dismissTopPopup` does while the caller is still awaiting its handle.
    h.host.dismissTop();

    await h.ticker.frame(200);
    const handle = await pending;

    expect(handle).toBeUndefined();
    expect(h.host.modalDepth).toBe(0);
    expect(h.closes).toHaveLength(1);
    await h.ticker.drain();
    expect(h.ticker.listenerCount).toBe(0);
  });
});

describe("inventory mutations serialize at flow level", () => {
  function selectFirstRow(h: ReturnType<typeof harness>): void {
    tap(topmost(h.host, "gemInventoryItems"));
  }

  it("refuses a second command from a page built while the first is in flight", async () => {
    const h = harness();
    const handle = await openSettled(h);
    selectFirstRow(h);

    tap(topmost(h.host, "popupButton:EquipGemKey"));
    await settle();
    expect(h.commands).toHaveLength(1);

    // Paging is refused while a durable mutation is outstanding, so no fresh action instance can
    // be born unguarded. `CommandCoordinator.submit` permits one in-flight command per slot.
    tap(topmost(h.host, "inventory:next"));
    await settle();
    expect((handle!.debugState as { page: number }).page).toBe(0);

    tap(topmost(h.host, "popupButton:EquipGemKey"));
    await settle();
    expect(h.commands).toHaveLength(1);

    h.commands[0]!.resolve();
    await settle();
    expect(h.host.modalDepth).toBe(1);
  });

  it("refuses a sibling action button while a mutation is pending on the same page", async () => {
    const h = harness();
    await openSettled(h);
    selectFirstRow(h);

    tap(topmost(h.host, "popupButton:EquipGemKey"));
    await settle();

    // Drop is a different rendered instance with its own guard; only the flow-level state can
    // refuse it.
    tap(topmost(h.host, "popupButton:DropKey"));
    await settle();
    await h.ticker.frame(200);

    expect(h.commands.map(({ action }) => action)).toEqual(["equip"]);
    expect(findAllByLabel(h.host, "popupButton:YesButtonKey")).toHaveLength(0);
  });

  it("refreshes in place when a mutation completes, dismissing nothing", async () => {
    const h = harness();
    await openSettled(h);
    const retained = livePopup(h);
    selectFirstRow(h);

    tap(topmost(h.host, "popupButton:EquipGemKey"));
    await settle();

    // The completion used to run the shared `closeCurrent()` and tear down whatever page was
    // current when it landed.
    h.commands[0]!.resolve();
    await settle();

    expect(h.host.modalDepth).toBe(1);
    expect(livePopup(h)).toBe(retained);
    await h.ticker.drain();
    expect(h.ticker.listenerCount).toBe(1);
  });

  it("accepts the next mutation once the previous one settles", async () => {
    const h = harness();
    await openSettled(h);
    selectFirstRow(h);

    tap(topmost(h.host, "popupButton:EquipGemKey"));
    await settle();
    h.commands[0]!.resolve();
    await settle();

    selectFirstRow(h);
    tap(topmost(h.host, "popupButton:EquipGemKey"));
    await settle();
    expect(h.commands).toHaveLength(2);
  });
});

describe("Popup.newConfiguration", () => {
  function popupEnvironment() {
    const h = harness();
    return {
      host: h.host,
      ticker: h.ticker,
      gateAssets: h.gateAssets,
      opts: {
        parent: h.options.parent,
        assets: h.options.assets,
        scale9: h.options.scale9,
        ticker: h.options.ticker,
        owner: h.options.owner,
        dismissOnTap: false,
      },
    };
  }

  function labelled(label: string): Container {
    const node = new Container();
    node.label = label;
    node.addChild(new Container());
    return node;
  }

  async function showOne(env: ReturnType<typeof popupEnvironment>, screenChild?: Container) {
    const pending = Popup.show(env.opts.parent as Container, {
      ...env.opts,
      content: labelled("configuration:first"),
      ...(screenChild === undefined
        ? {}
        : { screenChildren: [{ node: screenChild, x: 0, y: 0 }] }),
    } as never);
    await settle();
    await env.ticker.frame(200);
    return pending;
  }

  it("replaces content on the same instance without touching the host stack", async () => {
    const env = popupEnvironment();
    const popup = await showOne(env);
    const mounted = env.host.children.at(-1);

    await popup.newConfiguration({ content: labelled("configuration:second") });

    expect(env.host.modalDepth).toBe(1);
    expect(env.host.children.at(-1)).toBe(mounted);
    expect(popup.debugState.contentLabel).toBe("configuration:second");
    expect(findAllByLabel(env.host, "configuration:first")).toHaveLength(0);
    expect(findAllByLabel(env.host, "configuration:second")).toHaveLength(1);
  });

  it("retains screen-anchored children when the configuration omits them", async () => {
    const env = popupEnvironment();
    const persistent = labelled("configuration:screenChild");
    const popup = await showOne(env, persistent);

    await popup.newConfiguration({ content: labelled("configuration:second") });
    expect(persistent.destroyed).toBe(false);
    expect(findAllByLabel(env.host, "configuration:screenChild")).toHaveLength(1);

    const replacement = labelled("configuration:screenChild2");
    await popup.newConfiguration({
      content: labelled("configuration:third"),
      screenChildren: [{ node: replacement, x: 0, y: 0 }],
    });
    expect(persistent.destroyed).toBe(true);
    expect(findAllByLabel(env.host, "configuration:screenChild2")).toHaveLength(1);
  });

  it("discards a build that a newer configuration supersedes", async () => {
    const env = popupEnvironment();
    const popup = await showOne(env);

    const gate = env.gateAssets();
    const stalled = popup.newConfiguration({
      content: labelled("configuration:stalled"),
      backgroundKey: null,
      title: "stalled",
    });
    const superseding = popup.newConfiguration({ content: labelled("configuration:winner") });
    gate.release();
    await stalled;
    await superseding;

    expect(findAllByLabel(env.host, "configuration:stalled")).toHaveLength(0);
    expect(findAllByLabel(env.host, "configuration:winner")).toHaveLength(1);
    expect(env.host.modalDepth).toBe(1);
  });

  it("does nothing once the popup has been dismissed", async () => {
    const env = popupEnvironment();
    const popup = await showOne(env);
    popup.dismiss();

    const orphan = labelled("configuration:afterDismiss");
    await popup.newConfiguration({ content: orphan });

    expect(env.host.modalDepth).toBe(0);
    expect(findAllByLabel(env.host, "configuration:afterDismiss")).toHaveLength(0);
  });
});
