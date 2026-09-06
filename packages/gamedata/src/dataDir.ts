import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function resolveDataDir(explicit?: string): string {
  const dir = resolve(
    explicit ?? process.env["DIB_DATA"] ?? resolve(import.meta.dirname, "../../../extracted/data"),
  );
  if (!existsSync(resolve(dir, "Monsters.json"))) {
    throw new Error(
      `DIB data dir missing Monsters.json: ${dir} — run the extraction pipeline (cd tools && python -m dib_extract all) or set DIB_DATA`,
    );
  }
  return dir;
}
