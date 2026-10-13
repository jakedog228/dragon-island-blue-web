import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { restorePvpBattle, type PvpBattleSnapshot } from "@dib/engine";
import { PvpMatchViewV1Schema, type PvpMatchViewV1 } from "@dib/game-protocol";
import { PvpService, type PvpPrincipal } from "../src/pvpService.js";
import { PvpCompatibilityRegistry } from "../src/pvpCompatibility.js";
import { FilePvpStore, InMemoryPvpStore, type PvpStore } from "../src/pvpStore.js";

const data = loadGameData();
const logicPackId = `logic-v1:${"a".repeat(64)}`;
const host: PvpPrincipal = { id: "private-host", name: "Host", officialPlayerId: "private-official-player" };
const guest: PvpPrincipal = { id: "private-guest", name: "Guest" };
const stranger: PvpPrincipal = { id: "private-stranger", name: "Stranger" };
const setup = { logicPackId, mods: [] };
const request = (shortType = "FireCub") => ({ requestId: randomUUID(), setup, entry: { source: "offline", party: [{ shortType, level: 5 }] } });
function harness(store: PvpStore = new InMemoryPvpStore()) {
  let now = 1_000_000;
  const officialParty = vi.fn(async () => [{ shortType: "FireCub", level: 5, sourceInstanceId: "private-campaign-id", currentHp: 1 }]);
  const service = new PvpService({ store, profiles: new Map([["base", data]]),
    compatibility: new PvpCompatibilityRegistry([], [{ id: "base", logicPackId, rules: [] }]),
    officialParty, now: () => now, randomSource: () => 0.5 });
  return { service, officialParty, advance: (ms: number) => { now += ms; } };
}
async function pair(service: PvpService) {
  const invitation = await service.invite(host, request());
  const joined = await service.join(guest, { ...request("SnowCub"), code: invitation.code });
  return { invitation, joined };
}
const delay = (view: PvpMatchViewV1, actorId = "t0m0:FireCub") => ({ commandId: randomUUID(), expectedRevision: view.revision,
  decisionId: view.decisionId, action: { type: "delay", actorId } });

