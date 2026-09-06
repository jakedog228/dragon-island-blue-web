import { Container, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLACK_MARKET_DEMO_CARDS,
  type DemoImageLoadResult,
  type DemoImageLoader,
  type ExternalPageOpener,
} from "../src/world/blackMarketDemoModel.js";
import {
  BlackMarketDemoFlow,
  type BlackMarketDemoFlowOptions,
} from "../src/world/blackMarketDemoFlow.js";
import { screenPointsForMode, type DisplayMode } from "../src/displayMode.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

interface Request {
  readonly url: string;
  readonly onLoad: (result: DemoImageLoadResult<Texture>) => void;
  readonly onError: (error: unknown) => void;
  readonly cancel: ReturnType<typeof vi.fn>;
}

function texture(width: number, height: number): Texture {
  return new Texture({
    source: Texture.WHITE.source,
    frame: new Rectangle(0, 0, width, height),
  });
}

function loaded(image: Texture): DemoImageLoadResult<Texture> & { readonly release: ReturnType<typeof vi.fn> } {
  return { image, release: vi.fn() };
}

function deferredLoader(): DemoImageLoader<Texture> & { readonly requests: Request[] } {
  const requests: Request[] = [];
  return {
    requests,
    load: (url, onLoad, onError) => {
      const request: Request = {
        url,
        onLoad,
        onError,
        cancel: vi.fn(),
      };
      requests.push(request);
      return request;
    },
  };
}

function findByLabel(root: Container, label: string): Container | undefined {
  if (root.label === label) return root;
  for (const child of root.children) {
    if (child instanceof Container) {
      const match = findByLabel(child, label);
      if (match !== undefined) return match;
    }
  }
  return undefined;
}

function options(overrides: Partial<BlackMarketDemoFlowOptions> = {}) {
  const loader = deferredLoader();
  const open = vi.fn();
  const onClose = vi.fn();
  const parent = new Container();
  const assets = {
    hasSprite: vi.fn((_name: string) => true),
    sprite: vi.fn(async (name: string) => {
      if (name === "NewsScreen") return texture(1024, 768);
      if (name === "PopupMenuCloseButton-hd") return texture(64, 64);
      return texture(220, 120);
    }),
  };
  const base: BlackMarketDemoFlowOptions = {
    parent,
    assets: assets as never,
    scale9: {
      MenuButton2: {
        contentRect: "{{9,6},{84,17}}",
        image: "PopupMenuButton2.png",
      },
    },
    displayMode: "iphone",
    backgroundSpriteKey: "NewsScreen",
    imageLoader: loader,
    opener: { open } satisfies ExternalPageOpener,
    onClose,
  };
  return {
    options: { ...base, ...overrides },
    loader,
    open,
    onClose,
    parent,
    assets,
  };
}

