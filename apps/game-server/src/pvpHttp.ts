import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { PVP_PROTOCOL_VERSION, PvpErrorV1Schema } from "@dib/game-protocol";
import { PvpService, PvpServiceError, type PvpPrincipal } from "./pvpService.js";
import { RateLimiter, resolveClientAddress } from "./rateLimit.js";
import type { Logger } from "./logging.js";

const displayName = z.string().trim().min(1).max(40).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use a single-line player name.");
const guestClaims = z.object({ audience: z.literal("pvp-offline-v1"), id: z.uuid(), name: displayName, expiresAt: z.number().int().nonnegative() }).strict();
const BODY_LIMIT = 64 * 1024;
const SESSION_TTL = 7 * 24 * 60 * 60_000;

export interface PvpHttpOptions {
  readonly service?: PvpService;
  readonly secret: string | Uint8Array;
  readonly authenticateOfficial: (request: IncomingMessage) => Promise<PvpPrincipal>;
  readonly logger: Logger;
  readonly trustProxy: boolean;
  readonly now: () => number;
}

/** Mounted behind GameHttpRuntime's existing CORS check. Guest tokens cannot authorize game APIs. */
export class PvpHttp {
  private readonly sessions: RateLimiter;
  private readonly addresses: RateLimiter;
  private readonly players: RateLimiter;
  constructor(private readonly options: PvpHttpOptions) {
    this.sessions = new RateLimiter({ perMinute: 6, burst: 6, now: options.now });
    this.addresses = new RateLimiter({ perMinute: 180, burst: 60, now: options.now });
    this.players = new RateLimiter({ perMinute: 120, burst: 30, now: options.now });
  }
  private limit(limiter: RateLimiter, key: string, response: ServerResponse): void {
    const result = limiter.take(key);
    if (result.allowed) return;
    response.setHeader("Retry-After", String(result.retryAfterSeconds));
    throw new PvpServiceError("RATE_LIMITED", "Too many PvP requests. Wait a moment and try again.");
  }
  private sign(encoded: string): Buffer {
    return createHmac("sha256", this.options.secret).update(`pvp-offline-session\0${encoded}`).digest();
  }
  private async authenticate(request: IncomingMessage): Promise<PvpPrincipal> {
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (!token || token.length > 4096) throw new PvpServiceError("UNAUTHORIZED", "Your PvP session is missing or expired. Reconnect to PvP.");
    if (!token.startsWith("pvpo.")) {
      try { return await this.options.authenticateOfficial(request); }
      catch { throw new PvpServiceError("UNAUTHORIZED", "Your Online session has expired. Sign in again to resume this match."); }
    }
    try {
      const [prefix, encoded, signature, extra] = token.split(".");
      if (prefix !== "pvpo" || !encoded || !signature || extra !== undefined || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("shape");
      const expected = this.sign(encoded);
      const actual = Buffer.from(signature, "hex");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("signature");
      const claims = guestClaims.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
      if (claims.expiresAt <= this.options.now()) throw new Error("expired");
      return { id: `offline:${claims.id}`, name: claims.name };
    } catch { throw new PvpServiceError("UNAUTHORIZED", "Your PvP session is missing or expired. Reconnect to PvP."); }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const path = new URL(request.url ?? "/", "http://pvp.local").pathname;
      const address = resolveClientAddress(request.headers["x-forwarded-for"], request.socket.remoteAddress, this.options.trustProxy);
      this.limit(this.addresses, address, response);
      if (request.method === "GET" && path === "/api/pvp/info") {
        send(response, 200, { protocolVersion: PVP_PROTOCOL_VERSION, enabled: this.options.service !== undefined }); return;
      }
      const service = this.options.service;
      if (!service) throw new PvpServiceError("UNAVAILABLE", "PvP is not enabled on this server. Ask the server operator to enable it.");
      if (request.method === "POST" && path === "/api/pvp/session") {
        this.limit(this.sessions, address, response);
        const input = z.object({ name: displayName }).strict().parse(await readBody(request));
        const claims = guestClaims.parse({ audience: "pvp-offline-v1", id: randomUUID(), name: input.name, expiresAt: this.options.now() + SESSION_TTL });
        const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
        send(response, 201, { protocolVersion: PVP_PROTOCOL_VERSION, token: `pvpo.${encoded}.${this.sign(encoded).toString("hex")}`, expiresAt: claims.expiresAt }); return;
      }
      const principal = await this.authenticate(request);
      this.limit(this.players, principal.id, response);
      if (request.method === "POST" && path === "/api/pvp/invites") {
        send(response, 200, await service.invite(principal, await readBody(request))); return;
      }
      if (request.method === "POST" && path === "/api/pvp/join") {
        send(response, 200, await service.join(principal, await readBody(request))); return;
      }
      if (request.method === "GET" && path === "/api/pvp/matches/current") {
        send(response, 200, { match: await service.read(principal) ?? null }); return;
      }
      if (request.method === "POST" && path === "/api/pvp/matches/current") {
        // Reopening with a different local mod selection must pass the same admission policy.
        service.validateSetup(await readBody(request));
        send(response, 200, { match: await service.read(principal) ?? null }); return;
      }
      const match = /^\/api\/pvp\/matches\/([a-f0-9-]+)(?:\/(commands|cancel))?$/.exec(path);
      if (match) {
        const id = z.uuid().parse(match[1]);
        if (request.method === "GET" && !match[2]) { send(response, 200, await service.read(principal, id)); return; }
        if (request.method === "POST" && match[2] === "commands") { send(response, 200, await service.command(principal, id, await readBody(request))); return; }
        if (request.method === "POST" && match[2] === "cancel") {
          const input = z.object({ requestId: z.uuid() }).strict().parse(await readBody(request));
          send(response, 200, await service.cancel(principal, id, input.requestId)); return;
        }
      }
      throw new PvpServiceError("NOT_FOUND", "PvP route not found.");
    } catch (error) {
      if (error instanceof PvpServiceError) {
        const status = error.code === "UNAUTHORIZED" ? 401 : error.code === "NOT_FOUND" ? 404 : error.code === "RATE_LIMITED" ? 429 :
          error.code === "UNAVAILABLE" ? 503 : error.code === "INVALID_REQUEST" ? 400 : 409;
        send(response, status, { error: PvpErrorV1Schema.parse({ code: error.code, message: error.message.slice(0, 500), issues: error.issues.slice(0, 128) }) });
      } else if (error instanceof z.ZodError) {
        const first = error.issues[0];
        send(response, 400, { error: { code: "INVALID_REQUEST", message: `Invalid PvP request at ${first?.path.join(".") || "body"}: ${first?.message || "unexpected shape"}`.slice(0, 500), issues: [] } });
      } else {
        // Do not log request bodies, bearer tokens, invite codes or private match transcripts.
        this.options.logger.error("PvP request failed", { errorName: error instanceof Error ? error.name : "unknown" });
        send(response, 503, { error: { code: "UNAVAILABLE", message: "The PvP server could not complete this request. Reconnect and retry; your campaign save is unchanged.", issues: [] } });
      }
    }
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw new PvpServiceError("INVALID_REQUEST", "PvP requests must use JSON.");
  if (Number(request.headers["content-length"] ?? 0) > BODY_LIMIT) throw new PvpServiceError("INVALID_REQUEST", "PvP request is too large.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > BODY_LIMIT) throw new PvpServiceError("INVALID_REQUEST", "PvP request is too large.");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new PvpServiceError("INVALID_REQUEST", "PvP request is not valid JSON."); }
}
function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}
