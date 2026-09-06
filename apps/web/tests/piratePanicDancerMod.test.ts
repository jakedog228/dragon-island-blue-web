import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { tween } from "../src/tween.js";
import * as engine from "@dib/engine";
import { battleLivingId, buildPlayerChoices, mulberry32 } from "@dib/engine";
import { GameData } from "@dib/gamedata/browser";
import { importCodeModArchive, resolveCodeModProfile } from "@dib/mod-kernel";
import { parseColoredBitmapText } from "@dib/renderer";
import { createFullTrustCodeModRuntime } from "../src/content/codeModRuntime.js";
import { decodeNativeSaveDocument } from "../src/player/nativeSave/nativeSaveDocument.js";
import { importNativeSave } from "../src/player/nativeSave/nativeSaveTranslate.js";

const workspace = resolve(import.meta.dirname, "../../..");
const modRoot = resolve(workspace, "examples/mods/pirate-panic-dancer");

class FakeDisplay extends EventEmitter {
  children: FakeDisplay[] = [];
  parent?: FakeDisplay;
  destroyed = false;
  position = { x: 0, y: 0, set() {} };
  scale = { x: 1, y: 1, set() {} };
  anchor = { set() {} };
  addChild(...children: FakeDisplay[]) {
    this.children.push(...children);
    for (const child of children) child.parent = this;
    return children[0];
  }
  destroy() {
    this.destroyed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.removeAllListeners();
  }
}
class FakeGraphics extends FakeDisplay {
  ellipse() { return this; }
  rect() { return this; }
  fill() { return this; }
}
class FakeAssetLibrary {
  async atlas() { return { textures: {} as Record<string, unknown> }; }
  async sprite() { return {}; }
}
class FakeBattleNode {
  start() {}
  baseTurn = vi.fn(async (..._args: unknown[]) => {});
  async playTurn(...args: unknown[]) { await this.baseTurn(...args); }
  renderGameState() { return {}; }
}

async function runtime(overrides: Record<string, unknown> = {}) {
  const archive = await importCodeModArchive(zipSync({
    "manifest.json": new Uint8Array(await readFile(resolve(modRoot, "manifest.json"))),
    "scripts/main.js": new Uint8Array(await readFile(resolve(modRoot, "scripts/main.js"))),
  }), "pirate-panic-dancer.dibmod");
  const profile = await resolveCodeModProfile([archive]);
  const modules = new Map<string, unknown>([
    ["@dib/engine", engine],
    ["@dib/renderer", {
      AssetLibrary: FakeAssetLibrary,
      pointSprite: () => new FakeDisplay(),
    }],
    ["pixi.js", {
      Container: FakeDisplay,
      Graphics: FakeGraphics,
      RenderTexture: { create: () => ({ destroy() {} }) },
      Sprite: FakeDisplay,
    }],
    ["web/battle/battleNode.ts", { BattleNode: FakeBattleNode }],
    ["web/world/guildQuestChat.ts", {
      showGuildQuestChat: async () => ({
        root: new FakeDisplay(),
        closed: Promise.resolve(),
        dismiss() {},
      }),
    }],
    ["web/tween.ts", { tween: async () => undefined }],
    ["web/displayMode.ts", {
      screenPointsForMode: (mode: string) => mode === "ipad"
        ? { w: 512, h: 384 }
        : { w: 480, h: 320 },
    }],
    ["web/runtimeSettings.ts", { DISPLAY_MODE: "iphone" }],
  ]);
  for (const [id, module] of Object.entries(overrides)) modules.set(id, module);
  return await createFullTrustCodeModRuntime(profile, {
    modules: {
      list: () => [...modules.keys()],
      has: (id) => modules.has(id),
      load: async (id) => {
        const loaded = modules.get(id);
        if (loaded === undefined) throw new Error(`unknown test module ${id}`);
        return loaded;
      },
    },
  });
}

const raw = async (name: string): Promise<Record<string, unknown>> => JSON.parse(
  await readFile(resolve(workspace, `extracted/data/${name}.json`), "utf8"),
) as Record<string, unknown>;

