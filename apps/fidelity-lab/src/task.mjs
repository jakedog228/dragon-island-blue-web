import fs from "node:fs";
import { normalizedPoint } from "./session.mjs";
import { valueAtPath } from "./stateRules.mjs";

const finiteNumber = (value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number in [${min}, ${max}]`);
  }
  return value;
};

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
};

function parseExpectation(value, label) {
  if (value === null || typeof value !== "object") throw new Error(`${label} must be an object`);
  if (!['port', 'native', 'lab'].includes(value.target)) {
    throw new Error(`${label}.target must be port, native, or lab`);
  }
  if (value.target === "native" && value.node !== undefined) {
    if (value.node === null || typeof value.node !== "object") throw new Error(`${label}.node must be an object`);
    if (value.node.className === undefined && value.node.text === undefined) {
      throw new Error(`${label}.node requires className or text`);
    }
    return Object.freeze({
      target: "native",
      description: typeof value.description === "string" ? value.description : undefined,
      node: Object.freeze({
        className: value.node.className === undefined
          ? undefined
          : nonEmptyString(value.node.className, `${label}.node.className`),
        text: value.node.text === undefined ? undefined : nonEmptyString(value.node.text, `${label}.node.text`),
        visible: value.node.visible === undefined ? true : Boolean(value.node.visible),
        exists: value.node.exists === undefined ? true : Boolean(value.node.exists),
      }),
    });
  }
  const path = nonEmptyString(value.path, `${label}.path`);
  const matchers = ["equals", "includes", "matches", "exists"].filter((key) => value[key] !== undefined);
  if (matchers.length !== 1) throw new Error(`${label} requires exactly one matcher`);
  if (matchers[0] === "matches") new RegExp(value.matches);
  return Object.freeze({
    target: value.target,
    description: typeof value.description === "string" ? value.description : undefined,
    path,
    matcher: matchers[0],
    expected: value[matchers[0]],
  });
}

function parseExpectations(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
  return Object.freeze(value.map((entry, index) => parseExpectation(entry, `${label}[${index}]`)));
}

function parseStep(value, index) {
  const label = `steps[${index}]`;
  if (value === null || typeof value !== "object") throw new Error(`${label} must be an object`);
  const id = nonEmptyString(value.id, `${label}.id`);
  if (value.kind === "wait") {
    return Object.freeze({
      kind: "wait",
      id,
      note: typeof value.note === "string" ? value.note : undefined,
      until: parseExpectations(value.until, `${label}.until`),
      timeoutMs: finiteNumber(value.timeoutMs ?? 30_000, `${label}.timeoutMs`, { min: 100, max: 180_000 }),
      pollMs: finiteNumber(value.pollMs ?? 100, `${label}.pollMs`, { min: 20, max: 5_000 }),
      stableSamples: finiteNumber(value.stableSamples ?? 2, `${label}.stableSamples`, { min: 1, max: 300 }),
    });
  }
  if (value.kind === "tap") {
    return Object.freeze({
      kind: "tap",
      id,
      note: typeof value.note === "string" ? value.note : undefined,
      ...normalizedPoint(value),
      holdMs: finiteNumber(value.holdMs ?? 70, `${label}.holdMs`, { max: 5_000 }),
      settleMs: finiteNumber(value.settleMs ?? 250, `${label}.settleMs`, { max: 30_000 }),
      nativeAtMs: value.nativeAtMs === undefined
        ? undefined
        : finiteNumber(value.nativeAtMs, `${label}.nativeAtMs`, { min: 0, max: 3_600_000 }),
    });
  }
  if (value.kind === "drag") {
    if (!Array.isArray(value.points) || value.points.length < 2) {
      throw new Error(`${label}.points requires at least two normalized points`);
    }
    return Object.freeze({
      kind: "drag",
      id,
      note: typeof value.note === "string" ? value.note : undefined,
      points: Object.freeze(value.points.map(normalizedPoint)),
      durationMs: finiteNumber(value.durationMs ?? 300, `${label}.durationMs`, { min: 1, max: 10_000 }),
      settleMs: finiteNumber(value.settleMs ?? 250, `${label}.settleMs`, { max: 30_000 }),
    });
  }
  if (value.kind === "checkpoint") {
    return Object.freeze({
      kind: "checkpoint",
      id,
      label: typeof value.label === "string" ? value.label : id,
      note: typeof value.note === "string" ? value.note : undefined,
      expectations: parseExpectations(value.expectations, `${label}.expectations`),
    });
  }
  throw new Error(`${label}.kind must be wait, tap, drag, or checkpoint`);
}

export function loadFidelityTask(file) {
  if (file === undefined) return undefined;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed?.schemaVersion !== 1) throw new Error("Fidelity task schemaVersion must be 1");
  const id = nonEmptyString(parsed.id, "task.id");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("task.id must use lowercase letters, digits, and hyphens");
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) throw new Error("task.steps must be non-empty");
  const steps = Object.freeze(parsed.steps.map(parseStep));
  if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new Error("task step ids must be unique");
  return Object.freeze({
    schemaVersion: 1,
    id,
    title: nonEmptyString(parsed.title, "task.title"),
    purpose: nonEmptyString(parsed.purpose, "task.purpose"),
    setup: Object.freeze(Array.isArray(parsed.setup) ? parsed.setup.map((entry, index) =>
      nonEmptyString(entry, `task.setup[${index}]`)) : []),
    reviewFocus: Object.freeze(Array.isArray(parsed.reviewFocus) ? parsed.reviewFocus.map((entry, index) =>
      nonEmptyString(entry, `task.reviewFocus[${index}]`)) : []),
    recommendedSaveSha256: parsed.recommendedSaveSha256 === undefined
      ? undefined
      : nonEmptyString(parsed.recommendedSaveSha256, "task.recommendedSaveSha256").toLowerCase(),
    rng: parsed.rng === undefined ? undefined : Object.freeze({
      initialState: finiteNumber(parsed.rng.initialState ?? 0, "task.rng.initialState", { max: 0xffffffff }),
      skip: finiteNumber(parsed.rng.skip ?? 0, "task.rng.skip"),
    }),
    steps,
  });
}

function targetRoot(expectation, snapshot) {
  if (expectation.target === "port") return snapshot.port?.state;
  if (expectation.target === "native") return snapshot.native?.scene;
  return snapshot;
}

function matchesValue(actual, matcher, expected) {
  if (matcher === "equals") return JSON.stringify(actual) === JSON.stringify(expected);
  if (matcher === "exists") return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null;
  if (matcher === "includes") return typeof actual === "string" || Array.isArray(actual)
    ? actual.includes(expected)
    : false;
  if (matcher === "matches") return typeof actual === "string" && new RegExp(expected).test(actual);
  return false;
}

export function evaluateTaskExpectation(expectation, snapshot) {
  if (expectation.node !== undefined) {
    const nodes = snapshot.native?.scene?.nodes ?? [];
    const classPattern = expectation.node.className === undefined ? undefined : new RegExp(expectation.node.className);
    const textPattern = expectation.node.text === undefined ? undefined : new RegExp(expectation.node.text);
    const match = nodes.find((node) =>
      node.visible === expectation.node.visible &&
      (classPattern === undefined || classPattern.test(node.className)) &&
      (textPattern === undefined || textPattern.test(node.text ?? "")));
    return Object.freeze({ expectation, pass: (match !== undefined) === expectation.node.exists, actual: match });
  }
  const actual = valueAtPath(targetRoot(expectation, snapshot), expectation.path);
  return Object.freeze({
    expectation,
    pass: matchesValue(actual, expectation.matcher, expectation.expected),
    actual,
  });
}

export function evaluateTaskExpectations(expectations, snapshot) {
  const results = expectations.map((expectation) => evaluateTaskExpectation(expectation, snapshot));
  return Object.freeze({ pass: results.every((result) => result.pass), results: Object.freeze(results) });
}

export function publicTask(task) {
  if (task === undefined) return undefined;
  return {
    schemaVersion: task.schemaVersion,
    id: task.id,
    title: task.title,
    purpose: task.purpose,
    setup: task.setup,
    reviewFocus: task.reviewFocus,
    recommendedSaveSha256: task.recommendedSaveSha256,
    rng: task.rng,
    steps: task.steps,
  };
}
