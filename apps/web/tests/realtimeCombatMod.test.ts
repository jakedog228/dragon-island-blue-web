import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { BattleSession, mulberry32, type TeamMemberSetup } from "@dib/engine";
import { loadGameData } from "@dib/gamedata";
import { importCodeModArchive, resolveCodeModProfile } from "@dib/mod-kernel";
import { createFullTrustCodeModRuntime } from "../src/content/codeModRuntime.js";
import * as turnOrderFlow from "../src/battle/turnOrderFlow.js";
import * as localBattle from "../src/battle/localBattleSession.js";

// Deliberately use the real engine, data and executable ZIP. The only fake is presentation.
const data = loadGameData();
const root = resolve(import.meta.dirname, "../../../examples/mods/realtime-combat");
class FakeBattleNode {
  async loop() {}
  async playTurn(...args: unknown[]) {
    (this as Internal).played?.push(args[1]);
    (this as Internal).effectContexts?.push((this as Internal).effectContext);
    this.applyHp(args[0] as Internal[]);
  }
  async settleDisplayRegistrations() {}
  applyAbilityEvents() {}
  applyHp(events: Internal[] = []) {
    const self = this as Internal;
    self.hpUpdates = (self.hpUpdates ?? 0) + 1;
    self.hpValues ??= new Map();
    for (const event of events) if (event.hpAfter !== undefined) self.hpValues.set(event.target, event.hpAfter);
  }
  applyPresentedSpiritReadiness() {}
  applyStatusOverlayEvents() {}
  fireEnemyDefeatQuestEvents() {}
  async handleDeaths() {}
  startPresentationTask(task: Promise<unknown>) { void task; }
  tryNode() { return {}; }
  async sleep(_ms: number) {}
  async awaitTimeDelay(_ms: number) {}
  phaseStartDelayMs() { return 500; }
  async showPanel() {}
  async openCaptureChooser() {}
  async showSecondaryConfirmation() {}
  async showSecondaryMessage() {}
  async openReserveManagement() {}
  async applyRosterEvents(..._args: unknown[]) { await (this as Internal).rosterConstruction; }
  renderGameState() { return {}; }
}
async function runtime(companions: string[] = []) {
  const files: Record<string, Uint8Array> = {};
  for (const path of ["manifest.json", "scripts/main.js", "scripts/clock.js"]) {
    files[path] = new Uint8Array(await readFile(resolve(root, path)));
  }
  const pkg = await importCodeModArchive(zipSync(files), "realtime-combat.dibmod");
  const earlier = await Promise.all(companions.map((script, index) => importCodeModArchive(zipSync({
    "manifest.json": new TextEncoder().encode(JSON.stringify({
      schemaVersion: 4, apiVersion: 4, id: `dev.dragonislandblue.test-character-${index}`,
      version: "1.0.0", displayName: "Character test", mode: "offline", entry: "main.js", dependencies: {},
      loadBefore: ["dev.dragonislandblue.realtime-combat"],
    })),
    "main.js": new TextEncoder().encode(script),
  }), `character-${index}.dibmod`)));
  const modules = new Map<string, unknown>([
    ["web/battle/battleNode.ts", { BattleNode: FakeBattleNode }],
    ["web/battle/turnOrderFlow.ts", turnOrderFlow],
    ["web/ui/popup.ts", { PopupHost: { for: () => ({ dismissAll() {} }) } }],
    ["web/battle/captureCardPopup.ts", { showCaptureCardPopup: async () => { throw new Error("unexpected popup"); } }],
    ["web/battle/localBattleSession.ts", localBattle],
    ["@dib/engine", { BattleSession }],
  ]);
  return createFullTrustCodeModRuntime(await resolveCodeModProfile([pkg, ...earlier]), {
    modules: {
      list: () => [...modules.keys()], has: (id) => modules.has(id),
      load: async (id) => {
        if (!modules.has(id)) throw new Error(`Unexpected module ${id}`);
        return modules.get(id);
      },
    },
  });
}
// Private fields are intentional v4 mod seams, exercised at runtime rather than asserted by text.
type Internal = any;
async function fixture(count = 3, options: { teams?: [TeamMemberSetup[], TeamMemberSetup[]]; seed?: number } = {}) {
  const active = await runtime();
  const session = new BattleSession(data, options.teams ?? [
    Array.from({ length: count }, () => ({ shortType: "FireCub", level: 30 })),
    Array.from({ length: count }, () => ({ shortType: "SnowCub", level: 30 })),
  ], mulberry32(options.seed ?? 7));
  const { RealtimeCombatClock } = active.host.require<Internal>("mods.dev.dragonislandblue.realtime-combat");
  const clock: Internal = new RealtimeCombatClock(session);
  const dispose = () => { clock.dispose(); active.dispose(); };
  return { active, session, clock, dispose };
}
function advance(clock: Internal, ms: number) {
  clock.addElapsed(ms);
  while (clock.tick() !== undefined) { /* each TU runs the real buff/death pipeline */ }
}
function schedule(clock: Internal, id: string, tu: number) {
  clock.queue.setTime(id, clock.time + tu);
  clock.refresh();
}
function automatic(clock: Internal) {
  const id = clock.automaticId();
  expect(id).toBeDefined();
  return clock.act(id, () => clock.session.submitEnemyAction());
}

