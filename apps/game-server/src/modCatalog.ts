import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { importCodeModArchive } from "@dib/mod-kernel";
import { CATALOG_PAGE_SIZE, CATALOG_SORTS, MOD_SOURCES, summarize, type AuthorProfile, type CatalogMod, type CatalogPage, type CatalogQuery, type CatalogSort, type CatalogTag, type ModRelease, type ModSource } from "@dib/mod-kernel/catalog";
import type { OfficialMod } from "./officialMods.js";
import { durableWriteFile } from "./durableWrite.js";
import { withFileLock } from "./fileLock.js";

export class CatalogError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
interface StoredMod extends Omit<CatalogMod, "author" | "source" | "summary" | "createdAt"> { owner: string; createdAt?: string; deleted?: boolean; blocked?: boolean }
interface CatalogState {
  schemaVersion: 1;
  profiles: Record<string, AuthorProfile>;
  mods: StoredMod[];
}
export const MOD_UPLOAD_LIMIT = 64 * 1024 * 1024;
export const SCREENSHOT_LIMIT = 5 * 1024 * 1024;
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) throw new CatalogError(400, "Invalid request fields.");
  return value as Record<string, unknown>;
}
export function textField(value: unknown, max: number, min = 0): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new CatalogError(400, `Expected text between ${min} and ${max} characters.`);
  }
  return value.trim();
}
function revision(value: unknown, expected: number): void {
  if (value !== expected) throw new CatalogError(409, "This item changed. Refresh before editing.");
}

