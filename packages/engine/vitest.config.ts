import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const corpusTests = [
  "tests/ability.test.ts",
  "tests/abilityArgs.test.ts",
  "tests/ai.test.ts",
  "tests/authoredBuffs.test.ts",
  "tests/battle.test.ts",
  "tests/breederStatBonus.test.ts",
  "tests/buff.test.ts",
  "tests/capture.test.ts",
  "tests/components.test.ts",
  "tests/eggHatch.test.ts",
  "tests/eggSourceRng.test.ts",
  "tests/identity.test.ts",
  "tests/licenseChallenge.test.ts",
  "tests/quests.test.ts",
  "tests/replay.test.ts",
  "tests/session.test.ts",
  "tests/slice.test.ts",
  "tests/soulStone.test.ts",
  "tests/sourceConditions.test.ts",
  "tests/spirit.test.ts",
  "tests/stats.test.ts",
  "tests/taunt.test.ts",
  "tests/tournament.test.ts",
  "tests/worldTripParty.test.ts"
];
const hasCorpus = existsSync(resolve(import.meta.dirname, "../../extracted/data/Monsters.json"));
if (!hasCorpus) console.info(`${corpusTests.length} content-dependent test files require locally extracted game data.`);
export default defineConfig({ test: {
  maxWorkers: 4, minWorkers: 1,
  include: ["tests/**/*.test.ts"],
  exclude: hasCorpus ? [] : corpusTests,
  passWithNoTests: true,
} });
