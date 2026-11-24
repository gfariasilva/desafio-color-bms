import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "../src/pilot/cli-args";
import { appFiles, SUPPORT_FILES, TASK_NAME } from "../src/pilot/layout";
import { findIscc, installerFileName, isccArgs } from "../src/pilot/installer";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const scriptFile = path.join(repoRoot, "installer", "color-bms.iss");
const raw = fs.readFileSync(scriptFile);
const script = raw.toString("utf8").replace(/^\uFEFF/, "");

/** The lines of one `[Section]` of the .iss, without comments and blank lines. */
function section(name: string): string[] {
  const lines = script.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `[${name.toLowerCase()}]`);
  expect(start, `[${name}] section`).toBeGreaterThanOrEqual(0);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\[[^\]]+\]\s*$/.test(line.trim())) break;
    if (line.trim() !== "" && !line.trim().startsWith(";")) body.push(line.trim());
  }
  return body;
}

/** `app\node\node.exe` as the .iss writes it: Windows separators, relative to {app}. */
function relativeWindows(file: string): string {
  return path.relative(path.join("ROOT"), file).split(path.sep).join("\\");
}

describe("#24: Inno Setup script (installer/color-bms.iss)", () => {
  it("#24: is UTF-8 with a byte-order mark, so Inno Setup reads the pt-BR texts right", () => {
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("ADR 0001 / NFR-13: per-user install in %LOCALAPPDATA%\\ColorBMS, no admin rights, pt-BR", () => {
    const setup = section("Setup");
    expect(setup).toContain("PrivilegesRequired=lowest");
    expect(setup).toContain("DefaultDirName={localappdata}\\ColorBMS");
    expect(setup).toContain("DisableDirPage=yes");
    // The program is configured by the CLI from {tmp}: nothing of {app}\app is ever locked.
    expect(setup).toContain("CloseApplications=no");
    expect(section("Languages").join("\n")).toContain("BrazilianPortuguese.isl");
  });

  it("#24: the package goes to {tmp} and the CLI configures it (install or update)", () => {
    const { nodeExe, launcherJs } = appFiles(path.join("ROOT", "app"), "win32");
    const cliJs = path.join(path.dirname(launcherJs), "cli.js");
    expect(section("Files")[0]).toMatch(/DestDir: "\{tmp\}\\pacote"/);
    const code = script.slice(script.indexOf("[Code]"));
    expect(code).toContain(`{tmp}\\pacote\\${relativeWindows(nodeExe)}`);
    expect(code).toContain(`{tmp}\\pacote\\${relativeWindows(cliJs)}`);
    expect(code).toContain("'instalador'");
    expect(code).toContain("GetCustomSetupExitCode");
  });

  it("#24: the uninstaller runs cli.js desinstalar from the installed app", () => {
    const { nodeExe, launcherJs } = appFiles(path.join("ROOT", "app"), "win32");
    const cliJs = path.join(path.dirname(launcherJs), "cli.js");
    const run = section("UninstallRun").join("\n");
    expect(run).toContain(`{app}\\${relativeWindows(nodeExe)}`);
    expect(run).toContain(`{app}\\${relativeWindows(cliJs)}`);
    expect(run).toContain("desinstalar");
    for (const command of ["instalador", "desinstalar"]) {
      expect(COMMANDS).toContain(command);
    }
  });

  it("#24: the uninstall never deletes the data folders, the archive or instalacao.json", () => {
    const deleted = section("UninstallDelete").map((line) => /Name: "([^"]+)"/.exec(line)?.[1]);
    expect(deleted).toEqual([
      "{app}\\app",
      "{app}\\app.anterior",
      "{app}\\app.novo",
      "{app}\\instalador.log",
    ]);
  });

  it("#24: the support scripts are installed next to app\\ and are in the Start Menu", () => {
    const files = section("Files").join("\n");
    for (const file of SUPPORT_FILES) expect(files).toContain(`{#PackageDir}\\${file}`);
    const icons = section("Icons").join("\n");
    for (const file of ["iniciar.cmd", "parar.cmd", "iniciar-uso-real.cmd", "LEIA-ME.txt"]) {
      expect(icons).toContain(`{app}\\${file}`);
    }
    expect(icons).toContain("{uninstallexe}");
  });

  it("#24: the app name matches the scheduled task (the same one the pilot registered)", () => {
    expect(TASK_NAME).toBe("Color BMS");
    expect(section("Setup")).toContain("AppName=Sistema Color");
  });
});

describe("#24: building the installer", () => {
  it("#24: the installer file name carries the version", () => {
    expect(installerFileName("0.6.0")).toBe("ColorBMS-Setup-0.6.0.exe");
  });

  it("#24: ISCC gets the version, the package folder and the output folder", () => {
    expect(
      isccArgs({
        version: "0.6.0",
        packageDir: "D:\\a\\dist-pilot\\color-bms-0.6.0",
        outputDir: "D:\\a\\dist-installer",
        script: "D:\\a\\installer\\color-bms.iss",
      }),
    ).toEqual([
      "/DAppVersion=0.6.0",
      "/DPackageDir=D:\\a\\dist-pilot\\color-bms-0.6.0",
      "/DOutputDir=D:\\a\\dist-installer",
      "D:\\a\\installer\\color-bms.iss",
    ]);
    expect(() =>
      isccArgs({ version: "0.6", packageDir: "p", outputDir: "o", script: "s" }),
    ).toThrow(/x\.y\.z/);
  });

  it("#24: finds ISCC from COLOR_BMS_ISCC, then the usual Inno Setup 6 folders on Windows", () => {
    const exists = (files: string[]) => (file: string) => files.includes(file);
    const env = {
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
    };
    expect(findIscc({ ...env, COLOR_BMS_ISCC: "E:\\iscc.exe" }, "win32", exists([]))).toBe(
      "E:\\iscc.exe",
    );
    expect(
      findIscc(
        env,
        "win32",
        exists([path.join("C:\\Program Files (x86)", "Inno Setup 6", "ISCC.exe")]),
      ),
    ).toBe(path.join("C:\\Program Files (x86)", "Inno Setup 6", "ISCC.exe"));
    expect(
      findIscc(
        env,
        "win32",
        exists([
          path.join("C:\\Users\\dev\\AppData\\Local", "Programs", "Inno Setup 6", "ISCC.exe"),
        ]),
      ),
    ).toBe(path.join("C:\\Users\\dev\\AppData\\Local", "Programs", "Inno Setup 6", "ISCC.exe"));
    expect(findIscc(env, "win32", exists([]))).toBeNull();
    // Inno Setup is a Windows program (ADR 0001: release builds on Windows).
    expect(findIscc(env, "linux", exists([]))).toBeNull();
  });
});
