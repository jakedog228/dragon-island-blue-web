import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { BattleSession } from "../src/session.js";
import { baseStat } from "../src/stats.js";
import type { Rng } from "../src/rng.js";
import { jobXpForLevel } from "../src/xp.js";
import {
  canOfferSaveMe,
  WorldTripParty,
  type CombineMonsterQuestEvent,
  type PlayerMonsterInstance,
} from "../src/worldTripParty.js";
import { soulStoneMintLevel } from "../src/soulStone.js";

const gd = loadGameData();

const zeroRng: Rng = {
  next: () => 0,
  intBelow: () => 0,
  chance: () => true,
};

function atLevel(
  instanceId: string,
  shortType: string,
  level: number,
  currentHp = baseStat(gd.monsterByShortType(shortType), "MaxHP", level),
): PlayerMonsterInstance {
  return {
    instanceId,
    shortType,
    level,
    cumulativeXp: jobXpForLevel(level, gd.jobXpPenalty(shortType)),
    currentHp,
  };
}

function retreatAtFirstPlayerTurn(session: BattleSession): void {
  for (let turns = 0; turns < 100; turns++) {
    const step = session.advance();
    if (step.type !== "awaitingPlayer") continue;
    expect(session.submitRetreatAction().success).toBe(true);
    return;
  }
  throw new Error("player turn never arrived");
}

