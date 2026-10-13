import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { advancePvpBattle, createPvpBattle, restorePvpBattle, type PvpAction } from "../src/pvp.js";
import { BattleSession } from "../src/session.js";
import { mulberry32 } from "../src/rng.js";

const data = loadGameData();
const teams = [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]] as const;
const start = () => createPvpBattle(data, teams, () => 0.5, 1);

describe("two-human PvP battles", () => {
  it("waits for both players, validates ownership and targets, and preserves rejected state", () => {
    const initial = start();
    const first = initial.restored.decision;
    expect(first).toMatchObject({ type: "turn", team: 0 });
    if (first.type !== "turn") throw new Error("missing decision");
    const action = { type: "ability", actorId: first.actorId, slot: "usable2", targets: ["t1m0:SnowCub"] } as const;
    const before = JSON.stringify(initial.snapshot);
    expect(() => advancePvpBattle(data, initial.snapshot, { team: 1, action }, () => 0.5)).toThrow("opponent's turn");
    const second = advancePvpBattle(data, initial.snapshot, { team: 0, action }, () => 0.5);
    expect(second.restored.decision).toMatchObject({ type: "turn", team: 1, actorId: "t1m0:SnowCub" });
    expect(second.restored.events.filter((event) => event.type === "turnStarted")).toHaveLength(1);
    expect(JSON.stringify(initial.snapshot)).toBe(before);
    const badTarget: PvpAction = { type: "ability", actorId: "t1m0:SnowCub", slot: "usable1", targets: ["t1m0:SnowCub"] };
    expect(() => advancePvpBattle(data, second.snapshot, { team: 1, action: badTarget }, () => 0.5)).toThrow("enemy targetable");
    const third = advancePvpBattle(data, second.snapshot, { team: 1,
      action: { ...badTarget, targets: ["t0m0:FireCub"] } }, () => 0.5);
    expect(third.restored.events).toContainEqual(expect.objectContaining({ type: "damageDealt", source: "t1m0:SnowCub", target: "t0m0:FireCub" }));
    expect(restorePvpBattle(data, JSON.parse(JSON.stringify(third.snapshot)))).toMatchObject({ decision: third.restored.decision, events: third.restored.events });
  });

  it("completes a real fight with reserves and replays every committed decision", () => {
    const random = mulberry32(79);
    let battle = createPvpBattle(data, [[...teams[0], { shortType: "FireCub", level: 5 }], [...teams[1], { shortType: "SnowCub", level: 5 }]], () => random.next(), 1);
    for (let n = 0; n < 100; n++) {
      const decision = battle.restored.decision;
      if (decision.type === "ended") break;
      const enemy = battle.restored.session.activeIdsOf(decision.team === 0 ? 1 : 0)[0]!;
      battle = advancePvpBattle(data, battle.snapshot, { team: decision.team,
        action: { type: "ability", actorId: decision.actorId, slot: "usable1", targets: [enemy] } }, () => random.next());
      expect(restorePvpBattle(data, structuredClone(battle.snapshot))).toMatchObject({ decision: battle.restored.decision, events: battle.restored.events });
    }
    expect(battle.restored.decision).toMatchObject({ type: "ended", reason: "defeat" });
    expect(battle.restored.events.filter((event) => event.type === "turnStarted").some((event) => /^t[01]m1:/.test(event.living))).toBe(true);
  });

  it("allows either player to forfeit and rejects commands after completion", () => {
    const initial = start();
    const ended = advancePvpBattle(data, initial.snapshot, { team: 1, action: { type: "forfeit" } }, () => { throw new Error("unexpected draw"); });
    expect(ended.restored.decision).toEqual({ type: "ended", winner: 0, reason: "forfeit" });
    expect(restorePvpBattle(data, ended.snapshot).decision).toEqual(ended.restored.decision);
    expect(() => advancePvpBattle(data, ended.snapshot, { team: 0, action: { type: "forfeit" } }, () => 0.5)).toThrow("already ended");
  });

  it("supports delay on either side without allowing an old actor to act", () => {
    let battle = start();
    for (let n = 0; n < 2; n++) {
      const decision = battle.restored.decision;
      if (decision.type !== "turn") throw new Error("missing decision");
      expect(decision.team).toBe(n);
      expect(() => advancePvpBattle(data, battle.snapshot, { team: decision.team,
        action: { type: "delay", actorId: "stale" } }, () => 0.5)).toThrow("no longer");
      battle = advancePvpBattle(data, battle.snapshot, { team: decision.team,
        action: { type: "delay", actorId: decision.actorId } }, () => 0.5);
    }
  });

  it("starts with full HP, no capture, and no campaign identities without mutating the roster", () => {
    const roster = [[{ shortType: "FireCub", level: 5, currentHp: 1, sourceInstanceId: "private-id" }], [...teams[1]]] as const;
    const battle = createPvpBattle(data, roster, () => 0.5);
    expect(battle.snapshot.teams[0][0]).not.toHaveProperty("sourceInstanceId");
    expect(battle.restored.session.hpOf("t0m0:FireCub")).toBe(battle.restored.session.maxHpOf("t0m0:FireCub"));
    expect(battle.restored.session.captureStatusOf("t1m0:SnowCub")).not.toBe("available");
    expect(roster[0][0].currentHp).toBe(1);
  });

  it("rejects truncated and surplus tapes rather than rolling new outcomes on restore", () => {
    const { snapshot } = start();
    expect(() => restorePvpBattle(data, { ...snapshot, randomDraws: [] })).toThrow("exhausted");
    expect(() => restorePvpBattle(data, { ...snapshot, randomDraws: [...snapshot.randomDraws, 0.4] })).toThrow("unused");
  });

  it("keeps ordinary campaign enemies automatic", () => {
    const battle = new BattleSession(data, structuredClone(teams) as never, mulberry32(1));
    for (let n = 0; n < 30; n++) {
      const step = battle.advance();
      if (step.type === "enemyTurnResolved") return;
      if (step.type === "awaitingPlayer") battle.submitDelayAction();
      if (step.type === "ended") break;
    }
    throw new Error("campaign enemy never acted automatically");
  });

  it("retains Berserk automation on both human-owned teams", () => {
    const random = mulberry32(4);
    const battle = createPvpBattle(data, [[{ shortType: "Yeti", level: 12 }], [{ shortType: "Yeti", level: 12 }]], () => random.next(), 1);
    expect(battle.restored.decision).toMatchObject({ type: "ended", reason: "defeat" });
    expect(battle.snapshot.commands).toHaveLength(0);
    expect(battle.restored.events.filter((event) => event.type === "turnStarted").some((event) => event.living.startsWith("t0"))).toBe(true);
    expect(battle.restored.events.filter((event) => event.type === "turnStarted").some((event) => event.living.startsWith("t1"))).toBe(true);
    expect(restorePvpBattle(data, battle.snapshot).decision).toEqual(battle.restored.decision);
  });

  it("resolves mixed targets relative to team 1 and automatically advances sleeping turns", () => {
    const battle = createPvpBattle(data, [[{ shortType: "SnowCub", level: 1 }], [{ shortType: "Megaslug", level: 50 }]], () => 0, 1);
    expect(battle.restored.decision).toMatchObject({ type: "turn", team: 1 });
    const slept = advancePvpBattle(data, battle.snapshot, { team: 1,
      action: { type: "ability", actorId: "t1m0:Megaslug", slot: "usable3", targets: ["t0m0:SnowCub", "t1m0:Megaslug"] } }, () => 0);
    expect(slept.restored.events.filter((event) => event.type === "buffAdded")).toHaveLength(2);
    expect(slept.restored.events.some((event) => event.type === "abilityUsed" && event.ability === "Utility.LooseTurn")).toBe(true);
    expect(slept.restored.decision.type).toBe("turn");
    expect(restorePvpBattle(data, slept.snapshot).events).toEqual(slept.restored.events);
  });
});
