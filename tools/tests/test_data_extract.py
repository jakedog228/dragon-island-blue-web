# tools/tests/test_data_extract.py
from dib_extract.data_extract import extract_jobs, extract_monsters

def test_extract_monsters_resolves_rootstats():




    src = {
        "RootMonster": {"class": "Monster", "rootStats": {"Attack": 10, "Speed": 12, "MaxHP": 10}},
        "Mer": {"MerKing": {"parent": "RootMonster", "index": 7100, "element": "Water",
                            "rootStats": {"Attack": 3.5, "MaxHP": 13.15}}},
    }
    out = extract_monsters(src)
    mk = out["resolved"]["Mer.MerKing"]
    assert mk["index"] == 7100
    assert mk["element"] == "Water"
    assert mk["rootStats"] == {"Attack": 3.5, "MaxHP": 13.15}  # replaced, no leaked Speed
    assert mk["class"] == "Monster"           # inherited: key the child never authored
    assert "RootMonster" not in out["resolved"]  # base is not a leaf

def test_extract_monsters_includes_stat_inheriting_leaf():
    # A monster defining index+parent but NO own rootStats must still be
    # emitted, with stats fully inherited — not silently dropped.
    src = {
        "RootMonster": {"class": "Monster",
                        "rootStats": {"Attack": 10, "Speed": 12, "MaxHP": 10}},
        "Ghost": {"Wisp": {"parent": "RootMonster", "index": 9001, "element": "Dark"}},
    }
    out = extract_monsters(src)
    assert "Ghost.Wisp" in out["resolved"]
    w = out["resolved"]["Ghost.Wisp"]
    assert w["index"] == 9001
    assert w["rootStats"]["Speed"] == 12   # fully inherited from base


def test_extract_jobs_includes_parent_only_child_and_inherits_abilities():
    src = {
        "RootJob": {
            "class": "Job",
            "slots": ["Monster"],
            "xpPenalty": 1,
            "jobAbilities": {"usable1": {"type": "Offensive.Attack"}},
        },
        "Mod": {"Child": {"parent": "RootJob"}},
    }
    out = extract_jobs(src)
    assert out["Mod.Child"]["jobAbilities"] == {
        "usable1": {"type": "Offensive.Attack"},
    }


def test_extract_localized_strings_roundtrip(tmp_path):
    # Synthetic bundle: en.lproj/Localizable.strings as a binary plist (the shipped format).
    import plistlib
    from dib_extract.data_extract import extract_localized_strings
    lproj = tmp_path / "en.lproj"
    lproj.mkdir()
    table = {"RenderableWispNameKey": "Wisp", "HPKey": "HP"}
    with open(lproj / "Localizable.strings", "wb") as f:
        plistlib.dump(table, f, fmt=plistlib.FMT_BINARY)
    assert extract_localized_strings(tmp_path) == table


def test_extract_localized_strings_missing_raises(tmp_path):
    import pytest
    from dib_extract.data_extract import extract_localized_strings
    with pytest.raises(FileNotFoundError):
        extract_localized_strings(tmp_path)
