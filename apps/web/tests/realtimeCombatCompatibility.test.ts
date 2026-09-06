import { zipSync } from "fflate";
import { expect, it } from "vitest";
import { importCodeModArchive, resolveCodeModProfile } from "@dib/mod-kernel";
import { createFullTrustCodeModRuntime } from "../src/content/codeModRuntime.js";
type Internal = any;

it("innermost hooks preserve asynchronous outer hooks, arguments, receiver, errors and disposal", async () => {
  const trace: string[] = [];
  const target = { factor: 2, run(value: number) { trace.push("stock"); return this.factor * value; } };
  const original = target.run;
  const pkg = await importCodeModArchive(zipSync({
    "manifest.json": new TextEncoder().encode(JSON.stringify({ schemaVersion: 4, apiVersion: 4,
      id: "dev.dragonislandblue.base-test", version: "1.0.0", displayName: "Base hook test",
      mode: "offline", dependencies: {}, entry: "main.js" })),
    "main.js": new TextEncoder().encode(`
      const {target, trace} = await dibMod.modules.load("test");
      dibMod.intercept(target, "run", async function(next, value) {
        trace.push("outer-before");
        await Promise.resolve();
        try { return (await next(value + 1)) + 3; } finally { trace.push("outer-after"); }
      });
      dibMod.exports.restore = dibMod.interceptBase(target, "run", function(next, value) {
        trace.push("inner");
        if (value < 0) throw new Error("inner failure");
        return next(value) + this.factor;
      });
    `),
  }), "base-test.dibmod");
  const runtime = await createFullTrustCodeModRuntime(await resolveCodeModProfile([pkg]), { modules: {
    list: () => ["test"], has: () => true, load: async () => ({ target, trace }),
  } });
  try {
    expect(await target.run(4)).toBe(15);
    expect(trace).toEqual(["outer-before", "inner", "stock", "outer-after"]);
    await expect(target.run(-3)).rejects.toThrow("inner failure");
    runtime.host.require<Internal>("mods.dev.dragonislandblue.base-test").restore();
    expect(await target.run(4)).toBe(13);
  } finally { runtime.dispose(); }
  expect(target.run).toBe(original);
});
