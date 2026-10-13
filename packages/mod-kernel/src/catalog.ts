/** Public community DTOs. No private player IDs or credentials belong in these types. */
export interface AuthorProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  website: string;
  revision: number;
}
export interface ModRelease {
  version: string;
  digest: string;
  byteLength: number;
  createdAt: string;
  dependencies: Record<string, string>;
  apiVersion: number;
}
/**
 * `official` listings are packages the server operator ships read-only from its own directory;
 * `community` listings are uploaded by signed-in authors. The two never share a mod ID.
 */
export type ModSource = "official" | "community";
export const MOD_SOURCES: readonly ModSource[] = ["official", "community"];
export interface CatalogMod {
  id: string;
  modId: string;
  source: ModSource;
  title: string;
  /** One line shown on cards; derived from the description when an author gives none. */
  summary: string;
  description: string;
  tags: string[];
  screenshots: string[];
  author: AuthorProfile;
  published: boolean;
  revision: number;
  /** First release time; listings without releases use their creation time. */
  createdAt: string;
  updatedAt: string;
  /** Newest first. */
  releases: ModRelease[];
}
export type CatalogSort = "updated" | "newest" | "name";
export const CATALOG_SORTS: readonly CatalogSort[] = ["updated", "newest", "name"];
export const CATALOG_PAGE_SIZE = 24;
export interface CatalogQuery {
  q?: string;
  source?: ModSource;
  tag?: string;
  /** Public author profile ID. */
  author?: string;
  sort?: CatalogSort;
  offset?: number;
}
export interface CatalogPage { mods: CatalogMod[]; next: number | null; total: number }
export interface CatalogTag { tag: string; count: number }
export interface CommunityInfo {
  /** Public catalog reads work (official and/or community listings). */
  enabled: boolean;
  /** Author portal origin; empty when this server accepts no uploads. */
  authorOrigin: string;
  registrationEnabled: boolean;
}

/** First sentence/line of a description, bounded for cards. */
export function summarize(description: string, max = 140): string {
  const line = description.split(/\n/).map((part) => part.replace(/[#*_`>]/g, "").trim()).find((part) => part.length > 0) ?? "";
  const sentence = /^(.{20,}?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}
