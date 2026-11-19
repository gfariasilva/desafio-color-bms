import { describe, expect, it } from "vitest";
import {
  BACKUP_FOLDER_NAME,
  backupFileName,
  backupStatusResponseSchema,
  hasBackupOn,
  latestBackupFile,
  parseBackupFileName,
} from "./backup-files";

describe("FR-31 (#25): backup file names (spec §7.2)", () => {
  it("FR-31: backup file name is color-AAAA-MM-DD_HHMM.db in São Paulo time", () => {
    // 22:03Z = 19:03 in São Paulo (UTC−3), the spec §7.2 example.
    expect(backupFileName(new Date("2026-11-18T22:03:00.000Z"))).toBe("color-2026-11-18_1903.db");
  });

  it("RN-15: around midnight the date is São Paulo's, not UTC's", () => {
    // 01:30Z on the 19th is still 22:30 on the 18th in São Paulo.
    expect(backupFileName(new Date("2026-11-19T01:30:00.000Z"))).toBe("color-2026-11-18_2230.db");
    // 03:00Z on the 19th is exactly 00:00 on the 19th in São Paulo.
    expect(backupFileName(new Date("2026-11-19T03:00:00.000Z"))).toBe("color-2026-11-19_0000.db");
  });

  it("uses the folder name of spec §7.2", () => {
    expect(BACKUP_FOLDER_NAME).toBe("_backup-sistema");
  });

  it("parseBackupFileName accepts only color-AAAA-MM-DD_HHMM.db", () => {
    expect(parseBackupFileName("color-2026-11-18_1903.db")).toEqual({
      date: "2026-11-18",
      time: "19:03",
    });
    expect(parseBackupFileName("color-2026-11-18_1903.db.tmp")).toBeNull();
    expect(parseBackupFileName("color-2026-02-30_1903.db")).toBeNull();
    expect(parseBackupFileName("color-2026-11-18_2460.db")).toBeNull();
    expect(parseBackupFileName("Diária 2026-11-18.xlsx")).toBeNull();
    expect(parseBackupFileName("desktop.ini")).toBeNull();
  });

  it("FR-31: hasBackupOn finds a backup of the given day (first start of the day)", () => {
    const names = ["color-2026-11-17_1903.db", "color-2026-11-18_0805.db.tmp", "notes.txt"];
    expect(hasBackupOn(names, "2026-11-17")).toBe(true);
    // A leftover temp file is not a backup.
    expect(hasBackupOn(names, "2026-11-18")).toBe(false);
    expect(hasBackupOn([], "2026-11-18")).toBe(false);
  });

  it("latestBackupFile picks the newest backup by date and time", () => {
    expect(
      latestBackupFile([
        "color-2026-11-18_0805.db",
        "color-2026-11-18_1903.db",
        "color-2026-11-17_2359.db",
        "color-2026-11-19_0000.db.tmp",
        "other.db",
      ]),
    ).toBe("color-2026-11-18_1903.db");
    expect(latestBackupFile(["other.db"])).toBeNull();
  });

  it("the status schema accepts a never-configured backup", () => {
    expect(
      backupStatusResponseSchema.parse({
        configured: false,
        folder: null,
        lastSuccess: null,
        lastFailure: null,
      }),
    ).toEqual({ configured: false, folder: null, lastSuccess: null, lastFailure: null });
  });
});
