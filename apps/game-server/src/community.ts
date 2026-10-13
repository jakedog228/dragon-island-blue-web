import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { AccountUsernameV1Schema, normalizeAccountUsername } from "@dib/game-protocol";
import { AccountRequestError, createAccount, loginTokenPlayerId, readAccount } from "./invites.js";
import { MOD_SOURCES, type ModSource } from "@dib/mod-kernel/catalog";
import { CatalogError, ModCatalog, MOD_UPLOAD_LIMIT, SCREENSHOT_LIMIT, object, parseCatalogQuery, textField } from "./modCatalog.js";
import type { OfficialMod } from "./officialMods.js";
import { RateLimiter, resolveClientAddress } from "./rateLimit.js";

export interface CommunityOptions {
  directory: string;
  accountDirectory: string;
  hmacSecret: string;
  /**
   * Must differ from the game origin; private requests are host AND origin checked. Omitted when
   * the server only publishes its own official mods and accepts no uploads.
   */
  authorOrigin?: string | undefined;
  /** Operator-shipped read-only listings, loaded (and validated) before serving. */
  official?: readonly OfficialMod[];
  registrationEnabled: boolean;
  maxAccounts: number;
  trustProxy: boolean;
}
interface AuthorSession { owner: string; username: string; expires: number }
const tokenHash = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Separate audience from Official sessions. No cookies or credential persistence in the game page. */
export class CommunityHttp {
  readonly catalog: ModCatalog;
  private readonly sessions = new Map<string, AuthorSession>();
  private readonly reads = new RateLimiter({ perMinute: 120, burst: 50 });
  private readonly logins = new RateLimiter({ perMinute: 10, burst: 5 });
  private readonly registrations = new RateLimiter({ perMinute: 0.2, burst: 1 });
  private readonly writes = new RateLimiter({ perMinute: 20, burst: 10 });
  private uploads = 0;
  constructor(private readonly options: CommunityOptions) {
    this.catalog = new ModCatalog(options.directory, undefined, options.official ?? []);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try { await this.route(req, res); }
    catch (error) {
      const known = error instanceof CatalogError || error instanceof AccountRequestError;
      json(res, error instanceof CatalogError ? error.status : known ? 400 : 500,
        { message: known ? error.message : "Community service could not complete this request." });
    }
  }
  private limit(limiter: RateLimiter, key: string, res: ServerResponse): void {
    const result = limiter.take(key);
    if (!result.allowed) { res.setHeader("Retry-After", result.retryAfterSeconds); throw new CatalogError(429, "Please wait and try again."); }
  }
  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://community.local");
    const path = url.pathname.replace(/^\/api\/community/, "");
    const method = req.method ?? "GET";
    const address = resolveClientAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress, this.options.trustProxy);
    this.limit(this.reads, address, res);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (method === "GET" && path === "/info") {
      const authors = Boolean(this.options.authorOrigin);
      json(res, 200, { enabled: true, authorOrigin: this.options.authorOrigin ?? "", registrationEnabled: authors && this.options.registrationEnabled }); return;
    }
    // Public reads are same-origin via the game's proxy. No credentials needed or processed.
    if (method === "GET" && path === "/mods") { json(res, 200, await this.catalog.list(parseCatalogQuery(url.searchParams))); return; }
    if (method === "GET" && path === "/tags") {
      const source = url.searchParams.get("source") ?? undefined;
      if (source !== undefined && !(MOD_SOURCES as readonly string[]).includes(source)) throw new CatalogError(400, "Invalid source.");
      json(res, 200, { tags: await this.catalog.tags(source as ModSource | undefined) }); return;
    }
    if (method === "GET" && path === "/mods/lookup") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      if (ids.length > 50 || ids.some((id) => !/^[a-f0-9-]{36}$/.test(id))) throw new CatalogError(400, "Invalid listing IDs.");
      json(res, 200, { mods: await this.catalog.lookup(ids) }); return;
    }
    const publicMod = /^\/mods\/([a-f0-9-]{36})$/.exec(path);
    if (method === "GET" && publicMod) { json(res, 200, await this.catalog.get(publicMod[1]!)); return; }
    const lookup = /^\/mods\/by-id\/([a-z0-9.-]{3,160})$/.exec(path);
    if (method === "GET" && lookup) { json(res, 200, await this.catalog.byModId(lookup[1]!)); return; }
    const author = /^\/authors\/([a-f0-9-]{36})$/.exec(path);
    if (method === "GET" && author) { json(res, 200, await this.catalog.author(author[1]!)); return; }
    const file = /^\/mods\/([a-f0-9-]{36})\/(download|image)\/([a-f0-9]{64})$/.exec(path);
    if (method === "GET" && file) {
      const image = file[2] === "image";
      const found = await this.catalog.blobPath(file[1]!, file[3]!, image);
      res.setHeader("Content-Length", typeof found === "string" ? (await stat(found)).size : found.length);
      res.setHeader("Content-Type", image ? "image/png" : "application/octet-stream");
      // Content-addressed: a digest URL can never name different bytes, so images may be cached.
      res.setHeader("Cache-Control", image ? "public, max-age=86400, immutable" : "no-store");
      res.setHeader("Content-Disposition", `${image ? "inline" : "attachment"}; filename="${file[3]}.${image ? "png" : "dibmod"}"`);
      if (typeof found === "string") await pipeline(createReadStream(found), res);
      else res.end(found);
      return;
    }

    // A game-origin script may possess no portal token, but still explicitly reject that origin.
    if (!this.options.authorOrigin) throw new CatalogError(404, "This server does not accept mod uploads.");
    const portal = new URL(this.options.authorOrigin);
    if (req.headers.host !== portal.host || req.headers.origin !== portal.origin) throw new CatalogError(403, "Open the author portal to manage your account and mods.");
    if (method === "POST" && (path === "/session" || path === "/accounts")) {
      this.limit(this.logins, address, res);
      let loginToken: string;
      let createdKey: string | undefined;
      if (path === "/accounts") {
        if (!this.options.registrationEnabled) throw new CatalogError(403, "Registration is closed.");
        this.limit(this.registrations, address, res);
        const body = object(await readJson(req), ["username"]);
        const username = normalizeAccountUsername(textField(body["username"], 100, 1));
        if (!AccountUsernameV1Schema.safeParse(username).success) throw new CatalogError(400, "Choose a valid username (letters, digits, spaces, _ or -).");
        const created = await createAccount({ dataDirectory: this.options.accountDirectory,
          hmacSecret: this.options.hmacSecret, username, publicScoreboard: false, maxAccounts: this.options.maxAccounts });
        loginToken = created.loginToken; createdKey = loginToken;
      } else {
        const body = object(await readJson(req), ["loginToken"]);
        loginToken = textField(body["loginToken"], 512, 16);
      }
      const owner = loginTokenPlayerId(this.options.hmacSecret, loginToken);
      const account = await readAccount(this.options.accountDirectory, owner);
      if (!account) throw new CatalogError(401, "Login key not recognized, or this key has no username. Use an existing named account or create one.");
      for (const [key, entry] of this.sessions) if (entry.expires <= Date.now()) this.sessions.delete(key);
      if (this.sessions.size >= 10000) throw new CatalogError(503, "Sign-in is busy. Try later.");
      const token = randomBytes(32).toString("base64url");
      this.sessions.set(tokenHash(token), { owner, username: account.username, expires: Date.now() + 8 * 60 * 60 * 1000 });
      json(res, 200, { token, profile: await this.catalog.profile(owner, account.username), ...(createdKey ? { loginToken: createdKey } : {}) }); return;
    }
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const session = this.sessions.get(tokenHash(token));
    if (!session || session.expires <= Date.now()) throw new CatalogError(401, "Sign in to the author portal.");

    if (!(await readAccount(this.options.accountDirectory, session.owner))) {
      this.sessions.delete(tokenHash(token)); throw new CatalogError(401, "Account access was revoked.");
    }
    this.limit(this.writes, session.owner, res);
    if (method === "POST" && path === "/logout") { this.sessions.delete(tokenHash(token)); json(res, 200, { ok: true }); return; }
    if (method === "POST" && path === "/me") { json(res, 200, { profile: await this.catalog.profile(session.owner, session.username), ...(await this.catalog.list({}, session.owner)) }); return; }
    if (method === "PATCH" && path === "/me/profile") { json(res, 200, await this.catalog.editProfile(session.owner, await readJson(req))); return; }
    if (method === "POST" && path === "/me/mods") { json(res, 201, await this.catalog.create(session.owner, await readJson(req))); return; }
    const preview = /^\/me\/mods\/([a-f0-9-]{36})\/image\/([a-f0-9]{64})$/.exec(path);
    if (method === "POST" && preview) {
      const bytes = await this.catalog.blob(preview[1]!, preview[2]!, true, session.owner);
      res.setHeader("Content-Type", "image/png"); res.setHeader("Cache-Control", "no-store"); res.end(bytes); return;
    }
    const mod = /^\/me\/mods\/([a-f0-9-]{36})(?:\/(release|screenshot))?$/.exec(path);
    if (mod) {
      const id = mod[1]!;
      if (method === "PATCH" && !mod[2]) { json(res, 200, await this.catalog.edit(session.owner, id, await readJson(req))); return; }
      if (method === "DELETE" && !mod[2]) { await this.catalog.remove(session.owner, id, Number(req.headers["if-match"])); json(res, 200, { ok: true }); return; }
      if (method === "POST" && mod[2]) {
        if (this.uploads >= 1) throw new CatalogError(503, "Another upload is being processed. Try again shortly.");
        const screenshot = mod[2] === "screenshot";
        // One bounded upload at a time prevents request bodies multiplying the memory budget.
        this.uploads++;
        try {
          const bytes = await readBytes(req, screenshot ? SCREENSHOT_LIMIT : MOD_UPLOAD_LIMIT);
          json(res, 200, await this.catalog.upload(session.owner, id, Number(req.headers["if-match"]), bytes, screenshot));
        } finally { this.uploads--; }
        return;
      }
    }
    throw new CatalogError(404, "Community endpoint not found.");
  }
}
function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(req.headers["content-length"] ?? 0) > limit) throw new CatalogError(413, "Upload exceeds the size limit.");
  const chunks: Buffer[] = []; let size = 0;
  const timer = setTimeout(() => req.destroy(), 60_000);
  try {
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length;
      if (size > limit) throw new CatalogError(413, "Upload exceeds the size limit.");
      chunks.push(bytes);
    }
  } finally { clearTimeout(timer); }
  return Buffer.concat(chunks);
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  try { return JSON.parse((await readBytes(req, 32 * 1024)).toString("utf8")) as unknown; }
  catch (error) { if (error instanceof CatalogError) throw error; throw new CatalogError(400, "Invalid JSON request."); }
}
