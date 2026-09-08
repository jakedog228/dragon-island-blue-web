import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const template = readFileSync(new URL("../build/offline-worker.js", import.meta.url), "utf8");
const scope = "https://game.test/port/";
const entries = ["index.html", "modding.html", "assets/game.js", "assets/lazy.js", "app.webmanifest"]
  .map((path) => ({ path, integrity: "sha256-example" }));
const name = `dib-shell:${scope}:new`;

function worker() {
  const records = new Map<string, Map<string, Response>>();
  const listeners = new Map<string, (event: unknown) => void>();
  const fetch = vi.fn(async () => new Response("network"));
  const addAll = vi.fn(async (requests: Request[]) => {
    for (const request of requests) records.get(name)!.set(request.url, new Response(request.url));
  });
  const cache = (key: string) => {
    if (!records.has(key)) records.set(key, new Map());
    return {
      addAll,
      match: async (url: string) => records.get(key)!.get(url)?.clone(),
      keys: async () => [...records.get(key)!.keys()].map((url) => new Request(url)),
    };
  };
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  runInNewContext(template.replace("__DIB_OFFLINE_CONFIG__", JSON.stringify({ revision: "new", entries })), {
    self: { registration: { scope }, addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn), skipWaiting, clients: { claim } },
    caches: { open: async (key: string) => cache(key), keys: async () => [...records.keys()], delete: async (key: string) => records.delete(key) },
    URL, Request, Response, fetch,
  });
  const dispatch = async (type: string) => {
    let pending: Promise<unknown> | undefined;
    listeners.get(type)!({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await pending;
  };
  const request = async (url: string, method = "GET") => {
    let response: Promise<Response> | undefined;
    listeners.get("fetch")!({ request: new Request(url, { method }), respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  };
  const status = async (repair = false) => {
    let pending: Promise<unknown> | undefined;
    const port = { postMessage: vi.fn() };
    listeners.get("message")!({ data: { type: "DIB_OFFLINE_STATUS", repair }, ports: [port], waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await pending;
    return port.postMessage.mock.calls[0]![0] as { ready: boolean };
  };
  return { records, fetch, addAll, dispatch, request, status, skipWaiting, claim };
}

describe("production offline worker", () => {
  it("prepares all engine resources with integrity and bypasses stale HTTP cache", async () => {
    const w = worker();
    expect((await w.status()).ready).toBe(false);
    await w.dispatch("install");
    expect(w.addAll.mock.calls[0]![0].map((request) => ({ url: request.url, cache: request.cache, integrity: request.integrity })))
      .toEqual(entries.map((entry) => ({ url: new URL(entry.path, scope).href, cache: "reload", integrity: entry.integrity })));
    expect((await w.status()).ready).toBe(true);
    expect(w.skipWaiting).not.toHaveBeenCalled();
  });

  it("loads root, queried startup, guide and lazy code entirely from the installed cache", async () => {
    const w = worker();
    await w.dispatch("install");
    w.fetch.mockRejectedValue(new TypeError("airplane mode"));
    for (const path of ["", "?display=iphone", "index.html?x=1", "modding.html", "assets/lazy.js"]) {
      expect(await (await w.request(scope + path))?.text()).toBe(new URL(path.startsWith("?") || path === "" ? "index.html" : path.split("?")[0]!, scope).href);
    }
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("never intercepts authority reads/writes, archives, downloads, foreign origins or unknown navigations", async () => {
    const w = worker();
    await w.dispatch("install");
    for (const url of ["https://game.test/api/game/readiness", "https://game.test/api/game/slots", scope + "api/game/readiness", scope + "downloads/game.ipa", scope + "game.zip", scope + "sw.js", scope + "unknown", "https://other.test/port/assets/game.js", "blob:https://game.test/archive"]) {
      expect(await w.request(url)).toBeUndefined();
    }
    expect(await w.request(scope + "index.html", "POST")).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("discards a failed install without damaging the previous working version or player data", async () => {
    const w = worker();
    const old = `dib-shell:${scope}:old`;
    w.records.set(old, new Map());
    w.records.set("player-data", new Map());
    w.addAll.mockRejectedValue(new Error("integrity mismatch or quota"));
    await expect(w.dispatch("install")).rejects.toThrow("integrity mismatch or quota");
    expect([...w.records.keys()]).toEqual([old, "player-data"]);
  });

  it("cleans only superseded shell versions in its own scope at activation, without claiming live pages", async () => {
    const w = worker();
    await w.dispatch("install");
    const other = "dib-shell:https://game.test/other/:old";
    w.records.set(`dib-shell:${scope}:old`, new Map());
    w.records.set(other, new Map());
    w.records.set("player-data", new Map());
    await w.dispatch("activate");
    expect([...w.records.keys()]).toEqual([name, other, "player-data"]);
    expect(w.claim).not.toHaveBeenCalled();
  });

  it("reports eviction honestly and uses the network for a missing entry without caching new bytes", async () => {
    const w = worker();
    await w.dispatch("install");
    w.records.get(name)!.delete(scope + "assets/lazy.js");
    expect((await w.status()).ready).toBe(false);
    expect(await (await w.request(scope + "assets/lazy.js"))?.text()).toBe("network");
    expect(w.records.get(name)!.has(scope + "assets/lazy.js")).toBe(false);
  });

  it("repairs an evicted shell on request, but does not claim success if the repair fails", async () => {
    const w = worker();
    await w.dispatch("install");
    w.records.get(name)!.clear();
    expect((await w.status(true)).ready).toBe(true);
    w.records.get(name)!.delete(scope + "index.html");
    w.addAll.mockRejectedValue(new Error("offline"));
    expect((await w.status(true)).ready).toBe(false);
    expect(w.records.get(name)!.has(scope + "assets/lazy.js")).toBe(true);
  });
});