function expectComposition(flow: BlackMarketDemoFlow, mode: DisplayMode): void {
  const screen = screenPointsForMode(mode);
  const adaptation = mode === "iphone"
    ? {
        label: { x: 240, y: 24, fontSize: 22 },
        cards: [
          { x: 18, y: 50, width: 214, height: 254 },
          { x: 248, y: 50, width: 214, height: 254 },
        ],
        image: { x: 10, y: 34, width: 194, height: 100 },
        title: { x: 13, y: 142, fontSize: 14 },
        body: { x: 13, y: 169, width: 188, fontSize: 11 },
        fallbackFontSize: 11,
      }
    : {
        label: { x: 256, y: 27, fontSize: 24 },
        cards: [
          { x: 22, y: 58, width: 229, height: 304 },
          { x: 261, y: 58, width: 229, height: 304 },
        ],
        image: { x: 10, y: 38, width: 209, height: 120 },
        title: { x: 13, y: 170, fontSize: 15 },
        body: { x: 13, y: 198, width: 203, fontSize: 12 },
        fallbackFontSize: 12,
      };

  const background = findByLabel(flow, "sourceFullscreen:NewsScreen") as Sprite;
  expect(background.texture.frame).toMatchObject({ x: 0, y: 0, width: 1024, height: 768 });
  expect(background.scale.x).toBe(0.5);
  expect(background.scale.y).toBe(0.5);
  expect(background.width).toBe(512);
  expect(background.height).toBe(384);
  expect(background.position).toMatchObject({
    x: mode === "iphone" ? -16 : 0,
    y: mode === "iphone" ? -32 : 0,
  });

  const heading = findByLabel(flow, "blackMarketDemo:heading") as Text;
  expect(heading.text).toBe("DEMO CONTENT");
  expect(heading.position.x).toBe(adaptation.label.x);
  expect(heading.position.y).toBe(adaptation.label.y);
  expect(heading.style.fontSize).toBe(adaptation.label.fontSize * 2);

  adaptation.cards.forEach((cardLayout, index) => {
    const cardId = BLACK_MARKET_DEMO_CARDS[index]!.id;
    const card = findByLabel(flow, `blackMarketDemo:card:${cardId}`) as Container;
    expect(card.position.x).toBe(cardLayout.x);
    expect(card.position.y).toBe(cardLayout.y);
    expect(card.hitArea).toEqual(new Rectangle(0, 0, cardLayout.width, cardLayout.height));
    expect(cardLayout.x + cardLayout.width).toBeLessThanOrEqual(screen.w);
    expect(cardLayout.y + cardLayout.height).toBeLessThanOrEqual(screen.h);

    const imageWindow = findByLabel(flow, `blackMarketDemo:imageWindow:${cardId}`) as Container;
    expect(imageWindow.position.x).toBe(adaptation.image.x);
    expect(imageWindow.position.y).toBe(adaptation.image.y);
    const loading = findByLabel(flow, `blackMarketDemo:loading:${cardId}`) as Container;
    expect(loading.getLocalBounds()).toMatchObject({
      x: 0,
      y: 0,
      width: adaptation.image.width,
      height: adaptation.image.height,
    });

    const title = findByLabel(flow, `blackMarketDemo:title:${cardId}`) as Text;
    expect(title.position.x).toBe(adaptation.title.x);
    expect(title.position.y).toBe(adaptation.title.y);
    expect(title.style.fontSize).toBe(adaptation.title.fontSize * 2);
    const body = findByLabel(flow, `blackMarketDemo:body:${cardId}`) as Text;
    expect(body.position.x).toBe(adaptation.body.x);
    expect(body.position.y).toBe(adaptation.body.y);
    expect(body.style.fontSize).toBe(adaptation.body.fontSize * 2);
    expect(body.style.wordWrapWidth).toBe(adaptation.body.width * 2);
  });
}

