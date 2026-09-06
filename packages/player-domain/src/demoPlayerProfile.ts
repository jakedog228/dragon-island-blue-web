import type { PlayerProfileConfig } from "./playerProfile.js";


export const INTRO_TUTORIAL_FLAGS: readonly string[] = Object.freeze([
  "Tutorial0",
  "Tutorial1",
  "Tutorial2",
  "flashTownExit",
]);

/**
 * Temporary defaults for player state that does not yet come from new-game setup or a save.
 * Party levels are deliberately absent: boot derives those from the selected encounter, while
 * world play derives them from its authoritative WorldTripParty.
 */
export const DEMO_PLAYER_PROFILE_DEFAULTS: Omit<PlayerProfileConfig, "monsterPartyLevels"> = {
  heroLevel: 12,
  silver: 1000,
  gold: 200,
  captureCards: { 1: 1, 2: 0, 3: 0 },
  highestCapturedLevels: { Minotaur: 12, Spark: 12 },
  // `HeroData.energyPercent` stand-in. Start nearly charged so the Spirit flow is reachable.
  spiritReadiness: 0.9,
  // All twelve shipped Spirit.* monsters are unlocked. Values are demo grades, not combat levels:
  // 0=F-, 1=F, 2=F+, 3=E-, ... 17=A+, 18=S.
  spiritTierLevels: {
    Resistance: 2,
    Fire: 7,
    Fate: 0,
    Aggression: 13,
    Energy: 5,
    Karma: 9,
    Evil: 16,
    Fear: 4,
    Thought: 11,
    Divine: 15,
    Time: 18,
    Shenron: 17,
  },
  // Direct battle/world fixtures represent an already-established player. The real new-game
  // factory below intentionally starts with no flags so Plot/Town sequencing remains reachable.
  // Authored town `tutorialFlashKey`s are content-specific and are folded in at boot by
  // `establishedPlayerTutorialFlags`; see the note on that function.
  tutorialFlags: INTRO_TUTORIAL_FLAGS,
};


export function establishedPlayerTutorialFlags(
  townFlashKeys: Iterable<string>,
): readonly string[] {
  return Object.freeze([
    ...new Set([...INTRO_TUTORIAL_FLAGS, "TownWarpTutorial", ...townFlashKeys]),
  ].sort());
}


export function sourceNewGameProfileDefaults(
  starterShortType: string,
): Omit<PlayerProfileConfig, "monsterPartyLevels"> {
  return {
    heroLevel: 1,
    heroTotalHighestLevels: 1,
    silver: 1_000,
    gold: 100,
    captureCards: { 1: 2, 2: 0, 3: 0 },
    highestCapturedLevels: { [starterShortType]: 1 },
    spiritReadiness: 0,
    spiritTierLevels: {},
    tutorialFlags: [],
  };
}
