import { Agent, createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { preview, type PreviewServer } from "vite";
import { expect, test } from "vitest";
import { createLocalApiProxy } from "../build/localApiProxy.js";

const close = async (server: {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?: () => void;
}) => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
};

test("local API proxy reuses sockets without mixing requests or changing errors and origin policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dib-local-proxy-"));
  let connections = 0;
  const upstream = createServer(async (incoming, response) => {
    let body = "";
    for await (const chunk of incoming) body += String(chunk);
    response.writeHead(incoming.url?.endsWith("/fail") ? 503 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ path: incoming.url, body, origin: incoming.headers.origin ?? null,
      authorization: incoming.headers.authorization, host: incoming.headers.host }));
  });
  upstream.on("connection", () => connections++);
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const local = createLocalApiProxy(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
  const client = new Agent({ keepAlive: true });
  let web: PreviewServer | undefined;
  try {
    web = await preview({ configFile: false, root: directory, logLevel: "silent",
      build: { outDir: directory }, plugins: [local.lifecycle], server: { proxy: local.proxy },
      preview: { port: 0, host: "127.0.0.1", strictPort: true } });
    const port = (web.httpServer.address() as AddressInfo).port;
    const send = (path: string, authorization: string, body: string) => new Promise<{
      status: number | undefined; connection: string | undefined; payload: Record<string, unknown>;
    }>((resolve, reject) => {
      const outgoing = request({ host: "127.0.0.1", port, path, method: "POST", agent: client,
        headers: { Authorization: authorization, Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json" } }, response => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { data += chunk; });
        response.on("end", () => resolve({ status: response.statusCode,
          connection: response.headers.connection, payload: JSON.parse(data) as Record<string, unknown> }));
        response.on("error", reject);
      });
      outgoing.on("error", reject); outgoing.end(body);
    });
    for (let i = 0; i < 12; i++) {
      const family = ["game", "pvp", "community"][i % 3]!;
      const path = `/api/${family}/${i === 9 ? "fail" : "commands"}`;
      const authorization = `Bearer test-only-${i % 2}`;
      const body = JSON.stringify({ commandId: `test-command-${i}` });
      const result = await send(path, authorization, body);
      expect(result.status).toBe(i === 9 ? 503 : 200);
      expect(result.connection).toBe("keep-alive");
      expect(result.payload).toEqual({ path, body, authorization,
        origin: family === "game" ? null : `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` });
    }
    expect(connections).toBe(1);
  } finally {
    client.destroy();
    if (web) await close(web.httpServer);
    await close(upstream);
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    expect(basename(directory).startsWith("dib-local-proxy-")).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
