import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  emptyGuildQuestStateSnapshot,
  GuildQuestRuntime,
  WorldTripParty,
  baseStat,
  jobXpForLevel,
  type GuildQuestEventResult,
} from "@dib/engine";
import { loadQuestCatalog, resolveDataDir } from "@dib/gamedata";
import type { DungeonRunSnapshot } from "@dib/engine/dungeon-runtime";
import { GameData } from "@dib/gamedata/browser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
const items = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Items.json", import.meta.url), "utf8"));
const combines = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Combines.json", import.meta.url), "utf8"));
const licenses = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Licenses.json", import.meta.url), "utf8"));
import { PlayerRuntimeState } from "../src/player/playerRuntimeState.js";
import { SaveHealthMonitor } from "../src/player/saveHealth.js";
import {
  LocalDungeonTerminal,
  LocalDungeonTerminalContinuation,
  LocalDungeonTerminalRetryOwner,
  stageLocalDungeonRng,
  type LocalDungeonTerminalCheckpoint,
} from "../src/dungeon/localDungeonTerminal.js";
import { stageDungeonBattleReward } from "../src/dungeon/dungeonBattle.js";
import { mulberry32 } from "@dib/engine";

const data = GameData.fromRaw({
  monsters, jobs, abilities, abilityComponents, buffs, items, combines, licenses,
});

const questDataDir = resolveDataDir();
const questCatalog = loadQuestCatalog({
  has: (path) => path === "Quests.plist",
  plist: (path) => {
    if (path !== "Quests.plist") throw new Error(`unexpected quest path ${path}`);
    return JSON.parse(readFileSync(resolve(questDataDir, "Quests.json"), "utf8")) as unknown;
  },
});

function player(): PlayerRuntimeState {
  const party = new WorldTripParty(data, [{
    instanceId: "party-1",
    shortType: "FireCub",
    level: 10,
    cumulativeXp: jobXpForLevel(10, data.jobXpPenalty("FireCub")),
    currentHp: baseStat(data.monsterByShortType("FireCub"), "MaxHP", 10),
  }], data.license("Novice").battingOrderSize);
  return PlayerRuntimeState.world({
    heroLevel: 9,


    licenseBattingOrderSize: data.license("Novice").battingOrderSize,
    monsterPartyLevels: [10],
    silver: 300,
    gold: 150,
    captureCards: { 1: 1, 2: 0, 3: 0 },
    highestCapturedLevels: {},
    spiritReadiness: 1,
    spiritTierLevels: { Resistance: 0 },
  }, party);
}

const dungeon = {} as DungeonRunSnapshot;

describe("local dungeon terminal RNG staging", () => {
  it("leaves the live RNG identity and next draw unchanged when settlement is rejected", () => {
    const live = mulberry32(0x6b);
    const control = mulberry32(0x6b);
    expect(live.next()).toBe(control.next());

    const stage = stageLocalDungeonRng(live);
    stage.staged.next();
    expect(stage.rollback()).toBe(live);
    expect(live.next()).toBe(control.next());
  });

  it("adopts staged draws once without replaying them after settlement acceptance", () => {
    const live = mulberry32(0x6b);
    const control = mulberry32(0x6b);
    expect(live.next()).toBe(control.next());

    const stage = stageLocalDungeonRng(live);
    expect(stage.staged.next()).toBe(control.next());
    const adopted = stage.accept();
    expect(adopted).toBe(stage.staged);
    expect(adopted.next()).toBe(control.next());
    expect(() => stage.accept()).toThrow(/already adopted/);
  });

  it("keeps prospective WorldTrip consumers behind a re-anchorable accepted identity", () => {
    let active = mulberry32(0x6b);
    const stable = {
      fork: () => active.fork(),
      next: () => active.next(),
      intBelow: (n: number) => active.intBelow(n),
      chance: (p: number) => active.chance(p),
    };
    const stage = stageLocalDungeonRng(stable);
    stage.staged.next();
    const adopted = stage.accept((detached) => {
      active = detached as typeof active;
      return stable;
    });
    expect(adopted).toBe(stage.staged);

    active = mulberry32(0x12345678);
    const control = mulberry32(0x12345678);
    expect(stage.staged.next()).toBe(control.next());

    const nextTerminal = stageLocalDungeonRng(adopted);
    expect(nextTerminal.staged.next()).toBe(control.next());
  });
});

