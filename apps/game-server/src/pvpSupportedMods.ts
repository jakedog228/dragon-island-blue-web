import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { importCodeModArchive, type CodeModPackage } from "@dib/mod-kernel";
import type { OfficialMod } from "./officialMods.js";
import type { PvpModSupport } from "./pvpCompatibility.js";

const WAND_ID = "dev.dragonislandblue.wand-pointer-trail";
// Reviewed scripts/main.js: canvas-only Graphics particles and an Options slider; no data/rules hooks.
// The exact code hash is intentional. A new script requires another review, even in an Official listing.
const WAND_SCRIPT_SHA256 = "b164d15784b40d8469d46be6bdd474a822e15a054141dcdea0c9c88484f13f87";
export function reviewedPvpMod(pkg: CodeModPackage): PvpModSupport | undefined {
  const manifest = pkg.manifest;
  if (manifest.id !== WAND_ID || manifest.entry !== "scripts/main.js" || !["1.1.1", "1.1.2"].includes(manifest.version)) return undefined;
  if (pkg.files.size !== 2 || !pkg.files.has("manifest.json") || !pkg.files.has("scripts/main.js") || Object.keys(manifest.dependencies).length !== 0) return undefined;
  // LF normalization permits a Git checkout's CRLF conversion, without relaxing script content.
  const script = new TextDecoder("utf-8", { fatal: true }).decode(pkg.files.get("scripts/main.js")!).replaceAll("\r\n", "\n");
  const hash = createHash("sha256").update(script).digest("hex");
  if (hash !== WAND_SCRIPT_SHA256) return undefined;
  return { id: manifest.id, version: manifest.version, digest: pkg.digest, support: { kind: "presentation" } };
}

/** Only locally installed release bytes may acquire a review descriptor. Nothing is executed. */
export async function installedPvpMods(listings: readonly OfficialMod[]): Promise<PvpModSupport[]> {
  const supports: PvpModSupport[] = [];
  for (const listing of listings) {
    if (listing.view.modId !== WAND_ID) continue;
    for (const [digest, path] of listing.releaseFiles) {
      const pkg = await importCodeModArchive(await readFile(path), path);
      if (pkg.digest !== digest) throw new Error("Official mod bytes changed while configuring PvP");
      const reviewed = reviewedPvpMod(pkg); if (reviewed) supports.push(reviewed);
    }
  }
  return supports;
}
