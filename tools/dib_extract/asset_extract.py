import pathlib, shutil, re
from .bundle import load_plist, classify_plist
from .atlas import atlas_to_pixi
from .jsonio import write_json

def is_hd(filename: str) -> bool:
    return pathlib.Path(filename).stem.endswith("-hd")

def is_ipadhd(filename: str) -> bool:
    # iPad tier: the bundle ships exactly five -ipadhd full-screen PNGs (all standalone,
    # no -ipadhd atlas plists or fnts exist). Extracted alongside the -hd tier so the web
    # app's experimental iPad display mode can resolve them (see apps/web runtimeSettings).
    return pathlib.Path(filename).stem.endswith("-ipadhd")

def run_asset_extract(app_dir, out_dir) -> dict:
    app_dir, out_dir = pathlib.Path(app_dir), pathlib.Path(out_dir)
    manifest = {"atlases": {}, "sprites": {}, "fonts": {}, "audio": {}, "particles": {}}
    counts = {"atlases": 0, "sprites": 0, "fonts": 0, "audio": 0, "particles": 0}

    # 1. atlases (hd only): plist + png pair
    atlas_pngs = set()
    for plist in sorted(app_dir.glob("*.plist")):
        if classify_plist(plist) != "atlas" or not is_hd(plist.name):
            continue
        sheet = atlas_to_pixi(load_plist(plist))
        # Derive the texture from the plist filename (as Cocos2d does) rather
        # than trusting internal metadata, which can be wrong — e.g.
        # GammaBurst-hd.plist's metadata typo "GamaBurst-hd.png". Fall back to
        # the metadata image only if the derived file is absent.
        derived = plist.stem + ".png"
        png = derived if (app_dir / derived).exists() else sheet["meta"]["image"]
        sheet["meta"]["image"] = png
        src_png = app_dir / png
        if not src_png.exists():
            raise FileNotFoundError(f"atlas {plist.name} references missing texture {png}")
        (out_dir / "atlases").mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_png, out_dir / "atlases" / png)
        write_json(out_dir / "atlases" / f"{plist.stem}.json", sheet)
        atlas_pngs.add(png)
        manifest["atlases"][plist.stem] = {"sheet": f"atlases/{plist.stem}.json", "image": f"atlases/{png}"}
        counts["atlases"] += 1






    def is_combat_background(name: str) -> bool:
        return pathlib.Path(name).stem.endswith("Combat")











    bare_standalone = {
        "monsterEvolved.png",
        "MMScreen.png",
        "bigmap.png",
        "bookPage.png",
        "leaveIcon.png",
        # CCDirector.notificationNode / CCNotifications default app icon.
        "Icon.png",
        "Icon@2x.png",


        "plot_start1.png",
        "battleTutorial1.png",
        "battleTutorial2.png",
        "catchTutorial.png",
        "fieldMovement.png",
        "dungeonMovement.png",
        "monsterChange1.png",
        "monsterChange2.png",
        "soulStoneTutorial1.png",
        "soulStoneTutorial2.png",
        "soulStoneTutorial3.png",
        "insertSoulStoneTutorial1.png",
        "insertSoulStoneTutorial2.png",
        "spiritTutorial.png",
        "combineTutorial1.png",
        "combineTutorial2.png",
    }
    for png in sorted(app_dir.glob("*.png")):
        wanted = (
            is_hd(png.name)
            or is_ipadhd(png.name)
            or is_combat_background(png.name)
            or png.name in bare_standalone
        )
        if not wanted or png.name in atlas_pngs:
            continue
        (out_dir / "sprites").mkdir(parents=True, exist_ok=True)
        shutil.copy2(png, out_dir / "sprites" / png.name)
        manifest["sprites"][png.stem] = f"sprites/{png.name}"
        counts["sprites"] += 1

    # 3. bitmap fonts (.fnt): retina (-hd) only; copy the .fnt plus the texture it references.
    # Cocos2d's retina rule applies -hd to the referenced page texture as well: an -hd fnt's
    # page line names the BARE texture (file="arial_20_bold_0.png") while its metrics
    # (scaleW/scaleH) describe the -hd texture — pairing the -hd fnt with the bare texture
    # breaks every glyph UV. Prefer the -hd texture when it exists and rewrite the copied
    # fnt's page line to the file actually shipped.
    for fnt in sorted(app_dir.glob("*-hd.fnt")):
        (out_dir / "fonts").mkdir(parents=True, exist_ok=True)
        text = fnt.read_text(encoding="latin-1")
        m = re.search(r'file="([^"]+)"', text)
        if not m:
            raise ValueError(f"{fnt.name} has no texture 'file=' reference")
        tex = m.group(1)
        stem, dot, ext = tex.rpartition(".")
        hd_tex = f"{stem}-hd{dot}{ext}"
        if (app_dir / hd_tex).exists():
            text = text.replace(f'file="{tex}"', f'file="{hd_tex}"')
            tex = hd_tex
        src_tex = app_dir / tex
        if not src_tex.exists():
            raise FileNotFoundError(f"{fnt.name} references missing texture {tex}")
        (out_dir / "fonts" / fnt.name).write_text(text, encoding="latin-1")
        shutil.copy2(src_tex, out_dir / "fonts" / tex)
        manifest["fonts"][fnt.stem] = {"fnt": f"fonts/{fnt.name}", "texture": f"fonts/{tex}"}
        counts["fonts"] += 1

    # 4. Cocos particle plists and their bare texture files. These deliberately do not follow
    # the -hd suffix convention (e.g. Utility.Capture's Cast.plist -> Cast.png).
    for plist in sorted(app_dir.glob("*.plist")):
        if classify_plist(plist) != "data":
            continue
        config = load_plist(plist)
        texture = config.get("textureFileName") if isinstance(config, dict) else None
        if not isinstance(texture, str):
            continue
        src_texture = app_dir / texture
        if not src_texture.exists():
            raise FileNotFoundError(f"particle {plist.name} references missing texture {texture}")
        (out_dir / "particles").mkdir(parents=True, exist_ok=True)
        write_json(out_dir / "particles" / f"{plist.stem}.json", config)
        shutil.copy2(src_texture, out_dir / "particles" / texture)
        manifest["particles"][plist.name] = {
            "config": f"particles/{plist.stem}.json",
            "texture": f"particles/{texture}",
        }
        counts["particles"] += 1

    # 5. audio
    for pattern in ("*.m4a", "*.mp3", "*.wav"):
        for aud in sorted(app_dir.glob(pattern)):
            (out_dir / "audio").mkdir(parents=True, exist_ok=True)
            shutil.copy2(aud, out_dir / "audio" / aud.name)
            manifest["audio"][aud.stem] = f"audio/{aud.name}"
            counts["audio"] += 1

    write_json(out_dir / "manifest.json", manifest)
    return counts
