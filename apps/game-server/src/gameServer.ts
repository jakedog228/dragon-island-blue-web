import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  ACCOUNT_USERNAME_MAX_LENGTH,
  ACCOUNT_USERNAME_MIN_LENGTH,
  CreateAccountRequestV1Schema,
  CreateGameSessionRequestV1Schema,
  DeleteAuthoritativeSlotRequestV1Schema,
  GAME_PROTOCOL_VERSION,
  GameCommandEnvelopeV1Schema,
  UpdateAccountSettingsRequestV1Schema,
  type AccountSummaryV1,
  type CreateAccountResponseV1,
  type CreateGameSessionResponseV1,
  type GameErrorCodeV1,
  type RegistrationInfoV1,
  type ScoreboardEntryV1,
  type ScoreboardResponseV1,
} from "@dib/game-protocol";
import {
  AuthoritativeGameService,
  type ProjectionBody,
  GameServiceError,
} from "@dib/game-service";
import type { SaveSlotId } from "@dib/save-protocol";
import { AccountRequestError } from "./invites.js";
import { createLogger, errorFields, type LogFields, type Logger } from "./logging.js";
import { RateLimiter, resolveClientAddress, type RateLimitOptions } from "./rateLimit.js";
import type { CommunityHttp } from "./community.js";
import { PvpHttp } from "./pvpHttp.js";
import type { PvpService } from "./pvpService.js";

export * from "./config.js";
export * from "./fileSlotStore.js";
export * from "./logging.js";
export * from "./rateLimit.js";
export * from "./runtime.js";
export * from "./scoreboard.js";
export * from "./secureRandom.js";

const MAX_COMMAND_BODY_BYTES = 64 * 1024;
/** Mirrors `GameErrorV1Schema`'s `message` bound; a longer body fails the client's own parse. */
const MAX_ERROR_MESSAGE_CHARS = 500;
const TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000;
/** Advertised to caches; the aggregation cache in the composition root uses the same window. */
export const SCOREBOARD_CACHE_SECONDS = 30;

interface SessionClaims {
  readonly playerId: string;
  readonly logicPackId: string;
  readonly simulationVersion?: string;
  readonly expiresAt: number;
}

/**
 * The HTTP layer is projection-shape agnostic: it serializes whatever the installed simulation
 * returns. Binding it to one body type made every simulation bump edit this file, so the service
 * is admitted for any installed projection body.
 */
type AnyProjectionBody = ProjectionBody;
interface AnyGameService {
  readonly pack: AuthoritativeGameService<never, AnyProjectionBody>["pack"];
  execute: AuthoritativeGameService<never, AnyProjectionBody>["execute"];
  executeWithTiming?: AuthoritativeGameService<never, AnyProjectionBody>["executeWithTiming"];
  bootstrap: AuthoritativeGameService<never, AnyProjectionBody>["bootstrap"];
  listSlots: AuthoritativeGameService<never, AnyProjectionBody>["listSlots"];
  deleteSlot: AuthoritativeGameService<never, AnyProjectionBody>["deleteSlot"];
}

/**
 * Self-service accounts. The directory owns token minting because it also owns the durable
 * registry: the HTTP layer never sees a stored token, only the one it hands back to the caller.
 * Absent means registration is closed and the account routes report themselves unavailable.
 */
export interface AccountDirectory {
  create(input: {
    readonly username: string;
    readonly publicScoreboard: boolean;
  }): Promise<{ loginToken: string; playerId: string; account: AccountSummaryV1 }>;
  read(playerId: string): Promise<AccountSummaryV1 | undefined>;
  updateSettings(
    playerId: string,
    patch: { readonly publicScoreboard: boolean },
  ): Promise<AccountSummaryV1>;
}

/**
 * The public most-XP board. Ranking needs the installed simulation's projection shape and the
 * account registry at once, so the aggregation lives with the composition root that already knows
 * both; the HTTP layer only serves what it is handed, exactly as it does for projections.
 *
 * Implementations are expected to answer from a short-lived cache: this backs an unauthenticated
 * route whose cost grows with the number of registered accounts.
 */
