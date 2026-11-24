import { addDays, type CivilDate } from "../time/civil-date";
import { parseBackupFileName } from "./backup-files";

/** RN-13: the days (today included) whose newest backup is always kept. */
export const BACKUP_RETENTION_DAYS = 30;

/**
 * RN-13: which backup files to delete from `_backup-sistema/` after a new backup.
 *
 * - Keep the backups of the **last 30 days** (today and the 29 days before, in São Paulo),
 *   at most 1 per day: the most recent of the day.
 * - Also keep the **last backup of each month**, with no time limit.
 * - Delete the others.
 *
 * Files that are not backups (`.tmp`, `desktop.ini`…) are never returned, nor backups dated
 * after `today` (a wrong clock must never delete anything). Returns the names, sorted.
 *
 * @example backupsToDelete(["color-2026-11-20_0805.db", "color-2026-11-20_1903.db"], "2026-11-24")
 *   // ["color-2026-11-20_0805.db"]
 */
export function backupsToDelete(names: readonly string[], today: CivilDate): string[] {
  const windowStart = addDays(today, -(BACKUP_RETENTION_DAYS - 1));
  // The name sorts in time order (color-YYYY-MM-DD_HHMM.db), so the newest of a group is the
  // last one seen in sorted order.
  const backups = names
    .map((name) => ({ name, parsed: parseBackupFileName(name) }))
    .filter((b): b is { name: string; parsed: NonNullable<typeof b.parsed> } => b.parsed !== null)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const newestOfDay = new Map<CivilDate, string>();
  const newestOfMonth = new Map<string, string>();
  for (const { name, parsed } of backups) {
    newestOfDay.set(parsed.date, name);
    newestOfMonth.set(parsed.date.slice(0, 7), name);
  }

  const keep = new Set<string>(newestOfMonth.values());
  for (const [date, name] of newestOfDay) {
    if (date >= windowStart) keep.add(name);
  }
  return backups
    .filter(({ name, parsed }) => parsed.date <= today && !keep.has(name))
    .map(({ name }) => name);
}
