import fs from "node:fs";

/** EPERM/EBUSY on the file (or its temp file) means "in use" on Windows: report it as EBUSY. */
function asInUse(error: unknown): unknown {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EBUSY"
    ? Object.assign(error as Error, { code: "EBUSY" })
    : error;
}

/**
 * Spec §7.4 (power cut during a write): writes `data` to `file` atomically. The bytes go to
 * `<file>.tmp` in the same folder, are flushed to disk (fsync), and only then is the temp file
 * renamed over `file`. A power cut leaves either the old file or the new one, never half a
 * spreadsheet. The folder must exist.
 *
 * On Windows, renaming over a file that Excel has open (or OneDrive is syncing) fails with
 * EPERM or EBUSY: both are reported as `code: "EBUSY"` ("file in use"), the old file is kept
 * and the temp file removed. Throws on any failure; the export queue (FR-30) retries.
 */
export function writeFileAtomic(file: string, data: Uint8Array): void {
  const tempFile = `${file}.tmp`;
  try {
    // "w" replaces a temp file left by an earlier crash. A leftover temp file held by OneDrive
    // or an antivirus fails with EPERM/EBUSY: a transient lock, not a folder problem.
    let fd: number;
    try {
      fd = fs.openSync(tempFile, "w");
    } catch (error) {
      throw asInUse(error);
    }
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(tempFile, file);
    } catch (error) {
      throw asInUse(error);
    }
  } catch (error) {
    try {
      fs.rmSync(tempFile, { force: true });
    } catch {
      // A temp file still locked is replaced by the next try ("w").
    }
    throw error;
  }
}