describe("PvP service", () => {
  it("refuses to replay a stored match when a restarted server reuses its profile ID for different rules", async () => {
    const store = new InMemoryPvpStore(); const first = harness(store);
    const { joined } = await pair(first.service);
    const restarted = new PvpService({ store, profiles: new Map([["base", data]]),
      compatibility: new PvpCompatibilityRegistry([], [{ id: "base", logicPackId: `logic-v1:${"b".repeat(64)}`, rules: [] }]),
      officialParty: async () => [], now: () => 1_000_000 });
    await expect(restarted.read(host, joined.matchId)).rejects.toMatchObject({ code: "UNAVAILABLE", message: expect.stringContaining("original server rules") });
    expect(await first.service.read(host, joined.matchId)).toMatchObject({ revision: joined.revision, status: "active", logicPackId });
    const forfeit = { ...delay(joined), action: { type: "forfeit" } };
    expect(await restarted.command(guest, joined.matchId, forfeit)).toMatchObject({ status: "ended", winner: 0, endReason: "forfeit" });
    expect(await first.service.read(host)).toMatchObject({ status: "ended", winner: 0 });
  });
  it("pairs parties, exposes only match data, and admits each player's own turn", async () => {
    const { service } = harness();
    const { invitation, joined } = await pair(service);
    expect(invitation).toMatchObject({ status: "waiting", you: 0 });
    expect(joined).toMatchObject({ status: "active", you: 1, turn: 0 });
    expect(joined.battle!.teams.map((team) => team[0]!.shortType)).toEqual(["FireCub", "SnowCub"]);
    const hostView = (await service.read(host, invitation.matchId))!;
    expect(hostView.battle).toEqual(joined.battle);
    const command = delay(hostView);
    await expect(service.command(guest, joined.matchId, command)).rejects.toMatchObject({ code: "NOT_YOUR_TURN" });
    const next = await service.command(host, joined.matchId, command);
    expect(next.turn).toBe(1);
    expect(next.revision).toBe(2);
    const afterGuest = await service.command(guest, joined.matchId, delay(next, "t1m0:SnowCub"));
    expect(afterGuest.turn).toBe(0);
    expect(JSON.stringify(afterGuest)).not.toMatch(/private-|sourceInstanceId|seed|backgroundKey|\.png|\.plist/);
    expect(PvpMatchViewV1Schema.parse(afterGuest)).toEqual(afterGuest);
  });

  it("loads Official rosters from the authority and refuses snapshots in Official requests", async () => {
    const { service, officialParty } = harness();
    const input = { requestId: randomUUID(), setup, entry: { source: "official", slotId: "slot-1" } };
    const invitation = await service.invite(host, input);
    expect(officialParty).toHaveBeenCalledWith(host.officialPlayerId, "slot-1", logicPackId);
    const joined = await service.join(guest, { ...request("SnowCub"), code: invitation.code });
    expect(joined.players).toEqual([{ name: "Host", source: "official" }, { name: "Guest", source: "offline" }]);
    expect(JSON.stringify(joined)).not.toContain("private-campaign-id");
    expect(joined.battle!.teams[0][0]).not.toHaveProperty("currentHp");
    await expect(service.invite(stranger, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(service.invite(host, { ...input, entry: { ...input.entry, party: [] } })).rejects.toThrow();
  });

  it("serializes simultaneous joins: exactly one guest obtains the invitation", async () => {
    const { service } = harness();
    const invitation = await service.invite(host, request());
    const results = await Promise.allSettled([guest, stranger].map((principal) => service.join(principal, { ...request("SnowCub"), code: invitation.code })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await service.read(host, invitation.matchId))!.players).toHaveLength(2);
  });

  it("keeps exact receipts after later actions and rejects ID/body collisions and stale decisions", async () => {
    const { service } = harness();
    const input = request();
    const invitation = await service.invite(host, input);
    const joinInput = { ...request("SnowCub"), code: invitation.code };
    const joined = await service.join(guest, joinInput);
    const command = delay(joined);
    const result = await service.command(host, joined.matchId, command);
    await service.command(guest, joined.matchId, delay(result, "t1m0:SnowCub"));
    expect(await service.invite(host, input)).toEqual(invitation);
    expect(await service.join(guest, joinInput)).toEqual(joined);
    expect(await service.command(host, joined.matchId, command)).toEqual(result);
    await expect(service.command(host, joined.matchId, { ...command, action: { type: "forfeit" } })).rejects.toMatchObject({ code: "COMMAND_CONFLICT" });
    await expect(service.command(host, joined.matchId, { ...command, commandId: randomUUID() })).rejects.toMatchObject({ code: "STALE_DECISION" });
  });

  it("serializes racing commands and deduplicates concurrent identical submissions", async () => {
    const { service } = harness();
    const { joined } = await pair(service);
    const command = delay(joined);
    const duplicates = await Promise.all([service.command(host, joined.matchId, command), service.command(host, joined.matchId, command)]);
    expect(duplicates[0]).toEqual(duplicates[1]);
    expect(duplicates[0]!.revision).toBe(joined.revision + 1);
    const races = await Promise.allSettled([
      service.command(guest, joined.matchId, delay(duplicates[0]!, "t1m0:SnowCub")),
      service.command(guest, joined.matchId, delay(duplicates[0]!, "t1m0:SnowCub")),
    ]);
    expect(races.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = races.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({ code: "STALE_DECISION" });
    expect((await service.read(host, joined.matchId))!.revision).toBe(joined.revision + 2);
  });

  it("refuses outsiders, self-join, duplicate active matches and client-authored outcomes", async () => {
    const { service } = harness();
    const invitation = await service.invite(host, request());
    await expect(service.join(host, { ...request(), code: invitation.code })).rejects.toMatchObject({ code: "SELF_JOIN" });
    await expect(service.invite(host, request())).rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
    const joined = await service.join(guest, { ...request("SnowCub"), code: invitation.code });
    await expect(service.read(stranger, joined.matchId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.command(stranger, joined.matchId, delay(joined))).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const field of ["damage", "randomDraws", "winner", "price", "team", "reward", "seed"]) {
      await expect(service.command(host, joined.matchId, { ...delay(joined), [field]: 1 })).rejects.toThrow();
    }
    await expect(service.invite(stranger, { ...request(), entry: { source: "offline", party: [{ shortType: "FireCub", level: 5, sourceInstanceId: "spoofed" }] } })).rejects.toThrow();
  });

  it("atomically rejects unknown parties and leaves the code usable", async () => {
    const { service } = harness();
    const invitation = await service.invite(host, request());
    await expect(service.join(guest, { ...request("MissingMonster"), code: invitation.code })).rejects.toMatchObject({ code: "INCOMPATIBLE",
      issues: [{ code: "PARTY_UNSUPPORTED", path: "entry.party", message: expect.stringContaining("MissingMonster") }] });
    expect((await service.read(host, invitation.matchId))!.status).toBe("waiting");
    expect((await service.join(guest, { ...request("SnowCub"), code: invitation.code })).status).toBe("active");
  });

  it("supports cancelling invitations and retrying cancellation", async () => {
    const { service } = harness();
    const invitation = await service.invite(host, request());
    const id = randomUUID();
    await expect(service.cancel(guest, invitation.matchId, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const result = await service.cancel(host, invitation.matchId, id);
    expect(result.status).toBe("cancelled");
    expect(await service.cancel(host, invitation.matchId, id)).toEqual(result);
    await expect(service.join(guest, { ...request(), code: invitation.code })).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
    expect((await service.invite(host, request())).status).toBe("waiting");
  });

  it("expires invite codes and awards timeout to the waiting opponent without touching either save", async () => {
    const { service, advance, officialParty } = harness();
    const old = await service.invite(host, request());
    advance(10 * 60_000);
    await expect(service.join(guest, { ...request(), code: old.code })).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    const { joined } = await pair(service);
    advance(5 * 60_000);
    const timedOut = await service.read(guest, joined.matchId);
    expect(timedOut).toMatchObject({ status: "ended", winner: 1, endReason: "timeout" });
    expect(officialParty).not.toHaveBeenCalled();
    expect(await service.read(host)).toMatchObject({ matchId: joined.matchId, status: "ended", endReason: "timeout" });
    advance(24 * 60 * 60_000);
    expect(await service.read(host)).toBeUndefined();
  });

  it("allows out-of-turn forfeit and releases both players for a new match", async () => {
    const { service } = harness();
    const { joined } = await pair(service);
    const ended = await service.command(guest, joined.matchId, { ...delay(joined), action: { type: "forfeit" } });
    expect(ended).toMatchObject({ status: "ended", winner: 0, endReason: "forfeit" });
    expect(restorePvpBattle(data, ended.battle as PvpBattleSnapshot).decision).toEqual({ type: "ended", winner: 0, reason: "forfeit" });
    await expect(service.command(host, joined.matchId, delay(ended))).rejects.toThrow();
    expect((await service.invite(guest, request())).status).toBe("waiting");
  });

  it("rolls back state when persistence fails", async () => {
    const backing = new InMemoryPvpStore();
    let fail = false;
    const store: PvpStore = { transaction: (operation) => backing.transaction(async (state) => {
      const result = await operation(state);
      if (fail) throw new Error("disk full");
      return result;
    }) };
    const { service } = harness(store);
    const { joined } = await pair(service);
    const command = delay(joined);
    fail = true;
    await expect(service.command(host, joined.matchId, command)).rejects.toThrow("disk full");
    fail = false;
    expect((await service.read(host, joined.matchId))!.revision).toBe(joined.revision);
    expect((await service.command(host, joined.matchId, command)).revision).toBe(joined.revision + 1);
  });

  it("recovers file-backed matches and exact receipts across service/store restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dib-pvp-"));
    try {
      const first = harness(new FilePvpStore(directory)).service;
      const { joined } = await pair(first);
      const command = delay(joined);
      const accepted = await first.command(host, joined.matchId, command);
      const second = harness(new FilePvpStore(directory)).service;
      expect(await second.read(host, joined.matchId)).toEqual(accepted);
      expect(await second.command(host, joined.matchId, command)).toEqual(accepted);
      await second.command(guest, joined.matchId, delay(accepted, "t1m0:SnowCub"));
      expect(await first.command(host, joined.matchId, command)).toEqual(accepted);
      const raw = JSON.parse(await readFile(join(directory, "pvp.json"), "utf8"));
      expect(raw.matches[0].receipts[2]).not.toHaveProperty("view.battle");
      for (const receipt of raw.matches[0].receipts) delete receipt.view.logicPackId;
      await writeFile(join(directory, "pvp.json"), JSON.stringify(raw));
      expect(await second.command(host, joined.matchId, command)).toEqual(accepted);
      raw.matches[0].receipts[0].view.logicPackId = `logic-v1:${"b".repeat(64)}`;
      await writeFile(join(directory, "pvp.json"), JSON.stringify(raw));
      await expect(second.read(host, joined.matchId)).rejects.toThrow("integrity validation");
      delete raw.matches[0].receipts[0].view.logicPackId;
      raw.matches[0].battle.seed = 123;
      await writeFile(join(directory, "pvp.json"), JSON.stringify(raw));
      await expect(second.read(host, joined.matchId)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