describe("Realtime Combat executable mod", () => {
  it("keeps original starting TU and advances exactly once per 20 ms, independent of frame divisions", async () => {
    const f = await fixture();
    try {
      const id = f.session.queueOrder()[0]!;
      const start = f.session.timeDelayOf(id);
      expect(start).toBeGreaterThan(0);
      advance(f.clock, 19);
      expect(f.session.timeDelayOf(id)).toBe(start);
      advance(f.clock, 1);
      expect(f.session.timeDelayOf(id)).toBe(start - 1);
      for (let i = 0; i < 60; i++) advance(f.clock, 1000 / 60);
      expect(f.clock.time).toBe(51);
      expect(f.session.timeDelayOf(id)).toBe(Math.max(0, start - 51));
      expect(f.clock.remainderMs).toBeCloseTo(0);
    } finally { f.dispose(); }
  });

  it("serves friendlies by arrival, keeps them at zero while waiting, and charges from submission time", async () => {
    const f = await fixture();
    try {
      const [a, b, c] = f.session.activeIdsOf(0) as [string, string, string];
      schedule(f.clock, a, 5); schedule(f.clock, b, 1); schedule(f.clock, c, 3);
      advance(f.clock, 2000);
      expect(f.clock.snapshot().readyFriendly).toEqual([b, c, a]);
      expect(f.clock.playerStep().actorId).toBe(b);
      expect(f.session.timeDelayOf(b)).toBe(0);
      f.clock.act(b, () => f.session.submitPlayerAction("usable2", [f.session.activeIdsOf(1)[0]!]));
      expect(f.session.timeDelayOf(b)).toBe(130);
      expect(f.clock.playerStep().actorId).toBe(c);
      expect(f.clock.time).toBe(100);
    } finally { f.dispose(); }
  });

  it("resolves all ready enemies at the same timestamp without consuming the pending friendly action", async () => {
    const f = await fixture();
    try {
      for (const id of f.session.queueOrder()) schedule(f.clock, id, 0);
      const step = f.clock.playerStep();
      f.clock.offer(step);
      for (const id of f.session.queueOrder().filter((entry) => f.session.teamOf(entry) === 1)) {
        const result = automatic(f.clock);
        expect(result.actorId).toBe(id);
        expect(result.events.find((e: Internal) => e.type === "turnStarted").time).toBe(0);
      }
      expect(f.clock.automaticId()).toBeUndefined();
      expect(f.clock.playerStep()).toBe(step);
      expect((f.session as Internal).pending.actorId).toBe(step.actorId);
      expect(f.clock.time).toBe(0);
    } finally { f.dispose(); }
  });

  it("queues Berserk allies behind a pending choice and dispatches them in readiness order", async () => {
    const f = await fixture(3, { teams: [
      ["FireCub", "Yeti", "Yeti"].map((shortType) => ({ shortType, level: 30 })),
      [{ shortType: "SnowCub", level: 100 }],
    ] });
    try {
      const [actor, later, earlier] = f.session.activeIdsOf(0) as [string, string, string];
      const enemy = f.session.activeIdsOf(1)[0]!;
      expect(f.session.isAiControlled(later)).toBe(true);
      expect(f.session.isAiControlled(earlier)).toBe(true);
      f.clock.core.livingOrThrow(actor).hp = 1000000; // isolate ordering from a lethal enemy roll
      schedule(f.clock, actor, 0); schedule(f.clock, later, 2); schedule(f.clock, earlier, 1);
      const choice = f.clock.playerStep();
      f.clock.offer(choice);
      advance(f.clock, 40);
      expect(f.clock.snapshot().readyFriendly).toEqual([actor, earlier, later]);
      expect(f.clock.automaticId()).toBeUndefined();
      expect(f.clock.step(earlier)).toBeUndefined();
      expect(f.clock.steps.has(earlier)).toBe(false);
      expect(() => f.clock.act(earlier, () => f.session.submitEnemyAction())).toThrow("waiting behind an ally");
      schedule(f.clock, enemy, 0);
      expect(automatic(f.clock).actorId).toBe(enemy);
      expect(f.clock.playerStep()).toBe(choice);
      f.clock.act(actor, () => f.session.submitPlayerAction("usable2", [enemy]));
      expect(f.clock.playerStep()).toBeUndefined();
      expect(automatic(f.clock).actorId).toBe(earlier);
      expect(automatic(f.clock).actorId).toBe(later);
      expect(f.clock.automaticId()).toBeUndefined();
    } finally { f.dispose(); }
  });

  it("does not prompt a later manual ally ahead of a Berserk ally", async () => {
    const f = await fixture(2, { teams: [
      ["Yeti", "FireCub"].map((shortType) => ({ shortType, level: 30 })),
      [{ shortType: "SnowCub", level: 100 }],
    ] });
    try {
      const [berserk, manual] = f.session.activeIdsOf(0) as [string, string];
      schedule(f.clock, berserk, 0); schedule(f.clock, manual, 0);
      expect(f.clock.playerStep()).toBeUndefined();
      expect(automatic(f.clock).actorId).toBe(berserk);
      expect(f.clock.playerStep().actorId).toBe(manual);
    } finally { f.dispose(); }
  });

  it("keeps status-forced allied turns in line and releases them when the head dies", async () => {
    const f = await fixture(5);
    try {
      const [head, sleeping] = f.session.activeIdsOf(0) as [string, string];
      schedule(f.clock, head, 0); schedule(f.clock, sleeping, 0);
      f.clock.core.addStatOnlyBuff(sleeping, { stats: [], amount: 0, duration: 100, statusEffects: ["Sleep"] });
      expect(f.clock.automaticId()).toBeUndefined();
      expect(f.clock.steps.has(sleeping)).toBe(false);
      f.clock.core.applyHpDelta(head, -1000000, f.session.activeIdsOf(1)[0], { element: "Water" });
      expect(f.clock.automaticId()).toBe(sleeping);
      expect(f.clock.step(sleeping)).toMatchObject({ type: "awaitingEnemy", forcedLooseTurn: true });
      expect(automatic(f.clock).actorId).toBe(sleeping);
      expect(f.clock.snapshot().readyFriendly).not.toContain(head);
    } finally { f.dispose(); }
  });

  it("removes a ready killed actor immediately and promotes reserves on both teams with a fresh countdown", async () => {
    const f = await fixture(5);
    try {
      for (const team of [0, 1] as const) {
        const id = f.session.activeIdsOf(team)[0]!;
        const reserve = f.session.benchIdsOf(team)[0]!;
        schedule(f.clock, id, 0);
        f.clock.step(id);
        const source = f.session.activeIdsOf(team === 0 ? 1 : 0)[0]!;
        f.clock.core.applyHpDelta(id, -1000000, source, { element: "Fire" });
        f.clock.refresh();
        expect(f.session.queueOrder()).not.toContain(id);
        expect(f.clock.ready.has(id)).toBe(false);
        expect(f.clock.step(id)).toBeUndefined();
        expect(() => f.clock.act(id, () => f.session.submitEnemyAction())).toThrow("no longer ready/alive");
        expect(f.session.activeIdsOf(team)).toContain(reserve);
        expect(f.session.timeDelayOf(reserve)).toBeGreaterThan(0);
        expect(f.clock.ready.has(reserve)).toBe(false);
      }
    } finally { f.dispose(); }
  });

  it("does not let a same-tick enemy killed by an earlier action retaliate", async () => {
    const f = await fixture(1, { teams: [
      [{ shortType: "FireCub", level: 100 }], [{ shortType: "SnowCub", level: 1, currentHp: 1 }],
    ] });
    try {
      for (const id of f.session.queueOrder()) schedule(f.clock, id, 0);
      const player = f.clock.playerStep().actorId;
      const enemy = f.clock.automaticId();
      f.clock.act(player, () => f.session.submitPlayerAction("usable1", [enemy]));
      expect(f.clock.ended).toBe(true);
      expect(f.clock.automaticId()).toBeUndefined();
      expect(f.session.events.filter((e) => e.type === "turnStarted")).toHaveLength(1);
      advance(f.clock, 10000);
      expect(f.clock.time).toBe(0);
    } finally { f.dispose(); }
  });

  it("ticks status expiry while a player is deciding and invalidates a newly sleeping actor", async () => {
    const f = await fixture();
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      schedule(f.clock, id, 0);
      expect(f.clock.playerStep().actorId).toBe(id);
      const before = f.session.events.length;
      f.clock.core.addStatOnlyBuff(id, { stats: [], amount: 0, duration: 3, statusEffects: ["Sleep"] });
      f.clock.refresh(f.session.events.slice(before));
      expect(f.clock.step(id)).toMatchObject({ type: "awaitingEnemy", forcedLooseTurn: true });
      advance(f.clock, 60);
      expect(f.session.statusEffectsOf(id)).not.toContain("Sleep");
      expect(f.clock.step(id).type).toBe("awaitingPlayer");
    } finally { f.dispose(); }
  });

  it("does not re-roll Confuse each frame while the same readiness is pending", async () => {
    const f = await fixture();
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      schedule(f.clock, id, 0);
      f.clock.core.addStatOnlyBuff(id, { stats: [], amount: 0, duration: 100, statusEffects: ["Confuse"] });
      const first = f.clock.step(id);
      for (let i = 0; i < 20; i++) {
        advance(f.clock, 20);
        expect(f.clock.step(id)).toBe(first);
      }
    } finally { f.dispose(); }
  });

  it("honors haste, move-to-front and positive TU additions without negative waiting credit", async () => {
    const f = await fixture();
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      schedule(f.clock, id, 0);
      advance(f.clock, 1000);
      f.clock.core.addStatOnlyBuff(id, { stats: [], amount: 0, duration: 1000, haste: -0.5 });
      f.clock.act(id, () => f.session.submitPlayerAction("usable2", [f.session.activeIdsOf(1)[0]!]));
      expect(f.session.timeDelayOf(id)).toBe(86);
      f.clock.queue.moveToFront(id);
      f.clock.refresh();
      expect(f.session.timeDelayOf(id)).toBe(0);
      advance(f.clock, 1000);
      f.clock.queue.addTime(id, 10);
      f.clock.refresh();
      expect(f.session.timeDelayOf(id)).toBe(10);
      expect(f.clock.ready.has(id)).toBe(false);
    } finally { f.dispose(); }
  });

  it("caps zero-cost moves at one action per tick", async () => {
    const f = await fixture();
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      schedule(f.clock, id, 0);
      // A successful custom no-cost transaction leaves the actor's schedule unchanged.
      f.clock.act(id, () => undefined);
      expect(f.session.timeDelayOf(id)).toBe(1);
      expect(f.clock.step(id)).toBeUndefined();
      advance(f.clock, 20);
      expect(f.clock.step(id).actorId).toBe(id);
    } finally { f.dispose(); }
  });

  it("keeps an open scripted move isolated while enemies attack and friendlies retain FIFO", async () => {
    const f = await fixture(3, { teams: [
      ["FireCub", "Yeti", "FireCub"].map((shortType) => ({ shortType, level: 30 })),
      [{ shortType: "SnowCub", level: 100 }],
    ] });
    try {
      const [actor, waiting] = f.session.activeIdsOf(0);
      f.clock.core.livingOrThrow(actor).hp = 1000000;
      schedule(f.clock, f.session.activeIdsOf(1)[0]!, 1000);
      schedule(f.clock, actor!, 0);
      schedule(f.clock, waiting!, 1);
      const opened = f.clock.act(actor, () => f.session.beginScriptedPlayerAction("usable2"));
      expect(opened.actorId).toBe(actor);
      advance(f.clock, 1000);
      expect(f.clock.playerStep()).toBeUndefined();
      expect(f.clock.automaticId()).toBeUndefined();
      expect(f.clock.step(waiting)).toBeUndefined();
      expect(f.clock.snapshot().ready).not.toContain(actor);
      const enemy = f.session.activeIdsOf(1)[0]!;
      schedule(f.clock, enemy, 0);
      expect(automatic(f.clock).actorId).toBe(enemy);
      expect((f.session as Internal).pendingScripted.actorId).toBe(actor);
      const result = f.session.performScriptedPlayerAbility({ enemyTargets: [enemy], friendlyTargets: [] });
      expect(result.events.some((e) => e.type === "damageDealt" && e.source === actor)).toBe(true);
      f.session.finishScriptedPlayerAction();
      expect(f.session.timeDelayOf(actor!)).toBe(130);
      expect(f.clock.playerStep()).toBeUndefined();
      expect(automatic(f.clock).actorId).toBe(waiting);
      expect(f.clock.time).toBe(50);
    } finally { f.dispose(); }
  });

  it("does not let a dead scripted caster deal further damage or return to readiness", async () => {
    const f = await fixture(5);
    try {
      const actor = f.session.activeIdsOf(0)[0]!;
      const enemy = f.session.activeIdsOf(1)[0]!;
      const reserve = f.session.benchIdsOf(0)[0]!;
      schedule(f.clock, actor, 0);
      f.clock.act(actor, () => f.session.beginScriptedPlayerAction("usable1"));
      f.clock.core.applyHpDelta(actor, -1000000, enemy, { element: "Water" });
      f.clock.refresh();
      const hp = f.session.hpOf(enemy);
      expect(f.session.performScriptedPlayerAbility({ enemyTargets: [enemy], friendlyTargets: [] }).events).toEqual([]);
      f.session.finishScriptedPlayerAction();
      expect(f.session.hpOf(enemy)).toBe(hp);
      expect(f.session.queueOrder()).not.toContain(actor);
      expect(f.clock.ready.has(actor)).toBe(false);
      expect(f.session.activeIdsOf(0)).toContain(reserve);
      expect(f.clock.playerStep()?.actorId).not.toBe(actor);
    } finally { f.dispose(); }
  });

  it("poison kills and replaces a ready friendly while no one submits a move", async () => {
    const f = await fixture(5);
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      const reserve = f.session.benchIdsOf(0)[0]!;
      schedule(f.clock, id, 0);
      f.clock.core.livingOrThrow(id).hp = 1;
      f.clock.core.applyAuthoredBuff(id, {
        type: "Offensive.Poison", arguments: { duration: 10, roll: { relatedStat: "Attack" } },
      }, f.session.activeIdsOf(1)[0]!);
      advance(f.clock, 200);
      expect(f.session.events.some((e) => e.type === "damageDealt" && e.cause === "poisonTick")).toBe(true);
      expect(f.session.deadIdsOf(0)).toContain(id);
      expect(f.clock.ready.has(id)).toBe(false);
      expect(f.session.activeIdsOf(0)).toContain(reserve);
      expect(f.session.timeDelayOf(reserve)).toBeGreaterThan(0);
    } finally { f.dispose(); }
  });

  it("DeathSentence ends an idle battle once, on the exact expiry TU", async () => {
    const f = await fixture(1);
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      f.clock.core.applyAuthoredBuff(id, {
        type: "Offensive.DeathSentence", arguments: { duration: 3 },
      }, f.session.activeIdsOf(1)[0]!);
      advance(f.clock, 59);
      expect(f.clock.ended).toBe(false);
      advance(f.clock, 1);
      expect(f.clock.ended).toBe(true);
      expect(f.clock.time).toBe(3);
      expect(f.session.events.filter((e) => e.type === "battleEnded")).toHaveLength(1);
    } finally { f.dispose(); }
  });

  it("switching a waiting actor removes readiness and schedules the incoming reserve from now", async () => {
    const f = await fixture(5);
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      schedule(f.clock, id, 0);
      advance(f.clock, 1000);
      f.clock.core.switchWithRandomReserve(id, id);
      f.clock.refresh();
      expect(f.session.benchIdsOf(0)).toContain(id);
      expect(f.clock.ready.has(id)).toBe(false);
      const event = [...f.session.events].reverse().find((e) => e.type === "switched");
      expect(event?.type).toBe("switched");
      if (event?.type === "switched") expect(f.session.timeDelayOf(event.in)).toBeGreaterThan(0);
    } finally { f.dispose(); }
  });

  it("a replacement spirit gets a fresh countdown and the old summon cannot act", async () => {
    const f = await fixture();
    try {
      const spirits = data.allMonsters().filter((monster) => monster.category === "Summon");
      const old = f.session.summonSpirit(spirits[0]!.shortType, 0).id;
      schedule(f.clock, old, 0);
      const next = f.session.summonSpirit(spirits[1]!.shortType, 0).id;
      f.clock.refresh();
      expect(f.session.queueOrder()).not.toContain(old);
      expect(f.clock.ready.has(old)).toBe(false);
      expect(f.session.timeDelayOf(next)).toBeGreaterThan(0);
      schedule(f.clock, next, 0);
      expect(f.clock.step(next).type).toBe("awaitingEnemy");
    } finally { f.dispose(); }
  });

  it("reflection can kill the attacker mid-action without resurrecting its cooldown", async () => {
    const f = await fixture(5);
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      const target = f.session.activeIdsOf(1)[0]!;
      f.clock.core.livingOrThrow(id).hp = 1;
      f.clock.core.applyAuthoredBuff(target, {
        type: "Offensive.FixedReflection", arguments: { duration: 500 },
      }, target);
      schedule(f.clock, id, 0);
      f.clock.act(id, () => f.session.submitPlayerAction("usable1", [target]));
      expect(f.session.deadIdsOf(0)).toContain(id);
      expect(f.session.queueOrder()).not.toContain(id);
      expect(f.clock.ready.has(id)).toBe(false);
      expect(f.session.activeIdsOf(0)).toHaveLength(3);
    } finally { f.dispose(); }
  });

  it("capture removes a ready enemy and backfills the queue once", async () => {
    const f = await fixture(5);
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      const target = f.session.activeIdsOf(1)[0]!;
      const reserve = f.session.benchIdsOf(1)[0]!;
      schedule(f.clock, id, 0); schedule(f.clock, target, 0);
      f.clock.core.livingOrThrow(target).hp = 1;
      const rng = (f.session as Internal).rng;
      rng.next = () => 0;
      rng.intBelow = () => 0;
      const events = f.clock.act(id, () => f.session.submitCaptureAction(target, 3, 100));
      expect(events.some((e: Internal) => e.type === "captured" && e.living === target)).toBe(true);
      expect(f.session.queueOrder()).not.toContain(target);
      expect(f.clock.ready.has(target)).toBe(false);
      expect(f.session.activeIdsOf(1)).toContain(reserve);
      expect(f.session.timeDelayOf(reserve)).toBeGreaterThan(0);
    } finally { f.dispose(); }
  });

  it("the scene pump keeps attacking during a pending choice and releases its ticker on teardown", async () => {
    const active = await runtime([`
      const { BattleNode } = await dibMod.modules.load("web/battle/battleNode.ts");
      dibMod.intercept(BattleNode.prototype, "loop", async function(next) {
        this.characterLoopEntered = true;
        try { return await next(); } finally { this.characterLoopExited = true; }
      });
      dibMod.intercept(BattleNode.prototype, "playTurn", async function(next, ...args) {
        await this.dialogueGate;
        const previous = this.effectContext;
        this.effectContext = args[1];
        args[0] = args[0].map(event => event.type === "damageDealt" ? {...event, hpAfter: 999999} : event);
        try { return next(...args); } finally { this.effectContext = previous; }
      });
    `]);
    const session = new BattleSession(data, [
      ["FireCub", "Yeti", "FireCub"].map((shortType) => ({ shortType, level: 100 })),
      Array.from({ length: 3 }, () => ({ shortType: "SnowCub", level: 5 })),
    ], mulberry32(7));
    const abort = new AbortController();
    const cleanup: Array<() => void> = [];
    const listeners = new Set<() => void>();
    const ticker = { elapsedMS: 0, speed: 3, add: (cb: () => void) => listeners.add(cb),
      remove: (cb: () => void) => listeners.delete(cb) };
    const node: Internal = new FakeBattleNode();
    let choose: (value: unknown) => void = () => {};
    let prompted: Internal;
    const played: string[] = [];
    let releaseDialogue: () => void = () => {};
    Object.assign(node, {
      session, stage: { app: { ticker } },
      effectLayer: { eventMode: "passive" },
      lifecycle: { signal: abort.signal, get disposed() { return abort.signal.aborted; },
        add: (cb: () => void) => cleanup.push(cb) },
      turnOrder: { entries: new Map(), initialize: async () => {}, notifyBattleTimePassed: async () => {} },
      statusText: { clearStatusText() {} },
      friendlyDisplay: { notifyPlayerTurnStarted() {}, setSummonSelectMode() {} },
      enemyDisplay: { monsterSpriteOf: () => ({}) },
      targetPicker: { cancel() {} },
      setPanelShown() {}, setPresentationState() {}, applyStatusOverlayEvents() {},
      awaitPlayerChoice(step: Internal) {
        prompted = step;
        return new Promise((resolve) => {
          choose = resolve;
          node.cancelPendingChoice = () => resolve({ kind: "cancelled" });
        });
      },
      played, effectContexts: [], dialogueGate: new Promise<void>((resolve) => { releaseDialogue = resolve; }),
    });
    const done = node.loop();
    const flush = async () => { for (let i = 0; i < 2500; i++) await Promise.resolve(); };
    try {
      await flush();
      expect(listeners.size).toBe(1);
      expect(node.characterLoopEntered).toBe(true);
      expect(node.effectLayer.eventMode).toBe("none");
      expect(node.enemyDisplay.monsterSpriteOf("removed-or-unknown")).toBeNull();
      expect(node.enemyDisplay.monsterSpriteOf(session.activeIdsOf(1)[0])).not.toBeNull();
      const [manual, berserk, last] = session.activeIdsOf(0);
      for (const [index, id] of [manual, berserk, last].entries()) {
        (session as Internal).core.queue.setTime(id, index + 1);
      }
      ticker.elapsedMS = 2000;
      for (const listener of listeners) listener();
      await flush();
      expect(played).toHaveLength(0); // dialogue holds only art, not HP/TU or other actors
      expect(node.hpUpdates).toBeGreaterThanOrEqual(3);
      expect(node.renderGameState().codeMods.realtimeCombat.pendingModPresentations).toBe(3);
      const first = prompted;
      expect(first.actorId).toBeDefined();
      expect(node.renderGameState().codeMods.realtimeCombat.elapsedTu).toBe(100);
      ticker.elapsedMS = 4000;
      for (const listener of listeners) listener();
      await flush();
      expect(node.renderGameState().codeMods.realtimeCombat.automaticActions).toBeGreaterThan(3);
      expect(prompted).toBe(first);
      expect(node.renderGameState().codeMods.realtimeCombat.readyFriendly).toEqual([manual, berserk, last]);
      expect(session.events.filter((event) => event.type === "turnStarted" &&
        session.teamOf(event.living) === 0)).toEqual([]);
      // No submission is needed to advance clock or AI, and the unchanged choice stays open.
      expect(typeof choose).toBe("function");
      // A hero summon is committed outside playTurn. Wait only for its display construction,
      // then resume the accrued tick; the outgoing summon must lose input immediately.
      const spirit = data.allMonsters().find((monster) => monster.category === "Summon")!;
      session.summonSpirit(spirit.shortType, 0);
      let releaseRoster: () => void = () => {};
      node.rosterConstruction = new Promise<void>((resolve) => { releaseRoster = resolve; });
      const retiringDisplay = { eventMode: "static" };
      node.tryNode = () => retiringDisplay;
      const beforeEvents = session.events.length;
      const summoned = session.summonSpirit(spirit.shortType, 0).id;
      const building = node.applyRosterEvents(session.events.slice(beforeEvents));
      const beforeTime = node.renderGameState().codeMods.realtimeCombat.elapsedTu;
      ticker.elapsedMS = 20;
      for (const listener of listeners) listener();
      await flush();
      expect(retiringDisplay.eventMode).toBe("none");
      expect(node.renderGameState().codeMods.realtimeCombat.elapsedTu).toBe(beforeTime);
      releaseRoster();
      await building;
      await flush();
      const resumed = node.renderGameState().codeMods.realtimeCombat;
      expect(resumed.elapsedTu).toBe(beforeTime + 1);
      expect(resumed.tu[summoned]).toBeGreaterThan(0);
      expect(resumed.invalidatedChoices).toBeGreaterThan(0);
      const committedPresentations = node.renderGameState().codeMods.realtimeCombat.automaticActions;
      releaseDialogue();
      await flush();
      expect(played).toHaveLength(committedPresentations); // late next never double-replays HP/deaths
      expect(node.effectContexts).toEqual(played);
      for (const [id, hp] of node.hpValues) expect(hp).toBe(session.hpOf(id));
      expect(node.renderGameState().codeMods.realtimeCombat.pendingModPresentations).toBe(0);
      abort.abort();
      await done;
      expect(node.characterLoopExited).toBe(true);
      expect(listeners.size).toBe(0);
    } finally {
      abort.abort();
      releaseDialogue();
      await done;
      cleanup.forEach((cb) => cb());
      active.dispose();
    }
  });

  it("stops on retreat and restores all instance seams without changing ordinary sessions", async () => {
    const f = await fixture();
    try {
      const id = f.session.activeIdsOf(0)[0]!;
      schedule(f.clock, id, 0);
      const result = f.clock.act(id, () => f.session.submitRetreatAction(100));
      expect(result.success).toBe(true);
      expect(f.clock.ended).toBe(true);
      advance(f.clock, 5000);
      expect(f.clock.time).toBe(0);
      f.clock.dispose();
      expect(Object.hasOwn(f.session, "timeDelayOf")).toBe(false);
      expect(Object.hasOwn(f.clock.queue, "advanceTimeToNext")).toBe(false);
      const ordinary = new BattleSession(data, [
        [{ shortType: "FireCub", level: 30 }], [{ shortType: "SnowCub", level: 30 }],
      ], mulberry32(7));
      ordinary.advanceForPresentation();
      expect(ordinary.timeDelayOf(ordinary.queueOrder()[0]!)).toBe(0);
    } finally { f.dispose(); }
  });

  it("finishes seeded reserve battles deterministically without dead actors or stalled readiness", async () => {
    for (const seed of [1, 7, 19, 91, 2026]) {
      const f = await fixture(6, { seed });
      try {
        for (let tick = 0; tick < 15000 && !f.clock.ended; tick++) {
          advance(f.clock, 20);
          let id;
          while ((id = f.clock.automaticId()) !== undefined) automatic(f.clock);
          const step = f.clock.playerStep();
          if (step) f.clock.act(step.actorId, () => f.session.submitPlayerAction(
            "usable1", [f.session.targetableIdsOf(1)[0]!],
          ));
          const queue = f.session.queueOrder();
          expect(new Set(queue).size).toBe(queue.length);
          for (const queued of queue) expect(f.clock.core.isAlive(queued)).toBe(true);
        }
        expect(f.clock.ended).toBe(true);
        expect(f.session.events.filter((e) => e.type === "battleEnded")).toHaveLength(1);
        const dead = new Set<string>();
        for (const event of f.session.events) {
          if (event.type === "died") dead.add(event.living);
          if (event.type === "turnStarted") expect(dead.has(event.living)).toBe(false);
        }
      } finally { f.dispose(); }
    }
  });
});
