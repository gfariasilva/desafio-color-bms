# Pilot install on the shop PC (#26)

For the developer. How to build the pilot package, install it on the shop's Windows 11 PC, update it, run the trial days and do the go-live reset. The decisions are in [ADR 0004](../adr/0004-pilot-install.md). The owner-facing text is `LEIA-ME.txt` in the zip, and the manual restore is in [`restaurar-backup.md`](restaurar-backup.md).

## 1. Build the package

1. Bump `version` in `apps/server/package.json`. Início and `atualizar.cmd` show it.
2. Build:

```bash
npm run package:pilot
```

This builds the app, downloads `node-v26.13.1-win-x64.zip` once (it's cached in `dist-pilot/.cache/` and checked against the pinned SHA-256), and writes `dist-pilot/color-bms-<version>.zip` (~48 MB). It works on any OS. CI uploads the same zip as the `color-bms-pilot` artifact. With no internet, pass an already downloaded Node zip: `-- --node-zip=<file>`.

To check the package end to end on this machine (install, crash → restart, update, go-live, stop on port 3210):

```bash
npm run pilot:smoke
```

3. Copy the zip to the USB stick.

## 2. Install (first time)

1. On the shop PC, logged in as the **owner's Windows user**, copy the zip from the USB stick and **extract it all** (right-click → Extrair tudo).
2. Double-click `instalar.cmd`. It:
   - copies `app\` to `%LOCALAPPDATA%\ColorBMS\app` and creates `data-treino\`, so it starts in **trial mode**;
   - copies `iniciar.cmd`, `parar.cmd`, `iniciar-uso-real.cmd` and `LEIA-ME.txt` next to it;
   - registers the Task Scheduler task **Color BMS**, which runs at logon, hidden;
   - creates the desktop shortcut **Sistema Color**, which opens Edge in app mode on `http://127.0.0.1:3210/`;
   - starts the task and opens Início.

No admin rights are needed. Running `instalar.cmd` again on an installed PC refuses and points to `atualizar.cmd`.

```
%LOCALAPPDATA%\ColorBMS\
  app\  app.anterior\  data-treino\  data\  arquivo\  instalacao.json
  iniciar.cmd  parar.cmd  iniciar-uso-real.cmd  LEIA-ME.txt
```

## 3. Trial days and training

In trial mode, the header shows **TREINO** and nothing is backed up to OneDrive. Train with made-up data (#27): the session and the stopwatch measurements are in [`treinamento.md`](treinamento.md), and the owner's one-page guide is [`guia-rapido.md`](guia-rapido.md).

## 4. Go-live reset (the 1st of the month, spec §9.5)

1. Before it, set up the OneDrive folder for backups (e.g. `%OneDrive%\Color`).
2. Double-click `iniciar-uso-real.cmd` in `%LOCALAPPDATA%\ColorBMS`, type **SIM**, and accept or type the OneDrive folder.
3. It:
   - stops the system;
   - moves `data-treino\` to `arquivo\data-treino-AAAA-MM-DD_HHMM\`;
   - writes `data\config.json`, which the server imports into Configurações on its first start (#20); later changes are made in Configurações › Pasta do OneDrive;
   - starts on a fresh `data\`, with seeds only.
4. Then enter the fee table and the fixed expenses ([`go-live-checklist.md`](go-live-checklist.md) §C, #27). The first closing asks for the opening cash, typed by hand (§9.5 item 3). The 2-week parallel period follows: [`conferencia.md`](conferencia.md) and [`resultado-piloto.md`](resultado-piloto.md).

It refuses to run twice, and if `data\color.db` already exists.

## 5. Update (each visit)

1. Extract the new zip on the USB stick and double-click its `atualizar.cmd`.
2. It stops the system, keeps the old program in `app.anterior\`, copies the new `app\`, starts it, waits until Início answers with the **new version**, and opens it.
3. On this start, the server backs up the database to `data\backups\` before applying migrations (#25). The data folders are never touched.

**To go back:** run `parar.cmd`, delete `app\`, rename `app.anterior\` to `app\`, and run `iniciar.cmd`. If the new version already migrated the database, also restore the pre-migration backup from `data\backups\` ([`restaurar-backup.md`](restaurar-backup.md)).

## 6. Support

- `parar.cmd` / `iniciar.cmd`: stop or start the system and open it.
- **Logs:** `data\logs\color-bms-AAAA-MM-DD.log`, or `data-treino\logs\` in trial mode. There is one file per day and the last 31 are kept. They contain the server's JSON log lines, the launcher's `[launcher]` lines (start, crash, restart), and any crash stack trace.
- **Início › Status do sistema › Verificações:**
  - PC time zone (must be UTC−03:00);
  - PC clock (an error if it is behind the latest records or before the version's build date);
  - port 3210;
  - data folder and OneDrive folder writable.
- **Port 3210 taken:** by a second copy of this system, the newer one stops quietly. By another program, the log says so and the launcher keeps retrying (every minute at most).

## 7. Acceptance check on a Windows 11 VM, then on the shop PC

Not automatable here. Do it once on a clean VM and once on the shop PC, and note the date.

- [ ] `instalar.cmd` from the extracted zip → reboot → log in: **no window appears**, and the **Sistema Color** shortcut opens Início (FR-34).
- [ ] Network cable unplugged: sales, closing and reports work (NFR-03).
- [ ] From another PC on the network, `http://<shop-PC-IP>:3210` does not open (NFR-08).
- [ ] `atualizar.cmd` with a newer zip: data kept, `data\backups\` (or `data-treino\backups\`) has a pre-migration backup if there were migrations, and Início shows the new version.
- [ ] Task Manager → end the `node.exe` that runs `main.js`: within a few seconds Início answers again, and the log has `Server stopped …; restarting`.
- [ ] Go-live reset: Início without TREINO, empty lists (only the seeds), and the first closing's "Troco inicial" is empty (FR-08).
- [ ] Manual restore tested (NFR-07, [`restaurar-backup.md`](restaurar-backup.md)).
