import fs from "node:fs";
import path from "node:path";

/**
 * The commands of `cli.js` (#26, #24):
 *
 * - `instalar`, `atualizar`: the pilot zip's `.cmd` files, run from the USB stick (#26);
 * - `iniciar`, `parar`, `iniciar-uso-real`: the support `.cmd` files next to `app\`;
 * - `instalador`: run by Setup.exe after unpacking, installs or updates (#24);
 * - `desinstalar`: run by the uninstaller before it deletes the program (#24).
 */
export const COMMANDS = [
  "instalar",
  "atualizar",
  "iniciar",
  "parar",
  "iniciar-uso-real",
  "instalador",
  "desinstalar",
] as const;
export type Command = (typeof COMMANDS)[number];

export interface CliArgs {
  command: Command;
  /** `/silencioso`: no questions, no browser (CI, `Setup.exe /VERYSILENT`). */
  silent: boolean;
  /** `--raiz=<pasta>`: the install root ({app} in Inno Setup); default %LOCALAPPDATA%\ColorBMS. */
  root: string | undefined;
  /** `--registro=<arquivo>`: every printed line is also appended there (Setup runs hidden). */
  logFile: string | undefined;
  /** `--confirmar` (iniciar-uso-real). */
  confirmed: boolean;
  /** `--pasta-onedrive=<pasta>`, or null for `--sem-onedrive` (iniciar-uso-real). */
  oneDriveFolder: string | null | undefined;
  /** `--permitir-versao-anterior` (instalador): a deliberate downgrade. */
  allowDowngrade: boolean;
}

function flagValue(flags: string[], name: string): string | undefined {
  const flag = flags.find((f) => f.startsWith(`--${name}=`));
  return flag?.slice(name.length + 3);
}

/** Null for a missing or unknown command. */
export function parseCliArgs(argv: readonly string[]): CliArgs | null {
  const command = argv[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) return null;
  const flags = argv.slice(1);
  const folder = flagValue(flags, "pasta-onedrive");
  return {
    command,
    silent: flags.some((flag) => flag.toLowerCase() === "/silencioso"),
    root: flagValue(flags, "raiz"),
    logFile: flagValue(flags, "registro"),
    confirmed: flags.includes("--confirmar"),
    oneDriveFolder:
      folder !== undefined ? folder : flags.includes("--sem-onedrive") ? null : undefined,
    allowDowngrade: flags.includes("--permitir-versao-anterior"),
  };
}

/**
 * #24: Setup.exe runs the CLI without a window, so its messages also go to a log file the
 * installer can show on failure. Windows line endings, for Notepad.
 */
export function logToFile(
  print: (line: string) => void,
  file: string | undefined,
): (line: string) => void {
  if (!file) return print;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (line) => {
    print(line);
    fs.appendFileSync(file, `${line}\r\n`);
  };
}
