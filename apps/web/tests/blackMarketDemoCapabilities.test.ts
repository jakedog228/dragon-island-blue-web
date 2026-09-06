import { Rectangle, Texture } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLACK_MARKET_DEMO_CARDS,
} from "../src/world/blackMarketDemoModel.js";
import {
  createBlackMarketDemoExternalPageOpener,
  createBlackMarketDemoImageLoader,
} from "../src/world/blackMarketDemoCapabilities.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

interface FakeImage {
  crossOrigin: string | null;
  src: string;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  emit(type: string): void;
  listenerCount(type: string): number;
}

function fakeImage(): FakeImage {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    crossOrigin: null,
    src: "",
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set<EventListener>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) listener(new Event(type));
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  };
}

describe("Black Market app-shell capabilities", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens both exact fixed destinations with the reserved new-tab flags", () => {
    const open = vi.fn(() => ({}));
    vi.stubGlobal("window", { open });
    const opener = createBlackMarketDemoExternalPageOpener();

    for (const card of BLACK_MARKET_DEMO_CARDS) {
      opener.open(card.destinationUrl, "_blank", "noopener,noreferrer");
    }

    expect(open.mock.calls).toEqual([
      ["https://example.com/", "_blank", "noopener,noreferrer"],
      ["https://example.org/", "_blank", "noopener,noreferrer"],
    ]);

    const rejected = [
      {
        label: "unknown URL",
        call: () => opener.open(
          "https://example.com.evil.example/" as never,
          "_blank",
          "noopener,noreferrer",
        ),
        message: /unknown Black Market destination/i,
      },
      {
        label: "wrong target",
        call: () => opener.open(
          BLACK_MARKET_DEMO_CARDS[0]!.destinationUrl,
          "_self" as never,
          "noopener,noreferrer",
        ),
        message: /_blank with noopener,noreferrer/i,
      },
      {
        label: "wrong features: noopener only",
        call: () => opener.open(
          BLACK_MARKET_DEMO_CARDS[1]!.destinationUrl,
          "_blank",
          "noopener" as never,
        ),
        message: /_blank with noopener,noreferrer/i,
      },
      {
        label: "wrong features: noreferrer only",
        call: () => opener.open(
          BLACK_MARKET_DEMO_CARDS[0]!.destinationUrl,
          "_blank",
          "noreferrer" as never,
        ),
        message: /_blank with noopener,noreferrer/i,
      },
    ];
    for (const { label, call, message } of rejected) {
      open.mockClear();
      expect(call, label).toThrow(message);
      expect(open, label).not.toHaveBeenCalled();
    }
  });

  it("leaves a blocked popup retryable with the same safe request", () => {
    const open = vi.fn(() => null);
    vi.stubGlobal("window", { open });
    const opener = createBlackMarketDemoExternalPageOpener();
    const card = BLACK_MARKET_DEMO_CARDS[1]!;

    opener.open(card.destinationUrl, "_blank", "noopener,noreferrer");
    opener.open(card.destinationUrl, "_blank", "noopener,noreferrer");

    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls).toEqual([
      [card.destinationUrl, "_blank", "noopener,noreferrer"],
      [card.destinationUrl, "_blank", "noopener,noreferrer"],
    ]);
  });

  it("requests both exact fixed image URLs and cancellation removes listeners", () => {
    const images: FakeImage[] = [];
    vi.stubGlobal("Image", class {
      constructor() {
        const image = fakeImage();
        images.push(image);
        return image;
      }
    });
    const loader = createBlackMarketDemoImageLoader();
    const onLoad = vi.fn();
    const onError = vi.fn();

    const handles = BLACK_MARKET_DEMO_CARDS.map((card) =>
      loader.load(card.imageUrl, onLoad, onError)
    );
    expect(images.map((image) => image.src)).toEqual(
      [
        "https://placehold.co/640x360/png?text=Preservation+Demo",
        "https://placehold.co/640x360/png?text=Community+Demo",
      ],
    );
    for (const image of images) {
      expect(image.crossOrigin).toBe("anonymous");
      expect(image.listenerCount("load")).toBe(1);
      expect(image.listenerCount("error")).toBe(1);
    }

    handles.forEach((handle, index) => {
      handle.cancel();
      images[index]!.emit("load");
      images[index]!.emit("error");
    });

    for (const image of images) {
      expect(image.listenerCount("load")).toBe(0);
      expect(image.listenerCount("error")).toBe(0);
    }
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(() => loader.load("https://evil.example/image.png" as never, onLoad, onError))
      .toThrow(/unknown Black Market image/i);
    expect(images).toHaveLength(2);
  });

  it("gives the consumer an owned texture result whose release destroys exactly once", () => {
    const image = fakeImage();
    vi.stubGlobal("Image", class { constructor() { return image; } });
    const ownedTexture = new Texture({ source: Texture.WHITE.source, frame: new Rectangle(0, 0, 8, 8) });
    const destroy = vi.spyOn(ownedTexture, "destroy");
    vi.spyOn(Texture, "from").mockReturnValue(ownedTexture);
    const loader = createBlackMarketDemoImageLoader();
    const onLoad = vi.fn();
    const handle = loader.load(BLACK_MARKET_DEMO_CARDS[1]!.imageUrl, onLoad, vi.fn());

    image.emit("load");
    expect(onLoad).toHaveBeenCalledTimes(1);
    const result = onLoad.mock.calls[0]![0] as { release: () => void };
    result.release();
    result.release();
    handle.cancel();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
