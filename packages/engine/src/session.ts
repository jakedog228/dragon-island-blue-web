


import type { AbilityDef, Element, GameData, JobAbilityRef, StatName } from "@dib/gamedata";
import type { Rng } from "./rng.js";
import { BattleCore, type BattleXpLivingState, type PostBattleXpSummary } from "./core.js";
import { assignAbility, type AiDecision } from "./ai.js";
import { braceTier, parseAbilityArgument } from "./abilityArgs.js";
import type {
  BattleEvent,
  BattleReport,
  PlayerBattleTerminalSnapshot,
  TeamMemberSetup,
} from "./events.js";
import type { CaptureCardLevel, CaptureStatus } from "./capture.js";
import type { ActiveStatOnlyBuff, StatusEffect } from "./buff.js";
import type { ScriptedAbilityStep, ScriptedAbilityStepResult } from "./core.js";

export type Targeting =
  | { kind: "enemies"; count: number }
  | { kind: "friends"; count: number }
  | { kind: "allEnemies" }
  | { kind: "allFriends" }
  | { kind: "mixed"; enemyCount: number; friendlyCount: number; allEnemies: boolean; allFriends: boolean }
  | { kind: "self" };

export interface PlayerChoice {
  slot: string;
  abilityPath: string;
  displayName: string;
  tier: number | undefined;
  /** `ability.activationLength` (turn-panel.md §2b: the real "TU:130"-style on-screen number,
   *  read via `[NSBundle localizedStringForKey:value:table:]("ActivationLengthKey")` + `"%@:%d"`
   *  formatted with this value) — distinct from `tier`, which is only the `{N}` brace SELECTOR
   *  (animation/sound lookup), not the displayed TU cost. Added for Task 12's MonsterTurnPanel. */
  activationLength: number;
  targeting: Targeting;
  /** `-[UsableAbility blockUseReasonForLiving:inCombat:]` (components-full.md §13): the
   *  first blocking component's reason key (e.g. "NoReplacementMembers"), or absent when the
   *  ability is currently usable. A blocked choice is refused by `submitPlayerAction`. */
  blockReason?: string;
}

export interface ScriptedPlayerActionStart {
  readonly actorId: string;
  readonly abilityPath: string;
  readonly events: BattleEvent[];
}

export type SessionStep =
  | { type: "enemyTurnResolved"; actorId: string; abilityPath: string; slot?: string; tier: number | undefined; events: BattleEvent[] }
  | { type: "awaitingPlayer"; actorId: string; choices: PlayerChoice[] }
  | { type: "ended"; report: BattleReport };

export type PresentationSessionStep =
  | { type: "awaitingEnemy"; actorId: string; forcedLooseTurn: boolean }
  | Extract<SessionStep, { type: "awaitingPlayer" | "ended" }>;

export interface DelayActionResult {
  actorId: string;
  abilityPath: "Utility.Delay";
  activationLength: number;
  events: BattleEvent[];
}

export type RetreatActionResult =
  | { success: true; actorId: string; events: BattleEvent[] }
  | {
      success: false;
      actorId: string;
      abilityPath: "Utility.LooseTurn";
      statusTextKey: "RunAwayFailKey";
      events: BattleEvent[];
    };

function recordOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function targetingOf(ability: AbilityDef): Targeting {
  const tp = recordOf(ability.targetPicker);
  const enemyCount = typeof tp["enemyTargets"] === "number" ? (tp["enemyTargets"] as number) : 0;
  const friendCount = typeof tp["friendlyTargets"] === "number" ? (tp["friendlyTargets"] as number) : 0;
  if (tp["selfOnly"] === true) return { kind: "self" };
  const enemySide = tp["allEnemies"] === true || enemyCount >= 1;
  const friendSide = tp["allFriends"] === true || friendCount >= 1;
  if (enemySide && friendSide) {
    return {
      kind: "mixed",
      enemyCount,
      friendlyCount: friendCount,
      allEnemies: tp["allEnemies"] === true,
      allFriends: tp["allFriends"] === true,
    };
  }
  if (tp["allEnemies"] === true) return { kind: "allEnemies" };
  if (enemyCount >= 1) return { kind: "enemies", count: enemyCount };
  if (tp["allFriends"] === true) return { kind: "allFriends" };
  if (friendCount >= 1) return { kind: "friends", count: friendCount };
  // No targeting keys at all: the AI path builds EMPTY target arrays for this shape (ai.ts
  // §4b), and no CombatAbility in the corpus has a keyless targetPicker — fail loudly rather
  // than silently guess a player-side default.
  throw new Error(`unsupported keyless targetPicker on ${ability.path}`);
}

