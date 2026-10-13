import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPvpBattle } from "@dib/engine";
import { loadGameData } from "@dib/gamedata";
import { PvpBattleSnapshotV1Schema, type PvpMatchViewV1 } from "@dib/game-protocol";
import { PvpClient } from "../src/pvp/pvpClient.js";

const mocks = vi.hoisted(() => ({ boards: [] as any[], popups: [] as any[] }));
vi.mock("../src/pvp/pvpBattleView.js", () => ({ PvpBattleView: class {
  debugState = { renderer: "BattleNode" };
  dispose = vi.fn(); requestBack = vi.fn();
  constructor(...args: any[]) { Object.assign(this, { submit: args[4], ended: args[5], failed: args[6] }); mocks.boards.push(this); }
  update(match: PvpMatchViewV1) { if (match.status === "ended") (this as any).ended(); }
} }));
vi.mock("../src/pvp/pvpAppearance.js", () => ({ preparePvpAppearance: async () => ({ destroy: vi.fn() }) }));
vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));
vi.mock("../src/localization.js", () => ({ localizedString: () => "OK" }));
vi.mock("../src/ui/popup.js", () => ({ PopupHost: { for: () => ({ dismissOwnedBy: vi.fn() }) } }));
vi.mock("../src/ui/monsterHatchPopup.js", () => ({
  buildMonsterHatchMessageContent: (text: string) => text,
  showMonsterHatchPopup: async (_env: unknown, options: any) => {
    const popup = { ...options, dismiss: vi.fn(() => options.onDismiss()) };
    mocks.popups.push(popup); return popup;
  },
}));
import { showPvpFlow, type PvpFlowHandle } from "../src/pvp/pvpFlow.js";

class ElementStub {
  open = false; isConnected = true; textContent = ""; children: ElementStub[] = [];
  listeners = new Map<string, () => void>();
  setAttribute() {} focus() {} remove() { this.isConnected = false; }
  addEventListener(name: string, fn: () => void) { this.listeners.set(name, fn); }
  append(...children: ElementStub[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  querySelector() { return null; }
  close() { this.open = false; } showModal() { this.open = true; }
}
const setup = { logicPackId: `logic-v1:${"a".repeat(64)}`, mods: [] };
const initial = createPvpBattle(loadGameData(), [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]], () => 0.5);
const active: PvpMatchViewV1 = { protocolVersion: "pvp-protocol-v1", matchId: "11111111-1111-4111-8111-111111111111",
  logicPackId: setup.logicPackId, revision: 1, status: "active", you: 0, turn: 0, decisionId: "decision-1",
  players: [{ name: "A", source: "offline" }, { name: "B", source: "offline" }], expiresAt: 9999999999999, notes: [], battle: PvpBattleSnapshotV1Schema.parse(initial.snapshot) };
let body: ElementStub, handle: PvpFlowHandle | undefined;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function boot(transport: ConstructorParameters<typeof PvpClient>[0]) {
  const onClose = vi.fn();
  handle = showPvpFlow({ parent: { children: [], addChildAt() {}, addChild() {}, setChildIndex() {} }, game: { assets: {}, strings: {}, scale9: {} },
    ticker: {}, stage: {}, audio: {}, keyboard: {}, connect: async () => ({ client: new PvpClient(transport), setup }),
    entry: () => ({ source: "offline", party: [{ shortType: "FireCub", level: 5 }] }), onClose } as any);
  return onClose;
}
const response = (value: unknown) => new Response(JSON.stringify(value));
beforeEach(() => {
  vi.useFakeTimers(); mocks.boards.length = 0; mocks.popups.length = 0; body = new ElementStub();
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("document", { body, activeElement: body, hidden: false, createElement: () => new ElementStub() });
});
afterEach(() => { handle?.dispose(); handle = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("PvP lobby ends at combat admission", () => {
  it("keeps the invitation lobby until the opponent joins, then closes it without another button", async () => {
    let match: PvpMatchViewV1 = { ...active, status: "waiting", battle: undefined, code: "ABCD2345" };
    boot(async path => response(path.endsWith("/current") ? { match } : match)); await settle();
    expect(body.children[0]!.open).toBe(true); expect(mocks.boards).toHaveLength(0);
    match = active; await vi.advanceTimersByTimeAsync(1500); await settle();
    expect(body.children[0]!.open).toBe(false); expect(mocks.boards).toHaveLength(1);
  });
  it("opens a fresh lobby after a historical completed match", async () => {
    boot(async () => response({ match: { ...active, status: "ended", winner: 1, endReason: "timeout" } })); await settle();
    expect(body.children[0]!.open).toBe(true); expect(mocks.boards).toHaveLength(0);
    expect(handle!.debugState.match).toBe(null);
  });
  it("keeps combat mounted across failed polls and recovers without the lobby", async () => {
    let fail = false;
    boot(async path => { if (fail) throw new Error("offline"); return response(path.endsWith("/current") ? { match: active } : active); });
    await settle(); fail = true; await vi.advanceTimersByTimeAsync(1500); await settle();
    expect(body.children[0]!.open).toBe(false); expect(mocks.boards[0].dispose).not.toHaveBeenCalled();
    fail = false; await vi.advanceTimersByTimeAsync(1500); await settle();
    expect(handle!.debugState.error).toBe(null); expect(mocks.boards).toHaveLength(1);
  });
  it("resumes directly into combat and cannot leave through a stale Close or Back", async () => {
    const transport = vi.fn(async (_path: string, _init: RequestInit) => response({ match: active }));
    const closed = boot(transport);
    const dialog = body.children[0]!;
    const staleClose = dialog.children[0]!.children[1]!;
    await settle();
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toEqual(setup);
    expect(dialog.open).toBe(false); expect(handle!.debugState.lobby).toBe(false);
    staleClose.listeners.get("click")!(); handle!.requestBack();
    expect(closed).not.toHaveBeenCalled(); expect(mocks.boards[0].requestBack).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("retries a lost committed response automatically using the identical command envelope without a menu", async () => {
    let attempts = 0;
    const envelopes: string[] = [];
    const transport = vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith("/commands")) {
        envelopes.push(init.body as string);
        if (++attempts === 1) throw new Error("reply lost");
        return response({ ...active, revision: 2, turn: 1 });
      }
      return response(path.endsWith("/current") ? { match: active } : active);
    });
    boot(transport); await settle(); mocks.boards[0].submit({ type: "delay", actorId: "t0m0:FireCub" }); await settle();
    expect(body.children[0]!.open).toBe(false);
    await vi.advanceTimersByTimeAsync(1500); await settle();
    expect(envelopes).toHaveLength(2); expect(envelopes[1]).toBe(envelopes[0]);
    expect(handle!.debugState.error).toBe(null); expect(mocks.boards).toHaveLength(1);
  });
  it.each(["forfeit", "timeout", "defeat"] as const)("shows a native result and exits only after acknowledgement: %s", async endReason => {
    let match = active;
    const closed = boot(async path => response(path.endsWith("/current") ? { match } : match));
    await settle(); match = { ...active, revision: 2, status: "ended", winner: 1, endReason };
    await vi.advanceTimersByTimeAsync(1500); await settle();
    expect(mocks.popups).toHaveLength(1); expect(mocks.popups[0].title).toBe("Defeat");
    expect(body.children[0]!.open).toBe(false); expect(mocks.boards[0].dispose).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
    mocks.popups[0].dismiss(); expect(closed).toHaveBeenCalledOnce();
  });
});
