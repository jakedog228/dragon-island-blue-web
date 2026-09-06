import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata/browser";
import type { CollectionGoalDefinition } from "@dib/gamedata/browser";
import { WorldTripParty, baseStat, jobXpForLevel, type Rng } from "@dib/engine";
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
const items = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Items.json", import.meta.url), "utf8"));
const combines = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Combines.json", import.meta.url), "utf8"));
const licenses = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Licenses.json", import.meta.url), "utf8"));
import {
  PlayerRuntimeState,
  type PlayerRuntimeStateSnapshot,
} from "../src/player/playerRuntimeState.js";
import { battingOrderSizeFor } from "@dib/player-domain";
import { recordDemoEvolutionHistory } from "../src/world/worldDemoState.js";
import { heroLevelForXp } from "@dib/engine";

const gd = GameData.fromRaw({
  monsters, jobs, abilities, abilityComponents, buffs, items, combines, licenses,
});

const profileConfig = {
  heroLevel: 9,

  licenseBattingOrderSize: gd.license("Novice").battingOrderSize,
  evolveChainOf: (shortType: string) => gd.evolveChainOrUndefined(shortType),
  monsterPartyLevels: [1],
  silver: 300,
  gold: 99,
  captureCards: { 1: 1, 2: 0, 3: 0 } as const,
  highestCapturedLevels: { Minotaur: 8 },
  spiritReadiness: 1,
  spiritTierLevels: { Resistance: 0 },
};

function party(): WorldTripParty {
  return new WorldTripParty(gd, [{
    instanceId: "party-1",
    shortType: "FireCub",
    level: 10,
    cumulativeXp: jobXpForLevel(10, gd.jobXpPenalty("FireCub")),
    currentHp: baseStat(gd.monsterByShortType("FireCub"), "MaxHP", 10),
  }], gd.license("Novice").battingOrderSize);
}

function collectionGoal(
  key: string,
  monsterTypes: readonly string[],
  items: CollectionGoalDefinition["treasureData"]["items"] = [],
): CollectionGoalDefinition {
  return {
    collectionType: "Base",
    key,
    monsterTypes,
    treasureData: {
      defaultSpawnChance: 1,
      levelScalor: 1,
      items,
    },
  };
}

function constantRng(chanceCalls: number[] = []): Rng {
  return {
    next: () => 0.5,
    intBelow: (n) => Math.min(n - 1, Math.floor(n / 2)),
    chance: (probability) => {
      chanceCalls.push(probability);
      return true;
    },
  };
}

function claimedGoalIds(snapshot: PlayerRuntimeStateSnapshot): readonly string[] {
  return snapshot.schemaVersion === 2 ? snapshot.claimedCollectionGoalIds : [];
}

