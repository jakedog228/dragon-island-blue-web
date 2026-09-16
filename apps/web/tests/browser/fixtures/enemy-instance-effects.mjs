// Opt-in: set these globals with page.addInitScript before navigation, then select the original
// archive and launch standalone combat. Chromium must use --mute-audio. No browser is run here.
// Each first enemy turn uses usable4: LightDragon MetalSlash => MetalCut;
// FireDragon ManEater => DoubleBlackHardClaw. Neither should display usable1's BlueHardClaw.
export const enemyInstanceEffectFixtures = Object.fromEntries(["LightDragon", "FireDragon"].map(shortType => [shortType, {
  seed: 4,
  encounter: {
    backgroundKey: "ForestCombat",
    playerTeam: [{ shortType: "SnowCub", level: 150, flatStatBonuses: { MaxHP: 500000 } }],
    enemyTeam: [{ shortType, level: 150, flatStatBonuses: { Speed: 10000 } }],
  },
}]));
export function installEnemyInstanceFixture(fixture) {
  window.advanceTime = () => Promise.resolve();
  window.__DIB_TEST_BATTLE_SEED__ = fixture.seed;
  window.__DIB_TEST_ENCOUNTER__ = fixture.encounter;
}
