import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export { resolveDataDir } from "./dataDir.js";

export type RawNode = { [key: string]: unknown };

export function loadRawJson(dataDir: string, fileName: string): RawNode {
  const path = resolve(dataDir, fileName);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8")); // throws loudly on missing/corrupt
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${fileName}: expected a top-level object`);
  }
  return parsed as RawNode;
}

export function loadRawJsonValue(dataDir: string, fileName: string): unknown {
  const path = resolve(dataDir, fileName);
  return JSON.parse(readFileSync(path, "utf-8"));
}
