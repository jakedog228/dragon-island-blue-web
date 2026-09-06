import type { GameData, MonsterDef } from "@dib/gamedata";
import { dungeonRandomGemStats } from "./dungeon.js";
import type { Rng } from "./rng.js";
import type { GemReward, RewardGemSlot } from "./rewards.js";

const f = Math.fround;

/** Historical Official receipts retain their original draw sequence and arithmetic. */
export type EggRngRules = "source" | "legacy-v22";












export function goldEggMonsterLevel(benchLevels: readonly number[]): number {
  let highest = 1;
  let secondHighest = 1;
  for (const level of benchLevels) {
    if (level > highest) {
      secondHighest = highest;
      highest = level;
    } else if (level > secondHighest) {
      secondHighest = level;
    }
  }
  return secondHighest;
}

/** Source `DestroyOnPickup.Egg` and `DestroyOnPickup.MonsterEgg`, respectively. */
export type EggHatchKind = "silver" | "gold";

export type EggHatchPrize =
  | {
      readonly kind: "monster";
      readonly shortType: string;
      readonly level: number;
      readonly prizeMonster: boolean;
    }
  | { readonly kind: "gold"; readonly amount: number }
  | { readonly kind: "silver"; readonly amount: number }
  | GemReward
  | { readonly kind: "recipe"; readonly combineName: string }
  | { readonly kind: "spiritTotem"; readonly shortType: string }
  | { readonly kind: "item"; readonly definitionPath: string; readonly level: number };

export interface EggHatchPlayerView {
  /** Persistent `highestLevelMonsters`, not merely current ownership. */
  readonly highestRegisteredLevel: (shortType: string) => number;
  /** Maximum value in the complete persistent table, including non-Monster Living keys. */
  readonly highestRegisteredLivingLevel: number;







  readonly goldEggMonsterLevel: number;
  /** Slots 0..2 for which the current License returns true from `hasItemSlot:`. */
  readonly availableGemSlots: readonly RewardGemSlot[];
  readonly hasCombineRecipe: (shortType: string) => boolean;
  readonly spiritSavedXp: (shortType: string) => number;
}

export interface EggHatchPool {
  readonly kind: EggHatchKind;
  /** Provider construction order, before `NSMutableArray.randomizedArray`. */
  readonly providers: readonly EggHatchPrize[];
  /** Reel order after the source shuffle. */
  readonly reel: readonly EggHatchPrize[];
}

export const EGG_REEL_INITIAL_SPEED = f(8);
/** Fixed step used by the authoritative release adaptation; native updates use elapsed dt. */
export const EGG_REEL_FRAME_SECONDS = f(1 / 60);
export const EGG_REEL_MIN_RELEASE_SECONDS = f(1.5);
export const EGG_REEL_STOP_SPEED = f(-2);
// Raw literal 0x3f199999 and operation order at ccTouchEnded: @ 0xd308c..0xd30da.
const EGG_REEL_FRICTION_HALF = f(0.5999999642372131 * 0.5);
export const EGG_REEL_FRICTION_MIN = f(EGG_REEL_FRICTION_HALF * 9);
export const EGG_REEL_FRICTION_RANGE = f(EGG_REEL_FRICTION_HALF * 2);
/** Largest friction the draw can produce, i.e. the fastest possible stop. */
export const EGG_REEL_FRICTION_MAX = f(EGG_REEL_FRICTION_MIN + EGG_REEL_FRICTION_RANGE);
/** Replay must accommodate historical Official commitments as well as source-rounded friction. */
export const EGG_REEL_REPLAY_FRICTION_MAX = f(f(2.7) + f(0.6));

/**
 * Fewest held frames an authoritative release can name.
 *
 * A release is refused while `elapsed <= 1.5s`, and `elapsed` accumulates in float32, so the first
 * frame that clears the gate is found by counting rather than by dividing. There is no simulation
 * maximum — the native reel spins until the player lets go; the wire cap on client input lives in
 * `@dib/game-protocol` as `EGG_RELEASE_MAX_HELD_FRAMES_V1`.
 */
export const EGG_REEL_MIN_HELD_FRAMES = ((): number => {
  let elapsed = 0;
  let frames = 0;
  while (elapsed <= EGG_REEL_MIN_RELEASE_SECONDS) {
    elapsed = f(elapsed + EGG_REEL_FRAME_SECONDS);
    frames += 1;
  }
  return frames;
})();

