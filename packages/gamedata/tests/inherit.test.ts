import { describe, it, expect } from "vitest";
import { buildRegistry, resolveNode } from "../src/inherit.js";
import type { RawNode } from "../src/rawLoad.js";

const tree = {
  Root: { class: "Monster", rootStats: { Attack: 10, Speed: 12 } },
  Cat: {
    Tabby: { parent: "Root", index: 1, rootStats: { Attack: 3 } },
    Fancy: { FancyTabby: { parent: "Cat.Tabby", index: 2 } },
  },
  Loop: { A: { parent: "Loop.B" }, B: { parent: "Loop.A" } },
} satisfies RawNode;

describe("resolveNode", () => {


  it("replaces a re-authored nested dict wholesale (child key wins, one level only)", () => {
    const reg = buildRegistry(tree);
    const r = resolveNode("Cat.Tabby", reg);
    expect(r).toEqual({ class: "Monster", index: 1, rootStats: { Attack: 3 } });
  });

  it("resolves grandparent chains", () => {
    const reg = buildRegistry(tree);
    const r = resolveNode("Cat.Fancy.FancyTabby", reg);
    expect(r["rootStats"]).toEqual({ Attack: 3 });
    expect(r["index"]).toBe(2);
  });

  it("throws on unknown parent", () => {
    const reg = buildRegistry({ X: { parent: "Nope" } });
    expect(() => resolveNode("X", reg)).toThrow(/Nope/);
  });

  it("throws on cycles", () => {
    const reg = buildRegistry(tree);
    expect(() => resolveNode("Loop.A", reg)).toThrow(/cycle/i);
  });

  it("throws on grouping-container paths that are not definitions", () => {
    const reg = buildRegistry(tree);
    // `Cat` and `Cat.Fancy` are pure namespace containers: no parent/class/index,
    // never referenced as a parent. Python's registry never contains them; a
    // path-based lookup on them must fail loudly, not return the raw container.
    expect(() => resolveNode("Cat", reg)).toThrow(/unknown node path/);
    expect(() => resolveNode("Cat.Fancy", reg)).toThrow(/unknown node path/);
  });

  it("resolved output is isolated from the registry (mutation regression)", () => {
    const localTree = {
      Root: { class: "Monster", rootStats: { Attack: 10, Speed: 12 } },
      Kid: { parent: "Root", index: 1 },
    } satisfies RawNode;
    const reg = buildRegistry(localTree);
    const first = resolveNode("Root", reg);
    (first["rootStats"] as RawNode)["Speed"] = 999; // must not corrupt the registry
    expect(resolveNode("Root", reg)["rootStats"]).toEqual({ Attack: 10, Speed: 12 });
    // Kid authors no rootStats of its own, so it still inherits the parent's map by reference.
    expect(resolveNode("Kid", reg)["rootStats"]).toEqual({ Attack: 10, Speed: 12 });
  });

  // Ports of tools/tests/test_inherit.py cases (adapted: registry passed pre-built as a Map,
  // and the node being resolved is looked up by path rather than passed as a bare object,
  // since the TS buildRegistry signature has no leaf_pred — it registers definition nodes
  // by a fixed predicate: parent/class/index key, or referenced as another node's parent).

  it("port: resolve keeps unauthored top-level keys but replaces re-authored maps", () => {
    const reg = buildRegistry({
      RootMonster: { class: "Monster", rootStats: { Attack: 10, Speed: 12 } },
      Leaf: { parent: "RootMonster", index: 7100, rootStats: { Attack: 3.5 } },
    });
    const out = resolveNode("Leaf", reg);
    expect(out["class"]).toBe("Monster"); // key the child never authored: inherited
    expect(out["index"]).toBe(7100);
    expect(out["rootStats"]).toEqual({ Attack: 3.5 }); // no leaked Speed
    expect(out).not.toHaveProperty("parent");
  });

  it("port: resolve multi-level chain", () => {
    const reg = buildRegistry({
      RootJob: { a: 1 },
      Mer: { MerWarrior: { parent: "RootJob", b: 2 } },
      Leaf: { parent: "Mer.MerWarrior", c: 3 },
    });
    const out = resolveNode("Leaf", reg);
    expect(out).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("port: build_registry addresses intermediate and leaf nodes", () => {
    const reg = buildRegistry({ Slime: { Metal: { MetalSlime: { index: 1 } } } });
    expect(reg.has("Slime.Metal.MetalSlime")).toBe(true);
  });


  it("replaces re-authored jobAbilities slots wholesale, but still unions the slot map", () => {
    const reg = buildRegistry({
      Parent: {
        jobAbilities: {
          usable1: {
            type: "Offensive.Stun.StunMagicAttack",
            arguments: { instanceName: "Horror", soundTable: { "1": "Sentence.m4a" } },
          },
          usable2: { type: "Offensive.Attack", arguments: { instanceName: "Claw", aiChance: 0.5 } },
        },
      },
      Child: {
        parent: "Parent",
        jobAbilities: {
          usable1: {
            type: "Offensive.Stun.StunMagicAttackAll",
            arguments: { instanceName: "BlackHole", soundTable: { "7": "GammaBurst.m4a" } },
          },
        },
      },
    });
    const slots = resolveNode("Child", reg)["jobAbilities"] as RawNode;

    expect(slots["usable1"]).toEqual({
      type: "Offensive.Stun.StunMagicAttackAll",
      arguments: { instanceName: "BlackHole", soundTable: { "7": "GammaBurst.m4a" } },
    });
    // Untouched slot: still inherited, since the parent walk installs keys the child omits.
    expect(slots["usable2"]).toEqual({
      type: "Offensive.Attack",
      arguments: { instanceName: "Claw", aiChance: 0.5 },
    });
  });


  it("unions only the jobAbilities map; every other nested dict replaces wholesale", () => {
    const reg = buildRegistry({
      Parent: {
        rootStats: { Attack: 10, Speed: 12 },
        jobAbilities: { usable1: { type: "A" }, usable2: { type: "C" } },
      },
      Child: { parent: "Parent", rootStats: { Attack: 3 }, jobAbilities: { usable1: { type: "B" } } },
    });
    const out = resolveNode("Child", reg);
    expect(out["rootStats"]).toEqual({ Attack: 3 }); // replaced wholesale
    const slots = out["jobAbilities"] as RawNode;
    expect(slots["usable1"]).toEqual({ type: "B" }); // slot value replaced
    expect(slots["usable2"]).toEqual({ type: "C" }); // slot map unioned
  });

  it("port: build_registry includes referenced base nodes", () => {
    const reg = buildRegistry({
      RootMonster: { class: "Monster", rootStats: { Attack: 10, Speed: 12 } },
      Mer: { MerKing: { parent: "RootMonster", index: 7100, rootStats: { Attack: 3.5 } } },
    });
    expect(reg.has("RootMonster")).toBe(true);
    const resolved = resolveNode("Mer.MerKing", reg);
    expect(resolved["class"]).toBe("Monster"); // inherited from base
    expect(resolved["rootStats"]).toEqual({ Attack: 3.5 });
  });
});
