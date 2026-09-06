import { readFileSync as __readCorpusFile } from "node:fs";
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { AssetLibrary, Scale9SpritesData } from "@dib/renderer";
const shippedStrings = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/LocalizableStrings.json", import.meta.url), "utf8"));
import {
  REPLAY_BATTLE_TUTORIAL_FLAG,
  shouldShowReplayBattleTutorial,
  showReplayBattleTutorial,
} from "../src/world/replayBattleTutorial.js";
import { WorldNode } from "../src/world/worldNode.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

interface RecordedPopup {
  readonly environment: Record<string, unknown>;
  readonly title: string | undefined;
  readonly content: { message: string; label?: string };
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
  showMonsterHatchPopup: async (
    environment: Record<string, unknown>,
    options: {
      readonly title?: string;
      readonly content: RecordedPopup["content"];
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

describe("source replay-battle tutorial", () => {
  it("preserves the shipped misspelled flag and only selects the auto-skip arrival branch", () => {
    expect(REPLAY_BATTLE_TUTORIAL_FLAG).toBe("RevistPOI");
    expect(shouldShowReplayBattleTutorial({
      kind: "skipped",
      poiName: "Field",
      reason: "easy-ordinary-encounter",
      encounter: {
        kind: "ordinary",
        poiName: "Field",
        forced: false,
        tableKey: "1",
        poiWinsBeforeEncounter: 0,
        challengeLevel: 1,
        monsters: [{ type: "Slime", level: 1 }],
      },
      movement: { adjacent: true, kind: "walk" },
    })).toBe(true);
    expect(shouldShowReplayBattleTutorial({
      kind: "none",
      poiName: "Field",
      reason: "completed-this-refresh",
      movement: { adjacent: true, kind: "walk" },
    })).toBe(false);
    expect(shouldShowReplayBattleTutorial({
      kind: "encounter",
      poiName: "Field",
      encounter: {
        kind: "ordinary",
        poiName: "Field",
        forced: true,
        tableKey: "1",
        poiWinsBeforeEncounter: 0,
        challengeLevel: 1,
        monsters: [{ type: "Slime", level: 1 }],
      },
      movement: { adjacent: false, kind: "teleport" },
    })).toBe(false);
  });

  it("uses the exact shipped copy and standard MonsterHatchPopup close configuration", async () => {
    popupHarness.calls.length = 0;
    const environment = {
      parent: new Container(),
      owner: {},
      assets: {} as AssetLibrary,
      scale9: {} as Scale9SpritesData,
      ticker: {} as never,
      zIndex: 12_000,
      sfx: {},
    };

    await showReplayBattleTutorial(environment, strings);

    expect(popupHarness.calls).toHaveLength(1);
    const call = popupHarness.calls[0]!;
    expect(call.environment).toEqual(environment);
    expect(call.title).toBe("Replay Battle");
    expect(call.content).toEqual({
      label: "replayBattleTutorial",
      message:
        "After you have won a battle, or arrive somewhere that has no enemies, you can search " +
        "for more battles at that same location. Just touch the flag to start a battle. " +
        "Monsters, treasure and the difficulty of the battle sometimes change the more times you win.",
    });
    expect(call.buttons).toHaveLength(1);
    expect(call.buttons[0]!.label).toBe("Ok");
    expect(call.buttons[0]!.onPress()).toBeUndefined();
  });

  it("claims once before WorldNode mounts the popup and suppresses every later presentation", () => {
    popupHarness.calls.length = 0;
    const claimed = new Set<string>();
    const checkpoints: string[] = [];
    const receiver = Object.assign(Object.create(WorldNode.prototype), {
      lifecycle: { disposed: false },
      pointRoot: new Container(),
      deps: {
        playerRuntime: {
          profile: {
            hasTutorialFlag: (flag: string) => claimed.has(flag),
            claimTutorialFlag: (flag: string) => {
              if (claimed.has(flag)) return false;
              claimed.add(flag);
              return true;
            },
          },
        },
        game: {
          strings,
          assets: {} as AssetLibrary,
          scale9: {} as Scale9SpritesData,
        },
        stage: { app: { ticker: {} } },
        audio: { playSfx: vi.fn() },
        onStateChanged: () => checkpoints.push("checkpoint"),
      },
    });
    const present = (WorldNode.prototype as unknown as {
      presentReplayBattleTutorial(this: typeof receiver): void;
    }).presentReplayBattleTutorial;

    present.call(receiver);
    present.call(receiver);

    expect([...claimed]).toEqual(["RevistPOI"]);
    expect(popupHarness.calls).toHaveLength(1);
    // The ordinary arrival's shared checkpoint follows this method; it persists both mutations.
    expect(checkpoints).toEqual([]);
  });
});