describe("local dungeon terminal retry ownership", () => {
  it("keeps a reachable retry owner after replacement activation retires the battle owner", async () => {
    const owner = new LocalDungeonTerminalRetryOwner();
    const continuation = new LocalDungeonTerminalContinuation();
    let terminalSaves = 1;
    let rewardApplications = 1;
    let continuationCalls = 0;
    let replacementActivated = false;
    let battleOwnerAlive = true;
    continuation.commit("flow", "victory", async () => {
      continuationCalls += 1;
      replacementActivated = true;
      battleOwnerAlive = false;
      if (continuationCalls === 1) throw new Error("replacement handoff failed");
    });

    await expect(continuation.resume("flow", "victory")).rejects.toThrow("replacement handoff failed");
    expect({ terminalSaves, rewardApplications, replacementActivated, battleOwnerAlive }).toEqual({
      terminalSaves: 1,
      rewardApplications: 1,
      replacementActivated: true,
      battleOwnerAlive: false,
    });

    owner.arm(() => {
      void continuation.resume("flow", "victory");
      return true;
    });
    expect(owner.hasPending()).toBe(true);
    expect(owner.retry()).toBe(true);
    await vi.waitFor(() => expect(continuationCalls).toBe(2));
    expect({ terminalSaves, rewardApplications, pending: owner.hasPending() }).toEqual({
      terminalSaves: 1,
      rewardApplications: 1,
      pending: false,
    });
  });
});

