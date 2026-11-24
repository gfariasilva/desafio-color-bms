# Windows installer (#24, FR-34)

For the developer. How to build the installer, install, update, upgrade the pilot, uninstall, and set up a new PC from a backup. The decisions are in [ADR 0006](../adr/0006-windows-installer.md). The installer replaces the pilot zip and scripts ([`docs/pilot/install.md`](../pilot/install.md)), which stay as a fallback. Both use the same folders, task, launcher and data.

Updates stay physical: the `.exe` goes to the shop on a USB stick.

## 1. Build the installer

1. Bump `version` in `apps/server/package.json` (x.y.z). Início and Windows › Aplicativos show it.
2. Build it **on Windows** (ADR 0001):

   - **In CI (from Linux):** push a tag `vX.Y.Z` equal to that version. The **Release** workflow builds the installer on `windows-latest`, runs the installer smoke test, and attaches `ColorBMS-Setup-X.Y.Z.exe` and the zip to the GitHub release. Without a tag, run the workflow by hand ("Run workflow"), or take the `color-bms-installer` artifact of the PR's `installer-windows` CI job.
   - **On a Windows PC with [Inno Setup 6](https://jrsoftware.org/isdl.php):**

```bash
npm run package:installer
```

   This builds the app and the pilot package folder (`dist-pilot/color-bms-<version>/`, plus the zip), then compiles [`installer/color-bms.iss`](../../installer/color-bms.iss) to `dist-installer/ColorBMS-Setup-<version>.exe` (~50 MB). If `ISCC.exe` is not in `Program Files (x86)\Inno Setup 6`, set `COLOR_BMS_ISCC`.

3. Optional, on a Windows PC **without** the system installed (it refuses otherwise):

```bash
npm run installer:smoke
```

   It installs silently to a temp folder, then runs crash → restart, update, go-live, uninstall (data kept), reinstall, and cleans up. CI runs it on every PR.

## 2. Install on a new PC, or update

Logged in as the **owner's Windows user**, double-click `ColorBMS-Setup-<version>.exe`:

1. **SmartScreen** (the installer is not signed): "O Windows protegeu o computador" → **Mais informações** → **Executar assim mesmo**.
2. No admin rights are needed, and there is no folder to choose: everything goes to `%LOCALAPPDATA%\ColorBMS`.
3. **Instalar**. After copying the files, the installer:
   - **first install:** copies `app\`, starts in **trial mode** (`data-treino\`), registers the Task Scheduler task **Color BMS** (at logon, hidden), and creates the desktop shortcut **Sistema Color** (Edge in app mode);
   - **update** (also over a **pilot** install): stops the system, keeps the old program in `app.anterior\`, swaps in the new `app\`, and starts. On that start the server backs up the database to `data\backups\` before migrating (#25). The data folders are never touched.
4. Início opens. The wizard ends with "Concluir".

If something fails, a message points to `%LOCALAPPDATA%\ColorBMS\instalador.log` (every install and update is appended there). The server logs are in `data\logs\` (or `data-treino\logs\`).

**Start Menu › Sistema Color:**

| Entry | What it does |
|---|---|
| Iniciar o Sistema Color | `iniciar.cmd`: starts the task and opens Início |
| Parar o Sistema Color | `parar.cmd` |
| Começar o uso real | `iniciar-uso-real.cmd`: the go-live reset (§9.5), as in the pilot ([`docs/pilot/install.md`](../pilot/install.md) §4) |
| Leia-me | `LEIA-ME.txt` |
| Desinstalar o Sistema Color | the uninstaller (also in Windows › Configurações › Aplicativos) |

An **older** installer refuses to replace a newer version ("a versão instalada … é mais nova que este instalador"), because the newer version may have migrated the database. To go back on purpose, run it from a command prompt with `ColorBMS-Setup-<versão>.exe /PERMITIRVERSAOANTERIOR=1`, and restore the pre-migration copy from `data\backups\` if there were migrations.

**To go back to the previous version:** Parar, delete `app\`, rename `app.anterior\` to `app\`, Iniciar. If the new version had migrated the database, also restore the pre-migration copy from `data\backups\` ([`restaurar-backup.md`](../pilot/restaurar-backup.md)).

## 3. Upgrade from the pilot install

Nothing special: run the installer on the pilot PC. It finds `app\` and takes the update path. The task "Color BMS" and the shortcut "Sistema Color" are re-registered under the same names, and the trial or real mode and the data are kept. From then on, use the installer instead of the zip's `atualizar.cmd`.

## 4. Uninstall

Windows › Configurações › Aplicativos › **Sistema Color** › Desinstalar (or the Start Menu entry). It stops the system, deletes the logon task, the desktop shortcut, the Start Menu entries and the program (`app\`, `app.anterior\`). It **keeps** `data\`, `data-treino\`, `arquivo\` and `instalacao.json`. Installing again brings everything back in the same mode. To erase the data too, delete `%LOCALAPPDATA%\ColorBMS` by hand afterwards (only after a backup is safe elsewhere).

## 5. New PC (disk failure, new computer) — FR-32

1. Install with the installer (trial mode).
2. Start Menu › **Começar o uso real**: type SIM and the OneDrive folder.
3. Configurações › **Backup e restauração**: choose the latest backup from OneDrive (or "Restaurar de um arquivo" with a `color-AAAA-MM-DD_HHMM.db` file), type a reason, confirm. The system restarts with that state (#22).
4. Check Início and the last closed day.

## 6. Deployment checklist (spec §9.5, NFR-07)

Done once on a clean **Windows 11 VM**, then on the **shop PC**, with the date. For the go-live day itself (master data, the first real day, the parallel period), follow [`docs/pilot/go-live-checklist.md`](../pilot/go-live-checklist.md).

| Done | Check | Date |
|---|---|---|
| [ ] | Installer from the USB stick → reboot → log in: **no window appears**, and the **Sistema Color** shortcut opens Início (FR-34, NFR-02). | |
| [ ] | Network cable unplugged: sales, closing, reports and the daily spreadsheet work; OneDrive syncs when the cable is back (FR-34, NFR-03). | |
| [ ] | From another PC on the network, `http://<shop-PC-IP>:3210` does not open (NFR-08). | |
| [ ] | Task Manager → end the `node.exe` running `main.js`: within seconds Início answers again, and the log has `Server stopped …; restarting`. | |
| [ ] | Installer of a newer version: data kept, `data\backups\` has a pre-migration copy if there were migrations, Início shows the new version. | |
| [ ] | **Windows time sync:** Configurações do Windows › Hora e idioma › Data e hora: "Definir horário automaticamente" **on**, time zone **(UTC-03:00) Brasília**. Configurações › Status do sistema › Verificações: time zone and clock "OK". | |
| [ ] | **Fee table (Q-01)** and **fixed-expense templates (Q-05, Q-06)** entered ([`go-live-checklist.md`](../pilot/go-live-checklist.md) §C). | |
| [ ] | **OneDrive folder (Q-07):** set in Configurações › Pasta do OneDrive, "Testar" OK, the OneDrive app signed in and syncing. | |
| [ ] | **Backup test:** close a day → the file is in `<OneDrive>\_backup-sistema\` and synced. | |
| [ ] | **Restore test with the installer (NFR-07):** Configurações › Backup e restauração → restore the backup just made → the system restarts with that state, and Auditoria shows the restore. Then §5 on the VM: uninstall, reinstall, Começar o uso real, restore that backup from the OneDrive folder → same state. | |
| [ ] | Uninstall → `data\` is still there; install again → same mode and same data. | |

Shop PC done on ___/___/______ · Version: ________