export interface EggReelState {
  readonly elapsedSeconds: number;
  readonly index: number;
  readonly speed: number;
  readonly friction: number;
  readonly centerIndex: number;
  readonly stopped: boolean;
}





export class EggReel {
  private elapsed = 0;
  private position = 0;
  private velocity = EGG_REEL_INITIAL_SPEED;
  private deceleration = 0;
  private finished = false;

  constructor(
    readonly itemCount: number,
    private readonly rng: Rng,
    private readonly rngRules: EggRngRules = "source",
  ) {
    if (!Number.isSafeInteger(itemCount) || itemCount < 1) {
      throw new Error(`EggReel: itemCount must be a positive integer; got ${itemCount}`);
    }
  }

  /** `ccTouchBegan:` accepts every touch; only release mutates the reel. */
  press(): true {
    return true;
  }

  release(): boolean {
    if (
      this.finished ||
      this.elapsed <= EGG_REEL_MIN_RELEASE_SECONDS ||
      this.deceleration !== 0
    ) {
      return false;
    }
    const draw = f(this.rng.next());
    // Scaling by 2^-32 commutes with the source's U32->f32 conversion. Keep the remaining
    // multiplies/adds separate: replacing them with 2.7 + 0.6*draw changes float32 results.
    const term = f(draw * EGG_REEL_FRICTION_HALF);
    this.deceleration = this.rngRules === "legacy-v22"
      ? f(f(2.7) + f(f(0.6) * draw))
      : f(EGG_REEL_FRICTION_MIN + f(term + term));
    return true;
  }

  advance(seconds: number): EggReelState {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`EggReel.advance: seconds must be finite and nonnegative; got ${seconds}`);
    }
    if (!this.finished) {
      const dt = f(seconds);
      this.elapsed = f(f(this.elapsed) + dt);
      const speed = f(this.velocity);
      const friction = f(this.deceleration);
      const nonnegativeSpeed = f(Math.max(speed, f(0)));
      const distance = f(nonnegativeSpeed * dt);
      this.position = f(f(this.position) + distance);
      const deceleration = f(friction * dt);
      this.velocity = f(f(speed) - deceleration);
      if (this.velocity < EGG_REEL_STOP_SPEED) this.finished = true;
    }
    return this.state();
  }

  /**
   * Install an already-committed friction without consuming RNG.
   *
   * Replay only. The authoritative release draws friction server-side *after* the player's held
   * frame count is committed; this lets the browser reproduce that exact coast, and lets a receipt
   * replay reproduce a landing, without a second draw that would diverge from the committed one.
   */
  replayRelease(friction: number): boolean {
    if (
      this.finished ||
      this.elapsed <= EGG_REEL_MIN_RELEASE_SECONDS ||
      this.deceleration !== 0
    ) {
      return false;
    }
    if (
      !Number.isFinite(friction) ||
      friction < EGG_REEL_FRICTION_MIN ||
      // Replays also accept persisted pre-correction Official commitments.
      friction > EGG_REEL_REPLAY_FRICTION_MAX
    ) {
      throw new Error(`EggReel.replayRelease: friction ${friction} is outside the source range`);
    }
    this.deceleration = f(friction);
    return true;
  }

  /** Advance one fixed 1/60-second replay step without accepting browser elapsed time. */
  advanceFrame(): EggReelState {
    return this.advance(EGG_REEL_FRAME_SECONDS);
  }

  /**
   * Advance `frames` source-sized updates. Before a release the reel consumes no RNG and its speed
   * is constant, so this is a pure function of the frame count — which is what lets the server
   * reproduce the browser's free spin frame for frame from the committed count alone.
   */
  advanceFrames(frames: number): EggReelState {
    if (!Number.isSafeInteger(frames) || frames < 0) {
      throw new Error(`EggReel.advanceFrames: frames must be a nonnegative integer; got ${frames}`);
    }
    let state = this.state();
    for (let index = 0; index < frames; index += 1) state = this.advanceFrame();
    return state;
  }

  state(): EggReelState {
    return Object.freeze({
      elapsedSeconds: this.elapsed,
      index: this.position,
      speed: this.velocity,
      friction: this.deceleration,
      centerIndex: Math.floor(this.position) % this.itemCount,
      stopped: this.finished,
    });
  }
}


