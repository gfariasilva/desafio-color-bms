import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findIscc, installerFileName, isccArgs } from "../src/pilot/installer";
import { packagePilot } from "./package-pilot";

/**
 * #24: `npm run package:installer` → `dist-installer/ColorBMS-Setup-<version>.exe`, the Windows
 * installer (ADR 0006). Run `npm run build` first (the root script does).
 *
 * 1. Builds the pilot package folder (`dist-pilot/color-bms-<version>/`, #26): `app\` with the
 *    portable node.exe, plus the support scripts. The zip is built too (the fallback).
 * 2. Compiles `installer/color-bms.iss` with Inno Setup 6 (`ISCC.exe`; Windows only, or
 *    `COLOR_BMS_ISCC=<ISCC.exe>`).
 *
 * Options:
 *   --node-zip=<file>  an already downloaded node-v<version>-win-x64.zip (offline)
 *   --out=<dir>        output folder (default <repo>/dist-installer)
 */

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverRoot, "..", "..");

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "node-zip": { type: "string" },
      out: { type: "string", default: path.join(repoRoot, "dist-installer") },
    },
  });
  const outputDir = path.resolve(values.out);

  const iscc = findIscc(process.env, process.platform, fs.existsSync);
  if (!iscc) {
    throw new Error(
      "Inno Setup 6 (ISCC.exe) not found. Install it on Windows (https://jrsoftware.org/isdl.php " +
        "or `choco install innosetup`), or set COLOR_BMS_ISCC. On Linux, build the installer " +
        "in CI (release workflow) and use npm run package:pilot for the zip.",
    );
  }

  const pkg = await packagePilot({
    platform: "win32-x64",
    nodeZip: values["node-zip"],
    out: path.join(repoRoot, "dist-pilot"),
  });

  fs.mkdirSync(outputDir, { recursive: true });
  execFileSync(
    iscc,
    isccArgs({
      version: pkg.version,
      packageDir: pkg.dir,
      outputDir,
      script: path.join(repoRoot, "installer", "color-bms.iss"),
    }),
    { stdio: "inherit" },
  );
  const exe = path.join(outputDir, installerFileName(pkg.version));
  if (!fs.existsSync(exe)) throw new Error(`ISCC finished, but ${exe} is missing.`);
  const megabytes = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
  console.log(`${exe} (${megabytes} MB)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
