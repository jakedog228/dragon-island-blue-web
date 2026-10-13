import { describe, expect, it, vi } from "vitest";
import { ArenaFlow } from "../src/player/arenaFlow.js";
import { PopupHost } from "../src/ui/popup.js";

vi.hoisted(() => Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest" } }));

describe("Arena PvP ownership", () => {
  it("keeps chats/popups in charge, opens once, and returns Back to the nested flow", async () => {
    const host = { modalDepth: 1 };
    vi.spyOn(PopupHost, "for").mockReturnValue(host as PopupHost);
    const handle = { dispose: vi.fn(), requestBack: vi.fn(() => true) };
    const receiver = { closed: false, pvp: undefined, messagePending: true,
      opts: { onPvp: vi.fn(() => handle), onClick: vi.fn() } };
    const activate = (ArenaFlow.prototype as unknown as { activate(action: string): Promise<void> }).activate;
    await activate.call(receiver, "pvp");
    host.modalDepth = 0;
    await activate.call(receiver, "pvp");
    expect(receiver.opts.onPvp).not.toHaveBeenCalled();
    receiver.messagePending = false;
    await activate.call(receiver, "pvp");
    await activate.call(receiver, "pvp");
    expect(receiver.opts.onPvp).toHaveBeenCalledOnce();
    expect(ArenaFlow.prototype.requestBack.call(receiver as never)).toBe(true);
    expect(handle.requestBack).toHaveBeenCalledOnce();
  });
});
