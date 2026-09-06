import { afterEach, describe, expect, it } from "vitest";
import { touchHleArc4Random } from "@dib/engine";
import { createFidelityLabRuntime } from "../src/debug/fidelityLabRuntime.js";

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globals["__DIB_FIDELITY_LAB__"];
});

describe("Fidelity Lab runtime", () => {
  it("is absent from ordinary gameplay", () => {
    expect(createFidelityLabRuntime()).toBeUndefined();
  });

  it("publishes and adopts the exact native draw cursor", () => {
    globals["__DIB_FIDELITY_LAB__"] = {
      rng: { kind: "touchhle-xorshift32", initialState: 0, skip: 1 },
      foundationDictionaryOrder: "lexicographic",
    };
    const runtime = createFidelityLabRuntime()!;
    expect(runtime.foundationDictionaryOrder).toBe("lexicographic");
    expect(runtime.snapshot()).toMatchObject({ foundationDictionaryOrder: "lexicographic" });
    expect(runtime.snapshot()).toMatchObject({ rng: { cursor: 1, rawState: 270369 } });
    const fork = runtime.rng.fork();
    fork.next();
    runtime.adopt(fork);
    expect(runtime.snapshot()).toMatchObject({ rng: { cursor: 2, rawState: 67634689 } });
  });

  // The emulator reports the state its NEXT draw derives from, so a stream anchored to it must
  // produce exactly that next value. Consumers hold the facade for a whole run, so the swap has to
  // be invisible to them.
  it("anchors the held stream to a native state without replacing the facade", () => {
    globals["__DIB_FIDELITY_LAB__"] = {
      rng: { kind: "touchhle-xorshift32", initialState: 0, skip: 0 },
    };
    const runtime = createFidelityLabRuntime()!;
    const held = runtime.rng;
    const emulator = touchHleArc4Random(0, 5);
    const nativeState = emulator.rawState;

    const anchor = runtime.anchor(nativeState, 5);
    expect(anchor).toEqual({
      priorRawState: 0,
      priorCursor: 0,
      nativeRawState: nativeState,
      nativeCalls: 5,
      correction: -5,
    });
    expect(runtime.rng).toBe(held);
    expect(held.next()).toBe(emulator.next());
    expect(runtime.snapshot()).toMatchObject({ rng: { cursor: 6, anchors: 1, anchoredState: nativeState } });
    expect(() => runtime.anchor(-1)).toThrow(/uint32/);
    expect(() => runtime.anchor(1, 1.5)).toThrow(/nonnegative integer/);
  });

  it("rejects malformed configuration and non-native forks", () => {
    globals["__DIB_FIDELITY_LAB__"] = { rng: { kind: "other" } };
    expect(() => createFidelityLabRuntime()).toThrow(/touchhle-xorshift32/);
    globals["__DIB_FIDELITY_LAB__"] = { rng: { kind: "touchhle-xorshift32" } };
    const runtime = createFidelityLabRuntime()!;
    expect(() => runtime.adopt({ next: () => 0, intBelow: () => 0, chance: () => true }))
      .toThrow(/TouchHLE arc4random fork/);
    globals["__DIB_FIDELITY_LAB__"] = {
      rng: { kind: "touchhle-xorshift32" },
      foundationDictionaryOrder: "random",
    };
    expect(() => createFidelityLabRuntime()).toThrow(/foundationDictionaryOrder/);
  });
});
