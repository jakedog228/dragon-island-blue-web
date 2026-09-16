import type { GameData } from "@dib/gamedata/browser";
import { braceTier } from "@dib/engine";
import { resolveAnimation, type AnimationsData } from "@dib/renderer/animations";
import { resolveMeleeAttack, type MeleeAttacksData } from "./abilityRendererMath.js";

function recordOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function instanceForUse(gd: GameData, shortType: string, use: { slot?: string; abilityPath: string }) {
  const refs = gd.jobAbilitiesOrEmpty(shortType);
  if (use.slot !== undefined) {
    const ref = refs.find((candidate) => candidate.slot === use.slot);
    if (ref === undefined || ref.type !== use.abilityPath) {
      throw new Error(`Invalid ability instance ${shortType}.${use.slot}: ${use.abilityPath}`);
    }
    return ref;
  }
  const matches = refs.filter((ref) => ref.type === use.abilityPath);
  if (matches.length > 1) {
    throw new Error(`Ambiguous ability instance ${shortType}: ${use.abilityPath}; slot required`);
  }
  return matches[0];
}

/** The soundTable's tier rule mirrors pickTier: highest authored key <= tier, else lowest. */
export function sfxForTier(soundTable: Record<string, unknown>, tier: number | undefined): string | undefined {
  const keys = Object.keys(soundTable).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (keys.length === 0 || tier === undefined) return undefined;
  let best: number | undefined;
  for (const k of keys) if (k <= tier) best = k;
  const chosen = best ?? keys[0]!;
  const file = soundTable[String(chosen)];
  return typeof file === "string" ? file : undefined;
}








export function soundTableForUse(
  gd: GameData,
  shortType: string,
  use: { slot?: string; abilityPath: string },
): Record<string, unknown> {
  const ref = instanceForUse(gd, shortType, use);
  const argTable = ref?.arguments["soundTable"];
  return recordOf(argTable ?? gd.ability(use.abilityPath).raw["soundTable"]);
}













export function attackTypeForUse(
  gd: GameData,
  shortType: string,
  use: { slot?: string; abilityPath: string },
): string | undefined {
  const ref = instanceForUse(gd, shortType, use);
  if (!ref) return undefined;
  const common = recordOf(ref.arguments["commonComponentArguments"]);
  const attackType = common["attackType"];
  return typeof attackType === "string" ? attackType : undefined;
}

/** Everything the given monsters' usable kits can put on screen / on the speakers:
 *  effect-animation spritesheets (manifest names, "-hd" suffixed) + tier-matched sfx files, plus
 *  `MeleeAttacks.json` sheets/sounds reached BOTH via a literal `meleeType` eventData key (none
 *  in the real corpus) AND via each instance's stamped `attackType` (`attackTypeForUse` above —
 *  the path every plain attack actually takes; previously missing, which left basic attacks
 *  silent and invisible). frameSlide entries draw their frames from the FXSheet atlas
 *  (verified: all 18 frameSlide `spriteFrameName`s across MeleeAttacks.json live in FXSheet-hd). */
export function computePreloadPlan(
  gd: GameData,
  anims: AnimationsData,
  meleeAttacks: MeleeAttacksData,
  shortTypes: string[],
): { atlases: string[]; particles: string[]; sfx: string[] } {
  const atlases = new Set<string>();
  const particles = new Set<string>();
  const sfx = new Set<string>();
  for (const shortType of shortTypes) {
    for (const ref of gd.jobAbilitiesOrEmpty(shortType)) {
      if (!/^usable\d+$/.test(ref.slot)) continue;
      const ability = gd.ability(ref.type);
      if (ability.className !== "CombatAbility") continue;




      const tier = braceTier(ref.arguments["activationLength"] ?? ability.activationLength);

      const addMeleeAssets = (meleeKey: string): void => {
        const melee = resolveMeleeAttack(meleeAttacks, meleeKey);
        sfx.add(melee.soundFile);
        if (melee.type === "animation" && melee.effectData) {
          const { entry } = resolveAnimation(anims, melee.effectData.animationName, tier ?? 1);
          for (const sheet of entry.spritesheets) atlases.add(`${sheet}-hd`);
        } else if (melee.type === "frameSlide") {
          atlases.add("FXSheet-hd"); // all frameSlide frames live here (see fn doc)
        }
      };

      const eventData = recordOf(ability.raw["eventData"]);
      for (const phaseKey of ["sourceEventData", "friendlyTargetEventData", "enemyTargetEventData"]) {
        const phaseDict = recordOf(eventData[phaseKey]);
        for (const builderKey of ["effectBuilders", "globalEffectBuilders"] as const) {
          const builders = phaseDict[builderKey];
          if (!Array.isArray(builders)) continue;
          for (const b of builders) {
            const builder = recordOf(b);
            if (builder["class"] === "AnimationEffectBuilder") {
              const name = builder["animationName"];
              if (typeof name !== "string") throw new Error(`effectBuilder without animationName on ${ability.path}`);
              const { entry } = resolveAnimation(anims, name, tier ?? 1);
              for (const sheet of entry.spritesheets) atlases.add(`${sheet}-hd`);
            } else if (builder["class"] === "ParticleEffectBuilder") {
              const file = builder["file"];
              if (typeof file !== "string") throw new Error(`particle effectBuilder without file on ${ability.path}`);
              particles.add(file);
            }
          }
        }

        const meleeTypeKey = phaseDict["meleeType"];
        if (typeof meleeTypeKey === "string") addMeleeAssets(meleeTypeKey);
      }

      // The stamped attackType path (see attackTypeForUse) — how every plain attack reaches
      // MeleeAttacks; the whole reason Tail/Claw/Assault previously had no sound or animation.
      const attackType = attackTypeForUse(gd, shortType, { slot: ref.slot, abilityPath: ability.path });
      if (attackType !== undefined) addMeleeAssets(attackType);

      // Arguments-first, same rule as soundTableForUse (job-ref table replaces the dictionary's).
      const file = sfxForTier(recordOf(ref.arguments["soundTable"] ?? ability.raw["soundTable"]), tier);
      if (file !== undefined) sfx.add(file);
    }
  }
  return { atlases: [...atlases], particles: [...particles], sfx: [...sfx] };
}
