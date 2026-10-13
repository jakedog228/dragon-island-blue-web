import {
  BattleSession, applyPvpPresentationCommand, restorePvpBattle, replayableRng, pvpSpiritState,
  type PvpAction, type PvpBattleSnapshot, type PvpBattleAdapter, type PresentationSessionStep, type TeamMemberSetup,
} from "@dib/engine";
import type { GameData } from "@dib/gamedata";
import type { PvpMatchViewV1 } from "@dib/game-protocol";
import { PlayerProfile } from "@dib/player-domain";
import type { MultiplayerBattle, MultiplayerResolution } from "../battle/multiplayerBattle.js";
import { pvpPerspectiveEvent, pvpPerspectiveSession } from "./pvpPerspective.js";

/** Persistent presentation session. Polls append committed tape; they never replace the scene. */
export class PvpPlayback implements MultiplayerBattle {
  readonly you;
  readonly session;
  readonly resumedStep: PresentationSessionStep | undefined;
  readonly historyEvents;
  readonly profile: PlayerProfile;
  readonly restored;
  private readonly tape;
  private snapshot: PvpBattleSnapshot;
  private cursor: number;
  private disposed = false;
  private wake: (() => void) | undefined;
  private sending = false;
  inputBlocked = false;
  private match: PvpMatchViewV1;

  constructor(data: GameData, match: PvpMatchViewV1, adapters: readonly PvpBattleAdapter[],
    private readonly send: (action: PvpAction) => void, readonly forfeit: () => void, readonly ended: () => void, fresh = false) {
    this.match = match; this.you = match.you;
    if (!match.battle) throw new Error("PvP match has no battle");
    this.snapshot = match.battle as PvpBattleSnapshot;
    this.tape = replayableRng(this.snapshot.randomDraws);
    const restored = restorePvpBattle(data, this.snapshot, adapters, fresh ? undefined : this.tape);
    if (fresh && this.snapshot.commands.length) throw new Error("Fresh PvP playback contains historical commands");
    const session = fresh ? new BattleSession(data, structuredClone(this.snapshot.teams) as [TeamMemberSetup[], TeamMemberSetup[]], this.tape,
      { fightingGroupSize: this.snapshot.fightingGroupSize, humanTeams: [0, 1], blockCapture: true, silver: 0 }) : restored.session;
    this.restored = fresh ? { ...restored, session, events: session.events,
      extensions: new Map(adapters.map(adapter => [adapter.rulesId, adapter.create({ data, session, random: () => this.tape.next() })])),
    } : restored;
    this.cursor = this.snapshot.commands.length;
    this.session = pvpPerspectiveSession(this.restored.session, this.you);
    this.historyEvents = fresh ? [] : this.session.events;
    const decision = this.restored.decision;
    if (!fresh && decision.type !== "turn") throw new Error("A completed match does not mount a live battle");
    this.resumedStep = fresh ? undefined : decision.type === "turn" ? { type: "awaitingPlayer", actorId: decision.actorId, choices: [...decision.choices] } : undefined;
    const spirits = pvpSpiritState(this.snapshot.spirits?.[this.you], this.restored.session, this.you);
    const base = new PlayerProfile({ heroLevel: 1, monsterPartyLevels: this.snapshot.teams[this.you].map(m => m.level),
      silver: 0, gold: 0, captureCards: { 1: 0, 2: 0, 3: 0 }, spiritReadiness: spirits.energy / 100,
      tutorialFlags: ["Tutorial0", "battleTutorial1", "battleTutorial2", "catchTutorial", ...Array.from({ length: 6 }, (_, i) => `NotYourTurn${i + 1}`)],
    });
    this.profile = PlayerProfile.fromStateSnapshot({ ...base.stateSnapshot(),
      spiritSavedXp: Object.fromEntries(Object.entries(spirits.savedXp).map(([key, xp]) => [key, xp + (spirits.used.has(key) ? 33 : 0)])),
      spiritsUsedThisTrip: [...spirits.used],
    }, this.snapshot.teams[this.you].map(m => m.level));
  }

  update(match: PvpMatchViewV1): void {
    if (match.matchId !== this.match.matchId || match.revision < this.match.revision) return;
    const snapshot = match.battle as PvpBattleSnapshot | undefined;
    if (!snapshot) throw new Error("PvP update omitted battle");
    if (snapshot.commands.length < this.snapshot.commands.length ||
      JSON.stringify(snapshot.commands.slice(0, this.snapshot.commands.length)) !== JSON.stringify(this.snapshot.commands) ||
      JSON.stringify(snapshot.randomDraws.slice(0, this.snapshot.randomDraws.length)) !== JSON.stringify(this.snapshot.randomDraws)) {
      throw new Error("PvP committed history changed");
    }
    this.tape.appendCommittedDraws(snapshot.randomDraws.slice(this.snapshot.randomDraws.length));
    this.snapshot = snapshot; this.match = match; this.wake?.();
  }
  dispose(): void { this.disposed = true; this.wake?.(); }
  get commandCursor(): number { return this.cursor; }
  get busy(): boolean { return this.sending || this.inputBlocked; }

  async resolve(step: Extract<PresentationSessionStep, { type: "awaitingPlayer" }>, action?: PvpAction): Promise<MultiplayerResolution> {
    if (action) {
      if (this.sending) throw new Error("A PvP action is already pending");
      this.sending = true;
    }
    try {
      if (action) this.send(action);
      while (!this.disposed && this.cursor >= this.snapshot.commands.length && this.match.status === "active") {
        await new Promise<void>(resolve => { this.wake = resolve; }); this.wake = undefined;
      }
      if (this.disposed) return { events: [], terminal: true };
      const command = this.snapshot.commands[this.cursor];
      if (!command) return { events: [], terminal: true };
      if (action && JSON.stringify(command.action) !== JSON.stringify(action)) throw new Error("PvP committed action differs from pending intent");
      const raw = this.restored.session;
      const before = raw.events.length;
      applyPvpPresentationCommand(raw, { type: "turn", team: raw.teamOf(step.actorId), actorId: step.actorId, choices: step.choices },
        command, this.restored.extensions, this.snapshot.spirits);
      this.cursor++;
      const events = raw.events.slice(before).map(event => pvpPerspectiveEvent(event, this.you));
      if (command.action.type === "forfeit") return { events, terminal: true };
      if (command.action.type === "spirit") return { events, spiritId: raw.summonIdOf(command.team)! };
      const use = events.find(event => event.type === "abilityUsed");
      const actionSlot = command.action.type === "ability" ? command.action.slot : undefined;
      const candidates = actionSlot ? step.choices.filter(c => c.slot === actionSlot)
        : step.choices.filter(c => c.abilityPath === use?.ability);
      const choice = candidates.length === 1 ? candidates[0] : undefined;
      return { events, ...(use?.type === "abilityUsed" ? { abilityPath: use.ability } : {}),
        ...(choice ? { ...(choice.tier === undefined ? {} : { tier: choice.tier }), slot: choice.slot } : {}) };
    } finally { if (action) this.sending = false; }
  }
  async summon(shortType: string): Promise<MultiplayerResolution> {
    const actorId = this.restored.session.queueOrder()[0]!;
    return this.resolve({ type: "awaitingPlayer", actorId, choices: [] }, { type: "spirit", actorId, shortType });
  }
}
