import { describe, expect, it, vi } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { createPvpBattle, type PlayerChoice } from "@dib/engine";
import type { PvpMatchViewV1 } from "@dib/game-protocol";
import { PvpClient, PvpClientError } from "../src/pvp/pvpClient.js";
import { PvpMatchController } from "../src/pvp/pvpMatchController.js";
import { pvpChosenTargets, pvpLayout, pvpTargets, pvpRulesMismatch } from "../src/pvp/pvpBattleModel.js";
import { pvpModEnabled, setPvpModEnabled } from "../src/pvp/pvpMod.js";

const setup = { logicPackId: `logic-v1:${"a".repeat(64)}`, mods: [] };
const entry = () => ({ source: "offline" as const, party: [{ shortType: "FireCub", level: 5 }] });
const match: PvpMatchViewV1 = { protocolVersion: "pvp-protocol-v1", matchId: "11111111-1111-4111-8111-111111111111", logicPackId: setup.logicPackId,
  revision: 0, status: "waiting", you: 0, players: [{ name: "One", source: "offline" }], code: "ABCD2345", expiresAt: 9999999999999, notes: [] };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("PvP client lifecycle", () => {
  it("keeps a pending write retryable when a server response has an incompatible schema", async () => {
    const transport = vi.fn().mockResolvedValueOnce(response({ status: "unknown-new-server-status" })).mockResolvedValueOnce(response(match));
    const controller = new PvpMatchController(new PvpClient(transport), setup, entry, () => {});
    await controller.invite();
    expect(controller.state.error?.message).toContain("Update the client and server together"); expect(controller.state.canRetry).toBe(true);
    await controller.retry(); expect(controller.state.match).toEqual(match);
    expect(transport.mock.calls[0]![1].body).toBe(transport.mock.calls[1]![1].body);
  });
  it("retries the exact invite envelope after a lost response and prevents a replacement write", async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error("lost reply")).mockResolvedValueOnce(response(match));
    const controller = new PvpMatchController(new PvpClient(transport), setup, entry, () => {});
    await controller.invite(); expect(controller.state.canRetry).toBe(true);
    await controller.join("ABCD2345"); expect(transport).toHaveBeenCalledTimes(1);
    await controller.retry(); expect(controller.state.match).toEqual(match);
    expect(transport.mock.calls[0]![1].body).toBe(transport.mock.calls[1]![1].body);
    expect(controller.state.canRetry).toBe(false);
  });
  it("does not regress a match when an idempotency receipt is older than a reconnect", async () => {
    const active = { ...match, status: "active", revision: 1, decisionId: "decision-1", turn: 0 };
    const transport = vi.fn().mockRejectedValueOnce(new Error("lost reply"))
      .mockResolvedValueOnce(response({ match: active })).mockResolvedValueOnce(response(match));
    const controller = new PvpMatchController(new PvpClient(transport), setup, entry, () => {});
    await controller.invite(); await controller.refresh(); await controller.retry();
    expect(controller.state.match).toMatchObject({ status: "active", revision: 1 });
  });
  it("shows structured incompatibility issues and allows correction without retrying a refused write", async () => {
    const details = { code: "INCOMPATIBLE", message: "Mods cannot be reconciled", issues: [{ code: "MOD_UNSUPPORTED", modId: "custom.rules",
      path: "guest.mods[0]", message: "No adapter for custom.rules 2", suggestion: "Disable custom.rules" }] };
    const controller = new PvpMatchController(new PvpClient(async () => response({ error: details }, 409)), setup, entry, () => {});
    await controller.join("abcd2345");
    expect(controller.state.error).toBeInstanceOf(PvpClientError);
    expect((controller.state.error as PvpClientError).details).toEqual(details);
    expect(controller.state.canRetry).toBe(false);
  });
  it("ignores a late response after disposal and serializes duplicate clicks", async () => {
    let resolve!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>((done) => { resolve = done; })), changed = vi.fn();
    const controller = new PvpMatchController(new PvpClient(transport), setup, entry, changed);
    const pending = controller.invite(); await controller.invite(); expect(transport).toHaveBeenCalledTimes(1);
    controller.dispose(); const before = changed.mock.calls.length; resolve(response(match)); await pending;
    expect(changed).toHaveBeenCalledTimes(before); expect(controller.state.match).toBe(null);
  });
  it("queues one player action behind polling without disabling controls or losing the click", async () => {
    const active = { ...match, status: "active", revision: 1, decisionId: "decision-1", turn: 0 };
    let finishRead!: (response: Response) => void;
    const transport = vi.fn().mockResolvedValueOnce(response({ match: active }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRead = resolve; }))
      .mockResolvedValueOnce(response({ ...active, revision: 2, turn: 1 }));
    const controller = new PvpMatchController(new PvpClient(transport), setup, entry, () => {});
    await controller.refresh(); const poll = controller.refresh();
    expect(controller.state.busy).toBe(false);
    const action = controller.submit({ type: "delay", actorId: "t0m0:FireCub" });
    await controller.submit({ type: "delay", actorId: "t0m0:FireCub" });
    expect(controller.state.busy).toBe(true); expect(transport).toHaveBeenCalledTimes(2);
    finishRead(response(active)); await poll; await action;
    expect(transport).toHaveBeenCalledTimes(3); expect(controller.state.match?.revision).toBe(2);
    expect(JSON.parse(transport.mock.calls[2]![1].body)).toMatchObject({ expectedRevision: 1, action: { type: "delay", actorId: "t0m0:FireCub" } });
  });
  it("keeps a guest identity when persistent storage rejects writes", async () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    const fetcher = vi.fn(async (path: string | URL | Request) => String(path).endsWith("/session")
      ? response({ protocolVersion: "pvp-protocol-v1", token: "guest-only-token", expiresAt: Date.now() + 60000 }) : response({ match: null }));
    const options = { endpoint: "https://test-volatile.example", storage, fetch: fetcher as typeof fetch };
    const one = await PvpClient.offline(options); await one.current();
    const two = await PvpClient.offline(options); await two.current();
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith("/session"))).toHaveLength(1);
    expect(new Headers((fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].headers).get("Authorization")).toBe("Bearer guest-only-token");
  });
  it("catches a party projection failure without sending a request", async () => {
    const transport = vi.fn(); const controller = new PvpMatchController(new PvpClient(transport), setup, () => { throw new Error("Heal your party"); }, () => {});
    await controller.invite(); expect(controller.state.error?.message).toBe("Heal your party"); expect(transport).not.toHaveBeenCalled();
  });
});

