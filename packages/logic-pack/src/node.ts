import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  compileLogicPackIdentityV1,
  isMechanicalLogicPath,
  type LogicPackIdentityV1,
  type LogicPackResourceSource,
  type ReadonlyLogicValue,
} from "./index.js";

/**
 * Operator-side identity compiler for Tier-A extracted JSON. It reads only reviewed mechanical
 * families, explicitly excludes AirshipConfig/secrets and media, and never serves these bytes from
 * a player endpoint.
 */
export async function compileExtractedLogicPackIdentityV1(
  extractedDataDirectory: string,
): Promise<LogicPackIdentityV1> {
  const root = resolve(extractedDataDirectory);
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
    .map((entry) => `${entry.name.slice(0, -".json".length)}.plist`)
    .filter(isMechanicalLogicPath);
  const source: LogicPackResourceSource = {
    list: () => files,
    read: (plistPath) => {
      const jsonPath = resolve(root, `${plistPath.slice(0, -".plist".length)}.json`);
      return JSON.parse(readFileSync(jsonPath, "utf8")) as ReadonlyLogicValue;
    },
  };
  return compileLogicPackIdentityV1(source, async (bytes) =>
    new Uint8Array(createHash("sha256").update(bytes).digest()));
}
