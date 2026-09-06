import subprocess
import sys
import zipfile
import pathlib

TOOLS_DIR = pathlib.Path(__file__).resolve().parent.parent  # the tools/ directory

def test_cli_help_lists_stages():
    r = subprocess.run(
        [sys.executable, "-m", "dib_extract", "--help"],
        capture_output=True, text=True, cwd=TOOLS_DIR,
    )
    assert r.returncode == 0
    assert "assets" in r.stdout and "data" in r.stdout and "unpack" in r.stdout

def test_cli_unpack_stage(tmp_path):
    ipa = tmp_path / "Dragon_Island_Blue_1.1.0.ipa"
    with zipfile.ZipFile(ipa, "w") as zf:
        zf.writestr("Payload/DragonIsland.app/DragonIsland", b"\x00stub")
        zf.writestr("Payload/DragonIsland.app/Monsters.plist", b"<plist/>")
    r = subprocess.run(
        [sys.executable, "-m", "dib_extract", "unpack", "--app-root", str(tmp_path)],
        capture_output=True, text=True, cwd=TOOLS_DIR,
    )
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "Payload" / "DragonIsland.app" / "DragonIsland").exists()

def test_cli_missing_setup_is_actionable_not_traceback(tmp_path):
    r = subprocess.run(
        [sys.executable, "-m", "dib_extract", "all", "--app-root", str(tmp_path)],
        capture_output=True, text=True, cwd=TOOLS_DIR,
    )
    assert r.returncode == 1
    assert "python -m dib_extract" in r.stderr
    assert "Traceback" not in r.stderr
