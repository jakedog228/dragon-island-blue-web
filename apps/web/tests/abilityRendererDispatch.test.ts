import { describe, it, expect, vi, beforeEach } from "vitest";

const particleConstructorOptions = vi.hoisted(() => [] as Array<Record<string, unknown>>);

// pixi.js cannot be imported for real under vitest's Node environment (module-scope browser
// sniffing) -- same mocking approach as statusText.test.ts. renderResult's DISPATCH logic (which
// branch handles which event, the renderedTargets/phaseResolved dedupe rules, sfx gating) is what
// these tests pin; every spawn* method is stubbed, so no real texture/animation machinery runs.
vi.mock("pixi.js", () => {
  const makePoint = (v: number) => ({
    x: v,
    y: v,
    set(a: number, b: number = a) {
      this.x = a;
      this.y = b;
    },
  });
  class Container {
    children: Container[] = [];
    label = "";
    sortableChildren = false;
    position = makePoint(0);
    scale = makePoint(1);
    visible = true;
    destroyed = false;
    addChild<T extends Container>(c: T): T {
      this.children.push(c);
      return c;
    }
    removeChild<T extends Container>(c: T): T {
      this.children = this.children.filter((x) => x !== c);
      return c;
    }
    toGlobal(p: { x: number; y: number }): { x: number; y: number } {
      return { x: p.x, y: p.y };
    }
    toLocal(p: { x: number; y: number }): { x: number; y: number } {
      return { x: p.x, y: p.y };
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class Graphics extends Container {}
  class Sprite extends Container {}
  class Texture {}
  return { Container, Graphics, Sprite, Texture };
});
vi.mock("@dib/renderer", () => ({
  buildAnimation: vi.fn(),
  makeTtfLabel: vi.fn(),
  pointSprite: vi.fn(),
  CONTENT_SCALE_FACTOR: 2,
}));
vi.mock("@dib/renderer/animations", () => ({
  resolveAnimation: vi.fn(() => ({ entry: { spritesheets: [], numFrames: 1, fps: 24 } })),
}));
vi.mock("../src/sourcePointParticleSystem.js", () => ({
  SourcePointParticleSystem: class {
    destroyed = false;
    zIndex = 0;
    position = { set: () => undefined };
    completion = Promise.resolve();
    constructor(options: Record<string, unknown>) {
      particleConstructorOptions.push(options);
    }
    start() {}
    destroy() { this.destroyed = true; }
  },
}));

import { Container } from "pixi.js";
import type { Ticker } from "pixi.js";
import { loadGameData } from "@dib/gamedata";
import type { BattleEvent } from "@dib/engine";
import { AbilityRenderer, type TargetNodeLookup } from "../src/battle/abilityRenderer.js";

const gd = loadGameData();

interface Spied {
  renderer: AbilityRenderer;
  animations: Array<{ name: string }>;
  floaters: Array<{ text: string }>;
  particles: string[];
  sfx: string[];
  /** Unified dispatch order across every spawn* kind. Since AbilityRenderer reserves paint order
   * (→ zIndex) synchronously at dispatch, before any await, dispatch order IS paint order (lower
   * index = painted underneath). Lets a test assert reactive-vs-ability-own layering. */
  seq: string[];
  nodes: TargetNodeLookup;
}

function makeRenderer(): Spied {
  const sfx: string[] = [];
  const renderer = new AbilityRenderer({
    gameData: gd,
    animations: {} as never,
    meleeAttacks: {} as never,
    assets: {} as never,
    audio: { playSfx: (name) => sfx.push(name) },
    effectLayer: new Container() as never,
    ticker: { add: () => undefined, remove: () => undefined } as unknown as Ticker,
  });
  const animations: Array<{ name: string }> = [];
  const floaters: Array<{ text: string }> = [];
  const particles: string[] = [];
  const seq: string[] = [];
  const r = renderer as unknown as Record<string, unknown>;
  r["spawnAnimationEffect"] = async (name: string) => {
    animations.push({ name });
    seq.push(`anim:${name}`);
  };
  r["spawnFloater"] = async (text: string) => {
    floaters.push({ text });
    seq.push(`floater:${text}`);
  };
  r["spawnMeleeEffect"] = async (key: string) => {
    seq.push(`melee:${key}`);
  };
  r["spawnImageEffectFromData"] = async (b: Record<string, unknown>) => {
    seq.push(`image:${String(b["spriteframe"] ?? b["spriteFile"] ?? "?")}`);
  };
  r["spawnParticleEffect"] = async (file: string) => {
    particles.push(file);
    seq.push(`particle:${file}`);
  };
  const nodes: TargetNodeLookup = {
    displayAreaOf: () => ({ node: new Container() as never, width: 40, height: 40 }),
    sameTeam: () => true,
  };
  return { renderer, animations, floaters, particles, sfx, seq, nodes };
}

const CASTER = "t1m0:BatSquirrel";

beforeEach(() => {
  particleConstructorOptions.length = 0;
});

describe("source point-particle dispatch", () => {
  it("forwards only the separate libc-random test seam into native particle emitters", async () => {
    const particleRandom = vi.fn(() => 0.25);
    const renderer = new AbilityRenderer({
      gameData: gd,
      animations: {} as never,
      meleeAttacks: {} as never,
      assets: { particle: async () => ({}) } as never,
      audio: { playSfx: () => undefined },
      effectLayer: new Container() as never,
      ticker: { add: () => undefined, remove: () => undefined } as unknown as Ticker,
      particleRandom,
    });

    await (renderer as unknown as {
      spawnParticleEffect(file: string, rect: { x: number; y: number; width: number; height: number }): Promise<void>;
    }).spawnParticleEffect("Cast.plist", { x: 0, y: 0, width: 40, height: 40 });

    expect(particleConstructorOptions).toHaveLength(1);
    expect(particleConstructorOptions[0]?.["rand"]).toBe(particleRandom);
  });

  it("renders Ice Storm's source-local Cast and whole-screen FrostGlobal builders", async () => {
    const s = makeRenderer();
    await s.renderer.renderSourceEffects(CASTER, s.nodes, {
      abilityPath: "Offensive.IceStorm",
      tier: 1,
    });
    expect(s.particles).toEqual(["Cast.plist", "FrostGlobal.plist"]);
  });

  it("renders Ice Storm's Frost point system on a damaged target", async () => {
    const s = makeRenderer();
    const target = "t0m0:Minotaur";
    await s.renderer.renderResult([
      { type: "damageDealt", source: CASTER, target, amount: 12, element: "Water", hpAfter: 30 },
    ], s.nodes, { abilityPath: "Offensive.IceStorm", tier: 1 });
    expect(s.particles).toEqual(["Frost.plist"]);
  });

  it("renders Ice Storm's Frost point system for its Sleep buff result", async () => {
    const s = makeRenderer();
    s.nodes.sameTeam = () => false;
    const target = "t0m0:Minotaur";
    await s.renderer.renderResult([{
      type: "buffAdded",
      target,
      source: CASTER,
      buffType: "Offensive.Sleep",
      statusEffects: ["Sleep"],
      permanent: false,
      duration: 500,
    }], s.nodes, { abilityPath: "Offensive.IceStorm", tier: 1 });
    expect(s.particles).toEqual(["Frost.plist"]);
  });






  it("shows the healing floater without the never-scheduled Heal point system", async () => {
    const s = makeRenderer();
    await s.renderer.renderResult([
      { type: "healed", source: CASTER, target: CASTER, amount: 9, hpAfter: 45 },
    ], s.nodes, { abilityPath: "Defensive.Heal", tier: 1 });
    expect(s.particles).toEqual([]);
    expect(s.floaters).toEqual([{ text: "+9" }]);
  });

  // Feed (`Offensive.DrainHealth`, BatSquirrel usable1 / Vampire usable3) is the user-reachable
  // carrier of that heal branch: the enemy-side authored `Drain` animation and both numbers must
  // survive; only the healed-monster emitter is absent.
  it("keeps Feed's enemy Drain animation and both numbers, with no Heal emitter", async () => {
    const s = makeRenderer();
    const enemy = "t0m0:Minotaur";
    s.nodes.sameTeam = (source: string, target: string) => source === target;
    await s.renderer.renderResult([
      { type: "damageDealt", source: CASTER, target: enemy, amount: 12, hpAfter: 30 },
      { type: "healed", source: CASTER, target: CASTER, amount: 6, hpAfter: 45 },
    ] as BattleEvent[], s.nodes, { abilityPath: "Offensive.DrainHealth", tier: 1 });
    expect(s.animations.map((a) => a.name)).toContain("Drain");
    expect(s.particles).toEqual([]);
    expect(s.floaters).toEqual([{ text: "-12" }, { text: "+6" }]);
  });
});

describe("renderResult dispatch -- buff-cast flash vs the phaseResolved fallback", () => {
  let s: Spied;
  beforeEach(() => {
    s = makeRenderer();
  });

  it("stacking-REJECTED re-cast (no buffAdded, only success effectText) still flashes via phaseResolved", async () => {





    const events: BattleEvent[] = [
      { type: "abilityUsed", source: CASTER, ability: "Defensive.HasteUp", targets: [CASTER] },
      { type: "effectText", target: CASTER, effect: { kind: "haste", direction: "up", amount: 20 } },
      { type: "phaseResolved", phase: "friends", source: CASTER, targets: [CASTER] },
    ];
    await s.renderer.renderResult(events, s.nodes, { abilityPath: "Defensive.HasteUp", tier: 1 });
    expect(s.animations.map((a) => a.name)).toEqual(["HasteUp"]);
    expect(s.sfx).toEqual(["Quick.m4a"]);
    expect(s.floaters).toHaveLength(1); // the haste text still floats
  });

  it("successful cast (buffAdded present) flashes exactly once -- phaseResolved must not double-render", async () => {
    const events: BattleEvent[] = [
      { type: "abilityUsed", source: CASTER, ability: "Defensive.HasteUp", targets: [CASTER] },
      {
        type: "buffAdded",
        target: CASTER,
        source: CASTER,
        buffType: "StatOnly",
        statusEffects: [],
        permanent: false,
        duration: 500,
      },
      { type: "effectText", target: CASTER, effect: { kind: "haste", direction: "up", amount: 20 } },
      { type: "phaseResolved", phase: "friends", source: CASTER, targets: [CASTER] },
    ];
    await s.renderer.renderResult(events, s.nodes, { abilityPath: "Defensive.HasteUp", tier: 1 });
    expect(s.animations.map((a) => a.name)).toEqual(["HasteUp"]);
    expect(s.sfx).toEqual(["Quick.m4a"]);
  });

  it("an ApplyChance miss still plays the phase's flash (Miss text is a result PARAMETER)", async () => {







    const target = "t0m0:Minotaur";
    const events: BattleEvent[] = [
      { type: "abilityUsed", source: CASTER, ability: "Offensive.Sleep.Sleep", targets: [target] },
      { type: "effectText", target, effect: { kind: "miss" } },
      { type: "phaseResolved", phase: "enemy", source: CASTER, targets: [target] },
    ];
    await s.renderer.renderResult(events, s.nodes, { abilityPath: "Offensive.Sleep.Sleep", tier: 1 });
    expect(s.animations.map((a) => a.name)).toEqual(["Sleep"]);
    expect(s.floaters).toHaveLength(1); // the Miss text
    expect(s.sfx).toHaveLength(1); // and the cast sfx, which the suppression also ate
  });

  it("collateral buffAdded (cause: proc) never gets the acting move's cast flash", async () => {
    const bystander = "t0m0:Minotaur";
    const events: BattleEvent[] = [
      { type: "abilityUsed", source: CASTER, ability: "Defensive.HasteUp", targets: [CASTER] },
      {
        type: "buffAdded",
        target: bystander,
        source: CASTER,
        buffType: "StatOnly",
        statusEffects: [],
        permanent: false,
        duration: 500,
        cause: "proc",
      },
      { type: "phaseResolved", phase: "friends", source: CASTER, targets: [CASTER] },
    ];
    await s.renderer.renderResult(events, s.nodes, { abilityPath: "Defensive.HasteUp", tier: 1 });
    // Only the caster's own phaseResolved flash -- nothing on the proc'd bystander.
    expect(s.animations.map((a) => a.name)).toEqual(["HasteUp"]);
  });

  it("collateral damageDealt (cause: poisonTick) draws NO floater -- ticks build no AbilityResult", async () => {










    const victim = "t0m0:Minotaur";
    const events: BattleEvent[] = [
      { type: "damageDealt", source: victim, target: victim, amount: 7, element: "Fire", hpAfter: 40, cause: "poisonTick" },
    ];
    await s.renderer.renderResult(events, s.nodes, { abilityPath: "Defensive.HasteUp", tier: 1 });
    expect(s.floaters).toHaveLength(0);
    expect(s.animations).toHaveLength(0);
    expect(s.sfx).toHaveLength(0);
  });
});

describe("reactive-buff effect layering (effect-text.md / gui/status-effects.md §4)", () => {
  let s: Spied;
  beforeEach(() => {
    s = makeRenderer();
  });

  const VICTIM = "t0m0:Minotaur";

  it("Thorns flash paints UNDER the striking move's art and damage number", async () => {






    const events: BattleEvent[] = [
      { type: "abilityUsed", source: CASTER, ability: "Offensive.Air.Air", targets: [VICTIM] },
      { type: "damageDealt", source: CASTER, target: VICTIM, amount: 12, element: "Air", hpAfter: 30 },
      { type: "buffTriggered", living: VICTIM, buffType: "Offensive.FixedReflection" },
      { type: "phaseResolved", phase: "enemy", source: CASTER, targets: [VICTIM] },
    ];
    await s.renderer.renderResult(events, s.nodes, { abilityPath: "Offensive.Air.Air", tier: 1, meleeKey: "Punch" });
    // thorns dispatched first (lowest paint order = underneath); the attack's own art/number after.
    expect(s.seq[0]).toBe("image:thorns.png");
    expect(s.seq.indexOf("image:thorns.png")).toBeLessThan(s.seq.indexOf("anim:Air"));
    expect(s.seq.indexOf("anim:Air")).toBeLessThan(s.seq.findIndex((x) => x.startsWith("floater:")));
  });

  it("reflected damage draws its own red number over the ATTACKER, under the move art", async () => {








    const events: BattleEvent[] = [
      { type: "abilityUsed", source: CASTER, ability: "Offensive.Air.Air", targets: [VICTIM] },
      { type: "damageDealt", source: CASTER, target: VICTIM, amount: 12, element: "Air", hpAfter: 30 },
      { type: "buffTriggered", living: VICTIM, buffType: "Offensive.FixedReflection" },
      { type: "damageDealt", source: VICTIM, target: CASTER, amount: 5, element: "Air", hpAfter: 55, cause: "reflected" },
      { type: "phaseResolved", phase: "enemy", source: CASTER, targets: [VICTIM] },
    ];
    await s.renderer.renderResult(events, s.nodes, { abilityPath: "Offensive.Air.Air", tier: 1, meleeKey: "Punch" });
    // Both numbers present: the reflect's -5 on the attacker and the move's own -12 on the victim.
    expect(s.floaters.map((f) => f.text)).toEqual(["-5", "-12"]);
    // Result A (thorns flash) then result B (number) -- array order -- then the ability's own art.
    expect(s.seq[0]).toBe("image:thorns.png");
    expect(s.seq[1]).toBe("floater:-5");
    expect(s.seq.indexOf("floater:-5")).toBeLessThan(s.seq.indexOf("anim:Air"));
    // The reflect contributes no art of its own: Air is still the only animation.
    expect(s.animations.map((a) => a.name)).toEqual(["Air"]);
  });

  it("proc STUN! (StunProcBuff, reactive) paints UNDER the attack, unlike a direct stun", async () => {



    const proc: BattleEvent[] = [
      { type: "abilityUsed", source: CASTER, ability: "Offensive.Air.Air", targets: [VICTIM] },
      { type: "damageDealt", source: CASTER, target: VICTIM, amount: 12, element: "Air", hpAfter: 30 },
      { type: "stunned", target: VICTIM, source: CASTER, delay: 200, reactive: true },
      { type: "phaseResolved", phase: "enemy", source: CASTER, targets: [VICTIM] },
    ];
    await s.renderer.renderResult(proc, s.nodes, { abilityPath: "Offensive.Air.Air", tier: 1, meleeKey: "Punch" });
    expect(s.seq[0]).toBe("floater:StunKey");
    expect(s.seq.indexOf("floater:StunKey")).toBeLessThan(s.seq.indexOf("anim:Air"));
  });

  it("direct stun (Howl) keeps STUN! ABOVE the phase's Stop animation (no regression)", async () => {
    const direct: BattleEvent[] = [
      { type: "abilityUsed", source: CASTER, ability: "Offensive.Stun.Stun", targets: [VICTIM] },
      { type: "stunned", target: VICTIM, source: CASTER, delay: 200 },
      { type: "phaseResolved", phase: "enemy", source: CASTER, targets: [VICTIM] },
    ];
    await s.renderer.renderResult(direct, s.nodes, { abilityPath: "Offensive.Stun.Stun", tier: 1 });
    // "Stop" reserves its slot at phaseResolved; the deferred STUN! floater flushes AFTER → above.
    expect(s.seq.indexOf("anim:Stop")).toBeLessThan(s.seq.indexOf("floater:StunKey"));
  });
});
