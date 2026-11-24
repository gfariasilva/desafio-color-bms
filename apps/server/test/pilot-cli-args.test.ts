import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMANDS, logToFile, parseCliArgs } from "../src/pilot/cli-args";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-cli-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("#24: cli.js arguments", () => {
  it("#24: the installer passes the install root and the log file; silent mode is optional", () => {
    expect(
      parseCliArgs([
        "instalador",
        "--raiz=C:\\Users\\dono\\AppData\\Local\\ColorBMS",
        "--registro=C:\\Users\\dono\\AppData\\Local\\ColorBMS\\instalador.log",
      ]),
    ).toEqual({
      command: "instalador",
      silent: false,
      root: "C:\\Users\\dono\\AppData\\Local\\ColorBMS",
      logFile: "C:\\Users\\dono\\AppData\\Local\\ColorBMS\\instalador.log",
      confirmed: false,
      oneDriveFolder: undefined,
    });
    expect(parseCliArgs(["desinstalar", "/SILENCIOSO"])).toMatchObject({
      command: "desinstalar",
      silent: true,
      root: undefined,
      logFile: undefined,
    });
  });

  it("#26: the go-live flags still work", () => {
    expect(
      parseCliArgs([
        "iniciar-uso-real",
        "/silencioso",
        "--confirmar",
        "--pasta-onedrive=D:\\Color",
      ]),
    ).toMatchObject({ confirmed: true, oneDriveFolder: "D:\\Color" });
    expect(parseCliArgs(["iniciar-uso-real", "--sem-onedrive"])).toMatchObject({
      confirmed: false,
      oneDriveFolder: null,
    });
  });

  it("#24: an unknown or missing command is refused", () => {
    expect(parseCliArgs([])).toBeNull();
    expect(parseCliArgs(["formatar"])).toBeNull();
    expect(COMMANDS).toEqual([
      "instalar",
      "atualizar",
      "iniciar",
      "parar",
      "iniciar-uso-real",
      "instalador",
      "desinstalar",
    ]);
  });

  it("#24: --registro appends every printed line to the log (CRLF, folder created)", () => {
    const printed: string[] = [];
    const file = path.join(tempDir, "ColorBMS", "instalador.log");
    const print = logToFile((line) => void printed.push(line), file);

    print("Instalando o sistema Color (versão 0.6.0) …");
    print("Instalação concluída.");

    expect(printed).toEqual([
      "Instalando o sistema Color (versão 0.6.0) …",
      "Instalação concluída.",
    ]);
    expect(fs.readFileSync(file, "utf8")).toBe(
      "Instalando o sistema Color (versão 0.6.0) …\r\nInstalação concluída.\r\n",
    );
  });

  it("#24: without --registro, printing only goes to the console", () => {
    const printed: string[] = [];
    const print = logToFile((line) => void printed.push(line), undefined);
    print("ok");
    expect(printed).toEqual(["ok"]);
  });
});
