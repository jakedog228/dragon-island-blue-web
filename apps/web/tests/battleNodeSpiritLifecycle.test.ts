import { Container, Rectangle, Texture, type Ticker } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { AssetLibrary } from "@dib/renderer";
import { BattleNode } from "../src/battle/battleNode.js";
import { FriendlyTeamDisplay } from "../src/battle/friendlyTeamDisplay.js";
import type { BattlePlayerProfile } from "../src/player/battlePlayerState.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});
const engineMocks = vi.hoisted(() => ({
  restoreBattleReplay: vi.fn(() => ({
    session: {
      activeIdsOf: () => [],
      benchCountOf: () => 0,
    },
    step: { type: "choice" },
    events: [],
  })),
}));
vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));
vi.mock("../src/battle/battleRoster.js", () => ({
  BattleRoster: class {},
}));
vi.mock("../src/battle/friendlyMonsterDisplay.js", async () => {
  const { Container: PixiContainer, Texture: PixiTexture } = await import("pixi.js");
  class FriendlyMonsterDisplay extends PixiContainer {
    readonly contentHeight = 0;
    readonly monsterTexture = PixiTexture.EMPTY;
    readonly isMainLiving = true;

    constructor(_options: unknown) {
      super();
    }
  }
  return { FriendlyMonsterDisplay };
});
vi.mock("@dib/engine", async (importOriginal) => ({
  ...(await importOriginal()),
  restoreBattleReplay: engineMocks.restoreBattleReplay,
}));

class TestTicker {
  deltaMS = 16;
  add = vi.fn();
  remove = vi.fn();
}

async function makeBattleWithSpiritBackground() {
  const ticker = new TestTicker();
  const stageRoot = new Container();
  const stagePixi = new Container();
  const stage = {
    root: stageRoot,
    app: {
      ticker,
      stage: stagePixi,
      screen: new Rectangle(0, 0, 960, 640),
    },
  };
  const display = new FriendlyTeamDisplay({
    assets: {
      sprite: vi.fn(async () => Texture.EMPTY),
      atlas: vi.fn(async () => ({
        textures: {
          "monsterHpBarBack.png": Texture.EMPTY,
          "monsterHpBar.png": Texture.EMPTY,
        },
      })),
    } as unknown as AssetLibrary,
    ticker: ticker as unknown as Ticker,
    profile: {} as BattlePlayerProfile,
  });
  await (display as unknown as { ensureSpiritBackground(): Promise<void> }).ensureSpiritBackground();
  (display as unknown as { summonSelectMode: boolean }).summonSelectMode = true;
  const initTeam = vi.fn(async () => {});
  (display as unknown as { initTeam: typeof initTeam }).initTeam = initTeam;

  const showMessagePopup = vi.fn(async (_name: string) => {});
  const openSpiritMenu = vi.fn(async () => {});
  const notAllowed = vi.fn();
  const node = new BattleNode({
    stage: stage as never,
    game: { gd: {} } as never,
    audio: { playSfx: vi.fn() } as never,
    keyboard: { register: vi.fn() } as never,
    encounter: { backgroundKey: "test", playerTeam: [], enemyTeam: [] },
    playerState: { collection: {}, profile: {} } as never,
    authority: {
      battleId: "spirit-proof",
      replay: {
        schemaVersion: 1,
        teams: [[], []],
        options: {},
        commands: [],
      },
      resumeExisting: true,
      submit: vi.fn(async () => {}),
      claimTutorialFlag: vi.fn(async () => {}),
    },
  });
  const internal = node as unknown as {
    buildScene: () => Promise<void>;
    buildSnapshots: () => { friendly: never[]; enemy: never[] };
    playMusicTrack: () => void;
    showEncounterChat: () => Promise<void>;
    loop: () => Promise<void>;
    friendlyDisplay: FriendlyTeamDisplay;
    enemyDisplay: Record<string, ReturnType<typeof vi.fn>>;
    panel: { onActingCardTap: ReturnType<typeof vi.fn> };
    turnOrder: Record<string, ReturnType<typeof vi.fn>>;
    targetPicker: { showMessagePopup: typeof showMessagePopup };
    openSpiritMenu: typeof openSpiritMenu;
    pickerSfx: () => { onNotAllowed: typeof notAllowed };
  };
  internal.buildScene = vi.fn(async () => {});
  internal.buildSnapshots = vi.fn(() => ({ friendly: [], enemy: [] }));
  internal.playMusicTrack = vi.fn();
  internal.showEncounterChat = vi.fn(async () => {});
  internal.loop = vi.fn(async () => {});
  internal.friendlyDisplay = display;
  internal.enemyDisplay = {
    initTeam: vi.fn(async () => {}),
    startInitialEntrance: vi.fn(),
    setBenchCount: vi.fn(),
    onElementTap: vi.fn(),
    onAnalyzeTap: vi.fn(),
    onBenchTap: vi.fn(),
  };
  internal.panel = { onActingCardTap: vi.fn() };
  internal.turnOrder = { onOwnTap: vi.fn() };
  internal.targetPicker = { showMessagePopup };
  internal.openSpiritMenu = openSpiritMenu;
  internal.pickerSfx = () => ({ onNotAllowed: notAllowed });

  node.notifyEnterTransitionDidFinish();
  await node.start({} as never);

  const spiritBackground = (display as unknown as { spiritBackground: Container }).spiritBackground;
  return { node, display, spiritBackground, showMessagePopup, openSpiritMenu, notAllowed };
}

