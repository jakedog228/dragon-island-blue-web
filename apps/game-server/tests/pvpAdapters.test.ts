import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GameData, loadGameData } from "@dib/gamedata";
import { restorePvpBattle, type PvpBattleAdapter, type PvpBattleSnapshot } from "@dib/engine";
import { PvpService } from "../src/pvpService.js";
import { PvpCompatibilityRegistry } from "../src/pvpCompatibility.js";
import { InMemoryPvpStore } from "../src/pvpStore.js";
import { createInstalledPvpService } from "../src/pvpRuntime.js";
import { loadPvpAdapterInstallation, validatePvpInstallation, type PvpAdapterInstallation } from "../src/pvpAdapters.js";

const data = loadGameData(), logicPackId = `logic-v1:${"a".repeat(64)}`;
const adapters = ["echo-strike", "turn-counter"].map((name) => {
  const source = readFileSync(new URL(`../../../examples/pvp-adapters/${name}.rules.js`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  return new Function(source)()(createHash("sha256").update(source).digest("hex")) as PvpBattleAdapter;
});
const mods = adapters.map((adapter, index) => ({ id: `test.mod${index}`, version: "1.0.0", digest: String(index).repeat(64),
  support: { kind: "rules" as const, rulesId: adapter.rulesId } }));
const installation: PvpAdapterInstallation = { mods, profiles: [{ id: "example", logicPackId, data, rules: adapters.map((adapter) => adapter.rulesId), adapters }] };
const host = { id: "host", name: "Host" }, guest = { id: "guest", name: "Guest" };
const request = (shortType: string) => ({ requestId: randomUUID(), setup: { logicPackId, mods: mods.map(({ id, version, digest }) => ({ id, version, digest })) },
  entry: { source: "offline", party: [{ shortType, level: 10 }] } });

describe("operator-installed PvP adapters", () => {
  it("persists composed actions, rolls back invalid input, and returns exact retry receipts after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-pvp-adapter-"));
    const create = (installed = installation) => createInstalledPvpService({ data, logicPackId, dataDirectory: directory,
      installation: installed, readOfficialState: async () => undefined });
    try {
      const service = create();
      // A critical double strike may defeat its target. Keep another teammate alive so this
      // receipt-after-a-later-command test cannot randomly become a terminal-match test.
      const partyRequest = (shortType: string) => {
        const input = request(shortType);
        return { ...input, entry: { ...input.entry, party: [...input.entry.party, ...input.entry.party] } };
      };
      const invite = await service.invite(host, partyRequest("FireCub"));
      const joined = await service.join(guest, { ...partyRequest("SnowCub"), code: invite.code });
      const restored = restorePvpBattle(data, joined.battle as PvpBattleSnapshot, adapters);
      if (restored.decision.type !== "turn") throw new Error("Missing turn");
      const turn = restored.decision;
      const principal = turn.team === 0 ? host : guest;
      const command = { commandId: randomUUID(), expectedRevision: joined.revision, decisionId: joined.decisionId,
        action: { type: "adapter", actorId: turn.actorId, rulesId: adapters[0]!.rulesId, command: "strike",
          input: { target: restored.session.targetableIdsOf(turn.team === 0 ? 1 : 0)[0]! } } };
      await expect(service.command(principal, joined.matchId, { ...command, action: { ...command.action, input: { ...command.action.input, damage: 999 } } })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect((await service.read(principal, joined.matchId))!.revision).toBe(joined.revision);
      const result = await service.command(principal, joined.matchId, command);
      const restarted = create();
      expect(await restarted.command(principal, joined.matchId, command)).toEqual(result);
      const later = restorePvpBattle(data, result.battle as PvpBattleSnapshot, adapters);
      if (later.decision.type !== "turn") throw new Error("Missing next turn");
      await restarted.command(later.decision.team === 0 ? host : guest, joined.matchId, { commandId: randomUUID(), expectedRevision: result.revision, decisionId: result.decisionId,
        action: { type: "delay", actorId: later.decision.actorId } });
      expect(await restarted.command(principal, joined.matchId, command)).toEqual(result);
      const final = (await restarted.read(principal, joined.matchId))!;
      const replayed = restorePvpBattle(data, final.battle as PvpBattleSnapshot, adapters);
      const expectedTurns = [0, 0];
      expectedTurns[turn.team]!++; expectedTurns[later.decision.team]!++;
      expect(replayed.extensions.get(adapters[1]!.rulesId)!.state!()).toEqual({ turns: expectedTurns });
      expect(JSON.stringify(final)).not.toMatch(/sourceInstanceId|backgroundKey|\.png|\.plist/);
      const changed = { ...installation, profiles: [{ ...installation.profiles[0]!, adapters: [{ ...adapters[0]!, digest: "f".repeat(64) }, adapters[1]!] }] };
      await expect(create(changed).read(principal, joined.matchId)).rejects.toThrow("original ordered");
      // Retained decision still allows escape from a match whose operator removed its rules.
      expect(await create(changed).command(principal, joined.matchId, { commandId: randomUUID(), expectedRevision: final.revision,
        decisionId: final.decisionId, action: { type: "forfeit" } })).toMatchObject({ status: "ended" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects uninstalled combinations, mismatched declarations and dependency order at startup", () => {
    expect(() => validatePvpInstallation(installation)).not.toThrow();
    expect(() => validatePvpInstallation({ ...installation, profiles: [] })).toThrow("No installed profile executes");
    expect(() => validatePvpInstallation({ ...installation, profiles: [{ ...installation.profiles[0]!, rules: [] }] })).toThrow("exactly its declared");
    expect(() => validatePvpInstallation({ ...installation, profiles: [{ ...installation.profiles[0]!, adapters: [...adapters].reverse() }] })).toThrow("requires preceding");
  });
  it("admits an added monster and inherited job only through its installed data profile", async () => {
    const raw = (name: string) => JSON.parse(readFileSync(new URL(`../../../extracted/data/${name}.json`, import.meta.url), "utf8"));
    const monsters = raw("Monsters"), jobs = raw("Jobs");
    monsters.Example = { CopperCub: { parent: "Cat.FireCub", index: 991234 } };
    jobs.Example = { CopperCub: { parent: "Cat.FireCub" } };
    const customData = GameData.fromRaw({ monsters, jobs, abilities: raw("Abilities"), abilityComponents: raw("AbilityComponents"), buffs: raw("Buffs") });
    const rules: PvpBattleAdapter = { apiVersion: "pvp-adapter-v1", rulesId: "test.copper-cub-v1", digest: "c".repeat(64), create: () => ({}) };
    const mod = { id: "test.copper-cub", version: "1.0.0", digest: "d".repeat(64) };
    const service = new PvpService({ store: new InMemoryPvpStore(), profiles: new Map([["copper", customData]]),
      adapters: new Map([["copper", [rules]]]), officialParty: async () => [], randomSource: () => 0.5,
      compatibility: new PvpCompatibilityRegistry([{ ...mod, support: { kind: "rules", rulesId: rules.rulesId } }],
        [{ id: "copper", logicPackId, rules: [rules.rulesId] }]),
    });
    const hostInput = { ...request("CopperCub"), setup: { logicPackId, mods: [mod] } };
    const invite = await service.invite(host, hostInput);
    const joined = await service.join(guest, { ...hostInput, requestId: randomUUID(), code: invite.code });
    const battle = restorePvpBattle(customData, joined.battle as PvpBattleSnapshot, [rules]);
    expect(battle.session.shortTypeOf("t0m0:CopperCub")).toBe("CopperCub");
    if (battle.decision.type !== "turn") throw new Error("Missing turn");
    const result = await service.command(host, joined.matchId, { commandId: randomUUID(), expectedRevision: joined.revision,
      decisionId: joined.decisionId, action: { type: "ability", actorId: battle.decision.actorId, slot: "usable1", targets: ["t1m0:CopperCub"] } });
    expect(restorePvpBattle(customData, result.battle as PvpBattleSnapshot, [rules]).session.hpOf("t1m0:CopperCub")).toBeLessThan(battle.session.hpOf("t1m0:CopperCub"));
    expect(() => data.monsterByShortType("CopperCub")).toThrow();
  });
  it("refuses metadata-only mechanical support without executable adapters", () => {
    expect(() => new PvpService({ store: new InMemoryPvpStore(), profiles: new Map([["example", data]]),
      compatibility: new PvpCompatibilityRegistry(mods, [{ id: "example", logicPackId, rules: adapters.map(a => a.rulesId) }]),
      officialParty: async () => [],
    })).toThrow("must execute exactly");
  });
  it("loads only the explicitly configured local operator module and refuses incompatible API versions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-pvp-module-"));
    try {
      const valid = join(directory, "valid.mjs"), invalid = join(directory, "invalid.mjs");
      await writeFile(valid, 'export const apiVersion="pvp-server-adapters-v1"; export const install=()=>({profiles:[],mods:[]});');
      await writeFile(invalid, 'export const apiVersion="future";');
      expect(await loadPvpAdapterInstallation(undefined, { data, logicPackId })).toEqual({ profiles: [], mods: [] });
      expect(await loadPvpAdapterInstallation(valid, { data, logicPackId })).toEqual({ profiles: [], mods: [] });
      await expect(loadPvpAdapterInstallation(invalid, { data, logicPackId })).rejects.toThrow("must export");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