function rawActivationLength(ref: JobAbilityRef, ability: AbilityDef): unknown {
  return ref.arguments["activationLength"] ?? ability.activationLength;
}

function tierOf(ref: JobAbilityRef, ability: AbilityDef): number | undefined {
  return braceTier(rawActivationLength(ref, ability));
}

/** Every usableN ref whose ability the player can fire in combat, in slot order.
 *  `blockEvaluator` (optional — live sessions pass `BattleCore.blockUseReasonFor`) stamps each
 *  choice's current `blockReason`; without it every choice reads as unblocked. */
export function buildPlayerChoices(
  data: GameData,
  shortType: string,
  blockEvaluator?: (ability: AbilityDef, ref: JobAbilityRef) => string | undefined,
): PlayerChoice[] {
  const choices: PlayerChoice[] = [];
  for (const ref of data.jobAbilitiesOrEmpty(shortType)) {
    if (!/^usable\d+$/.test(ref.slot)) continue;
    const ability = data.ability(ref.type);
    if (ability.className !== "CombatAbility") continue; // NonCombatAbility blocked in combat; passives non-usable
    const instanceName = ref.arguments["instanceName"];
    const blockReason = blockEvaluator?.(ability, ref);
    choices.push({
      slot: ref.slot,
      abilityPath: ability.path,
      displayName: typeof instanceName === "string" ? instanceName : ability.path.split(".").at(-1)!,
      tier: tierOf(ref, ability),
      activationLength: parseAbilityArgument(rawActivationLength(ref, ability)),
      targeting: targetingOf(ability),
      ...(blockReason !== undefined ? { blockReason } : {}),
    });
  }
  if (choices.length === 0) throw new Error(`no usable combat abilities for ${shortType}`);
  return choices;
}

export class BattleSession {
  private readonly core: BattleCore;
  private readonly data: GameData;
  private readonly rng: Rng;
  private started = false;
  private pending: { actorId: string; choices: PlayerChoice[] } | undefined;
  private pendingEnemyId: string | undefined;
  private pendingForcedLooseTurn = false;
  private pendingScripted: { actorId: string; abilityPath: string } | undefined;

  constructor(
    data: GameData,
    teams: [TeamMemberSetup[], TeamMemberSetup[]],
    rng: Rng,
    opts?: { fightingGroupSize?: number; blockCapture?: boolean; silver?: number; humanTeams?: readonly (0 | 1)[] },
  ) {
    this.core = new BattleCore(data, teams, rng, opts);
    this.data = data;
    this.rng = rng;
  }

  get events(): readonly BattleEvent[] {
    return this.core.events;
  }

  /** Native Battle state 6 — terminal without a winner. Set by a successful player retreat OR
   *  by `Utility.Escape`'s guaranteed retreat mid-`submitPlayerAction` (the `escaped` event). */
  get retreated(): boolean {
    return this.core.retreated;
  }

  /** The player-save silver wallet backing SpendSilverAbilityComponent. */
  get silver(): number {
    return this.core.silver;
  }

  /** Private authority replay seam; see BattleCore.applyExternalSilverDebit. */
  applyExternalSilverDebit(amount: number): void {
    this.core.applyExternalSilverDebit(amount);
  }

  maxHpOf(id: string): number {
    return this.core.maxHpOf(id);
  }

  hpOf(id: string): number {
    return this.core.hpOf(id);
  }

  effectiveStatsOf(id: string): Record<StatName, number> {
    return this.core.effectiveStatsOf(id);
  }

  magnifySourceContextOf(id: string): ReturnType<BattleCore["magnifySourceContextOf"]> {
    return this.core.magnifySourceContextOf(id);
  }

  hasteOf(id: string): number {
    return this.core.hasteOf(id);
  }

  activeBuffsOf(id: string): readonly ActiveStatOnlyBuff[] {
    return this.core.activeBuffsOf(id);
  }

  statusEffectsOf(id: string): readonly StatusEffect[] {
    return this.core.statusEffectsOf(id);
  }

  captureStatusOf(id: string): CaptureStatus {
    return this.core.captureStatusOf(id);
  }

