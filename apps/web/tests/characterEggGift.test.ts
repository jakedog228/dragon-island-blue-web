import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { WorldTripParty, mulberry32, type SoulStoneSetup, type PlayerMonsterInstance } from "@dib/engine";
import { GameData } from "@dib/gamedata/browser";
import { Container } from "pixi.js";
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
const items = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Items.json", import.meta.url), "utf8"));
const licenses = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Licenses.json", import.meta.url), "utf8"));
import { PlayerRuntimeState } from "../src/player/playerRuntimeState.js";
import { offerCharacterEgg, type PlayerReadyContext } from "../src/content/characterEggGift.js";
import type { EggHatchFlowOptions } from "../src/world/eggHatchFlow.js";
import { createLocalEggHatchSession } from "../src/world/eggHatchSession.js";

const { show } = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("../src/world/eggHatchFlow.js", () => ({ EggHatchFlow: { show } }));
const gd = GameData.fromRaw({ monsters, jobs, abilities, abilityComponents, buffs, items, licenses });
const modId = "test.character";
const flag = `mod:${modId}:character-egg:FireCub`;
const member = (shortType: string, index = 0): PlayerMonsterInstance => ({
  instanceId: `owned-${index}`, shortType, level: 1, cumulativeXp: 0, currentHp: 1,
});
const stone: SoulStoneSetup = { element: "Fire", level: 1, sourceType: "FireCub" };
function player(members = [member("BlueBabyDragon")], stones: SoulStoneSetup[] = []) {
  return PlayerRuntimeState.world({
    heroLevel: 1, monsterPartyLevels: [1], silver: 0, gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 }, spiritReadiness: 0, spiritTierLevels: {},
  }, new WorldTripParty(gd, members, 1, stones));
}
function setup(runtime = player()) {
  let finish!: () => void;
  let reject!: (error: Error) => void;
  const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
  const dispose = vi.fn();
  show.mockResolvedValue({ finished, dispose, debugState: { kind: "gold" } });
  const context: PlayerReadyContext = {
    player: runtime, game: { gd } as PlayerReadyContext["game"],
    stage: { root: new Container(), app: { ticker: {} } } as PlayerReadyContext["stage"],
    audio: {} as PlayerReadyContext["audio"], rng: mulberry32(23),
    nextMonsterInstanceId: type => `gift-${type}`,
    checkpoint: vi.fn(async () => {}), reveal: vi.fn(async () => {}), setDebugState: vi.fn(),
  };
  runtime.setChangeListener(() => { void context.checkpoint(); });
  return { context, finish, reject, dispose, options: () => show.mock.calls.at(-1)![0] as EggHatchFlowOptions };
}
beforeEach(() => show.mockReset());

