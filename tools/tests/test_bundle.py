import plistlib, pathlib, zipfile, pytest
from dib_extract.bundle import classify_plist, find_app, find_ipa, unpack_ipa, ensure_app

FIX = pathlib.Path(__file__).parent / "fixtures"

def _make_stub_ipa(path: pathlib.Path) -> pathlib.Path:
    """A minimal IPA-shaped zip: a Payload/DragonIsland.app/ with a (stub) binary + one plist."""
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("iTunesArtwork", b"\x00")
        zf.writestr("Payload/DragonIsland.app/DragonIsland", b"\x00stub-macho")
        zf.writestr("Payload/DragonIsland.app/Monsters.plist", b"<plist/>")
    return path

def test_classify_atlas():
    assert classify_plist(FIX / "atlas_sample.plist") == "atlas"

def test_classify_data():
    assert classify_plist(FIX / "data_sample.plist") == "data"

def test_find_app_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        find_app(str(tmp_path), None)

def test_classify_corrupt_raises(tmp_path):
    bad = tmp_path / "corrupt.plist"
    bad.write_bytes(b"this is not a plist")
    with pytest.raises(Exception):
        classify_plist(bad)

def test_find_app_missing_message_is_actionable(tmp_path):
    with pytest.raises(FileNotFoundError) as e:
        find_app(None, str(tmp_path))
    assert "dib_extract" in str(e.value)

def test_find_ipa_prefers_explicit_and_globs(tmp_path):
    assert find_ipa(tmp_path) is None
    ipa = _make_stub_ipa(tmp_path / "Dragon_Island_Blue_1.1.0.ipa")
    assert find_ipa(tmp_path) == ipa
    with pytest.raises(FileNotFoundError):
        find_ipa(tmp_path, explicit=str(tmp_path / "nope.ipa"))

def test_unpack_ipa_produces_app_bundle(tmp_path):
    ipa = _make_stub_ipa(tmp_path / "game.ipa")
    app = unpack_ipa(ipa, tmp_path, log=lambda *_: None)
    assert app == tmp_path / "Payload" / "DragonIsland.app"
    assert (app / "DragonIsland").exists()

def test_unpack_ipa_rejects_non_payload_zip(tmp_path):
    bad = tmp_path / "bad.ipa"
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("random.txt", b"nope")
    with pytest.raises(ValueError):
        unpack_ipa(bad, tmp_path, log=lambda *_: None)

def test_ensure_app_auto_unpacks_when_bundle_missing(tmp_path):
    _make_stub_ipa(tmp_path / "Dragon_Island_Blue_1.1.0.ipa")
    app = ensure_app(None, str(tmp_path), auto_unpack=True, log=lambda *_: None)
    assert (app / "DragonIsland").exists()

def test_ensure_app_no_ipa_raises_actionable(tmp_path):
    with pytest.raises(FileNotFoundError) as e:
        ensure_app(None, str(tmp_path), log=lambda *_: None)
    assert "python -m dib_extract" in str(e.value)
