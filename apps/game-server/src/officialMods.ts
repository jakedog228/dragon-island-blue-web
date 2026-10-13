import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { compareModVersions, importCodeModArchive } from "@dib/mod-kernel";
import type { AuthorProfile, CatalogMod, ModRelease } from "@dib/mod-kernel/catalog";
import { summarize } from "@dib/mod-kernel/catalog";
import { sanitizePng } from "./modCatalog.js";

/** Stable public identity for everything the operator ships; never an account's player ID. */
export const OFFICIAL_AUTHOR: AuthorProfile = Object.freeze({
  id: "00000000-0000-4000-8000-00000000d1b0",
  username: "official",
  displayName: "DIB Web",
  bio: "Mods maintained alongside the Dragon Island Blue web port and shipped by this server. They install like any other mod.",
  website: "",
  revision: 1,
});
/**
 * A sidecar's `author` credits someone else's work that this server ships (a conversion, say).
 * The profile is derived from the name alone, so the same credit on two listings is one author.
 */
export function creditedAuthor(name: string): AuthorProfile {
  const key = name.trim();
  const hex = createHash("sha256").update(`dib-official-author:${key.toLowerCase()}`).digest("hex");
  return Object.freeze({
    id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
    username: key,
    displayName: key,
    bio: `Original author. ${OFFICIAL_AUTHOR.displayName} ships this work on this server with their credit.`,
    website: "",
    revision: 1,
  });
}
export interface OfficialMod {
  readonly view: CatalogMod;
  /** Release digest -> archive path on disk. */
  readonly releaseFiles: ReadonlyMap<string, string>;
  /** Screenshot digest -> sanitized PNG bytes. */
  readonly screenshotBytes: ReadonlyMap<string, Buffer>;
}
interface ListingSidecar { title?: string; author?: string; summary?: string; description?: string; tags?: string[]; screenshots?: string[] }
const SIDECAR_KEYS = ["title", "author", "summary", "description", "tags", "screenshots"];
/** Card one-liners; a longer line would be clamped mid-sentence on every card anyway. */
const SUMMARY_LIMIT = 160;
interface ReleaseGroup {
  releases: ModRelease[];
  files: Map<string, string>;
  sidecar?: ListingSidecar;
  sidecarVersion?: string;
  displayName: string;
  displayVersion: string;
  mtime: number;
}

/** Listing IDs look like the community's UUIDs so every public route shape stays identical. */
export function officialListingId(modId: string): string {
  const hex = createHash("sha256").update(`dib-official-mod:${modId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Reads the operator's read-only directory of `<name>.dibmod` files, each with an optional
 * `<name>.listing.json` ({ title, author, summary, description, tags, screenshots: ["<file>.png"] }).
 * Several files with one manifest ID become releases of one listing. `author` credits the original
 * author; without it the listing is by OFFICIAL_AUTHOR. Anything malformed fails startup loudly.
 */
export async function loadOfficialMods(directory: string): Promise<OfficialMod[]> {
  const root = resolve(directory);
  const names = (await readdir(root)).filter((name) => name.endsWith(".dibmod")).sort();
  const grouped = new Map<string, ReleaseGroup>();
  for (const name of names) {
    const path = join(root, name);
    const bytes = await readFile(path);
    let pkg;
    try { pkg = await importCodeModArchive(bytes, name); }
    catch (error) { throw new Error(`Official mod ${name} is invalid: ${error instanceof Error ? error.message : String(error)}`); }
    const info = await stat(path);
    const group: ReleaseGroup = grouped.get(pkg.manifest.id) ??
      { releases: [], files: new Map(), displayName: pkg.manifest.displayName, displayVersion: pkg.manifest.version, mtime: 0 };
    if (group.releases.some((release) => release.version === pkg.manifest.version)) {
      throw new Error(`Official mod ${pkg.manifest.id} ships version ${pkg.manifest.version} twice.`);
    }
    group.releases.push({ version: pkg.manifest.version, digest: pkg.digest, byteLength: bytes.length,
      createdAt: info.mtime.toISOString(), dependencies: { ...pkg.manifest.dependencies }, apiVersion: pkg.manifest.apiVersion });
    group.files.set(pkg.digest, path);
    group.mtime = Math.max(group.mtime, info.mtimeMs);
    const sidecar = await readSidecar(join(root, `${basename(name, ".dibmod")}.listing.json`));
    // The newest release's listing text wins, so an update can refresh its own description.
    if (sidecar && (!group.sidecarVersion || compareModVersions(pkg.manifest.version, group.sidecarVersion) > 0)) {
      group.sidecar = sidecar; group.sidecarVersion = pkg.manifest.version;
    }
    if (compareModVersions(pkg.manifest.version, group.displayVersion) > 0) {
      group.displayName = pkg.manifest.displayName; group.displayVersion = pkg.manifest.version;
    }
    grouped.set(pkg.manifest.id, group);
  }
  const mods: OfficialMod[] = [];
  for (const [modId, group] of grouped) {
    group.releases.sort((a, b) => compareModVersions(b.version, a.version));
    const screenshotBytes = new Map<string, Buffer>();
    for (const file of group.sidecar?.screenshots ?? []) {
      if (!/^[\w.-]+\.png$/i.test(file)) throw new Error(`Official mod ${modId}: screenshot names must be plain .png file names.`);
      const png = sanitizePng(await readFile(join(root, file)));
      screenshotBytes.set(createHash("sha256").update(png).digest("hex"), png);
    }
    const description = group.sidecar?.description ?? "";
    const updatedAt = new Date(group.mtime).toISOString();
    mods.push({
      releaseFiles: group.files,
      screenshotBytes,
      view: Object.freeze({
        id: officialListingId(modId), modId, source: "official", title: group.sidecar?.title ?? group.displayName,
        summary: group.sidecar?.summary?.trim() || summarize(description), description, tags: [...new Set(group.sidecar?.tags ?? [])],
        screenshots: [...screenshotBytes.keys()], author: group.sidecar?.author ? creditedAuthor(group.sidecar.author) : OFFICIAL_AUTHOR,
        published: true, revision: 1,
        createdAt: group.releases.at(-1)!.createdAt, updatedAt, releases: group.releases,
      }),
    });
  }
  return mods;
}

async function readSidecar(path: string): Promise<ListingSidecar | undefined> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const value = JSON.parse(text) as unknown;
  const fail = (): never => { throw new Error(`${path} must be { title?, author?, summary?, description?, tags?: string[], screenshots?: string[] }.`); };
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !SIDECAR_KEYS.includes(key))) fail();
  const record = value as Record<string, unknown>;
  const text100 = (entry: unknown, max: number): boolean => entry === undefined || (typeof entry === "string" && entry.length <= max);
  const list = (entry: unknown, max: number, item: number): boolean => entry === undefined ||
    (Array.isArray(entry) && entry.length <= max && entry.every((tag) => typeof tag === "string" && tag.length > 0 && tag.length <= item));
  // A credit is shown as "by <name>" and searched like a username: one line, no control characters.
  const credit = record["author"];
  if (credit !== undefined && (typeof credit !== "string" || !credit.trim() || credit.length > 60 || /[\u0000-\u001f]/.test(credit))) fail();
  if (!text100(record["title"], 100) || !text100(record["summary"], SUMMARY_LIMIT) || !text100(record["description"], 10000) || !list(record["tags"], 8, 24) || !list(record["screenshots"], 6, 120)) fail();
  return record as ListingSidecar;
}
