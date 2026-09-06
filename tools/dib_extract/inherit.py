import copy

# See _merge_parent_values below for the full source citation of both merge rules.
_SLOT_UNION_KEYS = frozenset({"jobAbilities"})

def _merge_parent_values(base: dict, over: dict) -> dict:
    ""




























    out = copy.deepcopy(base)
    for k, v in over.items():
        if k == "parent":
            continue
        if k in _SLOT_UNION_KEYS and isinstance(v, dict) and isinstance(out.get(k), dict):
            merged = copy.deepcopy(out[k])
            merged.update(copy.deepcopy(v))
            out[k] = merged
        else:
            out[k] = copy.deepcopy(v)
    return out

def resolve_parent(node: dict, registry: dict, _seen=None) -> dict:
    if "parent" not in node:
        return {k: copy.deepcopy(v) for k, v in node.items() if k != "parent"}
    _seen = _seen or set()
    pkey = node["parent"]
    if pkey in _seen:
        raise ValueError(f"inheritance cycle at {pkey}")
    _seen.add(pkey)
    if pkey not in registry:
        raise ValueError(f"unknown parent {pkey!r}")
    resolved_parent = resolve_parent(registry[pkey], registry, _seen)
    return _merge_parent_values(resolved_parent, node)

def build_registry(tree: dict, leaf_pred) -> dict:
    referenced = set()
    def collect(d):
        if isinstance(d, dict):
            p = d.get("parent")
            if isinstance(p, str):
                referenced.add(p)
            for v in d.values():
                collect(v)
    collect(tree)

    reg = {}
    def walk(d, path):
        if not isinstance(d, dict):
            return
        if path and (leaf_pred(d) or "parent" in d or path in referenced):
            reg[path] = d
        for k, v in d.items():
            if isinstance(v, dict):
                walk(v, f"{path}.{k}" if path else k)
    walk(tree, "")
    return reg
