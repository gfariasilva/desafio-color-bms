import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  NODE_VERSION,
  NODE_WIN_X64_ZIP_SHA256,
  collectRuntimePackages,
  copyPackage,
  extractNodeExe,
  packagedPath,
  toCrlf,
  verifySha256,
  zipDirectory,
} from "../src/pilot/package";

/**
 * #26: `npm run package:pilot` → `dist-pilot/color-bms-<version>.zip`, the pilot package taken
 * to the shop PC on a USB stick (docs/pilot/install.md). Run `npm run build` first (the root
 * script does).
 *
 * Options:
 *   --platform=<p>    better-sqlite3 prebuild to keep (default win32-x64; linux-x64 for the
 *                     smoke test)
 *   --node=<file>     a Node binary to ship instead of downloading node.exe (smoke test)
 *   --node-zip=<file> an already downloaded node-v<version>-win-x64.zip (offline)
 *   --out=<dir>       output folder (default <repo>/dist-pilot)
 */

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverRoot, "..", "..");
const webDist = path.join(repoRoot, "apps", "web", "dist");

export interface PackageOptions {
  platform: string;
  node?: string;
  nodeZip?: string;
  out: string;
}

const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;

/** The official Node zip, from the cache or nodejs.org, checked against the pinned SHA-256. */
async function nodeWindowsZip(options: PackageOptions): Promise<Buffer> {
  const cached = options.nodeZip ?? path.join(options.out, ".cache", NODE_ZIP);
  if (fs.existsSync(cached)) {
    const zip = fs.readFileSync(cached);
    verifySha256(zip, NODE_WIN_X64_ZIP_SHA256);
    return zip;
  }
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;
  console.log(`Downloading ${url} …`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}). Download it by hand: --node-zip=<file>`);
  }
  const zip = Buffer.from(await response.arrayBuffer());
  verifySha256(zip, NODE_WIN_X64_ZIP_SHA256);
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, zip);
  return zip;
}

/** Builds the package folder and its zip; returns the zip's path. */
export async function packagePilot(options: PackageOptions): Promise<string> {
  for (const required of [
    path.join(serverRoot, "dist", "main.js"),
    path.join(serverRoot, "dist", "pilot", "launcher.js"),
    path.join(serverRoot, "dist", "pilot", "cli.js"),
    path.join(webDist, "index.html"),
  ]) {
    if (!fs.existsSync(required)) throw new Error(`${required} is missing: run npm run build.`);
  }
  const serverPackage = JSON.parse(
    fs.readFileSync(path.join(serverRoot, "package.json"), "utf8"),
  ) as { name: string; version: string; dependencies: Record<string, string> };
  const suffix = options.platform === "win32-x64" ? "" : `-${options.platform}`;
  const name = `color-bms-${serverPackage.version}${suffix}`;
  const staging = path.join(options.out, name);
  const app = path.join(staging, "app");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(app, { recursive: true });

  // The program: same relative layout as the repo, so config.ts and migrate.ts find web\dist
  // and migrations\ from app\server\dist (ADR 0004).
  fs.cpSync(path.join(serverRoot, "dist"), path.join(app, "server", "dist"), { recursive: true });
  fs.cpSync(path.join(serverRoot, "migrations"), path.join(app, "server", "migrations"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(app, "server", "package.json"),
    `${JSON.stringify({ name: serverPackage.name, version: serverPackage.version, private: true, type: "module" }, null, 2)}\n`,
  );
  fs.cpSync(webDist, path.join(app, "web", "dist"), { recursive: true });

  // Production dependencies, exactly as installed from the lockfile.
  const packages = collectRuntimePackages(serverRoot, Object.keys(serverPackage.dependencies));
  for (const dir of packages) {
    copyPackage(dir, path.join(app, packagedPath(repoRoot, dir)), options.platform);
  }

  // The Node runtime (ADR 0001: pinned, shipped with the app).
  const nodeDir = path.join(app, "node");
  fs.mkdirSync(nodeDir, { recursive: true });
  if (options.node) {
    const target = path.join(nodeDir, options.platform.startsWith("win32") ? "node.exe" : "node");
    fs.copyFileSync(options.node, target);
    fs.chmodSync(target, 0o755);
  } else {
    if (options.platform !== "win32-x64") throw new Error("--node is required for this platform.");
    fs.writeFileSync(
      path.join(nodeDir, "node.exe"),
      extractNodeExe(await nodeWindowsZip(options), NODE_VERSION),
    );
  }

  // The scripts, with Windows line endings.
  const pilotFiles = path.join(serverRoot, "pilot");
  for (const file of fs.readdirSync(pilotFiles)) {
    const text = fs.readFileSync(path.join(pilotFiles, file), "utf8");
    fs.writeFileSync(path.join(staging, file), toCrlf(text));
  }

  const zipFile = path.join(options.out, `${name}.zip`);
  zipDirectory(staging, zipFile);
  const megabytes = (fs.statSync(zipFile).size / 1024 / 1024).toFixed(1);
  console.log(`${zipFile} (${megabytes} MB, ${packages.length} runtime packages)`);
  return zipFile;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({
    options: {
      platform: { type: "string", default: "win32-x64" },
      node: { type: "string" },
      "node-zip": { type: "string" },
      out: { type: "string", default: path.join(repoRoot, "dist-pilot") },
    },
  });
  packagePilot({
    platform: values.platform,
    node: values.node,
    nodeZip: values["node-zip"],
    out: path.resolve(values.out),
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