describe("LocalDungeonTerminal", () => {
  it("allocates capture IDs from detached terminal state and preserves the live serial on rejection", async () => {
    const live = player();
    let writes = 0;
    const terminal = new LocalDungeonTerminal({
      data,
      player: live,
      captureIdentity: {
        runSeed: 0x1244,
        route: { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
        captureSerial: 0,
      },
      persist: async () => {
        writes += 1;
        if (writes === 1) throw new Error("save rejected");
      },
    });

    const id = terminal.nextCaptureInstanceId("encounter-1", "Bat");
    expect(id).toContain("-1-Bat");
    expect(terminal.captureSerial).toBe(1);
    terminal.beginTerminalPreparation("victory");
    await expect(terminal.persist(dungeon)).rejects.toThrow("save rejected");
    expect(terminal.captureSerial).toBe(1);
    expect(terminal.nextCaptureInstanceId("encounter-1", "Slime")).toContain("-2-Slime");
  });

  it("keeps a landed terminal save accepted when a health observer throws", async () => {
    const live = player();
    const health = new SaveHealthMonitor();
    let throwOnUpdate = false;
    health.subscribe(() => {
      if (throwOnUpdate) throw new Error("save banner failed");
    });
    let durableWrites = 0;
    let accepted = 0;
    const terminal = new LocalDungeonTerminal({
      data,
      player: live,
      persist: async () => {
        durableWrites += 1;
        health.recordSuccess();
      },
      prepareApplication: () => ({
        accept: () => { accepted += 1; },
        rollback: () => undefined,
      }),
    });

    throwOnUpdate = true;
    terminal.beginTerminalPreparation("retreat");
    await terminal.persist(dungeon);
    terminal.commit();

    expect({ durableWrites, accepted, healthy: health.current.healthy }).toEqual({
      durableWrites: 1,
      accepted: 1,
      healthy: true,
    });
  });

  it("restores the prepared aggregate after checkpoint rejection and adopts it silently on commit", async () => {
    const live = player();
    let persistCalls = 0;
    const terminal = new LocalDungeonTerminal({
      data,
      player: live,
      persist: async (checkpoint) => {
        persistCalls += 1;
        expect(checkpoint.player.profile.gold).toBe(50);
        if (persistCalls === 1) throw new Error("save rejected");
      },
      prepareApplication: (_outcome, stagedPlayer) => ({
        accept: () => live.replaceStateSnapshot(data, stagedPlayer.stateSnapshot()),
        rollback: () => live.replaceStateSnapshot(data, beforeLive),
      }),
    });
    const beforeLive = live.stateSnapshot();

    terminal.player.resolveLocalSaveMe();
    terminal.beginTerminalPreparation("retreat");
    await expect(terminal.persist(dungeon)).rejects.toThrow("save rejected");

    expect(persistCalls).toBe(1);
    expect(terminal.player.stateSnapshot().profile.gold).toBe(50);
    expect(live.stateSnapshot()).toEqual(beforeLive);

    await terminal.persist(dungeon);
    terminal.commit();
    expect(persistCalls).toBe(2);
    expect(live.stateSnapshot().profile.gold).toBe(50);
    expect(live.stateSnapshot()).toEqual(terminal.player.stateSnapshot());
  });

  it("includes pending battle-reward ownership bookkeeping in the one checkpoint", async () => {
    const live = player();
    let checkpointPending: Readonly<Record<string, string>> | undefined;
    const terminal = new LocalDungeonTerminal({
      data,
      player: live,
      pendingBattleRewardKeys: { "treasure-1": "reward-1" },
      persist: async (checkpoint) => {
        checkpointPending = checkpoint.pendingBattleRewardKeys;
      },
    });
    terminal.beginTerminalPreparation("retreat");
    terminal.setPendingBattleReward("treasure-2", "reward-2");

    await terminal.persist(dungeon);

    expect(checkpointPending).toEqual({
      "treasure-1": "reward-1",
      "treasure-2": "reward-2",
    });
  });

  it("settles authored reward precedence, quest fallback, and duplicate consumption at the local terminal seam", async () => {
    const treasureAction = {
      kind: "treasure" as const,
      roomId: "room-1",
      treasure: { id: "treasure-1", guarded: true, loot: [{ kind: "silver" as const, amount: 7 }] },
    };
    const consumed: string[] = [];
    let committedCheckpoint: LocalDungeonTerminalCheckpoint | undefined;
    const terminal = new LocalDungeonTerminal({
      data,
      player: player(),
      quests: new GuildQuestRuntime(questCatalog, {
        ...emptyGuildQuestStateSnapshot(),
        receivedBattleRewardKeys: ["authored-key"],
      }),
      persist: async (checkpoint) => { committedCheckpoint = checkpoint; },
    });
    terminal.beginTerminalPreparation("victory");
    stageDungeonBattleReward(
      "victory",
      { battleRewardKey: "authored-key", questKey: "fallback-key" },
      { entryActions: [treasureAction], consumeTreasure: (id) => consumed.push(id) },
      terminal,
    );
    expect(consumed).toEqual(["treasure-1"]);
    expect(terminal.pendingBattleRewardSnapshot()).toEqual({});
    await terminal.persist(dungeon);
    terminal.commit();
    expect(committedCheckpoint?.quests?.receivedBattleRewardKeys).toContain("authored-key");

    let fallbackCheckpoint: LocalDungeonTerminalCheckpoint | undefined;
    const fallbackTerminal = new LocalDungeonTerminal({
      data,
      player: player(),
      quests: new GuildQuestRuntime(questCatalog, emptyGuildQuestStateSnapshot()),
      persist: async (checkpoint) => { fallbackCheckpoint = checkpoint; },
    });
    fallbackTerminal.beginTerminalPreparation("victory");
    stageDungeonBattleReward(
      "victory",
      { questKey: "fallback-key" },
      { entryActions: [treasureAction], consumeTreasure: (id) => consumed.push(id) },
      fallbackTerminal,
    );
    expect(fallbackTerminal.pendingBattleRewardSnapshot()).toEqual({ "treasure-1": "fallback-key" });
    await fallbackTerminal.persist(dungeon);
    fallbackTerminal.commit();
    expect(fallbackCheckpoint?.pendingBattleRewardKeys).toEqual({ "treasure-1": "fallback-key" });

    stageDungeonBattleReward(
      "retreat",
      { battleRewardKey: "retreat-key", questKey: "unused-key" },
      { entryActions: [treasureAction], consumeTreasure: (id) => consumed.push(id) },
      fallbackTerminal,
    );
    expect(consumed).toEqual(["treasure-1"]);
  });

  it("serializes an explicit empty pending map for defeat and restores ownership on rejection", async () => {
    const live = player();
    const checkpoints: Array<Readonly<Record<string, string>>> = [];
    let reject = true;
    const terminal = new LocalDungeonTerminal({
      data,
      player: live,
      pendingBattleRewardKeys: { "treasure-1": "reward-1" },
      persist: async (checkpoint) => {
        checkpoints.push(checkpoint.pendingBattleRewardKeys);
        if (reject) {
          reject = false;
          throw new Error("save rejected");
        }
      },
    });

    terminal.beginTerminalPreparation("defeat");
    await expect(terminal.persist(null)).rejects.toThrow("save rejected");
    expect(checkpoints).toEqual([{}]);

    // The actual BattleNode Retry starts a new terminal preparation after engine rollback.
    terminal.beginTerminalPreparation("defeat");
    await terminal.persist(null);
    terminal.commit();
    expect(checkpoints).toEqual([{}, {}]);
    expect(checkpoints[1]).toEqual({});
  });

  it("stages event presentation until commit and never duplicates it across save retry", async () => {
    const live = player();
    const liveQuests = new GuildQuestRuntime(questCatalog, {
      ...emptyGuildQuestStateSnapshot(),
      activeQuestNames: ["BeatRigel", "ClearNorthCave"],
    });
    let persistCalls = 0;
    const presentations: string[] = [];
    const terminal = new LocalDungeonTerminal({
      data,
      player: live,
      quests: liveQuests,
      persist: async () => {
        persistCalls += 1;
        if (persistCalls === 1) throw new Error("save rejected");
      },
      presentQuestEventResult: (_runtime, result) => {
        presentations.push(...result.notificationQuestNames);
      },
    });
    terminal.onQuestEvent({
      id: 9,
      battle: {
        questKey: "RigelBattle",
        uniqueKey: "fixed-rigel",
        friendlyTeamCount: 1,
        battingOrderSize: 1,
        difficultyModifier: 0,
      },
    });
    terminal.beginTerminalPreparation("victory");
    terminal.onDungeonRoomRosterUpdated("NorthCave", 1, [0]);
    expect(presentations).toEqual([]);
    await expect(terminal.persist(dungeon)).rejects.toThrow("save rejected");
    expect(presentations).toEqual([]);

    terminal.beginTerminalPreparation("victory");
    terminal.onDungeonRoomRosterUpdated("NorthCave", 1, [0]);
    await terminal.persist(dungeon);
    terminal.commit();
    await terminal.presentCommittedQuestEvents();
    await terminal.presentCommittedQuestEvents();
    expect(presentations).toEqual(expect.arrayContaining(["BeatRigel", "ClearNorthCave"]));
    expect(presentations.filter((name) => name === "BeatRigel")).toHaveLength(1);
    expect(presentations.filter((name) => name === "ClearNorthCave")).toHaveLength(1);
  });

  it("acknowledges each notification descriptor only after async delivery succeeds", async () => {
    const live = player();
    const liveQuests = new GuildQuestRuntime(questCatalog, emptyGuildQuestStateSnapshot());
    const delivered: string[] = [];
    let rejectSecond = true;
    const terminal = new LocalDungeonTerminal({
      data,
      player: live,
      quests: liveQuests,
      persist: async () => undefined,
      presentQuestEventResult: async (_runtime, result) => {
        const name = result.notificationQuestNames[0]!;
        delivered.push(name);
        if (name === "second" && rejectSecond) {
          rejectSecond = false;
          throw new Error("notification surface closed");
        }
      },
    });
    const descriptor = (name: string): GuildQuestEventResult => ({
      notificationQuestNames: [name],
      changedQuestNames: [],
    });
    terminal.stageQuestEventResult(descriptor("first"));
    terminal.stageQuestEventResult(descriptor("second"));
    terminal.stageQuestEventResult(descriptor("third"));
    terminal.beginTerminalPreparation("victory");
    await terminal.persist(dungeon);
    terminal.commit();

    await terminal.presentCommittedQuestEvents().catch((error: unknown) => {
      expect(error).toMatchObject({ message: "notification surface closed" });
    });
    await terminal.presentCommittedQuestEvents();
    await terminal.presentCommittedQuestEvents();

    expect(delivered).toEqual(["first", "second", "second", "third"]);
  });

  it("keeps real application owners unchanged when preparation or acceptance fails", async () => {
    const live = player();
    const before = live.stateSnapshot();
    const prepareFailure = new LocalDungeonTerminal({
      data,
      player: live,
      persist: async () => undefined,
      prepareApplication: () => { throw new Error("world preparation failed"); },
    });
    expect(() => prepareFailure.beginTerminalPreparation("defeat")).toThrow("world preparation failed");
    expect(live.stateSnapshot()).toEqual(before);

    const acceptanceFailure = new LocalDungeonTerminal({
      data,
      player: live,
      persist: async () => undefined,
      prepareApplication: () => ({
        accept: () => { throw new Error("application acceptance failed"); },
        rollback: () => undefined,
      }),
    });
    acceptanceFailure.beginTerminalPreparation("victory");
    await expect(acceptanceFailure.persist(dungeon)).rejects.toThrow("application acceptance failed");
    expect(live.stateSnapshot()).toEqual(before);
  });

  it("stages event 9 before event 4 and rolls event 4 back with a rejected checkpoint", async () => {
    const live = player();
    const liveQuests = new GuildQuestRuntime(questCatalog, {
      ...emptyGuildQuestStateSnapshot(),
      activeQuestNames: ["BeatRigel", "ClearNorthCave"],
    });
    let persistCalls = 0;
    const terminal = new LocalDungeonTerminal({
      data,
      player: live,
      quests: liveQuests,
      persist: async () => {
        persistCalls += 1;
        if (persistCalls === 1) throw new Error("save rejected");
      },
      prepareApplication: (_outcome, stagedPlayer, stagedQuests) => {
        const beforePlayer = live.stateSnapshot();
        const beforeQuests = liveQuests.stateSnapshot();
        return {
          accept: () => {
            live.replaceStateSnapshot(data, stagedPlayer.stateSnapshot());
            liveQuests.replaceStateSnapshot(stagedQuests!.stateSnapshot());
          },
          rollback: () => {
            live.replaceStateSnapshot(data, beforePlayer);
            liveQuests.replaceStateSnapshot(beforeQuests);
          },
        };
      },
    });
    terminal.onQuestEvent({
      id: 9,
      battle: {
        questKey: "RigelBattle",
        uniqueKey: "fixed-rigel",
        friendlyTeamCount: 1,
        battingOrderSize: 1,
        difficultyModifier: 0,
      },
    });
    terminal.beginTerminalPreparation("victory");
    const firstEvent4 = terminal.onDungeonRoomRosterUpdated("NorthCave", 1, [0]);
    await expect(terminal.persist(dungeon)).rejects.toThrow("save rejected");
    firstEvent4?.rollback?.();

    expect(terminal.quests!.questProgressCount("BeatRigel").current).toBe(1);
    expect(terminal.quests!.questProgressCount("ClearNorthCave").current).toBe(0);
    expect(liveQuests.questProgressCount("BeatRigel").current).toBe(0);

    terminal.onDungeonRoomRosterUpdated("NorthCave", 1, [0]);
    await terminal.persist(dungeon);
    terminal.commit();

    expect(terminal.quests!.questProgressCount("ClearNorthCave").current).toBe(1);
    expect(liveQuests.questProgressCount("BeatRigel").current).toBe(1);
    expect(liveQuests.questProgressCount("ClearNorthCave").current).toBe(1);
  });

  it.each(["victory", "retreat", "defeat"] as const)(
    "resumes a committed %s continuation without re-settlement",
    async (outcome) => {
      const continuation = new LocalDungeonTerminalContinuation();
      let settlementCalls = 0;
      let resumeCalls = 0;
      let rejectResume = true;
      continuation.commit("Test\u0000Dungeon\u00001\u0000flow-1", outcome, async () => {
        resumeCalls += 1;
        if (rejectResume) {
          rejectResume = false;
          throw new Error("continuation rejected");
        }
      });
      settlementCalls += 1;

      await expect(continuation.resume("Test\u0000Dungeon\u00001\u0000flow-1", outcome))
        .rejects.toThrow("continuation rejected");
      await continuation.resume("Test\u0000Dungeon\u00001\u0000flow-1", outcome);

      expect({ settlementCalls, resumeCalls }).toEqual({ settlementCalls: 1, resumeCalls: 2 });
      await expect(continuation.resume("Test\u0000Dungeon\u00001\u0000flow-1", outcome))
        .rejects.toThrow("no committed continuation");
    },
  );
});
