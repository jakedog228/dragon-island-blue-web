















const MISSING = Symbol("absent");

function kindOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function describe(value) {
  if (value === MISSING) return "<absent>";
  if (value === undefined) return "undefined";
  const json = JSON.stringify(value);
  if (json === undefined) return String(value);
  return json.length > 400 ? json.slice(0, 400) + "... (" + json.length + " chars)" : json;
}

function walk(actual, expected, path, parentActual, parentExpected, parentPath) {
  const found = (value, other) => ({
    path,
    actual: value,
    expected: other,
    parentPath,
    parentActual,
    parentExpected,
  });

  const actualKind = kindOf(actual);
  if (actualKind !== kindOf(expected)) return found(actual, expected);

  if (actualKind === "array") {
    const length = Math.max(actual.length, expected.length);
    for (let index = 0; index < length; index++) {
      const childPath = path + "[" + index + "]";
      if (index >= actual.length) {
        return { path: childPath, actual: MISSING, expected: expected[index], parentPath: path, parentActual: actual, parentExpected: expected };
      }
      if (index >= expected.length) {
        return { path: childPath, actual: actual[index], expected: MISSING, parentPath: path, parentActual: actual, parentExpected: expected };
      }
      const child = walk(actual[index], expected[index], childPath, actual, expected, path);
      if (child !== undefined) return child;
    }
    return undefined;
  }

  if (actualKind === "object") {
    const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
    for (const key of keys) {
      const childPath = /^[A-Za-z_$][\w$]*$/.test(key)
        ? path + "." + key
        : path + "[" + JSON.stringify(key) + "]";
      const hasActual = Object.hasOwn(actual, key);
      const hasExpected = Object.hasOwn(expected, key);
      if (!hasActual || !hasExpected) {
        return {
          path: childPath,
          actual: hasActual ? actual[key] : MISSING,
          expected: hasExpected ? expected[key] : MISSING,
          parentPath: path,
          parentActual: actual,
          parentExpected: expected,
        };
      }
      const child = walk(actual[key], expected[key], childPath, actual, expected, path);
      if (child !== undefined) return child;
    }
    return undefined;
  }

  return Object.is(actual, expected) ? undefined : found(actual, expected);
}

/** `undefined` when the two structures are deep-equal, otherwise the first differing path. */
export function firstDifference(actual, expected, rootLabel = "$") {
  return walk(actual, expected, rootLabel, undefined, undefined, rootLabel);
}

/** A one-screen failure message: the path, both values, and the enclosing containers. */
export function formatDifference(difference) {
  if (difference === undefined) return "no difference found by firstDifference()";
  const lines = [
    "first differing path: " + difference.path,
    "  actual:   " + describe(difference.actual),
    "  expected: " + describe(difference.expected),
  ];
  if (difference.parentPath !== difference.path) {
    lines.push("  parent " + difference.parentPath + " actual:   " + describe(difference.parentActual));
    lines.push("  parent " + difference.parentPath + " expected: " + describe(difference.parentExpected));
  }
  return lines.join("\n");
}
