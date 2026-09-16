import type { DungeonResourceSource } from "@dib/gamedata";

/** Retain encounter mechanics and names, but never persist archive renderer dictionaries. */
export function withoutEncounterRenderers<T>(value: T): T {
  function visit(node: unknown, livingArguments = false): unknown {
    if (Array.isArray(node)) return node.map((child) => visit(child));
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node)
      .filter(([key]) => !(livingArguments && key === "rendererData"))
      .map(([key, child]) => [key, visit(child, key === "extraLivingArguments")]));
  }
  return visit(value) as T;
}

/** Structural world/dungeon render metadata is still needed by the shared importers. */
export function officialEncounterResources<T extends DungeonResourceSource>(source: T): T {
  return { ...source, plist: (path: string) => withoutEncounterRenderers(source.plist(path)) };
}