export interface ScoreboardDirectory {
  list(): Promise<{
    readonly generatedAt: string;
    readonly entries: readonly ScoreboardEntryV1[];
  }>;
}

export interface GameServerOptions {
  readonly pvp?: PvpService;
  readonly community?: CommunityHttp;
  readonly hmacSecret: string | Uint8Array;
  readonly services: readonly AnyGameService[];
  readonly isInvited: (playerId: string) => Promise<boolean> | boolean;
  /**
   * Enables in-app registration and the account settings routes. Existing operator-issued invites
   * keep working without one; they simply own no account record.
   */
  readonly accounts?: AccountDirectory;
  /**
   * Closes new registrations while leaving existing accounts able to read and change their
   * settings. Defaults to open whenever a directory is installed.
   */
  readonly registrationEnabled?: boolean;
  /**
   * Publishes `GET /api/game/scoreboard`. Absent leaves the route reporting itself unavailable,
   * which is the correct answer for a deployment that installs no account directory either.
   */
  readonly scoreboard?: ScoreboardDirectory;
  readonly now?: () => number;
  /** Exact browser origins allowed to call the service. Empty/absent keeps the API same-origin. */
  readonly allowedOrigins?: readonly string[];
  /**
   * Throttles for the unauthenticated session route and for authenticated command execution.
   * Absent leaves the corresponding surface unlimited, which is only appropriate in tests.
   */
  readonly rateLimit?: {
    readonly session?: RateLimitOptions;
    readonly command?: RateLimitOptions;
    /** Registration mints durable state from an anonymous caller, so it is throttled hardest. */
    readonly registration?: RateLimitOptions;
    /** The scoreboard reads no body but fans out over every public account, so it is throttled too. */
    readonly scoreboard?: RateLimitOptions;
  };
  /**
   * Honour `X-Forwarded-For` when keying the session limiter. Only enable when a trusted reverse
   * proxy is the sole route to this listener; otherwise a client spoofs its way into a fresh bucket.
   */
  readonly trustProxy?: boolean;
  readonly logger?: Logger;
}

export function createGameServer(options: GameServerOptions): Server {
  const runtime = new GameHttpRuntime(options);
  return createServer((request, response) => {
    const startedAt = process.hrtime.bigint();
    // "close" rather than "finish": a client that hangs up mid-response never emits "finish", and an
    // access log that silently omits abandoned requests hides exactly the failure worth seeing.
    response.once("close", () => { runtime.logAccess(request, response, startedAt); });
    let route: Promise<void>;
    if (request.url?.startsWith("/api/community/")) {
      if (options.community) route = options.community.handle(request, response);
      else {
        const info = request.method === "GET" && request.url === "/api/community/info";
        sendJson(response, info ? 200 : 503, info ? { enabled: false, authorOrigin: "", registrationEnabled: false } : { message: "The mod catalog is not enabled on this server. Installed and local mods remain available." });
        route = Promise.resolve();
      }
    } else route = runtime.route(request, response);
    void route.catch((error: unknown) => {
      runtime.sendError(response, error);
    });
  });
}

/**
 * Liveness routes, which Caddy's upstream check and the container HEALTHCHECK poll together roughly
 * every six seconds. Logging them at `info` would bury each real player action under ~14k probe
 * records a day, so they drop to `debug` and stay retrievable by raising DIB_GAME_LOG_LEVEL.
 */
const PROBE_PATHS: ReadonlySet<string> = new Set(["/api/game/health", "/api/game/readiness"]);

