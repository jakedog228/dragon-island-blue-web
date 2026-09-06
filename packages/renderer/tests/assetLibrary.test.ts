import { describe, it, expect, vi, beforeEach } from "vitest";

// pixi.js cannot be imported for real under vitest's Node environment (module-scope browser
// sniffing reads `navigator`), so mock exactly the surface assetLibrary.ts + text.ts touch. The
// mock's Cache is a plain Map with the real Cache's has/get/set/reset shape; the text parser and
// BitmapFont constructor retain the parsed face so these tests can assert the CSP/blob-safe manual
// font path installs the family that BitmapText will resolve.
vi.mock("pixi.js", () => {
  const store = new Map<string, unknown>();
  const parser = {
    test: vi.fn(() => true),
    parse: vi.fn((text: string) => ({
      baseLineOffset: 0,
      chars: {},
      pages: [{ id: 0, file: /file="([^"]+)"/.exec(text)?.[1] ?? "page.png" }],
      lineHeight: 40,
      fontSize: 40,
      fontFamily: /face="([^"]+)"/.exec(text)?.[1],
    })),
  };
  return {
    Assets: { load: vi.fn(async (asset: string | { src: string }) => ({ url: typeof asset === "string" ? asset : asset.src })) },
    BitmapFont: class {
      fontFamily: string;
      constructor(public readonly options: { data: { fontFamily: string } }, public readonly src: string) {
        this.fontFamily = options.data.fontFamily;
      }
    },
    bitmapFontTextParser: parser,
    Spritesheet: class {
      textures = {};
      constructor(public readonly texture: unknown, public readonly data: unknown) {}
      async parse() {}
    },
    Cache: {
      has: (k: string) => store.has(k),
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => {
        store.set(k, v);
      },
      reset: () => store.clear(),
    },
    BitmapText: class {},
  };
});

import { Assets, Cache, bitmapFontTextParser } from "pixi.js";
import { AssetLibrary } from "../src/assetLibrary.js";
import { BMFONT_SHARED_FACE, bitmapFontCacheKey } from "../src/bitmapFontFile.js";
import { BITMAP_FONT_ASSET, BITMAP_FONT_FAMILY } from "../src/text.js";

const FONT_KEYS = ["arial_14-hd", "arial_14_bold-hd", "arial_18_bold-hd", "arial_20_bold-hd"];

const manifest = {
  atlases: {},
  audio: {},
  sprites: {},
  fonts: Object.fromEntries(
    FONT_KEYS.map((k) => [k, { fnt: `fonts/${k}.fnt`, texture: `fonts/${k.replace("-hd", "_0-hd")}.png` }]),
  ),
};

/** Same shape as the real files: shared face, everything else irrelevant to the loader. */
const fntText = () =>
  `info face="${BMFONT_SHARED_FACE}" size=40 bold=1 italic=0 charset="" unicode=1\n` +
  "common lineHeight=40 base=32 scaleW=512 scaleH=512 pages=1\n" +
  'page id=0 file="page_0-hd.png"\n';

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith("manifest.json")) {
    return { ok: true, json: async () => manifest } as unknown as Response;
  }
  if (url.endsWith(".fnt")) {
    return { ok: true, text: async () => fntText() } as unknown as Response;
  }
  return { ok: false, status: 404 } as unknown as Response;
});

const parseMock = vi.mocked(bitmapFontTextParser.parse);
const assetLoadMock = vi.mocked(Assets.load);