describe("one-time character golden eggs", () => {
  it.each([
    ["active", [member("FireCub")], []],
    ["bench", [member("BlueBabyDragon"), member("FireCub", 1)], []],
    ["dead/injured", [{ ...member("FireCub"), currentHp: 0, injureTime: 1, healTime: 100 }], []],
    ["equipped stone", [{ ...member("BlueBabyDragon"), soulStone: stone }], []],
    ["pooled stone", [member("BlueBabyDragon")], [stone]],
  ] as const)("recognizes %s ownership and records eligibility as consumed", async (_name, members, stones) => {
    const s = setup(player([...members], [...stones]));
    await offerCharacterEgg(s.context, modId, "FireCub");
    expect(show).not.toHaveBeenCalled();
    expect(s.context.reveal).not.toHaveBeenCalled();
    expect(s.context.player.profile.hasTutorialFlag(flag)).toBe(true);
    expect(s.context.checkpoint).toHaveBeenCalled();
  });

  it.each(["keep", "feed"] as const)("offers an exclusive gold reel once, even after %s and reload", async action => {
    const s = setup();
    const work = offerCharacterEgg(s.context, modId, "FireCub");
    await vi.waitFor(() => expect(s.context.reveal).toHaveBeenCalledOnce());
    const opts = s.options();
    expect(opts.kind).toBe("gold");
    expect(opts.allowSecondSpin).toBe(false);
    expect(opts.scriptedProviders).toEqual([{ kind: "monster", shortType: "FireCub", level: 1, prizeMonster: false }]);
    expect(s.context.player.profile.hasTutorialFlag(flag)).toBe(false);
    await offerCharacterEgg(s.context, modId, "FireCub");
    expect(show).toHaveBeenCalledOnce();
    if (action === "keep") s.context.player.addJoinedMonster("gift", "FireCub", 1);
    opts.onStateChanged();
    expect(s.context.player.profile.hasTutorialFlag(flag)).toBe(true);
    s.finish();
    await work;
    const snapshot = s.context.player.stateSnapshot();
    // Simulate later consumption/release as well as a page reload: no owned FireCub remains.
    const restored = PlayerRuntimeState.fromStateSnapshot(gd, {
      ...snapshot, party: { kind: "world-trip-party", battingOrderSize: 1, monsters: [member("BlueBabyDragon")] },
    });
    await offerCharacterEgg({ ...s.context, player: restored }, modId, "FireCub");
    expect(show).toHaveBeenCalledOnce();
    expect(s.dispose).toHaveBeenCalledOnce();
    expect(s.context.setDebugState).toHaveBeenLastCalledWith(undefined);
  });

  it("does not confuse historical collection or a same-element stone with present ownership", async () => {
    const runtime = player([member("BlueBabyDragon")], [{ ...stone, sourceType: "RedBabyDragon" }]);
    runtime.profile.recordCapturedMonster("FireCub", 30);
    const s = setup(runtime);
    const work = offerCharacterEgg(s.context, modId, "FireCub");
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
    s.options().onStateChanged(); s.finish(); await work;
  });

  it("retries an interrupted unclaimed egg and does not block another character", async () => {
    const s = setup();
    const work = offerCharacterEgg(s.context, modId, "FireCub");
    const failed = expect(work).rejects.toThrow("interrupted");
    await vi.waitFor(() => expect(s.context.reveal).toHaveBeenCalledOnce());
    s.reject(new Error("interrupted")); await failed;
    expect(s.context.player.profile.hasTutorialFlag(flag)).toBe(false);
    const retry = setup(s.context.player);
    const again = offerCharacterEgg(retry.context, modId, "FireCub");
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
    retry.options().onStateChanged(); retry.finish(); await again;
    const other = setup(s.context.player);
    const second = offerCharacterEgg(other.context, "test.other", "WhiteBabyDragon");
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(3));
    other.options().onStateChanged(); other.finish(); await second;
  });

  it("uses normal golden-egg levels and can only land on the requested monster", async () => {
    const runtime = player();
    runtime.addJoinedMonster("high", "RedBabyDragon", 35);
    runtime.addJoinedMonster("second", "WhiteBabyDragon", 22);
    const s = setup(runtime);
    const work = offerCharacterEgg(s.context, modId, "FireCub");
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
    const opts = s.options();
    expect(opts.scriptedProviders![0]).toMatchObject({ shortType: "FireCub", level: 22 });
    for (const heldFrames of [91, 120, 240]) {
      const session = createLocalEggHatchSession({
        game: gd, kind: "gold", rng: mulberry32(heldFrames), allowSecondSpin: false,
        scriptedProviders: opts.scriptedProviders!, spendGold: () => { throw new Error("paid repeat"); },
        playerView: () => { throw new Error("random pool"); },
      });
      const spin = await session.begin();
      const release = await session.release(heldFrames);
      expect(spin.pool.providers).toEqual(opts.scriptedProviders);
      expect(spin.previewMonsterShortTypes.every(type => type === "FireCub")).toBe(true);
      expect(release.finalReelState.stopped).toBe(true);
      expect(session.canRepeat()).toBe(false);
    }
    s.options().onStateChanged(); s.finish(); await work;
  });
});
