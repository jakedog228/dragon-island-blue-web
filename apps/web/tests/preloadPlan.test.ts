import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GameData, loadGameData, resolveDataDir } from "@dib/gamedata";
import type { AnimationsData } from "@dib/renderer/animations";
import { computePreloadPlan, sfxForTier, soundTableForUse } from "../src/battle/preloadPlan.js";
import type { MeleeAttacksData } from "../src/battle/abilityRendererMath.js";

const gd = loadGameData();
const anims = JSON.parse(
  readFileSync(join(resolveDataDir(undefined), "Animations.json"), "utf-8"),
) as AnimationsData;
const meleeAttacks = JSON.parse(
  readFileSync(join(resolveDataDir(undefined), "MeleeAttacks.json"), "utf-8"),
) as MeleeAttacksData;

// A fixed six-monster kit fixture, NOT the demo roster: the real page load samples a random 9v9
// from the whole roster (`RANDOM_TEAM_SIZE = 9`, battle/rosterSampler.ts). Kept as a stable
// hand-checked set — these six between them exercise every effect/melee branch of the planner.
describe("computePreloadPlan (fixed six-monster kit fixture)", () => {
  // These kits reach MeleeAttacks via the stamped-attackType path (`attackTypeForUse` — no
  // literal `meleeType` eventData key exists anywhere in Abilities.json, grep-confirmed): every
  // plain-attack instance declares a `commonComponentArguments.attackType` — Claw/Outrage ->
  // BlueHardClaw (frameSlide: FXSheet + Slash7), Tail/Assault/D.Assault -> Impact (animation
  // Impact + SmallImpact), EggBomb -> TripleImpact (THit5), Detonate -> GammaBurstNew (Andromeda).
  const plan = computePreloadPlan(gd, anims, meleeAttacks, [
    "FireCub", "SnowCub", "WhiteDragonling", "Minotaur", "Spark", "UnhappyBird",
  ]);
  it("collects exactly the effect spritesheets the kits reach (tier-resolved, -hd suffixed, deduped)", () => {



    expect([...plan.atlases].sort()).toEqual([
      "FXSheet-hd",
      "Flame-hd",
      "GammaBurstNew-hd",
      "Hail-hd",
      "Impact-hd",
      "SonicBlast-hd",
      "SparkAnimation-hd",
      "Thunderbolt-hd",
      "TripleImpact-hd",
    ]);
  });
  it("collects exactly the tier-matched sfx (soundTable + melee soundFile paths)", () => {
    expect([...plan.sfx].sort()).toEqual([
      "Andromeda.m4a",
      "Flame.m4a",
      "Hail.m4a",
      "HighVoltage.m4a",
      "Slash7.m4a",
      "SmallImpact.m4a",
      "SonicBlast.m4a",
      "Spark.m4a",
      "THit5.m4a",
    ]);
  });
});





describe("soundTableForUse — job-ref arguments override the ability dictionary's table", () => {
  it("DeathCrawler's BlackHole (usable3, tier {6}) uses its OWN slot table, unmerged with the parent's", () => {
    const table = soundTableForUse(gd, "DeathCrawler", {
      slot: "usable3",
      abilityPath: "Offensive.Stun.StunMagicAttackAll",
    });






    expect(table).toEqual({ "7": "GammaBurst.m4a" });
    expect(sfxForTier(table, 6)).toBe("GammaBurst.m4a");
  });

  it("Thought's BlackHole (parent RootJob, no slot to leak) matches DeathCrawler's — merge control", () => {
    // Same authored instance under a parent with no competing slot: this case was already
    // correct under deep-merge, so it pins that the slot-replace fix changed nothing here.
    const table = soundTableForUse(gd, "Thought", {
      slot: "usable4",
      abilityPath: "Offensive.Stun.StunMagicAttackAll",
    });
    expect(table).toEqual({ "7": "GammaBurst.m4a" });
    expect(sfxForTier(table, 6)).toBe("GammaBurst.m4a");
  });

  it("ThunderWolf's Howl (Offensive.Stun.Stun) plays Howl.m4a, not the dictionary's Glacier.m4a", () => {
    const table = soundTableForUse(gd, "ThunderWolf", { abilityPath: "Offensive.Stun.Stun" });
    expect(sfxForTier(table, 3)).toBe("Howl.m4a");
  });

  it("falls back to the ability dictionary's table when the job ref declares none", () => {
    // FireCub's Fireball (Offensive.Fire.Fire) has no arguments.soundTable.
    const table = soundTableForUse(gd, "FireCub", { abilityPath: "Offensive.Fire.Fire" });
    expect(sfxForTier(table, 4)).toBe("Flame.m4a");
  });






  it.each([
    ["RedBabyDragon", "Offensive.Fire.FireMother"],
    ["BlueBabyDragon", "Offensive.Water.WaterMother"],
    ["GoldBabyDragon", "Offensive.Earth.EarthMother"],
    ["WhiteBabyDragon", "Offensive.Air.AirMother"],
  ])("%s's Mother (usable2, tier {7}) plays DistressCall.m4a, not its element's nuke sound", (
    shortType,
    abilityPath,
  ) => {
    const table = soundTableForUse(gd, shortType, { slot: "usable2", abilityPath });
    // The job ref declares no arguments.soundTable, so this is the ability dictionary's own.
    expect(table).toEqual({ "1": "DistressCall.m4a" });
    // Tier 7 with a leaked parent table picked its highest key <= 7 instead — for Fire that was
    // key 6, Flare.m4a (the reported wrong sound).
    expect(sfxForTier(table, 7)).toBe("DistressCall.m4a");
  });

  it("a re-authored nuke soundTable drops the parent's tiers (FireAll keeps 3/4/6, not 2/5)", () => {
    const table = soundTableForUse(gd, "FireCub", { abilityPath: "Offensive.Fire.FireAll" });
    expect(table).toEqual({ "3": "Pyre.m4a", "4": "FireStorm.m4a", "6": "Flare.m4a" });
    // Under the deep merge these two tiers resolved to the parent Fire's Ignite/Explosion.
    expect(sfxForTier(table, 2)).toBe("Pyre.m4a"); // no key <= 2 -> lowest authored
    expect(sfxForTier(table, 5)).toBe("FireStorm.m4a");
  });

  it("the preload plan carries the override file (DeathCrawler -> GammaBurst.m4a, no Glacier/Sentence)", () => {
    const plan = computePreloadPlan(gd, anims, meleeAttacks, ["DeathCrawler"]);
    expect(plan.sfx).toContain("GammaBurst.m4a");
    expect(plan.sfx).not.toContain("Glacier.m4a");
    expect(plan.sfx).not.toContain("Sentence.m4a");
  });
});





