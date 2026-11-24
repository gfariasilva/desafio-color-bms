import { describe, expect, it } from "vitest";
import { BACKUP_RETENTION_DAYS, backupsToDelete } from "./backup-retention";

/** color-AAAA-MM-DD_HHMM.db for a date and a time "HHMM". */
const name = (date: string, time = "1900") => `color-${date}_${time}.db`;

describe("RN-13: database backup retention", () => {
  const today = "2026-11-24";

  it("RN-13: keeps the backups of the last 30 days, today included", () => {
    expect(BACKUP_RETENTION_DAYS).toBe(30);
    // 26/10 is today − 29 (kept); 25/10 is today − 30 (out of the window).
    const names = [name("2026-11-24"), name("2026-11-01"), name("2026-10-26"), name("2026-10-25")];
    // 25/10 is not the last backup of October (26/10 is), so it goes.
    expect(backupsToDelete(names, today)).toEqual([name("2026-10-25")]);
  });

  it("RN-13: keeps at most one backup per day, the most recent of the day", () => {
    const names = [
      name("2026-11-20", "0805"),
      name("2026-11-20", "1903"),
      name("2026-11-20", "1210"),
      name("2026-11-24", "0800"),
    ];
    expect(backupsToDelete(names, today)).toEqual([
      name("2026-11-20", "0805"),
      name("2026-11-20", "1210"),
    ]);
  });

  it("RN-13: keeps the last backup of every month forever", () => {
    const names = [
      name("2025-01-03"),
      name("2025-01-31", "1800"),
      name("2025-01-31", "0900"),
      name("2026-02-27"),
      name("2026-02-28"),
      name("2026-09-15"),
      name("2026-09-30", "2359"),
    ];
    expect(backupsToDelete(names, today)).toEqual([
      name("2025-01-03"),
      name("2025-01-31", "0900"),
      name("2026-02-27"),
      name("2026-09-15"),
    ]);
  });

  it("RN-13: deletes the other backups older than 30 days", () => {
    const names = [
      name("2026-10-01"),
      name("2026-10-02"),
      name("2026-10-10"),
      name("2026-10-24"),
      name("2026-11-24"),
    ];
    // 24/10 is the last of October (kept); the others of October go.
    expect(backupsToDelete(names, today)).toEqual([
      name("2026-10-01"),
      name("2026-10-02"),
      name("2026-10-10"),
    ]);
  });

  it("RN-13: the window crosses a month and a year boundary", () => {
    // 01/01/2027 − 29 days = 03/12/2026.
    const names = [
      name("2026-12-02"),
      name("2026-12-03"),
      name("2026-12-31"),
      name("2027-01-01"),
      name("2026-11-30"),
      name("2026-11-29"),
    ];
    expect(backupsToDelete(names, "2027-01-01")).toEqual([name("2026-11-29"), name("2026-12-02")]);
  });

  it("RN-13: the current month's newest backup and today's are kept", () => {
    expect(
      backupsToDelete([name("2026-11-24", "0700"), name("2026-11-24", "1900")], today),
    ).toEqual([name("2026-11-24", "0700")]);
  });

  it("never deletes files that are not backups (temp files, other files)", () => {
    const names = [
      `${name("2020-01-01")}.tmp`,
      "desktop.ini",
      "Diária 2020-01-01.xlsx",
      "color-2020-02-30_1900.db",
    ];
    expect(backupsToDelete(names, today)).toEqual([]);
  });

  it("keeps backups dated after today (a wrong clock must not delete anything)", () => {
    const names = [name("2026-12-05", "0800"), name("2026-12-05", "0900"), name("2026-11-24")];
    expect(backupsToDelete(names, today)).toEqual([]);
  });

  it("an empty folder deletes nothing", () => {
    expect(backupsToDelete([], today)).toEqual([]);
  });
});
