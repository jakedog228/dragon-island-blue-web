import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  importCodeModArchive,
  ModPackageError,
  resolveCodeModProfile,
  type CodeModPackage,
} from "../src/index.js";

function archive(
  id: string,
  source = "globalThis.exampleModLoaded = true;",
  dependencies: Readonly<Record<string, string>> = {},
  extraFiles: Readonly<Record<string, Uint8Array>> = {},
): Uint8Array {
  return zipSync({
    "manifest.json": strToU8(JSON.stringify({
      schemaVersion: 4,
      id,
      version: "1.0.0",
      displayName: id,
      apiVersion: 4,
      mode: "offline",
      dependencies,
      entry: "scripts/main.js",
    })),
    "scripts/main.js": strToU8(source),
    ...extraFiles,
  });
}

async function imported(
  id: string,
  dependencies: Readonly<Record<string, string>> = {},
): Promise<CodeModPackage> {
  return await importCodeModArchive(archive(id, undefined, dependencies), `${id}.dibmod`);
}

describe("full-trust code mod packages", () => {
  it("defaults old manifests to save-dependent and validates explicit save declarations", async () => {
    expect((await imported("dev.example.legacy")).manifest.saveCompatibility).toBe("dependent");
    for (const value of ["neutral", "dependent", null, true, "safe"]) {
      const bytes = archive("dev.example.classified", "void 0", {}, {
        "manifest.json": strToU8(JSON.stringify({ schemaVersion: 4, apiVersion: 4,
          id: "dev.example.classified", version: "1.0.0", displayName: "Classified",
          mode: "offline", dependencies: {}, entry: "scripts/main.js", saveCompatibility: value })),
      });
      if (value === "neutral" || value === "dependent") {
        expect((await importCodeModArchive(bytes, "classified.dibmod")).manifest.saveCompatibility).toBe(value);
      } else await expect(importCodeModArchive(bytes, "classified.dibmod")).rejects.toThrow(/saveCompatibility/);
    }
  });
  it("keeps neutral packages in activation identity and enforces dependencies and conflicts", async () => {
    const base = await imported("dev.example.base");
    const neutral = { ...await imported("dev.example.neutral"),
      manifest: { ...(await imported("dev.example.neutral")).manifest, saveCompatibility: "neutral" as const } };
    expect((await resolveCodeModProfile([base, neutral])).digest).not.toBe((await resolveCodeModProfile([base])).digest);
    await expect(resolveCodeModProfile([{ ...neutral, manifest: { ...neutral.manifest,
      dependencies: { "dev.example.missing": "*" } } }])).rejects.toThrow(/missing dependency/);
    await expect(resolveCodeModProfile([base, { ...neutral, manifest: { ...neutral.manifest,
      conflicts: { [base.manifest.id]: "*" } } }])).rejects.toThrow(/conflict/);
  });
  it("imports arbitrary bundle files without executing code", async () => {
    delete (globalThis as Record<string, unknown>)["exampleModLoaded"];
    const pkg = await importCodeModArchive(archive(
      "dev.example.everything",
      "globalThis.exampleModLoaded = true;",
      {},
      {
        "assets/panel.css": strToU8("body { color: rebeccapurple; }"),
        "data/config.json": strToU8('{"mode":"overhaul"}'),
        "scripts/helpers.mjs": strToU8("export const answer = 42;"),
      },
    ), "everything.dibmod");

    expect((globalThis as Record<string, unknown>)["exampleModLoaded"]).toBeUndefined();
    expect([...pkg.files.keys()]).toEqual([
      "assets/panel.css",
      "data/config.json",
      "manifest.json",
      "scripts/helpers.mjs",
      "scripts/main.js",
    ]);
    expect(new TextDecoder().decode(pkg.files.get("data/config.json"))).toContain("overhaul");
  });

  it("orders exact dependencies deterministically and binds the profile bytes", async () => {
    const first = await imported("dev.example.first");
    const second = await imported("dev.example.second", { "dev.example.first": "1.0.0" });
    const forward = await resolveCodeModProfile([first, second]);
    const reverse = await resolveCodeModProfile([second, first]);

    expect(reverse.digest).toBe(forward.digest);
    expect(reverse.packages.map((pkg) => pkg.manifest.id)).toEqual([
      "dev.example.first",
      "dev.example.second",
    ]);
  });

  it("rejects missing dependencies, cycles, legacy manifests, and unsafe paths", async () => {
    const missing = await imported("dev.example.missing", { "dev.example.absent": "1.0.0" });
    await expect(resolveCodeModProfile([missing])).rejects.toThrow(/missing dependency/);

    const left = await imported("dev.example.left", { "dev.example.right": "1.0.0" });
    const right = await imported("dev.example.right", { "dev.example.left": "1.0.0" });
    await expect(resolveCodeModProfile([left, right])).rejects.toThrow(/cycle/);

    const legacy = zipSync({
      "manifest.json": strToU8(JSON.stringify({
        schemaVersion: 2,
        id: "dev.example.legacy",
        version: "1.0.0",
        displayName: "Legacy",
        apiVersion: 2,
        mode: "offline",
        dependencies: {},
        permissions: ["unsafe.code.execute"],
        entry: "scripts/main.js",
      })),
      "scripts/main.js": strToU8("void 0"),
    });
    await expect(importCodeModArchive(legacy, "legacy.dibmod")).rejects.toThrow(
      /unknown field permissions|unsupported manifest schema/,
    );

    const unsafe = zipSync({
      "manifest.json": strToU8("{}"),
      "../escape.js": strToU8("void 0"),
    });
    await expect(importCodeModArchive(unsafe, "unsafe.dibmod")).rejects.toBeInstanceOf(
      ModPackageError,
    );
  });
});

