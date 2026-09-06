import pathlib
from .bundle import load_plist, classify_plist
from .inherit import resolve_parent, build_registry
from .jsonio import write_json

def _is_monster_leaf(n):
    return isinstance(n, dict) and "index" in n

def extract_monsters(plist_dict) -> dict:
    registry = build_registry(plist_dict, _is_monster_leaf)
    resolved = {
        path: resolve_parent(node, registry)
        for path, node in registry.items()
        if _is_monster_leaf(node)
    }
    for path, node in resolved.items():
        if "rootStats" not in node:
            raise ValueError(
                f"monster {path} has no rootStats after inheritance resolution"
            )
    return {"raw": plist_dict, "resolved": resolved}

def _is_job_leaf(n):



    return isinstance(n, dict) and ("jobAbilities" in n or "parent" in n)

def extract_jobs(plist_dict) -> dict:
    return _extract_generic_resolved(plist_dict, _is_job_leaf)

def _extract_generic_resolved(plist_dict, leaf_pred) -> dict:
    registry = build_registry(plist_dict, leaf_pred)
    return {p: resolve_parent(n, registry) for p, n in registry.items() if leaf_pred(n)}

def extract_localized_strings(app_dir: pathlib.Path) -> dict:
    ""








    strings_path = app_dir / "en.lproj" / "Localizable.strings"
    if not strings_path.exists():
        raise FileNotFoundError(f"Localizable.strings not found at {strings_path}")
    data = load_plist(strings_path)
    if not isinstance(data, dict) or not data:
        raise ValueError(f"{strings_path} did not parse to a non-empty dict")
    for k, v in data.items():
        if not isinstance(k, str) or not isinstance(v, str):
            raise ValueError(f"{strings_path}: non-string entry {k!r}: {type(v).__name__}")
    return data


def run_data_extract(app_dir, out_dir) -> list[str]:
    app_dir, out_dir = pathlib.Path(app_dir), pathlib.Path(out_dir)
    written = []
    write_json(out_dir / "LocalizableStrings.json", extract_localized_strings(app_dir))
    written.append("LocalizableStrings.json")
    for plist in sorted(app_dir.glob("*.plist")):
        if classify_plist(plist) != "data":
            continue
        name = plist.stem
        data = load_plist(plist)
        write_json(out_dir / f"{name}.json", data)
        written.append(f"{name}.json")
        if name == "Monsters":
            write_json(out_dir / "Monsters.resolved.json", extract_monsters(data)["resolved"])
            written.append("Monsters.resolved.json")
        elif name == "Jobs":
            write_json(out_dir / "Jobs.resolved.json", extract_jobs(data))
            written.append("Jobs.resolved.json")
    return written
