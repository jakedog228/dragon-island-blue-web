


export type PlistValue =
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "real"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "date"; readonly value: number }
  | { readonly kind: "data"; readonly value: Uint8Array }
  | { readonly kind: "array"; readonly value: readonly PlistValue[] }
  | { readonly kind: "dict"; readonly value: ReadonlyMap<string, PlistValue> };

export interface PlistLimits {
  /** Whole-file cap. The largest shipped save is under 4 KiB; this leaves several orders of room. */
  readonly maxBytes: number;
  readonly maxObjects: number;
  readonly maxDepth: number;
  readonly maxStringLength: number;
  readonly maxContainerEntries: number;
}

export const DEFAULT_PLIST_LIMITS: PlistLimits = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxObjects: 200_000,
  maxDepth: 32,
  maxStringLength: 64 * 1024,
  maxContainerEntries: 100_000,
});

export class BinaryPlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinaryPlistError";
  }
}

const HEADER = "bplist00";
const TRAILER_LENGTH = 32;

const MARKER_SINGLETON = 0x0;
const MARKER_INT = 0x1;
const MARKER_REAL = 0x2;
const MARKER_DATE = 0x3;
const MARKER_DATA = 0x4;
const MARKER_ASCII = 0x5;
const MARKER_UTF16 = 0x6;
const MARKER_UID = 0x8;
const MARKER_ARRAY = 0xa;
const MARKER_SET = 0xc;
const MARKER_DICT = 0xd;

/** Seconds between the Unix epoch and the CoreFoundation epoch (2001-01-01T00:00:00Z). */
const CF_EPOCH_OFFSET_SECONDS = 978_307_200;

