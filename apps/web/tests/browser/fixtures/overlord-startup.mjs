// Opt-in startup fixtures; no browser is launched by importing this file.
// Before navigation: await page.addInitScript((encounter) => {
//   window.advanceTime = () => Promise.resolve();
//   window.__DIB_TEST_ENCOUNTER__ = encounter;
// }, overlordStartupEncounters.Arkanis); repeat for Quetzalcoatl.
// Select the original archive and start combat. Expected: special boss field art, species
// portrait in the turn queue, then awaitingPlayerChoice with usable moves and no missing-frame
// error. The durable FireCub is a diagnostic party, not a reconstruction of the player's save.
const playerTeam = [{ shortType: "FireCub", level: 99, flatStatBonuses: { MaxHP: 500000 } }];

export const overlordStartupEncounters = {
  Arkanis: {
    backgroundKey: "MountainCombat",
    breederXpBonus: 1,
    playerTeam,
    enemyTeam: [{
      shortType: "FireDragon", level: 96, boss: true, displayName: "Arkanis",
      flatStatBonuses: { MaxHP: 40000, Speed: 150 },
      rendererData: { class: "CCSprite", spriteFile: "MegaDragon.png" },
    }],
  },
  Quetzalcoatl: {
    backgroundKey: "ForestCombat",
    breederXpBonus: 1,
    playerTeam,
    enemyTeam: [{
      shortType: "LightDragon", level: 75, boss: true, displayName: "Quetzalcoatl",
      flatStatBonuses: { MaxHP: 30000, Speed: 150 },
      rendererData: { class: "CCSprite", spriteFile: "GreenDragon.png" },
    }],
  },
};
