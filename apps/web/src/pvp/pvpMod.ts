import { OFFICIAL_PVP_MOD_ID } from "@dib/game-protocol";

/** Built into the signed-off engine shell; never an executable .dibmod trust exemption. */
export const PVP_MOD = Object.freeze({
  id: OFFICIAL_PVP_MOD_ID, name: "Multiplayer PvP", version: "1.0.0", author: "DIB Web",
  description: "Challenge another player from the Arena menu. Create an invite code or join theirs. Works with Offline and Official parties; an internet connection is required. Matches do not change your campaign save.",
});
export const PVP_MOD_STORAGE_KEY = "dib.mods.builtin.pvp.v1";
interface SelectionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
function browserStorage(): SelectionStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}
let volatileSelection: boolean | undefined;
const failedStores = new WeakSet<SelectionStorage>();
export function pvpModEnabled(storage = browserStorage()): boolean {
  if (storage === undefined || failedStores.has(storage)) return volatileSelection ?? false;
  try { return storage.getItem(PVP_MOD_STORAGE_KEY) === "enabled"; }
  catch { return volatileSelection ?? false; }
}
export function setPvpModEnabled(enabled: boolean, storage = browserStorage()): void {
  // Like other shell settings, blocked storage still permits this tab's selection.
  volatileSelection = enabled;
  try {
    storage?.setItem(PVP_MOD_STORAGE_KEY, enabled ? "enabled" : "disabled");
    if (storage) failedStores.delete(storage);
  } catch { if (storage) failedStores.add(storage); }
}