  captureChanceOf(id: string, cardLevel: CaptureCardLevel, partyLevel: number): number {
    return this.core.captureChanceOf(id, cardLevel, partyLevel);
  }

  /** FUTURE_PARTY_INTEGRATION: pending native Battle.capturedMonsters for the party/save award flow. */
  capturedIds(): string[] {
    return this.core.capturedIds();
  }

  shortTypeOf(id: string): string {
    return this.core.shortTypeOf(id);
  }

  sourceInstanceIdOf(id: string): string | undefined {
    return this.core.sourceInstanceIdOf(id);
  }

  /** Durable original-player delta after victory, defeat, draw, or retreat. */
  playerTerminalSnapshot(): PlayerBattleTerminalSnapshot {
    return this.core.playerTerminalSnapshot();
  }

  /** Live equipped-stone delegate — see `BattleCore.soulStoneOf` (undefined once Desoul's
   *  consume unequips it). */
  soulStoneOf(id: string): { element: Element; level: number } | undefined {
    return this.core.soulStoneOf(id);
  }

  teamOf(id: string): 0 | 1 {
    return this.core.teamOf(id);
  }

  levelOf(id: string): number {
    return this.core.levelOf(id);
  }

  /** `-[Battle timeDelayForLiving:]` delegate — see `BattleCore.timeDelayOf`. Time units until
   *  `actorId` acts; the front-of-queue (next-to-act) living reports 0. */
  timeDelayOf(actorId: string): number {
    return this.core.timeDelayOf(actorId);
  }

  /** `-[Battle queOrder]` delegate — see `BattleCore.queueOrder`. Living actor ids, soonest
   *  to act first. */
  queueOrder(): string[] {
    return this.core.queueOrder();
  }

  /** `Team.replacementMembers` bench size delegate — see `BattleCore.benchCountOf`. */
  benchCountOf(team: 0 | 1): number {
    return this.core.benchCountOf(team);
  }

  /** Ordered `Team.replacementMembers` delegate for read-only reserve presentation. */
  benchIdsOf(team: 0 | 1): string[] {
    return this.core.benchIdsOf(team);
  }

  /** `-[Team summon]` delegate — the per-team summon-slot occupant (soulstones.md §10). */
  summonIdOf(team: 0 | 1): string | undefined {
    return this.core.summonIdOf(team);
  }

  /** `-[Team targetableMembers]` delegate — active roster + summon (what's actually on field). */
  targetableIdsOf(team: 0 | 1): string[] {
    return this.core.targetableIdsOf(team);
  }

  isAiControlled(id: string): boolean {
    return this.core.isAiControlled(id);
  }

  /** HeroDisplay side command; deliberately valid while a player action is pending. */
  summonSpirit(shortType: string, savedXp: number, team: 0 | 1 = 0): { id: string; events: BattleEvent[] } {
    if (!this.started) throw new Error("BattleSession.summonSpirit: battle has not started");
    const before = this.core.events.length;
    const id = this.core.summonSpirit(shortType, savedXp, team);
    return { id, events: this.core.events.slice(before) };
  }

  /** `Team.monsterMembers` delegate — see `BattleCore.activeIdsOf` (valid pre-battle-start,
   *  unlike `queueOrder`). */
  activeIdsOf(team: 0 | 1): string[] {
    return this.core.activeIdsOf(team);
  }

  /** Exact `Team.deadMembers` delegate; summon-slot deaths are deliberately absent. */
  deadIdsOf(team: 0 | 1): string[] {
    return this.core.deadIdsOf(team);
  }

  /** Native Monster reward/award flags and identity for post-battle XP logic. */
  xpStateOf(id: string): BattleXpLivingState {
    return this.core.xpStateOf(id);
  }

  /** Exact source participant/reward collections plus per-participant XP amount. */
  postBattleXpSummary(breederXpBonus?: number): PostBattleXpSummary {
    return this.core.postBattleXpSummary(breederXpBonus);
  }

  advance(): SessionStep {
    const step = this.advanceForPresentation();
    return step.type === "awaitingEnemy" ? this.submitEnemyAction() : step;
  }

