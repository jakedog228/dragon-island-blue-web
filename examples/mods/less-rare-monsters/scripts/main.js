// Native v4 adaptation of Wolfgang Kern's MIT-licensed launcher manifest.
// Apply before world loading AND save fingerprinting; never mutate the source archive.
const upstream = dibMod.files.json("upstream/mod.json");
dibMod.hooks.on("content:loaded", ({ value: content }) => {
  const base = content.resources;
  const patched = new Map();
  for (const operation of upstream.operations) {
    const fail = (reason) => {
      throw new Error(`Less Rare Monsters: ${operation.file}: ${reason}`);
    };
    if (operation.op !== "plist_set" || !/^World_[^/]+\.plist$/.test(operation.file)) {
      fail("unsupported upstream operation");
    }
    if (!base.has(operation.file)) fail("required world is missing from the selected archive");
    if (!patched.has(operation.file)) {
      patched.set(operation.file, structuredClone(base.plist(operation.file)));
    }
    let target = patched.get(operation.file);
    for (const segment of operation.path.slice(0, -1)) {
      if (typeof segment === "string") {
        if (target === null || typeof target !== "object" || !Object.hasOwn(target, segment)) {
          fail(`missing path member ${segment}`);
        }
        target = target[segment];
      } else {
        if (!Array.isArray(target) || !segment.match) fail("expected an array selector");
        const matches = target.filter((entry) => Object.entries(segment.match).every(([path, value]) => {
          let selected = entry;
          for (const key of path.split(".")) selected = selected?.[key];
          return selected === value;
        }));
        if (matches.length !== 1) fail(`selector ${JSON.stringify(segment.match)} matched ${matches.length} entries`);
        target = matches[0];
      }
    }
    const key = operation.path.at(-1);
    if (key !== "chance" || !Object.hasOwn(target, key) ||
        typeof target[key] !== "number" || typeof operation.value !== "number") {
      fail("expected an existing numeric encounter weight");
    }
    target[key] = operation.value;
  }
  return {
    ...content,
    resources: {
      list: () => base.list(),
      has: (path) => base.has(path),
      // Match the catalog's isolated snapshot contract for every patched read.
      plist: (path) => patched.has(path) ? structuredClone(patched.get(path)) : base.plist(path),
      text: (path) => base.text(path),
      url: (path) => base.url(path),
      ...(base.resolveAtlasBackingFile ? {
        resolveAtlasBackingFile: (path) => base.resolveAtlasBackingFile(path),
      } : {}),
    },
  };
});
