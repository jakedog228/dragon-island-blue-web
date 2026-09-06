import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes a file so that a crash or power loss leaves either the previous contents or the new
 * contents, never a blend of the two.
 *
 * The sequence is temp-file → fsync(file) → rename → fsync(directory). The final directory sync is
 * the step that is easy to omit and quietly matters: `rename()` is atomic with respect to *readers*
 * on POSIX, but the directory entry it creates lives in the page cache like any other write. Losing
 * power after the rename returns can therefore lose the rename itself, resurrecting the old file
 * even though the new contents were durably on disk. Syncing the directory is what makes the
 * replacement survive the failure this whole dance exists for.
 *
 * `flag: "wx"` on the temp file makes collision an error rather than a silent overwrite; the name
 * already carries the pid and a uuid, so a collision would mean something is badly wrong.
 */
export async function durableWriteFile(path: string, body: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body, { encoding: "utf8", flag: "wx" });
    const handle = await open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await syncDirectory(directory);
  } finally {
    // The rename consumed the temp file on the success path; this only cleans up after a failure.
    await rm(temporary, { force: true });
  }
}

/**
 * Flushes a directory's own metadata.
 *
 * Not portable, and deliberately best-effort: Windows has no directory handle you can fsync and
 * rejects the open outright, and some filesystems refuse a read handle on a directory. None of
 * those failures mean the data is lost — the file contents were already synced and the rename
 * already applied — so refusing to complete the write over them would trade a durability nicety
 * for an outage. Any real durability problem surfaces on the file sync above, which is not
 * swallowed.
 */
async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
  } catch {
    return;
  }
  try {
    await handle.sync();
  } catch {
    // Ignored for the reasons above.
  } finally {
    await handle.close();
  }
}
