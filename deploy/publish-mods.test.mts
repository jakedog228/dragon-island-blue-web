import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { zipMod, screenshot } from "../apps/game-server/tests/helpers/communityFixtures.js";

const root = resolve(import.meta.dirname, "..");
const tsx = join(root, "apps/game-server/node_modules/tsx/dist/cli.mjs");
async function run(args: string[], command = process.execPath) {
  const child = spawn(command, args, { cwd: root, timeout: 30000, windowsHide: true });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const [code] = await once(child, "close");
  return { code, output };
}
test("Linux publisher activation and rollback", { skip: process.platform !== "linux" }, async () => {
  const result = await run(["deploy/publish-mods.test.py"], "python3");
  assert.equal(result.code, 0, result.output);
});
test("publishing snapshots valid packages and refuses unintended files, missing screenshots, and malformed archives", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "dib-publish-test-"));
  try {
    const source = join(scratch, "source");
    await mkdir(source);
    await writeFile(join(source, "trail.dibmod"), zipMod("dev.test.trail", "1.0.0"));
    await writeFile(join(source, "trail.listing.json"), JSON.stringify({ title: "Trail", screenshots: ["trail.screenshot-1.png"] }));
    await writeFile(join(source, "trail.screenshot-1.png"), screenshot());
    const prepare = (target: string) => run([tsx, "deploy/prepare-mods.mts", source, join(scratch, target)]);
    const valid = await prepare("valid");
    assert.equal(valid.code, 0, valid.output);
    assert.equal(JSON.parse(await readFile(join(scratch, "valid/publish-manifest.json"), "utf8")).length, 1);
    await writeFile(join(source, "savefile0"), "private save");
    const extra = await prepare("extra");
    assert.notEqual(extra.code, 0); assert.match(extra.output, /Unexpected catalog entry: savefile0/);
    await rm(join(source, "savefile0"));
    await rm(join(source, "trail.screenshot-1.png"));
    assert.notEqual((await prepare("missing")).code, 0);
    await writeFile(join(source, "trail.screenshot-1.png"), screenshot());
    await writeFile(join(source, "trail.dibmod"), "corrupt archive");
    assert.notEqual((await prepare("corrupt")).code, 0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("HTTP verification follows catalog pagination and detects corrupted downloads and missing images", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "dib-verify-test-"));
  const bytes = Buffer.from("download fixture");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const entries = Array.from({ length: 21 }, (_, i) => ({
    id: `mod-${i}`, modId: `dev.test.mod${i}`, title: `Mod ${i}`, summary: "Summary", author: "DIB Web",
    screenshots: [digest], releases: [{ version: "1.0.0", digest, byteLength: bytes.length }],
  }));
  let fault = "", pages: number[] = [], readinessFailures = 2;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname.endsWith("/readiness")) {
      if (readinessFailures-- > 0) { res.statusCode = 503; res.end(); return; }
      res.end('{"ready":true}'); return;
    }
    if (url.pathname === "/api/community/mods") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      pages.push(offset);
      res.end(JSON.stringify({ mods: entries.slice(offset, offset + 20).map(entry => ({ ...entry, author: { displayName: entry.author } })), next: offset === 0 ? 20 : null }));
      return;
    }
    if (fault === "missing" && url.pathname.includes("/image/")) { res.statusCode = 404; res.end(); return; }
    res.end(fault === "corrupt" ? "wrong bytes" : bytes);
  });
  try {
    await writeFile(join(scratch, "manifest.json"), JSON.stringify(entries));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address() as { port: number };
    const args = ["deploy/verify-mods.mjs", `http://127.0.0.1:${address.port}`, join(scratch, "manifest.json")];
    const valid = await run(args);
    assert.equal(valid.code, 0, valid.output);
    assert.deepEqual(pages, [0, 20]);
    fault = "corrupt"; pages = [];
    const corrupt = await run(args);
    assert.notEqual(corrupt.code, 0); assert.match(corrupt.output, /Bad download digest/);
    fault = "missing";
    const missing = await run(args);
    assert.notEqual(missing.code, 0); assert.match(missing.output, /HTTP 404/);
  } finally {
    server.closeAllConnections(); server.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
