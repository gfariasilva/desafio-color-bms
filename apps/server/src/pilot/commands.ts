import fs from "node:fs";
import path from "node:path";
import { backupFileName } from "@color-bms/core";
import type { Clock } from "../clock";
import type { HealthWaitResult } from "./health-wait";
import {
  APP_URL,
  SUPPORT_FILES,
  appVersion,
  dataDirFor,
  readMode,
  writeMode,
  type InstallLayout,
} from "./layout";
import { buildTaskXml } from "./task-xml";

/** The Windows side effects, faked in tests (windows.ts has the real ones). */
export interface WindowsOps {
  /** `DOMAIN\user` of whoever runs the script (the owner, at the shop PC). */
  currentUser(): string;
  registerTask(xml: string): void;
  runTask(): void;
  endTask(): void;
  /** Stops every process whose executable is `nodeExe`, except the current one. */
  stopProcesses(nodeExe: string): void;
  /** Creates the desktop shortcut; returns its path. */
  createShortcut(url: string): string;
  openBrowser(url: string): void;
  /** Deletes the Task Scheduler task (#24, uninstall); no error when there is none. */
  deleteTask(): void;
  /** Deletes the desktop shortcuts created by `createShortcut`; returns the deleted paths. */
  removeShortcuts(): string[];
}

export interface PilotContext {
  layout: InstallLayout;
  /** The folder that holds `app\` and the scripts: the USB copy, or the install root. */
  packageDir: string;
  windows: WindowsOps;
  waitForHealth(options: { version?: string; timeoutMs: number }): Promise<HealthWaitResult>;
  waitForStop(timeoutMs: number): Promise<boolean>;
  prompt(question: string): Promise<string>;
  print(line: string): void;
  now: Clock;
  /** No questions and no browser (CI smoke test). */
  silent: boolean;
  env: { OneDrive?: string; SystemRoot?: string };
}

const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 30_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Renames a folder. Right after its processes are stopped, Windows (or an antivirus scan) may
 * still hold a file for a moment, so a few retries avoid a spurious failure.
 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      sleepSync(500);
    }
  }
}

function copySupportFiles(ctx: PilotContext): void {
  for (const file of SUPPORT_FILES) {
    const source = path.join(ctx.packageDir, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(ctx.layout.root, file));
  }
}

function registerTask(ctx: PilotContext): void {
  const { layout } = ctx;
  ctx.windows.registerTask(
    buildTaskXml({
      userId: ctx.windows.currentUser(),
      conhostExe: path.join(ctx.env.SystemRoot ?? "C:\\Windows", "System32", "conhost.exe"),
      nodeExe: layout.nodeExe,
      launcherJs: layout.launcherJs,
      workingDir: layout.appDir,
    }),
  );
}

function logsDir(ctx: PilotContext): string {
  return path.join(dataDirFor(ctx.layout, readMode(ctx.layout)), "logs");
}

/** Starts the task and waits for the server; false (with the reason printed) on failure. */
async function startAndWait(ctx: PilotContext, version?: string): Promise<boolean> {
  ctx.windows.runTask();
  const health = await ctx.waitForHealth({ version, timeoutMs: START_TIMEOUT_MS });
  if (!health.ok) {
    ctx.print(`ERRO: o sistema não iniciou (${health.reason}).`);
    ctx.print(`Veja o registro em ${logsDir(ctx)}`);
    return false;
  }
  if (!ctx.silent) ctx.windows.openBrowser(APP_URL);
  return true;
}

/** Stops the task and every process of the installed node.exe. */
async function stopAll(ctx: PilotContext): Promise<boolean> {
  ctx.windows.endTask();
  ctx.windows.stopProcesses(ctx.layout.nodeExe);
  if (await ctx.waitForStop(STOP_TIMEOUT_MS)) return true;
  ctx.print("ERRO: o sistema continua respondendo; não foi possível pará-lo.");
  return false;
}

/**
 * instalar.cmd: first install, in trial mode (#26). Also the installer's path on a PC without
 * `app\` (#24): after an uninstall the data folders and `instalacao.json` are still there, so the
 * mode in use is kept and real data is never hidden behind a new trial folder.
 */
