import { describe, it, expect } from "vitest";
import { resolveDataDir, loadRawJson } from "../src/rawLoad.js";
import { assertNoJobLevelRestriction, buildRegistry, resolveNode } from "../src/inherit.js";
import type { RawNode } from "../src/rawLoad.js";


describe("parity with Tier A resolved output", () => {
  const dataDir = resolveDataDir();
  for (const name of ["Monsters", "Jobs"]) {
    it(`reproduces ${name}.resolved.json exactly`, () => {
      const raw = loadRawJson(dataDir, `${name}.json`);
      const expected = loadRawJson(dataDir, `${name}.resolved.json`);
      const reg = buildRegistry(raw);
      for (const [path, want] of Object.entries(expected)) {
        expect(resolveNode(path, reg), path).toEqual(want);
      }
      expect(Object.keys(expected).length).toBeGreaterThan(200);
    });
  }
});

// Corpus guards for the `jobAbilities` slot-replace policy (see inherit.ts JOB_ABILITIES).
describe("job ability slots resolve to the child's authored entry alone", () => {
  const dataDir = resolveDataDir();
  const raw = loadRawJson(dataDir, "Jobs.json");
  const reg = buildRegistry(raw);


  const leakedKeyIsAbsent: [job: string, slot: string, args: RawNode][] = [
    ["Undead.DeathCrawler", "usable3", { soundTable: { "7": "GammaBurst.m4a" } }],
    ["Animal.Gamera", "usable1", { commonComponentArguments: undefined }],
    ["Animal.Gamera", "usable3", { aiChance: undefined }],
    ["Demonic.Demon", "usable2", { aiChance: undefined }],
    ["Demonic.Demon", "usable3", { aiChance: undefined }],
    ["Humanoid.Pyro", "usable1", { commonComponentArguments: undefined }],
    ["Humanoid.Wendigo", "usable1", { aiChance: undefined }],
    ["Humanoid.Wendigo", "usable2", { commonComponentArguments: undefined }],
    ["Insect.Pincer", "usable2", { commonComponentArguments: undefined, components: undefined }],
    ["Misc.Asura", "usable2", { aiChance: undefined }],
    ["Misc.Tengu", "usable2", { aiChance: undefined }],
  ];

  for (const [job, slot, expectations] of leakedKeyIsAbsent) {
    it(`${job} ${slot} carries no parent leak`, () => {
      const resolved = (resolveNode(job, reg)["jobAbilities"] as RawNode)[slot] as RawNode;
      const args = resolved["arguments"] as RawNode;
      for (const [key, want] of Object.entries(expectations)) {
        if (want === undefined) expect(args[key], `${job}.${slot}.${key}`).toBeUndefined();
        else expect(args[key], `${job}.${slot}.${key}`).toEqual(want);
      }
    });
  }

  it("every resolved slot equals the nearest ancestor that authored it, verbatim", () => {
    for (const path of Object.keys(loadRawJson(dataDir, "Jobs.resolved.json"))) {
      const slots = resolveNode(path, reg)["jobAbilities"] as RawNode;
      for (const [slot, entry] of Object.entries(slots)) {
        // Walk the raw chain child-first; the first node that authors this slot owns it whole.
        let cursor: RawNode | undefined = path
          .split(".")
          .reduce<RawNode>((n, k) => n[k] as RawNode, raw);
        while (cursor) {
          const own = cursor["jobAbilities"] as RawNode | undefined;
          if (own?.[slot] !== undefined) {
            expect(entry, `${path}.${slot}`).toEqual(own[slot]);
            break;
          }
          const p: unknown = cursor["parent"];
          cursor =
            typeof p === "string"
              ? p.split(".").reduce<RawNode>((n, k) => n[k] as RawNode, raw)
              : undefined;
        }
      }
    }
  });

  // Wholesale replace drops the parent slot, which only matches the binary's
  // `setParentAbilityData:` pointer while nothing can fall back to it.
  it("no job slot declares levelRestriction (the parent-fallback trigger)", () => {
    expect(() => assertNoJobLevelRestriction(raw)).not.toThrow();
  });
});
