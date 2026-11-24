# ADR 0005: Database backups in the export queue, and restore by an in-process restart

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-24 |
| **Deciders** | Project owner (developer) |
| **Related** | Spec §2, §7.4 / FR-18, FR-30, FR-31, FR-32 / RN-13 / NFR-06, NFR-07 · ADR 0001, 0003, 0004 · backlog #22 |

## Context

The pilot backup (#25, ADR 0003) writes a `VACUUM INTO` copy of the database to `<OneDrive>/_backup-sistema/` after each day closing and on the first start of the day. It keeps its last failure in memory only, so a failure is forgotten after a restart, and it has no retention. Backlog #22 completes FR-31 and FR-32:

- FR-31: a backup also on month closing; RN-13 retention; "uma falha no backup segue a mesma fila e o mesmo alerta de FR-30".
- FR-32: from a list (date and time), with a confirmation and a reason: save a safety copy of the current database, replace it with the chosen backup, **restart**, and audit the restore. On a new PC, the owner points to a backup file and the system returns exactly to that state.

A SQLite file cannot be replaced safely while it is open, and the whole app (every route, the export queue, timers) holds the open connection. The server runs under the pilot launcher (ADR 0004) on the shop PC, under `tsx watch` in development, and as a plain `node dist/main.js` in the E2E tests.

## Options considered

How the restart happens:

| | **A. In-process restart** | **B. Exit and let the launcher start it again** | **C. Swap the connection in place** |
|---|---|---|---|
| How it works | `main.ts` closes the app and the database, swaps the file, opens, migrates and listens again on the same port | The server exits with a special code; the launcher (#26) restarts it, and the swap happens at startup | Close and reopen the connection under the running app |
| Pros | Works the same in dev, E2E and on the shop PC; no launcher change | The process starts truly fresh | No downtime |
| Cons | The process is not new (module state is kept) | Nothing restarts it in dev or E2E; a launcher bug means no system | Every module holds `connection`; queue items and in-flight requests would see two databases |
| Fit | Good | Only on the shop PC | Too risky |

How a backup failure reaches the FR-30 queue:

- **A. A `db_backup` item of `export_queue`** (chosen): the queue already persists failures, retries every 5 minutes, at startup, on a new folder and on "Tentar agora", and feeds "Backup pendente".
- B. Keep the in-memory status and mirror failures into the queue: two sources of truth.

## Decision

We choose **an in-process restart** and **backups as export queue items**.

**Backups (FR-31, RN-13)**
- Day closing, month closing and the first start of the day (at startup and every hour) queue a `db_backup` item. The queue writes it with `writeOneDriveBackup()` (`VACUUM INTO` → `.tmp` → fsync → rename, as in ADR 0003), then deletes what `backupsToDelete()` (core, RN-13) returns. A file that cannot be deleted is only logged.
- There is at most **one open backup item**: a new request reuses it (with the new day as its reference), because a backup always copies the database as it is when written.
- The queue writes backups **before** spreadsheets, so a slow OneDrive or a file open in Excel never delays them.
- "Último backup" comes from the newest file name in `_backup-sistema/`. The in-memory backup service of #25 is removed.

**Restore (FR-32)**, in three steps guided by the marker `<data>/restore/pending.json`:
1. **Request** (`POST /api/backup/restore`): the chosen backup (OneDrive, `data\backups\`, or a file sent with `PUT /api/backup/upload`) is copied to `<data>/restore/incoming.db` and checked read-only:
   - it is a SQLite file with the Color tables;
   - `quick_check` is ok;
   - it has no migration newer than the app's.

   Then the marker is written, the server answers `202`, and `main.ts` restarts.
2. **Restart, before the database is opened** (`applyPendingRestore`):
   - a safety copy of the current database goes to `data\backups\`. It never overwrites a file; the marker records it;
   - leftover `color.db-wal`/`-shm` files are deleted, because an old WAL replayed onto the restored file would corrupt it;
   - `incoming.db` is renamed over `color.db`, and the marker is updated.

   If any of this fails, the staged files are dropped, the current database stays, and the result says so in pt-BR.
3. **Once opened and migrated** (`finishRestore`): the audit row (`backup` / `restore`, with the reason) goes into the **restored** database, and the marker is removed. A crash at any step is finished at the next start.
- The pre-migration backup (#25) is skipped right after a restore: the restored file itself is that copy. Skipping it also keeps the backup from replacing the safety copy written in the same minute.
- Each start has a new `startId` (`GET /api/backup/status`). The page waits for a new one, then reloads its data and shows `lastRestore`.

## Consequences

### Positive
- One queue, one alert and one retry policy for every file written to OneDrive (CLAUDE.md convention). A failed backup survives restarts.
- The same restore code runs in tests (`openAppDatabase` + `buildApp`), in E2E against the built server, and on the shop PC.
- A restore can always be undone: the safety copy is listed under "Este PC".

### Negative / accepted trade-offs
- The restore's audit row is not in the same transaction as the change: a file swap has no transaction. It is written right after the swap, and the marker makes it happen exactly once.
- The audit history of the replaced database survives only in the safety copy.
- An in-process restart keeps module-level state. Nothing in the server keeps business state outside the database, and the timers are cleared before the restart.
- An upload is read into memory (at most 512 MB). The database is a few MB.

### Follow-ups
- [ ] NFR-07: test the restore from the screen on the shop PC (and with the installer, #24).
- [ ] RN-13 is applied to the OneDrive folder only; `data\backups\` (pre-migration copies, safety copies) grows by one small file per update or restore. Revisit with #24.
