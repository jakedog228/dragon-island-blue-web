import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const corpusTests = [
  "tests/fileSlotStore.test.ts",
  "tests/pvpAdapters.test.ts",
  "tests/pvpHttp.test.ts",
  "tests/pvpService.test.ts"
];
const hasCorpus = existsSync(resolve(import.meta.dirname, "../../extracted/data/Monsters.json"));
if (!hasCorpus) console.info(`${corpusTests.length} content-dependent test files require locally extracted game data.`);
export default defineConfig({ test: {
  maxWorkers: 4, minWorkers: 1,
  include: ["tests/**/*.test.ts"],
  exclude: hasCorpus ? [] : corpusTests,
  passWithNoTests: true,
} });
