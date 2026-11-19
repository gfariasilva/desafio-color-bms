import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { folderTestMessage, folderTestOkMessage, type FolderTestResponse } from "@color-bms/core";

/**
 * FR-33 "Testar": creates a small file in the folder, flushes it to disk and deletes it, so the
 * owner knows the backups and spreadsheets can be written there. Never creates the folder
 * itself (a missing one is a wrong path or OneDrive not set up, spec §7.4). Never throws.
 */
export function testFolderWrite(folder: string): FolderTestResponse {
  try {
    const stat = fs.statSync(folder, { throwIfNoEntry: false });
    if (!stat) return failure("ENOENT", folder);
    if (!stat.isDirectory()) return failure("ENOTDIR", folder);

    // A hidden-ish, unique name: never clashes with a real file, even with two tests at once.
    const file = path.join(folder, `.color-bms-teste-${randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(file, "wx");
      try {
        fs.writeSync(fd, "Teste de gravação do sistema Color. Pode apagar este arquivo.\n");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } finally {
      removeTestFile(file);
    }
    return { ok: true, message: folderTestOkMessage(folder) };
  } catch (error) {
    return failure((error as NodeJS.ErrnoException).code, folder);
  }
}

/**
 * Deletes the test file. The OneDrive client may hold a new file for a moment (EBUSY/EPERM), so
 * retry briefly; if it still fails, the write already worked: keep the result and log it.
 */
function removeTestFile(file: string): void {
  try {
    fs.rmSync(file, { force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    console.warn(`Could not delete the folder test file ${file}: ${(error as Error).message}`);
  }
}

function failure(code: string | undefined, folder: string): FolderTestResponse {
  return { ok: false, message: folderTestMessage(code, folder) };
}
