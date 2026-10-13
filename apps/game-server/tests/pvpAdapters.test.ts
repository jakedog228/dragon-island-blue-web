import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { type PvpBattleAdapter } from "@dib/engine";
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
  it("refuses gameplay mods at invite, join and reconnect even when their adapters are installed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-pvp-adapter-"));
    try {
      const service = createInstalledPvpService({ data, logicPackId, dataDirectory: directory,
        installation, readOfficialState: async () => undefined });
      await expect(service.invite(host, request("FireCub"))).rejects.toMatchObject({ code: "INCOMPATIBLE" });
      const baseline = { ...request("FireCub"), setup: { logicPackId, mods: [] } };
      const invite = await service.invite(host, baseline);
      await expect(service.join(guest, { ...request("SnowCub"), code: invite.code })).rejects.toMatchObject({ code: "INCOMPATIBLE" });
      expect((await service.read(host))!.status).toBe("waiting");
      expect(() => service.validateSetup(request("FireCub").setup)).toThrow("cosmetic mods only");
      const joined = await service.join(guest, { ...baseline, requestId: randomUUID(), code: invite.code });
      expect(joined.battle!.adapters ?? []).toEqual([]);
      await expect(service.command(host, joined.matchId, { commandId: randomUUID(), expectedRevision: joined.revision,
        decisionId: joined.decisionId, action: { type: "adapter", actorId: "t0m0:FireCub", rulesId: adapters[0]!.rulesId,
          command: "strike", input: { target: "t1m0:FireCub" } } })).rejects.toMatchObject({ code: "INVALID_REQUEST", message: "Gameplay mod actions are disabled in PvP." });
      expect((await service.read(host))!.revision).toBe(joined.revision);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects uninstalled combinations, mismatched declarations and dependency order at startup", () => {
    expect(() => validatePvpInstallation(installation)).not.toThrow();
    expect(() => validatePvpInstallation({ ...installation, profiles: [] })).toThrow("No installed profile executes");
    expect(() => validatePvpInstallation({ ...installation, profiles: [{ ...installation.profiles[0]!, rules: [] }] })).toThrow("exactly its declared");
    expect(() => validatePvpInstallation({ ...installation, profiles: [{ ...installation.profiles[0]!, adapters: [...adapters].reverse() }] })).toThrow("requires preceding");
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
