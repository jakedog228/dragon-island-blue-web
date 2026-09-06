import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Advisory cross-process lock around a read-modify-write of a shared file.
 *
 * An in-process promise queue is enough while one server owns the registry, but `docs/deployment.md`
 * documents running `invite` and `invite:revoke` against a *live* server. Those are separate
 * processes with separate queues: both can read the same generation and the second write silently
 * discards the first one's entry. This closes that window.
 *
 * `flag: "wx"` is the whole mechanism -- `O_CREAT | O_EXCL` is atomic on POSIX and on Windows, so
 * exactly one contender creates the file and everyone else retries. The lock is advisory: it binds
 * only the writers that take it, which here is every mutator in `invites.ts`.
 */

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_MS = 25;

export interface FileLockOptions {
  /** A lock whose holder has been silent this long is presumed dead and broken. */
  readonly staleMs?: number;
  /** How long to keep retrying before giving up rather than blocking a request forever. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export class FileLockTimeoutError extends Error {
  constructor(path: string) {
    super(`timed out waiting for the lock at ${path}`);
    this.name = "FileLockTimeoutError";
  }
}

export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;

  await mkdir(dirname(lockPath), { recursive: true });
  for (;;) {
    if (await tryAcquire(lockPath, now)) break;
    if (await breakIfStale(lockPath, staleMs, now)) continue;
    if (now() >= deadline) throw new FileLockTimeoutError(lockPath);
    await delay(RETRY_MS);
  }

  try {
    return await operation();
  } finally {
    // Best-effort release. A failure here leaves a lock that the staleness rule collects, which is
    // strictly better than letting an unlink error mask the operation's own result.
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

async function tryAcquire(lockPath: string, now: () => number): Promise<boolean> {
  try {
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: now() }),
      { encoding: "utf8", flag: "wx" },
    );
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    if (code === "EPERM" || code === "EACCES") {
      // Windows can report a sharing violation as EPERM rather than EEXIST while another process
      // owns the O_EXCL lock file, so an EPERM over a lock that is still there is plain contention.
      if (await pathExists(lockPath)) return false;
      // The lock can also be GONE by the time we look: Windows keeps a file the holder just
      // unlinked in a "delete pending" state where creating the same name still fails, and the
      // delete completes before our check. That transient race is contention too -- it is only
      // distinguishable from an unwritable directory by asking whether the directory takes writes
      // at all. Failing loudly there stays important: a misconfigured data directory must not be
      // laundered into a ten-second lock timeout.
      if (await directoryAcceptsWrites(dirname(lockPath))) return false;
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    // A stat that is itself refused means something occupies the name and is being held by
    // someone else, which is the answer this caller asked for.
    if (code === "EPERM" || code === "EACCES") return true;
    throw error;
  }
}

/** Separates "someone else holds this name right now" from "this directory rejects writes". */
async function directoryAcceptsWrites(directory: string): Promise<boolean> {
  const probe = join(directory, `.lock-probe-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(probe, "", { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    return false;
  } finally {
    await rm(probe, { force: true }).catch(() => undefined);
  }
}

/**
 * Reclaims a lock left behind by a process that was killed mid-write.
 *
 * The holder's timestamp is read from the lock itself rather than from the file's mtime, because a
 * backup or sync tool touching the directory would otherwise keep a dead lock looking alive. An
 * unparseable or unreadable lock is treated as stale: it cannot have been written by a healthy
 * holder of this version.
 */
async function breakIfStale(
  lockPath: string,
  staleMs: number,
  now: () => number,
): Promise<boolean> {
  let acquiredAt: number | undefined;
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { acquiredAt?: unknown };
    acquiredAt = typeof parsed.acquiredAt === "number" ? parsed.acquiredAt : undefined;
  } catch (error) {
    // The holder released it between our failed acquire and this read: just retry the acquire.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return true;
    // A Windows sharing violation means the holder is still actively using the file, not that an
    // unreadable/corrupt dead lock has been proved. Wait and retry instead of breaking ownership.
    if (code === "EPERM" || code === "EACCES") return false;
    acquiredAt = undefined;
  }
  if (acquiredAt !== undefined && now() - acquiredAt < staleMs) return false;
  await rm(lockPath, { force: true }).catch(() => undefined);
  return true;
}
