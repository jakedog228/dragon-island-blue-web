import { readFileSync as __readCorpusFile } from "node:fs";
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { AssetLibrary, Scale9SpritesData } from "@dib/renderer";
const shippedStrings = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/LocalizableStrings.json", import.meta.url), "utf8"));
import {
  BLACK_MARKET_NOT_READY_MESSAGE_NAME,
  showBlackMarketNotReadyPopup,
} from "../src/world/blackMarketNotReadyPopup.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

interface RecordedPopup {
  readonly environment: Record<string, unknown>;
  readonly title: string | undefined;
  readonly content: { readonly message: string };
  readonly buttons: ReadonlyArray<{
    readonly label: string;
    readonly onPress: () => void | Promise<void>;
  }>;
}

const popupHarness: { calls: RecordedPopup[] } = { calls: [] };

vi.mock("../src/ui/monsterHatchPopup.js", () => ({
  buildLocalizedMonsterHatchMessageContent: (
    strings: Readonly<Record<string, string>>,
    name: string,
  ) => ({ message: strings[`${name}MessageKey`] }),
  buildMonsterHatchMessageContent: (message: string) => ({ message }),
  showMonsterHatchPopup: async (
    environment: Record<string, unknown>,
    options: {
      readonly title?: string;
      readonly content: { readonly message: string };
      readonly buttons?: RecordedPopup["buttons"];
    },
  ) => {
    popupHarness.calls.push({
      environment,
      title: options.title,
      content: options.content,
      buttons: options.buttons ?? [],
    });
    return { isDismissed: false, visible: true, dismiss: () => undefined };
  },
}));

const strings = shippedStrings as Readonly<Record<string, string>>;

function environment() {
  return {
    parent: new Container(),
    owner: {},
    assets: {} as AssetLibrary,
    scale9: {} as Scale9SpritesData,
    ticker: {} as never,
    zIndex: 12_000,
    sfx: {},
  };
}

describe("Black Market not-ready dialog", () => {
  it("uses the exact base message name the source passes", () => {


    expect(BLACK_MARKET_NOT_READY_MESSAGE_NAME).toBe("BlackMarketLoading");
  });

  it("expands that name the way +[Scale9Popup showPopupForLocalizedMessageName:target:selector:] does", async () => {
    popupHarness.calls.length = 0;
    const shared = environment();

    await showBlackMarketNotReadyPopup({ ...shared, strings });

    expect(popupHarness.calls).toHaveLength(1);
    const call = popupHarness.calls[0]!;

    expect(call.title).toBe("Not Yet Ready");
    expect(call.content.message).toBe(
      "Please try back in a minute or two. If you have no internet access you will need to " +
        "restore it before you can use this.",
    );
    expect(call.buttons).toHaveLength(1);
    expect(call.buttons[0]!.label).toBe("Ok");
    // The source passes a nil target/selector, so the close button has no side effect.
    expect(call.buttons[0]!.onPress()).toBeUndefined();
  });

  it("forwards the MonsterHatchPopup environment and keeps strings out of it", async () => {
    popupHarness.calls.length = 0;
    const shared = environment();

    await showBlackMarketNotReadyPopup({ ...shared, strings });

    expect(popupHarness.calls[0]!.environment).toEqual(shared);
    expect(popupHarness.calls[0]!.environment).not.toHaveProperty("strings");
  });

  it("keeps the three shipped keys present in the extracted strings table", () => {
    expect(strings["BlackMarketLoadingTitleKey"]).toBeDefined();
    expect(strings["BlackMarketLoadingMessageKey"]).toBeDefined();
    expect(strings["OkButtonKey"]).toBe("Ok");
  });
});
