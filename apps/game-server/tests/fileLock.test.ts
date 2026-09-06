import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLockTimeoutError, withFileLock } from "../src/fileLock.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dib-file-lock-"));
  directories.push(directory);
  return directory;
}

describe("withFileLock", () => {
  it("serializes overlapping read-modify-write operations on one path", async () => {
    const directory = await tempDir();
    const lockPath = join(directory, "registry.lock");
    const target = join(directory, "registry.json");
    await writeFile(target, JSON.stringify([]), "utf8");

    // Each holder reads the whole file, yields, then writes back: without the lock the later
    // writers would each overwrite a generation they read before the earlier ones landed, and the
    // file would end up with a single entry instead of all twenty.
    await Promise.all(Array.from({ length: 20 }, (_unused, index) =>
      withFileLock(lockPath, async () => {
        const entries = JSON.parse(await readFile(target, "utf8")) as number[];
        await new Promise((resolve) => setImmediate(resolve));
        await writeFile(target, JSON.stringify([...entries, index]), "utf8");
      })));

    const written = JSON.parse(await readFile(target, "utf8")) as number[];
    expect([...written].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_u, i) => i));
  });

  it("releases the lock file after the operation, including when it throws", async () => {
    const directory = await tempDir();
    const lockPath = join(directory, "registry.lock");

    await expect(withFileLock(lockPath, async () => {
      throw new Error("operation failed");
    })).rejects.toThrow("operation failed");

    // A held-open lock after a failed mutation would wedge every later writer until the staleness
    // window expired.
    expect(await readdir(directory)).toEqual([]);
    await expect(withFileLock(lockPath, async () => "acquired")).resolves.toBe("acquired");
  });

  it("times out rather than blocking forever on a lock a live holder still owns", async () => {
    const directory = await tempDir();
    const lockPath = join(directory, "registry.lock");
    await writeFile(lockPath, JSON.stringify({ pid: 1, acquiredAt: 1_000 }), "utf8");

    await expect(withFileLock(lockPath, async () => "unreachable", {
      now: () => 1_000,
      staleMs: 30_000,
      timeoutMs: 0,
    })).rejects.toBeInstanceOf(FileLockTimeoutError);
  });

  it("breaks a lock whose holder went silent past the staleness window", async () => {
    const directory = await tempDir();
    const lockPath = join(directory, "registry.lock");
    await writeFile(lockPath, JSON.stringify({ pid: 1, acquiredAt: 1_000 }), "utf8");

    await expect(withFileLock(lockPath, async () => "reclaimed", {
      now: () => 31_001,
      staleMs: 30_000,
      timeoutMs: 0,
    })).resolves.toBe("reclaimed");
  });

  it("treats an unparseable lock as a dead holder's leftovers", async () => {
    const directory = await tempDir();
    const lockPath = join(directory, "registry.lock");
    await writeFile(lockPath, "{ truncated mid-write", "utf8");

    await expect(withFileLock(lockPath, async () => "reclaimed", { timeoutMs: 0 }))
      .resolves.toBe("reclaimed");
  });

  it("leaves no probe files behind in the locked directory", async () => {
    const directory = await tempDir();
    const lockPath = join(directory, "registry.lock");

    // `tryAcquire` may write a probe to tell a Windows delete-pending sharing violation apart from
    // an unwritable directory. Whether or not this run takes that branch, the registry directory
    // must contain nothing but what the caller put there.
    await Promise.all(Array.from({ length: 30 }, () =>
      withFileLock(lockPath, async () => {
        await new Promise((resolve) => setImmediate(resolve));
      })));

    expect(await readdir(directory)).toEqual([]);
  });
});
