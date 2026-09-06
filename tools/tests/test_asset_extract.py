# tools/tests/test_asset_extract.py
import json
import plistlib

import pytest

from dib_extract.asset_extract import is_hd, is_ipadhd, run_asset_extract


def test_is_hd():
    assert is_hd("Adown-hd.png") is True
    assert is_hd("Adown.png") is False
    assert is_hd("BlankButton-hd") is True
    # -ipadhd is its own tier, NOT a superset match of -hd ("...dhd" != "...-hd").
    assert is_hd("forestBackground-ipadhd.png") is False


def test_is_ipadhd():
    assert is_ipadhd("forestBackground-ipadhd.png") is True
    assert is_ipadhd("forestBackground-hd.png") is False
    assert is_ipadhd("forestBackground.png") is False


def test_combat_background_png_extracted(tmp_path):
    # `<Biome>Combat.png` battle backgrounds ship with NO -hd suffix (one shared 1024x1024
    # POT texture per biome, runtime-cropped by the binary) — they must still be extracted.
    # Other bare PNGs (e.g. combatBottomBar.png, which has a -hd sibling) stay excluded.
    app = tmp_path / "app"; app.mkdir()
    (app / "ForestCombat.png").write_bytes(b"\x89PNG\r\n")
    (app / "combatBottomBar.png").write_bytes(b"\x89PNG\r\n")
    (app / "combatBottomBar-hd.png").write_bytes(b"\x89PNG\r\n")
    out = tmp_path / "out"
    counts = run_asset_extract(app, out)
    assert counts["sprites"] == 2
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["sprites"]["ForestCombat"] == "sprites/ForestCombat.png"
    assert manifest["sprites"]["combatBottomBar-hd"] == "sprites/combatBottomBar-hd.png"
    assert "combatBottomBar" not in manifest["sprites"]


def test_standalone_ipadhd_png_extracted(tmp_path):
    # The bundle's five -ipadhd full-screen PNGs are standalone sprites; both tiers land
    # in the manifest, the bare (non-retina) PNG does not.
    app = tmp_path / "app"; app.mkdir()
    (app / "forestBackground-hd.png").write_bytes(b"\x89PNG\r\n")
    (app / "forestBackground-ipadhd.png").write_bytes(b"\x89PNG\r\n")
    (app / "forestBackground.png").write_bytes(b"\x89PNG\r\n")
    out = tmp_path / "out"
    counts = run_asset_extract(app, out)
    assert counts["sprites"] == 2
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["sprites"]["forestBackground-hd"] == "sprites/forestBackground-hd.png"
    assert manifest["sprites"]["forestBackground-ipadhd"] == "sprites/forestBackground-ipadhd.png"
    assert "forestBackground" not in manifest["sprites"]


def _write_atlas(path, texture_file_name):
    plistlib.dump({
        "metadata": {"format": 2, "textureFileName": texture_file_name, "size": "{64,64}"},
        "frames": {"a.png": {"frame": "{{0,0},{10,10}}", "offset": "{0,0}",
                             "sourceColorRect": "{{0,0},{10,10}}", "sourceSize": "{10,10}",
                             "rotated": False}},
    }, open(path, "wb"))


def test_atlas_texture_resolved_from_plist_filename(tmp_path):
    # Metadata names a WRONG texture, but the correctly-named <stem>.png ships.
    app = tmp_path / "app"; app.mkdir()
    _write_atlas(app / "Foo-hd.plist", "WRONG.png")
    (app / "Foo-hd.png").write_bytes(b"\x89PNG\r\n")
    out = tmp_path / "out"
    counts = run_asset_extract(app, out)
    assert counts["atlases"] == 1
    assert (out / "atlases" / "Foo-hd.png").exists()          # derived name copied
    sheet = json.loads((out / "atlases" / "Foo-hd.json").read_text(encoding="utf-8"))
    assert sheet["meta"]["image"] == "Foo-hd.png"             # emitted JSON points at real file


def test_atlas_missing_texture_raises(tmp_path):
    # Neither the derived <stem>.png nor the metadata texture exists -> fail loudly.
    app = tmp_path / "app"; app.mkdir()
    _write_atlas(app / "Bar-hd.plist", "also-missing.png")
    with pytest.raises(FileNotFoundError):
        run_asset_extract(app, tmp_path / "out")


