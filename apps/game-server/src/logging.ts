import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

import type { LogLevel } from "./config.js";

/**
 * One JSON object per line on stdout, which is what a container log collector expects.
 *
 * The authority threat model forbids a login token, `Authorization` header, or the HMAC secret
 * from ever reaching a log sink, so redaction is enforced structurally here rather than left to
 * each call site remembering.
 */

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Terms that mark a field as secret-bearing. A key is redacted if its normalised form *contains*
 * any of these, not merely equals one: header names arrive prefixed (`X-Login-Token`), and wrapper
 * fields arrive suffixed (`sessionToken`, `secretFile`). Exact matching missed both.
 *
 * The containment rule over-redacts occasionally -- `tokenCount` would be replaced too. That is the
 * correct direction to err: an over-redacted diagnostic costs an operator one debugging round trip,
 * whereas an under-redacted one puts a bearer credential in a log aggregator forever.
 */
const REDACTED_KEY_TERMS: readonly string[] = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "secret",
  "session",
  "token",
];

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derives a logger that stamps `fields` onto every subsequent record. */
  child(fields: LogFields): Logger;
}

export interface CreateLoggerOptions {
  readonly level?: LogLevel;
  readonly write?: (line: string) => void;
  readonly now?: () => number;
  readonly base?: LogFields;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const now = options.now ?? Date.now;
  const base = options.base ?? {};

  const emit = (recordLevel: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_RANK[recordLevel] < LEVEL_RANK[level]) return;
    const record: LogFields = {
      time: new Date(now()).toISOString(),
      level: recordLevel,
      msg: message,
      ...base,
      ...fields,
    };
    write(`${JSON.stringify(redact(record, 0))}\n`);
  };

  return {
    debug: (message, fields) => { emit("debug", message, fields); },
    info: (message, fields) => { emit("info", message, fields); },
    warn: (message, fields) => { emit("warn", message, fields); },
    error: (message, fields) => { emit("error", message, fields); },
    child: (fields) => createLogger({
      ...options,
      level,
      base: { ...base, ...fields },
    }),
  };
}

export interface RotatingFileSinkOptions {
  readonly path: string;
  /** Roll once the active file would exceed this. */
  readonly maxBytes?: number;
  /** Rolled generations to retain beside the active file. */
  readonly keep?: number;
}

/**
 * Appends log lines to a file, rolling by size.
 *
 * Container stdout is not a durable sink: Docker's json-file driver rotates against the container,
 * so recreating one on redeploy discards its whole history. Anything meant to answer a question
 * about last month has to land on a volume instead.
 *
 * Writes are synchronous. At this service's request volume the cost is irrelevant, and it means a
 * crash cannot lose the records written immediately before it -- which are the interesting ones.
 */
export function createRotatingFileSink(options: RotatingFileSinkOptions): (line: string) => void {
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const keep = options.keep ?? 5;
  mkdirSync(dirname(options.path), { recursive: true });

  let size = fileSize(options.path);
  return (line: string): void => {
    const bytes = Buffer.byteLength(line, "utf8");
    if (size > 0 && size + bytes > maxBytes) {
      roll(options.path, keep);
      size = 0;
    }
    try {
      appendFileSync(options.path, line, "utf8");
      size += bytes;
    } catch {
      // A log sink must never take the service down with it. stdout still carries the record, and a
      // full or unmounted log volume is an operator problem, not a reason to drop a player's request.
    }
  };
}

/** `access.log` -> `.1`, `.1` -> `.2`, oldest discarded. Renames only, so no line is ever rewritten. */
function roll(path: string, keep: number): void {
  try {
    rmSync(`${path}.${keep}`, { force: true });
    for (let generation = keep - 1; generation >= 1; generation -= 1) {
      if (fileSize(`${path}.${generation}`) > 0) {
        renameSync(`${path}.${generation}`, `${path}.${generation + 1}`);
      }
    }
    renameSync(path, `${path}.1`);
  } catch {
    // Losing a rotation is survivable; losing the process is not. The next write appends to whatever
    // file is actually there and the size counter resets, so growth stays bounded either way.
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Turns an arbitrary thrown value into log fields. Stack traces are operator-facing detail and stay
 * out of the HTTP response, which keeps its opaque `correlationId` envelope.
 */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      ...(error.cause === undefined ? {} : { cause: String(error.cause) }),
    };
  }
  return { errorMessage: String(error) };
}

function redact(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (value instanceof Error) return redact({ ...errorFields(value) }, depth + 1);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSecretBearingKey(key) ? REDACTED : redact(entry, depth + 1);
  }
  return output;
}

/**
 * `X-Login-Token`, `login_token`, `loginToken`, and `LOGIN TOKEN` must all be treated identically,
 * so separators and case are stripped before matching.
 */
function isSecretBearingKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return REDACTED_KEY_TERMS.some((term) => normalized.includes(term));
}
