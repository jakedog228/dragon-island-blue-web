import type {
  EggCommandV1,
  OfficialEggHatchAuthority,
} from "../src/world/eggHatchSession.js";
import {
  createLocalEggHatchSession,
  createOfficialEggHatchSession,
} from "../src/world/eggHatchSession.js";
import type { GameData } from "@dib/gamedata";
import { mulberry32, touchHleArc4Random } from "@dib/engine";
import { loadGameData } from "@dib/gamedata";
import type {
  OfficialEggContinuationV1,
  PresentationEventV1,
} from "@dib/game-protocol";
import { describe, expect, it } from "vitest";

const PRIZE = Object.freeze({
  kind: "monster" as const,
  shortType: "Spikey",
  level: 5,
  prizeMonster: false,
});

describe("local source Egg RNG lifecycle", () => {
  it.each(["silver", "gold"] as const)("includes Casino selection exactly once before %s release", async (kind) => {
    const rng = touchHleArc4Random(1);
    const session = createLocalEggHatchSession({
      game: loadGameData(), kind, rng, foundationDictionaryOrder: "lexicographic",
      playerView: () => ({
        highestRegisteredLevel: () => 0, highestRegisteredLivingLevel: 0,
        goldEggMonsterLevel: 1, availableGemSlots: [], hasCombineRecipe: () => false,
        spiritSavedXp: () => 0,
      }),
      spendGold: () => true, allowSecondSpin: true,
    });
    await session.begin();
    // Independent source-translated vectors: pool + shuffle + previews + singleton Casino draw.
    expect(rng.cursor).toBe(kind === "silver" ? 55 : 17);
    if (kind === "silver") expect(rng.rawState).toBe(1572275124);
    const beforeRelease = rng.cursor;
    const released = await session.release(137);
    expect(rng.cursor).toBe(beforeRelease + 1);
    if (kind === "silver") expect(released.friction).toBe(2.7140116691589355);
    await session.resolve({ kind: "keep" });
    await session.finish();
    expect(rng.cursor).toBe(beforeRelease + 1);
  });
});
const POOL = Object.freeze({
  providers: [PRIZE],
  reel: [PRIZE],
  previewMonsterShortTypes: ["Spikey"],
});
const FINAL_REEL_STATE = Object.freeze({
  elapsedSeconds: 4.5,
  index: 10.25,
  speed: 0,
  friction: 2.9,
  centerIndex: 0,
  stopped: true,
});

describe("local Clone Egg hatch session", () => {
  it("uses each transient level-1 pick exactly once instead of generating a standard Egg pool", async () => {
    const picks = Object.freeze([
      Object.freeze({ kind: "monster" as const, shortType: "Spikey", level: 1, prizeMonster: false }),
      Object.freeze({ kind: "monster" as const, shortType: "Wolf", level: 1, prizeMonster: false }),
    ]);
    const game = {
      monsterByShortType: (shortType: string) => ({
        shortType,
        stars: shortType === "Spikey" ? 1 : 2,
      }),
    } as unknown as GameData;
    const session = createLocalEggHatchSession({
      game,
      kind: "silver",
      rng: mulberry32(123),
      playerView: () => ({
        highestRegisteredLevel: () => 1,
        highestRegisteredLivingLevel: 1,
        goldEggMonsterLevel: 1,
        availableGemSlots: [],
        hasCombineRecipe: () => false,
        spiritSavedXp: () => 0,
      }),
      spendGold: () => true,
      allowSecondSpin: true,
      scriptedProviders: picks,
    });

    const first = await session.begin();
    expect(first.pool.providers).toEqual(picks);
    expect(first.pool.reel).toHaveLength(2);
    expect(new Set(first.pool.reel.map((entry) => entry.kind === "monster" && entry.shortType)))
      .toEqual(new Set(["Spikey", "Wolf"]));
    const repeated = await session.repeat();
    expect(repeated.kind).toBe("spun");
    if (repeated.kind === "spun") expect(repeated.spin.pool.providers).toEqual(picks);
  });
});