describe("BlackMarketDemoFlow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["iphone", "ipad"] as const)(
    "mounts the source crop and real DEMO CONTENT composition for %s",
    async (displayMode) => {
      const fixture = options({ displayMode });
      const flow = await BlackMarketDemoFlow.show(fixture.options);

      expectComposition(flow, displayMode);
      expect(flow.children.filter((child) => child.label === "sourceFullscreen:NewsScreen")).toHaveLength(1);
      expect(fixture.loader.requests.map((request) => request.url)).toEqual(
        BLACK_MARKET_DEMO_CARDS.map((card) => card.imageUrl),
      );
      expect(flow.debugState).toEqual({
        kind: "black-market-demo",
        adaptation: "DEMO CONTENT",
        cardIds: ["preservation", "community"],
        imageStatus: { preservation: "loading", community: "loading" },
      });
    },
  );

  it.each(["iphone", "ipad"] as const)(
    "renders loaded and fallback image geometry without retrying another host for %s",
    async (displayMode) => {
      const fixture = options({ displayMode });
      const flow = await BlackMarketDemoFlow.show(fixture.options);
      const image = loaded(texture(640, 360));
      const sharedImageDestroy = vi.spyOn(image.image, "destroy");
      fixture.loader.requests[0]!.onLoad(image);
      fixture.loader.requests[1]!.onError(new Error("retired host"));

      const metrics = displayMode === "iphone"
        ? { image: { x: 10, y: 34, width: 194, height: 100 }, fallbackFontSize: 11 }
        : { image: { x: 10, y: 38, width: 209, height: 120 }, fallbackFontSize: 12 };
      const loadedSprite = findByLabel(flow, "blackMarketDemo:image:preservation") as Container;
      expect(loadedSprite.position.x).toBe(0);
      expect(loadedSprite.position.y).toBe(0);
      expect(loadedSprite.width).toBe(metrics.image.width);
      expect(loadedSprite.height).toBe(metrics.image.height);
      const fallback = findByLabel(flow, "blackMarketDemo:fallback:community") as Container;
      expect(fallback).toBeDefined();
      const fallbackBackground = findByLabel(flow, "blackMarketDemo:fallbackBackground:community") as Container;
      expect(fallbackBackground.getLocalBounds()).toMatchObject({
        x: 0,
        y: 0,
        width: metrics.image.width,
        height: metrics.image.height,
      });
      const fallbackMessage = findByLabel(flow, "blackMarketDemo:fallbackMessage:community") as Text;
      expect(fallbackMessage.position.x).toBe(metrics.image.width / 2);
      expect(fallbackMessage.position.y).toBe(metrics.image.height / 2);
      expect(fallbackMessage.style.fontSize).toBe(metrics.fallbackFontSize * 2);
      expect(flow.debugState.imageStatus).toEqual({ preservation: "loaded", community: "fallback" });
      expect(fixture.loader.requests).toHaveLength(2);
      expect(fixture.options.assets.sprite).not.toHaveBeenCalledWith(
        expect.stringContaining("placehold.co"),
      );
      expect(image.release).not.toHaveBeenCalled();
      flow.dispose();
      expect(image.release).toHaveBeenCalledTimes(1);
      expect(sharedImageDestroy).not.toHaveBeenCalled();
    },
  );

  it("invokes the real root swallow handler and opens only the clicked fixed card", async () => {
    const fixture = options();
    const flow = await BlackMarketDemoFlow.show(fixture.options);
    const card = findByLabel(flow, "blackMarketDemo:card:community") as Container;
    const underlyingInput = vi.fn();
    const stopPropagation = vi.fn();

    flow.emit("pointertap", { stopPropagation } as never);
    if (stopPropagation.mock.calls.length === 0) underlyingInput();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(underlyingInput).not.toHaveBeenCalled();
    expect(card.hitArea).toEqual(new Rectangle(0, 0, 214, 254));

    const cardStop = vi.fn();
    card.emit("pointertap", { stopPropagation: cardStop } as never);
    expect(cardStop).toHaveBeenCalledTimes(1);
    expect(fixture.open).toHaveBeenCalledWith(
      "https://example.org/",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("keeps a popup-blocked card retryable while the modal remains closeable", async () => {
    const fixture = options();
    fixture.open.mockReturnValue(null);
    const flow = await BlackMarketDemoFlow.show(fixture.options);
    const card = findByLabel(flow, "blackMarketDemo:card:community") as Container;

    card.emit("pointertap", { stopPropagation: vi.fn() } as never);
    card.emit("pointertap", { stopPropagation: vi.fn() } as never);

    expect(fixture.open).toHaveBeenCalledTimes(2);
    expect(fixture.open.mock.calls).toEqual([
      ["https://example.org/", "_blank", "noopener,noreferrer"],
      ["https://example.org/", "_blank", "noopener,noreferrer"],
    ]);
    expect(fixture.parent.children).toContain(flow);
    expect(flow.destroyed).toBe(false);

    const close = findByLabel(flow, "blackMarketDemo:close") as Container;
    close.emit("pointertap", { stopPropagation: vi.fn() } as never);
    expect(fixture.parent.children).not.toContain(flow);
    expect(flow.destroyed).toBe(true);
  });

  it("uses the base close sprite when the HD variant is absent", async () => {
    const fixture = options();
    fixture.assets.hasSprite.mockImplementation((key: string) =>
      key !== "PopupMenuCloseButton-hd");

    const flow = await BlackMarketDemoFlow.show(fixture.options);

    expect(fixture.assets.sprite).toHaveBeenCalledWith("PopupMenuCloseButton");
    expect(fixture.assets.sprite).not.toHaveBeenCalledWith("PopupMenuCloseButton-hd");
    flow.dispose();
  });

  it("fails loudly when neither close sprite variant exists", async () => {
    const fixture = options();
    fixture.assets.hasSprite.mockImplementation((key: string) =>
      key !== "PopupMenuCloseButton-hd" && key !== "PopupMenuCloseButton");

    await expect(BlackMarketDemoFlow.show(fixture.options))
      .rejects.toThrow(/PopupMenuCloseButton-hd.*PopupMenuCloseButton/i);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });

  it("removes and destroys the modal exactly once through close, Escape, and direct disposal", async () => {
    const fixture = options();
    const flow = await BlackMarketDemoFlow.show(fixture.options);
    const cropTexture = (findByLabel(flow, "sourceFullscreen:NewsScreen") as Sprite).texture;
    const close = findByLabel(flow, "blackMarketDemo:close") as Container;
    const closeEvent = { stopPropagation: vi.fn() };

    close.emit("pointertap", closeEvent as never);
    close.emit("pointertap", { stopPropagation: vi.fn() } as never);
    flow.dispose();
    expect(flow.requestBack()).toBe(false);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
    expect(fixture.parent.children).not.toContain(flow);
    expect(flow.destroyed).toBe(true);
    expect(cropTexture.destroyed).toBe(true);
    expect(fixture.loader.requests.every((request) => request.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("uses requestBack as the Escape/back close route and suppresses callbacks afterward", async () => {
    const fixture = options();
    const flow = await BlackMarketDemoFlow.show(fixture.options);
    const late = loaded(texture(640, 360));

    expect(flow.requestBack()).toBe(true);
    fixture.loader.requests[0]!.onLoad(late);
    fixture.loader.requests[1]!.onError(new Error("late"));

    expect(late.release).toHaveBeenCalledTimes(1);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
    expect(fixture.parent.children).not.toContain(flow);
    expect(flow.destroyed).toBe(true);
  });

  it("releases every accepted or late result once across repeated success/error callbacks", async () => {
    const fixture = options();
    const flow = await BlackMarketDemoFlow.show(fixture.options);
    const first = loaded(texture(640, 360));
    const duplicateSuccess = loaded(texture(640, 360));
    const lateAfterSuccess = loaded(texture(640, 360));
    const lateAfterError = loaded(texture(640, 360));
    const firstRequest = fixture.loader.requests[0]!;
    const secondRequest = fixture.loader.requests[1]!;

    firstRequest.onLoad(first);
    firstRequest.onLoad(duplicateSuccess);
    firstRequest.onError(new Error("late error"));
    secondRequest.onError(new Error("first error"));
    secondRequest.onError(new Error("repeated error"));
    secondRequest.onLoad(lateAfterError);

    expect(first.release).not.toHaveBeenCalled();
    expect(duplicateSuccess.release).toHaveBeenCalledTimes(1);
    expect(lateAfterError.release).toHaveBeenCalledTimes(1);
    expect(flow.debugState.imageStatus).toEqual({ preservation: "loaded", community: "fallback" });

    flow.dispose();
    expect(first.release).toHaveBeenCalledTimes(1);
    firstRequest.onLoad(lateAfterSuccess);
    secondRequest.onLoad(loaded(texture(640, 360)));
    expect(lateAfterSuccess.release).toHaveBeenCalledTimes(1);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });

  it("destroys the display even when onClose throws and does not notify again", async () => {
    const expected = new Error("close observer failed");
    const onClose = vi.fn(() => { throw expected; });
    const fixture = options({ onClose });
    const flow = await BlackMarketDemoFlow.show(fixture.options);

    expect(() => flow.dispose()).toThrow(expected);
    expect(flow.destroyed).toBe(true);
    expect(fixture.parent.children).not.toContain(flow);
    expect(onClose).toHaveBeenCalledTimes(1);
    flow.dispose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the old tree and releases owned results when the modal is reopened", async () => {
    const firstFixture = options();
    const firstFlow = await BlackMarketDemoFlow.show(firstFixture.options);
    const firstImage = loaded(texture(640, 360));
    firstFixture.loader.requests[0]!.onLoad(firstImage);
    firstFlow.dispose();

    const secondFixture = options();
    const secondFlow = await BlackMarketDemoFlow.show({
      ...secondFixture.options,
      parent: firstFixture.parent,
    });
    const secondImage = loaded(texture(640, 360));
    secondFixture.loader.requests[0]!.onLoad(secondImage);

    expect(firstFixture.parent.children).toEqual([secondFlow]);
    expect(firstFlow.children).toHaveLength(0);
    expect(firstImage.release).toHaveBeenCalledTimes(1);
    secondFlow.dispose();
    expect(secondImage.release).toHaveBeenCalledTimes(1);
  });

  it("stops awaited construction after disposal and never mounts a late subtree", async () => {
    let resolveMenuTexture!: (value: Texture) => void;
    const menuTexture = new Promise<Texture>((resolve) => { resolveMenuTexture = resolve; });
    const fixture = options();
    const assets = fixture.options.assets as never as {
      readonly hasSprite: ReturnType<typeof vi.fn>;
      readonly sprite: ReturnType<typeof vi.fn>;
    };
    assets.sprite.mockImplementation(async (name: string) => {
      if (name === "NewsScreen") return texture(1024, 768);
      if (name === "PopupMenuCloseButton-hd") return texture(64, 64);
      return menuTexture;
    });

    const flow = new BlackMarketDemoFlow(fixture.options);
    const mounting = flow.mount();
    await Promise.resolve();
    flow.dispose();
    resolveMenuTexture(texture(220, 120));
    await mounting;

    expect(flow.destroyed).toBe(true);
    expect(fixture.parent.children).not.toContain(flow);
    expect(flow.children).toHaveLength(0);
    expect(fixture.loader.requests).toHaveLength(0);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["background", "NewsScreen"],
    ["MenuButton2 frame", "PopupMenuButton2-hd"],
    ["close button", "PopupMenuCloseButton-hd"],
  ] as const)("fails loudly and cleans up when the %s promise rejects while active", async (_phase, rejectedName) => {
    const fixture = options();
    const expected = new Error(`${rejectedName} failed`);
    fixture.assets.sprite.mockImplementation(async (name: string) => {
      if (name === rejectedName) throw expected;
      if (name === "NewsScreen") return texture(1024, 768);
      if (name === "PopupMenuCloseButton-hd") return texture(64, 64);
      return texture(220, 120);
    });

    const flow = new BlackMarketDemoFlow(fixture.options);
    await expect(flow.mount()).rejects.toBe(expected);

    expect(flow.destroyed).toBe(true);
    expect(flow.children).toHaveLength(0);
    expect(fixture.parent.children).not.toContain(flow);
    expect(fixture.loader.requests).toHaveLength(0);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
    flow.dispose();
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["background", "NewsScreen"],
    ["MenuButton2 frame", "PopupMenuButton2-hd"],
    ["close button", "PopupMenuCloseButton-hd"],
  ] as const)("suppresses a rejected %s promise after disposal during mounting", async (_phase, rejectedName) => {
    const fixture = options();
    let rejectAsset!: (reason: unknown) => void;
    const pendingAsset = new Promise<Texture>((_resolve, reject) => {
      rejectAsset = reject;
    });
    fixture.assets.sprite.mockImplementation(async (name: string) => {
      if (name === rejectedName) return pendingAsset;
      if (name === "NewsScreen") return texture(1024, 768);
      if (name === "PopupMenuCloseButton-hd") return texture(64, 64);
      return texture(220, 120);
    });

    const flow = new BlackMarketDemoFlow(fixture.options);
    const mounting = flow.mount();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (fixture.assets.sprite.mock.calls.some(([name]) => name === rejectedName)) break;
      await Promise.resolve();
    }
    expect(fixture.assets.sprite).toHaveBeenCalledWith(rejectedName);

    flow.dispose();
    rejectAsset(new Error(`${rejectedName} rejected after disposal`));
    await expect(mounting).resolves.toBeUndefined();
    flow.dispose();

    expect(flow.destroyed).toBe(true);
    expect(flow.children).toHaveLength(0);
    expect(fixture.parent.children).not.toContain(flow);
    expect(fixture.loader.requests).toHaveLength(0);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });
});