describe("battle trip-state seam", () => {
  it("starts a projected player living at current HP while omission remains full", () => {
    const wounded = new BattleSession(
      gd,
      [[{ shortType: "FireCub", level: 5, currentHp: 7 }], [{ shortType: "SnowCub", level: 5 }]],
      zeroRng,
      { fightingGroupSize: 1 },
    );
    expect(wounded.hpOf("t0m0:FireCub")).toBe(7);

    const fresh = new BattleSession(
      gd,
      [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
      zeroRng,
      { fightingGroupSize: 1 },
    );
    expect(fresh.hpOf("t0m0:FireCub")).toBe(fresh.maxHpOf("t0m0:FireCub"));
  });

  it("rejects zero/fractional projected HP but preserves the source's transient over-MaxHP state", () => {
    const make = (currentHp: number) =>
      new BattleSession(
        gd,
        [[{ shortType: "FireCub", level: 5, currentHp }], [{ shortType: "SnowCub", level: 5 }]],
        zeroRng,
      );
    expect(() => make(0)).toThrow(/positive integer/);
    expect(() => make(1.5)).toThrow(/positive integer/);
    const overMax = make(10_000);
    expect(overMax.hpOf("t0m0:FireCub")).toBe(10_000);
  });

  it("emits terminal HP/stone deltas only for initial, durably identified player members", () => {
    const session = new BattleSession(
      gd,
      [
        [
          {
            shortType: "FireCub",
            level: 5,
            currentHp: 9,
            sourceInstanceId: "player-fire",
            soulStone: { element: "Fire", level: 3, sourceType: "SnowCub" },
          },
          { shortType: "SnowCub", level: 5 },
        ],
        [{ shortType: "SnowCub", level: 5, sourceInstanceId: "enemy-identity-must-not-leak" }],
      ],
      zeroRng,
    );
    expect(() => session.playerTerminalSnapshot()).toThrow(/terminal state/);
    retreatAtFirstPlayerTurn(session);
    expect(session.playerTerminalSnapshot()).toEqual({
      "player-fire": {
        currentHp: 9,
        leftBattle: false,
        soulStone: { element: "Fire", level: 3, sourceType: "SnowCub" },
      },
    });
  });

  it("rejects duplicate durable identities in the initial player roster", () => {
    expect(
      () =>
        new BattleSession(
          gd,
          [
            [
              { shortType: "FireCub", level: 5, sourceInstanceId: "same" },
              { shortType: "SnowCub", level: 5, sourceInstanceId: "same" },
            ],
            [{ shortType: "SnowCub", level: 5 }],
          ],
          zeroRng,
        ),
    ).toThrow(/duplicate player sourceInstanceId/);
  });
});

describe("egg monster feeding", () => {
  it("adds one full current level band, preserves in-band overage, and advances exactly once", () => {
    const shortType = "FireCub";
    const penalty = gd.jobXpPenalty(shortType);
    const level = 10;
    const floor = jobXpForLevel(level, penalty);
    const next = jobXpForLevel(level + 1, penalty);
    const currentHp = 7;
    const party = new WorldTripParty(gd, [{
      ...atLevel("fed", shortType, level, currentHp),
      cumulativeXp: floor + 37,
    }], 1);

    const result = party.feedOneLevel("fed");

    expect(result.previousLevel).toBe(10);
    expect(result.level).toBe(11);
    expect(result.cumulativeXp).toBe(floor + 37 + (next - floor));
    expect(result.currentHp).toBe(currentHp);
    expect(party.monster("fed")).toMatchObject({
      level: 11,
      cumulativeXp: floor + 37 + (next - floor),
      currentHp,
    });
  });

  it("keeps the picker-owned level-150 guard fail-loud at the aggregate boundary", () => {
    const party = new WorldTripParty(gd, [atLevel("full", "FireCub", 150)], 1);
    expect(() => party.feedOneLevel("full")).toThrow(/already level 150/);
  });
});

describe("WorldTripParty", () => {
  it("offers Save Me only for the source block, tutorial, hero-level, and gold rule", () => {
    expect(canOfferSaveMe({ blockSaveMe: false, tutorialSeen: false, heroLevel: 6, gold: 100 })).toBe(true);
    expect(canOfferSaveMe({ blockSaveMe: false, tutorialSeen: true, heroLevel: 6, gold: 0 })).toBe(true);
    expect(canOfferSaveMe({ blockSaveMe: false, tutorialSeen: false, heroLevel: 5, gold: 100 })).toBe(false);
    expect(canOfferSaveMe({ blockSaveMe: true, tutorialSeen: true, heroLevel: 99, gold: 999 })).toBe(false);
  });

  it("recovers every Save Me roster member without changing durable identity or progression", () => {
    const party = new WorldTripParty(gd, [
      {
        ...atLevel("dead", "FireCub", 10, 0),
        injureTime: 10,
        healTime: 20,
        soulStone: { element: "Life", level: 10, sourceType: "SnowCub" },
      },
      {
        ...atLevel("injured", "SnowCub", 12, 7),
        injureTime: 30,
        healTime: 60,
      },
    ], 2);
    const durableBefore = party.monsters().map((member) => ({
      instanceId: member.instanceId,
      shortType: member.shortType,
      level: member.level,
      cumulativeXp: member.cumulativeXp,
      soulStone: member.soulStone,
    }));

    party.applySaveMeRecovery();

    const recovered = party.monsters();
    expect(recovered.map((member) => ({
      instanceId: member.instanceId,
      shortType: member.shortType,
      level: member.level,
      cumulativeXp: member.cumulativeXp,
      soulStone: member.soulStone,
    }))).toEqual(durableBefore);
    expect(recovered.map(({ instanceId }) => instanceId)).toEqual(["dead", "injured"]);
    expect(recovered.map(({ currentHp }) => currentHp)).toEqual([144, 157]);
    for (const member of recovered) {
      expect(member).not.toHaveProperty("injureTime");
      expect(member).not.toHaveProperty("healTime");
    }
  });

  it("filters only the ordered batting prefix and never backfills dead or injured slots", () => {
    const dead = atLevel("dead", "SnowCub", 5, 0);
    const injured = { ...atLevel("injured", "WhiteDragonling", 5), injureTime: 10, healTime: 20 };
    const party = new WorldTripParty(
      gd,
      [atLevel("wounded", "FireCub", 5, 6), dead, injured, atLevel("outside", "Minotaur", 5)],
      3,
    );

    expect(party.projectAliveBattingPrefix()).toEqual([
      expect.objectContaining({ shortType: "FireCub", currentHp: 6, sourceInstanceId: "wounded" }),
    ]);
  });

  it("round-trips wounds across sequential encounter projections and keeps fainted members out", () => {
    const party = new WorldTripParty(gd, [atLevel("persistent", "FireCub", 5)], 1);
    party.commitBattleSnapshot({ persistent: { currentHp: 8, leftBattle: false } });

    const first = new BattleSession(
      gd,
      [party.projectAliveBattingPrefix(), [{ shortType: "SnowCub", level: 5 }]],
      zeroRng,
      { fightingGroupSize: 1 },
    );
    expect(first.hpOf("t0m0:FireCub")).toBe(8);
    retreatAtFirstPlayerTurn(first);
    party.commitBattleSnapshot(first.playerTerminalSnapshot());

    expect(party.projectAliveBattingPrefix()[0]?.currentHp).toBe(8);
    party.commitBattleSnapshot({ persistent: { currentHp: 0, leftBattle: true } });
    expect(party.projectAliveBattingPrefix()).toEqual([]);
  });

  it("commits live soul-stone consumption without persisting battle-created state", () => {
    const holder = {
      ...atLevel("holder", "Manticore", 10),
      soulStone: { element: "Life" as const, level: 10, sourceType: "FireCub" },
    };
    const party = new WorldTripParty(gd, [holder], 1);
    party.commitBattleSnapshot({ holder: { currentHp: holder.currentHp, leftBattle: false } });
    expect(party.monster("holder").soulStone).toBeUndefined();
  });

  it("levels living monsters with the exact MaxHP-delta heal while dead participants stay at zero", () => {
    const penalty = gd.jobXpPenalty("FireCub");
    const level5Xp = jobXpForLevel(5, penalty);
    const level6Xp = jobXpForLevel(6, penalty);
    const living = { ...atLevel("living", "FireCub", 5, 5), cumulativeXp: level5Xp };
    const dead = { ...atLevel("dead", "FireCub", 5, 0), cumulativeXp: level5Xp };
    const party = new WorldTripParty(gd, [living, dead], 2);

    const livingResult = party.awardXp("living", level6Xp - level5Xp);
    const deadResult = party.awardXp("dead", level6Xp - level5Xp);
    expect(livingResult.level).toBe(6);
    expect(livingResult.currentHp).toBe(5 + livingResult.maxHp - livingResult.previousMaxHp);
    expect(deadResult).toMatchObject({ level: 6, currentHp: 0 });
    expect(party.monster("living").cumulativeXp).toBe(level6Xp);
  });

  it("adds a successful capture at its XP boundary/full HP and after the existing order", () => {
    const party = new WorldTripParty(gd, [atLevel("first", "FireCub", 5)], 3);
    const captured = party.addCapturedMonster({ instanceId: "capture", shortType: "SnowCub", level: 7 });
    expect(captured.cumulativeXp).toBe(jobXpForLevel(7, gd.jobXpPenalty("SnowCub")));
    expect(captured.currentHp).toBe(baseStat(gd.monsterByShortType("SnowCub"), "MaxHP", 7));
    expect(party.monsters().map((monster) => monster.instanceId)).toEqual(["first", "capture"]);
  });


  it("deploys a capture into a lineup with a free slot and benches it only once full", () => {
    const party = new WorldTripParty(gd, [atLevel("first", "FireCub", 5)], 2);
    party.addCapturedMonster({ instanceId: "capture", shortType: "SnowCub", level: 7 });
    expect(party.battingOrderMonsters().map((monster) => monster.instanceId)).toEqual([
      "first",
      "capture",
    ]);
    expect(party.reserveMonsters()).toEqual([]);
    expect(party.projectAliveBattingPrefix().map((member) => member.sourceInstanceId)).toEqual([
      "first",
      "capture",
    ]);

    party.addCapturedMonster({ instanceId: "overflow", shortType: "Wolf", level: 4 });
    expect(party.battingOrderMonsters().map((monster) => monster.instanceId)).toEqual([
      "first",
      "capture",
    ]);
    expect(party.reserveMonsters().map((monster) => monster.instanceId)).toEqual(["overflow"]);
  });


  it("promotes the first reserve when an active member leaves the bench", () => {
    const party = new WorldTripParty(gd, [
      atLevel("a", "FireCub", 5),
      atLevel("b", "SnowCub", 6),
      atLevel("c", "Wolf", 7),
    ], 2);
    expect(party.battingOrderMonsters().map((monster) => monster.instanceId)).toEqual(["a", "b"]);
    party.destroyMonster("a");
    expect(party.battingOrderMonsters().map((monster) => monster.instanceId)).toEqual(["b", "c"]);
    expect(party.reserveMonsters()).toEqual([]);
  });

  it("combines in append/event/remove1/remove2 order and lets the prefix reclaim the result", () => {
    const party = new WorldTripParty(gd, [
      atLevel("bitewing", "Bitewing", 19),
      atLevel("keeper", "FireCub", 8),
      atLevel("wolf", "Wolf", 12),
    ], 2, [], 2);
    let event: CombineMonsterQuestEvent | undefined;
    let membersAtEvent: readonly string[] = [];
    let activeAtEvent = -1;
    const result = party.combineMonsters(
      "combined",
      "Carnoraptor",
      "bitewing",
      "wolf",
      (nextEvent) => {
        event = nextEvent;
        membersAtEvent = party.monsters().map((monster) => monster.instanceId);
        activeAtEvent = party.battingOrderLength();
      },
    );

    expect(membersAtEvent).toEqual(["bitewing", "keeper", "wolf", "combined"]);
    expect(activeAtEvent).toBe(2);
    expect(event).toEqual({
      eventId: 8,
      target1: expect.objectContaining({ instanceId: "bitewing", shortType: "Bitewing" }),
      target2: expect.objectContaining({ instanceId: "wolf", shortType: "Wolf" }),
    });
    expect(result.consumed.map((monster) => monster.instanceId)).toEqual(["bitewing", "wolf"]);
    expect(result.monster).toEqual({
      instanceId: "combined",
      shortType: "Carnoraptor",
      level: 1,
      cumulativeXp: jobXpForLevel(1, gd.jobXpPenalty("Carnoraptor")),
      currentHp: baseStat(gd.monsterByShortType("Carnoraptor"), "MaxHP", 1),
    });
    // Both ingredients left the two-slot lineup, so the appended result is inside the prefix again.
    expect(party.battingOrderMonsters().map((monster) => monster.instanceId)).toEqual([
      "keeper",
      "combined",
    ]);
    expect(party.reserveMonsters()).toEqual([]);
  });

  it("refills the prefix after consuming active members and requires distinct identities", () => {
    const sameSpecies = new WorldTripParty(gd, [
      atLevel("thunder-1", "ThunderWolf", 30),
      atLevel("thunder-2", "ThunderWolf", 31),
      atLevel("reserve", "FireCub", 8),
    ], 2, [], 2);
    expect(() =>
      sameSpecies.combineMonsters("wolf-god", "WolfGod", "thunder-1", "thunder-1"),
    ).toThrow(/distinct/);

    sameSpecies.combineMonsters("wolf-god", "WolfGod", "thunder-1", "thunder-2");
    expect(sameSpecies.battingOrderLength()).toBe(2);
    expect(sameSpecies.battingOrderMonsters().map((monster) => monster.instanceId)).toEqual([
      "reserve",
      "wolf-god",
    ]);
    expect(sameSpecies.reserveMonsters()).toEqual([]);
  });

  it("validates both authored ingredient slots before mutating the roster", () => {
    const party = new WorldTripParty(gd, [
      atLevel("wolf", "Wolf", 12),
      atLevel("bitewing", "Bitewing", 19),
    ], 2);
    const before = party.monsters();
    expect(() =>
      party.combineMonsters("combined", "Carnoraptor", "wolf", "bitewing"),
    ).toThrow(/first ingredient/);
    expect(party.monsters()).toEqual(before);
    expect(party.battingOrderLength()).toBe(2);
  });

  it("rolls back the appended result when the quest listener throws", () => {
    const party = new WorldTripParty(gd, [
      atLevel("bitewing", "Bitewing", 19),
      atLevel("wolf", "Wolf", 12),
      atLevel("reserve", "FireCub", 8),
    ], 2, [], 2);
    const before = party.monsters();
    expect(() =>
      party.combineMonsters(
        "combined",
        "Carnoraptor",
        "bitewing",
        "wolf",
        () => { throw new Error("quest adapter failed"); },
      ),
    ).toThrow(/quest adapter failed/);
    expect(party.monsters()).toEqual(before);
    expect(party.battingOrderLength()).toBe(2);
  });

  it("evolves in place at the new XP boundary, full HP, preserving stone and clearing injury", () => {
    const source = gd.allMonsters().find((monster) => monster.evolveData !== undefined)!;
    const evolution = source.evolveData!;
    const level = Math.max(1, Math.trunc(evolution.levelReq));
    const original = {
      ...atLevel("evolving", source.shortType, level, 0),
      injureTime: 10,
      healTime: 20,
      soulStone: { element: "Fire" as const, level: 3, sourceType: "FireCub" },
    };
    const party = new WorldTripParty(gd, [original], 1);

    const evolved = party.evolve("evolving");
    expect(evolved).toMatchObject({
      instanceId: "evolving",
      shortType: evolution.newType,
      level,
      soulStone: original.soulStone,
    });
    expect(evolved.cumulativeXp).toBe(jobXpForLevel(level, gd.jobXpPenalty(evolution.newType)));
    expect(evolved.currentHp).toBeGreaterThan(0);
    expect(evolved.injureTime).toBeUndefined();
    expect(evolved.healTime).toBeUndefined();
  });

  it("town restores every monster but clears only elapsed injury timers", () => {
    const expired = { ...atLevel("expired", "FireCub", 5, 0), injureTime: 10, healTime: 20 };
    const future = { ...atLevel("future", "SnowCub", 5, 1), injureTime: 30, healTime: 50 };
    const party = new WorldTripParty(gd, [expired, future], 2);
    party.restoreAtTown(25);

    expect(party.monster("expired")).toMatchObject({
      currentHp: baseStat(gd.monsterByShortType("FireCub"), "MaxHP", 5),
    });
    expect(party.monster("expired").injureTime).toBeUndefined();
    expect(party.monster("future")).toMatchObject({
      currentHp: baseStat(gd.monsterByShortType("SnowCub"), "MaxHP", 5),
      injureTime: 30,
      healTime: 50,
    });
  });

  it("prices, expires, and removes injuries using Unix seconds", () => {
    const injured = {
      ...atLevel("injured", "FireCub", 40),
      injureTime: 100,
      healTime: 200,
    };
    const party = new WorldTripParty(gd, [injured], 1);
    expect(party.injuryHealCost("injured", 100)).toBe(40);
    expect(party.injuryHealCost("injured", 150)).toBe(25);
    expect(party.purgeExpiredInjuries(199)).toBe(false);
    expect(party.purgeExpiredInjuries(200)).toBe(true);
    expect(party.monster("injured").injureTime).toBeUndefined();
  });
});

describe("WorldTripParty game-menu editor mutations", () => {
  const roster = () => [
    atLevel("a", "FireCub", 5),
    atLevel("b", "SnowCub", 6),
    atLevel("c", "WhiteDragonling", 7),
    atLevel("d", "Minotaur", 8),
  ];

  it("moves the batting-order member to a clamped index without disturbing reserves", () => {
    const party = new WorldTripParty(gd, roster(), 3);
    // step the first card right by one
    party.moveBattingOrderMember(0, 1);
    expect(party.monsters().map((m) => m.instanceId)).toEqual(["b", "a", "c", "d"]);
    // jump-to-back: a +999 target clamps to the last prefix slot (index 2), never into reserves
    party.moveBattingOrderMember(1, 999);
    expect(party.monsters().map((m) => m.instanceId)).toEqual(["b", "c", "a", "d"]);
    // jump-to-front
    party.moveBattingOrderMember(2, -999);
    expect(party.monsters().map((m) => m.instanceId)).toEqual(["a", "b", "c", "d"]);
    expect(party.battingOrderLength()).toBe(3);
  });

  it("rejects a fromIndex outside the batting-order prefix", () => {
    const party = new WorldTripParty(gd, roster(), 3);
    expect(() => party.moveBattingOrderMember(3, 0)).toThrow(/out of range/);
  });

  it("keeps town style-0 batting and reserve rosters disjoint across both transfer directions", () => {
    const party = new WorldTripParty(gd, roster(), 3);
    expect(party.battingOrderMonsters().map((m) => m.instanceId)).toEqual(["a", "b", "c"]);
    expect(party.reserveMonsters().map((m) => m.instanceId)).toEqual(["d"]);

    // Demotion is a relocation: the slot "b" vacates is immediately covered by the next member,
    // because `min(battingOrderSize, count)` cannot shrink while anyone is benched.
    party.moveBattingOrderMemberToReserves(1, 0);
    expect(party.battingOrderLength()).toBe(3);
    expect(party.battingOrderSlotIds()).toEqual(["a", "c", "d"]);
    expect(party.reserveMonsters().map((m) => m.instanceId)).toEqual(["b"]);
    expect(party.projectAliveBattingPrefix().map((m) => m.sourceInstanceId)).toEqual(["a", "c", "d"]);

    party.moveReserveMemberToBattingOrder(0, 1);
    expect(party.battingOrderLength()).toBe(3);
    expect(party.battingOrderMonsters().map((m) => m.instanceId)).toEqual(["a", "b", "c"]);
    expect(party.reserveMonsters().map((m) => m.instanceId)).toEqual(["d"]);
    expect(() => party.moveReserveMemberToBattingOrder(1, 0)).toThrow(/out of range/);
  });

  it("sorts only town reserves", () => {
    const party = new WorldTripParty(gd, roster(), 2);
    party.sortReserves((left, right) => right.level - left.level);
    expect(party.battingOrderMonsters().map((m) => m.instanceId)).toEqual(["a", "b"]);
    expect(party.reserveMonsters().map((m) => m.instanceId)).toEqual(["d", "c"]);
  });

  it("validates a legacy compact active-prefix length but derives the prefix from the roster", () => {
    const party = new WorldTripParty(gd, roster(), 3, [], 1);
    expect(party.battingOrderMonsters().map((m) => m.instanceId)).toEqual(["a", "b", "c"]);
    expect(party.reserveMonsters().map((m) => m.instanceId)).toEqual(["d"]);
    expect(() => new WorldTripParty(gd, roster(), 3, [], 4)).toThrow(/battingOrderLength/);
  });

  it("commits compact active priority while preserving durable nonactive relative order", () => {
    const party = new WorldTripParty(gd, roster(), 5, [], 3);


    party.commitBattingPriority(["a", "c"]);
    expect(party.battingOrderSlotIds()).toEqual(["a", "c", "b", "d", null]);
    expect(party.reserveOrderIds()).toEqual([]);
    expect(party.monsters().map((member) => member.instanceId)).toEqual(["a", "c", "b", "d"]);

    party.commitBattingPriority(["d", "a", "c"]);
    expect(party.battingOrderSlotIds()).toEqual(["d", "a", "c", "b", null]);
    expect(() => party.commitBattingPriority(["a", "a"])).toThrow(/duplicate/);
    expect(() => party.commitBattingPriority(["missing"])).toThrow(/unknown/);
  });

  it("commits a priority that pushes the surplus out of a full lineup", () => {
    const party = new WorldTripParty(gd, roster(), 3);
    party.commitBattingPriority(["d", "c"]);
    expect(party.battingOrderSlotIds()).toEqual(["d", "c", "a"]);
    expect(party.reserveOrderIds()).toEqual(["b"]);
  });

  it("uses visual reserve indices directly as insertion boundaries", () => {
    const wide = () => [...roster(), atLevel("e", "Wolf", 9)];
    const first = new WorldTripParty(gd, wide(), 3);
    first.moveBattingOrderMemberToReserves(1, 0);
    expect(first.reserveOrderIds()).toEqual(["b", "e"]);

    const afterFirst = new WorldTripParty(gd, wide(), 3);
    afterFirst.moveBattingOrderMemberToReserves(1, 1);
    expect(afterFirst.reserveOrderIds()).toEqual(["e", "b"]);
  });

  it("migrates explicit hole ordering into compact durable state and rejects invalid partitions", () => {
    const ordering = {
      battingOrderSlotIds: ["a", null, "c", null, null],
      reserveOrderIds: ["b", "d"],
    } as const;
    const party = new WorldTripParty(gd, roster(), 5, [], 3, ordering);
    expect(party.battingOrderSlotIds()).toEqual(["a", "c", "b", "d", null]);
    expect(party.reserveOrderIds()).toEqual([]);
    expect(party.projectAliveBattingPrefix().map((m) => m.sourceInstanceId)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
    expect(() => new WorldTripParty(gd, roster(), 5, [], 3, {
      battingOrderSlotIds: ["a", null, "a", null, null],
      reserveOrderIds: ["b", "c", "d"],
    })).toThrow(/repeats/);
  });

  it("permanently destroys a member without minting an item and refuses the last member", () => {
    const party = new WorldTripParty(gd, roster(), 3);
    const destroyed = party.destroyMonster("b");
    expect(destroyed.instanceId).toBe("b");
    expect(party.monsters().map((m) => m.instanceId)).toEqual(["a", "c", "d"]);
    expect(party.ownedSoulStones()).toEqual([]);
    expect(party.battingOrderLength()).toBe(3);

    const solo = new WorldTripParty(gd, [atLevel("only", "FireCub", 5)], 1);
    expect(() => solo.destroyMonster("only")).toThrow(/last member/);
    expect(() => party.destroyMonster("missing")).toThrow(/unknown instanceId/);
  });

  it("converts a member into a pooled stone of its own element and mint level, gated on the last member", () => {
    const party = new WorldTripParty(gd, roster(), 3);
    const def = gd.monsterByShortType("Minotaur");
    const stone = party.convertToSoulStone("d");
    expect(stone).toEqual({
      element: def.element,
      level: soulStoneMintLevel(def.stars, 8),
      sourceType: "Minotaur",
    });
    expect(party.monsters().map((m) => m.instanceId)).toEqual(["a", "b", "c"]);
    expect(party.ownedSoulStones()).toEqual([stone]);

    const solo = new WorldTripParty(gd, [atLevel("only", "FireCub", 5)], 1);
    expect(() => solo.convertToSoulStone("only")).toThrow(/last member/);
  });

  it("inserts a pooled stone onto a member and destroys any stone it already wore", () => {
    const party = new WorldTripParty(gd, roster(), 3);
    const minted = party.convertToSoulStone("d"); // pool: [minted]
    party.insertSoulStone("a", 0);
    expect(party.monster("a").soulStone).toEqual(minted);
    expect(party.ownedSoulStones()).toEqual([]);

    // a second convert + insert onto the same member replaces (and discards) the first stone
    const second = party.convertToSoulStone("c");
    party.insertSoulStone("a", 0);
    expect(party.monster("a").soulStone).toEqual(second);
    expect(party.ownedSoulStones()).toEqual([]);
    expect(() => party.insertSoulStone("a", 0)).toThrow(/out of range/);
  });

  it("validates a stable stone token instead of trusting a stale numeric picker index", () => {
    const party = new WorldTripParty(gd, roster(), 3, [
      { element: "Fire", level: 4 },
      { element: "Water", level: 7 },
    ]);
    const entries = party.ownedSoulStoneEntries();
    expect(entries[0]!.token).not.toBe(entries[1]!.token);
    party.insertSoulStoneByToken("a", entries[1]!.token);
    expect(party.monster("a").soulStone).toEqual({ element: "Water", level: 7 });
    expect(() => party.insertSoulStoneByToken("b", entries[1]!.token)).toThrow(/stale token/);
    expect(party.ownedSoulStones()).toEqual([{ element: "Fire", level: 4 }]);
  });

  it("drops the exact confirmed loose stone without touching its neighbours", () => {
    const party = new WorldTripParty(gd, roster(), 3, [
      { element: "Fire", level: 4 },
      { element: "Water", level: 7, sourceType: "SnowCub" },
      { element: "Life", level: 9 },
    ]);
    const entries = party.ownedSoulStoneEntries();
    expect(party.dropSoulStoneByToken(entries[1]!.token)).toEqual({
      element: "Water",
      level: 7,
      sourceType: "SnowCub",
    });
    expect(party.ownedSoulStones()).toEqual([
      { element: "Fire", level: 4 },
      { element: "Life", level: 9 },
    ]);
    expect(() => party.dropSoulStoneByToken(entries[1]!.token)).toThrow(/stale token/);
  });

  it("round-trips the owned stone pool through the constructor", () => {
    const party = new WorldTripParty(gd, roster(), 3, [
      { element: "Fire", level: 12, sourceType: "FireCub" },
    ]);
    expect(party.ownedSoulStones()).toEqual([{ element: "Fire", level: 12, sourceType: "FireCub" }]);
  });

  it("derives a resized active prefix from the same durable bench order", () => {
    const party = new WorldTripParty(gd, roster(), 3);
    expect(party.battingOrderMonsters().map(({ instanceId }) => instanceId))
      .toEqual(["a", "b", "c"]);
    party.setBattingOrderSize(4);
    expect(party.battingOrderMonsters().map(({ instanceId }) => instanceId))
      .toEqual(["a", "b", "c", "d"]);
    party.setBattingOrderSize(2);
    expect(party.battingOrderMonsters().map(({ instanceId }) => instanceId))
      .toEqual(["a", "b"]);
    expect(party.reserveMonsters().map(({ instanceId }) => instanceId))
      .toEqual(["c", "d"]);
  });

  it("round-trips the complete durable party snapshot without a parallel batting-order owner", () => {
    const party = new WorldTripParty(gd, roster(), 3, [
      { element: "Water", level: 7, sourceType: "SnowCub" },
    ]);
    party.commitBattingPriority(["c", "a", "b"]);
    const snapshot = JSON.parse(JSON.stringify(party.stateSnapshot()));
    const restored = WorldTripParty.fromStateSnapshot(gd, snapshot);
    expect(restored.stateSnapshot()).toEqual(party.stateSnapshot());
    expect(restored.battingOrderSlotIds()).toEqual(["c", "a", "b"]);
    expect(restored.maxHpOf("c")).toBeGreaterThan(0);
  });
});

describe("permanent player buff children", () => {


  const fairyBase = baseStat(gd.monsterByShortType("Fairy"), "MaxHP", 6);

  function fairyParty(bonuses: Partial<Record<"MaxHP" | "Attack", number>> = { MaxHP: 7 }) {
    const party = new WorldTripParty(gd, [atLevel("fairy", "Fairy", 6)], 3);
    party.setPlayerBuffSource(() => bonuses);
    return party;
  }

  it("heals to the buff-inclusive MaxHP at town, matching the battle it is projected into", () => {
    const party = fairyParty();
    expect(fairyBase).toBe(62);
    expect(party.maxHpOf("fairy")).toBe(fairyBase + 7);

    party.commitBattleSnapshot({ fairy: { currentHp: 30, leftBattle: false } });
    party.restoreAtTown(0);
    expect(party.monster("fairy").currentHp).toBe(fairyBase + 7);

    const session = new BattleSession(
      gd,
      [party.projectAliveBattingPrefix(), [{ shortType: "SnowCub", level: 5 }]],
      zeroRng,
      { fightingGroupSize: 1 },
    );
    // The bug in one assertion: a full-HP party member must enter battle at a full bar.
    expect(session.maxHpOf("t0m0:Fairy")).toBe(party.maxHpOf("fairy"));
    expect(session.hpOf("t0m0:Fairy")).toBe(session.maxHpOf("t0m0:Fairy"));
  });

  it("binds providers without healing so a reload preserves trip HP", () => {
    const party = new WorldTripParty(gd, [atLevel("fairy", "Fairy", 6, 20)], 3);
    party.setPlayerBuffSource(() => ({ MaxHP: 7 }));
    expect(party.monster("fairy").currentHp).toBe(20);
    expect(party.maxHpOf("fairy")).toBe(fairyBase + 7);
  });

  it("applies the providers to every acquisition and to Save Me, and reports them per stat", () => {
    const party = fairyParty({ MaxHP: 7, Attack: 3 });
    const captured = party.addCapturedMonster({
      instanceId: "caught",
      shortType: "SnowCub",
      level: 4,
    });
    // `addBenchMonster:atIndex:silently:`'s tail buffs the new monster, then heals it.
    expect(captured.currentHp).toBe(party.maxHpOf("caught"));
    expect(party.maxHpOf("caught")).toBe(
      baseStat(gd.monsterByShortType("SnowCub"), "MaxHP", 4) + 7,
    );
    expect(party.statsOf("caught").Attack).toBe(
      baseStat(gd.monsterByShortType("SnowCub"), "Attack", 4) + 3,
    );
    expect(party.playerBuffsOf("caught")).toEqual({ MaxHP: 7, Attack: 3 });

    party.commitBattleSnapshot({
      fairy: { currentHp: 0, leftBattle: true },
      caught: { currentHp: 3, leftBattle: false },
    });
    party.applySaveMeRecovery();
    expect(party.monster("fairy").currentHp).toBe(fairyBase + 7);
    expect(party.monster("caught").currentHp).toBe(party.maxHpOf("caught"));
  });

  it("drops the permanent children of a member that left its team mid-battle", () => {
    const party = fairyParty();
    // `-[Team fireMonsterLeft:]` -> `notifyLeftBattleFromTeam:` -> removeBuffsIncludingPermanent:1
    party.commitBattleSnapshot({ fairy: { currentHp: 0, leftBattle: true } });
    expect(party.playerBuffsOf("fairy")).toEqual({});
    expect(party.maxHpOf("fairy")).toBe(fairyBase);
    // A survivor keeps them: `-[Team notifyDestroyed]` only unregisters listeners.
    party.restoreAtTown(0);
    party.commitBattleSnapshot({ fairy: { currentHp: 11, leftBattle: false } });
    expect(party.maxHpOf("fairy")).toBe(fairyBase + 7);
  });

  it("revives only by a Life stone's MaxHP bonus and leaves every other party member untouched", () => {
    const party = new WorldTripParty(
      gd,
      [
        atLevel("fairy", "Fairy", 6, 0),
        atLevel("cub", "FireCub", 6, 12),
      ],
      3,
      [{ element: "Life", level: 4, sourceType: "FireCub" }],
    );
    party.setPlayerBuffSource(() => ({ MaxHP: 7 }));
    party.insertSoulStone("fairy", 0);
    // `Living.addChild:` applies only newMax-oldMax to the selected monster's current HP.
    expect(party.monster("fairy").currentHp).toBe(4);
    expect(party.maxHpOf("fairy")).toBeGreaterThan(fairyBase + 7);
    expect(party.monster("cub").currentHp).toBe(12);
  });

  it("leaves a dead monster at zero for a Soul Stone that does not change MaxHP", () => {
    const party = new WorldTripParty(
      gd,
      [atLevel("fairy", "Fairy", 6, 0)],
      3,
      [{ element: "Fire", level: 9 }],
    );
    party.insertSoulStone("fairy", 0);
    expect(party.monster("fairy").currentHp).toBe(0);
  });

  it("adds the complete new Life bonus when replacing an existing stone", () => {
    const party = new WorldTripParty(
      gd,
      [{ ...atLevel("fairy", "Fairy", 6, 10), soulStone: { element: "Life", level: 20 } }],
      3,
      [{ element: "Life", level: 4 }],
    );
    party.insertSoulStone("fairy", 0);
    // removeChild does not subtract the old level-20 bonus; addChild then adds the new level 4.
    expect(party.monster("fairy").currentHp).toBe(14);
  });

  it("keeps a stale allocation until the next application site, as the buff children do", () => {
    let bonus = 7;
    const party = new WorldTripParty(gd, [atLevel("fairy", "Fairy", 6)], 3);
    party.setPlayerBuffSource(() => ({ MaxHP: bonus }));
    bonus = 20;
    // The attached children still carry the value captured when they were built.
    expect(party.maxHpOf("fairy")).toBe(fairyBase + 7);
    party.fullRestoreAndReapplyPermanentBuffs();
    expect(party.maxHpOf("fairy")).toBe(fairyBase + 20);
  });
});
