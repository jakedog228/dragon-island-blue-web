import type { CatalogMod } from "@dib/mod-kernel/catalog";
import type { LibraryEntry } from "../content/modLibraryModel.js";
import { PVP_MOD } from "./pvpMod.js";

/** Local catalog presentation only. This token is never a downloadable archive or trust exemption. */
export const PVP_BUILTIN_RELEASE = `builtin-pvp-${PVP_MOD.version}`;
const saveMetadata = { saveCompatibility: "neutral" as const };
export const PVP_LISTING: CatalogMod = {
  id: "builtin-multiplayer-pvp", modId: PVP_MOD.id, source: "official", title: PVP_MOD.name,
  summary: "Challenge a friend. Bring your party, share an invite code, and battle online.",
  description: "Bring your party to the Arena and challenge another player in a two-player exhibition. Choose PvP beside Tournament, create an invite code, or join a friend's match.\n\nBoth teams start at full health. Fight through the normal combat layout and animations, choose abilities and targets, summon your spirits, use your reserves, and surrender through the existing retreat button. Once a match starts, finish it or surrender; disconnects use the turn timeout. Your campaign progress, items, rewards, and monsters stay unchanged.\n\nWorks with Offline and Official parties. Both players need an internet connection and compatible game rules. Only reviewed cosmetic mods are allowed. Gameplay mods are disabled in PvP, even when both players select the same mod.\n\nIncluded with the game. Enable it here, then Apply to make PvP available in the Arena.",
  tags: ["Multiplayer", "Battles"], screenshots: [],
  author: { id: "dib-web", username: "dib-web", displayName: PVP_MOD.author,
    bio: "Official extensions for the Dragon Island Blue web port.", website: "", revision: 1 },
  published: true, revision: 1, createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z",
  releases: [{ version: PVP_MOD.version, digest: PVP_BUILTIN_RELEASE, byteLength: 0,
    createdAt: "2026-10-05T00:00:00Z", dependencies: {}, apiVersion: 4, ...saveMetadata }],
};

export function pvpLibraryEntry(staged: boolean, applied: boolean): LibraryEntry {
  return { modId: PVP_MOD.id, displayName: PVP_MOD.name, origin: "official", listingId: undefined,
    listing: PVP_LISTING, update: undefined,
    versions: [{ digest: PVP_BUILTIN_RELEASE, version: PVP_MOD.version, byteLength: 0, stored: true, ...saveMetadata }],
    stagedDigest: staged ? PVP_BUILTIN_RELEASE : undefined, appliedDigest: applied ? PVP_BUILTIN_RELEASE : undefined };
}

export function pvpListingMatches(query: string, tag?: string, author?: string): boolean {
  const text = query.trim().toLowerCase();
  return (!text || [PVP_LISTING.title, PVP_LISTING.modId, PVP_LISTING.summary, PVP_LISTING.description, ...PVP_LISTING.tags].join(" ").toLowerCase().includes(text)) &&
    (!tag || PVP_LISTING.tags.includes(tag)) && (!author || PVP_LISTING.author.id === author);
}