export async function install(ctx: PilotContext): Promise<number> {
  const { layout } = ctx;
  if (fs.existsSync(layout.appDir)) {
    ctx.print(`O sistema já está instalado em ${layout.root}.`);
    ctx.print("Para instalar uma versão nova, use atualizar.cmd.");
    return 1;
  }
  const source = path.join(ctx.packageDir, "app");
  const version = appVersion(source) ?? "?";
  const previousData = fs.existsSync(layout.settingsFile) || fs.existsSync(layout.realDataDir);
  const mode = previousData ? readMode(layout) : "treino";
  ctx.print(`Instalando o sistema Color (versão ${version}) em ${layout.root} …`);

  fs.mkdirSync(layout.root, { recursive: true });
  fs.cpSync(source, layout.appDir, { recursive: true });
  // #26: training days use their own folder; the go-live reset archives it.
  fs.mkdirSync(dataDirFor(layout, mode), { recursive: true });
  writeMode(layout, mode);
  copySupportFiles(ctx);

  registerTask(ctx);
  const shortcut = ctx.windows.createShortcut(APP_URL);
  ctx.print(`Atalho criado: ${shortcut}`);
  if (!(await startAndWait(ctx, version))) return 1;

  if (mode === "real") {
    ctx.print(
      `Instalação concluída (versão ${version}, modo real: os dados existentes foram mantidos).`,
    );
  } else {
    ctx.print(`Instalação concluída (versão ${version}, modo treino).`);
  }
  ctx.print("O sistema inicia sozinho quando o Windows é iniciado.");
  if (mode === "treino")
    ctx.print("Para começar o uso real (dia 1º do mês): iniciar-uso-real.cmd.");
  return 0;
}

/** atualizar.cmd: replaces `app\` only and keeps the data (#26). */
export async function update(ctx: PilotContext): Promise<number> {
  const { layout } = ctx;
  if (!fs.existsSync(layout.appDir)) {
    ctx.print(`O sistema não está instalado em ${layout.root}. Use instalar.cmd.`);
    return 1;
  }
  if (path.resolve(ctx.packageDir) === path.resolve(layout.root)) {
    ctx.print("Rode o atualizar.cmd da pasta da versão nova (pendrive), não da pasta instalada.");
    return 1;
  }
  const source = path.join(ctx.packageDir, "app");
  const from = appVersion(layout.appDir) ?? "?";
  const to = appVersion(source) ?? "?";
  ctx.print(`Atualizando o sistema Color: versão ${from} → ${to} …`);

  // Copy first, while the system still runs: a failed copy (USB stick pulled, disk full)
  // leaves the installed app\ untouched. Only a complete copy is swapped in.
  fs.rmSync(layout.newAppDir, { recursive: true, force: true });
  try {
    fs.cpSync(source, layout.newAppDir, { recursive: true });
  } catch (error) {
    fs.rmSync(layout.newAppDir, { recursive: true, force: true });
    ctx.print(`ERRO: não foi possível copiar a versão nova (${(error as Error).message}).`);
    ctx.print("Nada foi alterado; o sistema continua na versão instalada.");
    return 1;
  }

  if (!(await stopAll(ctx))) return 1;
  // The previous program stays in app.anterior, so the update can be undone by hand.
  fs.rmSync(layout.previousAppDir, { recursive: true, force: true });
  renameWithRetry(layout.appDir, layout.previousAppDir);
  try {
    renameWithRetry(layout.newAppDir, layout.appDir);
  } catch (error) {
    renameWithRetry(layout.previousAppDir, layout.appDir);
    ctx.print(`ERRO: não foi possível instalar a versão nova (${(error as Error).message}).`);
    ctx.print("A versão anterior foi mantida; rode iniciar.cmd.");
    return 1;
  }
  copySupportFiles(ctx);
  registerTask(ctx);

  // #25: on this start, the server backs up the database before applying new migrations.
  if (!(await startAndWait(ctx, to))) {
    ctx.print("Para voltar à versão anterior: parar.cmd, apague a pasta app,");
    ctx.print(`renomeie app.anterior para app (em ${layout.root}) e rode iniciar.cmd.`);
    return 1;
  }
  ctx.print(`Atualizado: versão ${from} → ${to}.`);
  return 0;
}

/**
 * #24: Setup.exe, after unpacking the package to its temp folder: a first install (or a
 * reinstall after an uninstall), or an update of an installed system, including a pilot
 * install (#26), which has the same folders, task name and shortcut.
 */
export async function installOrUpdate(ctx: PilotContext): Promise<number> {
  return fs.existsSync(ctx.layout.appDir) ? update(ctx) : install(ctx);
}

/**
 * #24: the uninstaller, before it deletes `app\` and the support files: stops the system and
 * removes what Windows keeps outside the folder (the logon task, the desktop shortcut). The
 * data folders, the archive and `instalacao.json` are kept, so a reinstall finds everything.
 */
export async function uninstall(ctx: PilotContext): Promise<number> {
  let stopped = false;
  try {
    stopped = await stopAll(ctx);
  } catch (error) {
    ctx.print(`ERRO: não foi possível parar o sistema (${(error as Error).message}).`);
  }
  // Even if the system did not stop, it must not start again at the next logon.
  ctx.windows.deleteTask();
  for (const shortcut of ctx.windows.removeShortcuts()) ctx.print(`Atalho removido: ${shortcut}`);
  ctx.print(`Os dados foram mantidos em ${ctx.layout.root}.`);
  return stopped ? 0 : 1;
}

