import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

/** Hash final emitted bytes, including HTML after Vite's manifest/icon injection. */
export function offlineShell(): Plugin {
  return {
    name: "offline-engine-shell",
    apply: "build",
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        const entries = Object.values(bundle).map((file) => ({
          path: file.fileName,
          integrity: "sha256-" + createHash("sha256")
            .update(file.type === "chunk" ? file.code : file.source).digest("base64"),
        })).sort((a, b) => a.path.localeCompare(b.path));
        const template = await readFile(new URL("./offline-worker.js", import.meta.url), "utf8");
        const revision = createHash("sha256").update(template)
          .update(JSON.stringify(entries)).digest("hex").slice(0, 24);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: template.replace("__DIB_OFFLINE_CONFIG__", JSON.stringify({ revision, entries })),
        });
      },
    },
  };
}