  /** Stops at an enemy actor before AI choice/resolution. The native presentation spends its
   * state-1 delay in this state; callers commit with submitEnemyAction() when that delay ends. */
  advanceForPresentation(): PresentationSessionStep {
    if (this.pending || this.pendingEnemyId || this.pendingScripted) {
      throw new Error("BattleSession.advance: pending actor action must be submitted before advancing");
    }
    if (!this.started) {
      this.started = true;
      this.core.seedAndStart();
    }
    if (this.core.winner !== undefined) {
      return { type: "ended", report: this.core.report() };
    }
    if (this.core.retreated) {
      throw new Error("BattleSession.advance: battle already ended by retreat");
    }
    this.core.skipDeadFront();
    const actorId = this.core.frontActorId();
    if (this.core.isDisabled(actorId)) {
      this.pendingEnemyId = actorId;
      this.pendingForcedLooseTurn = true;

      return { type: "awaitingEnemy", actorId, forcedLooseTurn: true };
    }
    if (!this.core.isAiControlled(actorId)) {
      const choices = buildPlayerChoices(this.data, this.core.shortTypeOf(actorId), (ability, ref) =>
        this.core.blockUseReasonFor(actorId, ability, ref.arguments),
      );
      this.pending = { actorId, choices };
      return { type: "awaitingPlayer", actorId, choices };
    }
    // Enemy monsters, or a player-team monster whose Passive.Berserk permanently handed control
    // to BadguyAI on battle entry (targeting-passives.md §C) — both resolve through the AI path.
    this.pendingEnemyId = actorId;
    return { type: "awaitingEnemy", actorId, forcedLooseTurn: false };
  }

  submitEnemyAction(): Extract<SessionStep, { type: "enemyTurnResolved" }> {
    const actorId = this.pendingEnemyId;
    if (!actorId) throw new Error("BattleSession.submitEnemyAction: no enemy turn is awaiting an action");
    const before = this.core.events.length;
    let decided: AiDecision | undefined;
    this.core.resolveTurn((id) => {
      if (this.pendingForcedLooseTurn) {
        decided = {
          ability: this.data.ability("Utility.LooseTurn"),
          args: {},
          enemyTargets: [],
          friendlyTargets: [],
          rngDraws: 0,
        };
        return decided;
      }
      decided = assignAbility(id, this.core.aiWorld, this.data, this.rng);
      return decided;
    });
    if (!decided) throw new Error("BattleSession.advance: enemy turn resolved without a decision");
    this.pendingEnemyId = undefined;
    this.pendingForcedLooseTurn = false;
    const tier = braceTier(decided.args["activationLength"] ?? decided.ability.activationLength);
    return {
      type: "enemyTurnResolved",
      actorId,
      abilityPath: decided.ability.path,
      ...(decided.slot === undefined ? {} : { slot: decided.slot }),
      tier,
      events: this.core.events.slice(before),
    };
  }

  submitPlayerAction(slot: string, targets: string[]): BattleEvent[] {
    const pending = this.pending;
    if (!pending) throw new Error("BattleSession.submitPlayerAction: no player turn is awaiting an action");
    const choice = pending.choices.find((c) => c.slot === slot);
    if (!choice) throw new Error(`BattleSession.submitPlayerAction: unknown slot ${slot}`);

    const ref = this.data
      .jobAbilitiesOrEmpty(this.core.shortTypeOf(pending.actorId))
      .find((r) => r.slot === slot);
    if (!ref) throw new Error(`BattleSession.submitPlayerAction: ref vanished for slot ${slot}`);
    const ability = this.data.ability(ref.type);


    const blockReason = this.core.blockUseReasonFor(pending.actorId, ability, ref.arguments);
    if (blockReason !== undefined) {
      throw new Error(`BattleSession.submitPlayerAction: ${ability.path} is blocked (${blockReason})`);
    }

    const { enemyTargets, friendlyTargets } = this.resolveTargets(pending.actorId, choice.targeting, targets);

    const decision: AiDecision = {
      ability,
      args: ref.arguments,
      enemyTargets,
      friendlyTargets,
      rngDraws: 0, // ai == nil for player-team monsters: no AI draws, ever
    };
    const before = this.core.events.length;
    this.core.resolveTurn(() => decision);
    this.pending = undefined;
    return this.core.events.slice(before);
  }