def test_bare_particle_plist_and_texture_extracted(tmp_path):
    app = tmp_path / "app"; app.mkdir()
    with open(app / "Cast.plist", "wb") as handle:
        plistlib.dump({"textureFileName": "Cast.png", "duration": 0.2}, handle)
    (app / "Cast.png").write_bytes(b"\x89PNG\r\n")
    out = tmp_path / "out"
    counts = run_asset_extract(app, out)
    assert counts["particles"] == 1
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["particles"]["Cast.plist"] == {
        "config": "particles/Cast.json",
        "texture": "particles/Cast.png",
    }
    assert json.loads((out / "particles" / "Cast.json").read_text())["duration"] == 0.2
    assert (out / "particles" / "Cast.png").exists()


def test_font_texture_resolved_from_fnt_reference(tmp_path):
    # -hd.fnt references a _0.png texture; both must be copied to fonts/.
    app = tmp_path / "app"; app.mkdir()
    (app / "myfont-hd.fnt").write_text(
        'info face="x"\npage id=0 file="myfont_0.png"\n', encoding="latin-1")
    (app / "myfont_0.png").write_bytes(b"\x89PNG\r\n")
    out = tmp_path / "out"
    counts = run_asset_extract(app, out)
    assert counts["fonts"] == 1
    assert (out / "fonts" / "myfont-hd.fnt").exists()
    assert (out / "fonts" / "myfont_0.png").exists()
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["fonts"]["myfont-hd"]["texture"] == "fonts/myfont_0.png"


def test_font_hd_prefers_hd_texture_and_rewrites_page_line(tmp_path):
    # Cocos2d's retina rule: loading an -hd .fnt appends -hd to the referenced page
    # texture too. The real bundle ships both arial_20_bold_0.png (256x256, non-hd)
    # and arial_20_bold_0-hd.png (512x512) while the -hd fnt's page line names the
    # BARE name — pairing them verbatim breaks every glyph UV (fnt scaleW=512 vs
    # 256px texture). The extractor must copy the -hd texture and rewrite the copied
    # fnt's page line to the file it actually ships.
    app = tmp_path / "app"; app.mkdir()
    (app / "myfont-hd.fnt").write_text(
        'info face="x"\npage id=0 file="myfont_0.png"\n', encoding="latin-1")
    (app / "myfont_0.png").write_bytes(b"\x89PNG\r\n" + b"sd")
    (app / "myfont_0-hd.png").write_bytes(b"\x89PNG\r\n" + b"hd")
    out = tmp_path / "out"
    counts = run_asset_extract(app, out)
    assert counts["fonts"] == 1
    assert (out / "fonts" / "myfont_0-hd.png").read_bytes().endswith(b"hd")
    assert not (out / "fonts" / "myfont_0.png").exists()
    text = (out / "fonts" / "myfont-hd.fnt").read_text(encoding="latin-1")
    assert 'file="myfont_0-hd.png"' in text
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["fonts"]["myfont-hd"]["texture"] == "fonts/myfont_0-hd.png"


def test_font_missing_texture_raises(tmp_path):
    app = tmp_path / "app"; app.mkdir()
    (app / "broken-hd.fnt").write_text(
        'page id=0 file="nope_0.png"\n', encoding="latin-1")
    with pytest.raises(FileNotFoundError):
        run_asset_extract(app, tmp_path / "out")


def test_bare_standalone_sprites_extracted(tmp_path):
    app = tmp_path / "app"
    app.mkdir()
    (app / "bookPage.png").write_bytes(b"\x89PNG\r\n")
    (app / "leaveIcon.png").write_bytes(b"\x89PNG\r\n")
    (app / "Icon.png").write_bytes(b"\x89PNG\r\n")
    (app / "Icon@2x.png").write_bytes(b"\x89PNG\r\n")
    (app / "plot_start1.png").write_bytes(b"\x89PNG\r\n")
    (app / "fieldMovement.png").write_bytes(b"\x89PNG\r\n")
    out = tmp_path / "out"
    counts = run_asset_extract(app, out)
    assert counts["sprites"] == 6
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["sprites"]["bookPage"] == "sprites/bookPage.png"
    assert manifest["sprites"]["leaveIcon"] == "sprites/leaveIcon.png"
    assert manifest["sprites"]["Icon"] == "sprites/Icon.png"
    assert manifest["sprites"]["Icon@2x"] == "sprites/Icon@2x.png"
    assert manifest["sprites"]["plot_start1"] == "sprites/plot_start1.png"
    assert manifest["sprites"]["fieldMovement"] == "sprites/fieldMovement.png"
