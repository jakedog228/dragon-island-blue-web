/** The shell cache and imported archive cache have separate lifetimes. This copy promises only
 * startup; a locally available IPA/ZIP is still required if the archive cache is evicted. */
export function offlineShellMessage(phase: "preparing" | "ready" | "update" | "unavailable"): string {
  switch (phase) {
    case "preparing": return "Preparing offline startup… Keep this app open while connected.";
    case "ready": return "App ready for offline startup. Play Offline once to remember your game content, or keep your IPA/ZIP downloaded in Files.";
    case "update": return "App ready for offline startup. An update is ready; close all game windows and reopen to use it. Keep your IPA/ZIP downloaded in Files.";
    case "unavailable": return "Offline startup is not ready. Connect to the internet and reopen the app to try again. Keep your IPA/ZIP downloaded in Files.";
  }
}

function checkCache(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean): void => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(ready);
    };
    const timeout = setTimeout(() => finish(false), 10_000);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      finish(typeof event.data === "object" && event.data !== null &&
        "ready" in event.data && event.data.ready === true);
    };
    try {
      worker.postMessage({ type: "DIB_OFFLINE_STATUS", repair: navigator.onLine !== false }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

/** Mount only on the launcher. Failure is informational and never blocks local play or saves. */
export function installOfflineShellStatus(element: HTMLElement): () => void {
  if (!import.meta.env.PROD) {
    element.hidden = true;
    return () => {};
  }
  let disposed = false;
  let generation = 0;
  const cleanup: (() => void)[] = [];
  const show = (phase: Parameters<typeof offlineShellMessage>[0]): void => {
    if (disposed) return;
    element.textContent = offlineShellMessage(phase);
    element.dataset["offlineShell"] = phase;
  };
  show("preparing");
  if (!globalThis.isSecureContext || !("serviceWorker" in navigator)) {
    show("unavailable");
    return () => { disposed = true; };
  }
  const base = new URL(import.meta.env.BASE_URL, location.href);
  void navigator.serviceWorker.register(new URL("sw.js", base), {
    scope: base.href, updateViaCache: "none",
  }).catch(async (error: unknown) => {
    // An update fetch can fail while offline even though a usable registration already exists.
    const existing = await navigator.serviceWorker.getRegistration(base.href);
    if (existing?.scope === base.href) return existing;
    throw error;
  }).then((registration) => {
    if (disposed) return;
    const refresh = async (): Promise<void> => {
      const current = ++generation;
      const active = registration.active;
      if (active?.state === "activated") {
        const ready = await checkCache(active);
        if (current === generation) show(ready ? registration.waiting ? "update" : "ready" : "unavailable");
      } else {
        show(registration.installing || registration.waiting || active ? "preparing" : "unavailable");
      }
    };
    const watched = new Set<ServiceWorker>();
    const observe = (): void => {
      for (const worker of [registration.installing, registration.waiting, registration.active]) {
        if (!worker || watched.has(worker)) continue;
        watched.add(worker);
        worker.addEventListener("statechange", observe);
        cleanup.push(() => worker.removeEventListener("statechange", observe));
      }
      void refresh();
    };
    registration.addEventListener("updatefound", observe);
    cleanup.push(() => registration.removeEventListener("updatefound", observe));
    observe();
  }).catch(() => { show("unavailable"); });
  return () => {
    disposed = true;
    for (const remove of cleanup) remove();
  };
}
