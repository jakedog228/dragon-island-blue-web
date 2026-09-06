import fs from "node:fs";

const NODE = /^HSCENE (?<indent> *)(?<class>\S+)\s+tap=\((?<x>-?[\d.]+),(?<y>-?[\d.]+)\)\s+size=\((?<w>[\d.]+)x(?<h>[\d.]+)\)(?<hidden>\s+HIDDEN)?(?:\s+"(?<text>.*)")?$/;
const RNG_POSITION = /^HSCENE (?<nativeMs>\d+)ms arc4random state=0x(?<state>[\da-fA-F]{1,8}) calls=(?<calls>\d+)$/;
const RNG_DRAW = /^HRNG (?<nativeMs>\d+)ms call=(?<call>\d+) state=0x(?<state>[\da-fA-F]{1,8}) lr=0x(?<lr>[\da-fA-F]{1,8})$/;

export function parseRecentRngDraws(text, limit = 64) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`RNG trace limit must be positive; got ${limit}`);
  const draws = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const match = RNG_DRAW.exec(rawLine);
    if (!match?.groups) continue;
    const nativeMs = Number(match.groups.nativeMs);
    const call = Number(match.groups.call);
    if (!Number.isSafeInteger(nativeMs) || !Number.isSafeInteger(call)) continue;
    draws.push(Object.freeze({
      nativeMs,
      call,
      rawState: Number.parseInt(match.groups.state, 16),
      returnAddress: Number.parseInt(match.groups.lr, 16),
    }));
  }
  return Object.freeze(draws.slice(-limit));
}

export function preferSceneRngPosition(sceneRng, current) {
  if (sceneRng === undefined) return current;
  if (current?.source === "ack" && sceneRng.calls <= current.calls) return current;
  return Object.freeze({ ...sceneRng, source: "scene" });
}

export function parseLatestSceneDump(text) {
  const starts = [...text.matchAll(/HSCENE\s+(\d+)ms\s+==== running scene ====/g)];
  const start = starts.findLast((candidate) =>
    text.indexOf(`HSCENE ${candidate[1]}ms ==== end ====`, candidate.index + candidate[0].length) >= 0);
  if (start === undefined) return undefined;
  const suffix = text.slice(start.index + start[0].length);
  const end = suffix.indexOf(`HSCENE ${start[1]}ms ==== end ====`);
  if (end < 0) return undefined;
  const nodes = [];
  let rng;
  for (const rawLine of suffix.slice(0, end).split(/\r?\n/)) {
    const position = RNG_POSITION.exec(rawLine);
    if (position?.groups?.nativeMs === start[1]) {
      const rawState = Number.parseInt(position.groups.state, 16);
      const calls = Number(position.groups.calls);
      if (Number.isSafeInteger(calls)) rng = Object.freeze({ rawState, calls });
      continue;
    }
    const match = NODE.exec(rawLine);
    if (!match?.groups) continue;
    nodes.push({
      className: match.groups.class,
      depth: Math.floor(match.groups.indent.length / 2),
      tap: { x: Number(match.groups.x), y: Number(match.groups.y) },
      size: { w: Number(match.groups.w), h: Number(match.groups.h) },
      visible: match.groups.hidden === undefined,
      ...(match.groups.text === undefined ? {} : { text: match.groups.text }),
    });
  }
  return Object.freeze({
    nativeMs: Number(start[1]),
    ...(rng === undefined ? {} : { rng }),
    nodes: Object.freeze(nodes),
  });
}

// Dumps land every few hundred milliseconds, so the newest complete one is almost always inside the
// last few kilobytes. Reading and regex-scanning the full 4 MB tail on every status poll cost ~10ms
// of blocked event loop each time and grew with the session; widen only when a window comes up short.
const SCENE_TAIL_WINDOWS = [128 * 1024, 1024 * 1024, 4 * 1024 * 1024];

export function readLatestSceneDump(file) {
  if (file === undefined) return undefined;
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return undefined;
  }
  const descriptor = fs.openSync(file, "r");
  try {
    let previousLength = 0;
    for (const window of SCENE_TAIL_WINDOWS) {
      const length = Math.min(size, window);
      if (length <= previousLength) break;
      previousLength = length;
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(descriptor, buffer, 0, length, size - length);
      const parsed = parseLatestSceneDump(buffer.toString("utf8", 0, read));
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readRecentRngDraws(file, limit = 64) {
  if (file === undefined) return Object.freeze([]);
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return Object.freeze([]);
  }
  const length = Math.min(size, 512 * 1024);
  const descriptor = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(descriptor, buffer, 0, length, size - length);
    return parseRecentRngDraws(buffer.toString("utf8", 0, read), limit);
  } finally {
    fs.closeSync(descriptor);
  }
}
