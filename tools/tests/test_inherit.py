# tools/tests/test_inherit.py
from dib_extract.inherit import resolve_parent, build_registry

def test_resolve_replaces_nested_dicts_wholesale():




    registry = {
        "RootMonster": {"class": "Monster", "rootStats": {"Attack": 10, "Speed": 12}},
    }
    node = {"parent": "RootMonster", "index": 7100, "rootStats": {"Attack": 3.5}}
    out = resolve_parent(node, registry)
    assert out["class"] == "Monster"                  # inherited: key the child never authored
    assert out["index"] == 7100                       # own
    assert out["rootStats"] == {"Attack": 3.5}        # REPLACED, no leaked Speed
    assert "parent" not in out

def test_resolve_multi_level_chain():
    registry = {
        "RootJob": {"a": 1},
        "Mer.MerWarrior": {"parent": "RootJob", "b": 2},
    }
    node = {"parent": "Mer.MerWarrior", "c": 3}
    out = resolve_parent(node, registry)
    assert out == {"a": 1, "b": 2, "c": 3}

def test_cycle_raises():
    import pytest
    registry = {"A": {"parent": "B"}, "B": {"parent": "A"}}
    with pytest.raises(ValueError):
        resolve_parent({"parent": "A"}, registry)

def test_job_ability_slots_replace_wholesale():


    registry = {
        "Parent": {
            "jobAbilities": {
                "usable1": {"type": "StunMagicAttack",
                            "arguments": {"instanceName": "Horror",
                                          "soundTable": {"1": "Sentence.m4a"}}},
                "usable2": {"type": "Attack", "arguments": {"aiChance": 0.5}},
            }
        },
    }
    node = {
        "parent": "Parent",
        "jobAbilities": {
            "usable1": {"type": "StunMagicAttackAll",
                        "arguments": {"instanceName": "BlackHole",
                                      "soundTable": {"7": "GammaBurst.m4a"}}},
        },
    }
    out = resolve_parent(node, registry)
    # Re-authored slot keeps nothing of the parent's (no leaked Sentence.m4a key).
    assert out["jobAbilities"]["usable1"] == {
        "type": "StunMagicAttackAll",
        "arguments": {"instanceName": "BlackHole", "soundTable": {"7": "GammaBurst.m4a"}},
    }
    # Slot the child never mentions is still inherited: the slot MAP unions.
    assert out["jobAbilities"]["usable2"] == {"type": "Attack", "arguments": {"aiChance": 0.5}}

def test_job_abilities_is_the_only_key_that_unions():



    registry = {"Parent": {"rootStats": {"Attack": 10, "Speed": 12},
                           "jobAbilities": {"usable1": {"type": "A"}, "usable2": {"type": "C"}}}}
    node = {"parent": "Parent", "rootStats": {"Attack": 3},
            "jobAbilities": {"usable1": {"type": "B"}}}
    out = resolve_parent(node, registry)
    assert out["rootStats"] == {"Attack": 3}                   # replaced wholesale
    assert out["jobAbilities"]["usable1"] == {"type": "B"}     # slot value replaced
    assert out["jobAbilities"]["usable2"] == {"type": "C"}     # slot map unioned

def test_build_registry_addresses_intermediate_and_leaf():
    tree = {"Slime": {"Metal": {"MetalSlime": {"index": 1}}}}
    reg = build_registry(tree, lambda n: "index" in n)
    assert "Slime.Metal.MetalSlime" in reg

def test_build_registry_includes_referenced_base():
    # A base node with no `index` and no `parent`, referenced as a parent,
    # must still be registered so children can resolve against it.
    tree = {
        "RootMonster": {"class": "Monster", "rootStats": {"Attack": 10, "Speed": 12}},
        "Mer": {"MerKing": {"parent": "RootMonster", "index": 7100,
                            "rootStats": {"Attack": 3.5}}},
    }
    reg = build_registry(tree, lambda n: "rootStats" in n and "index" in n)
    assert "RootMonster" in reg
    resolved = resolve_parent(reg["Mer.MerKing"], reg)
    assert resolved["class"] == "Monster"                # inherited from base
    assert resolved["rootStats"] == {"Attack": 3.5}      # re-authored map replaces wholesale