export function eggRepeatCost(kind: EggHatchKind): 100 | 298 {
  return kind === "gold" ? 298 : 100;
}

/**
 * Source `NSMutableArray randomizedArray`: remove a uniformly selected object until empty.
 * This consumes one integer draw per output entry, including the final `% 1` draw.
 */
export function eggShuffle<T>(values: readonly T[], rng: Rng): readonly T[] {
  const remaining = [...values];
  const shuffled: T[] = [];
  while (remaining.length > 0) {
    shuffled.push(remaining.splice(rng.intBelow(remaining.length), 1)[0]!);
  }
  return Object.freeze(shuffled);
}

/**
 * SlotMachineNode's two static non-prize previews. Candidate scans de-duplicate by instance name,
 * retain every species tied at or above the second-highest half-star score, then uniformly remove
 * at most two candidates.
 */
export function selectEggPreviewMonsters(
  game: GameData,
  reel: readonly EggHatchPrize[],
  rng: Rng,
): readonly string[] {
  let prize: EggHatchPrize | undefined;
  for (const entry of reel) {
    if (entry.kind === "monster" && entry.prizeMonster) prize = entry;
  }
  const distinct = new Map<string, Extract<EggHatchPrize, { kind: "monster" }>>();
  for (const entry of reel) {
    if (entry.kind !== "monster" || entry === prize || distinct.has(entry.shortType)) continue;
    distinct.set(entry.shortType, entry);
  }
  let top = 0;
  let second = 0;
  for (const entry of distinct.values()) {
    const score = entryStarScore(entry);
    if (score > top) {
      second = top;
      top = score;
    } else if (score >= second) {
      second = score;
    }
  }
  const candidates = [...distinct.values()].filter((entry) => entryStarScore(entry) >= second);
  const selected: string[] = [];
  while (selected.length < 2 && candidates.length > 0) {
    const entry = candidates.splice(rng.intBelow(candidates.length), 1)[0]!;
    if (selected[0] === entry.shortType) continue;
    selected.push(entry.shortType);
  }
  return Object.freeze(selected);

  function entryStarScore(entry: Extract<EggHatchPrize, { kind: "monster" }>): number {
    return Math.round(game.monsterByShortType(entry.shortType).stars * 2);
  }
}







