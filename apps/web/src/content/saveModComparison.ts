import type { PlayProfileModRef } from "./playProfiles.js";

/** Effective data can change harmlessly when neutral mods (e.g. encounter weights) change.
 * Keep the pre-mod archive identity separately so that promise never masks an archive change. */
export function saveContentChanged(
  previous: { readonly lastContent: string | null; readonly lastBaseContent?: string | null;
    readonly lastMods: readonly PlayProfileModRef[] | null },
  selected: readonly PlayProfileModRef[],
  content: string,
  baseContent?: string,
): boolean {
  if (previous.lastContent === content) return false;
  const before = previous.lastMods;
  const previousBase = previous.lastBaseContent ?? (before?.length === 0 ? previous.lastContent : undefined);
  const currentBase = baseContent ?? (selected.length === 0 ? content : undefined);
  if (!previousBase || !currentBase || previousBase !== currentBase || before === null) return true;
  // Same packages with different output may reflect a configuration/engine change, not a
  // neutral selection change. Leave that warning intact. Unknown/dependent history stays strict.
  const selectionChanged = before.length !== selected.length ||
    before.some((mod, index) => mod.id !== selected[index]?.id || mod.digest !== selected[index]?.digest);
  return !selectionChanged || compareSaveMods(before, selected, false).kind !== "same";
}

export interface SaveModComparison {
  readonly kind: "unknown" | "mods" | "content" | "same";
  readonly label: string;
  readonly description: string;
  readonly added: number;
  readonly removed: number;
  readonly updated: number;
  readonly reordered: boolean;
}

/** Keep the collapsed row bounded regardless of mod count or author-supplied names. */
export function compareSaveMods(
  previous: readonly PlayProfileModRef[] | null,
  selected: readonly PlayProfileModRef[],
  contentChanged: boolean,
): SaveModComparison {
  if (previous === null) return {
    added: 0, removed: 0, updated: 0, reordered: false,
    kind: "unknown", label: "Previous mods unknown",
    description: "This save has no recorded mod list. Check your selection before playing.",
  };
  const totalSelected = selected.length;
  const hasNeutral = [...previous, ...selected].some(mod => mod.saveCompatibility === "neutral");
  // Filter each historical release independently: a new neutral release must never erase a
  // previous dependent release's requirements (or infer them from its ID/name).
  previous = previous.filter(mod => mod.saveCompatibility !== "neutral");
  selected = selected.filter(mod => mod.saveCompatibility !== "neutral");
  const currentById = new Map(selected.map(mod => [mod.id, mod]));
  const beforeById = new Map(previous.map(mod => [mod.id, mod]));
  const added = selected.filter(mod => !beforeById.has(mod.id)).length;
  const removed = previous.filter(mod => !currentById.has(mod.id)).length;
  const updated = previous.filter(mod => {
    const next = currentById.get(mod.id);
    return next !== undefined && next.digest !== mod.digest;
  }).length;
  const beforeOrder = previous.filter(mod => currentById.has(mod.id)).map(mod => mod.id);
  const afterOrder = selected.filter(mod => beforeById.has(mod.id)).map(mod => mod.id);
  const reordered = beforeOrder.some((id, i) => id !== afterOrder[i]);
  const changes = { added, removed, updated, reordered };
  if (added || removed || updated || reordered) return {
    ...changes, kind: "mods", label: "Mod setup changed",
    description: [added && `${added} added`, removed && `${removed} removed`,
      updated && `${updated} updated`, reordered && "Order changed",
      contentChanged && "Game content changed"].filter(Boolean).join(" · "),
  };
  if (contentChanged) return {
    ...changes, kind: "content", label: "Game content changed",
    description: "The selected game data differs from the last recorded setup.",
  };
  return { ...changes, kind: "same",
    label: hasNeutral ? "Save-compatible setup" : totalSelected === 0 ? "No mods" : `${totalSelected} ${totalSelected === 1 ? "mod" : "mods"}`,
    description: hasNeutral
      ? "Save-dependent mods match. Author-declared save-neutral mods do not require a matching save setup."
      : "Matches your current selection.",
  };
}

/** The manager owns the full names; the gate needs a bounded preview even for long mod lists. */
export function compactModNames(names: readonly string[]): string {
  const preview = names.slice(0, 2).map(name => name.length > 40 ? `${name.slice(0, 39)}…` : name);
  if (names.length > 2) preview.push(`+${names.length - 2} more`);
  return preview.join(", ");
}
