import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const corpusTests = [
  "tests/abilityAnimationCensus.test.ts",
  "tests/abilityInfo.test.ts",
  "tests/abilityRendererDispatch.test.ts",
  "tests/blackMarketNotReadyPopup.test.ts",
  "tests/characterProgressionModel.test.ts",
  "tests/dungeonCorpus.test.ts",
  "tests/fullRosterBattles.test.ts",
  "tests/guildQuestConditions.test.ts",
  "tests/guildQuestText.test.ts",
  "tests/levelUpText.test.ts",
  "tests/licenseDialogRepair.test.ts",
  "tests/loadGame.test.ts",
  "tests/localBattleSession.test.ts",
  "tests/localDungeonTerminal.test.ts",
  "tests/localization.test.ts",
  "tests/moddedContent.test.ts",
  "tests/monsterpediaModel.test.ts",
  "tests/nativeSave.test.ts",
  "tests/officialBattlePresentation.test.ts",
  "tests/officialProjectionAdoption.test.ts",
  "tests/piratePanicDancerMod.test.ts",
  "tests/playerBattleBonuses.test.ts",
  "tests/playerRuntimeState.test.ts",
  "tests/popupMenuOutline.test.ts",
  "tests/preloadPlan.test.ts",
  "tests/realtimeCombatMod.test.ts",
  "tests/replayBattleTutorial.test.ts",
  "tests/rosterSampler.test.ts",
  "tests/spiritMenu.test.ts",
  "tests/storeModel.test.ts",
  "tests/worldDemoState.test.ts",
  "tests/worldMenu.test.ts"
];
const hasCorpus = existsSync(resolve(import.meta.dirname, "../../extracted/data/Monsters.json"));
if (!hasCorpus) console.info(`${corpusTests.length} content-dependent test files require locally extracted game data.`);
export default defineConfig({ test: {
  maxWorkers: 4, minWorkers: 1,
  include: ["tests/**/*.test.ts"],
  exclude: hasCorpus ? [] : corpusTests,
  passWithNoTests: true,
} });
