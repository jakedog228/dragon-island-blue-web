import type { RawNode } from "./rawLoad.js";

// Port of tools/dib_extract/inherit.py — see that file (and tools/tests/test_inherit.py)
// for the authoritative semantics. Differences from the Python are noted inline; all are
// intentional and preserve resolution results.

const isDict = (v: unknown): v is RawNode =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Registers a dotted path only for *definition* nodes, so that resolveNode on a pure
 * namespace/grouping container fails loudly instead of returning the raw container.
 *
 * A node is a definition iff it (a) has a `parent` key, (b) has a `class` key, (c) has an
 * `index` key, (d) has a `jobAbilities` key, or (e) is referenced as some other node's
 * `parent` (collected in a pre-scan, same as Python's `referenced` pass — base nodes
 * referenced as parents must resolve).
 *
 * This predicate is a deliberate TS extension of Python's registry rule. Python's
 * build_registry takes a caller-supplied leaf predicate (Monsters: `index`; Jobs: `parent` or
 * `jobAbilities`) and registers leaves + parent-bearing + referenced-as-parent nodes; it never
 * exposes path-based lookup, so nothing else needs registering. The TS API exposes
 * resolveNode(path) publicly, so it uses the union of those definition markers. Independently
 * authored Jobs children may omit `jobAbilities` and inherit the complete parent slot map;
 * grouping containers still carry none of the markers.
 */
export function buildRegistry(tree: RawNode): Map<string, RawNode> {
  // Pre-scan: collect every dotted path referenced as a `parent`.
  const referenced = new Set<string>();
  const collect = (node: RawNode): void => {
    const p = node["parent"];
    if (typeof p === "string") referenced.add(p);
    for (const v of Object.values(node)) {
      if (isDict(v)) collect(v);
    }
  };
  collect(tree);

  const reg = new Map<string, RawNode>();
  const walk = (node: RawNode, path: string): void => {
    if (
      path &&
      ("parent" in node ||
        "class" in node ||
        "index" in node ||
        "jobAbilities" in node ||
        referenced.has(path))
    ) {
      reg.set(path, node);
    }
    for (const [k, v] of Object.entries(node)) {
      if (isDict(v)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(tree, "");
  return reg;
}


const JOB_ABILITIES = "jobAbilities";


function mergeParentValues(parent: RawNode, child: RawNode): RawNode {
  const out: RawNode = { ...parent };
  for (const [k, v] of Object.entries(child)) {
    if (k === JOB_ABILITIES && isDict(v) && isDict(out[k])) {
      out[k] = { ...(out[k] as RawNode), ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}


export function assertNoJobLevelRestriction(tree: RawNode): void {
  const offenders: string[] = [];
  const walk = (node: RawNode, path: string): void => {
    const slots = node[JOB_ABILITIES];
    if (isDict(slots)) {
      for (const [slot, entry] of Object.entries(slots)) {
        if (isDict(entry) && "levelRestriction" in entry) offenders.push(`${path}.${slot}`);
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (isDict(v)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(tree, "");
  if (offenders.length > 0) {
    throw new Error(
      `job slots declare levelRestriction, which the slot-replace policy cannot express: ` +
        `${offenders.join(", ")} — implement the buildAbilityWithJobLevel: parent fallback`,
    );
  }
}

// Internal recursion: may share nested references with the registry; the public
// resolveNode clones once at the boundary (Python deep-copies at every step instead —
// same isolation guarantee, one structuredClone per resolution here).
function resolve(path: string, registry: Map<string, RawNode>, seen: Set<string>): RawNode {
  if (seen.has(path)) {
    throw new Error(`inheritance cycle at ${path}: ${[...seen].join(" -> ")}`);
  }
  seen.add(path);
  const node = registry.get(path);
  if (!node) throw new Error(`unknown node path: ${path}`);
  const parentPath = node["parent"];
  if (parentPath === undefined) return { ...node };
  if (typeof parentPath !== "string") throw new Error(`${path}: non-string parent`);
  const resolvedParent = resolve(parentPath, registry, seen);
  const { parent: _dropped, ...own } = node;
  return mergeParentValues(resolvedParent, own);
}

/**
 * Merges `path`'s node over its full `parent` chain (child-over-parent, one level deep — see
 * `mergeParentValues`), dropping `parent` from the output. Throws on an unknown/unregistered
 * path, unknown parent, or inheritance cycle. The result is deep-cloned: mutating it never
 * affects the registry, the raw tree, or other resolutions.
 */
export function resolveNode(path: string, registry: Map<string, RawNode>): RawNode {
  return structuredClone(resolve(path, registry, new Set()));
}