  beginScriptedPlayerAction(slot: string): ScriptedPlayerActionStart {
    const pending = this.pending;
    if (!pending) {
      throw new Error("BattleSession.beginScriptedPlayerAction: no player turn is awaiting an action");
    }
    const choice = pending.choices.find((candidate) => candidate.slot === slot);
    if (!choice) throw new Error(`BattleSession.beginScriptedPlayerAction: unknown slot ${slot}`);
    const ref = this.data
      .jobAbilitiesOrEmpty(this.core.shortTypeOf(pending.actorId))
      .find((candidate) => candidate.slot === slot);
    if (!ref) throw new Error(`BattleSession.beginScriptedPlayerAction: ref vanished for slot ${slot}`);
    const ability = this.data.ability(ref.type);
    const blockReason = this.core.blockUseReasonFor(pending.actorId, ability, ref.arguments);
    if (blockReason !== undefined) {
      throw new Error(`BattleSession.beginScriptedPlayerAction: ${ability.path} is blocked (${blockReason})`);
    }
    const before = this.core.events.length;
    this.core.beginScriptedTurn({
      ability,
      args: ref.arguments,
      enemyTargets: [],
      friendlyTargets: [pending.actorId],
      rngDraws: 0,
    });
    this.pending = undefined;
    this.pendingScripted = { actorId: pending.actorId, abilityPath: ability.path };
    return {
      actorId: pending.actorId,
      abilityPath: ability.path,
      events: this.core.events.slice(before),
    };
  }

  performScriptedPlayerAbility(step: ScriptedAbilityStep): ScriptedAbilityStepResult {
    if (this.pendingScripted === undefined) {
      throw new Error("BattleSession.performScriptedPlayerAbility: no scripted player action is active");
    }
    return this.core.performScriptedAbility(step);
  }

  randomScriptedPlayerPick(candidates: readonly string[]): string | undefined {
    if (this.pendingScripted === undefined) {
      throw new Error("BattleSession.randomScriptedPlayerPick: no scripted player action is active");
    }
    return this.core.randomScriptedPick(candidates);
  }

  scriptedPlayerRandomFloat(): number {
    if (this.pendingScripted === undefined) {
      throw new Error("BattleSession.scriptedPlayerRandomFloat: no scripted player action is active");
    }
    return this.core.scriptedRandomFloat();
  }

  scriptedPlayerRandomInt(exclusiveMax: number): number {
    if (this.pendingScripted === undefined) {
      throw new Error("BattleSession.scriptedPlayerRandomInt: no scripted player action is active");
    }
    return this.core.scriptedRandomInt(exclusiveMax);
  }

  finishScriptedPlayerAction(): BattleEvent[] {
    if (this.pendingScripted === undefined) {
      throw new Error("BattleSession.finishScriptedPlayerAction: no scripted player action is active");
    }
    const events = this.core.finishScriptedTurn();
    this.pendingScripted = undefined;
    return events;
  }

  /** Queue/use an Item Card's `Utility.Capture` ability against one live enemy. */
  submitCaptureAction(
    target: string,
    cardLevel: CaptureCardLevel,
    partyLevel: number,
  ): BattleEvent[] {
    const pending = this.pending;
    if (!pending) throw new Error("BattleSession.submitCaptureAction: no player turn is awaiting an action");
    this.validatePicked(1, [target], 1, pending.actorId);
    if (this.core.captureStatusOf(target) !== "available") {
      throw new Error(`BattleSession.submitCaptureAction: ${target} is not capture-available`);
    }
    if (this.core.captureChanceOf(target, cardLevel, partyLevel) === 0) {
      throw new Error(`BattleSession.submitCaptureAction: ${target} has zero capture chance`);
    }

    const ability = this.data.ability("Utility.Capture");
    const decision: AiDecision = {
      ability,
      args: { captureCardLevel: cardLevel, capturePartyLevel: partyLevel },
      enemyTargets: [target],
      friendlyTargets: [],
      rngDraws: 0,
    };
    const before = this.core.events.length;
    this.core.resolveTurn(() => decision);
    this.pending = undefined;
    return this.core.events.slice(before);
  }


  submitDelayAction(): DelayActionResult {
    const pending = this.pending;
    if (!pending) throw new Error("BattleSession.submitDelayAction: no player turn is awaiting an action");
    const opponents = this.core.aiWorld.enemyPoolOf(pending.actorId);
    if (opponents.length === 0) {
      throw new Error("BattleSession.submitDelayAction: no active opponent exists");
    }
    const soonestOpponentDelay = Math.min(...opponents.map((id) => this.core.timeDelayOf(id)));
    const activationLength = Math.max(2, soonestOpponentDelay + 1);
    const ability = this.data.ability("Utility.Delay");
    const decision: AiDecision = {
      ability,
      args: { activationLength, noHaste: true },
      enemyTargets: [],
      friendlyTargets: [],
      rngDraws: 0,
    };
    const before = this.core.events.length;
    this.core.resolveTurn(() => decision);
    this.pending = undefined;
    return {
      actorId: pending.actorId,
      abilityPath: "Utility.Delay",
      activationLength,
      events: this.core.events.slice(before),
    };
  }


