import type { TeamMemberSetup } from "@dib/engine";
import type { ChatDefinition } from "@dib/gamedata";
import { combatBackgroundSpriteKey } from "../displayMode.js";

/** Battle-only presentation overrides accepted by source fixed encounters through
 * `extraLivingArguments`. The engine ignores these fields; BattleRoster retains them so every
 * display surface can use the authored per-instance name/renderer without mutating GameData. */
export interface BattleTeamMemberSetup extends TeamMemberSetup {
  /** Original archive species when `shortType` is a transient scenario-only mechanical alias.
   * Capture, quest, collection, and post-battle progression must never leak the alias. */
  originalShortType?: string;
  displayName?: string;
  rendererData?: unknown;
}

export function battleOriginalShortType(
  setup: Pick<BattleTeamMemberSetup, "shortType" | "originalShortType">,
): string {
  return setup.originalShortType ?? setup.shortType;
}

/** `-[BattleNode onEnterTransitionDidFinish]`: a nonnil `Battle.breeder` uses
 * BossBattle1..5; the independent `Living.boss` status-immunity flag does not select music.
 * `breederXpBonus` is present exactly when the encounter constructed a breeder, including the
 * source default of 1.0 when its dictionary omits `xpBonus`. */
export function battleMusicRole(
  breederXpBonus: EncounterConfig["breederXpBonus"],
): { readonly category: "Battle" | "BossBattle"; readonly trackCount: 7 | 5 } {
  return breederXpBonus !== undefined
    ? Object.freeze({ category: "BossBattle", trackCount: 5 })
    : Object.freeze({ category: "Battle", trackCount: 7 });
}

/** Field-sprite asset key after applying a fixed encounter's per-instance renderer override.
 * Native `extraLivingArguments.rendererData.spriteFile` replaces the Monster renderer file for
 * that living only; keeping this helper at the battle boundary lets both preload and rendering use
 * the same resolution rule. */
export function battleSpriteKey(
  setup: Pick<BattleTeamMemberSetup, "shortType" | "rendererData">,
): string {
  if (setup.rendererData !== null && typeof setup.rendererData === "object") {
    const spriteFile = (setup.rendererData as Record<string, unknown>)["spriteFile"];
    if (typeof spriteFile === "string" && /\.png$/i.test(spriteFile)) {
      return `${spriteFile.slice(0, -4)}-hd`;
    }
  }
  return `${setup.shortType}-hd`;
}

/** Portrait atlases remain keyed by the renderable monster type even when a fixed encounter
 * supplies a different Living name or an internal mechanical alias. Native rendererData's
 * spriteFile is the authoritative presentation identity for that instance. */
export function battlePortraitFrame(
  setup: Pick<BattleTeamMemberSetup, "shortType" | "rendererData">,
): string {
  if (setup.rendererData !== null && typeof setup.rendererData === "object") {
    const spriteFile = (setup.rendererData as Record<string, unknown>)["spriteFile"];
    if (typeof spriteFile === "string" && /\.png$/i.test(spriteFile)) {
      const fileName = spriteFile.split(/[\\/]/).at(-1)!;
      return `${fileName.slice(0, -4)}_icon.png`;
    }
  }
  return `${setup.shortType}_icon.png`;
}

/** Data required to construct one battle. Later encounter/map loading should build this shape
 * without coupling the reusable battle scene to the demo configuration module. */
export interface EncounterConfig {
  /** `encounter.combatBackground` (battle-node.md §2), resolved to an AssetLibrary sprite key. */
  backgroundKey: string;


  allowRetreat?: boolean;
  /** Native Encounter.blockSaveMe. The demo sets this because it has no durable town/save state
   * from which the paid restart branch could restore and replay an encounter. */
  blockSaveMe?: boolean;
  /** Native Battle.blockCapture. DungeonEncounter enables it only for the Volcano/VolcanoB
   * instances that the shipped localization presents as The Abyss. */
  blockCapture?: boolean;
  /** `battle.breeder.xpBonus`, multiplied into aggregate defeated-enemy XP before the final
   * participant division. Present exactly when the battle has a breeder; an authored breeder
   * without `xpBonus` carries the source default 1.0. Omitted models `battle.breeder == nil`. */
  breederXpBonus?: number;
  questKey?: string;
  uniqueKey?: string;
  /** Source ChatGameFlowEvent gates: start finishes before the first battle step; win finishes
   * before the encounter returns to its owning world/dungeon scene. */
  startChat?: ChatDefinition;
  winChat?: ChatDefinition;
  difficultyModifier?: number;
  playerTeam: BattleTeamMemberSetup[];
  enemyTeam: BattleTeamMemberSetup[];
}

/** Internal background for standalone demo fixtures; world encounters use their authored data. */
export const DEMO_ENCOUNTER_BACKGROUND_KEY = combatBackgroundSpriteKey("ForestCombat.png");

/** Feature-exercise rolls used only by randomized standalone demo encounters. */
export const DEMO_FEATURE_ROLLS = {
  bossChance: 1 / 9,
  soulStoneChance: 1 / 4,
};

/** Temporary boot encounter. Production encounter data will replace this at the app boundary. */
export const DEMO_ENCOUNTER: EncounterConfig = {
  backgroundKey: DEMO_ENCOUNTER_BACKGROUND_KEY,
  blockSaveMe: true,
  playerTeam: [
    // KemetGod in slot 1 for testing: 6 jobAbilities (4 usables + Pharao'sCurse + Immunity) —
    // exercises the info card's passive rows and the overflow scroll path.
    { shortType: "KemetGod", level: 12 },
    { shortType: "SnowCub", level: 12 },
    { shortType: "WhiteDragonling", level: 12 },
    // `Team.fightingGroupSize == 3`: entries 4-6 begin in replacementMembers and fill the
    // active row from the front of this bench as allies fall.
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
