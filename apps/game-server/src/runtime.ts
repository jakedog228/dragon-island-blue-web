import type { Server } from "node:http";
import { createLogger, errorFields, type Logger } from "./logging.js";

/**
 * Process lifecycle for the deployed server: bind, apply socket timeouts, drain on SIGTERM.
 *
 * A container redeploy sends SIGTERM and then waits. Without a drain the runtime would sever
 * in-flight command requests mid-transaction; the store's fsync + atomic rename means such a
 * request is never *corrupt*, but the client is left unable to tell whether its command committed.
 * Draining removes that ambiguity for every request already accepted.
 */

export interface ServerTimeouts {
  /** Time allowed to receive complete request headers. */
  readonly headersTimeoutMs: number;
  /** Time allowed to receive the complete request. */
  readonly requestTimeoutMs: number;
  /**
   * Idle keep-alive window. Must exceed the reverse proxy's own idle timeout, otherwise the proxy
   * can dispatch onto a socket this process is simultaneously closing and surface a spurious 502.
   */
  readonly keepAliveTimeoutMs: number;
}

export const DEFAULT_SERVER_TIMEOUTS: ServerTimeouts = Object.freeze({
  headersTimeoutMs: 20_000,
  requestTimeoutMs: 60_000,
  // Caddy's default upstream idle timeout is 2 minutes; stay above it.
  keepAliveTimeoutMs: 130_000,
});

export interface StartGameServerOptions {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
  readonly logger?: Logger;
  readonly timeouts?: Partial<ServerTimeouts>;
  /** How long in-flight requests may finish before remaining sockets are destroyed. */
  readonly shutdownGraceMs?: number;
  /** Overridable so tests can drive shutdown without terminating the test runner. */
  readonly signals?: readonly NodeJS.Signals[];
  readonly onFatal?: (code: number) => void;
}

export interface RunningGameServer {
  readonly port: number;
  readonly host: string;
  /** Idempotent. Resolves once the listener is closed and sockets are released. */
  shutdown(reason: string): Promise<void>;
}

export async function startGameServer(
  options: StartGameServerOptions,
): Promise<RunningGameServer> {
  const logger = options.logger ?? createLogger();
  const timeouts = { ...DEFAULT_SERVER_TIMEOUTS, ...options.timeouts };
  const graceMs = options.shutdownGraceMs ?? 15_000;
  const server = options.server;

  server.headersTimeout = timeouts.headersTimeoutMs;
  server.requestTimeout = timeouts.requestTimeoutMs;
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;

  let inFlight = 0;
  let draining = false;
  let idleResolvers: Array<() => void> = [];

  server.on("request", (request, response) => {
    inFlight += 1;
    // A connection being closed by the peer still fires `close` on the response, so this is the
    // one hook that fires for both completed and aborted requests.
    response.on("close", () => {
      inFlight -= 1;
      if (inFlight === 0 && draining) {
        for (const resolve of idleResolvers.splice(0)) resolve();
      }
    });
    // Once draining, tell keep-alive clients not to reuse the socket so the connection count can
    // actually reach zero instead of being held open by an idle pool.
    if (draining && !response.headersSent) response.setHeader("Connection", "close");
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => { rejectListen(error); };
    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.removeListener("error", onError);
      resolveListen();
    });
  });

  const waitForIdle = async (): Promise<void> => {
    if (inFlight === 0) return;
    await new Promise<void>((resolveIdle) => { idleResolvers.push(resolveIdle); });
  };

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (reason: string): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    draining = true;
    logger.info("shutting down", { reason, inFlight });
    shutdownPromise = (async () => {
      const closed = new Promise<void>((resolveClose) => { server.close(() => { resolveClose(); }); });
      // Sockets parked in a keep-alive pool hold the listener open but owe us nothing.
      server.closeIdleConnections();

      let timedOut = false;
      const grace = new Promise<void>((resolveGrace) => {
        const timer = setTimeout(() => { timedOut = true; resolveGrace(); }, graceMs);
        timer.unref();
        void waitForIdle().then(() => { clearTimeout(timer); resolveGrace(); });
      });
      await grace;

      if (timedOut && inFlight > 0) {
        logger.warn("shutdown grace expired with requests still in flight", { inFlight, graceMs });
      }
      server.closeAllConnections();
      await closed;
      idleResolvers = [];
      // Nothing is being served any more, so the handlers have nothing left to protect. Removing
      // them keeps a second server started in the same process (and every test that does so) from
      // accumulating listeners on the global process object.
      removeProcessHandlers?.();
      logger.info("shutdown complete", { reason });
    })();
    return shutdownPromise;
  };

  const removeProcessHandlers = installProcessHandlers({
    logger,
    shutdown,
    signals: options.signals ?? ["SIGTERM", "SIGINT"],
    ...(options.onFatal === undefined ? {} : { onFatal: options.onFatal }),
  });

  return { port: options.port, host: options.host, shutdown };
}

/** Returns a function that detaches every listener it installed. */
function installProcessHandlers(options: {
  readonly logger: Logger;
  readonly shutdown: (reason: string) => Promise<void>;
  readonly signals: readonly NodeJS.Signals[];
  readonly onFatal?: (code: number) => void;
}): () => void {
  const exit = options.onFatal ?? ((code: number) => { process.exitCode = code; });
  const installed: Array<[NodeJS.Signals | "uncaughtException" | "unhandledRejection", (...args: never[]) => void]> = [];

  for (const signal of options.signals) {
    const handler = (): void => {
      void options.shutdown(signal).then(
        () => { exit(0); },
        (error: unknown) => {
          options.logger.error("shutdown failed", errorFields(error));
          exit(1);
        },
      );
    };
    process.once(signal, handler);
    installed.push([signal, handler]);
  }

  // A process that has lost an invariant must not keep serving authoritative commands. Exiting
  // non-zero lets the supervisor restart it against the durable store, which is consistent by
  // construction.
  const onUncaught = (error: Error): void => {
    options.logger.error("uncaught exception; terminating", errorFields(error));
    void options.shutdown("uncaughtException").finally(() => { exit(1); });
  };
  const onUnhandled = (reason: unknown): void => {
    options.logger.error("unhandled rejection; terminating", errorFields(reason));
    void options.shutdown("unhandledRejection").finally(() => { exit(1); });
  };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);
  installed.push(["uncaughtException", onUncaught as (...args: never[]) => void]);
  installed.push(["unhandledRejection", onUnhandled as (...args: never[]) => void]);

  return () => {
    for (const [event, handler] of installed) {
      process.removeListener(event, handler as (...args: unknown[]) => void);
    }
  };
}
