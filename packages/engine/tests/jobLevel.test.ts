import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { BattleSession, WorldTripParty, jobCreationLevel, mulberry32, restoreBattleReplay,
  type BattleReplaySnapshotV1 } from "../src/index.js";

const data = loadGameData();
const teams: BattleReplaySnapshotV1["teams"] = [
  [{ shortType: "FireTiger", level: 150 }], [{ shortType: "Centurion", level: 151 }],
];

describe("source Job construction level", () => {
  it("clamps construction rather than only clamping its stats", () => {
    expect([-20, 0, 1, 149, 150, 151, 999].map(jobCreationLevel)).toEqual([1, 1, 1, 149, 150, 150, 150]);
    for (const bad of [NaN, Infinity, 1.5]) expect(() => jobCreationLevel(bad)).toThrow(/integer level/);
    const battle = new BattleSession(data, [[{ shortType: "FireCub", level: 0 }], [...teams[1]]], mulberry32(777));
    expect(battle.levelOf("t0m0:FireCub")).toBe(1);
    expect(battle.levelOf("t1m0:Centurion")).toBe(150);
    expect(battle.soulStoneOf("t1m0:Centurion")).toBeUndefined();
  });

  it("preserves explicit spirit level increases above the constructor cap", () => {
    const battle = new BattleSession(data, [[...teams[0]], [...teams[1]]], mulberry32(777));
    battle.advance();
    const spirit = battle.summonSpirit("Fire", 20000);
    expect(battle.levelOf(spirit.id)).toBe(219);
  });

  it("settles a successful over-cap encounter capture into a restorable durable party", () => {
    const battle = new BattleSession(data, [[...teams[0]], [...teams[1]]], mulberry32(777));
    let ended = false;
    for (let turn = 0; turn < 100; turn++) {
      const step = battle.advance();
      if (step.type === "awaitingPlayer") battle.submitCaptureAction("t1m0:Centurion", 3, 150);
      if (step.type === "ended") { expect(step.report.winner).toBe(0); ended = true; break; }
    }
    expect(ended).toBe(true);
    expect(battle.capturedIds()).toEqual(["t1m0:Centurion"]);
    const party = new WorldTripParty(data, [], 3);
    party.addCapturedMonster({ instanceId: "earned-capture", shortType: "Centurion", level: battle.levelOf("t1m0:Centurion") });
    expect(party.monster("earned-capture").level).toBe(150);
    expect(WorldTripParty.fromStateSnapshot(data, party.stateSnapshot()).monster("earned-capture"))
      .toEqual(party.monster("earned-capture"));
  });

  it("retains the old level and deterministic event stream for unmarked historical replays", () => {
    const old: BattleReplaySnapshotV1 = { schemaVersion: 1, seed: 777, teams, options: {}, commands: [] };
    const first = restoreBattleReplay(data, old), second = restoreBattleReplay(data, structuredClone(old));
    expect(first.session.levelOf("t1m0:Centurion")).toBe(151);
    expect(second.events).toEqual(first.events);
    expect(second.step).toEqual(first.step);
    const current = restoreBattleReplay(data, { ...old, options: { sourceJobLevels: true } });
    expect(current.session.levelOf("t1m0:Centurion")).toBe(150);
    expect(current.session.maxHpOf("t1m0:Centurion")).toBe(first.session.maxHpOf("t1m0:Centurion"));
  });
});
