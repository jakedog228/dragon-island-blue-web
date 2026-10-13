import { describe, it, expect, vi } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { advancePvpBattle, createPvpBattle, type PvpBattleSnapshot, type PvpAction } from "@dib/engine";
import { PvpMatchViewV1Schema } from "@dib/game-protocol";
import { PvpPlayback } from "../src/pvp/pvpPlayback.js";
import { pvpPerspectiveSession } from "../src/pvp/pvpPerspective.js";
import { BattleRoster } from "../src/battle/battleRoster.js";
import { multiplayerEnemyGap, enemyTeamLayoutMetrics } from "../src/battle/displayShared.js";
import { screenPointsForMode } from "../src/displayMode.js";

const data = loadGameData();
const teams = [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]] as const;
const view = (battle: PvpBattleSnapshot, you: 0 | 1, revision = 1) => PvpMatchViewV1Schema.parse({
  protocolVersion: "pvp-protocol-v1", matchId: "11111111-1111-4111-8111-111111111111", logicPackId: `logic-v1:${"a".repeat(64)}`,
  revision, status: "active", you, turn: 0, players: [{ name: "A", source: "offline" }, { name: "B", source: "offline" }],
  expiresAt: 1000000, notes: [], battle,
});
describe("normal encounter PvP playback", () => {
  it("plays a fresh full battle, including automatic spirit turns, to the same terminal state on both cameras", async () => {
    let authority = createPvpBattle(data, teams, () => 0.5, 1, [],
      [{ energy: 100, savedXp: { Resistance: 1 } }, { energy: 100, savedXp: { Fire: 1 } }]);
    const clients = ([0, 1] as const).map(you => new PvpPlayback(data, view(authority.snapshot, you), [], vi.fn(), vi.fn(), vi.fn(), true));
    const advance = (client: PvpPlayback) => {
      for (;;) {
        const step = client.session.advanceForPresentation();
        if (step.type !== "awaitingEnemy") return step;
        client.session.submitEnemyAction();
      }
    };
    let steps = clients.map(advance);
    let summons = new Set<number>();
    for (let turn = 0; turn < 100 && authority.restored.decision.type === "turn"; turn++) {
      const decision = authority.restored.decision;
      const choice = decision.choices.find(c => c.slot === "usable1")!;
      const action: PvpAction = !summons.has(decision.team)
        ? { type: "spirit", actorId: decision.actorId, shortType: decision.team === 0 ? "Resistance" : "Fire" }
        : turn < 12 ? { type: "delay", actorId: decision.actorId }
        : { type: "ability", actorId: decision.actorId, slot: choice.slot, targets: authority.restored.session.targetableIdsOf(decision.team === 0 ? 1 : 0).slice(0, 1) };
      const pending = clients.map((c, index) => {
        const step = steps[index]!; if (step.type !== "awaitingPlayer") throw new Error("missing human decision");
        return c.resolve(step, index === decision.team ? action : undefined);
      });
      authority = advancePvpBattle(data, authority.snapshot, { team: decision.team, action }, () => 0.5);
      clients.forEach((c, you) => c.update(view(authority.snapshot, you as 0 | 1, turn + 2)));
      await Promise.all(pending);
      if (action.type === "spirit") summons.add(decision.team);
      else steps = clients.map(advance);
      for (const client of clients) expect(client.restored.session.events).toEqual(authority.restored.events);
    }
    expect(authority.restored.decision.type).toBe("ended");
    expect(summons.size).toBe(2);
    expect(steps.every(step => step.type === "ended")).toBe(true);
    for (const [you, step] of steps.entries()) {
      if (step.type !== "ended" || authority.restored.decision.type !== "ended") throw new Error("missing result");
      expect(step.report.winner).toBe(authority.restored.decision.winner === you ? 0 : 1);
    }
    expect(clients[0]!.session.events.filter(event => event.type === "abilityUsed").map(event => event.source)).toContain("t1m1:Fire");
    clients.forEach(c => c.dispose());
  });
  it("keeps canonical identities with opposite cameras and no new random draws", async () => {
    const initial = createPvpBattle(data, teams, () => 0.5, 1);
    const sends = [vi.fn(), vi.fn()];
    const clients = ([0, 1] as const).map(you => new PvpPlayback(data, view(initial.snapshot, you), [], sends[you]!, vi.fn(), vi.fn()));
    let snapshot = initial.snapshot;
    let steps = clients.map(c => c.resumedStep);
    for (let index = 0; index < 8; index++) {
      const owner = index % 2 as 0 | 1;
      const action: PvpAction = { type: "delay", actorId: steps[0]?.type === "awaitingPlayer" ? steps[0].actorId : "bad" };
      const oldLength = clients[0]!.session.events.length;
      const pending = clients.map((client, you) => {
        const step = steps[you]!; if (step?.type !== "awaitingPlayer") throw new Error("missing turn");
        expect(client.session.teamOf(step.actorId)).toBe(you === owner ? 0 : 1);
        return client.resolve(step, you === owner ? action : undefined);
      });
      await Promise.resolve();
      expect(clients[0]!.session.events.length).toBe(oldLength); // no optimistic mechanics
      snapshot = advancePvpBattle(data, snapshot, { team: owner, action }, () => 0.5).snapshot;
      clients.forEach((c, you) => c.update(view(snapshot, you as 0 | 1, index + 2)));
      const results = await Promise.all(pending);
      expect(results[0]!.events).toEqual(results[1]!.events);
      expect(results[0]!.abilityPath).toBe("Utility.Delay");
      steps = clients.map(c => c.session.advanceForPresentation());
    }
    const guest = clients[1]!;
    expect(guest.session.activeIdsOf(0)).toEqual(["t1m0:SnowCub"]);
    expect(guest.session.activeIdsOf(1)).toEqual(["t0m0:FireCub"]);
    const roster = new BattleRoster({ backgroundKey: "unused", playerTeam: [...teams[1]], enemyTeam: [...teams[0]] }, 1);
    expect(roster.entryOf("t1m0:SnowCub").team).toBe(0);
    clients.forEach(c => c.dispose());
  });

  it("hydrates reconnect history, summons once from a committed reply, and wakes pending work on dispose", async () => {
    const spirits = [{ energy: 100, savedXp: { Resistance: 1 } }, { energy: 100, savedXp: { Fire: 400 } }] as const;
    const initial = createPvpBattle(data, teams, () => 0.5, 1, [], spirits);
    const send = vi.fn(), client = new PvpPlayback(data, view(initial.snapshot, 0), [], send, vi.fn(), vi.fn());
    const pending = client.summon("Resistance");
    expect(client.session.summonIdOf(0)).toBeUndefined();
    const command = { team: 0 as const, action: send.mock.calls[0]![0] };
    const committed = advancePvpBattle(data, initial.snapshot, command, () => 0.5);
    client.update(view(committed.snapshot, 0, 2));
    const result = await pending;
    expect(result.spiritId).toBe("t0m1:Resistance");
    expect(client.session.summonIdOf(0)).toBe(result.spiritId);
    const resumed = new PvpPlayback(data, view(committed.snapshot, 0, 2), [], vi.fn(), vi.fn(), vi.fn());
    expect(resumed.profile.spiritSnapshot()).toMatchObject({ energy: 0, spirits: [{ shortType: "Resistance", savedXp: 34, usedThisTrip: true }] });
    expect(resumed.historyEvents).toEqual(client.session.events);
    const step = resumed.resumedStep; if (step?.type !== "awaitingPlayer") throw new Error("missing turn");
    const waiting = resumed.resolve(step); resumed.dispose();
    expect(await waiting).toMatchObject({ terminal: true });
    client.dispose();
  });

  it("maps terminal winners and summon events without rewriting living IDs", () => {
    const initial = createPvpBattle(data, teams, () => 0.5, 1);
    const guest = pvpPerspectiveSession(initial.restored.session, 1);
    expect(guest.events[0]).toEqual({ type: "battleStarted", teams: [["t1m0:SnowCub"], ["t0m0:FireCub"]] });
    expect(guest.hpOf("t1m0:SnowCub")).toBe(initial.restored.session.hpOf("t1m0:SnowCub"));
  });

  it.each(["iphone", "ipad"] as const)("fits the fourth opponent slot into the normal field band: %s", mode => {
    const gap = multiplayerEnemyGap(4, mode);
    const expected = screenPointsForMode(mode).w - enemyTeamLayoutMetrics(mode).offsetX;
    expect(128 * 4 + gap * 3).toBeCloseTo(expected);
    expect(multiplayerEnemyGap(3, mode)).toBe(0);
    expect(multiplayerEnemyGap(2, mode)).toBe(64);
  });
});