function tapSpiritBackground(spiritBackground: Container): void {
  spiritBackground.emit("pointertap", { stopPropagation: vi.fn() } as never);
}

describe("BattleNode empty spirit background owner path", () => {
  it("does not mirror an authority-committed opening spirit charge twice", async () => {
    const { node } = await makeBattleWithSpiritBackground();
    const chargeDealt = vi.fn();
    const chargeTaken = vi.fn();
    const internal = node as unknown as {
      suppressCommittedOpeningSpiritCharge: boolean;
      roster: { entryOf(id: string): { team: 0 | 1; setup: { level: number } } };
      profile: {
        chargeSpiritForDealtDamage: typeof chargeDealt;
        chargeSpiritForTakenDamage: typeof chargeTaken;
      };
      applyPresentedSpiritReadiness(events: readonly unknown[]): void;
    };
    internal.roster = {
      entryOf: (id) => id === "friendly"
        ? { team: 0, setup: { level: 5 } }
        : { team: 1, setup: { level: 10 } },
    };
    internal.profile.chargeSpiritForDealtDamage = chargeDealt;
    internal.profile.chargeSpiritForTakenDamage = chargeTaken;
    const damage = [{
      type: "damageDealt",
      source: "friendly",
      target: "enemy",
      amount: 1,
      hpAfter: 9,
      elementMultiplier: 1,
    }];

    internal.suppressCommittedOpeningSpiritCharge = true;
    internal.applyPresentedSpiritReadiness(damage);
    expect(chargeDealt).not.toHaveBeenCalled();

    internal.suppressCommittedOpeningSpiritCharge = false;
    internal.applyPresentedSpiritReadiness(damage);
    expect(chargeDealt).toHaveBeenCalledOnce();
    expect(chargeDealt).toHaveBeenCalledWith(5, 10);
    expect(chargeTaken).not.toHaveBeenCalled();
  });

  it("requests exactly one localized NoSpirit message without a chooser or ordinary empty-slot feedback", async () => {
    const { spiritBackground, showMessagePopup, openSpiritMenu, notAllowed } =
      await makeBattleWithSpiritBackground();

    tapSpiritBackground(spiritBackground);

    expect(showMessagePopup).toHaveBeenCalledTimes(1);
    expect(showMessagePopup).toHaveBeenCalledWith("NoSpirit");
    expect(openSpiritMenu).not.toHaveBeenCalled();
    expect(notAllowed).not.toHaveBeenCalled();
  });

  it("does not request NoSpirit through the same owner route while a summon occupies the spirit slot", async () => {
    const { display, spiritBackground, showMessagePopup } = await makeBattleWithSpiritBackground();
    await display.notifySummonChanged({
      id: "t0s0:FireCub",
      name: "Fire Cub",
      spriteKey: "FireCub-hd",
      hp: 30,
      maxHp: 30,
    });

    tapSpiritBackground(spiritBackground);

    expect(display.summonDisplayState?.id).toBe("t0s0:FireCub");
    expect(showMessagePopup).not.toHaveBeenCalled();
  });

  it("restores an ended authoritative replay so the durable defeat decision can be presented", async () => {
    engineMocks.restoreBattleReplay.mockReturnValueOnce({
      session: {
        activeIdsOf: () => [],
        benchCountOf: () => 0,
      },
      step: { type: "ended", report: { winner: 1 } },
      events: [],
    } as never);

    const { node } = await makeBattleWithSpiritBackground();

    expect((node as unknown as { resumedStep: unknown }).resumedStep).toEqual({
      type: "ended",
      report: { winner: 1 },
    });
  });
});
