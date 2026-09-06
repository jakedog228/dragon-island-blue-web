import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const deflate = promisify(zlib.deflate);
const CRC_TABLE = new Uint32Array(256);
const captureCache = new Map();
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  // Indexed rather than `for..of`: this runs over a whole compressed framebuffer on the event loop.
  for (let index = 0; index < buffer.length; index++) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

export function parsePpm(buffer) {
  let offset = 0;
  const tokens = [];
  while (tokens.length < 4) {
    while (offset < buffer.length && /\s/.test(String.fromCharCode(buffer[offset]))) offset++;
    if (buffer[offset] === 0x23) {
      while (offset < buffer.length && buffer[offset] !== 0x0a) offset++;
      continue;
    }
    const start = offset;
    while (offset < buffer.length && !/\s/.test(String.fromCharCode(buffer[offset]))) offset++;
    tokens.push(buffer.toString("ascii", start, offset));
  }
  if (offset >= buffer.length || !/\s/.test(String.fromCharCode(buffer[offset]))) {
    throw new Error("PPM header has no pixel-data separator");
  }
  if (buffer[offset] === 0x0d && buffer[offset + 1] === 0x0a) offset += 2;
  else offset++;
  if (tokens[0] !== "P6") throw new Error(`Unsupported native capture format ${tokens[0]}`);
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const max = Number(tokens[3]);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 || max !== 255) {
    throw new Error(`Invalid PPM header ${tokens.join(" ")}`);
  }
  const pixels = buffer.subarray(offset);
  if (pixels.length !== width * height * 3) {
    throw new Error(`PPM pixel length ${pixels.length} does not match ${width}x${height}`);
  }
  return { width, height, pixels };
}

function pngScanlines(width, height, pixels, flipY) {
  const stride = width * 3;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const target = y * (stride + 1);
    scanlines[target] = 0;
    const sourceY = flipY ? height - 1 - y : y;
    pixels.copy(scanlines, target + 1, sourceY * stride, (sourceY + 1) * stride);
  }
  return scanlines;
}

function assemblePng(width, height, deflated) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return {
    width,
    height,
    png: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflated),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  };
}

export function ppmToPng(ppm, { flipY = true } = {}) {
  const { width, height, pixels } = parsePpm(ppm);
  return assemblePng(width, height, zlib.deflateSync(pngScanlines(width, height, pixels, flipY), { level: 3 }));
}

// Compressing a 960x640 framebuffer with `deflateSync` blocked the event loop for ~30ms every
// evidence sample, which stalled both live viewer streams and the dashboard's own HTTP responses.
export async function ppmToPngAsync(ppm, { flipY = true } = {}) {
  const { width, height, pixels } = parsePpm(ppm);
  return assemblePng(width, height, await deflate(pngScanlines(width, height, pixels, flipY), { level: 3 }));
}

// Newest first, ordered by the harness's own monotonic frame index. The index is already in the
// filename, so no per-file `stat` is needed: statting a directory that had built up several hundred
// pending frames cost ~55ms per sample on its own. Truncated newest frames are detected when the
// read fails to parse rather than by inspecting size up front.
async function nativeCaptureCandidates(directory) {
  if (directory === undefined) return [];
  let names;
  try {
    names = await fs.promises.readdir(directory);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, match: /^frame_(\d+)_\d+ms\.ppm$/i.exec(name) }))
    .filter(({ match }) => match !== null)
    .map(({ name, match }) => ({ name, file: path.join(directory, name), index: Number(match[1]) }))
    .sort((left, right) => right.index - left.index);
}

export async function refreshNativeCapture(directory, output, { prune = false, keep = 8 } = {}) {
  const candidates = await nativeCaptureCandidates(directory);
  if (candidates.length === 0) throw new Error(`No TouchHLE framebuffer capture exists in ${directory}`);
  const cached = captureCache.get(output);
  let latest;
  let converted;
  for (const candidate of candidates) {
    // Frame files are write-once under a unique name, so identity of the path is enough to reuse a
    // previous conversion; the former mtime check needed a `stat` per sample to say the same thing.
    if (cached?.source === candidate.file && fs.existsSync(output)) {
      latest = candidate;
      converted = cached.converted;
      break;
    }
    try {
      converted = await ppmToPngAsync(await fs.promises.readFile(candidate.file));
      latest = candidate;
      break;
    } catch {
      // The harness writes directly to its final filename. A newest entry can be visible
      // between header and final pixel; fall back to the newest complete predecessor.
    }
  }
  if (latest === undefined || converted === undefined) {
    throw new Error(`No complete TouchHLE framebuffer capture exists in ${directory}`);
  }
  if (cached?.source !== latest.file || !fs.existsSync(output)) {
    await fs.promises.writeFile(output, converted.png);
  }
  const result = { source: latest.file, width: converted.width, height: converted.height };
  captureCache.set(output, { source: latest.file, converted, result });
  if (prune) await pruneNativeCaptures(directory, { keep, protect: latest.file });
  return result;
}

// The live viewer reads the newest frames straight out of this directory, so a prune that deleted
// everything except the single latest frame raced the streaming pump and stalled it. Keeping a
// small newest-first window leaves the pump a complete predecessor to fall back to.
export async function pruneNativeCaptures(directory, { keep = 8, protect } = {}) {
  const candidates = await nativeCaptureCandidates(directory);
  let removed = 0;
  for (const candidate of candidates.slice(Math.max(keep, 1))) {
    if (candidate.file === protect) continue;
    try {
      await fs.promises.unlink(candidate.file);
      removed++;
    } catch {
      // A frame the viewer still holds open, or one already collected by a concurrent prune.
    }
  }
  return { scanned: candidates.length, removed };
}