async function load(active: Awaited<ReturnType<typeof runtime>>) {
  const [monsters, jobs, abilities, abilityComponents, buffs, items, combines, licenses, tournaments] = await Promise.all([
    raw("Monsters"), raw("Jobs"), raw("Abilities"), raw("AbilityComponents"), raw("Buffs"),
    raw("Items"), raw("Combines"), raw("Licenses"), raw("Tournaments"),
  ]);
  const content = await active.runPhase("content:loaded", {
    data: {
      monsters, jobs, abilities, abilityComponents, buffs, items, combines, licenses, tournaments,
      strings: {},
    },
    manifest: {
      atlases: {},
      sprites: { "PirateMan-hd": "archive/PirateMan-hd.png" },
      fonts: {},
      audio: {},
      particles: {},
    },
    urlFor: (path: string) => `base:${path}`,
  }) as {
    data: Parameters<typeof GameData.fromRaw>[0];
    manifest: { sprites: Record<string, string> };
    urlFor(path: string): string;
  };
  return {
    data: GameData.fromRaw(content.data),
    content,
    exports: active.host.require<{
      shortType: string;
      dancePath: string;
      tauntPriority: number;
      danceMs: number;
      lines: readonly { message: string; plain: string; shake: string }[];
      shakeSpecs: Record<string, { amplitude: number; durationMs: number }>;
      createLineCycle(random?: () => number): { order: readonly number[]; cursor: number };
      takeLine(cycle: { order: readonly number[]; cursor: number }): {
        message: string; plain: string; shake: string;
      };
    }>("mods.dev.dragonislandblue.pirate-panic-dancer"),
  };
}