export function decodeBinaryPlist(
  bytes: Uint8Array,
  limits: PlistLimits = DEFAULT_PLIST_LIMITS,
): PlistValue {
  if (bytes.length > limits.maxBytes) {
    throw new BinaryPlistError(
      `save file is ${bytes.length} bytes, over the ${limits.maxBytes}-byte limit`,
    );
  }
  if (bytes.length < HEADER.length + TRAILER_LENGTH) {
    throw new BinaryPlistError("save file is too short to be a binary property list");
  }
  for (let index = 0; index < HEADER.length; index += 1) {
    if (bytes[index] !== HEADER.charCodeAt(index)) {
      throw new BinaryPlistError("save file is not a binary property list (missing bplist00 header)");
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailerStart = bytes.length - TRAILER_LENGTH;
  const offsetSize = bytes[trailerStart + 6]!;
  const refSize = bytes[trailerStart + 7]!;
  const objectCount = readUInt64(view, trailerStart + 8);
  const topObject = readUInt64(view, trailerStart + 16);
  const offsetTableStart = readUInt64(view, trailerStart + 24);

  if (offsetSize < 1 || offsetSize > 8) {
    throw new BinaryPlistError(`invalid offset integer size ${offsetSize}`);
  }
  if (refSize < 1 || refSize > 8) {
    throw new BinaryPlistError(`invalid object reference size ${refSize}`);
  }
  if (objectCount > limits.maxObjects) {
    throw new BinaryPlistError(
      `save file declares ${objectCount} objects, over the ${limits.maxObjects} limit`,
    );
  }
  if (objectCount === 0) throw new BinaryPlistError("save file declares no objects");
  if (topObject >= objectCount) {
    throw new BinaryPlistError("save file's root object reference is out of range");
  }
  if (
    offsetTableStart < HEADER.length ||
    offsetTableStart + objectCount * offsetSize > trailerStart
  ) {
    throw new BinaryPlistError("save file's offset table does not fit inside the file");
  }

  const offsets = new Array<number>(objectCount);
  for (let index = 0; index < objectCount; index += 1) {
    const offset = readSizedUInt(view, offsetTableStart + index * offsetSize, offsetSize);
    if (offset < HEADER.length || offset >= offsetTableStart) {
      throw new BinaryPlistError(`object ${index} has an out-of-range offset`);
    }
    offsets[index] = offset;
  }

  // A plist is a graph, not a tree: CoreFoundation dedups equal scalars, so the same object index
  // legitimately appears many times. Only a reference that reaches itself is a cycle, so the guard
  // tracks the active path rather than every index already visited.
  const active = new Set<number>();

  const readObject = (index: number, depth: number): PlistValue => {
    if (depth > limits.maxDepth) {
      throw new BinaryPlistError(`save file nests deeper than ${limits.maxDepth} levels`);
    }
    if (active.has(index)) throw new BinaryPlistError("save file contains a reference cycle");
    const start = offsets[index]!;
    const marker = bytes[start]!;
    const type = marker >> 4;
    const nibble = marker & 0x0f;

    switch (type) {
      case MARKER_SINGLETON:
        if (nibble === 0x0) throw new BinaryPlistError("save file contains a null value");
        if (nibble === 0x8) return { kind: "bool", value: false };
        if (nibble === 0x9) return { kind: "bool", value: true };
        throw new BinaryPlistError(`unsupported singleton marker 0x${marker.toString(16)}`);

      case MARKER_INT:
        return { kind: "int", value: readPlistInteger(view, start, nibble) };

      case MARKER_REAL: {
        const value = nibble === 2
          ? view.getFloat32(start + 1)
          : nibble === 3
            ? view.getFloat64(start + 1)
            : undefined;
        if (value === undefined) {
          throw new BinaryPlistError(`unsupported real width 2^${nibble}`);
        }
        if (!Number.isFinite(value)) {
          throw new BinaryPlistError("save file contains a non-finite number");
        }
        return { kind: "real", value };
      }

      case MARKER_DATE: {
        if (nibble !== 3) throw new BinaryPlistError("unsupported date encoding");
        const seconds = view.getFloat64(start + 1);
        if (!Number.isFinite(seconds)) throw new BinaryPlistError("save file contains a bad date");
        return { kind: "date", value: seconds + CF_EPOCH_OFFSET_SECONDS };
      }

      case MARKER_DATA: {
        const { count, cursor } = readCount(view, bytes, start, nibble, limits);
        requireRange(cursor, count, offsetTableStart, "data");
        return { kind: "data", value: bytes.slice(cursor, cursor + count) };
      }

      case MARKER_ASCII: {
        const { count, cursor } = readCount(view, bytes, start, nibble, limits);
        if (count > limits.maxStringLength) {
          throw new BinaryPlistError(`string exceeds ${limits.maxStringLength} characters`);
        }
        requireRange(cursor, count, offsetTableStart, "string");
        let text = "";
        for (let at = 0; at < count; at += 1) {
          const code = bytes[cursor + at]!;
          if (code > 0x7f) throw new BinaryPlistError("ASCII string contains a non-ASCII byte");
          text += String.fromCharCode(code);
        }
        return { kind: "string", value: text };
      }

      case MARKER_UTF16: {
        const { count, cursor } = readCount(view, bytes, start, nibble, limits);
        if (count > limits.maxStringLength) {
          throw new BinaryPlistError(`string exceeds ${limits.maxStringLength} characters`);
        }
        requireRange(cursor, count * 2, offsetTableStart, "string");
        let text = "";
        for (let at = 0; at < count; at += 1) {
          text += String.fromCharCode(view.getUint16(cursor + at * 2));
        }
        return { kind: "string", value: text };
      }

      case MARKER_ARRAY: {
        const { count, cursor } = readCount(view, bytes, start, nibble, limits);
        requireEntryCount(count, limits, "array");
        requireRange(cursor, count * refSize, offsetTableStart, "array");
        active.add(index);
        try {
          const items = new Array<PlistValue>(count);
          for (let at = 0; at < count; at += 1) {
            items[at] = readObject(
              requireRef(view, cursor + at * refSize, refSize, objectCount),
              depth + 1,
            );
          }
          return { kind: "array", value: items };
        } finally {
          active.delete(index);
        }
      }

      case MARKER_DICT: {
        const { count, cursor } = readCount(view, bytes, start, nibble, limits);
        requireEntryCount(count, limits, "dictionary");
        requireRange(cursor, count * refSize * 2, offsetTableStart, "dictionary");
        active.add(index);
        try {
          const entries = new Map<string, PlistValue>();
          for (let at = 0; at < count; at += 1) {
            const key = readObject(
              requireRef(view, cursor + at * refSize, refSize, objectCount),
              depth + 1,
            );
            if (key.kind !== "string") {
              throw new BinaryPlistError("save file contains a non-string dictionary key");
            }
            if (entries.has(key.value)) {
              throw new BinaryPlistError(`save file repeats dictionary key ${key.value}`);
            }
            entries.set(
              key.value,
              readObject(
                requireRef(view, cursor + (count + at) * refSize, refSize, objectCount),
                depth + 1,
              ),
            );
          }
          return { kind: "dict", value: entries };
        } finally {
          active.delete(index);
        }
      }

      case MARKER_SET:
        throw new BinaryPlistError("save file contains a set, which the game never writes");
      case MARKER_UID:
        throw new BinaryPlistError("save file contains a UID (keyed-archive data is not supported)");
      default:
        throw new BinaryPlistError(`unsupported object marker 0x${marker.toString(16)}`);
    }
  };

  return readObject(topObject, 0);
}


export function encodeBinaryPlist(
  root: PlistValue,
  limits: PlistLimits = DEFAULT_PLIST_LIMITS,
): Uint8Array {
  /** Index -> the value written there. Doubles as the breadth-first worklist. */
  const values: PlistValue[] = [];
  /** Scalar dedup by content, matching CoreFoundation. */
  const scalarIndices = new Map<string, number>();
  /** Container dedup by identity; two structurally equal dictionaries stay two objects. */
  const containerIndices = new Map<PlistValue, number>();

  const intern = (value: PlistValue): number => {
    const scalarKey = scalarDedupKey(value);
    const table: Map<unknown, number> = scalarKey === undefined
      ? containerIndices
      : (scalarIndices as Map<unknown, number>);
    const lookup: unknown = scalarKey ?? value;
    const found = table.get(lookup);
    if (found !== undefined) return found;
    if (values.length >= limits.maxObjects) {
      throw new BinaryPlistError(`state expands past the ${limits.maxObjects}-object limit`);
    }
    const index = values.length;
    values.push(value);
    table.set(lookup, index);
    return index;
  };

  // The worklist is `values` itself: interning appends, and the cursor sweeps what was appended.
  // Every object therefore gets exactly one index, and a shared subtree is visited once.
  intern(root);
  for (let cursor = 0; cursor < values.length; cursor += 1) {
    const value = values[cursor]!;
    if (value.kind === "array") {
      for (const item of value.value) intern(item);
    } else if (value.kind === "dict") {
      const keys = sortedKeys(value.value);
      // Keys before values, mirroring the layout each dictionary object writes.
      for (const key of keys) intern({ kind: "string", value: key });
      for (const key of keys) intern(value.value.get(key)!);
    }
  }

  const refSize = byteWidthFor(values.length - 1);
  const objects = values.map((value) => encodeObject(value, refSize, intern));

  let bodyLength = HEADER.length;
  const offsets = objects.map((object) => {
    const offset = bodyLength;
    bodyLength += object.length;
    return offset;
  });
  const offsetSize = byteWidthFor(bodyLength);
  const out = new Uint8Array(bodyLength + offsets.length * offsetSize + TRAILER_LENGTH);
  const view = new DataView(out.buffer);

  for (let index = 0; index < HEADER.length; index += 1) out[index] = HEADER.charCodeAt(index);
  objects.forEach((object, index) => { out.set(object, offsets[index]!); });

  let cursor = bodyLength;
  for (const offset of offsets) {
    writeSizedUInt(view, cursor, offset, offsetSize);
    cursor += offsetSize;
  }
  out[cursor + 6] = offsetSize;
  out[cursor + 7] = refSize;
  writeUInt64(view, cursor + 8, objects.length);
  // `intern(root)` ran before anything else, so the root is always object 0.
  writeUInt64(view, cursor + 16, 0);
  writeUInt64(view, cursor + 24, bodyLength);
  return out;
}

function sortedKeys(entries: ReadonlyMap<string, PlistValue>): readonly string[] {
  return [...entries.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function scalarDedupKey(value: PlistValue): string | undefined {
  switch (value.kind) {
    case "bool": return `b:${value.value}`;
    case "int": return `i:${value.value}`;
    case "real": return `r:${Object.is(value.value, -0) ? "-0" : value.value}`;
    case "string": return `s:${value.value}`;
    case "date": return `d:${value.value}`;
    default: return undefined;
  }
}

function encodeObject(
  value: PlistValue,
  refSize: number,
  refOf: (child: PlistValue) => number,
): Uint8Array {
  switch (value.kind) {
    case "bool":
      return Uint8Array.of(value.value ? 0x09 : 0x08);

    case "int":
      return encodeInteger(value.value);

    case "real": {
      const out = new Uint8Array(9);
      out[0] = 0x23;
      new DataView(out.buffer).setFloat64(1, value.value);
      return out;
    }

    case "date": {
      const out = new Uint8Array(9);
      out[0] = 0x33;
      new DataView(out.buffer).setFloat64(1, value.value - CF_EPOCH_OFFSET_SECONDS);
      return out;
    }

    case "data": {
      const header = encodeMarkerAndCount(MARKER_DATA, value.value.length);
      const out = new Uint8Array(header.length + value.value.length);
      out.set(header, 0);
      out.set(value.value, header.length);
      return out;
    }

    case "string": {
      const ascii = [...value.value].every((character) => character.charCodeAt(0) <= 0x7f);
      if (ascii) {
        const header = encodeMarkerAndCount(MARKER_ASCII, value.value.length);
        const out = new Uint8Array(header.length + value.value.length);
        out.set(header, 0);
        for (let index = 0; index < value.value.length; index += 1) {
          out[header.length + index] = value.value.charCodeAt(index);
        }
        return out;
      }
      const header = encodeMarkerAndCount(MARKER_UTF16, value.value.length);
      const out = new Uint8Array(header.length + value.value.length * 2);
      out.set(header, 0);
      const view = new DataView(out.buffer);
      for (let index = 0; index < value.value.length; index += 1) {
        view.setUint16(header.length + index * 2, value.value.charCodeAt(index));
      }
      return out;
    }

    case "array": {
      const header = encodeMarkerAndCount(MARKER_ARRAY, value.value.length);
      const out = new Uint8Array(header.length + value.value.length * refSize);
      out.set(header, 0);
      const view = new DataView(out.buffer);
      value.value.forEach((item, at) => {
        writeSizedUInt(view, header.length + at * refSize, refOf(item), refSize);
      });
      return out;
    }

    case "dict": {
      const keys = sortedKeys(value.value);
      const header = encodeMarkerAndCount(MARKER_DICT, keys.length);
      const out = new Uint8Array(header.length + keys.length * refSize * 2);
      out.set(header, 0);
      const view = new DataView(out.buffer);
      keys.forEach((key, at) => {
        writeSizedUInt(
          view,
          header.length + at * refSize,
          refOf({ kind: "string", value: key }),
          refSize,
        );
        writeSizedUInt(
          view,
          header.length + (keys.length + at) * refSize,
          refOf(value.value.get(key)!),
          refSize,
        );
      });
      return out;
    }
  }
}

function encodeInteger(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) {
    throw new BinaryPlistError(`cannot encode ${value} as a plist integer`);
  }
  // CoreFoundation writes 1/2/4-byte integers unsigned and the 8-byte form signed, so any
  // negative value must widen all the way rather than borrow a shorter unsigned slot.
  if (value >= 0 && value <= 0xff) return Uint8Array.of(0x10, value);
  if (value >= 0 && value <= 0xffff) {
    const out = new Uint8Array(3);
    out[0] = 0x11;
    new DataView(out.buffer).setUint16(1, value);
    return out;
  }
  if (value >= 0 && value <= 0xffff_ffff) {
    const out = new Uint8Array(5);
    out[0] = 0x12;
    new DataView(out.buffer).setUint32(1, value);
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = 0x13;
  new DataView(out.buffer).setBigInt64(1, BigInt(value));
  return out;
}

function encodeMarkerAndCount(type: number, count: number): Uint8Array {
  if (count < 0x0f) return Uint8Array.of((type << 4) | count);
  const size = encodeInteger(count);
  const out = new Uint8Array(1 + size.length);
  out[0] = (type << 4) | 0x0f;
  out.set(size, 1);
  return out;
}

function byteWidthFor(maximum: number): number {
  if (maximum <= 0xff) return 1;
  if (maximum <= 0xffff) return 2;
  if (maximum <= 0xffff_ffff) return 4;
  return 8;
}

function readCount(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  nibble: number,
  limits: PlistLimits,
): { count: number; cursor: number } {
  if (nibble !== 0x0f) return { count: nibble, cursor: start + 1 };
  const sizeMarker = bytes[start + 1]!;
  if (sizeMarker >> 4 !== MARKER_INT) {
    throw new BinaryPlistError("variable-length object has a malformed size field");
  }
  const width = sizeMarker & 0x0f;
  const count = readPlistInteger(view, start + 1, width);
  if (count < 0 || count > limits.maxContainerEntries) {
    throw new BinaryPlistError(`object declares ${count} entries, over the supported limit`);
  }
  return { count, cursor: start + 2 + (1 << width) };
}

function readPlistInteger(view: DataView, start: number, nibble: number): number {
  switch (nibble) {
    case 0: return view.getUint8(start + 1);
    case 1: return view.getUint16(start + 1);
    case 2: return view.getUint32(start + 1);
    case 3: {
      const wide = view.getBigInt64(start + 1);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER) || wide < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new BinaryPlistError(`integer ${wide} is outside the exactly-representable range`);
      }
      return Number(wide);
    }
    default:
      throw new BinaryPlistError(`unsupported integer width 2^${nibble}`);
  }
}

function readSizedUInt(view: DataView, start: number, size: number): number {
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    value = value * 256 + view.getUint8(start + index);
    if (!Number.isSafeInteger(value)) {
      throw new BinaryPlistError("save file contains an unrepresentable offset");
    }
  }
  return value;
}

function writeSizedUInt(view: DataView, start: number, value: number, size: number): void {
  let remaining = value;
  for (let index = size - 1; index >= 0; index -= 1) {
    view.setUint8(start + index, remaining % 256);
    remaining = Math.floor(remaining / 256);
  }
}

function readUInt64(view: DataView, start: number): number {
  const wide = view.getBigUint64(start);
  if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BinaryPlistError("save file declares an unrepresentable size");
  }
  return Number(wide);
}

function writeUInt64(view: DataView, start: number, value: number): void {
  view.setBigUint64(start, BigInt(value));
}

function requireRef(view: DataView, start: number, size: number, objectCount: number): number {
  const ref = readSizedUInt(view, start, size);
  if (ref >= objectCount) throw new BinaryPlistError("save file has an out-of-range object reference");
  return ref;
}

function requireRange(cursor: number, length: number, limit: number, label: string): void {
  if (cursor + length > limit) {
    throw new BinaryPlistError(`save file's ${label} payload runs past the object table`);
  }
}

function requireEntryCount(count: number, limits: PlistLimits, label: string): void {
  if (count > limits.maxContainerEntries) {
    throw new BinaryPlistError(`${label} declares ${count} entries, over the supported limit`);
  }
}
