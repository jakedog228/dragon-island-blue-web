import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { importCodeModArchive, resolveCodeModProfile } from "@dib/mod-kernel";
import { createFullTrustCodeModRuntime } from "../src/content/codeModRuntime.js";

const webRoot = resolve(import.meta.dirname, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(webRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function pngDimensions(relativePath: string): { width: number; height: number } {
  const bytes = readFileSync(resolve(webRoot, relativePath));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, signature.length).equals(signature)) {
    throw new Error(`${relativePath} is not a PNG`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

type CspPolicy = Array<[string, string[]]>;

const expectedCsp: CspPolicy = [
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

function cspFrom(indexHtml: string): CspPolicy {
  const tag = indexHtml.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0];
  const content = tag?.match(/\bcontent=(["'])(.*?)\1/i)?.[2];
  if (!content) throw new Error("index.html is missing its Content-Security-Policy meta tag");

  const seen = new Set<string>();
  return content.split(";").flatMap((directive): CspPolicy => {
    const tokens = directive.trim().split(/\s+/);
    if (!tokens[0]) return [];
    const name = tokens[0].toLowerCase();
    if (seen.has(name)) {
      throw new Error(`duplicate CSP directive: ${tokens[0]} (directive names are case-insensitive)`);
    }
    seen.add(name);
    return [[name, tokens.slice(1)]];
  });
}

describe("Asset Archive landing and developer documentation", () => {
  it("uses the requested concise loader copy and replaces the structure disclosure with the guide", () => {
    const gate = source("src/content/contentGate.ts");
    expect(gate).toContain("DIB Engine");
    expect(gate).toContain("Choose asset archive");
    expect(gate).toContain('<button type="button" disabled>Choose play mode</button>');
    expect(gate).toContain('value="local"> Offline');
    expect(gate).not.toContain('value="local" checked');
    expect(gate).toContain('data-mode-detail="local"');
    expect(gate).toContain('data-mode-detail="official"');
    expect(source("src/debug/scenarioGate.ts")).toContain('data-mode-detail="scenario"');
    expect(gate).not.toContain("selected. Choose how you want to play.");
    expect(gate).not.toContain("Choose where this session keeps its progress.");
    expect(gate).not.toContain("Confirm usage rights to start playing.");
    expect(gate).not.toContain("Choose your archive first. It stays in this browser tab.");
    expect(gate).not.toContain("Everything is ready.");
    expect(gate).not.toContain("An archive is required before play options become available.");
    expect(gate).toContain('href="./modding.html"');
    expect(gate).not.toContain("Select an IPA or ZIP containing");
    expect(gate).not.toContain("IPA or ZIP archive");
    expect(gate).not.toContain("Load locally");
    expect(gate).not.toContain("Accepted structure");
    expect(gate).not.toContain("<details>");
  });

  it("publishes the modding guide and stable archive contract", () => {
    const guide = source("modding.html");
    const spec = source("asset-archive-spec.md");
    const vite = source("vite.config.ts");

    expect(guide).toContain('type="text/markdown" href="./asset-archive-spec.md"');
    expect(vite).toContain('fileName: "asset-archive-spec.md"');

    expect(spec).toMatch(/^---\nschema_id: asset-archive-contract\nschema_version: 1/m);
    expect(spec).toContain("## 2. Archive envelope");
    expect(spec).toContain("## 6. Monster schema");
    expect(spec).toContain("## 11. Renderer asset roles");
    expect(spec).toContain("## 14. Supplementary Offline Mods");
    expect(spec).toContain("## 16. Validation contract");
  });

  it("keeps public authoring copy product-neutral", () => {
    const publicCopy = [
      source("src/content/contentGate.ts"),
      source("modding.html"),
      source("asset-archive-spec.md"),
    ].join("\n");

    expect(publicCopy).not.toMatch(/dragon island blue/i);
    expect(publicCopy).not.toMatch(/\boriginal[- ]format\b/i);
    expect(publicCopy).not.toMatch(/\bsource format\b/i);
  });

  it("publishes a content-neutral landscape web-app shell without reopening publicDir", () => {
    const index = source("index.html");
    const manifest = JSON.parse(source("app.webmanifest")) as Record<string, unknown>;
    const vite = source("vite.config.ts");
    expect(index).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(index).toContain('name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
    expect(manifest).toMatchObject({
      start_url: "./",
      scope: "./",
      display: "fullscreen",
      orientation: "landscape",
      background_color: "#000000",
      icons: [
        {
          src: "./app-icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "./app-icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "./app-icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    });
    expect(pngDimensions("app-icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngDimensions("app-icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngDimensions("app-icon-maskable-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngDimensions("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(pngDimensions("favicon-32.png")).toEqual({ width: 32, height: 32 });
    expect(vite).toContain("publicDir: false");
    expect(vite).toContain('attrs: { rel: "manifest", href: "./app.webmanifest" }');
    expect(vite).toContain('attrs: { rel: "apple-touch-icon", sizes: "180x180", href: "./apple-touch-icon.png" }');
    expect(vite).toContain('fileName: url.slice(1)');
    expect(vite).toContain('"/app.webmanifest"');
    expect(vite).toContain('"/app-icon-192.png"');
    expect(vite).toContain('"/app-icon-512.png"');
    expect(vite).toContain('"/app-icon-maskable-512.png"');
    expect(vite).toContain('"/apple-touch-icon.png"');
    expect(vite).toContain('"/favicon-32.png"');
  });

  it("keeps the main gate ordered, progressively compact, and dark-themes constrained overflow", () => {
    const index = source("index.html");
    const gate = source("src/content/contentGate.ts");
    const viewport = source("src/platform/gameViewport.ts");
    const stage = source("../../packages/renderer/src/stage.ts");
    const sourceLoading = source("src/content/sourceLoadingScreen.ts");
    const guideStyles = source("src/modding/moddingGuide.css");

    expect(index).not.toContain('"archive storage"');
    expect(index).toContain("width: min(680px, 100%)");
    expect(index).toContain(".content-gate__save-mode:disabled > .content-gate__save-mode-row");
    expect(index).toContain(".content-gate__finish.content-gate__section--blocked");
    expect(index).toContain(".content-gate--has-file .content-gate__privacy");
    expect(index).toContain("grid-template-rows: 0fr");
    expect(index).not.toContain(".content-gate--has-file .content-gate__privacy { display: none;");
    expect(index).toContain(".content-gate--has-file .content-gate__guide");
    expect(index).not.toContain(
      ".content-gate__archive.content-gate__section--complete .content-gate__section-heading { display: none; }",
    );
    expect(gate).toContain("Choose game content to unlock play modes.");
    expect(gate).toContain("All assets stay on this device.");
    expect(gate).toContain("Manage pages in Offline settings.");
    expect(sourceLoading).toContain(
      "revealFrame = globalThis.requestAnimationFrame(() => {\n" +
      "        revealFrame = globalThis.requestAnimationFrame(() => {",
    );
    expect(gate.indexOf('data-gate-section="archive"'))
      .toBeLessThan(gate.indexOf('data-gate-section="storage"'));
    expect(gate.indexOf('data-gate-section="storage"'))
      .toBeLessThan(gate.indexOf('data-gate-section="finish"'));
    expect(index).toContain("scrollbar-color: #52689e #090d18");
    expect(index).toContain("*::-webkit-scrollbar-thumb");
    expect(index).toContain("color-scheme: dark");
    expect(index).toContain("height: var(--dib-app-viewport-height, 100dvh)");
    expect(index).toContain("env(safe-area-inset-bottom, 0px)");
    expect(viewport).toContain('readings.standalone');
    expect(viewport).toContain('window.visualViewport?.addEventListener("resize", settle)');
    expect(viewport).toContain('document.addEventListener("fullscreenchange", settle)');
    expect(stage).toContain("new ResizeObserver");
    expect(gate).toContain('data-fullscreen-action');
    expect(gate).toContain("activateFullscreenExperience");
    expect(gate).toContain("shouldOfferFullscreenAction");
    expect(guideStyles).toContain("scrollbar-color: var(--scroll-thumb) var(--page)");
    expect(guideStyles).toContain("*::-webkit-scrollbar-thumb");
  });

  it("makes the full-trust mod execution boundary explicit in the app CSP", () => {
    const csp = cspFrom(source("index.html"));
    expect(csp).toEqual(expectedCsp);
    const directives = new Map(csp);
    expect(directives.get("script-src")).toContain("'unsafe-eval'");
    expect(directives.get("connect-src")).toContain("*");
    expect(directives.get("img-src")).toContain("*");
  });

  it("keeps Online unavailable in both the content UI and the final boot handoff for Offline mods", () => {
    const gate = source("src/content/contentGate.ts");
    const main = source("src/main.ts");
    expect(gate).toContain('data-mode-row="official"');
    expect(gate).toContain("officialModeInput.disabled = busy || !onlineAvailability.available");
    expect(gate).toContain("assertOnlinePlayAvailable({");
    expect(gate).toContain("assertOfficialContentBoundary(acquired)");
    expect(main).toContain("assertOfficialContentBoundary(acquired)");
  });

  it("executes mods in the app realm and publishes the complete lazy web module graph", () => {
    const runtime = source("src/content/codeModRuntime.ts");
    const modules = source("src/content/modModuleCatalog.ts");
    const vite = source("vite.config.ts");
    expect(runtime).toContain("new AsyncFunction");
    expect(runtime).not.toContain("iframe");
    expect(runtime).not.toContain("Worker");
    expect(modules).toContain('"../**/*.ts"');
    expect(modules).toContain('"!../**/*.test.ts"');
    expect(modules).toContain('"!../debug/**"');
    expect(modules).toContain('"@dib/engine"');
    expect(vite).not.toContain("code-mod-sandbox");
  });

  it("rejects a broad-first duplicate directive, including a case-variant name", () => {
    const broadFirst = source("index.html").replace(
      "img-src * blob: data:;",
      "IMG-SRC https://arbitrary.example; img-src * blob: data:;",
    );

    // CSP uses the first directive, so a browser would retain the broad IMG-SRC value.
    expect(() => cspFrom(broadFirst)).toThrow(/duplicate CSP directive: IMG-SRC/i);
  });
});

describe("Integrated modding documentation", () => {
  it("keeps every internal navigation target unique and publishes both references", () => {
    const guide = source("modding.html");
    const ids = [...guide.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, target] of guide.matchAll(/href="#([^"]+)"/g)) {
      expect(ids, `missing target ${target}`).toContain(target);
    }
    expect(source("vite.config.ts")).toContain('moddingGuide: resolve(webRoot, "modding.html")');
    expect(source("vite.config.ts")).toContain('fileName: "code-mod-api.md"');
    expect(guide).toContain('href="./code-mod-api.md"');
  });

  it("loads and executes the published quick-start through the real v4 runtime and restores its patch", async () => {
    const guide = source("modding.html");
    const example = (name: string): string => {
      const text = guide.match(new RegExp(`data-example="${name}">([\\s\\S]*?)</code>`))?.[1];
      if (text === undefined) throw new Error(`Missing guide example ${name}`);
      return text.replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
    };
    const bytes = zipSync({
      "manifest.json": strToU8(example("mod-manifest")),
      "scripts/main.js": strToU8(example("mod-entry")),
    });
    const pkg = await importCodeModArchive(bytes, "inspector.dibmod");
    const profile = await resolveCodeModProfile([pkg]);
    class BattleNode {
      readonly state = "battle";
      renderGameState() { return { state: this.state }; }
    }
    const original = BattleNode.prototype.renderGameState;
    const id = "web/battle/battleNode.ts";
    const runtime = await createFullTrustCodeModRuntime(profile, {
      modules: {
        list: () => [id],
        has: (name) => name === id,
        load: async (name) => {
          expect(name).toBe(id);
          return { BattleNode };
        },
      },
    });
    try {
      expect(new BattleNode().renderGameState()).toEqual({
        state: "battle", myInspector: { active: true },
      });
      const boot = { scenes: { ready: true } };
      expect(await runtime.runPhase("boot:ready", boot)).toBe(boot);
    } finally {
      runtime.dispose();
    }
    expect(BattleNode.prototype.renderGameState).toBe(original);
  });
});