  submitRetreatAction(chance = 30): RetreatActionResult {
    const pending = this.pending;
    if (!pending) throw new Error("BattleSession.submitRetreatAction: no player turn is awaiting an action");
    const before = this.core.events.length;
    if (this.core.attemptRetreat(pending.actorId, chance)) {
      this.pending = undefined;
      return { success: true, actorId: pending.actorId, events: this.core.events.slice(before) };
    }

    const ability = this.data.ability("Utility.LooseTurn");
    const decision: AiDecision = {
      ability,
      args: {},
      enemyTargets: [],
      friendlyTargets: [],
      rngDraws: 0,
    };
    this.core.resolveTurn(() => decision);
    this.pending = undefined;
    return {
      success: false,
      actorId: pending.actorId,
      abilityPath: "Utility.LooseTurn",
      statusTextKey: "RunAwayFailKey",
      events: this.core.events.slice(before),
    };
  }

  private resolveTargets(
    actorId: string,
    targeting: Targeting,
    targets: string[],
  ): { enemyTargets: string[]; friendlyTargets: string[] } {
    const requireEmpty = (kind: string) => {
      if (targets.length !== 0) {
        throw new Error(`BattleSession: ${kind} targeting takes no explicit targets`);
      }
    };
    switch (targeting.kind) {
      case "self":
        requireEmpty("self");
        return { enemyTargets: [], friendlyTargets: [actorId] };
      case "allEnemies":
        requireEmpty("allEnemies");
        return { enemyTargets: [...this.core.aiWorld.enemyPoolOf(actorId)], friendlyTargets: [] };
      case "allFriends":
        requireEmpty("allFriends");
        return { enemyTargets: [], friendlyTargets: [...this.core.aiWorld.friendlyPoolOf(actorId)] };
      case "enemies":
        this.validatePicked(targeting.count, targets, 1, actorId);
        return { enemyTargets: targets, friendlyTargets: [] };
      case "friends":
        this.validatePicked(targeting.count, targets, 0, actorId);
        return { enemyTargets: [], friendlyTargets: targets };
      case "mixed": {
        const actorTeam = this.core.teamOf(actorId);
        const enemyTargets = targets.filter((id) => this.core.teamOf(id) !== actorTeam);
        const friendlyTargets = targets.filter((id) => this.core.teamOf(id) === actorTeam);
        const enemyExpected = targeting.allEnemies ? this.core.aiWorld.enemyPoolOf(actorId).length : targeting.enemyCount;
        const friendExpected = targeting.allFriends ? this.core.aiWorld.friendlyPoolOf(actorId).length : targeting.friendlyCount;
        this.validatePicked(enemyExpected, enemyTargets, 1, actorId);
        this.validatePicked(friendExpected, friendlyTargets, 0, actorId);
        return { enemyTargets, friendlyTargets };
      }
    }
  }

  private validatePicked(count: number, targets: string[], side: 0 | 1, actorId: string): void {
    // The binary only ever targets `targetableMembers` (the ACTIVE pool — benched monsters are
    // not on the field), so validate against the same live pools the AI path draws from.
    // TargetPickerGui clamps each requested count to the available monster-node count
    // (`turn-order-input.md` §2), so a two-target move legitimately resolves against the sole
    // remaining enemy rather than failing its authored-count validation.
    const pool =
      side === 1 ? this.core.aiWorld.enemyPoolOf(actorId) : this.core.aiWorld.friendlyPoolOf(actorId);
    const expected = Math.min(count, pool.length);
    if (targets.length !== expected) {
      throw new Error(`BattleSession: expected ${expected} target(s), got ${targets.length}`);
    }
    if (new Set(targets).size !== targets.length) {
      throw new Error("BattleSession: duplicate targets");
    }
    for (const t of targets) {
      if (!pool.includes(t)) {
        throw new Error(
          `BattleSession: ${t} is not a live ${side === 1 ? "enemy" : "friendly"} targetable member`,
        );
      }
      if (!this.core.isAlive(t)) throw new Error(`BattleSession: ${t} is dead`);
    }
  }
}
