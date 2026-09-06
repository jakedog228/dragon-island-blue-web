/**
 * Strict JSON-shaped input helpers shared by the dungeon save parser and direct engine APIs.
 *
 * JSON.parse produces ordinary objects/arrays with enumerable data properties. Accepting a
 * broader JavaScript object graph at an engine boundary makes symbols, accessors, sparse arrays,
 * prototypes, and cycles disappear during normalization, so this walker rejects those shapes
 * before any caller-specific validation runs.
 */

export function assertPlainObject(value: unknown, label: string): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype) {
    throw new Error(`${label} must be an ordinary object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new Error(`${label} must not contain symbol keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      throw new Error(`${label} must contain only enumerable data properties`);
    }
  }
}

export function assertExactObjectKeys(
  value: unknown,
  allowed: readonly string[],
  label: string,
): asserts value is object {
  assertPlainObject(value, label);
  const allowedKeys = new Set(allowed);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${label} has unknown field ${key}`);
  }
}

export function assertOrdinaryArray(value: unknown, label: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${label} must be an ordinary array`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new Error(`${label} must not contain symbol keys`);
    if (key === "length") continue;
    if (!isArrayIndexKey(key) || !Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label} must not contain extra keys`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      throw new Error(`${label} must contain only enumerable data properties`);
    }
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
      throw new Error(`${label} must not contain holes`);
    }
  }
}

export function cloneJsonSafeRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  assertPlainObject(value, label);
  assertJsonSafeTree(value, label);
  return Object.freeze(cloneJsonSafeObject(value as Record<string, unknown>, label));
}

export function cloneJsonSafeValue(value: unknown, label: string): unknown {
  assertJsonSafeTree(value, label);
  return cloneJsonSafeNode(value, label);
}

/** Walk the complete raw graph before normalization so no property can disappear through a
 * partial Object.keys/Object.entries traversal and cycles produce a controlled error. */
export function assertJsonSafeTree(
  value: unknown,
  label: string,
  active = new Set<object>(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} must be JSON-safe`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${label} must be JSON-safe`);
  if (active.has(value)) throw new Error(`${label} contains a cycle`);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      assertOrdinaryArray(value, label);
      for (let index = 0; index < value.length; index++) {
        assertJsonSafeTree(value[index], `${label}[${index}]`, active);
      }
    } else {
      assertPlainObject(value, label);
      for (const key of Object.getOwnPropertyNames(value)) {
        assertJsonSafeTree(
          (value as Record<string, unknown>)[key],
          `${label}.${key}`,
          active,
        );
      }
    }
  } finally {
    active.delete(value);
  }
}

function cloneJsonSafeNode(value: unknown, label: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) {
    assertOrdinaryArray(value, label);
    return Object.freeze(value.map((entry, index) => cloneJsonSafeNode(entry, `${label}[${index}]`)));
  }
  if (typeof value !== "object") throw new Error(`${label} must be JSON-safe`);
  assertPlainObject(value, label);
  return Object.freeze(cloneJsonSafeObject(value as Record<string, unknown>, label));
}

function cloneJsonSafeObject(
  value: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    Object.defineProperty(result, key, {
      value: cloneJsonSafeNode(value[key], `${label}.${key}`),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function isArrayIndexKey(value: string): boolean {
  if (!/^(0|[1-9]\d*)$/.test(value)) return false;
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 && index < 0xffffffff && String(index) === value;
}
