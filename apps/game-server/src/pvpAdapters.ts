import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { validatePvpAdapters, type PvpBattleAdapter } from "@dib/engine";
import type { GameData } from "@dib/gamedata";
import type { PvpModSupport, PvpRulesProfile } from "./pvpCompatibility.js";

export interface InstalledPvpProfile extends PvpRulesProfile {
  readonly data: GameData;
  readonly adapters: readonly PvpBattleAdapter[];
}
export interface PvpAdapterInstallation {
  readonly profiles: readonly InstalledPvpProfile[];
  readonly mods: readonly PvpModSupport[];
}
export interface PvpAdapterModule {
  readonly apiVersion: "pvp-server-adapters-v1";
  install(context: { readonly data: GameData; readonly logicPackId: string }): PvpAdapterInstallation | Promise<PvpAdapterInstallation>;
}

export function validatePvpInstallation(installation: PvpAdapterInstallation): void {
  const ids = new Set<string>();
  for (const profile of installation.profiles) {
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(profile.id) || profile.id === "pvp-baseline-v1" || ids.has(profile.id)) {
      throw new Error(`Invalid or duplicate installed PvP profile ${profile.id}`);
    }
    if (!/^logic-v1:[a-f0-9]{64}$/.test(profile.logicPackId) || typeof profile.data?.monsterByShortType !== "function") {
      throw new Error(`Invalid PvP data profile ${profile.id}`);
    }
    validatePvpAdapters(profile.adapters);
    if (profile.rules.length !== profile.adapters.length || profile.rules.some((id, index) => id !== profile.adapters[index]?.rulesId)) {
      throw new Error(`PvP profile ${profile.id} must install exactly its declared adapter order`);
    }
    ids.add(profile.id);
  }
  for (const mod of installation.mods) {
    if (!/^[a-f0-9]{64}$/.test(mod.digest) || !mod.id || !mod.version) throw new Error("Invalid installed PvP mod identity");
    const support = mod.support;
    if (support.kind === "rules" && !installation.profiles.some((profile) => profile.rules.includes(support.rulesId))) {
      throw new Error(`No installed profile executes ${support.rulesId}`);
    }
  }
}

/** Only a configured local operator module is imported. No request, URL or uploaded mod selects it. */
export async function loadPvpAdapterInstallation(
  modulePath: string | undefined, context: { data: GameData; logicPackId: string },
): Promise<PvpAdapterInstallation> {
  if (!modulePath) return { profiles: [], mods: [] };
  const module = await import(pathToFileURL(resolve(modulePath)).href) as Partial<PvpAdapterModule>;
  if (module.apiVersion !== "pvp-server-adapters-v1" || typeof module.install !== "function") {
    throw new Error("PvP adapter module must export apiVersion pvp-server-adapters-v1 and install()");
  }
  const installation = await module.install(context);
  validatePvpInstallation(installation);
  return installation;
}