describe("computePreloadPlan — meleeType extension (synthetic kit, real MeleeAttacks.json)", () => {
  it('preloads the meleeType entry\'s animation spritesheet + soundFile ("AirSlam" -> Hit3.m4a)', () => {
    // extracted/data/MeleeAttacks.json's real "AirSlam" entry (effects-info.md §6):
    // {effectData: {animationName: "AirSlam"}, soundFile: "Hit3.m4a", type: "animation"} -- and
    // Animations.json's real "AirSlam" tier "1" entry resolves to spritesheets: ["AirSlam"].
    const synthetic = GameData.fromRaw({
      monsters: {},
      jobs: {
        Test: {
          MeleeMonster: {
            class: "Job",
            slots: [],
            xpPenalty: 0,
            jobAbilities: { usable1: { type: "Test.MeleeAttack" } },
          },
        },
      },
      abilities: {
        Test: {
          MeleeAttack: {
            class: "CombatAbility",
            activationLength: "{1}",
            eventData: { enemyTargetEventData: { meleeType: "AirSlam" } },
          },
        },
      },
      abilityComponents: {},
      buffs: {},
    });

    const plan = computePreloadPlan(synthetic, anims, meleeAttacks, ["MeleeMonster"]);
    expect(plan.atlases).toEqual(["AirSlam-hd"]);
    expect(plan.sfx).toEqual(["Hit3.m4a"]);
  });

  it("fails loudly for a meleeType key absent from MeleeAttacks.json", () => {
    const synthetic = GameData.fromRaw({
      monsters: {},
      jobs: {
        Test: {
          MeleeMonster: {
            class: "Job",
            slots: [],
            xpPenalty: 0,
            jobAbilities: { usable1: { type: "Test.MeleeAttack" } },
          },
        },
      },
      abilities: {
        Test: {
          MeleeAttack: {
            class: "CombatAbility",
            activationLength: "{1}",
            eventData: { enemyTargetEventData: { meleeType: "NoSuchAttack" } },
          },
        },
      },
      abilityComponents: {},
      buffs: {},
    });

    expect(() => computePreloadPlan(synthetic, anims, meleeAttacks, ["MeleeMonster"])).toThrow(
      /unknown melee attack type/,
    );
  });
});

describe("computePreloadPlan — point-particle builders", () => {
  it("preloads both target-local and whole-screen particle plist files", () => {
    const synthetic = GameData.fromRaw({
      monsters: {},
      jobs: {
        Test: {
          ParticleMonster: {
            class: "Job",
            slots: [],
            xpPenalty: 0,
            jobAbilities: { usable1: { type: "Test.Particles" } },
          },
        },
      },
      abilities: {
        Test: {
          Particles: {
            class: "CombatAbility",
            activationLength: "{1}",
            eventData: {
              sourceEventData: {
                effectBuilders: [{ class: "ParticleEffectBuilder", file: "Cast.plist" }],
                globalEffectBuilders: [{ class: "ParticleEffectBuilder", file: "FrostGlobal.plist" }],
              },
              enemyTargetEventData: {
                effectBuilders: [{ class: "ParticleEffectBuilder", file: "Frost.plist" }],
              },
            },
          },
        },
      },
      abilityComponents: {},
      buffs: {},
    });

    expect(computePreloadPlan(synthetic, anims, meleeAttacks, ["ParticleMonster"]).particles)
      .toEqual(["Cast.plist", "FrostGlobal.plist", "Frost.plist"]);
  });
});