beforeEach(() => {
  Cache.reset();
  fetchMock.mockClear();
  parseMock.mockClear();
  assetLoadMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("AssetLibrary.font()", () => {
  it("registers the font in Pixi's Cache under the asset-key alias, with the face patched to match", async () => {
    const lib = await AssetLibrary.load("http://test/assets");
    await lib.font("arial_14-hd");

    // Cached under the exact key BitmapFontManager.getFont looks up for fontFamily "arial_14-hd".
    expect(Cache.has(bitmapFontCacheKey("arial_14-hd"))).toBe(true);
    // The parser receives the patched face while the page texture is loaded explicitly. This
    // avoids trying to resolve one opaque blob URL relative to another.
    expect(parseMock).toHaveBeenCalledWith(
      expect.stringMatching(/face="arial_14-hd"[\s\S]*file="page_0-hd\.png"/),
    );
    expect(assetLoadMock).toHaveBeenCalledWith({
      src: "http://test/assets/fonts/arial_14_0-hd.png",
      parser: "texture",
    });
    const cached = Cache.get(bitmapFontCacheKey("arial_14-hd")) as { fontFamily: string };
    expect(cached.fontFamily).toBe("arial_14-hd");
  });

  it("all four fonts coexist under distinct aliases (the face-collision regression)", async () => {
    const lib = await AssetLibrary.load("http://test/assets");
    await Promise.all(FONT_KEYS.map((k) => lib.font(k)));

    for (const key of FONT_KEYS) {
      const cached = Cache.get(bitmapFontCacheKey(key)) as { fontFamily: string };
      expect(cached.fontFamily).toBe(key); // each alias resolves its OWN font, not last-loaded
    }
  });

  it(`pins the legacy "${BMFONT_SHARED_FACE}" registration to ${BITMAP_FONT_ASSET}, not to load order`, async () => {
    const lib = await AssetLibrary.load("http://test/assets");


    await lib.font(BITMAP_FONT_ASSET);
    await lib.font("arial_14-hd");

    const legacy = Cache.get(bitmapFontCacheKey(BITMAP_FONT_FAMILY));
    expect(legacy).toBe(Cache.get(bitmapFontCacheKey(BITMAP_FONT_ASSET)));
    expect((legacy as { fontFamily: string }).fontFamily).toBe(BITMAP_FONT_ASSET);
  });

  it("does not register the legacy family when the pinned font was never loaded", async () => {
    const lib = await AssetLibrary.load("http://test/assets");
    await lib.font("arial_14-hd");
    expect(Cache.has(bitmapFontCacheKey(BITMAP_FONT_FAMILY))).toBe(false);
  });

  it("is idempotent: a second load of the same font is a cache hit, no re-fetch", async () => {
    const lib = await AssetLibrary.load("http://test/assets");
    await lib.font("arial_14-hd");
    const fetchesAfterFirst = fetchMock.mock.calls.length;
    await lib.font("arial_14-hd");
    expect(fetchMock.mock.calls.length).toBe(fetchesAfterFirst);
    expect(parseMock).toHaveBeenCalledTimes(1);
  });

  it("accepts an independently authored face and still caches by manifest asset key", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => manifest }) as unknown as Response);
    fetchMock.mockImplementationOnce(
      async () => ({ ok: true, text: async () => fntText().replace(BMFONT_SHARED_FACE, "DejaVu Sans") }) as unknown as Response,
    );
    const lib = await AssetLibrary.load("http://test/assets");
    await lib.font("arial_14-hd");
    expect(parseMock).toHaveBeenCalledWith(expect.stringContaining('face="arial_14-hd"'));
    expect(Cache.has(bitmapFontCacheKey("arial_14-hd"))).toBe(true);
  });

  it("fails loud when the .fnt info line has no quoted face attribute", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => manifest }) as unknown as Response);
    fetchMock.mockImplementationOnce(
      async () => ({ ok: true, text: async () => "info size=40 bold=1\n" }) as unknown as Response,
    );
    const lib = await AssetLibrary.load("http://test/assets");
    await expect(lib.font("arial_14-hd")).rejects.toThrow(/exactly one quoted face attribute/);
    expect(Cache.has(bitmapFontCacheKey("arial_14-hd"))).toBe(false);
  });

  it("fails loud on a font name missing from the manifest", async () => {
    const lib = await AssetLibrary.load("http://test/assets");
    await expect(lib.font("arial_16-hd")).rejects.toThrow(/unknown font/);
  });

  it("resolves an in-memory manifest without fetching a server manifest", async () => {
    const lib = AssetLibrary.fromManifest(
      { atlases: {}, audio: { click: "audio/click.wav" }, fonts: {}, particles: {}, sprites: { hero: "sprites/hero.png" } },
      (path) => `blob:local/${path}`,
    );
    expect(lib.hasSprite("hero")).toBe(true);
    expect(lib.hasAudio("click.wav")).toBe(true);
    expect(lib.audioUrl("click.wav")).toBe("blob:local/audio/click.wav");
    await lib.sprite("hero");
    expect(assetLoadMock).toHaveBeenCalledWith({ src: "blob:local/sprites/hero.png", parser: "texture" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AssetLibrary blob-backed atlases", () => {
  it("parses each atlas once and shares the in-flight result like Pixi's URL cache", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ frames: {}, meta: { image: "ignored.png", scale: "1" } }),
    }) as unknown as Response);
    const lib = AssetLibrary.fromManifest(
      {
        atlases: { "General-hd": { image: "atlases/General-hd.png", sheet: "atlases/General-hd.json" } },
        audio: {},
        fonts: {},
        particles: {},
        sprites: {},
      },
      (path) => `blob:local/${path}`,
    );

    const [first, second] = await Promise.all([lib.atlas("General-hd"), lib.atlas("General-hd")]);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("blob:local/atlases/General-hd.json");
    expect(assetLoadMock).toHaveBeenCalledTimes(1);
    expect(assetLoadMock).toHaveBeenCalledWith({
      src: "blob:local/atlases/General-hd.png",
      parser: "texture",
    });
  });
});

describe("AssetLibrary blob-backed particles", () => {
  it("fetches and decodes each particle once, sharing startup preload with later presentation", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ maxParticles: 20 }),
    }) as unknown as Response);
    const lib = AssetLibrary.fromManifest(
      {
        atlases: {},
        audio: {},
        fonts: {},
        particles: {
          "progressBarParticles.plist": {
            config: "particles/progressBarParticles.json",
            texture: "particles/particleTexture.png",
          },
        },
        sprites: {},
      },
      (path) => `blob:local/${path}`,
    );

    const [startup, concurrent] = await Promise.all([
      lib.particle("progressBarParticles.plist"),
      lib.particle("progressBarParticles.plist"),
    ]);
    const presentation = await lib.particle("progressBarParticles.plist");

    expect(startup).toBe(concurrent);
    expect(presentation).toBe(startup);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("blob:local/particles/progressBarParticles.json");
    expect(assetLoadMock).toHaveBeenCalledTimes(1);
    expect(assetLoadMock).toHaveBeenCalledWith({
      src: "blob:local/particles/particleTexture.png",
      parser: "texture",
    });
  });
});