const common = {
  schemaVersion: 1 as const,
  decisionId: "decision-1",
  continuationId: "continuation-1",
  kind: "gold" as const,
  origin: "quest" as const,
};

const awaitingSpin: OfficialEggContinuationV1 = Object.freeze({
  ...common,
  remainingRepeats: 1,
  phase: "awaiting-spin",
});
const spinning: OfficialEggContinuationV1 = Object.freeze({
  ...common,
  remainingRepeats: 1,
  phase: "spinning",
  ...POOL,
});
const awaitingPrize: OfficialEggContinuationV1 = Object.freeze({
  ...common,
  remainingRepeats: 1,
  phase: "awaiting-prize-resolution",
  ...POOL,
  finalReelState: FINAL_REEL_STATE,
  landedPrize: PRIZE,
});
const awaitingRepeat: OfficialEggContinuationV1 = Object.freeze({
  ...common,
  remainingRepeats: 1,
  phase: "awaiting-repeat-or-finish",
  settledPrize: PRIZE,
  resolution: { kind: "keep" as const },
});

/**
 * A slot that walks the recorded phase machine, so the session is exercised against the same
 * ordering `assertOfficialGameV12CommandAdmitted` enforces rather than a permissive stub.
 */
function fakeAuthority(options: {
  readonly start?: OfficialEggContinuationV1 | undefined;
  readonly resolveEvents?: readonly PresentationEventV1[];
  readonly gold?: number;
} = {}): OfficialEggHatchAuthority & {
  readonly submitted: EggCommandV1[];
  gold: number;
} {
  let pending: OfficialEggContinuationV1 | undefined = options.start ?? awaitingSpin;
  const submitted: EggCommandV1[] = [];
  const state = {
    submitted,
    gold: options.gold ?? 1_000,
    submitEgg: async (command: EggCommandV1) => {
      submitted.push(command);
      const phase = pending?.phase;
      if (command.type === "egg.start") {
        if (phase !== "awaiting-spin") throw new Error(`egg.start rejected in ${String(phase)}`);
        pending = spinning;
      } else if (command.type === "egg.release") {
        if (phase !== "spinning") throw new Error(`egg.release rejected in ${String(phase)}`);
        pending = awaitingPrize;
      } else if (command.type === "egg.resolvePrize") {
        if (phase !== "awaiting-prize-resolution") {
          throw new Error(`egg.resolvePrize rejected in ${String(phase)}`);
        }
        pending = awaitingRepeat;
      } else if (command.type === "egg.repeat") {
        if (phase !== "awaiting-repeat-or-finish") {
          throw new Error(`egg.repeat rejected in ${String(phase)}`);
        }
        pending = { ...spinning, remainingRepeats: 0 };
      } else {
        if (phase !== "awaiting-repeat-or-finish") {
          throw new Error(`egg.finish rejected in ${String(phase)}`);
        }
        pending = undefined;
      }
      return options.resolveEvents !== undefined && command.type === "egg.resolvePrize"
        ? options.resolveEvents
        : [];
    },
    pendingEgg: () => pending,
    spendRepeatGold: (cost: number) => {
      if (state.gold < cost) return false;
      state.gold -= cost;
      return true;
    },
  };
  return state;
}