/** iniciar.cmd */
export async function start(ctx: PilotContext): Promise<number> {
  try {
    return (await startAndWait(ctx)) ? 0 : 1;
  } catch (error) {
    ctx.print(`ERRO: não foi possível iniciar a tarefa "${(error as Error).message}".`);
    ctx.print("O sistema está instalado? (instalar.cmd)");
    return 1;
  }
}

/** parar.cmd */
export async function stop(ctx: PilotContext): Promise<number> {
  if (!(await stopAll(ctx))) return 1;
  ctx.print("Sistema parado. Para iniciar de novo: iniciar.cmd (ou reinicie o Windows).");
  return 0;
}

/** Asks for the OneDrive folder until it exists, or Enter with no default (no backup). */
async function askOneDriveFolder(ctx: PilotContext): Promise<string | null> {
  const guess = ctx.env.OneDrive ? path.join(ctx.env.OneDrive, "Color") : null;
  const suggestion = guess && fs.existsSync(guess) ? guess : null;
  for (;;) {
    const hint = suggestion ? ` [${suggestion}]` : " (Enter: sem backup)";
    const answer = (await ctx.prompt(`Pasta do OneDrive para os backups${hint}: `)).trim();
    const folder = answer === "" ? suggestion : answer.replace(/^"(.*)"$/, "$1");
    if (folder === null) return null;
    if (fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return folder;
    ctx.print(`A pasta ${folder} não existe. Crie-a no OneDrive ou digite outra.`);
  }
}

export interface GoLiveOptions {
  /** Skip the "SIM" question (CI). */
  confirmed?: boolean;
  /** Skip the folder question (CI); null = no OneDrive backup. */
  oneDriveFolder?: string | null;
}

/**
 * iniciar-uso-real.cmd, the go-live reset (#26, spec §9.5): archives the trial folder and
 * starts the real one with a fresh database (seeds only). The first closing then has no
 * opening cash, which the owner types by hand (FR-08, §9.5 item 3).
 */
export async function goLive(ctx: PilotContext, options: GoLiveOptions = {}): Promise<number> {
  const { layout } = ctx;
  if (readMode(layout) === "real") {
    ctx.print("O sistema já está em uso real. Nada foi alterado.");
    return 1;
  }
  const realDb = path.join(layout.realDataDir, "color.db");
  if (fs.existsSync(realDb)) {
    ctx.print(`Já existe um banco de dados real em ${realDb}. Nada foi alterado.`);
    return 1;
  }

  ctx.print("Início do uso real: os dados de treino serão guardados à parte em");
  ctx.print(`${layout.archiveDir} e o sistema começará vazio (só os cadastros iniciais).`);
  const confirmed =
    options.confirmed ||
    (await ctx.prompt("Digite SIM para confirmar: ")).trim().toUpperCase() === "SIM";
  if (!confirmed) {
    ctx.print("Nada foi alterado.");
    return 1;
  }
  const oneDrive =
    options.oneDriveFolder !== undefined ? options.oneDriveFolder : await askOneDriveFolder(ctx);

  if (!(await stopAll(ctx))) return 1;
  if (fs.existsSync(layout.trialDataDir)) {
    // "color-2026-11-18_1903.db" → "2026-11-18_1903": São Paulo date and time (RN-15).
    const stamp = backupFileName(ctx.now()).slice("color-".length, -".db".length);
    fs.mkdirSync(layout.archiveDir, { recursive: true });
    renameWithRetry(layout.trialDataDir, path.join(layout.archiveDir, `data-treino-${stamp}`));
  }
  fs.mkdirSync(layout.realDataDir, { recursive: true });
  if (oneDrive !== null) {
    // JSON.stringify writes Windows backslashes correctly escaped (config.json, #25). The
    // server moves it into Configurações on its first start (#20).
    fs.writeFileSync(
      path.join(layout.realDataDir, "config.json"),
      `${JSON.stringify({ oneDriveFolder: oneDrive }, null, 2)}\n`,
    );
  }
  writeMode(layout, "real");

  if (!(await startAndWait(ctx))) return 1;
  ctx.print("Uso real iniciado. No primeiro fechamento, informe o troco inicial à mão.");
  if (oneDrive === null) {
    ctx.print("ATENÇÃO: sem pasta do OneDrive, o sistema está sem backup.");
    ctx.print("Configure-a no sistema, em Configurações > Pasta do OneDrive.");
  } else {
    ctx.print(`Backups em ${path.join(oneDrive, "_backup-sistema")}.`);
  }
  return 0;
}
