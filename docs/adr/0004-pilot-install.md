# ADR 0004: Pilot install (zip + scripts, Node supervisor, hidden task, trial folder)

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-19 |
| **Deciders** | Project owner (developer) |
| **Related** | FR-34 / NFR-02, NFR-03, NFR-08, NFR-13 · ADR 0001, ADR 0003 · backlog #26, #24, #27 |

## Context

The pilot (M3) must run on the shop's Windows 11 PC before the Inno Setup installer (#24) exists. Backlog #26 asks for:

- a scripted install and update from a USB stick;
- start at logon without a window, plus a desktop shortcut;
- logs in `data\logs\`, rotated;
- a crashed server restarted, with the cause in the log;
- a separate trial data folder and a go-live reset;
- startup checks on the health page.

The developer works on Linux, and the owner has no technical knowledge (NFR-13). ADR 0001 already fixes the folders (`%LOCALAPPDATA%\ColorBMS\app` and `data`), Task Scheduler "At log on", and a portable, pinned `node.exe`. This ADR fixes how the pilot does it.

## Options considered

**Who restarts a crashed server**

| | **A. Our own Node supervisor (launcher)** | **B. Task Scheduler "restart on failure"** |
|---|---|---|
| How it works | The task starts `launcher.js`, which runs the server as a child process, writes its output to the log file, and restarts it with a growing delay (2 s → 60 s) | The task starts the server directly |
| Pros | Tested on any OS. Captures stderr, so the crash stack trace is in the log. Exit codes decide: 0 = stop, 3 = already running | Nothing to write |
| Cons | One more small process | Reacts to failures to *start*, not reliably to a non-zero exit. No log of a crash that happens before the logger exists |

**How to start Node without a window**

| | **A. `conhost.exe --headless`** | **B. VBScript `WshShell.Run …, 0`** | **C. `powershell -WindowStyle Hidden`** | **D. "Run whether user is logged on or not"** |
|---|---|---|---|---|
| Pros | No window at all; ships with Windows 10/11 | Classic | Simple | No window, runs as a background session |
| Cons | Not formally documented | VBScript is being removed from Windows 11 | A window flashes at every logon | Stores a password (or needs S4U and admin); non-interactive session |

**Where the logic lives:** thin ASCII `.cmd` files that call `app\node\node.exe app\server\dist\pilot\cli.js <command>`, rather than logic in batch or PowerShell. TypeScript can be tested on Linux, and every pt-BR message comes out right: Node writes to the console with the Windows wide-character API, so no code page issue.

**Production `node_modules`:** we copy the installed packages by walking the dependency graph, so the versions are exactly the lockfile's, and nothing is downloaded or compiled. The alternatives were rejected:

- `npm install --omit=dev` in a staging folder: it resolves transitive dependencies again, without the lock.
- Bundling everything with tsup: Fastify and pino plugins are not guaranteed to work bundled, and the E2E suite would not test that build.

**Trial data:** a separate `data-treino\` folder, chosen by `instalacao.json`. The alternative was to install into `data\` and rename it at go-live, but then trial backups would land in the real OneDrive `_backup-sistema`.

## Decision

- **Package:** `npm run package:pilot` builds `dist-pilot/color-bms-<version>.zip`, and it builds on any OS:
  - the server bundle with `dist/pilot/launcher.js` and `cli.js`, the migrations and the web build;
  - production `node_modules` copied as described above. better-sqlite3 keeps only `prebuilds/win32-x64.node`, without `build/`, `deps/` or `src/`: a binary compiled on the build machine would be loaded first;
  - `node.exe` from the official `node-v26.13.1-win-x64.zip`, with the version and SHA-256 pinned in `src/pilot/package.ts` and the download cached;
  - the `.cmd` files with CRLF line endings.

  The version is `apps/server/package.json`'s, so **bump it for each update**: Início and `atualizar.cmd` show it.
- **Hidden start:** a Task Scheduler task "Color BMS":
  - "At log on" for the owner, interactive token, least privilege: no admin rights and no password, and the OneDrive folder in the profile is reachable;
  - it runs `conhost.exe --headless node.exe launcher.js`;
  - no time limit, not stopped on battery, `IgnoreNew`, and RestartOnFailure for a launcher that fails to start.
- **Supervisor:** `launcher.js` (option A above):
  - one log file per São Paulo day, `<data>\logs\color-bms-AAAA-MM-DD.log`, keeping the newest 31 files;
  - synchronous writes, so the last lines before a crash are on disk.

  A server that finds port 3210 taken by another instance of this system exits with code 3 and the launcher stops. Taken by another program, the server logs which port and is retried.
- **Stop:** kill every process whose executable is the *installed* `node.exe`, using PowerShell `Get-CimInstance` (`wmic` is gone from Windows 11 24H2), but not the CLI's own process. That's safe for the data: WAL with `synchronous=FULL` (NFR-06).
- **Update:** stop → `app\` becomes `app.anterior\` → copy the new `app\` → start → wait for the new version on `/api/health` → open Início. The data folders are never touched, and the server backs up before migrating (#25, ADR 0003).
- **Trial and go-live:** `instalar.cmd` starts in trial mode (`data-treino\`; the launcher sets `COLOR_BMS_TRIAL=1`). In that mode there is no OneDrive backup, whatever `config.json` says, and the header shows **TREINO**. `iniciar-uso-real.cmd`:
  1. asks for **SIM**;
  2. refuses if a real database exists;
  3. moves `data-treino\` to `arquivo\data-treino-AAAA-MM-DD_HHMM\`;
  4. writes `data\config.json` with the OneDrive folder, using `JSON.stringify` so backslashes are escaped;
  5. switches to `data\`, where the first start creates a fresh database (seeds only).
- **Startup checks:** `GET /api/health` returns `checks`, which Início lists and the server also logs at startup:
  - PC time zone vs São Paulo;
  - PC clock earlier than the latest audit row, or than the build time;
  - port;
  - data folder writable;
  - OneDrive `_backup-sistema` writable.

## Consequences

### Positive
- Install, update, restart and go-live are tested on Linux, against fakes for the Windows calls (`apps/server/test/pilot-*.test.ts`). `npm run pilot:smoke` runs the real package end to end. On Windows, CI runs the real `.cmd` files (`pilot-windows` job).
- The owner sees problems on Início, and the developer finds the cause in one log file per day.
- #24 can keep the folders, the task and the launcher, and replace only the zip and scripts with Inno Setup.

### Negative / accepted trade-offs
- `conhost --headless` is not formally documented. Mitigation: the VM check in [`docs/pilot/install.md`](../pilot/install.md). If a window ever shows, fall back to option D.
- A forced stop instead of a graceful shutdown. That's safe with WAL, but the last log lines of a stopped server can be missing.
- `node_modules` is copied as installed, so the zip includes drizzle-orm's other dialects (~40 MB unzipped). That's acceptable for a USB stick.

### Follow-ups
- [x] #24: Inno Setup installer reusing these folders, the task and the CLI ([ADR 0006](0006-windows-installer.md)).
- [ ] Verify on a Windows 11 VM and on the shop PC (checklist in `docs/pilot/install.md`).
