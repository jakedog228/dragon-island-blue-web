import {
  Assets,
  BitmapFont,
  Cache,
  Spritesheet,
  bitmapFontTextParser,
  type SpritesheetData,
  type Texture,
} from "pixi.js";
import {
  BMFONT_SHARED_FACE,
  bitmapFontCacheKey,
  parseBitmapFontPadding,
  patchFntFaceName,
  registerBitmapFontPadding,
} from "./bitmapFontFile.js";
import { BITMAP_FONT_ASSET } from "./text.js";

export interface Manifest {
  atlases: Record<string, { image: string; sheet: string }>;
  audio: Record<string, string>;
  fonts: Record<string, { fnt: string; texture: string }>;
  sprites: Record<string, string>;
  particles: Record<string, { config: string; texture: string }>;
}

export interface ParticleAsset {
  config: Readonly<Record<string, unknown>>;
  texture: Texture;
}

export type AssetUrlResolver = (relativePath: string) => string;

/** Resolves names through a manifest plus URL resolver; every miss throws with the name. */
export class AssetLibrary {
  private readonly atlasPromises = new Map<string, Promise<Spritesheet>>();
  private readonly particlePromises = new Map<string, Promise<ParticleAsset>>();

  private constructor(
    private readonly manifest: Manifest,
    private readonly resolveUrl: AssetUrlResolver,
  ) {}

  static async load(baseUrl: string): Promise<AssetLibrary> {
    const res = await fetch(`${baseUrl}/manifest.json`);
    if (!res.ok) throw new Error(`failed to fetch asset manifest: ${res.status} ${baseUrl}/manifest.json`);
    return AssetLibrary.fromManifest(
      (await res.json()) as Manifest,
      (relativePath) => `${baseUrl}/${relativePath}`,
    );
  }

  /**
   * Builds an asset library over an arbitrary URL resolver. Browser-imported content uses this
   * with session-local `blob:` URLs, so uploaded archive bytes never need a server URL.
   */
  static fromManifest(manifest: Manifest, resolveUrl: AssetUrlResolver): AssetLibrary {
    return new AssetLibrary(manifest, resolveUrl);
  }

  hasSprite(name: string): boolean {
    return this.manifest.sprites[name] !== undefined;
  }

  hasAtlas(name: string): boolean {
    return this.manifest.atlases[name] !== undefined;
  }

  hasFont(name: string): boolean {
    return this.manifest.fonts[name] !== undefined;
  }

  hasAudio(name: string): boolean {
    return this.manifest.audio[name.replace(/\.(m4a|mp3|wav)$/, "")] !== undefined;
  }

  hasParticle(name: string): boolean {
    return this.manifest.particles?.[name] !== undefined;
  }

  async sprite(name: string): Promise<Texture> {
    const rel = this.manifest.sprites[name];
    if (!rel) throw new Error(`unknown sprite: ${name}`);
    return this.texture(rel);
  }

  async atlas(name: string): Promise<Spritesheet> {
    const entry = this.manifest.atlases[name];
    if (!entry) throw new Error(`unknown atlas: ${name}`);
    const cached = this.atlasPromises.get(name);
    if (cached) return cached;
    const loading = this.loadAtlas(name, entry);
    this.atlasPromises.set(name, loading);
    try {
      return await loading;
    } catch (error) {
      this.atlasPromises.delete(name);
      throw error;
    }
  }

