import { Agent } from "node:http";
import type { Plugin, ProxyOptions } from "vite";

/** Vite's proxy otherwise forces Connection: close on every upstream request. Long local
 * Official/PvP sessions should reuse sockets just as the production reverse proxy does. */
export function createLocalApiProxy(target: string): {
  proxy: Record<string, ProxyOptions>;
  lifecycle: Plugin;
} {
  const agent = new Agent({ keepAlive: true });
  return {
    proxy: {
      "/api/pvp": { target, changeOrigin: false, agent },
      "/api/community": { target, changeOrigin: false, agent },
      "/api/game": {
        target,
        agent,
        configure(proxy) {
          proxy.on("proxyReq", request => {
            // Same-origin browser requests reach the authority through an internal hop.
            // Direct cross-origin clients still face the authority's exact allowlist.
            request.removeHeader("origin");
          });
        },
      },
    },
    lifecycle: {
      name: "local-api-proxy-lifecycle",
      configureServer(server) { server.httpServer?.once("close", () => agent.destroy()); },
      configurePreviewServer(server) { server.httpServer.once("close", () => agent.destroy()); },
    },
  };
}