describe("Pirate panic-dancer mod", () => {
  for (const mode of ["iphone", "ipad"]) {
    for (const finish of ["tap", "natural", "dispose"] as const) {
      it(`${mode}: immediate chat tap and ${finish} dance completion clean up input and status ownership`, async () => {
        const listeners = new Set<() => void>();
        const ticker = {
          deltaMS: 0,
          add: (fn: () => void) => listeners.add(fn),
          remove: (fn: () => void) => listeners.delete(fn),
        };
        const chatRoot = new FakeDisplay();
        let closeChat!: () => void;
        const closed = new Promise<void>((resolve) => { closeChat = resolve; });
        const dismiss = vi.fn((force: boolean) => {
          // No ticker time has elapsed: only a forced dismissal may close the opening fade.
          if (force) { chatRoot.destroy(); closeChat(); }
        });
        const active = await runtime({
          "web/world/guildQuestChat.ts": {
            showGuildQuestChat: async () => ({ root: chatRoot, closed, dismiss }),
          },
          "web/tween.ts": { tween },
          "web/runtimeSettings.ts": { DISPLAY_MODE: mode },
        });
        const lifecycle = new AbortController();
        let acknowledge: ((cause: string) => void) | undefined;
        const status = {
          waitForAcknowledgment: vi.fn(() => new Promise<string>((resolve) => { acknowledge = resolve; })),
          advance: vi.fn((cause: string) => { acknowledge?.(cause); acknowledge = undefined; }),
          clearStatusText: vi.fn(),
        };
        const originalWait = status.waitForAcknowledgment;
        const stage = new FakeDisplay();
        const effects = new FakeDisplay();
        const battle = Object.assign(new FakeBattleNode(), {
          scene: new FakeDisplay(), effectLayer: effects, pointRoot: new FakeDisplay(),
          lifecycle, statusText: status, stage: { app: { stage, ticker } },
          session: { shortTypeOf: () => "PirateMan" },
          game: {
            assets: new FakeAssetLibrary(), scale9: {},
            gd: { monsterByShortType: () => ({ rendererData: { scale: 1 } }) },
          },
        });
        const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
        try {
          const events = [{ type: "abilityUsed", ability: "Utility.Dance" }];
          const playing = battle.playTurn(events, "pirate", "Utility.Dance", 4, "enemyPulse");
          await flush();
          const tap = { stopPropagation: vi.fn() };
          chatRoot.emit("pointertapcapture", tap);
          await flush();
          expect(dismiss).toHaveBeenCalledWith(true);
          expect(tap.stopPropagation).toHaveBeenCalledOnce();
          expect(effects.children).toHaveLength(1);
          // The dialogue-closing tap did not also dismiss the newly created dance.
          expect(listeners.size).toBe(1);
          let completed = false;
          void playing.then(() => { completed = true; });
          await flush();
          expect(completed).toBe(false);
          if (finish === "tap") {
            stage.emit("pointertapcapture", tap);
          } else if (finish === "natural") {
            ticker.deltaMS = 2600;
            for (const fn of [...listeners]) fn();
          } else {
            lifecycle.abort();
          }
          await playing;
          expect(effects.children).toHaveLength(0);
          expect(listeners.size).toBe(0);
          expect(stage.listenerCount("pointertapcapture")).toBe(0);
          expect(battle.baseTurn).toHaveBeenCalledOnce();
          expect(battle.baseTurn).toHaveBeenCalledWith(
            events, "pirate", "Utility.Dance", 4, "none", undefined, undefined,
          );
          if (finish === "tap") {
            // The early click acknowledges precisely the upcoming wait, even though the
            // original handler had no waiter to resolve when that click occurred.
            await expect(status.waitForAcknowledgment()).resolves.toBe("manual");
            expect(status.advance).toHaveBeenCalledOnce();
          }
          let laterAcknowledged = false;
          const later = status.waitForAcknowledgment().then(() => { laterAcknowledged = true; });
          await flush();
          expect(laterAcknowledged).toBe(false);
          status.advance("manual");
          await later;
          lifecycle.abort();
          expect(status.waitForAcknowledgment).toBe(originalWait);
        } finally {
          lifecycle.abort();
          active.dispose();
        }
      });
    }
  }

  it("copies Giant Turtle exactly but exposes only one automatic taunting passive", async () => {
    const active = await runtime();
    try {
      const { data, content, exports } = await load(active);
      const pirate = data.monsterByShortType("PirateMan");
      const turtle = data.monsterByShortType("GiantTurtle");
      expect(pirate).toMatchObject({
        path: "ModPirate.PirateMan",
        category: turtle.category,
        element: turtle.element,
        quality: turtle.quality,
        rendererData: turtle.rendererData,
        rootStats: turtle.rootStats,
        stars: turtle.stars,
        unarmedAttackType: turtle.unarmedAttackType,
      });
      expect(pirate.element).toBe("Water");
      expect(pirate.stars).toBe(2.5);
      expect(pirate.evolveData).toBeUndefined();
      const refs = data.jobAbilities("PirateMan");
      expect(refs).toEqual([{
        slot: "Panic",
        type: "ModPirate.Panic",
        arguments: { instanceName: "Panic", targetPriorityAdjustment: exports.tauntPriority },
      }]);
      expect(refs.some((ref) => /^usable\d+$/.test(ref.slot))).toBe(false);
      // The stock helper fails loud for a player-controlled monster with no cards. Panic's
      // BerserkAbility marker is what keeps Pirate on the automatic route where that helper is
      // never called.
      expect(() => buildPlayerChoices(data, "PirateMan"))
        .toThrow("no usable combat abilities for PirateMan");
      expect(data.ability("ModPirate.Panic").className).toBe("BerserkAbility");
      expect(content.manifest.sprites["PirateMan-hd"]).toBe("archive/PirateMan-hd.png");
      expect(content.urlFor("archive/PirateMan-hd.png")).toBe("base:archive/PirateMan-hd.png");
    } finally {
      active.dispose();
    }
  });

  it("routes each ordinary Pirate turn through the real Dance transaction", async () => {
    const active = await runtime();
    try {
      const { data, exports } = await load(active);
      const session = new engine.BattleSession(data, [
        [{ shortType: "PirateMan", level: 30 }],
        [{ shortType: "Slime", level: 1 }],
      ], mulberry32(17));
      const pirateId = battleLivingId(0, 0, "PirateMan");
      expect(session.isAiControlled(pirateId)).toBe(true);
      expect((session as any).core.aiWorld.targetPriorityOf(pirateId)).toBe(exports.tauntPriority);

      let pirateTurn: Extract<engine.SessionStep, { type: "enemyTurnResolved" }> | undefined;
      for (let index = 0; index < 30 && pirateTurn === undefined; index += 1) {
        const step = session.advanceForPresentation();
        if (step.type === "ended") break;
        expect(step.type).toBe("awaitingEnemy");
        if (step.type !== "awaitingEnemy") break;
        const resolved = session.submitEnemyAction();
        if (resolved.actorId === pirateId) pirateTurn = resolved;
      }
      expect(pirateTurn).toBeDefined();
      expect(pirateTurn?.abilityPath).toBe(exports.dancePath);
      expect(pirateTurn?.tier).toBe(4);
      expect(pirateTurn?.events).toContainEqual({
        type: "abilityUsed",
        source: pirateId,
        ability: "Utility.Dance",
        targets: [pirateId],
      });
      expect(pirateTurn?.events.some((event) =>
        event.type === "damageDealt" || event.type === "healed"
      )).toBe(false);
    } finally {
      active.dispose();
    }
  });

  it("builds one no-repeat shuffled line cycle per battle", async () => {
    const active = await runtime();
    try {
      const { exports } = await load(active);
      const draws = [0.91, 0.14, 0.72, 0.33, 0.58];
      let cursor = 0;
      const cycle = exports.createLineCycle(() => draws[cursor++ % draws.length]!);
      const firstLap = Array.from({ length: exports.lines.length }, () => exports.takeLine(cycle));
      expect(new Set(firstLap.map((line) => line.plain)).size).toBe(exports.lines.length);
      expect(exports.takeLine(cycle)).toEqual(firstLap[0]);
      for (const line of firstLap) {
        expect(line.message).toMatch(/\^#[0-9a-f]{6}/i);
        expect(parseColoredBitmapText(line.message).text).toBe(line.plain);
        expect(["mild", "medium", "strong"]).toContain(line.shake);
      }
      expect(exports.shakeSpecs.strong!.amplitude).toBeGreaterThan(
        exports.shakeSpecs.medium!.amplitude,
      );
      expect(exports.shakeSpecs.medium!.amplitude).toBeGreaterThan(
        exports.shakeSpecs.mild!.amplitude,
      );
      expect(exports.danceMs).toBe(2600);
    } finally {
      active.dispose();
    }
  });

  it("fails clearly when the selected content archive lacks PirateMan", async () => {
    const active = await runtime();
    try {
      await expect(active.runPhase("content:loaded", {
        data: {
          monsters: { Animal: { GiantTurtle: {} } },
          jobs: {}, abilities: {}, abilityComponents: {}, buffs: {}, strings: {},
        },
        manifest: { atlases: {}, sprites: {}, fonts: {}, audio: {}, particles: {} },
        urlFor: (path: string) => path,
      })).rejects.toThrow("PirateMan-hd is missing from the content package");
    } finally {
      active.dispose();
    }
  });

  it("ships a level-30 native save and no copied game-art directory", async () => {
    const active = await runtime();
    try {
      const { data } = await load(active);
      expect(existsSync(resolve(modRoot, "assets"))).toBe(false);
      const document = decodeNativeSaveDocument(new Uint8Array(await readFile(
        resolve(modRoot, "save/pirate-savefile0"),
      )));
      expect(document.player.savedMonsters.map((monster) => monster.name))
        .toEqual(["ModPirate.PirateMan"]);
      expect(document.player.savedMonsters[0]!.properties.get("JobLevelProp"))
        .toEqual({ kind: "real", value: 30 });
      const imported = importNativeSave(document, {
        data,
        worldPoiNames: new Map([["World_1-1", ["First_City"]]]),
      });
      if (imported.state.player.party.kind !== "world-trip-party") {
        throw new Error("expected Pirate save to contain a world-trip party");
      }
      expect(imported.state.player.party.monsters).toHaveLength(1);
      expect(imported.state.player.party.monsters[0]).toMatchObject({
        instanceId: "native-1-PirateMan",
        shortType: "PirateMan",
        level: 30,
      });
      expect(imported.warnings).toEqual([]);
    } finally {
      active.dispose();
    }
  });
});