describe("PlayerRuntimeState", () => {
  it("replaces a committed snapshot without notifying the live owner", () => {
    const live = PlayerRuntimeState.world(profileConfig, party());
    const staged = PlayerRuntimeState.fromStateSnapshot(gd, live.stateSnapshot());
    staged.profile.awardGold(17);
    staged.party!.applySaveMeRecovery();
    const notifications: number[] = [];
    live.setChangeListener(() => { notifications.push(1); });

    live.replaceStateSnapshot(gd, staged.stateSnapshot());

    expect(live.stateSnapshot()).toEqual(staged.stateSnapshot());
    expect(notifications).toEqual([]);
  });

  it("marks the Save Me tutorial before presentation and checkpoints only the first claim", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    let checkpoints = 0;
    runtime.setChangeListener(() => { checkpoints += 1; });

    expect(runtime.profile.hasTutorialFlag("SaveMe")).toBe(false);
    runtime.markSaveMeTutorialSeen();
    expect(runtime.profile.hasTutorialFlag("SaveMe")).toBe(true);
    expect(checkpoints).toBe(1);

    runtime.markSaveMeTutorialSeen();
    expect(checkpoints).toBe(1);
  });

  it("debits and recovers Save Me as one listener-visible durable transaction", () => {
    const defeatedParty = new WorldTripParty(gd, [
      {
        instanceId: "dead",
        shortType: "FireCub",
        level: 10,
        cumulativeXp: jobXpForLevel(10, gd.jobXpPenalty("FireCub")),
        currentHp: 0,
        injureTime: 10,
        healTime: 20,
        soulStone: { element: "Life", level: 10, sourceType: "SnowCub" },
      },
      {
        instanceId: "injured",
        shortType: "SnowCub",
        level: 12,
        cumulativeXp: jobXpForLevel(12, gd.jobXpPenalty("SnowCub")),
        currentHp: 7,
        injureTime: 30,
        healTime: 60,
      },
    ], 2);
    const runtime = PlayerRuntimeState.world({ ...profileConfig, gold: 100 }, defeatedParty);
    const snapshots: PlayerRuntimeStateSnapshot[] = [];
    runtime.setChangeListener(() => { snapshots.push(runtime.stateSnapshot()); });

    expect(runtime.resolveLocalSaveMe()).toEqual({ ok: true, goldCost: 100 });

    expect(runtime.profile.snapshot().gold).toBe(0);
    expect(defeatedParty.monster("dead")).toMatchObject({ currentHp: 144 });
    expect(defeatedParty.monster("injured")).toMatchObject({ currentHp: 157 });
    expect(defeatedParty.monster("dead")).not.toHaveProperty("injureTime");
    expect(defeatedParty.monster("injured")).not.toHaveProperty("healTime");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.profile.gold).toBe(0);
    expect(
      snapshots[0]!.party.kind === "world-trip-party"
        ? snapshots[0]!.party.monsters.map(({ currentHp }) => currentHp)
        : "wrong-kind",
    ).toEqual([144, 157]);

    runtime.profile.awardGold(1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]!.profile.gold).toBe(1);
  });

  it("leaves gold and the party untouched when local Save Me is unaffordable", () => {
    const defeatedParty = new WorldTripParty(gd, [{
      ...party().monster("party-1"),
      currentHp: 0,
      injureTime: 10,
      healTime: 20,
    }], 1);
    const runtime = PlayerRuntimeState.world({ ...profileConfig, gold: 99 }, defeatedParty);
    const before = runtime.stateSnapshot();
    let checkpoints = 0;
    runtime.setChangeListener(() => { checkpoints += 1; });

    expect(runtime.resolveLocalSaveMe()).toEqual({
      ok: false,
      reason: "insufficient-funds",
    });
    expect(runtime.stateSnapshot()).toEqual(before);
    expect(checkpoints).toBe(0);
  });

  it("claims a complete Collection goal, applies generated rewards, and checkpoints once", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const definition = collectionGoal("Collector", [], [
      { kind: "gold", levelScalor: 1 },
      {
        kind: "fixed",
        levelScalor: 1,
        data: {
          kind: "monsterJoin",
          shortType: "Spikey",
          jobLevel: 5,
          rawType: "DestroyOnPickup.MonsterJoin",
        },
      },
    ]);
    const chanceCalls: number[] = [];
    const allocationCalls: Array<[string, number]> = [];
    const snapshots: PlayerRuntimeStateSnapshot[] = [];
    runtime.setChangeListener(() => { snapshots.push(runtime.stateSnapshot()); });

    const result = runtime.claimCollectionGoal(
      definition,
      constantRng(chanceCalls),
      (shortType, level) => {
        allocationCalls.push([shortType, level]);
        return "collection-spikey";
      },
    );

    expect(result).toMatchObject({
      ok: true,
      progress: {
        goalId: "CollectionQuestCollector",
        owned: 0,
        total: 0,
        percentComplete: 100,
        complete: true,
        claimed: true,
      },
      rewards: [
        { kind: "gold", amount: 1 },
        { kind: "monsterJoin", shortType: "Spikey", jobLevel: 5 },
      ],
      applied: [
        { kind: "gold", amount: 1, balance: 100 },
        { kind: "monsterJoin", shortType: "Spikey", jobLevel: 5, instanceId: "collection-spikey" },
      ],
    });
    expect(chanceCalls).toEqual([1, 1]);
    expect(allocationCalls).toEqual([["Spikey", 5]]);
    expect(runtime.profile.snapshot().gold).toBe(100);
    expect(runtime.party!.monster("collection-spikey")).toMatchObject({
      shortType: "Spikey",
      level: 5,
    });
    expect(snapshots).toHaveLength(1);
    expect(claimedGoalIds(snapshots[0]!)).toEqual(["CollectionQuestCollector"]);
    expect(snapshots[0]!.profile.gold).toBe(100);

    const beforeRepeat = runtime.stateSnapshot();
    expect(runtime.claimCollectionGoal(
      definition,
      constantRng(chanceCalls),
      () => { throw new Error("repeat claim allocated a monster ID"); },
    )).toMatchObject({
      ok: false,
      reason: "already-claimed",
      progress: { claimed: true, complete: true },
    });
    expect(runtime.stateSnapshot()).toEqual(beforeRepeat);
    expect(chanceCalls).toEqual([1, 1]);
    expect(snapshots).toHaveLength(1);
  });

  it("mirrors an Official Collection claim from the authority's own rewards and minted ids", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const definition = collectionGoal("Collector", [], [
      { kind: "gold", levelScalor: 1 },
    ]);
    const snapshots: PlayerRuntimeStateSnapshot[] = [];
    runtime.setChangeListener(() => { snapshots.push(runtime.stateSnapshot()); });

    // Exactly what `applyCollectionClaim` emits: the settled reward list plus the ids it minted.
    const result = runtime.mirrorCommittedCollectionClaim(
      definition,
      [
        { kind: "gold", amount: 4 },
        { kind: "monsterJoin", shortType: "Spikey", jobLevel: 5 },
        { kind: "monsterEgg" },
      ],
      ["authority-spikey"],
    );

    expect(result).toMatchObject({
      progress: { goalId: "CollectionQuestCollector", complete: true, claimed: true },
      // The Egg stays out of `applied` — it is a server continuation the hatch reel settles.
      applied: [
        { kind: "gold", amount: 4, balance: 103 },
        { kind: "monsterJoin", shortType: "Spikey", jobLevel: 5, instanceId: "authority-spikey" },
      ],
      pendingEggs: ["gold"],
    });
    expect(runtime.profile.snapshot().gold).toBe(103);
    expect(runtime.party!.monster("authority-spikey")).toMatchObject({
      shortType: "Spikey",
      level: 5,
    });
    // One checkpoint for the whole mirror, exactly as the local claim does.
    expect(snapshots).toHaveLength(1);
    expect(claimedGoalIds(snapshots[0]!)).toEqual(["CollectionQuestCollector"]);
  });

  it("refuses to mirror a claim whose committed monster ids do not match its join rewards", () => {
    const definition = collectionGoal("Collector", []);
    const missing = PlayerRuntimeState.world(profileConfig, party());
    expect(() => missing.mirrorCommittedCollectionClaim(
      definition,
      [{ kind: "monsterJoin", shortType: "Spikey", jobLevel: 5 }],
      [],
    )).toThrow(/omitted a committed monster id/i);

    const surplus = PlayerRuntimeState.world(profileConfig, party());
    expect(() => surplus.mirrorCommittedCollectionClaim(
      definition,
      [{ kind: "gold", amount: 1 }],
      ["authority-spikey"],
    )).toThrow(/committed 1 monsters for 0 join rewards/i);
  });

  it("exposes current Collection progress without exposing or mutating the claims registry", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const definition = collectionGoal("ReadOnlyProgress", []);
    const before = runtime.stateSnapshot();

    expect(runtime.collectionGoalProgress(definition)).toEqual({
      goalId: "CollectionQuestReadOnlyProgress",
      owned: 0,
      total: 0,
      percentComplete: 100,
      complete: true,
      claimed: false,
    });
    expect(runtime.stateSnapshot()).toEqual(before);

    expect(runtime.claimCollectionGoal(
      definition,
      constantRng(),
      () => { throw new Error("empty reward allocated a monster ID"); },
    )).toMatchObject({ ok: true });
    expect(runtime.collectionGoalProgress(definition)).toMatchObject({
      goalId: "CollectionQuestReadOnlyProgress",
      complete: true,
      claimed: true,
    });
  });

  it("returns incomplete without consuming RNG, allocating IDs, or mutating durable state", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const definition = collectionGoal("NeedsFireCub", ["FireCub"], [
      { kind: "gold", levelScalor: 1 },
    ]);
    const before = runtime.stateSnapshot();
    let checkpoints = 0;
    runtime.setChangeListener(() => { checkpoints += 1; });

    expect(runtime.claimCollectionGoal(
      definition,
      { ...constantRng(), chance: () => { throw new Error("incomplete goal consumed RNG"); } },
      () => { throw new Error("incomplete goal allocated a monster ID"); },
    )).toMatchObject({
      ok: false,
      reason: "incomplete",
      progress: {
        goalId: "CollectionQuestNeedsFireCub",
        owned: 0,
        total: 1,
        percentComplete: 0,
        complete: false,
        claimed: false,
      },
    });
    expect(runtime.stateSnapshot()).toEqual(before);
    expect(checkpoints).toBe(0);
  });

  it("collision-checks every MonsterJoin ID before applying any generated reward", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const definition = collectionGoal("DuplicateJoinIds", [], [
      {
        kind: "fixed",
        levelScalor: 1,
        data: {
          kind: "monsterJoin",
          shortType: "Spikey",
          jobLevel: 5,
          rawType: "DestroyOnPickup.MonsterJoin",
        },
      },
      {
        kind: "fixed",
        levelScalor: 1,
        data: {
          kind: "monsterJoin",
          shortType: "Teddy",
          jobLevel: 6,
          rawType: "DestroyOnPickup.MonsterJoin",
        },
      },
    ]);
    const snapshots: PlayerRuntimeStateSnapshot[] = [];
    runtime.setChangeListener(() => { snapshots.push(runtime.stateSnapshot()); });

    expect(() => runtime.claimCollectionGoal(
      definition,
      constantRng(),
      () => "duplicate-join",
    )).toThrow(/duplicate Collection MonsterJoin ID duplicate-join/);
    expect(runtime.party!.monsters().map(({ instanceId }) => instanceId)).toEqual(["party-1"]);
    expect(snapshots).toHaveLength(1);
    expect(claimedGoalIds(snapshots[0]!)).toEqual(["CollectionQuestDuplicateJoinIds"]);
  });

  it.each([
    ["egg", "silver"],
    ["monsterEgg", "gold"],
  ] as const)(
    "hands an authored fixed %s to the hatch presentation instead of settling it",
    (kind, hatchKind) => {
      const runtime = PlayerRuntimeState.world(profileConfig, party());
      const definition = collectionGoal("UnsupportedEgg", [], [{
        kind: "fixed",
        levelScalor: 1,
        data: kind === "egg"
          ? { kind: "egg", rawType: "DestroyOnPickup.Egg" }
          : { kind: "monsterEgg", rawType: "DestroyOnPickup.MonsterEgg" },
      }]);
      const beforeProfile = runtime.profile.snapshot();
      let checkpoints = 0;
      runtime.setChangeListener(() => { checkpoints += 1; });

      const result = runtime.claimCollectionGoal(
        definition,
        constantRng(),
        () => { throw new Error("an Egg reward allocated a monster ID"); },
      );

      if (!result.ok) throw new Error("a complete unclaimed goal must claim");
      // `Egg.destroyFromPickup` is presentation; the claim itself settles nothing for it.
      expect(result.pendingEggs).toEqual([hatchKind]);
      expect(result.applied).toEqual([]);
      expect(result.rewards).toHaveLength(1);
      // The durable claim is the one thing the source records before generation, so it — and only
      // it — reaches state, in exactly one checkpoint.
      expect(result.progress.claimed).toBe(true);
      expect(checkpoints).toBe(1);
      expect(runtime.profile.snapshot()).toEqual(beforeProfile);
    },
  );

  it("persists the native claim-before-generation mutation when reward generation throws", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const definition = collectionGoal("GenerationFailure", [], [
      { kind: "gold", levelScalor: 1 },
    ]);
    const snapshots: PlayerRuntimeStateSnapshot[] = [];
    runtime.setChangeListener(() => { snapshots.push(runtime.stateSnapshot()); });

    expect(() => runtime.claimCollectionGoal(
      definition,
      { ...constantRng(), chance: () => { throw new Error("rng failed"); } },
      () => "unused",
    )).toThrow(/rng failed/);
    expect(snapshots).toHaveLength(1);
    expect(claimedGoalIds(snapshots[0]!)).toEqual(["CollectionQuestGenerationFailure"]);
    expect(runtime.profile.snapshot().gold).toBe(99);

    runtime.profile.awardGold(1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]!.profile.gold).toBe(100);
  });

  it("spends gold and clears an injury in one observable runtime checkpoint", () => {
    const injuredParty = new WorldTripParty(gd, [{
      ...party().monster("party-1"),
      injureTime: 100,
      healTime: 200,
    }], 1);
    const runtime = PlayerRuntimeState.world(profileConfig, injuredParty);
    const snapshots: PlayerRuntimeStateSnapshot[] = [];
    runtime.setChangeListener(() => { snapshots.push(runtime.stateSnapshot()); });
    expect(runtime.healPartyMonster("party-1", 150)).toEqual({ ok: true, cost: 25 });
    expect(runtime.profile.snapshot().gold).toBe(74);
    expect(injuredParty.monster("party-1").injureTime).toBeUndefined();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.profile.gold).toBe(74);
    expect(
      snapshots[0]!.party.kind === "world-trip-party"
        ? snapshots[0]!.party.monsters[0]!.injureTime
        : "wrong-kind",
    ).toBeUndefined();
  });

  it("mirrors the exact server-committed injury price without consulting the client clock", () => {
    const injured = new WorldTripParty(gd, [{
      ...party().monster("party-1"),
      injureTime: 100,
      healTime: 400,
    }], 1);
    const runtime = PlayerRuntimeState.world({ ...profileConfig, gold: 100 }, injured);

    expect(runtime.healPartyMonsterAtCost("party-1", 37, 40)).toEqual({ ok: true, cost: 37 });
    expect(runtime.profile.snapshot().gold).toBe(40);
    expect(injured.monster("party-1").injureTime).toBeUndefined();
  });

  it("does not clear an injury when the profile cannot afford its heal cost", () => {
    const expensiveParty = new WorldTripParty(gd, [{
      ...party().monster("party-1"),
      level: 150,
      cumulativeXp: jobXpForLevel(150, gd.jobXpPenalty("FireCub")),
      currentHp: baseStat(gd.monsterByShortType("FireCub"), "MaxHP", 150),
      injureTime: 100,
      healTime: 200,
    }], 1);
    const runtime = PlayerRuntimeState.world({ ...profileConfig, gold: 24 }, expensiveParty);
    expect(runtime.healPartyMonster("party-1", 150)).toEqual({ ok: false, cost: 75 });
    expect(expensiveParty.monster("party-1").injureTime).toBe(100);
    expect(runtime.profile.snapshot().gold).toBe(24);
  });

  it("keeps the trip party authoritative for profile and collection reads", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const battleParty = runtime.battleParty()!;
    expect(runtime.profile.capturePartyLevel()).toBe(10);
    expect(runtime.profile.highestRegisteredLevel("FireCub")).toBe(0);
    expect(runtime.profile.highestOwnedLevel("FireCub")).toBe(10);
    expect(runtime.collection.hasCapturedSimpleType("FireCub")).toBe(false);
    expect(runtime.collection.hasCapturedSimpleType("Minotaur")).toBe(true);

    battleParty.awardXp(
      "party-1",
      jobXpForLevel(11, gd.jobXpPenalty("FireCub")) - jobXpForLevel(10, gd.jobXpPenalty("FireCub")),
    );
    battleParty.addCapturedMonster({ instanceId: "capture-1", shortType: "SnowCub", level: 15 });
    expect(runtime.profile.capturePartyLevel()).toBe(15);
    expect(runtime.profile.highestRegisteredLevel("FireCub")).toBe(11);
    expect(runtime.profile.highestRegisteredLevel("SnowCub")).toBe(15);
    expect(runtime.collection.hasCapturedSimpleType("SnowCub")).toBe(true);
  });

  it("adds a Guild MonsterJoin reward to reserves and durable collection history", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const joined = runtime.addJoinedMonster("quest-wolf", "Wolf", 2);
    expect(joined).toMatchObject({
      instanceId: "quest-wolf",
      shortType: "Wolf",
      level: 2,
    });
    expect(runtime.party!.monsters().map(({ instanceId }) => instanceId)).toEqual([
      "party-1",
      "quest-wolf",
    ]);
    expect(runtime.collection.hasCapturedSimpleType("Wolf")).toBe(true);
    expect(runtime.profile.highestRegisteredLevel("Wolf")).toBe(2);
  });

  it("round-trips complete player-owned state through a JSON-safe checkpoint", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    runtime.profile.spendCaptureCard(1);
    runtime.profile.useSpirit("Resistance");
    runtime.battleParty()!.addCapturedMonster({ instanceId: "capture-1", shortType: "SnowCub", level: 15 });

    const serialized = JSON.stringify(runtime.stateSnapshot());
    const restored = PlayerRuntimeState.fromStateSnapshot(
      gd,
      JSON.parse(serialized) as PlayerRuntimeStateSnapshot,
    );
    expect(restored.stateSnapshot()).toEqual(runtime.stateSnapshot());
    expect(restored.profile.highestRegisteredLevel("SnowCub")).toBe(15);
    expect(restored.profile.hasSummonedSpiritThisTrip("Resistance")).toBe(true);

    restored.party!.addCapturedMonster({ instanceId: "capture-2", shortType: "Minotaur", level: 18 });
    expect(restored.profile.capturePartyLevel()).toBe(18);
    expect(runtime.profile.capturePartyLevel()).toBe(15);
  });

  it("migrates runtime schema 1 to no Collection claims without changing profile schema 8", () => {
    const current = PlayerRuntimeState.world(profileConfig, party()).stateSnapshot();
    const legacy: PlayerRuntimeStateSnapshot = {
      schemaVersion: 1,
      profile: current.profile,
      party: current.party,
    };

    const restored = PlayerRuntimeState.fromStateSnapshot(gd, legacy);
    expect(restored.stateSnapshot()).toMatchObject({
      schemaVersion: 2,
      profile: { schemaVersion: 8 },
      claimedCollectionGoalIds: [],
    });
  });

  it("round-trips the exact sorted Collection claim IDs through runtime schema 2", () => {
    const current = PlayerRuntimeState.world(profileConfig, party()).stateSnapshot();
    const snapshot: PlayerRuntimeStateSnapshot = {
      schemaVersion: 2,
      profile: current.profile,
      party: current.party,
      claimedCollectionGoalIds: [
        "CollectionQuestCollector",
        "CollectionQuestUsualSuspects",
      ],
    };

    const restored = PlayerRuntimeState.fromStateSnapshot(
      gd,
      JSON.parse(JSON.stringify(snapshot)) as PlayerRuntimeStateSnapshot,
    );
    expect(restored.stateSnapshot()).toEqual(snapshot);
  });

  it("round-trips the town editor's owned soul-stone pool and equipped stones", () => {
    const editorParty = new WorldTripParty(gd, [
      {
        instanceId: "party-1",
        shortType: "FireCub",
        level: 10,
        cumulativeXp: jobXpForLevel(10, gd.jobXpPenalty("FireCub")),
        currentHp: baseStat(gd.monsterByShortType("FireCub"), "MaxHP", 10),
      },
      {
        instanceId: "party-2",
        shortType: "SnowCub",
        level: 12,
        cumulativeXp: jobXpForLevel(12, gd.jobXpPenalty("SnowCub")),
        currentHp: baseStat(gd.monsterByShortType("SnowCub"), "MaxHP", 12),
      },
    ], gd.license("Novice").battingOrderSize);
    const runtime = PlayerRuntimeState.world(profileConfig, editorParty);

    // Convert To Soul Stone (destroys party-2, mints its stone) then Insert onto party-1.
    const stone = editorParty.convertToSoulStone("party-2");
    editorParty.insertSoulStone("party-1", 0);
    expect(editorParty.monster("party-1").soulStone).toEqual(stone);

    const restored = PlayerRuntimeState.fromStateSnapshot(
      gd,
      JSON.parse(JSON.stringify(runtime.stateSnapshot())) as PlayerRuntimeStateSnapshot,
    );
    expect(restored.party!.monster("party-1").soulStone).toEqual(stone);
    expect(restored.party!.ownedSoulStones()).toEqual([]);
    expect(restored.stateSnapshot()).toEqual(runtime.stateSnapshot());

    // A pre-editor snapshot (no soulStones field) restores with an empty pool.
    const legacy = JSON.parse(JSON.stringify(runtime.stateSnapshot())) as {
      player?: unknown;
      party: { soulStones?: unknown };
    } & PlayerRuntimeStateSnapshot;
    delete (legacy.party as { soulStones?: unknown }).soulStones;
    const legacyRestored = PlayerRuntimeState.fromStateSnapshot(gd, legacy);
    expect(legacyRestored.party!.ownedSoulStones()).toEqual([]);
  });

  it("gates combining on recipe ownership and checkpoints quest/party/registration state once", () => {
    const mergeParty = new WorldTripParty(gd, [
      {
        instanceId: "bitewing",
        shortType: "Bitewing",
        level: 12,
        cumulativeXp: jobXpForLevel(12, gd.jobXpPenalty("Bitewing")),
        currentHp: baseStat(gd.monsterByShortType("Bitewing"), "MaxHP", 12),
      },
      {
        instanceId: "keeper",
        shortType: "FireCub",
        level: 10,
        cumulativeXp: jobXpForLevel(10, gd.jobXpPenalty("FireCub")),
        currentHp: baseStat(gd.monsterByShortType("FireCub"), "MaxHP", 10),
      },
      {
        instanceId: "wolf",
        shortType: "Wolf",
        level: 8,
        cumulativeXp: jobXpForLevel(8, gd.jobXpPenalty("Wolf")),
        currentHp: baseStat(gd.monsterByShortType("Wolf"), "MaxHP", 8),
      },
    ], 2, [], 2);
    const runtime = PlayerRuntimeState.world(profileConfig, mergeParty);
    expect(() =>
      runtime.combineMonsters("combined", "Carnoraptor", "bitewing", "wolf"),
    ).toThrow(/not learned/);
    expect(mergeParty.monsters().map((monster) => monster.instanceId)).toEqual([
      "bitewing",
      "keeper",
      "wolf",
    ]);

    runtime.profile.learnCombineRecipe("Carnoraptor");
    let checkpoints = 0;
    let questMembers: readonly string[] = [];
    runtime.setChangeListener(() => { checkpoints += 1; });
    runtime.setQuestEventListener((event) => {
      expect(event).toMatchObject({
        eventId: 8,
        target1: { instanceId: "bitewing" },
        target2: { instanceId: "wolf" },
      });
      questMembers = mergeParty.monsters().map((monster) => monster.instanceId);
    });
    const heroBefore = runtime.profile.heroTotalHighestLevels;
    const result = runtime.combineMonsters("combined", "Carnoraptor", "bitewing", "wolf");

    expect(questMembers).toEqual(["bitewing", "keeper", "wolf", "combined"]);
    expect(result.monster).toMatchObject({ shortType: "Carnoraptor", level: 1 });
    expect(mergeParty.battingOrderMonsters().map((monster) => monster.instanceId)).toEqual([
      "keeper",
      "combined",
    ]);
    expect(mergeParty.reserveMonsters()).toEqual([]);
    expect(runtime.profile.highestRegisteredLevel("Carnoraptor")).toBe(1);
    expect(runtime.profile.heroTotalHighestLevels).toBe(heroBefore + 1);
    expect(checkpoints).toBe(1);

    const restored = PlayerRuntimeState.fromStateSnapshot(
      gd,
      JSON.parse(JSON.stringify(runtime.stateSnapshot())) as PlayerRuntimeStateSnapshot,
    );
    expect(restored.profile.hasCombineRecipe("Carnoraptor")).toBe(true);
    expect(restored.party!.monsters()).toEqual(runtime.party!.monsters());
    expect(restored.party!.battingOrderLength()).toBe(2);
  });

  it("still checkpoints once when a combined result was already registered above level 1", () => {
    const mergeParty = new WorldTripParty(gd, [
      {
        instanceId: "bitewing",
        shortType: "Bitewing",
        level: 12,
        cumulativeXp: jobXpForLevel(12, gd.jobXpPenalty("Bitewing")),
        currentHp: baseStat(gd.monsterByShortType("Bitewing"), "MaxHP", 12),
      },
      {
        instanceId: "wolf",
        shortType: "Wolf",
        level: 8,
        cumulativeXp: jobXpForLevel(8, gd.jobXpPenalty("Wolf")),
        currentHp: baseStat(gd.monsterByShortType("Wolf"), "MaxHP", 8),
      },
    ], 2);
    const runtime = PlayerRuntimeState.world(profileConfig, mergeParty);
    runtime.profile.learnCombineRecipe("Carnoraptor");
    runtime.profile.recordCapturedMonster("Carnoraptor", 5);
    let checkpoints = 0;
    runtime.setChangeListener(() => { checkpoints += 1; });

    runtime.combineMonsters("combined", "Carnoraptor", "bitewing", "wolf");
    expect(runtime.profile.highestRegisteredLevel("Carnoraptor")).toBe(5);
    expect(checkpoints).toBe(1);
  });

  it("rejects a learned recipe that names a roster monster without an authored recipe", () => {
    const snapshot = PlayerRuntimeState.world(profileConfig, party()).stateSnapshot();
    if (snapshot.profile.schemaVersion !== 8) throw new Error("expected current profile schema");
    const corrupt: PlayerRuntimeStateSnapshot = {
      ...snapshot,
      profile: {
        ...snapshot.profile,
        // FireCub is valid selected-package roster data, but is not a Combines result.
        learnedCombineRecipes: ["FireCub"],
      },
    };

    expect(() => PlayerRuntimeState.fromStateSnapshot(gd, corrupt))
      .toThrow(/no combine recipe for result: FireCub/);
  });

  it("ignores optional inventory, recipe, and spirit registrations absent from current content", () => {
    const snapshot = PlayerRuntimeState.world(profileConfig, party()).stateSnapshot();
    if (snapshot.profile.schemaVersion !== 8) throw new Error("expected current profile schema");
    const sequence = snapshot.profile.inventory.nextItemSequence;
    const foreign: PlayerRuntimeStateSnapshot = {
      ...snapshot,
      profile: {
        ...snapshot.profile,
        inventory: {
          ...snapshot.profile.inventory,
          nextItemSequence: sequence + 1,
          looseItems: [
            ...snapshot.profile.inventory.looseItems,
            {
              kind: "usable",
              id: `item-${sequence}`,
              definitionPath: "Mods.Missing.Trinket",
              instanceName: "Trinket",
              level: 1,
            },
          ],
        },
        learnedCombineRecipes: [
          ...snapshot.profile.learnedCombineRecipes,
          "MissingModMonster",
        ],
        spiritSavedXp: { ...snapshot.profile.spiritSavedXp, MissingModMonster: 12 },
        spiritsUsedThisTrip: [
          ...snapshot.profile.spiritsUsedThisTrip,
          "MissingModMonster",
        ],
      },
    };

    const restored = PlayerRuntimeState.fromStateSnapshot(gd, foreign);

    expect(restored.profile.inventory.allItems().some(
      (item) => item.definitionPath === "Mods.Missing.Trinket",
    )).toBe(false);
    expect(restored.profile.hasCombineRecipe("MissingModMonster")).toBe(false);
    expect(restored.profile.spiritSnapshot().spirits.some(
      (spirit) => spirit.shortType === "MissingModMonster",
    )).toBe(false);
  });

  it("does not checkpoint or register a result when the quest listener rejects the transaction", () => {
    const mergeParty = new WorldTripParty(gd, [
      {
        instanceId: "bitewing",
        shortType: "Bitewing",
        level: 12,
        cumulativeXp: jobXpForLevel(12, gd.jobXpPenalty("Bitewing")),
        currentHp: baseStat(gd.monsterByShortType("Bitewing"), "MaxHP", 12),
      },
      {
        instanceId: "wolf",
        shortType: "Wolf",
        level: 8,
        cumulativeXp: jobXpForLevel(8, gd.jobXpPenalty("Wolf")),
        currentHp: baseStat(gd.monsterByShortType("Wolf"), "MaxHP", 8),
      },
    ], 2);
    const runtime = PlayerRuntimeState.world(profileConfig, mergeParty);
    runtime.profile.learnCombineRecipe("Carnoraptor");
    let checkpoints = 0;
    runtime.setChangeListener(() => { checkpoints += 1; });
    runtime.setQuestEventListener(() => { throw new Error("quest adapter failed"); });

    expect(() =>
      runtime.combineMonsters("combined", "Carnoraptor", "bitewing", "wolf"),
    ).toThrow(/quest adapter failed/);
    expect(mergeParty.monsters().map((monster) => monster.instanceId)).toEqual(["bitewing", "wolf"]);
    expect(runtime.profile.highestRegisteredLevel("Carnoraptor")).toBe(0);
    expect(checkpoints).toBe(0);
  });

  it("persists no lineup-length or editor-session arrays and derives the prefix on restore", () => {
    const runtime = PlayerRuntimeState.world(profileConfig, party());
    const snapshot = runtime.stateSnapshot();
    expect(snapshot.party).not.toHaveProperty("battingOrderLength");
    expect(snapshot.party).not.toHaveProperty("battingOrderSlotIds");
    expect(snapshot.party).not.toHaveProperty("reserveOrderIds");

    const restored = PlayerRuntimeState.fromStateSnapshot(
      gd,
      JSON.parse(JSON.stringify(snapshot)) as PlayerRuntimeStateSnapshot,
    );
    expect(restored.party!.battingOrderLength()).toBe(1);


    expect(restored.party!.battingOrderSize).toBe(
      battingOrderSizeFor(gd.license("Novice").battingOrderSize, 9),
    );
    expect(restored.party!.battingOrderSlotIds())
      .toEqual(["party-1", ...Array(restored.party!.battingOrderSize - 1).fill(null)]);

    const partial = JSON.parse(JSON.stringify(snapshot)) as PlayerRuntimeStateSnapshot & {
      party: { battingOrderSlotIds?: readonly (string | null)[] };
    };
    partial.party.battingOrderSlotIds = [null];
    expect(() => PlayerRuntimeState.fromStateSnapshot(gd, partial)).toThrow(/requires both/);

    // A save written before the prefix was derived can carry a shorter length. It is still
    // validated, but `min(battingOrderSize, count)` decides the lineup on load.
    const legacy = JSON.parse(JSON.stringify(snapshot)) as PlayerRuntimeStateSnapshot & {
      party: { battingOrderLength?: number };
    };
    legacy.party.battingOrderLength = 0;
    expect(PlayerRuntimeState.fromStateSnapshot(gd, legacy).party!.battingOrderLength()).toBe(1);
  });

  it("round-trips only compact durable order and keeps every member the prefix reaches", () => {
    const setup = [
      ["a", "FireCub", 10],
      ["b", "SnowCub", 12],
      ["c", "Minotaur", 8],
    ] as const;
    const editorParty = new WorldTripParty(gd, setup.map(([instanceId, shortType, level]) => ({
      instanceId,
      shortType,
      level,
      cumulativeXp: jobXpForLevel(level, gd.jobXpPenalty(shortType)),
      currentHp: baseStat(gd.monsterByShortType(shortType), "MaxHP", level),
    })), 5);
    editorParty.moveBattingOrderMemberToReserves(1, 0);
    const runtime = PlayerRuntimeState.world(profileConfig, editorParty);
    const restored = PlayerRuntimeState.fromStateSnapshot(
      gd,
      JSON.parse(JSON.stringify(runtime.stateSnapshot())) as PlayerRuntimeStateSnapshot,
    );
    expect(restored.party!.battingOrderSlotIds())
      .toEqual(["a", "c", "b", ...Array(restored.party!.battingOrderSize - 3).fill(null)]);
    expect(restored.party!.reserveOrderIds()).toEqual([]);
    expect(restored.party!.projectAliveBattingPrefix().map((member) => member.sourceInstanceId))
      .toEqual(["a", "c", "b"]);
  });

  it("migrates the short-lived explicit-hole snapshot fields by compacting active IDs", () => {
    const snapshot = PlayerRuntimeState.world(profileConfig, party()).stateSnapshot();
    if (snapshot.party.kind !== "world-trip-party") throw new Error("expected world party snapshot");
    const transitional: PlayerRuntimeStateSnapshot = {
      ...snapshot,
      party: {
        ...snapshot.party,
        battingOrderSize: 3,
        battingOrderSlotIds: ["party-1", null, null],
        reserveOrderIds: [],
      },
    };
    const restored = PlayerRuntimeState.fromStateSnapshot(gd, transitional);


    expect(restored.party!.battingOrderSize).toBe(
      battingOrderSizeFor(gd.license("Novice").battingOrderSize, 9),
    );
    expect(restored.party!.battingOrderSlotIds())
      .toEqual(["party-1", ...Array(restored.party!.battingOrderSize - 1).fill(null)]);
    expect(restored.party!.reserveOrderIds()).toEqual([]);
  });

  it("reconstructs evolution-ancestor history for a pre-evolved demo party member (registration + hero XP)", () => {
    // Archdemon's chain is FallenAngel ->(16) Demon ->(53) Archdemon (Monsters.json). A real save
    // that owns an Archdemon necessarily recorded FallenAngel and Demon along the way; the
    // directly-configured demo party has no such history, so recordDemoEvolutionHistory fabricates it
    // through the ordinary capture write path.
    const archdemonParty = new WorldTripParty(gd, [{
      instanceId: "party-1",
      shortType: "Archdemon",
      level: 60,
      cumulativeXp: jobXpForLevel(60, gd.jobXpPenalty("Archdemon")),
      currentHp: baseStat(gd.monsterByShortType("Archdemon"), "MaxHP", 60),
    }], 1);

    const runtime = PlayerRuntimeState.world(profileConfig, archdemonParty);
    const totalBeforeAncestors = runtime.profile.heroTotalHighestLevels;
    recordDemoEvolutionHistory(runtime.profile, archdemonParty, gd);

    // Both ancestors now registered -> their (next-stage-gated) evolve-chain rows appear.
    expect(runtime.collection.hasCapturedSimpleType("Archdemon")).toBe(true); // party member
    expect(runtime.collection.hasCapturedSimpleType("Demon")).toBe(true); // gates the FallenAngel@16 row
    expect(runtime.collection.hasCapturedSimpleType("FallenAngel")).toBe(true); // gates a hypothetical earlier row
    // Recorded at the level they evolved away at (their own evolveData.levelReq).
    expect(runtime.profile.highestRegisteredLevel("Archdemon")).toBe(60);
    expect(runtime.profile.highestRegisteredLevel("Demon")).toBe(53);
    expect(runtime.profile.highestRegisteredLevel("FallenAngel")).toBe(16);


    expect(runtime.profile.heroTotalHighestLevels).toBe(totalBeforeAncestors + 60);
    expect(runtime.profile.heroLevel).toBe(heroLevelForXp(totalBeforeAncestors + 60));
  });
});
