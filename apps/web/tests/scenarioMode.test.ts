import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerGameStateSnapshot } from "../src/player/gameState.js";
import {
  DEFAULT_SCENARIO_CONFIGURATION,
  SCENARIO_COMBAT_EXAMPLES,
  parseScenarioSeed,
} from "../src/debug/scenarioMode.js";
import { ScenarioSaveStore } from "../src/debug/scenarioSaveStore.js";
import { scenarioGateMarkup } from "../src/debug/scenarioGate.js";

const STATE: PlayerGameStateSnapshot = {
  schemaVersion: 1,
  player: {
    schemaVersion: 1,
    profile: {
      schemaVersion: 1,
      heroLevel: 1,
      silver: 1_000,
      gold: 100,
      captureCards: { 1: 2, 2: 0, 3: 0 },
      highestCapturedLevels: { BlueBabyDragon: 1 },
      spiritEnergy: 0,
      spiritSavedXp: {},
      spiritsUsedThisTrip: [],
    },
    party: { kind: "standalone-levels", levels: [1] },
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("Scenario mode", () => {
  it("includes the archive-driven custom fixed-combat builder", () => {
    expect(SCENARIO_COMBAT_EXAMPLES).toEqual(["random", "reserve", "starter", "ice-storm"]);
    const markup = scenarioGateMarkup("settings");
    expect(markup.indexOf('value="combat"')).toBeLessThan(markup.indexOf('value="egg"'));
    expect(markup.indexOf('value="random"')).toBeLessThan(markup.indexOf('value="reserve"'));
    expect(markup).toContain('name="scenario-combat-example"');
    expect(markup).toContain('value="reserve"');
    expect(markup).toContain('value="starter"');
    expect(markup).toContain('value="random"');
    expect(markup).toContain('value="ice-storm"');
    expect(markup).toContain('<dialog class="content-gate__scenario-dialog"');
    expect(markup).toContain('data-scenario-builder-open');
    expect(markup).toContain('data-scenario-builder-done');
    expect(markup).toContain('data-scenario-example-reset');
    expect(markup).toContain('data-scenario-json-toggle');
    expect(markup).toContain('data-scenario-json-text');
    expect(markup).toContain('data-scenario-json-file');
    expect(markup).toContain('class="content-gate__scenario-confirm"');
    expect(markup).toContain("<svg");
    expect(markup).toContain('data-scenario-team="player"');
    expect(markup).toContain('data-scenario-team="enemy"');
    expect(markup).toContain('name="scenario-combat-background"');
    expect(markup).toContain('name="scenario-spirit-percent"');
    expect(markup).toContain('id="scenario-combat-ability-options"');
    expect(markup).toContain('id="scenario-all-ability-options"');
    expect(markup).toContain("Player battle resources");
    expect(markup).not.toContain('data-scenario-template="ice-storm"');
    expect(markup).not.toContain("Load Ice Storm mirror");
    const loadIcon = markup.match(
      /<button[^>]*data-scenario-json-load[^>]*>(<svg[\s\S]*?<\/svg>)<\/button>/,
    )?.[1];
    const downloadIcon = markup.match(
      /<button[^>]*data-scenario-json-download[^>]*>(<svg[\s\S]*?<\/svg>)<\/button>/,
    )?.[1];
    expect(loadIcon).toContain("M3 19V6");
    expect(downloadIcon).toContain("M12 3v12");
    expect(loadIcon).not.toBe(downloadIcon);
  });

  it("parses reproducible decimal and hexadecimal seeds", () => {
    expect(parseScenarioSeed("17")).toBe(17);
    expect(parseScenarioSeed("0x5343454e")).toBe(DEFAULT_SCENARIO_CONFIGURATION.seed);
    expect(() => parseScenarioSeed("-1")).toThrow(/decimal integer/);
    expect(() => parseScenarioSeed("4294967296")).toThrow(/unsigned 32-bit/);
    expect(() => parseScenarioSeed("random")).toThrow(/decimal integer/);
  });

  it("never retains checkpoints and returns a fresh initial snapshot", async () => {
    const store = new ScenarioSaveStore("offline");
    store.installInitialState(STATE);
    const loaded = await store.loadSlotState("slot-1");
    expect(loaded).toEqual(STATE);
    expect(loaded).not.toBe(STATE);

    const session = store.open("slot-1", loaded);
    const changed = structuredClone(STATE);
    (changed.player.profile as { silver: number }).silver = 0;
    await session.save(changed);
    await session.flush();

    expect(await store.loadSlotState("slot-1")).toEqual(STATE);
    expect(("deleteSlot" in store)).toBe(false);
    expect(("previousRevision" in store)).toBe(false);
  });

  it("models the online transport asynchronously without delegating storage", async () => {
    vi.useFakeTimers();
    const store = new ScenarioSaveStore("online");
    store.installInitialState(STATE);
    let settled = false;
    const loading = store.loadSlotState("slot-1").then((state) => {
      settled = true;
      return state;
    });
    await vi.advanceTimersByTimeAsync(79);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await loading).toEqual(STATE);
  });

  it("rejects unsupported slots and double installation", () => {
    const store = new ScenarioSaveStore("offline");
    store.installInitialState(STATE);
    expect(() => store.open("slot-2")).toThrow(/no slot/);
    expect(() => store.installInitialState(STATE)).toThrow(/already installed/);
  });

  it("replaces the fixture generation when the main-menu shell is rebuilt", async () => {
    const store = new ScenarioSaveStore("offline");
    store.installInitialState(STATE);
    const rebuilt = structuredClone(STATE);
    (rebuilt.player.profile as { silver: number }).silver = 7_777;
    store.resetInitialState(rebuilt);
    expect((await store.loadSlotState("slot-1"))?.player.profile.silver).toBe(7_777);
  });
});