export function generateEggHatchPool(
  game: GameData,
  player: EggHatchPlayerView,
  kind: EggHatchKind,
  rng: Rng,
  foundationDictionaryOrder?: "lexicographic",
  rngRules: EggRngRules = "source",
): EggHatchPool {
  const availableGemSlots = player.availableGemSlots.filter((slot) => slot >= 0 && slot <= 2);
  if (availableGemSlots.length !== player.availableGemSlots.length) {
    throw new Error(
      "generateEggHatchPool: egg Gem generation probes only source slots 0, 1, and 2",
    );
  }
  const goldEgg = kind === "gold";
  const eligible = monstersSortedByEggQuality(game, foundationDictionaryOrder)
    .filter((monster) => monsterValidForEgg(game, monster));
  const highestQuality = game.allMonsters().reduce(
    (highest, monster) =>
      monster.category !== "Egg" && player.highestRegisteredLevel(monster.shortType) > 0
        ? Math.max(highest, monster.eggUnlockQuality)
        : highest,
    1,
  );
  const ordinary: MonsterDef[] = [];
  const unseen: MonsterDef[] = [];
  const rare: MonsterDef[] = [];
  for (const monster of eligible) {
    const registered = player.highestRegisteredLevel(monster.shortType) > 0;
    if (registered || monster.quality <= highestQuality) {
      ordinary.push(monster);
      if (!registered) unseen.push(monster);
    } else if (rare.length <= 3) {
      rare.push(monster);
    }
  }

  const providers: EggHatchPrize[] = [];
  const target = 4 + 2 * Math.max(0, 6 - unseen.length);
  while (rare.length > 0 && providers.length < target) {
    const selected = rare.splice(rng.intBelow(Math.min(4, rare.length)), 1)[0]!;
    providers.push(monsterPrize(selected, player, goldEgg));
    providers.push(monsterPrize(selected, player, goldEgg));
  }

  let deficitHalf = Math.floor((target - providers.length) / 2);
  const ordinaryLimit = target + 6 - deficitHalf;




  for (let draw = 0; draw < ordinaryLimit && unseen.length > 0; draw += 1) {
    let index: number;
    if (deficitHalf > 0 || goldEgg) {
      deficitHalf -= 1;
      index = Math.max(0, unseen.length - 1 - rng.intBelow(6));
    } else {
      index = rng.intBelow(Math.min(6, unseen.length));
    }
    index = Math.min(index, unseen.length - 1);
    const selected = unseen.splice(index, 1)[0]!;
    providers.push(monsterPrize(selected, player, goldEgg));
    providers.push(monsterPrize(selected, player, goldEgg));
  }

  while (providers.length < 16 && ordinary.length > 0) {
    const tailWindow =
      Math.trunc(Math.fround(ordinary.length * Math.fround(0.3))) + 1;
    const index = Math.max(0, ordinary.length - 1 - rng.intBelow(tailWindow));
    const selected = ordinary[index]!;
    providers.push(monsterPrize(selected, player, goldEgg));
  }

  if (goldEgg) {
    const babyDragons = [
      "BlueBabyDragon",
      "RedBabyDragon",
      "WhiteBabyDragon",
      "GoldBabyDragon",
    ] as const;
    providers.push(Object.freeze({
      kind: "monster",
      shortType: babyDragons[rng.intBelow(babyDragons.length)]!,
      level: 1,
      prizeMonster: true,
    }));
  } else {
    appendSilverEggFillers(providers, player, game, availableGemSlots, rng, rngRules,
      foundationDictionaryOrder);
  }

  const frozenProviders = Object.freeze([...providers]);
  return Object.freeze({
    kind,
    providers: frozenProviders,
    reel: eggShuffle(frozenProviders, rng),
  });
}

function monsterValidForEgg(game: GameData, monster: MonsterDef): boolean {
  const root = game.monsterByShortType(game.evolveChainOf(monster.shortType)[0]!);
  return root.category === "Normal";
}

function monstersSortedByEggQuality(
  game: GameData,
  foundationDictionaryOrder?: "lexicographic",
): MonsterDef[] {




  const monsters = [...game.allMonsters()];
  if (foundationDictionaryOrder === "lexicographic") {
    // The lab's patched TouchHLE orders the source dictionary by its NSString key before the
    // source's quality-only sort. MonsterpediaBookData.init @ 0xd9f06..0xd9f0c
    // keys the template map by the FULL CreationData type, not the short instance name.
    monsters.sort((left, right) => lexicalCompare(left.path, right.path));
    // TouchHLE's NSArray comparator sort delegates to qsort_generic, which is not stable.
    // Reproduce its partition swaps only in the lab; a stable JS sort changes tied candidates.
    const pending: [number, number][] = [[0, monsters.length - 1]];
    while (pending.length > 0) {
      const [low, high] = pending.pop()!;
      if (low >= high) continue;
      let boundary = low + 1;
      for (let index = low + 1; index <= high; index++) {
        if (monsters[index]!.quality < monsters[low]!.quality) {
          [monsters[index], monsters[boundary]] = [monsters[boundary]!, monsters[index]!];
          boundary++;
        }
      }
      [monsters[low], monsters[boundary - 1]] = [monsters[boundary - 1]!, monsters[low]!];
      pending.push([boundary, high], [low, boundary - 2]);
    }
    return monsters;
  }
  return monsters.sort((left, right) => left.quality - right.quality);
}

function monsterPrize(
  monster: MonsterDef,
  player: EggHatchPlayerView,
  goldEgg: boolean,
): EggHatchPrize {


  let level = goldEgg ? Math.max(1, player.goldEggMonsterLevel) : 1;
  if (monster.evolveData !== undefined) {
    level = Math.min(level, Math.max(1, monster.evolveData.levelReq - 1));
  }
  return Object.freeze({
    kind: "monster",
    shortType: monster.shortType,
    level,
    prizeMonster: false,
  });
}

