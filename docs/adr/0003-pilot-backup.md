# ADR 0003: Pilot database backup (triggers, folder setting, backup before migrations)

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-19 |
| **Deciders** | Project owner (developer) |
| **Related** | Spec §7.2, §7.4 / FR-31, FR-32 / NFR-06, NFR-07 · ADR 0001 · backlog #25, #20, #22 |

## Context

The pilot (M3) runs on the shop PC from its first day, and every pilot update brings migrations. Backlog #25 asks for an automatic backup instead of manual copies: on every day close, on the first start of the day, and before migrations. The full FR-31 (retention RN-13, the FR-30 retry queue, restore from the UI) comes with #22. The Settings screen (#20), where the OneDrive folder is normally set, comes later too. ADR 0001 already says how a backup is made: `VACUUM INTO` a temp file, then rename. This ADR fixes the remaining choices.

## Options considered

| | **A. In-memory status, folder from a config file** | **B. Status table + Settings now** | **C. Manual copies (no code)** |
|---|---|---|---|
| How it works | `config.json` in the data folder (or env var) gives the folder; the latest result lives in memory; the file names in `_backup-sistema/` tell what exists | A new table for backup attempts; build part of #20 for the folder | Copy `color.db` by hand |
| Pros | No migration; small; #20 and #22 replace it cleanly | Status survives restarts | Nothing to build |
| Cons | A failure notice disappears after a restart | Builds #20/#22 early; a migration for throw-away state | Easy to forget; copying a live WAL database can give a broken file |
| Fit | Good for the pilot | Too early | Fails NFR-06 |

## Decision

We choose **Option A**.

- **Folder:** `COLOR_BMS_ONEDRIVE_DIR` takes precedence. Otherwise `oneDriveFolder` comes from `<dataDir>/config.json`. A broken file is ignored with a warning, never a crash. With neither set, nothing is backed up and Início says so. #20 moves the setting into the `settings` table.
- **Name and place:** `<pasta>/_backup-sistema/color-AAAA-MM-DD_HHMM.db` in São Paulo time (`backupFileName()` in core). The OneDrive root is never created, because a missing root means a wrong setting. Only `_backup-sistema` is created.
- **Triggers:**
  - After every day close, chained before `onDayClosed`.
  - At startup, when no file of today exists. The file names are the only record of what exists, so no table is needed.
- **Before migrations:** when the database has applied migrations and some are pending, a backup goes to `<dataDir>/backups/` first. That's the local disk, so an update never depends on OneDrive. If it fails, nothing is migrated and the server exits with the reason.
- **Status:** kept in memory and exposed by `GET /api/backup/status` for Início. A later success clears a failure. At startup the newest file seeds "Último backup".

## Consequences

### Positive
- No schema change; #22 can add retention and the queue on top of `writeBackup()`.
- Every pilot update can be undone by restoring the local pre-migration copy.

### Negative / accepted trade-offs
- A failed day-close backup is forgotten on restart if today already has a startup backup. Mitigation: the next day close or the next day's first start tries again, and #22 adds the persistent queue.
- `VACUUM INTO` runs on the event loop. That's fine for a small database. Revisit if backups take more than about 1 s.

### Follow-ups
- [x] #20: migrate `config.json`'s `oneDriveFolder` into `settings` (imported once on start; `COLOR_BMS_ONEDRIVE_DIR` still overrides, for dev and E2E).
- [x] #22: RN-13 retention, the FR-30 queue, a backup on month close, restore UI ([ADR 0005](0005-backup-queue-and-restore.md)).