describe("PvP selection and display", () => {
  it("refuses to replay a recovered match against a different content rules identity", () => {
    expect(pvpRulesMismatch(setup.logicPackId, match)).toBeUndefined();
    expect(pvpRulesMismatch(`logic-v1:${"b".repeat(64)}`, match)).toMatchObject({ code: "INCOMPATIBLE", issues: [{ code: "CONTENT_MISMATCH", path: "setup.logicPackId" }] });
  });
  it("persists the built-in toggle without executing a mod or requiring storage", () => {
    const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(pvpModEnabled(storage)).toBe(false); setPvpModEnabled(true, storage); expect(pvpModEnabled(storage)).toBe(true);
    const blocked = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    setPvpModEnabled(true, blocked); expect(pvpModEnabled(blocked)).toBe(true);
    setPvpModEnabled(false, blocked); expect(pvpModEnabled(blocked)).toBe(false);
  });
  it.each([ ["iphone", 480, 320], ["ipad", 512, 384] ] as const)("scales the new %s board to its window", (mode, w, h) => {
    const layout = pvpLayout(mode); expect(layout.w).toBe(w); expect(layout.h).toBe(h);
    expect(layout.cellW * 4 + layout.margin * 2).toBeLessThanOrEqual(w);
    expect(layout.controlsY + layout.buttonH * 2).toBeLessThan(h);
    expect(layout.titleFont).toBe(h * 0.045); expect(layout.tournamentButton).toEqual({ x: w * 0.025, y: h * 0.045, font: h * 0.05 });
  });
  it("resolves target pools relative to either human team and rejects duplicate or wrong-side selections", () => {
    const { restored } = createPvpBattle(loadGameData(), [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]], () => 0.5);
    const choice: PlayerChoice = { slot: "usable1", abilityPath: "test", displayName: "test", tier: undefined, activationLength: 100, targeting: { kind: "enemies", count: 2 } };
    const requirement = pvpTargets(restored.session, "t1m0:SnowCub", choice);
    expect(requirement.enemyCount).toBe(1);
    expect(pvpChosenTargets(requirement, ["t0m0:FireCub"])).toEqual(["t0m0:FireCub"]);
    expect(pvpChosenTargets(requirement, ["t1m0:SnowCub"])).toBeUndefined();
    expect(pvpChosenTargets(requirement, ["t0m0:FireCub", "t0m0:FireCub"])).toBeUndefined();
    const mixed = pvpTargets(restored.session, "t1m0:SnowCub", { ...choice, targeting: { kind: "mixed", enemyCount: 0, friendlyCount: 1, allEnemies: true, allFriends: false } });
    expect(pvpChosenTargets(mixed, ["t1m0:SnowCub", "t0m0:FireCub"])).toEqual(["t0m0:FireCub", "t1m0:SnowCub"]);
    expect(pvpTargets(restored.session, "t1m0:SnowCub", { ...choice, targeting: { kind: "self" } })).toMatchObject({ enemyCount: 0, friendCount: 0 });
  });
});
