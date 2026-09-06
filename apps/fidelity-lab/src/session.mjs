import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function normalizedPoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error(`Input coordinates must be normalized to [0,1], got (${point?.x}, ${point?.y})`);
  }
  return Object.freeze({ x, y });
}

export function targetPoint(normalized, bounds) {
  const point = normalizedPoint(normalized);
  if (!(bounds?.width > 0) || !(bounds?.height > 0)) throw new Error("Target has no positive extent");
  return Object.freeze({
    x: bounds.x + point.x * bounds.width,
    y: bounds.y + point.y * bounds.height,
  });
}

export function inputEvent(value) {
  if (!["down", "move", "up"].includes(value?.phase)) throw new Error(`Unknown input phase ${value?.phase}`);
  return Object.freeze({ phase: value.phase, ...normalizedPoint(value) });
}

export function inputGesture(value) {
  if (!Array.isArray(value?.events) || value.events.length < 2 || value.events.length > 1_000) {
    throw new Error("A mirrored gesture requires 2-1000 input phases");
  }
  const events = value.events.map((raw, index) => {
    const event = inputEvent(raw);
    const rawMs = Number(raw.tMs);
    if (!Number.isFinite(rawMs) || rawMs < 0 || rawMs > 10_000) {
      throw new Error(`Gesture phase ${index} has invalid tMs ${raw.tMs}`);
    }
    // Dashboard phases are stamped with `performance.now()`, so they carry sub-millisecond
    // fractions. Replay deadlines derived from them must stay whole milliseconds: the TouchHLE
    // harness parses its deadline as an integer and discards any command that is not one.
    return Object.freeze({ ...event, tMs: Math.round(rawMs) });
  });
  if (events[0].phase !== "down" || events.at(-1).phase !== "up") {
    throw new Error("A mirrored gesture must begin with down and end with up");
  }
  for (let index = 1; index < events.length; index++) {
    if (events[index].tMs < events[index - 1].tMs) {
      throw new Error("Gesture phase timestamps must be nondecreasing");
    }
    if (index < events.length - 1 && events[index].phase !== "move") {
      throw new Error("Only move phases may occur between gesture down and up");
    }
  }
  const replayEvents = events.length === 2 && events[1].tMs < 120
    ? [events[0], Object.freeze({ ...events[1], tMs: 120 })]
    : events;
  return Object.freeze({
    id: typeof value.id === "string" ? value.id.slice(0, 100) : undefined,
    events: Object.freeze(replayEvents),
  });
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export class LabSession {
  constructor(outputRoot) {
    this.outputRoot = outputRoot;
    this.recording = undefined;
    this.lastMacro = [];
  }

  start(metadata) {
    if (this.recording !== undefined) throw new Error("A Fidelity Lab recording is already active");
    const directory = path.join(this.outputRoot, stamp());
    fs.mkdirSync(path.join(directory, "frames"), { recursive: true });
    fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      ...metadata,
    }, null, 2)}\n`);
    this.recording = { directory, startedAt: performance.now(), inputs: [], frameIndex: 0 };
    return directory;
  }

  isRecording() {
    return this.recording !== undefined;
  }

  append(kind, payload) {
    const active = this.recording;
    if (active === undefined) return;
    const entry = { tMs: performance.now() - active.startedAt, kind, ...payload };
    fs.appendFileSync(path.join(active.directory, "events.ndjson"), `${JSON.stringify(entry)}\n`);
    if (kind === "input") active.inputs.push(entry);
  }

  capture(nativeFrame, portFrame) {
    const active = this.recording;
    if (active === undefined || !fs.existsSync(nativeFrame) || !fs.existsSync(portFrame)) return;
    const id = String(active.frameIndex++).padStart(6, "0");
    fs.copyFileSync(nativeFrame, path.join(active.directory, "frames", `${id}-native.png`));
    fs.copyFileSync(portFrame, path.join(active.directory, "frames", `${id}-port.png`));
    this.append("frame", { id });
  }

  checkpoint(nativeFrame, portFrame, state, label = "checkpoint") {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const id = `${stamp()}-${label.replace(/[^a-z0-9_-]+/gi, "-")}`;
    const directory = path.join(this.outputRoot, "checkpoints", id);
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(nativeFrame)) fs.copyFileSync(nativeFrame, path.join(directory, "native.png"));
    if (fs.existsSync(portFrame)) fs.copyFileSync(portFrame, path.join(directory, "port.png"));
    fs.writeFileSync(path.join(directory, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
    this.append("checkpoint", { id, label });
    return directory;
  }

  stop() {
    const active = this.recording;
    if (active === undefined) return undefined;
    this.lastMacro = active.inputs.map(({ tMs, phase, x, y }) => ({ tMs, phase, x, y }));
    fs.writeFileSync(path.join(active.directory, "macro.json"), `${JSON.stringify({
      schemaVersion: 1,
      inputs: this.lastMacro,
    }, null, 2)}\n`);
    this.recording = undefined;
    return Object.freeze({ directory: active.directory, inputs: this.lastMacro.length });
  }

  macro() {
    return Object.freeze(this.lastMacro.map((entry) => Object.freeze({ ...entry })));
  }
}

export function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}
