import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BinaryPlistError,
  decodeBinaryPlist,
  encodeBinaryPlist,
  type PlistValue,
} from "../src/player/nativeSave/binaryPlist.js";

/** Relative to this test file: repo root is three levels up from `apps/web/tests/`. */
const SAVE_DIR =
  "../../../emulation/DragonIslandBlue-touchHLE-windows/touchHLE_sandbox/" +
  "jp.ne.goo.game.dragonislandblue/Documents";

function dict(entries: Record<string, PlistValue>): PlistValue {
  return { kind: "dict", value: new Map(Object.entries(entries)) };
}

function plain(value: PlistValue): unknown {
  switch (value.kind) {
    case "array": return value.value.map(plain);
    case "dict":
      return Object.fromEntries(
        [...value.value].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, plain(item)]),
      );
    case "data": return [...value.value];
    default: return [value.kind, value.value];
  }
}

describe("binary plist codec", () => {
  it("round-trips every plist value kind the game writes", () => {
    const original = dict({
      silver: { kind: "int", value: 719 },
      goldSpent: { kind: "int", value: 0 },
      // JobLevelProp is the only place a fractional real appears, and its exact bits are XP.
      JobLevelProp: { kind: "real", value: 7.558252427184466 },
      negative: { kind: "int", value: -5 },
      wide: { kind: "int", value: 70_000 },
      huge: { kind: "int", value: 5_000_000_000 },
      completed: { kind: "bool", value: true },
      absent: { kind: "bool", value: false },
      name: { kind: "string", value: "Dragon.GoldDragonling" },
      unicode: { kind: "string", value: "ドラゴン" },
      empty: { kind: "array", value: [] },
      quests: {
        kind: "array",
        value: [
          { kind: "string", value: "BeatRigel" },
          { kind: "string", value: "Evolution" },
        ],
      },
      nested: dict({ common: dict({ encounterWins: { kind: "int", value: 8 } }) }),
    });
    expect(plain(decodeBinaryPlist(encodeBinaryPlist(original)))).toEqual(plain(original));
  });

  it("keeps integers and reals distinct across a round trip", () => {
    const encoded = encodeBinaryPlist(dict({
      level: { kind: "int", value: 7 },
      levelProp: { kind: "real", value: 7 },
    }));
    const decoded = decodeBinaryPlist(encoded);
    if (decoded.kind !== "dict") throw new Error("expected a dictionary");
    expect(decoded.value.get("level")).toEqual({ kind: "int", value: 7 });
    expect(decoded.value.get("levelProp")).toEqual({ kind: "real", value: 7 });
  });

  it("survives a container large enough to need the extended count form", () => {
    const entries: Record<string, PlistValue> = {};
    for (let index = 0; index < 400; index += 1) {
      entries[`key${index}`] = { kind: "int", value: index };
    }
    const original = dict(entries);
    expect(plain(decodeBinaryPlist(encodeBinaryPlist(original)))).toEqual(plain(original));
  });

  it("emits dictionary keys deterministically", () => {
    const left = encodeBinaryPlist(dict({
      b: { kind: "int", value: 2 },
      a: { kind: "int", value: 1 },
    }));
    const right = encodeBinaryPlist(dict({
      a: { kind: "int", value: 1 },
      b: { kind: "int", value: 2 },
    }));
    expect([...left]).toEqual([...right]);
  });

  it("rejects input that is not a binary plist", () => {
    expect(() => decodeBinaryPlist(new TextEncoder().encode("<?xml version=\"1.0\"?>".padEnd(64))))
      .toThrow(BinaryPlistError);
  });

  it("rejects a truncated file", () => {
    const encoded = encodeBinaryPlist(dict({ a: { kind: "int", value: 1 } }));
    expect(() => decodeBinaryPlist(encoded.slice(0, encoded.length - 8)))
      .toThrow(BinaryPlistError);
  });

  it("refuses a file larger than the configured cap", () => {
    expect(() => decodeBinaryPlist(new Uint8Array(128), {
      maxBytes: 64,
      maxObjects: 10,
      maxDepth: 4,
      maxStringLength: 16,
      maxContainerEntries: 8,
    })).toThrow(/over the 64-byte limit/);
  });

  it("never exposes a dictionary key on an object prototype", () => {
    // An object literal would treat `__proto__` as a setter, so the hostile key is built directly.
    const original: PlistValue = {
      kind: "dict",
      value: new Map<string, PlistValue>([
        ["__proto__", { kind: "int", value: 1 }],
        ["constructor", { kind: "string", value: "polluted" }],
      ]),
    };
    const decoded = decodeBinaryPlist(encodeBinaryPlist(original));
    if (decoded.kind !== "dict") throw new Error("expected a dictionary");
    expect(decoded.value.get("__proto__")).toEqual({ kind: "int", value: 1 });
    expect(decoded.value.get("constructor")).toEqual({ kind: "string", value: "polluted" });
    expect(Object.getPrototypeOf(decoded.value)).toBe(Map.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("binary plist codec against real touchHLE saves", () => {
  const slots = [0, 1, 2];
  // This directory is live operator state. The checked current/backup pairing belongs to the
  // captured native-save fixture and must not auto-run merely because a player used touchHLE.
  const available = process.env.DIB_NATIVE_SAVE_FIXTURES === "1" &&
    slots.every((slot) => existsSync(new URL(`${SAVE_DIR}/savefile${slot}`, import.meta.url)));

  it.skipIf(!available)("decodes and re-encodes each shipped save without semantic loss", () => {
    for (const slot of slots) {
      const bytes = new Uint8Array(
        readFileSync(new URL(`${SAVE_DIR}/savefile${slot}`, import.meta.url)),
      );
      const decoded = decodeBinaryPlist(bytes);
      expect(decoded.kind).toBe("dict");
      if (decoded.kind !== "dict") continue;
      expect([...decoded.value.keys()].sort()).toEqual([
        "goldFound", "goldSpent", "options", "playerData", "poiData",
        "props", "silver", "tutorialFlags", "variables", "waypoints",
      ]);

      expect(plain(decodeBinaryPlist(encodeBinaryPlist(decoded)))).toEqual(plain(decoded));
    }
  });

  it.skipIf(!available)("decodes each .bak as the previous generation of the same slot", () => {
    for (const slot of slots) {
      const current = decodeBinaryPlist(new Uint8Array(
        readFileSync(new URL(`${SAVE_DIR}/savefile${slot}`, import.meta.url)),
      ));
      const backup = decodeBinaryPlist(new Uint8Array(
        readFileSync(new URL(`${SAVE_DIR}/savefile${slot}.bak`, import.meta.url)),
      ));
      expect(plain(backup)).toEqual(plain(current));
    }
  });
});
