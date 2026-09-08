import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const webRoot = resolve(import.meta.dirname, "..");
const dist = resolve(webRoot, "dist");
const forbiddenExtensions = new Set([
  ".ipa", ".zip", ".plist", ".strings", ".png", ".jpg", ".jpeg", ".webp",
  ".m4a", ".mp3", ".wav", ".fnt", ".ttf", ".otf",
]);


const licensedFontHashes = new Map([
  ["d0a980bb5e0a5142d67caddf37dd28eab5aea167e758d2ac0de5f4e9af3998dc", "Marker Felt (evolve-chain rows)"],
]);
// Content-neutral engine-shell artwork. Bind each reviewed hash to its stable output path so this
// exception cannot admit an arbitrary PNG (or even a renamed copy) into the distributable build.
const shellIconHashes = new Map([
  ["app-icon-192.png", "bc5c2b81462e3df3645274c21771c44d0de46552c5e614bc3f38ec4393adf9cf"],
  ["app-icon-512.png", "65c105db3aa671544f47a96b1feff56f7e2b031858c06cfb5a6acc86d5f53023"],
  ["app-icon-maskable-512.png", "394c2de31cac6c8484061cb372e95155390872764ad4edd00ed3099d9fa3d1c0"],
  ["apple-touch-icon.png", "01c0a2d90938a06830e7108d6a768623e8e496ddef277598fcfbb26ba8d1b720"],
  ["favicon-32.png", "0e0366b465841e8b452edddcf7dc7823966063a5df488c1d680ab88b901df25c"],
]);
const binarySignatures = [
  ["PNG", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
  ["ZIP", new Uint8Array([80, 75, 3, 4])],
  ["binary plist", new TextEncoder().encode("bplist00")],
];
const forbiddenProductionText = [
  "Scenario settings",
  "Egg spinning",
  'name="scenario-kind"',
  "Reserve promotion 6v6",
  "Online simulation (async + latency)",
];

const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}

try {
  await walk(dist);
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error("apps/web/dist is missing; run the web build before content:boundary");
  }
  throw error;
}

const errors = [];
// The worker must describe every emitted engine file with its final-byte integrity. This catches
// late build plugins changing HTML after precaching, and prevents offline-only missing chunks.
const worker = await readFile(join(dist, "sw.js"), "utf8");
const config = JSON.parse(worker.match(/const \{ revision, entries \} = (\{[^\n]+\});/)?.[1] ?? "null");
if (!config || !Array.isArray(config.entries)) {
  errors.push("sw.js: missing generated offline manifest");
} else {
  const expected = new Set(files.map((path) => relative(dist, path).replaceAll("\\", "/")));
  expected.delete("sw.js");
  for (const entry of config.entries) {
    if (!expected.delete(entry.path)) {
      errors.push(`sw.js: unexpected or duplicate precache path ${entry.path}`);
      continue;
    }
    const hash = createHash("sha256").update(await readFile(join(dist, entry.path))).digest("base64");
    if (entry.integrity !== `sha256-${hash}`) errors.push(`sw.js: stale integrity for ${entry.path}`);
  }
  for (const path of expected) errors.push(`sw.js: missing precache entry ${path}`);
}
for (const path of files) {
  const rel = relative(dist, path).replaceAll("\\", "/");
  const extension = extname(path).toLowerCase();
  const bytes = new Uint8Array(await readFile(path));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const licensedFont =
    (extension === ".ttf" || extension === ".otf") &&
    licensedFontHashes.get(hash);
  const shellIcon = extension === ".png" && shellIconHashes.get(rel) === hash;
  if (forbiddenExtensions.has(extension) && !licensedFont && !shellIcon) {
    errors.push(`${rel}: forbidden packaged-content extension ${extension}`);
  }
  for (const [label, signature] of binarySignatures) {
    if (startsWith(bytes, signature) && !shellIcon) errors.push(`${rel}: embedded ${label} file`);
  }
  if ([".html", ".js", ".css"].includes(extension)) {
    const text = new TextDecoder().decode(bytes);
    for (const marker of forbiddenProductionText) {
      if (text.includes(marker)) errors.push(`${rel}: development Scenario UI marker ${marker}`);
    }
  }
}

const indexHtml = await readFile(resolve(dist, "index.html"), "utf8");
const cspTag = indexHtml.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0];
const cspContent = cspTag?.match(/\bcontent=(["'])(.*?)\1/i)?.[2];
const expectedCsp = [
  ["default-src", ["*", "blob:", "data:"]],
  ["script-src", ["'self'", "'unsafe-eval'", "'unsafe-inline'", "blob:", "data:", "https:", "http:"]],
  ["style-src", ["*", "'unsafe-inline'", "blob:", "data:"]],
  ["img-src", ["*", "blob:", "data:"]],
  ["media-src", ["*", "blob:", "data:"]],
  ["connect-src", ["*", "blob:", "data:"]],
  ["font-src", ["*", "blob:", "data:"]],
  ["worker-src", ["*", "blob:", "data:"]],
  ["frame-src", ["*", "blob:", "data:"]],
  ["object-src", ["'none'"]],
  ["form-action", ["*"]],
  ["base-uri", ["'self'"]],
];

let csp;
try {
  csp = parseCsp(cspContent);
} catch (error) {
  errors.push(`index.html: invalid production CSP: ${error instanceof Error ? error.message : String(error)}`);
}
if (csp && JSON.stringify(csp) !== JSON.stringify(expectedCsp)) {
  errors.push("index.html: production CSP must exactly match the complete expected directive policy");
}

if (errors.length > 0) {
  throw new Error(`Content boundary failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}
console.log(`Content boundary passed: ${files.length} engine/shell files, no packaged game-content binaries.`);

function startsWith(value, prefix) {
  if (value.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (value[i] !== prefix[i]) return false;
  return true;
}

function parseCsp(content) {
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("missing Content-Security-Policy content");
  }
  const seen = new Set();
  const policy = [];
  for (const directive of content.split(";")) {
    const tokens = directive.trim().split(/\s+/);
    if (!tokens[0]) continue;
    const name = tokens[0].toLowerCase();
    if (seen.has(name)) {
      throw new Error(`duplicate directive ${tokens[0]} (directive names are case-insensitive)`);
    }
    seen.add(name);
    policy.push([name, tokens.slice(1)]);
  }
  return policy;
}