describe("official Egg hatch session", () => {
  it("drives the whole continuation, and commits the release point before the friction exists", async () => {
    const authority = fakeAuthority();
    const session = createOfficialEggHatchSession(authority);

    expect(session.entry).toEqual({ phase: "spin" });

    const spin = await session.begin();
    expect(spin.pool.reel).toEqual([PRIZE]);
    expect(spin.previewMonsterShortTypes).toEqual(["Spikey"]);

    const commitment = await session.release(137);
    // The landing is read back from the projection the server produced *after* accepting the count.
    expect(commitment.friction).toBe(2.9);
    expect(commitment.finalReelState.centerIndex).toBe(0);

    await session.resolve({ kind: "keep" });
    await session.finish();

    expect(authority.submitted).toEqual([
      { type: "egg.start" },
      { type: "egg.release", heldFrames: 137 },
      { type: "egg.resolvePrize", resolution: { kind: "keep" } },
      { type: "egg.finish" },
    ]);
    expect(authority.pendingEgg()).toBeUndefined();
  });

  it("adopts the party identity the authority minted for a kept monster", async () => {
    const authority = fakeAuthority({
      start: awaitingPrize,
      resolveEvents: [
        {
          seq: 1,
          type: "player.monsterAdded",
          reason: "hatch",
          instanceId: "official-77-Spikey",
          shortType: "Spikey",
          level: 5,
        } as unknown as PresentationEventV1,
      ],
    });
    const session = createOfficialEggHatchSession(authority);

    expect(session.entry).toEqual({ phase: "prize", landedPrize: PRIZE });

    const mirror = await session.resolve({ kind: "keep" });
    expect(mirror.joinedInstanceId).toBe("official-77-Spikey");
  });

  it("reports no minted identity when the prize was fed away", async () => {
    const authority = fakeAuthority({ start: awaitingPrize });
    const session = createOfficialEggHatchSession(authority);

    const mirror = await session.resolve({
      kind: "feed",
      recipientInstanceId: "party-3",
    });

    expect(mirror.joinedInstanceId).toBeUndefined();
    expect(authority.submitted).toEqual([{
      type: "egg.resolvePrize",
      resolution: { kind: "feed", recipientInstanceId: "party-3" },
    }]);
  });

  it("re-enters at the phase the server recorded, without replaying earlier commands", async () => {
    const resumed = createOfficialEggHatchSession(fakeAuthority({ start: awaitingRepeat }));
    expect(resumed.entry).toEqual({
      phase: "repeat",
      settledPrize: PRIZE,
      resolution: { kind: "keep" },
    });
    expect(resumed.canRepeat()).toBe(true);
    expect(resumed.settlesAtPresentation).toBe(false);

    // A resumed spin still needs no `egg.start`: the reel is already the server's.
    const midSpin = fakeAuthority({ start: spinning });
    const session = createOfficialEggHatchSession(midSpin);
    expect(session.entry).toEqual({ phase: "spin" });
    await session.begin();
    expect(midSpin.submitted).toEqual([]);
  });

  it("mirrors the repeat debit the authority committed, and refuses only what it refused", async () => {
    const authority = fakeAuthority({ start: awaitingRepeat, gold: 1_000 });
    const session = createOfficialEggHatchSession(authority);
    const cost = session.repeatCost();

    const outcome = await session.repeat();

    expect(outcome.kind).toBe("spun");
    expect(authority.gold).toBe(1_000 - cost);
    expect(authority.submitted).toEqual([{ type: "egg.repeat" }]);
  });

  it("routes the authority's INSUFFICIENT_FUNDS onto the native cannot-afford popup", async () => {
    const authority = fakeAuthority({ start: awaitingRepeat });
    const refusing: OfficialEggHatchAuthority = {
      ...authority,
      submitEgg: async () => {
        throw Object.assign(new Error("insufficient gold"), { code: "INSUFFICIENT_FUNDS" });
      },
    };
    const session = createOfficialEggHatchSession(refusing);

    await expect(session.repeat()).resolves.toEqual({ kind: "unaffordable" });
  });

  it("surfaces a transport failure rather than silently presenting an affordability refusal", async () => {
    const authority = fakeAuthority({ start: awaitingRepeat });
    const failing: OfficialEggHatchAuthority = {
      ...authority,
      submitEgg: async () => { throw new Error("socket closed"); },
    };

    await expect(createOfficialEggHatchSession(failing).repeat()).rejects.toThrow(/socket closed/);
  });

  it("refuses to open without a continuation the server actually recorded", () => {
    expect(() => createOfficialEggHatchSession({
      submitEgg: async () => [],
      pendingEgg: () => undefined,
      spendRepeatGold: () => true,
    })).toThrow(/no pending continuation/);
  });
});
