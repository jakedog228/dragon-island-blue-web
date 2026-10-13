import { describe, expect, it } from "vitest";
import { registerPvpAdapter, resolvePvpClientAdapters } from "../src/pvp/pvpAdapters.js";
import type { PvpBattleAdapter } from "@dib/engine";

const rules: PvpBattleAdapter = { apiVersion: "pvp-adapter-v1", rulesId: "test.client-v1", digest: "b".repeat(64), create: () => ({}) };
describe("PvP client adapter registration", () => {
  it("resolves exact identities and fails closed after disposal or for a changed digest", () => {
    const adapter = { rules };
    const dispose = registerPvpAdapter(adapter);
    try {
      expect(resolvePvpClientAdapters([rules])).toEqual([adapter]);
      expect(resolvePvpClientAdapters([])).toEqual([]);
      expect(() => resolvePvpClientAdapters([{ ...rules, digest: "c".repeat(64) }])).toThrow("original ordered");
      expect(() => registerPvpAdapter(adapter)).toThrow("already registered");
    } finally { dispose(); dispose(); }
    expect(() => resolvePvpClientAdapters([rules])).toThrow("Missing PvP client adapter");
  });
  it("checks dependencies and conflicts across the negotiated selection, not unrelated local registrations", () => {
    const dependent = { ...rules, rulesId: "test.dependent-v1", requires: [rules.rulesId] };
    const conflict = { ...rules, rulesId: "test.conflict-v1", conflicts: [rules.rulesId] };
    const cleanups = [rules, dependent, conflict].map((rules) => registerPvpAdapter({ rules }));
    try {
      expect(resolvePvpClientAdapters([rules, dependent])).toHaveLength(2);
      expect(() => resolvePvpClientAdapters([dependent])).toThrow("requires preceding");
      expect(() => resolvePvpClientAdapters([rules, conflict])).toThrow("conflicts");
    } finally { cleanups.forEach((dispose) => dispose()); }
  });
});
