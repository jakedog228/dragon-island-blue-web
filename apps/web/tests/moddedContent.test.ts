import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata/browser";
import { WorldTrip, createWorldTripSharedState, selectEncounterTableEntry, fixedEncounterCompletionKey } from "@dib/engine";
import { createWorldTrip } from "../src/world/worldDemoState.js";
import { importCodeModArchive, resolveCodeModProfile } from "@dib/mod-kernel";
import type { ImportedContentPackage } from "../src/content/archivePackage.js";
import { applyFullTrustModsToContent } from "../src/content/moddedContent.js";
import { createFullTrustCodeModRuntime } from "../src/content/codeModRuntime.js";

const workspace = resolve(import.meta.dirname, "../../..");

async function exampleArchive(name: string) {
  const root = resolve(workspace, "examples/mods", name);
  const manifestText = await readFile(resolve(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as { readonly entry: string };
  return await importCodeModArchive(zipSync({
    "manifest.json": strToU8(manifestText),
    [manifest.entry]: strToU8(await readFile(resolve(root, manifest.entry), "utf8")),
  }), `${name}.dibmod`);
}

async function inlineArchive(source: string, files: Record<string, Uint8Array> = {}) {
  return await importCodeModArchive(zipSync({
    "manifest.json": strToU8(JSON.stringify({
      schemaVersion: 4,
      id: "dev.dragonislandblue.runtime-test",
      version: "1.0.0",
      displayName: "Runtime Test",
      apiVersion: 4,
      mode: "offline",
      dependencies: {},
      entry: "scripts/main.js",
    })),
    "scripts/main.js": strToU8(source),
    ...files,
  }), "runtime-test.dibmod");
}

async function baseContent(): Promise<ImportedContentPackage> {
  const monsters = JSON.parse(await readFile(
    resolve(workspace, "extracted/data/Monsters.json"),
    "utf8",
  )) as Record<string, unknown>;
  let disposed = false;
  const content: ImportedContentPackage = {
    sourceKind: "app-archive",
    archiveName: "fixture.zip",
    appDirectory: "/",
    data: {
      monsters,
      combines: {},
      jobs: {},
      abilities: {},
      abilityComponents: {},
      buffs: {},
      anims: {},
      meleeAttacks: {},
      scale9: {},
      strings: {},
    },
    resources: {
      list: () => [],
      has: () => false,
      plist: () => { throw new Error("not a plist fixture"); },
      text: () => { throw new Error("not a text fixture"); },
      url: () => { throw new Error("not an asset fixture"); },
    },
    manifest: { atlases: {}, sprites: {}, fonts: {}, audio: {}, particles: {} },
    combatBackgroundKeys: ["TestCombat"],
    worldNames: [],
    hasTownCapability: false,
    hasDungeonCapability: false,
    dungeonTypes: [],
    dungeonFiles: [],
    hasProvenanceDocument: false,
    urlFor: () => { throw new Error("not an asset fixture"); },
    dispose: () => { disposed = true; },
  };
  Object.defineProperty(content, "disposed", { get: () => disposed });
  return content;
}

describe("full-trust imported content", () => {
  it("lets a repository mod replace arbitrary content and binds its profile", async () => {
    const base = await baseContent();
    const blue = await exampleArchive("blue-dragon-overdrive");
    const modded = await applyFullTrustModsToContent(base, [blue]);
    const dragon = (modded.data.monsters["Dragon"] as Record<string, unknown>)["BlueBabyDragon"] as
      Record<string, unknown>;

    expect(dragon["rootStats"]).toMatchObject({ Attack: 7.5, Speed: 9.5 });
    expect(modded.modProfile).toMatchObject({
      schemaVersion: 4,
      packages: [{ id: "dev.dragonislandblue.blue-dragon-overdrive" }],
    });
    const baseDragon = (base.data.monsters["Dragon"] as Record<string, unknown>)["BlueBabyDragon"] as
      Record<string, unknown>;
    expect(baseDragon["rootStats"]).toMatchObject({ Attack: 2.5, Speed: 6.5 });
  });

  it("loads arbitrary runtime modules and intercepts methods without a feature-specific API", async () => {
    const target = { value: 2, calculate(multiplier: number) { return this.value * multiplier; } };
    const pkg = await inlineArchive(`
      const module = await dibMod.modules.load("test/anything");
      dibMod.intercept(module.target, "calculate", function (next, multiplier) {
        return next(multiplier) + 10;
      });
      dibMod.hooks.on("any:future:lifecycle", ({ value }) => ({ ...value, touched: true }));
      dibMod.exports.answer = 42;
    `);
    const profile = await resolveCodeModProfile([pkg]);
    const runtime = await createFullTrustCodeModRuntime(profile, {
      modules: {
        list: () => ["test/anything"],
        has: (id) => id === "test/anything",
        load: async (id) => {
          if (id !== "test/anything") throw new Error("unknown test module");
          return { target };
        },
      },
    });

    expect(target.calculate(3)).toBe(16);
    await expect(runtime.runPhase("any:future:lifecycle", { original: true })).resolves.toEqual({
      original: true,
      touched: true,
    });
    expect(runtime.host.require<Record<string, unknown>>(
      "mods.dev.dragonislandblue.runtime-test",
    )["answer"]).toBe(42);
    runtime.dispose();
    expect(target.calculate(3)).toBe(6);
  });

  it("gives Inferno Barrage to every real monster with an incomplete resolved moveset", async () => {
    class FakeBattleSession {
      submitPlayerAction() {}
    }
    class FakeBattleNode {
      playTurn() {}
      renderGameState() { return {}; }
    }
    class FakeGraphics {}
    const pkg = await exampleArchive("fire-cub-inferno-barrage");
    const profile = await resolveCodeModProfile([pkg]);
    const modules = new Map<string, unknown>([
      ["@dib/engine", { BattleSession: FakeBattleSession }],
      ["@dib/gamedata/browser", { GameData }],
      ["web/battle/battleNode.ts", { BattleNode: FakeBattleNode }],
      ["pixi.js", { Graphics: FakeGraphics }],
      ["web/displayMode.ts", { idiomPairPt: (phone: number) => phone }],
      ["web/runtimeSettings.ts", { DISPLAY_MODE: "iphone" }],
    ]);
    const runtime = await createFullTrustCodeModRuntime(profile, {
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

    const loadExtractedData = async (name: string): Promise<Record<string, unknown>> =>
      JSON.parse(await readFile(resolve(workspace, `extracted/data/${name}.json`), "utf8")) as
        Record<string, unknown>;
    const [monsters, jobs, abilities, abilityComponents, buffs] = await Promise.all([
      loadExtractedData("Monsters"),
      loadExtractedData("Jobs"),
      loadExtractedData("Abilities"),
      loadExtractedData("AbilityComponents"),
      loadExtractedData("Buffs"),
    ]);
    const source = GameData.fromRaw({ monsters, jobs, abilities, abilityComponents, buffs });
    const content = {
      data: { monsters, jobs, abilities, abilityComponents, buffs, strings: {} },
    };
    const overlaid = await runtime.runPhase("content:loaded", content) as typeof content;
    const patched = GameData.fromRaw(overlaid.data);
    const usableSlots = ["usable1", "usable2", "usable3", "usable4"];
    let incompleteCount = 0;

    for (const monster of source.allMonsters()) {
      const before = source.jobAbilities(monster.shortType);
      const beforeSlots = new Set(before.map(({ slot }) => slot));
      const firstMissing = usableSlots.find((slot) => !beforeSlots.has(slot));
      const after = patched.jobAbilities(monster.shortType);
      if (firstMissing === undefined) {
        expect(after).toEqual(before);
        continue;
      }
      incompleteCount += 1;
      expect(after).toHaveLength(before.length + 1);
      expect(after.find(({ slot }) => slot === firstMissing)).toMatchObject({
        type: "DevDragonIslandBlueFireCub.FireCubInfernoBarrage",
        arguments: { activationLength: "{4}", instanceName: "Inferno" },
      });
      for (const nativeRef of before) expect(after).toContainEqual(nativeRef);
    }

    expect(incompleteCount).toBe(104);
    expect(patched.ability("DevDragonIslandBlueFireCub.FireCubInfernoBarrage").raw["abilityScalor"])
      .toBe(0.06);
    expect(overlaid.data.strings).toMatchObject({ RenderableFireCubInfernoBarrageNameKey: "Inferno" });
    expect(patched.jobAbilities("FireCub").find(({ slot }) => slot === "usable3")?.type)
      .toBe("DevDragonIslandBlueFireCub.FireCubInfernoBarrage");
    expect(Object.keys(runtime.host.require<Record<string, unknown>>(
      "mods.dev.dragonislandblue.fire-cub-inferno-barrage",
    )["assignedSlots"] as Record<string, string>)).toHaveLength(104);
    runtime.dispose();
  });

  it("finishes all twenty Inferno Barrage animations with zero damage after the target dies", async () => {
    const abilityPath = "DevDragonIslandBlueFireCub.FireCubInfernoBarrage";
    class FakeBattleSession {
      pending = { choices: [{ slot: "usable3", abilityPath }] };
      alive = true;
      mechanicalStrikes = 0;
      submitPlayerAction(_slot: string, _targets: readonly string[]) {
        throw new Error("unintercepted submitPlayerAction");
      }
      beginScriptedPlayerAction(_slot: string) {
        this.pending = undefined as never;
        return { actorId: "hero", abilityPath, events: [{ type: "abilityUsed" }] };
      }
      targetableIdsOf(_team: 0 | 1) { return this.alive ? ["foe"] : []; }
      randomScriptedPlayerPick(candidates: readonly string[]) { return candidates[0]; }
      hpOf(_id: string) { return this.alive ? 5 : 0; }
      performScriptedPlayerAbility(_step: unknown) {
        this.mechanicalStrikes += 1;
        this.alive = false;
        return {
          events: [
            { type: "damageDealt", source: "hero", target: "foe", amount: 5, element: "Fire", hpAfter: 0 },
            { type: "died", living: "foe" },
          ],
        };
      }
      finishScriptedPlayerAction() {
        return [{ type: "battleEnded", winner: 0, time: 0 }];
      }
    }
    class FakeGraphics {
      destroyed = false;
      visible = true;
      tint = 0;
      label = "";
      eventMode = "none";
      zIndex = 0;
      readonly position = { set: (_x: number, _y: number) => undefined };
      circle() { return this; }
      stroke() { return this; }
      fill() { return this; }
      destroy() { this.destroyed = true; }
    }
    class FakeBattleNode {
      readonly lifecycle = { disposed: false };
      readonly pointRoot = {
        addChild: (_child: unknown) => undefined,
        toLocal: (point: { x: number; y: number }) => point,
      };
      readonly stage = {
        app: {
          stage: { on: (_name: string, _listener: unknown) => undefined, off: (_name: string, _listener: unknown) => undefined },
          renderer: { events: { pointer: undefined } },
          ticker: { add: (_listener: unknown) => undefined, remove: (_listener: unknown) => undefined },
        },
      };
      readonly enemyDisplay = {
        monsterSpriteOf: (_id: string) => null,
        setLiveTargetPressHandlers: (_handlers?: unknown) => undefined,
      };
      readonly renderedResults: Array<readonly Record<string, unknown>[]> = [];
      readonly abilityRenderer = {
        renderSourceEffects: async () => undefined,
        renderQueuedEffects: async () => undefined,
        renderResult: async (events: readonly Record<string, unknown>[]) => {
          this.renderedResults.push(events);
        },
      };
      readonly nodeLookup = {};
      readonly appliedHp: Array<readonly Record<string, unknown>[]> = [];
      readinessApplications = 0;
      finalEvents: readonly Record<string, unknown>[] = [];
      activeAbilityPath: string | undefined;
      constructor(readonly session: FakeBattleSession) {}
      async sleep(_ms: number) {}
      setPresentationState(_state: string) {}
      startPresentationTask(_task: Promise<unknown>, _label: string) {}
      applyAbilityEvents(_events: readonly Record<string, unknown>[]) {}
      applyPresentedSpiritReadiness(_events: readonly Record<string, unknown>[]) {
        this.readinessApplications += 1;
      }
      applyHp(events: readonly Record<string, unknown>[]) { this.appliedHp.push(events); }
      applyStatusOverlayEvents(_events: readonly Record<string, unknown>[]) {}
      async playTurn(events: readonly Record<string, unknown>[]) { this.finalEvents = events; }
      renderGameState() { return { mode: "battle" }; }
    }
    const pkg = await exampleArchive("fire-cub-inferno-barrage");
    const profile = await resolveCodeModProfile([pkg]);
    const modules = new Map<string, unknown>([
      ["@dib/engine", { BattleSession: FakeBattleSession }],
      ["@dib/gamedata/browser", { GameData: class {} }],
      ["web/battle/battleNode.ts", { BattleNode: FakeBattleNode }],
      ["pixi.js", { Graphics: FakeGraphics }],
      ["web/displayMode.ts", { idiomPairPt: (phone: number) => phone }],
      ["web/runtimeSettings.ts", { DISPLAY_MODE: "iphone" }],
    ]);
    const runtime = await createFullTrustCodeModRuntime(profile, {
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

    const session = new FakeBattleSession();
    const node = new FakeBattleNode(session);
    const opening = session.submitPlayerAction("usable3", [] as string[]) as unknown as
      readonly Record<string, unknown>[];
    await (node.playTurn as unknown as (...args: unknown[]) => Promise<void>)(
      opening,
      "hero",
      abilityPath,
      4,
      "none",
      "usable3",
      {},
    );

    expect(session.mechanicalStrikes).toBe(1);
    expect(node.renderedResults).toHaveLength(20);
    expect(node.renderedResults.slice(1).every((events) =>
      events.some((event) => event["type"] === "damageDealt" && event["amount"] === 0)
    )).toBe(true);
    expect(node.readinessApplications).toBe(1);
    expect(node.finalEvents.map((event) => event["type"])).toEqual(["died", "battleEnded"]);
    expect(node.renderGameState()).toMatchObject({
      codeMods: {
        infernoBarrage: {
          active: false,
          completedStrikes: 20,
          targetIds: Array(20).fill("foe"),
          damageAmounts: [5, ...Array(19).fill(0)],
        },
      },
    });
    runtime.dispose();
  });

  it.each(["iphone", "ipad"])("runs the external Devtools menu and restores every toggle interception (%s)", async (displayMode) => {
    // The downloadable mod must also load in deployed builds predating the proposed predicates.
    expect(WorldTrip.prototype).not.toHaveProperty("shouldCheckEncounter");
    expect(WorldTrip.prototype).not.toHaveProperty("fixedEncounterIsEligible");
    class FakeDisplay {
      label: string | undefined;
      width = 30;
      height = 20;
      eventMode = "none";
      cursor = "default";
      hitArea: unknown;
      readonly style = { fill: 0 };
      readonly position = {
        x: 0,
        y: 0,
        set: (x: number, y: number) => {
          this.position.x = x;
          this.position.y = y;
        },
      };
      readonly anchor = { set: (..._values: number[]) => undefined };
      readonly scale = { x: 1, y: 1 };
      parent: FakeContainer | null = null;
      private readonly listeners = new Map<string, (event?: { stopPropagation(): void }) => void>();

      getLocalBounds() {
        return { x: 0, y: 0, width: this.width, height: this.height };
      }

      destroyed = false;

      on(name: string, listener: (event?: { stopPropagation(): void }) => void) {
        this.listeners.set(name, listener);
        return this;
      }

      off(name: string, _listener?: unknown) {
        this.listeners.delete(name);
        return this;
      }

      emit(name: string, event?: unknown) {
        this.listeners.get(name)?.(
          (event ?? { stopPropagation: () => undefined }) as { stopPropagation(): void },
        );
      }
    }

    class FakeContainer extends FakeDisplay {
      readonly children: FakeDisplay[] = [];

      addChild(...children: FakeDisplay[]) {
        children.forEach((child) => { child.parent = this; });
        this.children.push(...children);
        return children[0];
      }
    }

    class FakeGraphics extends FakeContainer {
      rectangle: number[] | undefined;
      clear() { return this; }
      rect(...args: number[]) { this.rectangle = args; return this; }
      roundRect(..._args: number[]) { return this; }
      fill(_options: unknown) { return this; }
      stroke(_options: unknown) { return this; }
    }

    class FakeRectangle {
      constructor(
        readonly x: number,
        readonly y: number,
        readonly width: number,
        readonly height: number,
      ) {}
    }

    class FakeBattleNode {
      originalSleeps = 0;
      originalTimeDelays = 0;

      async sleep(_ms: number) {
        this.originalSleeps += 1;
      }

      async awaitTimeDelay(_ms: number) {
        this.originalTimeDelays += 1;
      }

      renderGameState() {
        return { mode: "battle" };
      }
    }

    class FakeWorldTrip extends WorldTrip {
      constructor() {
        super({
          pointsOfInterest: ["start", "near", "locked"].map((instanceName) => ({ instanceName })),
          connections: [{ poi1: "start", poi2: "near" }],
        }, "start", { next: () => 0, intBelow: () => 0, chance: () => true }, { randomMonsterTypes: [] });
      }
    }

    class FakeWorldNode {
      refreshCount = 0;
      deps?: unknown;

      refreshPoiStates() { this.refreshCount += 1; }
      destroy() { /* lifecycle stub */ }
      renderGameState() { return { mode: "world" }; }
    }

    /** Mutable room graph behind a frozen `state` projection, like the real DungeonSession: the
     *  package's travel seams are only meaningful against a session that can actually refuse an
     *  unexplored destination and record an arrival. */
    class FakeDungeonSession {
      currentRoomId = "room-a";
      readonly roomGraph = [
        { id: "room-a", explored: true, x: 0, y: 0, links: [] },
        { id: "room-b", explored: false, x: 1, y: 0, links: [] },
        { id: "room-c", explored: false, x: 2, y: 0, links: [] },
      ];

      get state() {
        return Object.freeze({
          currentRoomId: this.currentRoomId,
          rooms: Object.freeze(this.roomGraph.map((room) => Object.freeze({ ...room }))),
        });
      }

      requireRoom(id: string) {
        const room = this.roomGraph.find((candidate) => candidate.id === id);
        if (room === undefined) throw new Error(`unknown room ${id}`);
        return room;
      }

      selectMaterializedRoom(targetRoomId: string) {
        const room = this.requireRoom(targetRoomId);
        if (!room.explored) throw new Error(`Room ${targetRoomId} is not materialized`);
        this.currentRoomId = room.id;
        // `enterCurrentRoom`'s durable write: arrival is what explores a room.
        room.explored = true;
        return { kind: "changed-room", toRoomId: room.id };
      }

      snapshot() {
        return { clearedEncounterIds: [], collectedTreasureIds: [] };
      }
    }

    class FakeDungeonNode {
      readonly roomLayer = new FakeContainer();
      readonly pointRoot = new FakeContainer();
      readonly world = { scale: { x: 1, y: 1 } };
      readonly floorFrameIndex = 1;
      locked = false;
      readonly touchedRooms: string[] = [];
      readonly deps = {
        definition: {
          presentation: { style: "cave", floorFrameFormat: "Floor_%d" },
        },
        session: new FakeDungeonSession(),
      };
      renderedExploration: boolean[] = [];

      /** The shipped scene handler: it is only ever reached for a room the arbitration resolved. */
      async handleRoomTouch(roomId: string, _worldPoint: { x: number; y: number }) {
        this.touchedRooms.push(roomId);
        this.deps.session.selectMaterializedRoom(roomId);
      }

      themeSprite(_frame: string) { return new FakeDisplay(); }

      buildRoom(room: { id: string }, _cleared: Set<string>, _collected: Set<string>) {
        const display = new FakeContainer();
        display.label = `dungeonRoom:${room.id}`;
        return display;
      }

      renderFloor(_animate: boolean) {
        this.roomLayer.children.length = 0;
        this.renderedExploration = this.deps.session.state.rooms.map(({ explored }) => explored);
        for (const room of this.deps.session.state.rooms) {
          if (room.explored) this.roomLayer.addChild(this.buildRoom(room, new Set(), new Set()));
        }
      }

      destroy() { /* lifecycle stub */ }

      renderGameState() {
        return {
          mode: "dungeon",
          renderedRoomIds: this.roomLayer.children
            .filter(({ label }) => label?.startsWith("dungeonRoom:"))
            .map(({ label }) => label?.slice("dungeonRoom:".length)),
          rooms: this.deps.session.state.rooms.map(({ id }) => ({ id })),
        };
      }
    }

    class FakeStoreFlow {
      entries() {
        return Object.freeze([
          Object.freeze({ id: "card", kind: "usable", currency: "silver", unitPrice: 50 }),
          Object.freeze({ id: "iap", kind: "iapGold", goldAmount: 200 }),
        ]);
      }
    }

    class FakeWorldMenu extends FakeContainer {
      readonly buttonPoints = [0, 1, 2].map((row) => ({
        action: `existing-${row}`,
        label: `Existing ${row}`,
        enabled: true,
        column: 2,
        row,
        center: { x: 385, y: 90 + row * 40 },
        labelBounds: { x: 330, y: 75 + row * 40, w: 110, h: 30 },
        backgroundBounds: { x: 330, y: 75 + row * 40, w: 110, h: 30 },
      }));
      closed = false;

      static async show(parent: FakeContainer, _opts: unknown) {
        const menu = new FakeWorldMenu();
        parent.addChild(menu);
        return menu;
      }

      close(onClose: () => void) {
        this.closed = true;
        onClose();
      }
    }

    const values = new Map<string, string>([[
      "dev.dragonislandblue.devtools.settings.v1", JSON.stringify({ activateFixedEncounters: true }),
    ]]);
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
    });

    const pkg = await exampleArchive("devtools");
    const profile = await resolveCodeModProfile([pkg]);
    let shownDevtools: { environment: unknown; options: { content: FakeContainer } } | undefined;
    const modules = new Map<string, unknown>([
      ["web/battle/battleNode.ts", { BattleNode: FakeBattleNode }],
      ["web/world/worldMenu.ts", { WorldMenu: FakeWorldMenu }],
      ["web/world/worldNode.ts", { WorldNode: FakeWorldNode }],
      ["web/dungeon/dungeonNode.ts", { DungeonNode: FakeDungeonNode }],
      ["web/dungeon/dungeonDisplayMath.ts", {
        dungeonConnectorTiles: () => [],
        dungeonFrameName: (format: string, value: number) => format.replace("%d", String(value)),
        dungeonRoomZ: ({ y }: { y: number }) => -y,
        dungeonRoomTouchRadiusPt: () => 0.4,
        // The shipped arbitration's shape in one grid dimension: explored rooms only, nearest
        // within the radius wins. Whether a room counts as explored is the whole point here.
        nearestMaterializedRoom: (
          floor: { rooms: readonly { id: string; x: number; y: number; explored: boolean }[] },
          point: { x: number; y: number },
          radius: number,
        ) => {
          let best: { room: { id: string }; distance: number } | undefined;
          for (const room of floor.rooms) {
            if (!room.explored) continue;
            const distance = Math.abs(room.x - point.x) + Math.abs(room.y - point.y);
            if (distance > radius) continue;
            if (best === undefined || distance < best.distance) best = { room, distance };
          }
          return best?.room;
        },
      }],
      ["web/player/storeFlow.ts", { StoreFlow: FakeStoreFlow }],
      ["@dib/engine", { DungeonSession: FakeDungeonSession, WorldTrip, selectEncounterTableEntry, fixedEncounterCompletionKey }],
      ["web/world/worldDemoState.ts", { createWorldTrip }],
      ["pixi.js", { Container: FakeContainer, Graphics: FakeGraphics, Rectangle: FakeRectangle }],
      ["web/runtimeSettings.ts", { DISPLAY_MODE: displayMode }],
      ["@dib/renderer", {
        makeTtfLabel: (_text: string) => new FakeDisplay(),
      }],
      ["web/ui/monsterHatchPopup.ts", {
        showMonsterHatchPopup: async (environment: unknown, options: { content: FakeContainer }) => {
          shownDevtools = { environment, options };
          return { dismiss: () => undefined };
        },
      }],
    ]);
    let runtime: Awaited<ReturnType<typeof createFullTrustCodeModRuntime>> | undefined;
    try {
      runtime = await createFullTrustCodeModRuntime(profile, {
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

      const battle = new FakeBattleNode();
      await battle.sleep(500);
      await battle.awaitTimeDelay(2_250);
      expect(battle.originalSleeps).toBe(1);
      expect(battle.originalTimeDelays).toBe(1);
      expect(battle.renderGameState()).toMatchObject({
        codeMods: {
          devtools: {
            features: {
              noBattleDelays: false,
              speedUp: false,
              unlockLocations: false,
              unlockShop: false,
              speedMultiplier: 3,
            },
            battle: {
              skippedSleeps: 0,
              skippedTimeDelays: 0,
              lastSleepMs: null,
              lastTimeDelayMs: null,
            },
          },
        },
      });

      const parent = new FakeContainer();
      const menu = await FakeWorldMenu.show(parent, {
        assets: {}, scale9: {}, ticker: {}, onClick: () => undefined,
        onClose: () => undefined,
      });
      const devtoolsButton = menu.children.find(({ label }) => label === "worldMenu:devtools");
      expect(devtoolsButton).toBeDefined();
      expect(menu.buttonPoints.at(-1)).toMatchObject({ action: "devtools", column: 2, row: 3 });
      devtoolsButton?.emit("pointertap");
      await Promise.resolve();
      expect(menu.closed).toBe(true);
      expect(shownDevtools?.options.content.label).toBe("devtoolsContent");
      expect((shownDevtools?.options.content.children[0] as FakeGraphics).rectangle)
        .toEqual([0, 0, 292, 145]);
      const devtoolsControl = (label: string) =>
        shownDevtools?.options.content.children.find((child) => child.label === label);
      const noBattleDelaysOff = devtoolsControl("devtools:noBattleDelays:off");
      const noBattleDelaysOn = devtoolsControl("devtools:noBattleDelays:on");
      const speedUpOn = devtoolsControl("devtools:speedUp:on");
      const unlockLocationsOn = devtoolsControl("devtools:unlockLocations:on");
      const unlockShopOn = devtoolsControl("devtools:unlockShop:on");
      const fixedOn = devtoolsControl("devtools:activateFixedEncounters:on");
      const fixedOff = devtoolsControl("devtools:activateFixedEncounters:off");
      expect(noBattleDelaysOff).toBeDefined();
      expect(noBattleDelaysOn).toBeDefined();
      expect(speedUpOn).toBeDefined();
      expect(unlockLocationsOn).toBeDefined();
      expect(unlockShopOn).toBeDefined();
      expect(fixedOn).toBeDefined();
      expect(fixedOff).toBeDefined();

      const exports = runtime.host.require<{
        settings(): Record<string, unknown>;
      }>("mods.dev.dragonislandblue.devtools");
      expect(exports.settings().activateFixedEncounters).toBe(false);

      // Exercise the real trip through the mod UI: completed, inactive-quest, chance-zero and
      // cadence-gated encounters are all reactivated, without editing their durable registries.
      const shared = createWorldTripSharedState();
      const completedKeys = new Set(["boss-done"]);
      let eligibilityReads = 0;
      const fixedDefinition = Object.freeze({
        sourceIndex: 0,
        uniqueKey: "boss-done", questKey: "inactive-quest", chanceToAppear: 0,
        exactFloor: 50,
        monsters: [{ type: "FireCub", levelScalor: 2 }],
        battleRewardKey: "boss-reward", achievement: "boss-achievement",
      });
      const encounter = {
        table: { "1": { monsterPopulator: {
          types: ["ordinary"], minMonstersPerPack: 1, maxMonstersPerPack: 1,
          fixedEncounters: [fixedDefinition],
        } } },
      };
      const makeTrip = () => {
        const trip = new WorldTrip({
        challengeLevel: 5,
        pointsOfInterest: [
          { instanceName: "town" }, { instanceName: "boss", encounter },
          { instanceName: "ordinary", encounter: { table: { "1": {
            monsterPopulator: { types: ["ordinary"] },
          } } } },
        ],
        connections: [{ poi1: "town", poi2: "boss" }, { poi1: "town", poi2: "ordinary" }],
      }, "town", { next: () => 0.5, intBelow: () => 0, chance: () => false }, {
        sharedState: shared, randomMonsterTypes: [],
        hasCompletedFixedEncounter: (key) => {
          eligibilityReads += 1;
          return completedKeys.has(key);
        },
        canUseQuestKey: () => { eligibilityReads += 1; return false; },
        });
        const node = new FakeWorldNode();
        node.deps = {
          trip, refreshState: shared,
          game: { gd: { allMonsters: () => [{ shortType: "FireCub" }] } },
          questRewardRng: { next: () => 0.5, intBelow: () => 0, chance: () => false },
          world: {
            name: "TestWorld", challengeLevel: 5, encounterChance: 0.333,
            connections: [{ poi1: "town", poi2: "boss" }, { poi1: "town", poi2: "ordinary" }],
            pointsOfInterest: [
              { name: "town", randomPopulators: [] },
              { name: "boss", hasEncounterTable: true, randomPopulators: [{
                tier: 1, encounterLevelScalor: 1, itterationScalor: 0, populatorLevelScalor: 1,
                minMonstersPerPack: 1, maxMonstersPerPack: 1,
                types: [{ type: "ordinary", chance: 100 }], fixedEncounters: [fixedDefinition],
              }] },
              { name: "ordinary", hasEncounterTable: true, randomPopulators: [{
                tier: 1, encounterLevelScalor: 1, itterationScalor: 0, populatorLevelScalor: 1,
                types: [{ type: "ordinary", chance: 100 }], fixedEncounters: [],
              }] },
            ],
          },
        };
        node.refreshPoiStates();
        return trip;
      };
      const trip = makeTrip();
      trip.begin();
      shared.completedThisRefresh.add("boss");
      shared.completedThisRefresh.add("ordinary");
      expect(trip.navigate("boss", [5])).toMatchObject({ reason: "completed-this-refresh" });
      trip.navigate("town", [5]);
      fixedOn?.emit("pointertap");
      expect(trip.currentPoiName).toBe("town"); // Toggling itself starts no fight.
      expect(trip.navigate("boss", [100])).toMatchObject({
        kind: "encounter", movement: { kind: "walk" },
        encounter: {
          kind: "fixed", forced: false, completionKey: "boss-done", questKey: "inactive-quest",
          battleRewardKey: "boss-reward", achievement: "boss-achievement",
          monsters: [{ type: "FireCub", level: 10 }],
        },
      });
      expect(trip.navigate("boss", [100])).toMatchObject({
        kind: "encounter", encounter: { kind: "fixed", forced: true },
      });
      shared.completedThisRefresh.delete("boss");
      trip.navigate("town", [5]);
      expect(trip.navigate("boss", [100])).toMatchObject({ kind: "encounter", encounter: { kind: "fixed" } });
      expect(shared.completedThisRefresh.has("boss")).toBe(false);
      trip.recordEncounterWin();
      trip.navigate("town", [5]);
      expect(trip.navigate("boss", [100])).toMatchObject({ kind: "encounter", encounter: { kind: "fixed" } });
      trip.navigate("town", [5]);
      expect(trip.navigate("ordinary", [5])).toMatchObject({ reason: "completed-this-refresh" });
      expect(eligibilityReads).toBe(0);
      expect([...completedKeys]).toEqual(["boss-done"]);
      expect(fixedDefinition.chanceToAppear).toBe(0);
      expect(fixedDefinition.exactFloor).toBe(50);
      expect(shared.completedThisRefresh.has("boss")).toBe(true);
      expect(JSON.parse(values.get("dev.dragonislandblue.devtools.settings.v1")!))
        .not.toHaveProperty("activateFixedEncounters");
      // A newly constructed trip (world change) sees the same temporary setting.
      const nextTrip = makeTrip();
      nextTrip.begin();
      expect(nextTrip.navigate("boss", [5])).toMatchObject({ kind: "encounter", encounter: { kind: "fixed" } });
      fixedOff?.emit("pointertap");
      trip.navigate("town", [5]);
      expect(trip.navigate("boss", [5])).toMatchObject({ reason: "completed-this-refresh" });
      // Same-location replay bypasses trip completion in the baseline, but still uses the
      // original unique/quest checks once the toggle is off.
      expect(trip.navigate("boss", [5])).toMatchObject({ kind: "encounter", encounter: { kind: "ordinary" } });
      expect(eligibilityReads).toBe(1);
      noBattleDelaysOn?.emit("pointertap");
      await battle.sleep(250);
      await battle.awaitTimeDelay(1_000);
      expect(battle.originalSleeps).toBe(1);
      expect(battle.originalTimeDelays).toBe(1);
      expect(battle.renderGameState()).toMatchObject({
        codeMods: {
          devtools: {
            features: { noBattleDelays: true },
            battle: {
              skippedSleeps: 1,
              skippedTimeDelays: 1,
              lastSleepMs: 250,
              lastTimeDelayMs: 1_000,
            },
          },
        },
      });
      noBattleDelaysOff?.emit("pointertap");
      await battle.sleep(50);
      await battle.awaitTimeDelay(50);
      expect(battle.originalSleeps).toBe(2);
      expect(battle.originalTimeDelays).toBe(2);

      const ticker = { speed: 1 };
      await runtime.runPhase("boot:ready", { stage: { app: { ticker } } });
      speedUpOn?.emit("pointertap");
      expect(ticker.speed).toBe(3);

      const world = new FakeWorldNode();
      const dungeon = new FakeDungeonNode();
      world.refreshPoiStates();
      dungeon.renderFloor(false);
      expect(new FakeWorldTrip().poiStates().get("locked")).toBe(3);
      unlockLocationsOn?.emit("pointertap");
      expect(world.refreshCount).toBe(2);
      expect(new FakeWorldTrip().poiStates()).toEqual(new Map([
        ["start", 2], ["near", 4], ["locked", 4],
      ]));
      expect(dungeon.renderedExploration).toEqual([true, false, false]);
      expect(dungeon.deps.session.state.rooms.map(({ explored }) => explored)).toEqual([
        true, false, false,
      ]);
      expect(dungeon.renderGameState()).toMatchObject({
        renderedRoomIds: ["room-a", "room-b", "room-c"],
      });

      // Revealed AND reachable. The shipped arbitration resolves nothing over room-b, so the
      // scene handler is never called for it; the package's own scene listener claims that tap,
      // and the session refusal it would have hit is lifted.
      const tapAt = (x: number) => dungeon.pointRoot.emit("pointertap", {
        getLocalPosition: () => ({ x, y: 0 }),
        stopPropagation: () => undefined,
      });
      tapAt(1);
      await Promise.resolve();
      expect(dungeon.touchedRooms).toEqual(["room-b"]);
      expect(dungeon.deps.session.currentRoomId).toBe("room-b");
      // Arrival is what explores a room; room-c is still only revealed.
      expect(dungeon.deps.session.state.rooms.map(({ explored }) => explored)).toEqual([
        true, true, false,
      ]);

      // A tap the shipped handler DID resolve stays claimed by it — the listener must not run a
      // second selection for the same dispatch.
      dungeon.touchedRooms.length = 0;
      // No await between the two: one Pixi dispatch is synchronous, which is exactly what the
      // package's microtask-cleared claim relies on.
      void dungeon.handleRoomTouch("room-a", { x: 0, y: 0 });
      tapAt(0);
      await Promise.resolve();
      expect(dungeon.touchedRooms).toEqual(["room-a"]);

      const store = new FakeStoreFlow();
      expect(store.entries().find((entry) => "unitPrice" in entry)?.unitPrice).toBe(50);
      unlockShopOn?.emit("pointertap");
      expect(store.entries().find((entry) => "unitPrice" in entry)?.unitPrice).toBe(0);
      expect(store.entries()[1]).toMatchObject({ id: "iap" });
      expect(exports.settings()).toMatchObject({
        noBattleDelays: false,
        speedUp: true,
        unlockLocations: true,
        unlockShop: true,
        speedMultiplier: 3,
      });
      expect(JSON.parse(values.get("dev.dragonislandblue.devtools.settings.v1") ?? "{}")).toMatchObject({
        noBattleDelays: false,
        speedUp: true,
        unlockLocations: true,
        unlockShop: true,
      });

      fixedOn?.emit("pointertap");
      runtime.dispose();
      runtime = undefined;
      trip.navigate("town", [5]);
      expect(trip.navigate("boss", [5])).toMatchObject({ reason: "completed-this-refresh" });
      expect(ticker.speed).toBe(1);
      const restored = new FakeBattleNode();
      await restored.sleep(50);
      await restored.awaitTimeDelay(50);
      expect(restored.originalSleeps).toBe(1);
      expect(restored.originalTimeDelays).toBe(1);
      expect(new FakeWorldTrip().poiStates().get("locked")).toBe(3);
      expect(new FakeStoreFlow().entries().find((entry) => "unitPrice" in entry)?.unitPrice).toBe(50);
    } finally {
      runtime?.dispose();
      if (previousStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, "localStorage", previousStorage);
    }
  });

  it("introduces the Mercy Stone item, sells it for silver, and spares the killing blow", async () => {
    // The picker row seam is a real Box/Container composition, so these stand in for just enough
    // of @dib/renderer and pixi.js to observe what the mod puts in the row it owns.
    interface FakeBoxChild { readonly child: unknown; readonly contentSize?: { w: number; h: number } }
    class FakeBox {
      label: string | undefined;
      readonly boxChildren: FakeBoxChild[] = [];
      readonly boxContentSize = { w: 0, h: 0 };
      constructor(readonly options: Record<string, unknown>) {}
      addBoxChild(child: unknown, options?: { contentSize?: { w: number; h: number } }) {
        this.boxChildren.push({ child, ...(options?.contentSize === undefined ? {} : { contentSize: options.contentSize }) });
      }
    }
    class FakeContainer {
      label: string | undefined;
      boundsArea: unknown;
      readonly children: unknown[] = [];
      addChild(...children: unknown[]) { this.children.push(...children); }
    }
    class FakeRectangle {
      constructor(readonly x: number, readonly y: number, readonly width: number, readonly height: number) {}
    }
    class FakePartyEditorFlow {
      async showSoulStoneInfo(_stone: unknown) {}
      /** The shipped body the mod must fall through to for every ordinary stone. */
      buildStonePickerRowDisplay(
        _opts: unknown,
        entry: { token: string; stone: Record<string, unknown> },
      ) {
        return { shipped: entry.token };
      }
    }

    class FakeGameData {
      soulStoneByElement(element: string) {
        if (element !== "Life") throw new Error(`unknown soul stone element: ${element}`);
        return { path: "SoulStones.LifeSoulStone", element, enabledStats: ["MaxHP"] };
      }

      item(path: string) {
        if (path !== "SoulStones.MercySoulStone") throw new Error(`unknown item path: ${path}`);
        return { path, instanceName: "MercySoulStone", enabledStats: [] as readonly string[] };
      }
    }

    interface FakeMember {
      instanceId: string;
      shortType: string;
      soulStone?: Record<string, unknown>;
    }

    class FakeParty {
      readonly stones: { token: string; stone: Record<string, unknown> }[] = [];
      readonly members: FakeMember[] = [{ instanceId: "party-1", shortType: "FireCub" }];
      private nextToken = 0;

      validateSoulStone(stone: { level: number }) {
        if (!Number.isInteger(stone.level) || stone.level < 1) {
          throw new Error("soul-stone level must be a positive integer");
        }
      }

      allocateStoneToken() {
        this.nextToken += 1;
        return `soul-stone-${this.nextToken}`;
      }

      memberOrThrow(instanceId: string) {
        const member = this.members.find((candidate) => candidate.instanceId === instanceId);
        if (member === undefined) throw new Error(`unknown instanceId ${instanceId}`);
        return member;
      }

      insertSoulStoneByToken(instanceId: string, token: string) {
        const index = this.stones.findIndex((entry) => entry.token === token);
        const [entry] = this.stones.splice(index, 1);
        this.memberOrThrow(instanceId).soulStone = entry!.stone;
      }
    }

    class FakeProfile {
      constructor(private silver: number) {}

      snapshot() {
        return { silver: this.silver };
      }

      spendSilver(amount: number) {
        if (this.silver < amount) return false;
        this.silver -= amount;
        return true;
      }
    }

    class FakePlayerRuntimeState {
      private constructor(readonly profile: FakeProfile, readonly party: FakeParty | undefined) {}

      static world(profile: FakeProfile, party: FakeParty) {
        return new FakePlayerRuntimeState(profile, party);
      }

      static standalone(profile: FakeProfile) {
        return new FakePlayerRuntimeState(profile, undefined);
      }

      static fromStateSnapshot(profile: FakeProfile) {
        return new FakePlayerRuntimeState(profile, undefined);
      }
    }

    interface FakeStock { readonly id: string; readonly kind: string }

    interface FakeStoreOpts {
      readonly profile: FakeProfile;
      purchase: (stock: FakeStock, quantity: number) => Promise<unknown> | unknown;
    }

    class FakeStoreFlow {
      category = 1;

      private constructor(readonly opts: FakeStoreOpts) {}

      static async show(opts: FakeStoreOpts) {
        return new FakeStoreFlow(opts);
      }

      entries(): readonly FakeStock[] {
        return [{ id: "card-1", kind: "usable" }, { id: "gem-novice-plain", kind: "gem" }];
      }
    }

    interface FakeLiving { hp: number; soulStone?: Record<string, unknown> }

    class FakeBattleCore {
      readonly livings = new Map<string, FakeLiving>();
      readonly applied: { id: string; delta: number; opts: Record<string, unknown> | undefined }[] = [];
      /** The live event log every consumer slices — the identity the call-out is keyed off. */
      readonly events: Record<string, unknown>[] = [];

      applyHpDelta(id: string, delta: number, sourceId: string, opts?: Record<string, unknown>) {
        const living = this.livings.get(id)!;
        const before = living.hp;
        living.hp = Math.max(0, living.hp + delta);
        this.applied.push({ id, delta, opts });
        const actual = living.hp - before;
        if (actual < 0 || opts?.displayZeroDamage === true) {
          this.events.push({
            type: "damageDealt",
            source: sourceId,
            target: id,
            amount: -actual,
            hpAfter: living.hp,
          });
        }
      }

      /** The shipped gate's only soul-stone input is "does the caster wear one". */
      blockUseReasonFor(casterId: string, _ability: unknown, _args: unknown) {
        return this.livings.get(casterId)!.soulStone === undefined
          ? "MonsterHasNoSoulStone"
          : undefined;
      }
    }

    class FakeBattleNode {
      session: { core: FakeBattleCore } | undefined;
      renderGameState() {
        return { mode: "battle" };
      }
    }

    class FakeAbilityRenderer {
      readonly floaters: {
        text: string;
        color: number;
        rect: unknown;
        row: number;
        kind: string;
      }[] = [];
      rendered = 0;

      localizedString(key: string) {
        return key === "ModMercyEffectKey" ? "Mercy!" : key;
      }

      localRectOf(area: unknown) {
        return { area };
      }

      async spawnFloater(text: string, color: number, rect: unknown, row: number, kind: string) {
        this.floaters.push({ text, color, rect, row, kind });
      }

      async renderResult(_events: unknown, _nodes: unknown, _opts: unknown) {
        this.rendered += 1;
      }
    }

    const noop = () => undefined;
    const pkg = await exampleArchive("mercy-stone");
    const profile = await resolveCodeModProfile([pkg]);
    const modules = new Map<string, unknown>([
      ["@dib/engine", { BattleCore: FakeBattleCore, WorldTripParty: FakeParty }],
      ["@dib/gamedata/browser", { GameData: FakeGameData }],
      ["@dib/renderer", {
        AssetLibrary: class { async atlas(_name: string) { return {}; } },
        Box: FakeBox,
        makeTtfLabel: (text: string, fontSize: number, options: unknown) =>
          ({ text, fontSize, options, label: undefined as string | undefined }),
        pointSprite: (texture: unknown) => ({
          texture,
          label: undefined as string | undefined,
          width: 64,
          height: 64,
          scale: { x: 1, y: 1, set(x: number, y: number) { this.x = x; this.y = y; } },
          anchor: { set(_value: number) {} },
          position: { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } },
        }),
        OUTLINE_FADE_ALPHA: 0.5,
      }],
      ["pixi.js", { Container: FakeContainer, Rectangle: FakeRectangle }],
      ["web/battle/battleNode.ts", { BattleNode: FakeBattleNode }],
      ["web/battle/abilityRenderer.ts", { AbilityRenderer: FakeAbilityRenderer }],
      ["web/battle/targetPicker.ts", { TargetPicker: class { async showSoulStoneInfo(_s: unknown) {} } }],
      ["web/world/partyEditorFlow.ts", { PartyEditorFlow: FakePartyEditorFlow }],
      ["web/world/eggHatchFlow.ts", { EggHatchFlow: class { async showFeedSoulStoneInfo(_s: unknown) {} } }],
      ["web/player/playerRuntimeState.ts", { PlayerRuntimeState: FakePlayerRuntimeState }],
      ["web/player/storeFlow.ts", { StoreFlow: FakeStoreFlow }],
      ["web/dungeon/dungeonDisplayMath.ts", {
        dungeonLootDisplayMetrics: () => ({ rowGap: 5, iconSide: 32, nameFontSize: 14 }),
      }],
      ["web/displayMode.ts", { sourcePointsPerPortPoint: () => 1 }],
      ["web/runtimeSettings.ts", { DISPLAY_MODE: "iphone" }],
    ]);
    let runtime: Awaited<ReturnType<typeof createFullTrustCodeModRuntime>> | undefined;
    try {
      runtime = await createFullTrustCodeModRuntime(profile, {
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

      // The item and its name are ordinary overlaid content, applied before fingerprinting.
      const overlaid = await runtime.runPhase("content:loaded", {
        data: {
          items: { SoulStones: { LifeSoulStone: { class: "SoulStone", slot: "Monster", stats: {} } } },
          strings: { RenderableLifeSoulStoneNameKey: "Life Soul Stone" },
        },
      }) as { data: { items: Record<string, Record<string, unknown>>; strings: Record<string, string> } };
      expect(overlaid.data.items["SoulStones"]!["MercySoulStone"]).toMatchObject({
        class: "SoulStone",
        slot: "Monster",
        stats: {},
        rendererData: { spriteFrame: "MercySoulStone.png" },
      });
      expect(overlaid.data.strings["RenderableMercySoulStoneNameKey"]).toBe("Mercy Stone");
      expect(overlaid.data.strings["RenderableLifeSoulStoneNameKey"]).toBe("Life Soul Stone");

      // The shipped element lookup answers for the new key without touching the seven real ones.
      const data = new FakeGameData();
      expect(data.soulStoneByElement("Mercy")).toEqual({
        path: "SoulStones.MercySoulStone",
        element: "Mercy",
        enabledStats: [],
      });
      expect(data.soulStoneByElement("Life")).toMatchObject({ enabledStats: ["MaxHP"] });

      const party = new FakeParty();
      const wallet = new FakeProfile(250);
      FakePlayerRuntimeState.world(wallet, party);
      const flow = await FakeStoreFlow.show({ profile: wallet, purchase: noop });
      const stock = flow.entries();
      expect(stock.map(({ id }) => id)).toEqual(["card-1", "mod-mercy-stone", "gem-novice-plain"]);

      const receipt = await flow.opts.purchase(stock[1]!, 2) as {
        spent: number;
        balance: number;
        receivedItems: readonly { definitionPath: string }[];
      };
      expect(receipt).toMatchObject({ spent: 200, balance: 50 });
      expect(receipt.receivedItems).toHaveLength(2);
      expect(receipt.receivedItems[0]!.definitionPath).toBe("SoulStones.MercySoulStone");
      expect(party.stones.map(({ stone }) => stone)).toEqual([
        { element: "Mercy", level: 1 },
        { element: "Mercy", level: 1 },
      ]);
      await expect(flow.opts.purchase(stock[1]!, 1)).rejects.toThrow(/insufficient silver/);
      expect(party.stones).toHaveLength(2);

      // Equipping bonds the stone to its holder so the engine's Desoul construction guard is
      // satisfied on every later path, including a holder that evolves into a Desoul carrier.
      // Insert Soul Stone: only this element's row body is replaced, and only its own row. The
      // shipped builder still owns every ordinary stone, so the paged screen keeps its wrapper,
      // selection, hit arbitration, and Drop/Insert/Info for the Mercy row too.
      const editor = new FakePartyEditorFlow();
      const pickerOpts = {
        soulStoneTextures: new Map<string, unknown>([["Mercy", { frame: "MercySoulStone.png" }]]),
      };
      expect(editor.buildStonePickerRowDisplay(
        pickerOpts,
        { token: "soul-stone-9", stone: { element: "Fire", level: 5 } },
      )).toEqual({ shipped: "soul-stone-9" });
      const mercyRow = editor.buildStonePickerRowDisplay(
        pickerOpts,
        { token: party.stones[0]!.token, stone: party.stones[0]!.stone },
      ) as unknown as FakeBox;
      expect(mercyRow).toBeInstanceOf(FakeBox);
      expect(mercyRow.options).toMatchObject({ horizontal: true, gap: 5 });
      const [itemCell, nameCell] = mercyRow.boxChildren;
      expect(itemCell!.contentSize).toEqual({ w: 32, h: 32 });
      const icon = (itemCell!.child as FakeContainer).children[0] as { label: string };
      expect(icon.label).toBe(`stonePickerItem:${party.stones[0]!.token}:Mercy`);
      expect(nameCell!.child).toMatchObject({
        text: "Mercy Stone",
        fontSize: 14,
        label: `stonePickerName:${party.stones[0]!.token}`,
      });

      party.insertSoulStoneByToken("party-1", party.stones[0]!.token);
      const equipped = party.members[0]!.soulStone!;
      expect(equipped).toMatchObject({ element: "Mercy", level: 1, sourceType: "FireCub" });

      const core = new FakeBattleCore();
      core.livings.set("hero", { hp: 90, soulStone: equipped });
      core.livings.set("rival", { hp: 90 });
      core.livings.set("foe", { hp: 12 });
      core.applyHpDelta("foe", -40, "hero", { element: "Fire" });
      expect(core.livings.get("foe")!.hp).toBe(1);
      expect(core.applied.at(-1)).toMatchObject({ delta: -11 });

      core.applyHpDelta("foe", -40, "hero", { element: "Fire" });
      expect(core.livings.get("foe")!.hp).toBe(1);
      expect(core.applied.at(-1)).toMatchObject({ delta: 0, opts: { displayZeroDamage: true } });

      // A creature without the stone still kills, and the holder can still hurt itself.
      core.applyHpDelta("foe", -40, "rival", { element: "Fire" });
      expect(core.livings.get("foe")!.hp).toBe(0);
      core.applyHpDelta("hero", -90, "hero", { element: "Fire" });
      expect(core.livings.get("hero")!.hp).toBe(0);

      // A Mercy Stone is not a soul: Desoul sees an unequipped caster, and the stone survives.
      expect(core.blockUseReasonFor("hero", {}, {})).toBe("MonsterHasNoSoulStone");
      expect(core.livings.get("hero")!.soulStone).toBe(equipped);

      const node = new FakeBattleNode();
      node.session = { core };
      expect(node.renderGameState()).toMatchObject({
        codeMods: { mercyStone: { sparedBlows: 2, lastHolderId: "hero", lastSparedId: "foe" } },
      });

      // The call-out. Both spared blows are marked by object identity in the live log, and the
      // unspared kill and the holder's self-damage in between are not.
      const renderer = new FakeAbilityRenderer();
      await renderer.renderResult(core.events, { displayAreaOf: (id: string) => ({ id }) }, {});
      expect(renderer.rendered).toBe(1);
      expect(renderer.floaters).toEqual([
        { text: "Mercy!", color: 0x3fa9ff, rect: { area: { id: "foe" } }, row: 0, kind: "message" },
        { text: "Mercy!", color: 0x3fa9ff, rect: { area: { id: "foe" } }, row: 0, kind: "message" },
      ]);

      const second = new FakeAbilityRenderer();
      await second.renderResult(core.events, { displayAreaOf: (id: string) => ({ id }) }, {});
      expect(second.floaters).toEqual([]);

      runtime.dispose();
      runtime = undefined;
      const restored = new FakeBattleCore();
      restored.livings.set("hero", { hp: 90, soulStone: equipped });
      restored.livings.set("foe", { hp: 12 });
      restored.applyHpDelta("foe", -40, "hero", { element: "Fire" });
      expect(restored.livings.get("foe")!.hp).toBe(0);
    } finally {
      runtime?.dispose();
    }
  });

  it("exposes arbitrary packaged files to the same JavaScript entry", async () => {
    const pkg = await inlineArchive(`
      dibMod.exports.config = dibMod.files.json("data/config.json");
      dibMod.exports.hasCss = dibMod.files.has("assets/overhaul.css");
    `, {
      "data/config.json": strToU8('{"rules":"different"}'),
      "assets/overhaul.css": strToU8("body { filter: hue-rotate(30deg); }"),
    });
    const profile = await resolveCodeModProfile([pkg]);
    const runtime = await createFullTrustCodeModRuntime(profile);
    const exports = runtime.host.require<Record<string, unknown>>(
      "mods.dev.dragonislandblue.runtime-test",
    );
    expect(exports).toMatchObject({ config: { rules: "different" }, hasCss: true });
    runtime.dispose();
  });
});

async function relatedArchive(
  id: string,
  source: string,
  relations: Readonly<Record<string, unknown>> = {},
) {
  return await importCodeModArchive(zipSync({
    "manifest.json": strToU8(JSON.stringify({
      schemaVersion: 4,
      id,
      version: "1.0.0",
      displayName: id,
      apiVersion: 4,
      mode: "offline",
      dependencies: {},
      entry: "scripts/main.js",
      ...relations,
    })),
    "scripts/main.js": strToU8(source),
  }), `${id}.dibmod`);
}

async function runtimeFor(packages: Parameters<typeof resolveCodeModProfile>[0], target: object) {
  const profile = await resolveCodeModProfile(packages);
  return await createFullTrustCodeModRuntime(profile, {
    modules: {
      list: () => ["test/shared"],
      has: (id) => id === "test/shared",
      load: async (id) => {
        if (id !== "test/shared") throw new Error("unknown test module");
        return { target };
      },
    },
  });
}

describe("multi-mod interference reporting", () => {
  it("attributes stacked interceptors, contested data paths, and contested services", async () => {
    const target = { calculate(value: number) { return value; } };
    const first = await relatedArchive("dev.example.first", `
      const { target } = await dibMod.modules.load("test/shared");
      dibMod.intercept(target, "calculate", function (next, value) { return next(value) + 10; });
      dibMod.host.set("shared.tuning", "first");
      dibMod.hooks.on("demo:data", ({ value }) => ({
        ...value,
        data: { ...value.data, left: "first", onlyFirst: true },
      }));
    `);
    const second = await relatedArchive("dev.example.second", `
      const { target } = await dibMod.modules.load("test/shared");
      dibMod.intercept(target, "calculate", function (next, value) { return next(value) * 2; });
      dibMod.host.set("shared.tuning", "second");
      dibMod.hooks.on("demo:data", ({ value }) => ({
        ...value,
        data: { ...value.data, left: "second" },
      }));
    `, { loadAfter: ["dev.example.first"] });

    const runtime = await runtimeFor([second, first], target);
    try {
      // Interceptors nest, so both still run: the later mod wraps the earlier one.
      expect(target.calculate(1)).toBe(22);
      const merged = await runtime.runPhase("demo:data", { data: { left: "base" } });
      expect(merged).toEqual({ data: { left: "second", onlyFirst: true } });

      const report = runtime.interference();
      expect(report.order.map((entry) => entry.id)).toEqual([
        "dev.example.first",
        "dev.example.second",
      ]);
      const seam = (target_: string) => report.seams.find((entry) => entry.target === target_);

      expect(seam("object#calculate")).toMatchObject({
        kind: "property",
        severity: "info",
        claims: [
          { modId: "dev.example.first", action: "intercept" },
          { modId: "dev.example.second", action: "intercept" },
        ],
      });
      // Only the contested leaf is reported; the key just one mod introduced is not a conflict.
      expect(seam("demo:data \u2192 data.left")).toMatchObject({
        kind: "data",
        severity: "warning",
      });
      expect(seam("demo:data \u2192 data.onlyFirst")).toBeUndefined();
      expect(seam("host:shared.tuning")).toMatchObject({ kind: "service", severity: "warning" });
      expect(report.warnings.map((entry) => entry.target).sort()).toEqual([
        "demo:data \u2192 data.left",
        "host:shared.tuning",
      ]);
    } finally {
      runtime.dispose();
    }
    expect(target.calculate(1)).toBe(1);
  });

  it("flags a replace that discards another mod, and offers the escapes around it", async () => {
    const target = { calculate(value: number) { return value; } };
    const patched = await relatedArchive("dev.example.patched", `
      const { target } = await dibMod.modules.load("test/shared");
      dibMod.intercept(target, "calculate", function (next, value) { return next(value) + 10; });
    `);
    const blunt = await relatedArchive("dev.example.blunt", `
      const { target } = await dibMod.modules.load("test/shared");
      const original = dibMod.original(target, "calculate");
      dibMod.replace(target, "calculate", (value) => original.call(target, value) * 3);
      dibMod.exports.merged = dibMod.merge(
        { stats: { attack: 1, speed: 2 }, keep: true },
        { stats: { attack: 9 } },
      );
      dibMod.hooks.on("mods:ready", ({ value }) => {
        dibMod.exports.peers = value.order.map((entry) => entry.id);
        dibMod.exports.sawEarlierMod = dibMod.host.has("mods.dev.example.patched");
      });
    `, { loadAfter: ["dev.example.patched"] });

    const runtime = await runtimeFor([blunt, patched], target);
    try {
      // `original` reaches past every mod's patch, so the replacement bypasses the +10 entirely.
      expect(target.calculate(2)).toBe(6);

      const seam = runtime.interference().seams.find((entry) => entry.target === "object#calculate");
      expect(seam).toMatchObject({ severity: "warning" });
      expect(seam?.summary).toContain("dev.example.blunt");
      expect(seam?.summary).toContain("dev.example.patched");

      const exported = runtime.host.require<Record<string, unknown>>("mods.dev.example.blunt");
      // `merge` composes a patch instead of replacing the sibling keys another mod may have set.
      expect(exported["merged"]).toEqual({ stats: { attack: 9, speed: 2 }, keep: true });
      // `mods:ready` runs once every entry has executed, which is what a compatibility patch needs.
      expect(exported["peers"]).toEqual(["dev.example.patched", "dev.example.blunt"]);
      expect(exported["sawEarlierMod"]).toBe(true);
    } finally {
      runtime.dispose();
    }
    expect(target.calculate(2)).toBe(2);
  });
});
