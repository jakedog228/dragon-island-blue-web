import type { ImportedContentPackage } from "./archivePackage.js";
import { hasImportedModProfile } from "./moddedContent.js";
import type { OnlineServerStatus } from "../authority/serverAvailability.js";

export const ONLINE_MODS_SELECTED_MESSAGE =
  "Online is unavailable while Offline mods are selected.";
export const ONLINE_MODS_ACTIVATED_MESSAGE =
  "Online is unavailable because Offline mod code ran in this tab. Refresh the page to use Online.";

export interface OnlinePlayAvailabilityInput {
  readonly selectedModCount: number;
  readonly modCodeWasActivated: boolean;
  readonly serverStatus?: OnlineServerStatus;
}

export type OnlinePlayAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/**
 * Full-trust Offline mods share the application realm. A selected package blocks Online, and once
 * package code has executed the tab remains untrusted even if the picker is later cleared.
 */
export function onlinePlayAvailability(
  input: OnlinePlayAvailabilityInput,
): OnlinePlayAvailability {
  if (input.selectedModCount > 0) {
    return { available: false, reason: ONLINE_MODS_SELECTED_MESSAGE };
  }
  if (input.modCodeWasActivated) {
    return { available: false, reason: ONLINE_MODS_ACTIVATED_MESSAGE };
  }
  if (input.serverStatus === "checking") {
    return { available: false, reason: "Checking Online availability… Offline is ready to use." };
  }
  if (input.serverStatus === "unavailable") {
    return { available: false, reason: "Online server unavailable. Use Offline, or refresh after the server is started." };
  }
  return { available: true };
}

export function assertOnlinePlayAvailable(input: OnlinePlayAvailabilityInput): void {
  const availability = onlinePlayAvailability(input);
  if (!availability.available) throw new Error(availability.reason);
}

/**
 * Final boot-boundary backstop. UI state is not authority: no caller, test fixture, or future
 * launch path may attach an Official store to content carrying an activated Offline mod profile.
 */
export function assertOfficialContentBoundary(input: {
  readonly content: ImportedContentPackage;
  readonly official?: unknown;
}): void {
  if (input.official !== undefined && hasImportedModProfile(input.content)) {
    throw new Error("Online cannot start with an activated Offline mod profile.");
  }
}