  private async loadAtlas(name: string, entry: { image: string; sheet: string }): Promise<Spritesheet> {
    const sheetUrl = this.resolveUrl(entry.sheet);
    const response = await fetch(sheetUrl);
    if (!response.ok) throw new Error(`failed to fetch atlas: ${response.status} ${sheetUrl}`);
    const sheet = (await response.json()) as Record<string, unknown>;
    const meta = sheet["meta"];
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
      throw new Error(`atlas ${name} has no metadata object`);
    }
    const texture = await this.texture(entry.image);
    const spritesheet = new Spritesheet(texture, sheet as unknown as SpritesheetData);
    await spritesheet.parse();
    return spritesheet;
  }

  async particle(name: string): Promise<ParticleAsset> {
    const entry = this.manifest.particles?.[name];
    if (!entry) throw new Error(`unknown particle: ${name}`);
    const cached = this.particlePromises.get(name);
    if (cached) return cached;
    const loading = this.loadParticle(entry);
    this.particlePromises.set(name, loading);
    try {
      return await loading;
    } catch (error) {
      this.particlePromises.delete(name);
      throw error;
    }
  }

  private async loadParticle(entry: { config: string; texture: string }): Promise<ParticleAsset> {
    const [configResponse, texture] = await Promise.all([
      fetch(this.resolveUrl(entry.config)),
      this.texture(entry.texture),
    ]);
    if (!configResponse.ok) {
      throw new Error(`failed to fetch particle config: ${configResponse.status} ${entry.config}`);
    }
    return { config: (await configResponse.json()) as Record<string, unknown>, texture };
  }

  /**
   * All four shipped .fnt files declare the BMFont `info face="Arial Narrow"` line (checked against
   * every `extracted/assets/fonts/*.fnt`) -- a naming collision in the raw data. PixiJS's
   * `BitmapFontManager` caches parsed bitmap fonts keyed by that face name
   * (`${fontFamily}-bitmap`), so loading more than one of these through a plain `Assets.load` would
   * make every font but the last-loaded one unreachable. The installed pixi.js (8.19.0,
   * node_modules/pixi.js/lib/scene/text-bitmap/asset/loadBitmapFont.js) has no per-asset `family`
   * aliasing hook -- `parse()` always takes `fontFamily` straight from the raw `.fnt` text, ignoring
   * any `data` passed to `Assets.load`. So: fetch the `.fnt` text ourselves, patch the `face=` line to
   * the requested asset key (failing loud if that exact marker isn't present -- confirms the
   * collision assumption instead of silently mis-patching a differently-authored file), parse it
   * with Pixi's exported BMFont parser, and pair it with the manifest's explicit texture. The latter
   * matters for browser-imported blob URLs: Pixi's normal relative-page resolver cannot join one
   * opaque `blob:` URL to another. Register the result in the global `Cache` under `<name>-bitmap` --
   * the exact key `BitmapFontManager.getFont` looks up for `style.fontFamily === name`.
   *
   * Legacy compatibility: `text.ts`'s `makeText` callers still look up the *original* collided
   * face (`"Arial Narrow"-bitmap`). This is only a compatibility alias for existing engine
   * callers; an imported descriptor's authored face may be anything. Exactly one font provides
   * that registration --
   * `BITMAP_FONT_ASSET` ("arial_20_bold-hd", the single font `main.ts` preloaded before all four
   * were needed) -- pinned explicitly rather than last-loaded-wins, so concurrent preloads
   * (`Promise.all` in main.ts) stay deterministic. Task 15 deletes the legacy callers and this
   * pinned registration with them.
   */
  async font(name: string): Promise<void> {
    const entry = this.manifest.fonts[name];
    if (!entry) throw new Error(`unknown font: ${name}`);
    if (Cache.has(bitmapFontCacheKey(name))) return;

    const fntUrl = this.resolveUrl(entry.fnt);
    const res = await fetch(fntUrl);
    if (!res.ok) throw new Error(`failed to fetch font: ${res.status} ${fntUrl}`);
    const patched = patchFntFaceName(await res.text(), name, fntUrl);
    if (!bitmapFontTextParser.test(patched)) {
      throw new Error(`bitmap font ${fntUrl} is not a text BMFont descriptor`);
    }
    const data = bitmapFontTextParser.parse(patched);
    if (data.pages.length !== 1) {
      throw new Error(`bitmap font ${fntUrl} has ${data.pages.length} pages; the package manifest requires one`);
    }
    const page = data.pages[0]!;
    const texture = await this.texture(entry.texture);
    const textures: Texture[] = [];
    textures[page.id] = texture;
    const font = new BitmapFont({ data, textures }, fntUrl);



    registerBitmapFontPadding(name, parseBitmapFontPadding(patched, fntUrl));
    Cache.set(bitmapFontCacheKey(name), font);
    if (name === BITMAP_FONT_ASSET) {
      Cache.set(bitmapFontCacheKey(BMFONT_SHARED_FACE), font);
      registerBitmapFontPadding(BMFONT_SHARED_FACE, parseBitmapFontPadding(patched, fntUrl));
    }
  }

  /** soundTable values carry extensions ("Flame.m4a"); manifest keys don't ("Flame"). */
  audioUrl(name: string): string {
    const key = name.replace(/\.(m4a|mp3|wav)$/, "");
    const rel = this.manifest.audio[key];
    if (!rel) throw new Error(`unknown audio: ${name}`);
    return this.resolveUrl(rel);
  }

  /** Blob URLs have no extension, so select Pixi's texture parser explicitly. */
  private async texture(relativePath: string): Promise<Texture> {
    const src = this.resolveUrl(relativePath);
    const texture = await Assets.load<Texture>({ src, parser: "texture" });
    if (!texture) throw new Error(`failed to decode texture: ${relativePath}`);
    return texture;
  }
}
