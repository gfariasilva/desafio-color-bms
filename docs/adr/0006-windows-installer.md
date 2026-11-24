# ADR 0006: Windows installer (Inno Setup as a carrier for the pilot CLI)

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-24 |
| **Deciders** | Project owner (developer) |
| **Related** | FR-34 / NFR-02, NFR-03, NFR-07, NFR-13 · ADR 0001, ADR 0003, ADR 0004, ADR 0005 · backlog #24, #26 |

## Context

ADR 0001 chose an **Inno Setup** installer for the shop PC, built on Windows only. The pilot (#26, ADR 0004) shipped first with a zip and thin `.cmd` scripts that call `cli.js` (tested TypeScript): install, update, start, stop and the go-live reset, with a Node supervisor started hidden by a Task Scheduler task at logon.

Backlog #24 asks for:

- the installer, with the same folders (`%LOCALAPPDATA%\ColorBMS\app` and `data`);
- the logon task and the desktop shortcut;
- an upgrade path from the pilot install and an update path that keep the data, with a backup before migrations;
- a release workflow on `windows-latest`;
- a deployment checklist.

#22 left one more decision for #24: whether `data\backups\` (pre-migration and safety copies) gets a retention rule.

The developer works on Linux and cannot run Inno Setup there. Only CI on Windows, or a Windows PC, can build and test the installer.

## Options considered

**What the installer does**

| | **A. Carrier: unpack to `{tmp}`, run `cli.js instalador`** | **B. Inno owns `app\`: Pascal stops the old app, Inno copies files, the CLI registers the task** |
|---|---|---|
| How it works | Setup.exe unpacks the package (the pilot package folder) to `{tmp}\pacote` and runs its own `node.exe cli.js instalador`, which calls the pilot's `install()` or `update()` | `PrepareToInstall` (Pascal) runs the old `parar`, renames `app` → `app.anterior`; `[Files]` copies the new `app\`; then the CLI registers the task and starts |
| Pros | All the logic (stop, swap, rollback message, task, shortcut, start, wait for the new version) is the pilot's, already tested on Linux and on Windows CI. The Pascal code is ~40 lines. Nothing of the running app is locked during the copy. | Inno's uninstaller tracks every file; no second copy on disk during the install |
| Cons | The package is on disk twice during the install (~150 MB, in `{tmp}`, deleted at the end); the uninstaller must delete `app\` with `[UninstallDelete]` | The stop and swap logic moves to Pascal, which can't be tested on Linux; two places own the install |

**Who owns the shortcuts:** the CLI keeps making the desktop shortcut (Edge in app mode, found in the registry), as in the pilot. Inno only adds Start Menu entries for the support scripts. A pilot shortcut is simply overwritten.

**Local backups retention (`data\backups\`)**

| | **Keep everything** | **RN-13 also locally** | **Keep the newest N** |
|---|---|---|---|
| Pros | Every pre-migration and safety copy stays, so any update or restore can be undone | Same rule everywhere | Bounded disk use |
| Cons | Grows by one file per update or restore | At most 1 per day: a same-day update and restore would lose a copy | Arbitrary N; may drop the copy from before a restore |

Options rejected early:

- **MSI / WiX:** heavier tooling, and an installer that only writes to the user profile gains nothing from MSI.
- **A Windows service:** rejected by ADR 0001 (wrong account for the OneDrive folder).
- **Building the installer on Linux** with Inno Setup under Wine: possible (a Docker image exists), but ADR 0001 already says releases are built on Windows, and CI does it.

## Decision

**Option A.** The installer is a carrier for the pilot package. The CLI keeps all the logic (ADR 0004).

- **Script:** `installer/color-bms.iss` (UTF-8 with BOM, CRLF), compiled by `npm run package:installer`:
  1. it builds the pilot package folder (`dist-pilot/color-bms-<version>/`, plus the zip);
  2. it runs `ISCC.exe` with `/DAppVersion /DPackageDir /DOutputDir`;
  3. the output is `dist-installer/ColorBMS-Setup-<version>.exe`.

  `ISCC.exe` is found from `COLOR_BMS_ISCC`, or in the Inno Setup 6 folders.
- **Setup:**
  - `PrivilegesRequired=lowest` (no admin rights), `DefaultDirName={localappdata}\ColorBMS` with the folder page hidden, pt-BR wizard;
  - a fixed `AppId`, so a new version updates the installed one;
  - `CloseApplications=no`.
- **Install and update:** after the copy, `cli.js instalador --raiz={app} --registro={app}\instalador.log` (hidden):
  - **no `app\`** → `install()`: trial mode, but the mode in `instalacao.json` (or an existing `data\`) is kept, so a reinstall never hides real data;
  - **`app\` exists** (the pilot, or an older installer) → `update()`: copy to `app.novo`, stop, swap, keep `app.anterior`, re-register the task, start, and wait for the new version on `/api/health`. The server backs up before migrating (#25, ADR 0003).

  An **older** installer never replaces a newer installed version (the database may already be migrated): it stops with a message, unless `Setup.exe /PERMITIRVERSAOANTERIOR=1` (`--permitir-versao-anterior`) asks for it.

  If the CLI fails, a message box points to the log, the last page says the installation did not finish, and Setup.exe exits with code **9** (`GetCustomSetupExitCode`), so CI sees it.
- **Upgrade from the pilot:** nothing special. The folders, the task name ("Color BMS") and the shortcut are the same, and they are overwritten. The pilot's `instalar.cmd` and `atualizar.cmd` only ever lived on the USB stick.
- **Start Menu (Sistema Color):** Iniciar, Parar, Começar o uso real (the support `.cmd` files, installed next to `app\`), Leia-me and Desinstalar.
- **Uninstall:**
  1. `CurUninstallStepChanged(usUninstall)` runs `cli.js desinstalar`: it stops the system, deletes the logon task and the desktop shortcut (the task even if the stop fails). The uninstaller then deletes the task again with `schtasks`, so that never depends on `node.exe`, and warns the owner when the system could not be stopped;
  2. Inno then deletes `app\`, `app.anterior\`, `app.novo\` and `instalador.log`;
  3. **`data\`, `data-treino\`, `arquivo\` and `instalacao.json` are always kept.**
- **Release:** `.github/workflows/release.yml` on `windows-latest`, for a tag `vX.Y.Z`, which must equal `apps/server/package.json`:
  1. build the installer;
  2. run `npm run installer:smoke`;
  3. publish the `.exe` and the zip on the GitHub release.

  The `installer-windows` CI job builds and smoke-tests it on every PR.
- **The zip stays** (`npm run package:pilot`): it is the installer's input, the only package the developer can build on Linux, and a fallback. The installer is the main path.
- **pt-BR texts:** the installer's own texts (Start Menu names, the error boxes, the failure page) are all in the `.iss` `[CustomMessages]` section, an exception to "pt-BR messages in `src/pilot/`" (CLAUDE.md); the rest of the `.iss` is ASCII, which the contract test checks.
- **Not signed.** Windows SmartScreen shows "O Windows protegeu o computador" the first time; the developer clicks "Mais informações › Executar assim mesmo" (the developer installs, NFR-13).
- **Local backups:** **keep everything** in `data\backups\`. A copy is a few MB, made once per update (weekly at most) or restore, and these copies are what lets an update or a restore be undone. Revisit if the folder passes ~1 GB. RN-13 stays on the OneDrive folder only.

## Consequences

### Positive
- One `.exe` to install, update, upgrade from the pilot, and reinstall on a new PC (NFR-13), with the same tested logic as the pilot.
- The whole cycle runs for real in Windows CI: install → crash → update → go-live → uninstall with data kept → reinstall.
- Uninstalling never deletes data, and a reinstall comes back in the same mode with the same data.

### Negative / accepted trade-offs
- The `.iss` cannot be compiled on Linux here: it is checked by a contract test (`apps/server/test/installer.test.ts`), and compiled and run only in Windows CI.
- No code signing: one SmartScreen click per install or update.
- Logon without a window, the Edge shortcut, offline use and no LAN access still need the manual VM and shop PC check (`docs/install/installer.md` §6).
- `data\backups\` grows without limit (see above).

### Follow-ups
- [ ] Run the acceptance check on a Windows 11 VM and on the shop PC, including the restore test with the installer (NFR-07).
- [ ] Code signing, if SmartScreen becomes a problem.
- [ ] Revisit the `data\backups\` retention if it grows.
