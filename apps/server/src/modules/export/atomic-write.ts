import fs from "node:fs";

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
    // "w" replaces a temp file left by an earlier crash.
    const fd = fs.openSync(tempFile, "w");
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(tempFile, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EBUSY") {
        throw Object.assign(error as Error, { code: "EBUSY" });
      }
      throw error;
    }
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
}
