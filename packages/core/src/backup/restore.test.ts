import { describe, expect, it } from "vitest";
import {
  BACKUP_RESTORE_REASON_MAX,
  backupListResponseSchema,
  describeBackupFile,
  restoreRequestSchema,
} from "./restore";

describe("FR-32: restore request", () => {
  it("FR-32: the reason is required and trimmed", () => {
    expect(
      restoreRequestSchema.parse({
        source: "onedrive",
        name: "color-2026-11-18_1903.db",
        reason: "  disco com defeito ",
      }),
    ).toEqual({
      source: "onedrive",
      name: "color-2026-11-18_1903.db",
      reason: "disco com defeito",
    });
    for (const reason of [undefined, "", "   "]) {
      const result = restoreRequestSchema.safeParse({
        source: "onedrive",
        name: "color-2026-11-18_1903.db",
        reason,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Informe o motivo da restauração.");
    }
  });

  it("FR-32: the reason has a maximum length", () => {
    const base = { source: "local", name: "color-2026-11-18_1903.db" } as const;
    expect(
      restoreRequestSchema.safeParse({ ...base, reason: "a".repeat(BACKUP_RESTORE_REASON_MAX) })
        .success,
    ).toBe(true);
    expect(
      restoreRequestSchema.safeParse({ ...base, reason: "a".repeat(BACKUP_RESTORE_REASON_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it("FR-32: a backup from the list must be a backup file name (no paths)", () => {
    for (const name of ["../color.db", "color-2026-11-18_1903.db.tmp", "C:\\x\\color.db", ""]) {
      const result = restoreRequestSchema.safeParse({ source: "onedrive", name, reason: "x" });
      expect(result.success, name).toBe(false);
    }
  });

  it("FR-32: an uploaded file needs no name", () => {
    expect(restoreRequestSchema.parse({ source: "upload", reason: "PC novo" })).toEqual({
      source: "upload",
      reason: "PC novo",
    });
  });
});

describe("FR-32: list of backups", () => {
  it("FR-32: describes a backup by its date and time in São Paulo", () => {
    expect(describeBackupFile("onedrive", "color-2026-11-18_1903.db", 4096)).toEqual({
      source: "onedrive",
      name: "color-2026-11-18_1903.db",
      date: "2026-11-18",
      time: "19:03",
      // 19:03 in São Paulo = 22:03 UTC.
      at: "2026-11-18T22:03:00.000Z",
      sizeBytes: 4096,
    });
    expect(describeBackupFile("local", "desktop.ini", 1)).toBeNull();
  });

  it("parses the list response", () => {
    expect(
      backupListResponseSchema.parse({
        oneDriveFolder: null,
        localFolder: "C:\\dados\\backups",
        backups: [],
      }),
    ).toEqual({ oneDriveFolder: null, localFolder: "C:\\dados\\backups", backups: [] });
  });
});
