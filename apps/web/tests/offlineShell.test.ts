import { afterEach, describe, expect, it, vi } from "vitest";
import { installOfflineShellStatus } from "../src/platform/offlineShell.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function setup(options: { active?: boolean; offline?: boolean; cached?: boolean; failRegister?: boolean } = {}) {
  vi.stubEnv("PROD", true);
  vi.stubEnv("BASE_URL", "/port/");
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("location", { href: "https://game.test/port/?display=iphone" });
  const active = Object.assign(new EventTarget(), {
    state: "activated",
    postMessage: vi.fn((_message: unknown, ports: MessagePort[]) => {
      ports[0]!.postMessage({ ready: options.cached !== false });
      ports[0]!.close();
    }),
  });
  const registration = Object.assign(new EventTarget(), {
    scope: "https://game.test/port/",
    active: options.active === false ? null : active,
    installing: options.active === false ? Object.assign(new EventTarget(), { state: "installing" }) : null,
    waiting: null as EventTarget | null,
  });
  const register = options.failRegister
    ? vi.fn().mockRejectedValue(new Error("offline"))
    : vi.fn().mockResolvedValue(registration);
  vi.stubGlobal("navigator", {
    onLine: !options.offline,
    serviceWorker: { register, getRegistration: vi.fn().mockResolvedValue(registration) },
  });
  const element = { textContent: "", hidden: false, dataset: {} as Record<string, string> };
  const dispose = installOfflineShellStatus(element as unknown as HTMLElement);
  return { element, active, registration, register, dispose };
}

describe("offline startup status", () => {
  it("confirms the actual active cache even when offline registration fails", async () => {
    const w = setup({ offline: true, failRegister: true });
    await vi.waitFor(() => expect(w.element.dataset["offlineShell"]).toBe("ready"));
    expect(w.register).toHaveBeenCalledWith(new URL("https://game.test/port/sw.js"), {
      scope: "https://game.test/port/", updateViaCache: "none",
    });
    expect(w.active.postMessage.mock.calls[0]![0]).toEqual({ type: "DIB_OFFLINE_STATUS", repair: false });
    w.dispose();
  });

  it("waits for first activation instead of promising readiness during installation", async () => {
    const w = setup({ active: false });
    await vi.waitFor(() => expect(w.register).toHaveBeenCalledOnce());
    expect(w.element.dataset["offlineShell"]).toBe("preparing");
    const installing = w.registration.installing!;
    w.registration.installing = null;
    w.registration.active = w.active;
    installing.dispatchEvent(new Event("statechange"));
    await vi.waitFor(() => expect(w.element.dataset["offlineShell"]).toBe("ready"));
    w.dispose();
  });

  it("announces a waiting update and removes its listeners when the launcher closes", async () => {
    const w = setup();
    await vi.waitFor(() => expect(w.element.dataset["offlineShell"]).toBe("ready"));
    w.registration.waiting = new EventTarget();
    w.registration.dispatchEvent(new Event("updatefound"));
    await vi.waitFor(() => expect(w.element.dataset["offlineShell"]).toBe("update"));
    w.dispose();
    w.active.postMessage.mockClear();
    w.registration.dispatchEvent(new Event("updatefound"));
    expect(w.active.postMessage).not.toHaveBeenCalled();
  });

  it("reports an unavailable cache without blocking the launcher", async () => {
    const w = setup({ cached: false });
    await vi.waitFor(() => expect(w.element.dataset["offlineShell"]).toBe("unavailable"));
    w.dispose();
  });

  it("does not register on a Vite development server", () => {
    vi.stubEnv("PROD", false);
    const register = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const element = { hidden: false };
    installOfflineShellStatus(element as HTMLElement)();
    expect(element.hidden).toBe(true);
    expect(register).not.toHaveBeenCalled();
  });
});
