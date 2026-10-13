import { describe, expect, it } from "vitest";
import { PvpCompatibilityRegistry, type PvpModSupport } from "../src/pvpCompatibility.js";
const logicPackId = `logic-v1:${"a".repeat(64)}`;
const cosmetic = { id: "dib.colors", version: "1.0.0", digest: "1".repeat(64) };
const mechanics = { id: "dib.moves", version: "1.0.0", digest: "2".repeat(64) };
const equivalent = { ...mechanics, version: "1.0.1", digest: "3".repeat(64) };
const changed = { ...mechanics, version: "2.0.0", digest: "4".repeat(64) };
const other = { id: "dib.other", version: "1.0.0", digest: "5".repeat(64) };
const supported: PvpModSupport[] = [
  { ...cosmetic, support: { kind: "presentation" } },
  { ...mechanics, support: { kind: "rules", rulesId: "moves-v1" } },
  { ...equivalent, support: { kind: "rules", rulesId: "moves-v1" } },
  { ...changed, support: { kind: "rules", rulesId: "moves-v2" } },
  { ...other, support: { kind: "rules", rulesId: "other-v1" } },
];
const registry = new PvpCompatibilityRegistry(supported, [
  { id: "base", logicPackId, rules: [] }, { id: "moves", logicPackId, rules: ["moves-v1"] },
]);
const setup = (mods: typeof cosmetic[] = []) => ({ logicPackId, mods });
describe("PvP compatibility negotiation", () => {
  it("reconciles unequal cosmetic modsets", () => {
    expect(registry.negotiate(setup([cosmetic]), setup())).toEqual({ compatible: true, profileId: "base", notes: [expect.stringContaining("cosmetic")] });
  });
  it.each([[mechanics, mechanics], [mechanics, equivalent], [mechanics, changed]])(
    "rejects gameplay mods even with installed identical or equivalent rules: %j", (hostMod, guestMod) => {
      expect(registry.negotiate(setup([hostMod]), setup([guestMod]))).toMatchObject({ compatible: false,
        issues: [expect.objectContaining({ code: "MOD_UNSUPPORTED", path: "host.mods[0]" }),
          expect.objectContaining({ code: "MOD_UNSUPPORTED", path: "guest.mods[0]" })] });
    });
  it("does not trust cosmetic claims, an official-looking ID, or a copied digest", () => {
    for (const mod of [{ ...cosmetic, digest: "9".repeat(64) }, { ...cosmetic, id: "dib.official.pvp" }, { ...cosmetic, version: "9.0.0" }]) {
      expect(registry.negotiate(setup([mod]), setup())).toMatchObject({ compatible: false, issues: [expect.objectContaining({ code: "MOD_UNSUPPORTED", modId: mod.id })] });
    }
  });
  it("rejects gameplay selections in any order instead of reconciling them", () => {
    const result = registry.negotiate(setup([mechanics, other]), setup([other, mechanics]));
    expect(result.compatible).toBe(false);
    if (result.compatible) throw new Error("Gameplay mods admitted");
    expect(result.issues).toHaveLength(4);
    expect(result.issues.every(issue => issue.code === "MOD_UNSUPPORTED")).toBe(true);
  });
  it("names unsupported hooks instead of silently disabling mechanics", () => {
    const rejected = new PvpCompatibilityRegistry([{ ...mechanics, support: { kind: "unsupported", path: "hooks.battle", reason: "requires client realtime input" } }], []);
    expect(rejected.negotiate(setup([mechanics]), setup())).toMatchObject({ compatible: false,
      issues: [expect.objectContaining({ path: "host.mods[0].hooks.battle", message: expect.stringContaining("realtime") })] });
  });
  it("refuses different content rules and duplicate selection", () => {
    expect(registry.negotiate(setup(), { ...setup(), logicPackId: `logic-v1:${"b".repeat(64)}` })).toMatchObject({ compatible: false, issues: [{ code: "CONTENT_MISMATCH" }] });
    expect(() => registry.negotiate(setup([cosmetic, cosmetic]), setup())).toThrow("once");
  });
});


it("rejects ambiguous profiles for the same rules combination", () => {
  expect(() => new PvpCompatibilityRegistry([], [
    { id: "a", logicPackId, rules: [] }, { id: "b", logicPackId, rules: [] },
  ])).toThrow("Duplicate PvP rules combination");
});
