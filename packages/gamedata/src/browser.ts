// Browser-safe entry ("@dib/gamedata/browser"): everything EXCEPT the node:fs-backed loading
// modules (rawLoad.ts / dataDir.ts / loadNode.ts). Vite externalizes node:* imports with a
// throwing shim, so the browser must never evaluate those modules.
export { buildMonsterBookIndex, GameData } from "./gameData.js";
export type { MonsterBookEntry } from "./gameData.js";
export type { RawNode } from "./rawLoad.js";
export type * from "./types.js";
export * from "./world.js";
export * from "./quests.js";
export * from "./chats.js";
export * from "./tutorials.js";
export * from "./collection.js";

export * from "./dungeon.js";