/** Bounded catalog: one durable snapshot, serialized across processes, immutable hash-addressed blobs. */
export class ModCatalog {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, private readonly limits = {
    authorBytes: 1024 ** 3, totalBytes: 10 * 1024 ** 3, minFreeBytes: 512 * 1024 ** 2,
  }, private readonly official: readonly OfficialMod[] = []) {}

  private officialById(id: string): OfficialMod | undefined {
    return this.official.find((entry) => entry.view.id === id);
  }

  private async read(): Promise<CatalogState> {
    try {
      const data = JSON.parse(await readFile(join(this.directory, "catalog.json"), "utf8")) as CatalogState;
      if (data.schemaVersion !== 1 || !Array.isArray(data.mods) || !data.profiles || typeof data.profiles !== "object") {
        throw new Error("Mod catalog is corrupt.");
      }
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, profiles: {}, mods: [] };
      throw error;
    }
  }
  private async mutate<T>(work: (state: CatalogState) => Promise<T> | T): Promise<T> {
    const result = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      return withFileLock(join(this.directory, "catalog.lock"), async () => {
        const state = await this.read();
        const result = await work(state);
        await durableWriteFile(join(this.directory, "catalog.json"), JSON.stringify(state));
        return result;
      });
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
  private view(state: CatalogState, mod: StoredMod): CatalogMod {
    const author = state.profiles[mod.owner];
    if (!author) throw new Error("Mod owner profile is missing.");
    // Explicit DTO projection: later private moderation fields cannot leak through a spread.
    return { id: mod.id, modId: mod.modId, source: "community", title: mod.title, summary: summarize(mod.description),
      description: mod.description, tags: mod.tags, screenshots: mod.screenshots, published: mod.published,
      revision: mod.revision, createdAt: mod.releases.at(-1)?.createdAt ?? mod.createdAt ?? mod.updatedAt,
      updatedAt: mod.updatedAt, releases: mod.releases,
      author: { id: author.id, username: author.username, displayName: author.displayName,
        bio: author.bio, website: author.website, revision: author.revision } };
  }
  async profile(owner: string, username: string): Promise<AuthorProfile> {
    const existing = (await this.read()).profiles[owner];
    if (existing) return existing;
    return this.mutate((state) => state.profiles[owner] ??= {
      id: randomUUID(), username, displayName: username, bio: "", website: "", revision: 1,
    });
  }
  async editProfile(owner: string, input: unknown): Promise<AuthorProfile> {
    const body = object(input, ["displayName", "bio", "website", "revision"]);
    const displayName = textField(body["displayName"], 60, 1);
    const bio = textField(body["bio"], 1000);
    const website = textField(body["website"], 300);
    if (website) {
      let url: URL;
      try { url = new URL(website); } catch { throw new CatalogError(400, "Website must be an HTTPS URL."); }
      if (url.protocol !== "https:" || url.username || url.password) throw new CatalogError(400, "Website must be an HTTPS URL.");
    }
    return this.mutate((state) => {
      const current = state.profiles[owner];
      if (!current) throw new CatalogError(404, "Profile not found.");
      revision(body["revision"], current.revision);
      return state.profiles[owner] = { ...current, displayName, bio, website, revision: current.revision + 1 };
    });
  }
  /** Public listings (official beside community), or one author's own listings including drafts. */
  async list(query: CatalogQuery = {}, owner?: string): Promise<CatalogPage> {
    const state = await this.read();
    const text = (query.q ?? "").trim().toLowerCase();
    const tag = query.tag?.toLowerCase();
    const candidates = owner
      ? state.mods.filter((mod) => !mod.deleted && mod.owner === owner).map((mod) => this.view(state, mod))
      : this.visible(state);
    const mods = candidates.filter((mod) => (!query.source || mod.source === query.source) &&
      (!tag || mod.tags.some((entry) => entry.toLowerCase() === tag)) &&
      (!query.author || mod.author.id === query.author) &&
      (!text || `${mod.title} ${mod.description} ${mod.modId} ${mod.tags.join(" ")} ${mod.author.username} ${mod.author.displayName}`.toLowerCase().includes(text)))
      .sort(sorter(query.sort ?? "updated"));
    const offset = query.offset ?? 0;
    const size = owner ? 50 : CATALOG_PAGE_SIZE;
    return { mods: mods.slice(offset, offset + size), next: offset + size < mods.length ? offset + size : null, total: mods.length };
  }
  private visible(state: CatalogState): CatalogMod[] {
    return [...this.official.map((entry) => entry.view),
      ...state.mods.filter((mod) => !mod.deleted && mod.published).map((mod) => this.view(state, mod))];
  }
  /** Tag facet over public listings, most used first. */
  async tags(source?: CatalogQuery["source"]): Promise<CatalogTag[]> {
    const counts = new Map<string, CatalogTag>();
    for (const mod of this.visible(await this.read())) {
      if (source && mod.source !== source) continue;
      for (const tag of mod.tags) {
        const entry = counts.get(tag.toLowerCase()) ?? { tag, count: 0 };
        entry.count++; counts.set(tag.toLowerCase(), entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 40);
  }
  /** Batch read for update checks; unknown or withdrawn listings are simply absent. */
  async lookup(ids: readonly string[]): Promise<CatalogMod[]> {
    const wanted = new Set(ids);
    return this.visible(await this.read()).filter((mod) => wanted.has(mod.id));
  }
  async get(id: string, owner?: string): Promise<CatalogMod> {
    const official = this.officialById(id);
    if (official) return official.view;
    const state = await this.read();
    const mod = state.mods.find((entry) => entry.id === id && !entry.deleted && (entry.published || entry.owner === owner));
    if (!mod) throw new CatalogError(404, "Mod not found.");
    return this.view(state, mod);
  }
  async byModId(modId: string): Promise<CatalogMod> {
    const official = this.official.find((entry) => entry.view.modId === modId);
    if (official) return official.view;
    const state = await this.read();
    const mod = state.mods.find((entry) => entry.modId === modId && !entry.deleted && entry.published);
    if (!mod) throw new CatalogError(404, `Required mod ${modId} is not published.`);
    return this.view(state, mod);
  }
  /** Local operator path, never a player API. A blocked listing cannot be republished by its owner. */
  async moderate(id: string, blocked: boolean): Promise<void> {
    await this.mutate((state) => {
      const mod = state.mods.find((entry) => entry.id === id && !entry.deleted);
      if (!mod) throw new CatalogError(404, "Mod not found.");
      mod.blocked = blocked;
      if (blocked) mod.published = false;
      mod.revision++;
    });
  }
  /** Consistent live snapshot. A marker prevents upload-time garbage collection during copying. */
  async backup(destination: string): Promise<void> {
    const target = resolve(destination), source = resolve(this.directory);
    if (target === source || target.startsWith(source + sep) || source.startsWith(target + sep)) throw new Error("Backup destination must be separate from the catalog directory.");
    await mkdir(target); // Refuse an existing destination, including an incomplete prior backup.
    const marker = join(this.directory, "backup.lock");
    let markerOwned = false;
    try {
      const state = await this.mutate(async (current) => {
        const handle = await open(marker, "wx"); markerOwned = true;
        try { await handle.writeFile(new Date().toISOString()); await handle.sync(); } finally { await handle.close(); }
        return current;
      });
      const digests = new Set(state.mods.flatMap((mod) => [...mod.releases.map((entry) => entry.digest), ...mod.screenshots]));
      await mkdir(join(target, "blobs"));
      for (const digest of digests) await copyFile(join(source, "blobs", digest), join(target, "blobs", digest));
      await durableWriteFile(join(target, "catalog.json"), JSON.stringify(state));
      await durableWriteFile(join(target, "snapshot-complete.json"), JSON.stringify({ schemaVersion: 1, blobs: [...digests], createdAt: new Date().toISOString() }));
    } finally { if (markerOwned) await rm(marker, { force: true }); }
  }
  async author(id: string): Promise<AuthorProfile> {
    // The publisher, or an author a sidecar credits; never a profile in the writable catalog.
    const official = this.official.find((entry) => entry.view.author.id === id)?.view.author;
    if (official) return official;
    const state = await this.read();
    const profile = Object.values(state.profiles).find((entry) => entry.id === id);
    if (!profile || !state.mods.some((mod) => !mod.deleted && mod.published && state.profiles[mod.owner]?.id === id)) {
      throw new CatalogError(404, "Author not found.");
    }
    return profile;
  }
  async create(owner: string, input: unknown): Promise<CatalogMod> {
    const body = object(input, ["modId", "title", "description", "tags"]);
    const modId = textField(body["modId"], 160, 3);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(modId)) throw new CatalogError(400, "Use the manifest's reverse-DNS mod ID.");
    const fields = this.fields(body);
    return this.mutate((state) => {
      if (!state.profiles[owner]) throw new CatalogError(403, "Create your profile first.");
      if (state.mods.some((mod) => mod.modId === modId) || this.official.some((entry) => entry.view.modId === modId)) throw new CatalogError(409, "This mod ID is already reserved.");
      if (state.mods.length >= 2000 || state.mods.filter((mod) => mod.owner === owner).length >= 50) throw new CatalogError(413, "Catalog listing limit reached.");
      const now = new Date().toISOString();
      const mod: StoredMod = { ...fields, id: randomUUID(), owner, modId, published: false,
        revision: 1, createdAt: now, updatedAt: now, screenshots: [], releases: [] };
      state.mods.push(mod);
      return this.view(state, mod);
    });
  }
  private fields(body: Record<string, unknown>): Pick<StoredMod, "title" | "description" | "tags"> {
    const title = textField(body["title"], 100, 1);
    const description = textField(body["description"], 10000);
    const tags = body["tags"];
    if (!Array.isArray(tags) || tags.length > 8) throw new CatalogError(400, "Use at most eight tags.");
    return { title, description, tags: [...new Set(tags.map((tag) => textField(tag, 24, 1)))] };
  }
  private owned(state: CatalogState, owner: string, id: string): StoredMod {
    const mod = state.mods.find((entry) => entry.id === id && entry.owner === owner && !entry.deleted);
    if (!mod) throw new CatalogError(404, "Mod not found.");
    return mod;
  }
  async edit(owner: string, id: string, input: unknown): Promise<CatalogMod> {
    const body = object(input, ["title", "description", "tags", "published", "revision", "screenshots"]);
    const fields = this.fields(body);
    if (typeof body["published"] !== "boolean") throw new CatalogError(400, "Missing publication status.");
    return this.mutate((state) => {
      const mod = this.owned(state, owner, id);
      revision(body["revision"], mod.revision);
      if (body["published"] && mod.blocked) throw new CatalogError(403, "This listing has been hidden by the server operator.");
      if (body["published"] && mod.releases.length === 0) throw new CatalogError(400, "Upload a release before publishing.");
      const shots = body["screenshots"];
      if (!Array.isArray(shots) || shots.length > 6 || shots.some((shot) => !mod.screenshots.includes(shot as string))) throw new CatalogError(400, "Invalid screenshot selection.");
      Object.assign(mod, fields, { published: body["published"], screenshots: [...new Set(shots)], revision: mod.revision + 1, updatedAt: new Date().toISOString() });
      return this.view(state, mod);
    });
  }
  async remove(owner: string, id: string, expectedRevision: number): Promise<void> {
    await this.mutate((state) => {
      const mod = this.owned(state, owner, id);
      revision(expectedRevision, mod.revision);
      mod.deleted = true;
      mod.published = false;
      mod.releases = [];
      mod.screenshots = [];
      mod.revision++;
    });
  }
  /** Called while holding catalog lock: concurrent uploads cannot overspend quota. */
  private async putBlob(state: CatalogState, owner: string, bytes: Uint8Array): Promise<string> {
    try { await stat(join(this.directory, "backup.lock")); throw new CatalogError(503, "Mod storage is being backed up. Try the upload shortly."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const digest = hash(bytes);
    const blobDir = join(this.directory, "blobs");
    await mkdir(blobDir, { recursive: true });
    // Sweep only unreferenced blobs under the same lock as publication. A crashed write is safe.
    const referenced = new Set(state.mods.flatMap((mod) => [...mod.releases.map((entry) => entry.digest), ...mod.screenshots]));
    let total = 0;
    for (const file of await readdir(blobDir)) {
      if (!digestPattern.test(file)) continue;
      const path = join(blobDir, file);
      if (!referenced.has(file)) await rm(path, { force: true });
      else total += (await stat(path)).size;
    }
    const owned = new Set(state.mods.filter((mod) => mod.owner === owner).flatMap((mod) => [...mod.releases.map((entry) => entry.digest), ...mod.screenshots]));
    let authorBytes = 0;
    for (const entry of owned) authorBytes += (await stat(join(blobDir, entry))).size;
    const added = referenced.has(digest) ? 0 : bytes.length;
    if (total + added > this.limits.totalBytes || authorBytes + (owned.has(digest) ? 0 : bytes.length) > this.limits.authorBytes) throw new CatalogError(413, "Mod storage quota reached.");
    const disk = await statfs(this.directory);
    if (disk.bavail * disk.bsize < added + this.limits.minFreeBytes) throw new CatalogError(507, "Server storage is full. Try again later.");
    if (added > 0) {
      const temporary = join(this.directory, "upload.tmp");
      const handle = await open(temporary, "w");
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, join(blobDir, digest));
    }
    return digest;
  }
  async upload(owner: string, id: string, expectedRevision: number, bytes: Uint8Array, screenshot = false): Promise<CatalogMod> {
    // Ownership before decompression. Validation never evaluates package JavaScript.
    const current = await this.get(id, owner);
    const stateBefore = await this.read();
    this.owned(stateBefore, owner, id);
    revision(expectedRevision, current.revision);
    const image = screenshot ? sanitizePng(bytes) : undefined;
    const pkg = screenshot ? undefined : await importCodeModArchive(bytes, "upload.dibmod").catch(() => { throw new CatalogError(400, "Invalid .dibmod archive. Check the manifest, paths and size limits."); });
    if (pkg && pkg.manifest.id !== current.modId) throw new CatalogError(400, "Manifest ID must match this listing.");
    return this.mutate(async (state) => {
      const mod = this.owned(state, owner, id);
      revision(expectedRevision, mod.revision);
      if (screenshot && mod.screenshots.length >= 6) throw new CatalogError(413, "At most six screenshots.");
      if (pkg && mod.releases.some((entry) => entry.version === pkg.manifest.version)) throw new CatalogError(409, "Version already exists. Increase the manifest version.");
      if (mod.releases.length >= 100) throw new CatalogError(413, "Release limit reached.");
      const digest = await this.putBlob(state, owner, image ?? bytes);
      if (image) mod.screenshots = [...new Set([...mod.screenshots, digest])];
      else if (pkg) {
        const release: ModRelease = { version: pkg.manifest.version, digest, byteLength: bytes.length,
          createdAt: new Date().toISOString(), dependencies: { ...pkg.manifest.dependencies }, apiVersion: pkg.manifest.apiVersion };
        mod.releases.unshift(release);
      }
      mod.revision++;
      mod.updatedAt = new Date().toISOString();
      return this.view(state, mod);
    });
  }
  async blob(id: string, digest: string, screenshot: boolean, owner?: string): Promise<Buffer> {
    const file = await this.blobPath(id, digest, screenshot, owner);
    return typeof file === "string" ? readFile(file) : file;
  }
  /** A path to stream, or in-memory bytes for sanitized official screenshots. */
  async blobPath(id: string, digest: string, screenshot: boolean, owner?: string): Promise<string | Buffer> {
    if (!digestPattern.test(digest)) throw new CatalogError(404, "File not found.");
    const official = this.officialById(id);
    if (official) {
      const found = screenshot ? official.screenshotBytes.get(digest) : official.releaseFiles.get(digest);
      if (!found) throw new CatalogError(404, "File not found.");
      return found;
    }
    const mod = await this.get(id, owner);
    if (!(screenshot ? mod.screenshots.includes(digest) : mod.releases.some((release) => release.digest === digest))) throw new CatalogError(404, "File not found.");
    return join(this.directory, "blobs", digest);
  }
}

function sorter(sort: CatalogQuery["sort"]): (a: CatalogMod, b: CatalogMod) => number {
  return (a, b) => (sort === "name" ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
    : sort === "newest" ? b.createdAt.localeCompare(a.createdAt)
      : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id);
}
/** Strict public query parsing: unknown values are a 400, never silently ignored. */
export function parseCatalogQuery(params: URLSearchParams): CatalogQuery {
  const query: CatalogQuery = { q: (params.get("q") ?? "").slice(0, 120) };
  const offset = Number(params.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2000) throw new CatalogError(400, "Invalid page.");
  query.offset = offset;
  const source = params.get("source");
  if (source) {
    if (!(MOD_SOURCES as readonly string[]).includes(source)) throw new CatalogError(400, "Invalid source.");
    query.source = source as ModSource;
  }
  const sort = params.get("sort");
  if (sort) {
    if (!(CATALOG_SORTS as readonly string[]).includes(sort)) throw new CatalogError(400, "Invalid sort.");
    query.sort = sort as CatalogSort;
  }
  const tag = params.get("tag");
  if (tag) query.tag = textField(tag, 24, 1);
  const author = params.get("author");
  if (author) {
    if (!/^[a-f0-9-]{36}$/.test(author)) throw new CatalogError(400, "Invalid author.");
    query.author = author;
  }
  return query;
}

/** Only canvas-compatible, noninterlaced 8-bit RGB/RGBA PNG; strip every ancillary chunk. */
export function sanitizePng(input: Uint8Array): Buffer {
  const bytes = Buffer.from(input);
  const fail = (): never => { throw new CatalogError(400, "Screenshot must be a valid RGB/RGBA PNG, at most 4096px per side and 8 million pixels."); };
  if (bytes.length > SCREENSHOT_LIMIT || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail();
  let header: Buffer | undefined;
  const data: Buffer[] = [];
  let ended = false;
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) fail();
    const length = bytes.readUInt32BE(at);
    if (at + 12 + length > bytes.length) fail();
    const kind = bytes.toString("ascii", at + 4, at + 8);
    const payload = bytes.subarray(at + 8, at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length)) fail();
    if (at === 8 && kind !== "IHDR") fail();
    if (kind === "IHDR") { if (header || length !== 13) fail(); header = payload; }
    else if (kind === "IDAT") data.push(payload);
    else if (kind === "IEND") { if (length || at + 12 !== bytes.length) fail(); ended = true; }
    else if (kind[0] === kind[0]?.toUpperCase() && kind !== "PLTE") fail();
    at += length + 12;
  }
  if (!header || !ended || data.length === 0) return fail();
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), color = header[9];
  if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000 || header[8] !== 8 || (color !== 2 && color !== 6) || header[10] || header[11] || header[12]) fail();
  const stride = width * (color === 6 ? 4 : 3) + 1;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(data), { maxOutputLength: stride * height }); } catch { return fail(); }
  if (raw.length !== stride * height) fail();
  for (let row = 0; row < height; row++) if ((raw[row * stride] ?? 255) > 4) fail();
  return Buffer.concat([bytes.subarray(0, 8), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
function pngChunk(kind: string, payload: Buffer): Buffer {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length); chunk.write(kind, 4); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, payload.length + 8)), payload.length + 8);
  return chunk;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