interface ModRelations {
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly conflicts?: Readonly<Record<string, string>>;
  readonly loadAfter?: readonly string[];
  readonly loadBefore?: readonly string[];
  readonly priority?: number;
}

async function related(id: string, relations: ModRelations = {}): Promise<CodeModPackage> {
  const { version = "1.0.0", ...rest } = relations;
  const manifest: Record<string, unknown> = {
    schemaVersion: 4,
    id,
    version,
    displayName: id,
    apiVersion: 4,
    mode: "offline",
    dependencies: {},
    entry: "scripts/main.js",
    ...rest,
  };
  return await importCodeModArchive(zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "scripts/main.js": strToU8("void 0"),
  }), `${id}.dibmod`);
}

const idsOf = (profile: { packages: readonly CodeModPackage[] }): readonly string[] =>
  profile.packages.map((pkg) => pkg.manifest.id);

describe("multi-mod load order", () => {
  it("accepts version ranges instead of an exact pin", async () => {
    const library = await related("dev.example.library", { version: "1.4.2" });
    const caret = await related("dev.example.caret", {
      dependencies: { "dev.example.library": "^1.2.0" },
    });
    await expect(resolveCodeModProfile([library, caret])).resolves.toBeDefined();

    const range = await related("dev.example.range", {
      dependencies: { "dev.example.library": ">=1.0.0 <2.0.0" },
    });
    await expect(resolveCodeModProfile([library, range])).resolves.toBeDefined();

    const alternatives = await related("dev.example.alternatives", {
      dependencies: { "dev.example.library": "0.9.0 || ~1.4.0" },
    });
    await expect(resolveCodeModProfile([library, alternatives])).resolves.toBeDefined();

    const tooNew = await related("dev.example.too-new", {
      dependencies: { "dev.example.library": "^2.0.0" },
    });
    await expect(resolveCodeModProfile([library, tooNew])).rejects.toThrow(
      /requires dev\.example\.library@\^2\.0\.0, got 1\.4\.2/,
    );

    // A prerelease sorts below its own release, so it does not satisfy a floor at that release.
    const prerelease = await related("dev.example.library", { version: "2.0.0-beta.1" });
    const needsRelease = await related("dev.example.needs-release", {
      dependencies: { "dev.example.library": ">=2.0.0" },
    });
    await expect(resolveCodeModProfile([prerelease, needsRelease])).rejects.toThrow(/requires/);
  });

  it("orders optional dependencies when present and reports them when absent", async () => {
    const hud = await related("dev.example.hud", { version: "1.1.0" });
    const patch = await related("dev.example.patch", {
      optionalDependencies: { "dev.example.hud": "^1.0.0" },
      // Without the optional edge, `patch` would sort ahead of `hud` on id alone.
      priority: -50,
    });

    const together = await resolveCodeModProfile([patch, hud]);
    expect(idsOf(together)).toEqual(["dev.example.hud", "dev.example.patch"]);
    expect(together.advisories).toEqual([]);

    const alone = await resolveCodeModProfile([patch]);
    expect(idsOf(alone)).toEqual(["dev.example.patch"]);
    expect(alone.advisories).toEqual([
      expect.objectContaining({ kind: "optional-missing", modId: "dev.example.patch" }),
    ]);

    const oldHud = await related("dev.example.hud", { version: "0.9.0" });
    await expect(resolveCodeModProfile([patch, oldHud])).rejects.toThrow(
      /optional dev\.example\.hud@\^1\.0\.0 is selected at the incompatible version 0\.9\.0/,
    );
  });

  it("refuses a declared conflict but lets the player insist", async () => {
    const overhaul = await related("dev.example.overhaul", {
      conflicts: { "dev.example.rebalance": "*" },
    });
    const rebalance = await related("dev.example.rebalance");
    await expect(resolveCodeModProfile([overhaul, rebalance])).rejects.toThrow(
      /declares a conflict with dev\.example\.rebalance@1\.0\.0/,
    );

    const forced = await resolveCodeModProfile([overhaul, rebalance], {
      allowDeclaredConflicts: true,
    });
    expect(idsOf(forced)).toEqual(["dev.example.overhaul", "dev.example.rebalance"]);
    expect(forced.advisories).toEqual([
      expect.objectContaining({ kind: "declared-conflict-overridden" }),
    ]);

    // A conflict declared against other versions leaves this pairing alone.
    const narrow = await related("dev.example.narrow", {
      conflicts: { "dev.example.rebalance": "<1.0.0" },
    });
    await expect(resolveCodeModProfile([narrow, rebalance])).resolves.toBeDefined();
  });

  it("applies soft ordering only for packages that are actually selected", async () => {
    const early = await related("dev.example.zzz-early", {
      loadBefore: ["dev.example.aaa-late"],
      // Both the id tie-breaker and priority would otherwise put this package last.
      priority: 100,
    });
    const late = await related("dev.example.aaa-late");
    expect(idsOf(await resolveCodeModProfile([late, early]))).toEqual([
      "dev.example.zzz-early",
      "dev.example.aaa-late",
    ]);

    const dangling = await related("dev.example.dangling", {
      loadAfter: ["dev.example.not-selected"],
    });
    expect(idsOf(await resolveCodeModProfile([dangling]))).toEqual(["dev.example.dangling"]);
  });

  it("breaks unordered ties by priority, then id, and lets the player override", async () => {
    const first = await related("dev.example.aaa");
    const second = await related("dev.example.bbb");
    const third = await related("dev.example.ccc", { priority: -10 });
    const selected = [first, second, third];

    expect(idsOf(await resolveCodeModProfile(selected))).toEqual([
      "dev.example.ccc",
      "dev.example.aaa",
      "dev.example.bbb",
    ]);

    const overridden = await resolveCodeModProfile(selected, {
      priorityOverrides: { "dev.example.bbb": -100 },
    });
    expect(idsOf(overridden)).toEqual([
      "dev.example.bbb",
      "dev.example.ccc",
      "dev.example.aaa",
    ]);
    expect(overridden.advisories).toEqual([
      expect.objectContaining({ kind: "priority-override", modId: "dev.example.bbb" }),
    ]);
    // Reordering changes what overwrites what, so it must change the save-binding identity.
    expect(overridden.digest).not.toBe((await resolveCodeModProfile(selected)).digest);
  });

  it("keeps declared edges winning over any priority the player asks for", async () => {
    const library = await related("dev.example.base");
    const consumer = await related("dev.example.consumer", {
      dependencies: { "dev.example.base": "*" },
    });
    const forced = await resolveCodeModProfile([library, consumer], {
      priorityOverrides: { "dev.example.consumer": -1000, "dev.example.base": 1000 },
    });
    expect(idsOf(forced)).toEqual(["dev.example.base", "dev.example.consumer"]);
  });

  it("names the packages in an unsatisfiable load order", async () => {
    const left = await related("dev.example.loop-left", { loadAfter: ["dev.example.loop-right"] });
    const right = await related("dev.example.loop-right", { loadAfter: ["dev.example.loop-left"] });
    await expect(resolveCodeModProfile([left, right])).rejects.toThrow(
      /cycle: dev\.example\.loop-left -> dev\.example\.loop-right/,
    );
  });

  it("rejects incoherent relation declarations at import", async () => {
    await expect(related("dev.example.self", { loadAfter: ["dev.example.self"] })).rejects.toThrow(
      /may not name the package itself/,
    );
    await expect(related("dev.example.both", {
      dependencies: { "dev.example.other": "*" },
      conflicts: { "dev.example.other": "*" },
    })).rejects.toThrow(/both depended on and declared incompatible/);
    await expect(related("dev.example.bad-range", {
      dependencies: { "dev.example.other": "not-a-range" },
    })).rejects.toThrow(/invalid dependencies version range/);
    await expect(related("dev.example.bad-priority", { priority: 1.5 })).rejects.toThrow(
      /priority must be an integer/,
    );
    await expect(related("dev.example.bad-list", {
      loadAfter: "dev.example.other" as unknown as readonly string[],
    })).rejects.toThrow(/loadAfter must be an array/);
  });
});
