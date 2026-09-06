import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logging.js";
import { DEFAULT_SERVER_TIMEOUTS, startGameServer, type RunningGameServer } from "../src/runtime.js";

/**
 * A redeploy sends SIGTERM and waits. If the runtime severed sockets on the signal, a client whose
 * command was mid-transaction could not tell whether it committed -- the store's atomic rename
 * guarantees the write is never torn, but says nothing about whether it happened. Draining is what
 * removes that ambiguity, so these tests drive the real signal path rather than calling `shutdown`
 * directly where it matters.
 *
 * A previous attempt to prove this by sending SIGTERM to a spawned process from the shell was
 * unusable on Windows (MSYS `kill` addresses a different PID namespace than the Win32 process).
 * Driving the runtime in-process is both deterministic and platform-independent; the Linux
 * container path is exercised again by `docker compose stop` during a real deploy.
 */

const started: RunningGameServer[] = [];
const listeners: Server[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.shutdown("test cleanup")));
  listeners.splice(0).forEach((server) => { server.closeAllConnections(); });
});

interface Harness {
  readonly endpoint: string;
  readonly running: RunningGameServer;
  readonly logLines: string[];
  release(): void;
}

/**
 * Boots a server whose one route blocks until the test releases it, which is the only reliable way
 * to hold a request "in flight" across a shutdown.
 */
async function harness(options: { shutdownGraceMs?: number; signals?: NodeJS.Signals[] } = {}): Promise<Harness> {
  let release = (): void => {};
  const held = new Promise<void>((resolve) => { release = resolve; });

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/fast") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
      return;
    }
    void held.then(() => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("drained");
    });
  });
  listeners.push(server);

  const logLines: string[] = [];
  const running = await startGameServer({
    server,
    port: 0,
    host: "127.0.0.1",
    logger: createLogger({ level: "debug", write: (line) => { logLines.push(line); } }),
    signals: options.signals ?? [],
    ...(options.shutdownGraceMs === undefined ? {} : { shutdownGraceMs: options.shutdownGraceMs }),
    onFatal: () => {},
  });
  started.push(running);

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return { endpoint: `http://127.0.0.1:${address.port}`, running, logLines, release: () => { release(); } };
}

function messages(logLines: readonly string[]): string[] {
  return logLines.map((line) => (JSON.parse(line) as { msg: string }).msg);
}

describe("graceful shutdown", () => {
  it("lets an in-flight request finish after shutdown begins", async () => {
    const { endpoint, running, release } = await harness();
    const inFlight = fetch(`${endpoint}/slow`);
    // Wait until the server has actually accepted the request, otherwise the drain would be
    // trivially satisfied by there being nothing to drain.
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    const draining = running.shutdown("SIGTERM");
    release();

    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("drained");
    await draining;
  });

  it("stops accepting new connections once draining", async () => {
    const { endpoint, running, release } = await harness();
    const inFlight = fetch(`${endpoint}/slow`);
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    const draining = running.shutdown("SIGTERM");
    // The listener is closed synchronously by `server.close()`, so a fresh connection is refused
    // even though the process is still alive finishing prior work.
    await expect(fetch(`${endpoint}/fast`)).rejects.toThrow();

    release();
    await inFlight;
    await draining;
  });

  it("destroys sockets that outlast the grace window instead of hanging forever", async () => {
    const { endpoint, running, logLines } = await harness({ shutdownGraceMs: 100 });
    const abandoned = fetch(`${endpoint}/slow`).catch(() => "aborted");
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    // Never released: this stands in for a wedged handler. A drain that waited indefinitely would
    // turn one stuck request into a deploy that never completes.
    await running.shutdown("SIGTERM");
    expect(await abandoned).toBe("aborted");
    expect(messages(logLines)).toContain("shutdown grace expired with requests still in flight");
  });

  it("is idempotent", async () => {
    const { running, logLines } = await harness();
    await Promise.all([running.shutdown("SIGTERM"), running.shutdown("SIGINT")]);
    await running.shutdown("SIGTERM");
    // A supervisor that sends SIGTERM then SIGINT must not start two overlapping drains.
    expect(messages(logLines).filter((message) => message === "shutting down")).toHaveLength(1);
  });

  it("drains on a real signal and exits zero", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const server = createServer((_request, response) => {
      void held.then(() => { response.writeHead(200); response.end("drained"); });
    });
    listeners.push(server);

    const exitCodes: number[] = [];
    const running = await startGameServer({
      server,
      port: 0,
      host: "127.0.0.1",
      logger: createLogger({ level: "error", write: () => {} }),
      // SIGUSR2 stands in for SIGTERM: it takes the identical code path, but is not a signal the
      // test runner itself uses, and unlike SIGTERM it will not kill the runner if the handler is
      // ever removed. Windows emulates it well enough for process.emit-based delivery.
      signals: ["SIGUSR2"],
      onFatal: (code) => { exitCodes.push(code); },
    });
    started.push(running);
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP address");

    const inFlight = fetch(`http://127.0.0.1:${address.port}/slow`);
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    process.emit("SIGUSR2");
    release();

    expect((await inFlight).status).toBe(200);
    await running.shutdown("await");
    expect(exitCodes).toEqual([0]);
  });

  it("detaches its process handlers once shut down", async () => {
    const before = process.listenerCount("uncaughtException");
    const { running } = await harness();
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
    await running.shutdown("SIGTERM");
    // Otherwise every restart in a long-lived process leaks a listener and eventually trips
    // Node's MaxListenersExceededWarning.
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});

describe("socket timeouts", () => {
  it("applies the configured timeouts to the listener", async () => {
    const { running } = await harness();
    const server = listeners[listeners.length - 1] as Server;
    expect(server.headersTimeout).toBe(DEFAULT_SERVER_TIMEOUTS.headersTimeoutMs);
    expect(server.requestTimeout).toBe(DEFAULT_SERVER_TIMEOUTS.requestTimeoutMs);
    expect(server.keepAliveTimeout).toBe(DEFAULT_SERVER_TIMEOUTS.keepAliveTimeoutMs);
    await running.shutdown("done");
  });

  it("keeps keepAliveTimeout above the proxy's idle window", () => {
    // deploy/Caddyfile sets `keepalive 60s` on the upstream transport. If the origin retired a
    // pooled socket first, Caddy could dispatch onto a socket being closed and surface a 502 that
    // no request actually caused.
    expect(DEFAULT_SERVER_TIMEOUTS.keepAliveTimeoutMs).toBeGreaterThan(60_000);
  });
});