function appendSilverEggFillers(
  providers: EggHatchPrize[],
  player: EggHatchPlayerView,
  game: GameData,
  availableGemSlots: readonly RewardGemSlot[],
  rng: Rng,
  rngRules: EggRngRules,
  foundationDictionaryOrder?: "lexicographic",
): void {
  // Gold._init... @ 0xdf65c (six draws), Silver.quantityForLevel: @ 0x7ebd2 (four).
  // Each constructor generates an amount BEFORE its explicit amount argument overrides it.
  // The values are discarded, but the draws must precede recipe/totem, Gem stats and shuffle.
  if (rngRules === "source") {
    for (let currency = 0; currency < 10; currency += 1) rng.next();
  }
  // `slotProviders` probes hasItemSlot: for 0, 1, 2 in order; the API represents membership.
  if (rngRules === "source") availableGemSlots = [...new Set(availableGemSlots)].sort((a, b) => a - b);
  for (let i = 0; i < 4; i += 1) providers.push(Object.freeze({ kind: "gold", amount: 50 }));
  for (let i = 0; i < 2; i += 1) providers.push(Object.freeze({ kind: "gold", amount: 150 }));
  for (let i = 0; i < 2; i += 1) providers.push(Object.freeze({ kind: "silver", amount: 500 }));
  for (let i = 0; i < 2; i += 1) providers.push(Object.freeze({ kind: "silver", amount: 1_500 }));

  if (rng.intBelow(2) === 0) {
    const recipes = [...game.allCombineRecipes()];
    if (foundationDictionaryOrder === "lexicographic") {
      // Combines.plist allKeys; its keys are result short types.
      recipes.sort((left, right) => lexicalCompare(left.resultShortType, right.resultShortType));
    }
    const recipe = lowestStarScore(recipes
      .filter(({ resultShortType }) => !player.hasCombineRecipe(resultShortType))
      .map(({ resultShortType }) => game.monsterByShortType(resultShortType)));
    if (recipe !== undefined) {
      providers.push(Object.freeze({ kind: "recipe", combineName: recipe.shortType }));
    }
  }
  if (rng.intBelow(2) === 0) {
    let monsters = [...game.allMonsters()];
    if (foundationDictionaryOrder === "lexicographic") {
      // allValues(monsterNamesByIndex): init @ 0xda05c..0xda1de renumbers the complete
      // numerically sorted catalog 1..N, then stores it under decimal STRING keys.
      monsters = monsters.sort((left, right) => left.index - right.index)
        .map((monster, ordinal) => ({ monster, key: String(ordinal + 1) }))
        .sort((left, right) => lexicalCompare(left.key, right.key))
        .map(({ monster }) => monster);
    }
    const totem = lowestStarScore(monsters
      .filter((monster) =>
        monster.category === "Summon" && player.spiritSavedXp(monster.shortType) === 0));
    if (totem !== undefined) {
      providers.push(Object.freeze({ kind: "spiritTotem", shortType: totem.shortType }));
    }
  }
  for (let i = 0; i < 2; i += 1) {
    providers.push(Object.freeze({
      kind: "item",
      definitionPath: "Usables.CardSilver",
      level: 2,
    }));
  }
  for (let i = 0; i < 2; i += 1) {
    providers.push(Object.freeze({
      kind: "item",
      definitionPath: "Usables.CardGold",
      level: 3,
    }));
  }
  const highestLevelEver = player.highestRegisteredLivingLevel;
  for (let i = 0; i < 6; i += 1) {
    // `NSArray.randomElement` returns nil without a draw when the licensed 0..2 list is empty;
    // Objective-C's `[nil intValue]` then supplies slot zero.
    const slot = availableGemSlots.length === 0
      ? 0
      : availableGemSlots[rng.intBelow(availableGemSlots.length)]!;
    providers.push(Object.freeze({
      kind: "gem",
      level: highestLevelEver,
      quality: i < 4 ? 0 : 1,
      slot,
      enabledStats: dungeonRandomGemStats(i < 4 ? 0 : 1, rng),
    }));
  }
}







function lowestStarScore(monsters: readonly MonsterDef[]): MonsterDef | undefined {
  let result: MonsterDef | undefined;
  for (const monster of monsters) {
    if (result === undefined || result.stars * 2 > monster.stars * 2) result = monster;
  }
  return result;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
