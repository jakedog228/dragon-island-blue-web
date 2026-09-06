import { z } from "zod";


export const ElementSchema = z.enum(["Air", "Arcane", "Death", "Earth", "Fire", "Life", "Water"]);
export const StatNameSchema = z.enum(["Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed"]);

// rootStats always carries exactly these six stats (verified: every one of the 224 monster
// leaves + the RootMonster base all declare all six) — a plain strict object, not z.record,
// so an accidentally-missing or misspelled stat throws instead of silently resolving undefined.
export const RootStatsSchema = z
  .object({
    Attack: z.number(),
    Defense: z.number(),
    Magic: z.number(),
    MaxHP: z.number(),
    Resist: z.number(),
    Speed: z.number(),
  })
  .strict();

// Resolved Monsters.json leaf (post inheritance-merge). Eight required fields (class is
// checked but not surfaced on MonsterDef — it's constant "Monster" on every node, inherited
// from RootMonster) + four optionals, matching the 9 distinct resolved-node keysets observed.
export const MonsterSchema = z
  .object({
    class: z.literal("Monster"),
    category: z.enum(["Collection", "Combine", "Egg", "Normal", "Summon"]),
    element: ElementSchema,
    index: z.number(),
    quality: z.number(),
    stars: z.number(),
    rootStats: RootStatsSchema,
    unarmedAttackType: z.string(),
    evolveData: z.object({ levelReq: z.number(), newType: z.string() }).strict().optional(),
    eggUnlockQuality: z.number().optional(),
    summonXpBonus: z.number().optional(),
    rendererData: z.unknown().optional(), // display-only passthrough (observed shape: {scale: number})
  })
  .strict();

// One `jobAbilities[slot]` entry, pre-merge into JobAbilityRef.
export const JobAbilityRefRawSchema = z
  .object({
    type: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),


    "New item": z.string().optional(),
  })
  .strict();

// Resolved Jobs.json leaf (post inheritance-merge). Every leaf resolves to exactly
// {class, slots, xpPenalty, jobAbilities} (+ the same stray "New item" artifact, observed once
// more at the job-node level on Jobs.Cat.SnowPanther).
export const JobLeafSchema = z
  .object({
    class: z.literal("Job"),
    slots: z.array(z.string()),
    xpPenalty: z.number(),
    jobAbilities: z.record(z.string(), JobAbilityRefRawSchema),
    "New item": z.string().optional(),
  })
  .strict();

// One `components[]` entry inside a resolved Ability node — points at an AbilityComponents.json
// path, with optional extra construction arguments (observed on Utility.StatMod / HasteMod /
// Offensive.Dice refs).
export const AbilityComponentRefSchema = z
  .object({
    type: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// Resolved Abilities.json leaf (post inheritance-merge). Vocabulary is the exact union of
// resolved-node keys across every ability reachable from Jobs.json's job abilities (96 distinct
// `type` values, the full-coverage test's real corpus): class/activationLength/components/
// targetPicker/aiChance are typed per the frozen AbilityDef; everything else
// (eventData/soundTable/abilityScalor/abstract/noHaste/enemyBuffs/sourceBuffs/passiveBuffs) is
// display/audio/buff data preserved opaque in `raw`, per the rendering-free convention.
export const AbilitySchema = z
  .object({
    class: z.string(),
    activationLength: z.string().optional(),
    components: z.array(AbilityComponentRefSchema).optional(),
    targetPicker: z.record(z.string(), z.unknown()).optional(),
    aiChance: z.number().optional(),
    eventData: z.unknown().optional(),
    soundTable: z.record(z.string(), z.string()).optional(),
    abilityScalor: z.number().optional(),
    abstract: z.boolean().optional(),
    noHaste: z.boolean().optional(),
    enemyBuffs: z.array(z.unknown()).optional(),
    sourceBuffs: z.array(z.unknown()).optional(),


    friendlyBuffs: z.array(z.unknown()).optional(),
    passiveBuffs: z.array(z.unknown()).optional(),
    revengeBuffs: z.array(z.unknown()).optional(),
  })
  .strict();

// Resolved AbilityComponents.json leaf: every one of the 26 components is {class} or
// {class, roll: {relatedStat}} — no `parent` key exists anywhere in AbilityComponents.json
// (verified: 0 occurrences), so components never inherit from each other.
export const AbilityComponentSchema = z
  .object({
    class: z.string(),
    roll: z.object({ relatedStat: z.string() }).strict().optional(),
  })
  .strict();


export const SoulStoneItemSchema = z
  .object({
    class: z.literal("SoulStone"),


    slot: z.literal("Monster"),
    stats: z.record(z.string(), z.boolean()),
  })
  .strict();

export const ItemSlotSchema = z.enum([
  "Novice", "Veteran", "Elite", "Grandmaster", "Monster", "Useable", "Other",
]);

/** Complete shipped `Items.plist` leaf vocabulary. Renderer dictionaries are presentation-only
 * and remain opaque; all mechanics-bearing fields are strict. */
export const ItemLeafSchema = z
  .object({
    class: z.enum([
      "Item", "Gem", "SoulStone", "Egg", "CustomEgg", "Gold", "Silver",
      "MonsterJoin", "Recipe", "SpiritTotem",
    ]),
    slot: ItemSlotSchema,
    abilities: z.array(z.string().min(1)).optional(),
    stats: z.record(z.string(), z.boolean()).optional(),
    holderBuffs: z.array(z.record(z.string(), z.unknown())).optional(),
    level: z.number().int().positive().optional(),
    repeats: z.boolean().optional(),
    onlyMonsters: z.boolean().optional(),
    rendererData: z.unknown().optional(),
  })
  .strict();

export const LicenseTypeSchema = z.enum([
  "Novice", "Apprentice", "Veteran", "Expert", "Elite", "Master", "Grandmaster",
]);

export const LicenseLeafSchema = z
  .object({
    heroLevelRequired: z.number().int().nonnegative(),
    completedQuestsRequired: z.number().int().nonnegative(),
    challengeLevel: z.number().int().positive(),
    battingOrderSize: z.number().int().positive(),
    gemSlots: z.number().int().min(0).max(4),
    monsterPopulator: z.record(z.string(), z.unknown()),
  })
  .strict();

export const TournamentSchema = z
  .object({
    name: z.string().min(1),
    subtitle: z.string(),
    challengeLevel: z.number().int().positive(),
    prizeImage: z.string().min(1),
    monsterPopulators: z.array(z.record(z.string(), z.unknown())).length(4),
    treasureData: z.record(z.string(), z.unknown()),
  })
  .strict();


export const BuffSchema = z
  .object({
    class: z.string(),
    statusEffects: z.record(z.string(), z.boolean()).optional(),
    fixedReflect: z.boolean().optional(),
    eventData: z.unknown().optional(),
  })
  .strict();
