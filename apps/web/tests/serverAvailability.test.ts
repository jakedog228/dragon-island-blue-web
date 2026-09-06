import { afterEach, describe, expect, it, vi } from "vitest";
import { probeOnlineServer } from "../src/authority/serverAvailability.js";
import { onlinePlayAvailability } from "../src/content/onlineModBoundary.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("optional Official server", () => {
  it.each([
    new Response("Not found", { status: 404 }),
    new Response("<html>static host</html>"),
    Response.json({ ready: false, installedLogicPackIds: [] }, { status: 503 }),
    Response.json({ ready: true }),
    Response.json({ ready: true, installedLogicPackIds: [] }),
  ])("rejects absent, unready, or unrelated endpoints", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await probeOnlineServer()).toBe("unavailable");
  });

  it("accepts a ready server independently of account registration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ ready: true, installedLogicPackIds: ["pack"] }),
    ));
    expect(await probeOnlineServer()).toBe("available");
  });

  it("settles network failures and aborts a hanging request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    expect(await probeOnlineServer()).toBe("unavailable");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    const pending = probeOnlineServer();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disables Online until ready and preserves mod restrictions when ready", () => {
    const clean = { selectedModCount: 0, modCodeWasActivated: false };
    for (const serverStatus of ["checking", "unavailable"] as const) {
      expect(onlinePlayAvailability({ ...clean, serverStatus }).available).toBe(false);
    }
    expect(onlinePlayAvailability({ ...clean, serverStatus: "available" }).available).toBe(true);
    expect(onlinePlayAvailability({ ...clean, selectedModCount: 1, serverStatus: "available" }).available).toBe(false);
    expect(onlinePlayAvailability({ ...clean, modCodeWasActivated: true, serverStatus: "available" }).available).toBe(false);
  });
});
