import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { advancePvpBattle, createPvpBattle, restorePvpBattle } from "../src/pvp.js";
import { validatePvpAdapters, type PvpBattleAdapter } from "../src/pvpAdapters.js";

function example(name: string): PvpBattleAdapter {
  const source = readFileSync(new URL(`../../../examples/pvp-adapters/${name}.rules.js`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  return new Function(source)()(createHash("sha256").update(source).digest("hex")) as PvpBattleAdapter;
}
const adapters = [example("echo-strike"), example("turn-counter")];
const data = loadGameData();
const start = () => createPvpBattle(data, [[{ shortType: "FireCub", level: 10 }], [{ shortType: "SnowCub", level: 10 }]], () => 0.5, 1, adapters);

describe("per-match PvP adapter execution", () => {
  it("executes a multi-hit action on both teams, composes another adapter, and restores their private state", () => {
    let battle = start();
    for (const team of [0, 1] as const) {
      const turn = battle.restored.decision;
      if (turn.type !== "turn") throw new Error("Missing turn");
      expect(turn.team).toBe(team);
      const enemy = battle.restored.session.targetableIdsOf(team === 0 ? 1 : 0)[0]!;
      const hp = battle.restored.session.hpOf(enemy);
      const before = battle.restored.events.length;
      battle = advancePvpBattle(data, battle.snapshot, { team, action: { type: "adapter", actorId: turn.actorId,
        rulesId: adapters[0]!.rulesId, command: "strike", input: { target: enemy } } }, () => 0.5, adapters);
      expect(battle.restored.session.hpOf(enemy)).toBeLessThan(hp);
      expect(battle.restored.events.slice(before).filter((event) => event.type === "damageDealt")).toHaveLength(2);
      const restored = restorePvpBattle(data, JSON.parse(JSON.stringify(battle.snapshot)), adapters);
      expect(restored.events).toEqual(battle.restored.events);
      expect(restored.extensions.get(adapters[0]!.rulesId)!.state!()).toEqual({ strikes: team === 0 ? [2, 0] : [2, 2] });
      expect(restored.extensions.get(adapters[1]!.rulesId)!.state!()).toEqual({ turns: team === 0 ? [1, 0] : [1, 1] });
    }
    expect(start().restored.extensions.get(adapters[0]!.rulesId)!.state!()).toEqual({ strikes: [0, 0] });
  });
  it("rejects injected outcomes, friendly targets, unknown handlers and stale/opponent ownership without changing the transcript", () => {
    const battle = start(), saved = JSON.stringify(battle.snapshot);
    const action = { type: "adapter", actorId: "t0m0:FireCub", rulesId: adapters[0]!.rulesId, command: "strike", input: { target: "t1m0:SnowCub" } } as const;
    for (const input of [{ ...action.input, damage: 999 }, { target: "t0m0:FireCub" }, { target: [] }]) {
      expect(() => advancePvpBattle(data, battle.snapshot, { team: 0, action: { ...action, input } }, () => 0.5, adapters)).toThrow();
    }
    for (const changed of [{ command: "toString" }, { rulesId: "missing" }, { actorId: "stale" }]) {
      expect(() => advancePvpBattle(data, battle.snapshot, { team: 0, action: { ...action, ...changed } }, () => 0.5, adapters)).toThrow();
    }
    expect(() => advancePvpBattle(data, battle.snapshot, { team: 1, action }, () => 0.5, adapters)).toThrow("opponent");
    expect(JSON.stringify(battle.snapshot)).toBe(saved);
  });
  it("fails closed for missing, changed, reordered, duplicate or conflicting rules", () => {
    const battle = start();
    expect(() => restorePvpBattle(data, battle.snapshot)).toThrow("original ordered");
    expect(() => restorePvpBattle(data, battle.snapshot, [{ ...adapters[0]!, digest: "0".repeat(64) }, adapters[1]!])).toThrow("original ordered");
    expect(() => validatePvpAdapters([...adapters].reverse())).toThrow("requires preceding");
    expect(() => validatePvpAdapters([adapters[0]!, adapters[0]!])).toThrow("Duplicate");
    expect(() => validatePvpAdapters([{ ...adapters[0]!, conflicts: [adapters[1]!.rulesId] }, adapters[1]!])).toThrow("conflicts");
    expect(() => validatePvpAdapters([{ ...adapters[0]!, apiVersion: "future" } as never])).toThrow("API version");
  });
  it("records adapter RNG and never re-rolls on restore", () => {
    const randomAdapter: PvpBattleAdapter = { apiVersion: "pvp-adapter-v1", rulesId: "test.random-v1", digest: "e".repeat(64),
      create: ({ random }) => { const draws: number[] = []; return { afterCommand: () => { draws.push(random()); }, state: () => ({ draws }) }; } };
    const initial = createPvpBattle(data, [[{ shortType: "FireCub", level: 10 }], [{ shortType: "SnowCub", level: 10 }]], () => 0.5, 1, [randomAdapter]);
    const next = advancePvpBattle(data, initial.snapshot, { team: 0, action: { type: "delay", actorId: "t0m0:FireCub" } }, () => 0.125, [randomAdapter]);
    expect(restorePvpBattle(data, next.snapshot, [randomAdapter]).extensions.get(randomAdapter.rulesId)!.state!()).toEqual({ draws: [0.125] });
    expect(() => restorePvpBattle(data, { ...next.snapshot, randomDraws: next.snapshot.randomDraws.slice(0, -1) }, [randomAdapter])).toThrow("exhausted");
  });
});
