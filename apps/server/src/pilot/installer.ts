import path from "node:path";

/**
 * #24: building the Windows installer (`npm run package:installer`, ADR 0006). The package
 * folder of `npm run package:pilot` (#26) goes into an Inno Setup script
 * (`installer/color-bms.iss`), compiled by Inno Setup's `ISCC.exe` on Windows.
 */

/** `ColorBMS-Setup-0.6.0.exe`: also the `OutputBaseFilename` in the .iss. */
export function installerFileName(version: string): string {
  return `ColorBMS-Setup-${version}.exe`;
}

export interface IsccOptions {
  version: string;
  /** The package folder (`dist-pilot/color-bms-<version>`): `app\` plus the support files. */
  packageDir: string;
  outputDir: string;
  script: string;
}

/** The command line of `ISCC.exe`: the .iss reads the defines `AppVersion`, `PackageDir`, `OutputDir`. */
export function isccArgs(options: IsccOptions): string[] {
  // Windows shows it in Aplicativos; Inno Setup compares versions as numbers.
  if (!/^\d+\.\d+\.\d+$/.test(options.version)) {
    throw new Error(`The version must be x.y.z (apps/server/package.json): ${options.version}`);
  }
  return [
    `/DAppVersion=${options.version}`,
    `/DPackageDir=${options.packageDir}`,
    `/DOutputDir=${options.outputDir}`,
    options.script,
  ];
}

/**
 * Where `ISCC.exe` is: `COLOR_BMS_ISCC`, else the Inno Setup 6 folders (machine-wide or
 * per-user install). Null when not found, and always null off Windows without the variable.
 */
export function findIscc(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (file: string) => boolean,
): string | null {
  if (env.COLOR_BMS_ISCC) return env.COLOR_BMS_ISCC;
  if (platform !== "win32") return null;
  const candidates = [
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe"),
    env.ProgramFiles && path.join(env.ProgramFiles, "Inno Setup 6", "ISCC.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "Inno Setup 6", "ISCC.exe"),
  ];
  return candidates.find((file): file is string => Boolean(file) && exists(file as string)) ?? null;
}