class GameHttpRuntime {
  private readonly pvp: PvpHttp;
  private readonly secret: string | Uint8Array;
  private readonly services = new Map<string, AnyGameService>();
  private readonly isInvited: GameServerOptions["isInvited"];
  private readonly accounts: AccountDirectory | undefined;
  private readonly scoreboard: ScoreboardDirectory | undefined;
  private readonly registrationEnabled: boolean;
  private readonly now: () => number;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly sessionLimiter: RateLimiter | undefined;
  private readonly commandLimiter: RateLimiter | undefined;
  private readonly registrationLimiter: RateLimiter | undefined;
  private readonly scoreboardLimiter: RateLimiter | undefined;
  private readonly trustProxy: boolean;
  private readonly logger: Logger;
  /**
   * Identity resolved by {@link authenticate}, held until the access log is written. Keyed weakly on
   * the request so an aborted connection cannot pin the entry after Node drops the message object.
   */
  private readonly requestPlayers = new WeakMap<IncomingMessage, string>();

  constructor(options: GameServerOptions) {
    this.secret = options.hmacSecret;
    if ((typeof this.secret === "string" ? Buffer.byteLength(this.secret) : this.secret.byteLength) < 32) {
      throw new Error("game server HMAC secret must contain at least 32 bytes");
    }
    for (const service of options.services) {
      if (this.services.has(service.pack.logicPackId)) {
        throw new Error(`duplicate installed logic pack ${service.pack.logicPackId}`);
      }
      this.services.set(service.pack.logicPackId, service);
    }
    this.isInvited = options.isInvited;
    this.accounts = options.accounts;
    this.scoreboard = options.scoreboard;
    this.registrationEnabled = options.accounts !== undefined &&
      (options.registrationEnabled ?? true);
    this.now = options.now ?? Date.now;
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.sessionLimiter = options.rateLimit?.session === undefined
      ? undefined
      : new RateLimiter(options.rateLimit.session);
    this.commandLimiter = options.rateLimit?.command === undefined
      ? undefined
      : new RateLimiter(options.rateLimit.command);
    this.registrationLimiter = options.rateLimit?.registration === undefined
      ? undefined
      : new RateLimiter(options.rateLimit.registration);
    this.scoreboardLimiter = options.rateLimit?.scoreboard === undefined
      ? undefined
      : new RateLimiter(options.rateLimit.scoreboard);
    this.trustProxy = options.trustProxy ?? false;
    this.logger = options.logger ?? createLogger();
    this.pvp = new PvpHttp({
      ...(options.pvp ? { service: options.pvp } : {}),
      secret: this.secret, logger: this.logger, now: this.now, trustProxy: this.trustProxy,
      authenticateOfficial: async (request) => {
        const claims = this.authenticate(request);
        if (!(await this.isInvited(claims.playerId))) throw new Error("Official access was revoked");
        const account = await this.accounts?.read(claims.playerId);
        return { id: `official:${claims.playerId}`, name: account?.username ?? "Official player", officialPlayerId: claims.playerId };
      },
    });
  }

