import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import {
  advanceBattleReplay,
  appendBattleReplayCommand,
  replayableRng,
  restoreBattleReplay,
  type BattleReplaySnapshotV1,
} from "../src/index.js";

const data = loadGameData();

function initial(): BattleReplaySnapshotV1 {
  return {
    schemaVersion: 1,
    seed: 20260728,
    teams: [
      [{ shortType: "FireCub", level: 8, sourceInstanceId: "party-fire" }],
      [{ shortType: "SnowCub", level: 8 }],
    ],
    options: { fightingGroupSize: 1, silver: 1_000 },
    commands: [],
  };
}

describe("server-private battle replay snapshot", () => {
  it("restores the identical next decision and event stream in a fresh session", () => {
    const first = restoreBattleReplay(data, initial());
    expect(first.step.type).toBe("awaitingPlayer");
    if (first.step.type !== "awaitingPlayer") throw new Error("fixture did not reach player");
    const target = first.session.targetableIdsOf(1)[0]!;
    const snapshot = appendBattleReplayCommand(initial(), {
      type: "ability",
      actorId: first.step.actorId,
      slot: first.step.choices[0]!.slot,
      targetIds: [target],
    });
    const restoredA = restoreBattleReplay(data, snapshot);
    const wireCopy = JSON.parse(JSON.stringify(snapshot)) as BattleReplaySnapshotV1;
    const restoredB = restoreBattleReplay(data, wireCopy);
    expect(restoredB.events).toEqual(restoredA.events);
    expect(restoredB.step).toEqual(restoredA.step);
    expect(restoredB.decisionId).toBe(restoredA.decisionId);
  });

  it("rejects a transcript action for a stale actor", () => {
    const first = restoreBattleReplay(data, initial());
    expect(() => restoreBattleReplay(data, appendBattleReplayCommand(initial(), {
      type: "delay",
      actorId: `${first.step.type === "awaitingPlayer" ? first.step.actorId : "unknown"}-stale`,
    }))).toThrow(/does not match/);
  });

  it("keeps server-derived capture party level private in the replay snapshot", () => {
    const first = restoreBattleReplay(data, initial());
    if (first.step.type !== "awaitingPlayer") throw new Error("fixture did not reach player");
    const target = first.session.targetableIdsOf(1)[0]!;
    const snapshot = appendBattleReplayCommand(initial(), {
      type: "capture",
      actorId: first.step.actorId,
      targetId: target,
      cardLevel: 1,
      partyLevel: 8,
    });
    expect(() => restoreBattleReplay(data, snapshot)).not.toThrow();
  });

  it("represents successful retreat as terminal retreat rather than fabricating a draw", () => {
    let foundSuccessfulRetreat = false;
    for (let seed = 0; seed < 1_000; seed += 1) {
      const candidate = { ...initial(), seed };
      const first = restoreBattleReplay(data, candidate);
      if (first.step.type !== "awaitingPlayer") continue;
      const restored = restoreBattleReplay(data, appendBattleReplayCommand(candidate, {
        type: "retreat",
        actorId: first.step.actorId,
      }));
      if (restored.step.type !== "retreated") continue;
      expect(restored.session.retreated).toBe(true);
      expect(restored.step).toEqual({ type: "retreated" });
      foundSuccessfulRetreat = true;
      break;
    }
    expect(foundSuccessfulRetreat).toBe(true);
  });

  it("extends only the committed draw tape and lets a source-less client replay it exactly", () => {
    const generated = [0.12, 0.44, 0.73, 0.31, 0.88, 0.05, 0.62, 0.27];
    let generatedCursor = 0;
    const seeded = initial();
    const tapeInitial: BattleReplaySnapshotV1 = {
      schemaVersion: seeded.schemaVersion,
      teams: seeded.teams,
      options: seeded.options,
      commands: seeded.commands,
      randomDraws: [],
    };
    const boot = restoreBattleReplay(data, tapeInitial, {
      randomSource: () => generated[generatedCursor++ % generated.length]!,
    });
    expect(boot.step.type).toBe("awaitingPlayer");
    if (boot.step.type !== "awaitingPlayer") throw new Error("fixture did not reach player");
    const bootSnapshot = { ...tapeInitial, randomDraws: boot.randomDraws! };
    const targetId = boot.session.targetableIdsOf(1)[0]!;
    const advanced = advanceBattleReplay(data, bootSnapshot, {
      type: "ability",
      actorId: boot.step.actorId,
      slot: boot.step.choices[0]!.slot,
      targetIds: [targetId],
    }, () => generated[generatedCursor++ % generated.length]!);
    const client = restoreBattleReplay(data, JSON.parse(JSON.stringify(advanced.snapshot)));
    expect(client.events).toEqual(advanced.restored.events);
    expect(client.step).toEqual(advanced.restored.step);
    expect(client.randomDraws).toEqual(advanced.snapshot.randomDraws);
    expect(advanced.committedDraws).toEqual(
      advanced.snapshot.randomDraws!.slice(bootSnapshot.randomDraws!.length),
    );
  });

  it("fails loudly when an untrusted replay tries to consume an uncommitted future draw", () => {
    const rng = replayableRng([0.25]);
    expect(rng.next()).toBe(0.25);
    expect(() => rng.next()).toThrow(/tape exhausted/);
  });

  it("lets a presentation replay append only newly committed draws", () => {
    const rng = replayableRng([0.25]);
    expect(rng.next()).toBe(0.25);
    rng.appendCommittedDraws([0.5, 0.75]);
    expect(rng.next()).toBe(0.5);
    expect(rng.next()).toBe(0.75);
    expect(rng.draws).toEqual([0.25, 0.5, 0.75]);
  });

  it("restores an active decision onto the same tape object used for committed suffixes", () => {
    const generated = [0.11, 0.42, 0.73, 0.24, 0.85, 0.36];
    let cursor = 0;
    const snapshot: BattleReplaySnapshotV1 = {
      schemaVersion: 1,
      teams: initial().teams,
      options: initial().options,
      commands: [],
      randomDraws: [],
    };
    const authority = restoreBattleReplay(data, snapshot, {
      randomSource: () => generated[cursor++ % generated.length]!,
    });
    const committed = { ...snapshot, randomDraws: authority.randomDraws! };
    const tape = replayableRng(committed.randomDraws);
    const client = restoreBattleReplay(data, committed, { replayRng: tape });
    expect(client.step).toEqual(authority.step);
    expect(tape.cursor).toBe(committed.randomDraws.length);
    tape.appendCommittedDraws([0.19]);
    expect(tape.draws.at(-1)).toBe(0.19);
  });
});
