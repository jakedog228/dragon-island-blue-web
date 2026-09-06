import {
  compileLogicPackIdentityV1,
  type LogicPackIdentityV1,
  type ReadonlyLogicValue,
} from "@dib/logic-pack";
import type { ImportedContentPackage } from "./archivePackage.js";

/**
 * Computes the same asset-free rules identity as the operator compiler. Only the ID crosses the
 * authoritative session boundary; selected or client-cached archive bytes stay on the device.
 */
export function identifyContentLogicPack(
  content: ImportedContentPackage,
): Promise<LogicPackIdentityV1> {
  return compileLogicPackIdentityV1({
    list: () => content.resources.list(),
    read: (path) => content.resources.plist(path) as ReadonlyLogicValue,
  }, async (bytes) => {
    const input = new Uint8Array(bytes.byteLength);
    input.set(bytes);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
  });
}