  async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.applyCors(request, response);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://game.local");
    if (url.pathname.startsWith("/api/pvp/")) {
      await this.pvp.handle(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/game/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/game/readiness") {
      const packs = [...this.services.values()].map((service) => service.pack.logicPackId);
      sendJson(response, packs.length === 0 ? 503 : 200, {
        ready: packs.length > 0,
        installedLogicPackIds: packs,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/game/registration") {
      const info: RegistrationInfoV1 = {
        protocolVersion: GAME_PROTOCOL_VERSION,
        enabled: this.registrationEnabled,
        usernameMinLength: ACCOUNT_USERNAME_MIN_LENGTH,
        usernameMaxLength: ACCOUNT_USERNAME_MAX_LENGTH,
      };
      sendJson(response, 200, info);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/game/scoreboard") {
      // Unauthenticated by design: a public board that demanded a token would only be public to
      // people who already hold one, and registration is open to anyone anyway. `applyCors` still
      // ran above, so a browser on a non-allowlisted origin was already refused.
      this.enforceRateLimit(
        this.scoreboardLimiter,
        resolveClientAddress(
          request.headers["x-forwarded-for"],
          request.socket.remoteAddress,
          this.trustProxy,
        ),
        response,
      );
      if (this.scoreboard === undefined) {
        throw new GameServiceError("ENTITY_NOT_FOUND", "this server publishes no scoreboard");
      }
      const board = await this.scoreboard.list();
      const body: ScoreboardResponseV1 = {
        protocolVersion: GAME_PROTOCOL_VERSION,
        generatedAt: board.generatedAt,
        entries: [...board.entries],
      };
      // The only cacheable response the service has: it is public, identical for every caller, and
      // already served from an aggregation cache with the same lifetime.
      sendJson(response, 200, body, `public, max-age=${SCOREBOARD_CACHE_SECONDS}`);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/game/accounts") {
      const accounts = this.requireAccounts();
      if (!this.registrationEnabled) {
        throw new HttpFailure(
          403,
          "ACTION_NOT_ALLOWED",
          "account registration is closed on this server",
        );
      }
      // Throttled before the body is read: this route is unauthenticated and mints durable state.
      // The two checks above are constant-time and body-independent, so taking them first spends a
      // caller's bucket only on requests a correctly-configured server would actually have served.
      this.enforceRateLimit(
        this.registrationLimiter,
        resolveClientAddress(
          request.headers["x-forwarded-for"],
          request.socket.remoteAddress,
          this.trustProxy,
        ),
        response,
      );
      const input = parseRequest(
        CreateAccountRequestV1Schema,
        await readJson(request),
        `usernames are ${ACCOUNT_USERNAME_MIN_LENGTH}–${ACCOUNT_USERNAME_MAX_LENGTH} ` +
        "characters: letters and digits, optionally separated by single spaces, _ or -",
      );
      const created = await accounts.create({
        username: input.username,
        publicScoreboard: input.publicScoreboard,
      });
      const body: CreateAccountResponseV1 = {
        protocolVersion: GAME_PROTOCOL_VERSION,
        loginToken: created.loginToken,
        playerId: created.playerId,
        account: created.account,
      };
      sendJson(response, 201, body);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/game/session") {
      // Throttled before the body is read: this route is unauthenticated and converts a
      // caller-supplied login token into a player identity.
      this.enforceRateLimit(
        this.sessionLimiter,
        resolveClientAddress(
          request.headers["x-forwarded-for"],
          request.socket.remoteAddress,
          this.trustProxy,
        ),
        response,
      );
      const input = parseRequest(CreateGameSessionRequestV1Schema, await readJson(request));
      const service = this.services.get(input.logicPackId);
      if (service === undefined) {
        throw new GameServiceError("PACK_UNKNOWN", "the requested logic pack is not installed");
      }
      const playerId = this.hmac(`player\0${input.loginToken}`);
      if (!(await this.isInvited(playerId))) {
        throw new HttpFailure(403, "AUTH_REQUIRED", "this login token is not invited");
      }
      const expiresAt = this.now() + TOKEN_LIFETIME_MS;
      const claims: SessionClaims = {
        playerId, logicPackId: input.logicPackId,
        simulationVersion: service.pack.simulationVersion, expiresAt,
      };
      const account = await this.accounts?.read(playerId);
      const responseBody: CreateGameSessionResponseV1 = {
        protocolVersion: GAME_PROTOCOL_VERSION,
        selectedEventVersion: "presentation-events-v1",
        token: this.signClaims(claims),
        expiresAt: new Date(expiresAt).toISOString(),
        pack: service.pack,
        slots: [...await service.listSlots(playerId)],
        ...(account === undefined ? {} : { account }),
      };
      sendJson(response, 200, responseBody);
      return;
    }

    const claims = this.authenticate(request);
    // Account routes are logic-pack independent: they resolve before the service lookup so a
    // player can still change settings while a pack is being swapped out.
    if (request.method === "GET" && url.pathname === "/api/game/account") {
      sendJson(response, 200, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        account: await this.requireAccount(claims.playerId),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/game/account/settings") {
      const accounts = this.requireAccounts();
      await this.requireAccount(claims.playerId);
      const input = parseRequest(UpdateAccountSettingsRequestV1Schema, await readJson(request));
      const account = await accounts.updateSettings(claims.playerId, {
        publicScoreboard: input.publicScoreboard,
      });
      sendJson(response, 200, { protocolVersion: GAME_PROTOCOL_VERSION, account });
      return;
    }
    const service = this.services.get(claims.logicPackId);
    if (service === undefined) {
      throw new GameServiceError("PACK_UNAVAILABLE", "the session logic pack is no longer installed");
    }
    if (claims.simulationVersion !== service.pack.simulationVersion) {
      throw new GameServiceError("PACK_UNAVAILABLE", "the session simulation has changed; reload the client");
    }
    if (request.method === "GET" && url.pathname === "/api/game/slots") {
      sendJson(response, 200, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        slots: await service.listSlots(claims.playerId),
      });
      return;
    }
    const slotMatch = /^\/api\/game\/slots\/(slot-[123])(?:\/(bootstrap|commands))?$/.exec(url.pathname);
    if (slotMatch !== null) {
      const slotId = slotMatch[1] as SaveSlotId;
      const action = slotMatch[2];
      if (request.method === "GET" && action === "bootstrap") {
        sendJson(response, 200, await service.bootstrap(claims.playerId, slotId));
        return;
      }
      if (request.method === "POST" && action === "commands") {
        // Keyed by player, not by address: every command runs the installed simulation and commits
        // a durable transaction, so one authenticated session must not be able to starve the rest.
        this.enforceRateLimit(this.commandLimiter, claims.playerId, response);
        const envelope = parseRequest(GameCommandEnvelopeV1Schema, await readJson(request));
        const fallbackStartedAt = Date.now();
        const executed = service.executeWithTiming === undefined
          ? {
              result: await service.execute(claims.playerId, slotId, envelope),
              timing: {
                queueAndReadMs: 0,
                validationMs: 0,
                reductionMs: 0,
                finalizeMs: 0,
                persistenceMs: 0,
                totalMs: Date.now() - fallbackStartedAt,
                idempotentReplay: false,
              },
            }
          : await service.executeWithTiming(claims.playerId, slotId, envelope);
        response.setHeader("Server-Timing", formatCommandServerTiming(executed.timing));
        sendJson(response, 200, executed.result);
        return;
      }
      if (request.method === "DELETE" && action === undefined) {
        const input = parseRequest(DeleteAuthoritativeSlotRequestV1Schema, await readJson(request));
        await service.deleteSlot(claims.playerId, slotId, input.expectedRevision);
        sendJson(response, 200, { protocolVersion: GAME_PROTOCOL_VERSION, slotId });
        return;
      }
    }
    throw new HttpFailure(404, "ACTION_NOT_ALLOWED", "game API route not found");
  }

  /**
   * One structured record per completed request.
   *
   * This is the only durable evidence that a player did anything: the authoritative store keeps
   * command receipts but nothing records reads, failed logins, or who was active when. `playerId` is
   * the HMAC-derived pseudonym already used as the on-disk directory name, not a credential, so it
   * is safe to retain -- and it is what makes the log answerable to "how many people played today".
   */
  logAccess(request: IncomingMessage, response: ServerResponse, startedAt: bigint): void {
    let path: string;
    try {
      path = new URL(request.url ?? "/", "http://game.local").pathname;
    } catch {
      // A malformed request-target still deserves a log line; it is a scanner signature.
      path = "<unparseable>";
    }
    const playerId = this.requestPlayers.get(request);
    const record: LogFields = {
      method: request.method ?? "GET",
      path,
      status: response.statusCode,
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e3) / 1e3,
      clientAddress: resolveClientAddress(
        request.headers["x-forwarded-for"],
        request.socket.remoteAddress,
        this.trustProxy,
      ),
      // Present only once `authenticate` has run and passed, which is what separates an identified
      // player action from an anonymous or rejected one.
      ...(playerId === undefined ? {} : { playerId }),
      ...(response.writableFinished ? {} : { aborted: true }),
    };
    if (PROBE_PATHS.has(path)) {
      this.logger.debug("game request", record);
      return;
    }
    this.logger.info("game request", record);
  }

  sendError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const correlationId = `corr-${randomUUID()}`;
    if (error instanceof GameServiceError) {
      // A typed INTERNAL (an uncommitted reducer fault) is still a server defect: the operator needs
      // the underlying cause, while the client gets only the generic message and correlation id.
      if (error.code === "INTERNAL") {
        this.logger.error("authoritative game request failed", {
          correlationId,
          ...errorFields(error),
        });
      }
      sendJson(response, statusForCode(error.code), {
        error: {
          code: error.code,
          // The protocol caps `message` at 500 characters, and a body that fails the client's error
          // schema degrades to a generic "malformed HTTP response" — hiding the real cause exactly
          // when it matters. A Zod issue array serialized into the message overruns that easily, so
          // truncate here rather than emit an unparseable error.
          message: truncateErrorMessage(error.message),
          ...(error.options.currentRevision === undefined
            ? {}
            : { currentRevision: error.options.currentRevision }),
          retryable: error.options.retryable ?? false,
          correlationId,
        },
      });
      return;
    }
    // A taken username or a full registry is the caller's problem, not a service fault: report it
    // verbatim so the player can act on it instead of seeing "internal error".
    if (error instanceof AccountRequestError) {
      sendJson(response, 422, {
        error: {
          code: "ACTION_NOT_ALLOWED",
          message: truncateErrorMessage(error.message),
          retryable: false,
          correlationId,
        },
      });
      return;
    }
    if (error instanceof HttpFailure) {
      sendJson(response, error.status, {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          correlationId,
        },
      });
      return;
    }
    this.logger.error("authoritative game request failed", {
      correlationId,
      ...errorFields(error),
    });
    sendJson(response, 500, {
      error: {
        code: "INTERNAL",
        message: "internal authoritative game service error",
        retryable: true,
        correlationId,
      },
    });
  }

  private requireAccounts(): AccountDirectory {
    if (this.accounts === undefined) {
      throw new HttpFailure(
        403,
        "ACTION_NOT_ALLOWED",
        "account registration is not enabled on this server",
      );
    }
    return this.accounts;
  }

  /** Operator-issued invites authorize play but own no account record; say so rather than guess. */
  private async requireAccount(playerId: string): Promise<AccountSummaryV1> {
    const account = await this.requireAccounts().read(playerId);
    if (account === undefined) {
      throw new HttpFailure(404, "ACTION_NOT_ALLOWED", "this login token has no account");
    }
    return account;
  }

  /**
   * Rejects with the protocol's own `RATE_LIMITED` code, which already maps to HTTP 429 and is
   * already modelled client-side as retryable.
   */
  private enforceRateLimit(
    limiter: RateLimiter | undefined,
    key: string,
    response: ServerResponse,
  ): void {
    if (limiter === undefined) return;
    const decision = limiter.take(key);
    if (decision.allowed) return;
    response.setHeader("Retry-After", String(decision.retryAfterSeconds));
    throw new GameServiceError("RATE_LIMITED", "too many requests; retry shortly", {
      retryable: true,
    });
  }

  private authenticate(request: IncomingMessage): SessionClaims {
    const authorization = request.headers.authorization;
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      throw new HttpFailure(401, "AUTH_REQUIRED", "missing game-session bearer token");
    }
    const [encoded, signature, extra] = authorization.slice("Bearer ".length).split(".");
    if (!encoded || !signature || extra !== undefined) {
      throw new HttpFailure(401, "AUTH_REQUIRED", "invalid game-session token");
    }
    const expected = Buffer.from(this.hmac(`session\0${encoded}`), "hex");
    const actual = Buffer.from(signature, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new HttpFailure(401, "AUTH_REQUIRED", "invalid game-session token");
    }
    let claims: SessionClaims;
    try {
      claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionClaims;
    } catch {
      throw new HttpFailure(401, "AUTH_REQUIRED", "invalid game-session token");
    }
    if (
      !/^[a-f0-9]{64}$/.test(claims.playerId) ||
      !/^logic-v1:[a-f0-9]{64}$/.test(claims.logicPackId) ||
      !Number.isSafeInteger(claims.expiresAt)
    ) {
      throw new HttpFailure(401, "AUTH_REQUIRED", "invalid game-session claims");
    }
    if (claims.expiresAt <= this.now()) {
      throw new HttpFailure(401, "SESSION_EXPIRED", "game-session token expired");
    }
    this.requestPlayers.set(request, claims.playerId);
    return claims;
  }

  private signClaims(claims: SessionClaims): string {
    const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${encoded}.${this.hmac(`session\0${encoded}`)}`;
  }

  private hmac(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }

  private applyCors(request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin;
    if (origin === undefined) return;
    try {
      // A same-origin browser request keeps the public Host header when it passes through the Vite
      // or production reverse proxy. It is not CORS and needs no allowlist entry.
      if (new URL(origin).host === request.headers.host) return;
    } catch {
      throw new HttpFailure(403, "AUTH_REQUIRED", "browser origin is not allowed");
    }
    if (!this.allowedOrigins.has(origin)) {
      throw new HttpFailure(403, "AUTH_REQUIRED", "browser origin is not allowed");
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
}

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: GameErrorCodeV1,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpFailure(415, "ACTION_NOT_ALLOWED", "authoritative requests must use application/json");
  }
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMMAND_BODY_BYTES) {
    throw new HttpFailure(413, "ACTION_NOT_ALLOWED", "authoritative request body is too large");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_COMMAND_BODY_BYTES) {
      throw new HttpFailure(413, "ACTION_NOT_ALLOWED", "authoritative request body is too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpFailure(400, "ACTION_NOT_ALLOWED", "request body is not valid JSON");
  }
}

/**
 * `no-store` is the default because every other response is either player-scoped or authoritative
 * state that must never be replayed from a shared cache. Only a caller with a genuinely public,
 * caller-independent body may pass something else.
 */
function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  cacheControl = "no-store",
): void {
  const encoded = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(encoded);
}

function formatCommandServerTiming(timing: {
  readonly queueAndReadMs: number;
  readonly validationMs: number;
  readonly reductionMs: number;
  readonly finalizeMs: number;
  readonly persistenceMs: number;
  readonly totalMs: number;
}): string {
  const metric = (name: string, duration: number): string =>
    `${name};dur=${Math.max(0, duration).toFixed(3)}`;
  return [
    metric("queue-read", timing.queueAndReadMs),
    metric("validation", timing.validationMs),
    metric("reduction", timing.reductionMs),
    metric("finalize", timing.finalizeMs),
    metric("persistence", timing.persistenceMs),
    metric("command", timing.totalMs),
  ].join(", ");
}

/**
 * Fit a relayed error message inside `GameErrorV1Schema`'s 500-character bound. Truncating keeps
 * the leading text, which is where the actionable part of a service error lives; the ellipsis marks
 * that the client is not seeing the whole thing.
 */
function truncateErrorMessage(message: string): string {
  return message.length <= MAX_ERROR_MESSAGE_CHARS
    ? message
    : `${message.slice(0, MAX_ERROR_MESSAGE_CHARS - 1)}…`;
}

function statusForCode(code: GameErrorCodeV1): number {
  switch (code) {
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return 401;
    case "PACK_UNKNOWN":
    case "SLOT_NOT_FOUND":
    case "ENTITY_NOT_FOUND":
      return 404;
    case "REVISION_CONFLICT":
    case "DECISION_STALE":
    case "COMMAND_DUPLICATE_MISMATCH":
    case "SLOT_NOT_EMPTY":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "INTERNAL":
    case "STATE_CORRUPT":
      return 500;
    default:
      return 422;
  }
}

function isZodError(error: unknown): boolean {
  return error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "ZodError";
}

/**
 * The generic message is right for machine-authored requests, where a client that sends the wrong
 * shape has a bug rather than a typo. Routes carrying a value a *person* typed pass `message` so
 * the rejection says what to change instead of naming the protocol.
 */
function parseRequest<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
  message = "request does not match the authoritative protocol",
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (isZodError(error)) {
      throw new HttpFailure(400, "ACTION_NOT_ALLOWED", message);
    }
    throw error;
  }
}
