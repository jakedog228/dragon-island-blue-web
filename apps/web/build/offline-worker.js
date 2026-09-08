/* Generated with an exact manifest of distributable engine files. Never cache API responses,
 * imported archives, blob URLs, downloads, or arbitrary URLs observed at runtime. */
const { revision, entries } = __DIB_OFFLINE_CONFIG__;
const scope = self.registration.scope;
const prefix = `dib-shell:${scope}:`;
const cacheName = prefix + revision;
const resources = new Map(entries.map((entry) => [new URL(entry.path, scope).href, entry]));
const requests = () => [...resources].map(([url, entry]) => new Request(url, {
  cache: "reload", credentials: "same-origin", integrity: entry.integrity,
}));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      // Integrity rejects incomplete/mixed deployments, including HTML returned for missing assets.
      await cache.addAll(requests());
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
  // No skipWaiting: an update must not replace the engine under a live game.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
  })());
  // No clients.claim: the first network-loaded document may belong to another release.
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.search = "";
  url.hash = "";
  if (url.href === scope) url.pathname += "index.html";
  if (!resources.has(url.href)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(cacheName)).match(url.href);
    // No runtime writes: only a completely installed build can become an offline version.
    return cached ?? fetch(event.request);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "DIB_OFFLINE_STATUS" || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      const present = new Set((await cache.keys()).map((request) => request.url));
      let ready = [...resources.keys()].every((url) => present.has(url));
      if (!ready && event.data.repair === true) {
        // Recover browser-evicted files when connected. addAll commits atomically and integrity
        // keeps a newer deployment from being written into an older version's cache.
        await cache.addAll(requests());
        ready = true;
      }
      event.ports[0].postMessage({ ready });
    } catch {
      event.ports[0].postMessage({ ready: false });
    }
  })());
});
