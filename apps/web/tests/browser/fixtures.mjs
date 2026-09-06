


export const STANDARD_BATTLE = {
  backgroundKey: "ForestCombat",
  blockSaveMe: true,
  playerTeam: [
    // KemetGod: 6 jobAbilities (4 usable + Pharao'sCurse + Immunity) — exercises the info card's
    // passive rows and the overflow scroll path.
    { shortType: "KemetGod", level: 12 },
    { shortType: "SnowCub", level: 12 },
    { shortType: "WhiteDragonling", level: 12 },
    // `Team.fightingGroupSize == 3`: entries 4-6 start on the bench and fill the active row as
    // allies fall.
    { shortType: "Penguin", level: 12 },
    { shortType: "Fairy", level: 12 },
    { shortType: "Kingpen", level: 12 },
  ],
  enemyTeam: [
    { shortType: "Minotaur", level: 12 },
    { shortType: "Spark", level: 12 },
    { shortType: "UnhappyBird", level: 12 },
    { shortType: "FireCub", level: 12 },
    { shortType: "SnowCub", level: 12 },
    { shortType: "WhiteDragonling", level: 12 },
  ],
};

/** Installs a fixed roster before app code runs. Call before `page.goto`. */
export async function pinEncounter(page, encounter = STANDARD_BATTLE) {
  await page.addInitScript((config) => {
    window.__DIB_TEST_ENCOUNTER__ = config;
  }, encounter);
}

/**
 * Pins the standalone PlayerCollection seam for a browser scenario.
 *
 * Pass `false` in any scenario that asserts on first-capture state. Scenarios that depend on
 * either answer must say which they mean.
 */
export async function pinAllUnlocked(page, unlocked) {
  await page.addInitScript((value) => {
    window.__DIB_TEST_ALL_UNLOCKED__ = value;
  }, unlocked);
}
