import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unzipSync, zipSync, type Zippable } from "fflate";

/**
 * #26: building `color-bms-<version>.zip` (`npm run package:pilot`). Pure file work, so the
 * zip can be built on any OS: the Windows pieces (node.exe, better-sqlite3's win32-x64
 * prebuild) are files, not something compiled here.
 */

/** Node for the shop PC (ADR 0001: pinned). Update both lines together, from SHASUMS256.txt. */
export const NODE_VERSION = "26.13.1";
export const NODE_WIN_X64_ZIP_SHA256 =
  "e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7";

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson;
}

/** Node's lookup: `<dir>/node_modules/<name>`, from `fromDir` up to the file system root. */
function findPackageDir(name: string, fromDir: string): string | null {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

/**
 * The installed folders of `names` and everything they depend on, found the way Node resolves
 * them from `fromDir`. Copying exactly these keeps the versions the lockfile installed.
 * Workspace packages (`@color-bms/*`) are bundled by tsup, so they are skipped.
 */
export function collectRuntimePackages(fromDir: string, names: readonly string[]): string[] {
  const found = new Set<string>();
  const queue: { name: string; from: string; optional: boolean }[] = names.map((name) => ({
    name,
    from: fromDir,
    optional: false,
  }));
  while (queue.length > 0) {
    const { name, from, optional } = queue.shift()!;
    if (name.startsWith("@color-bms/")) continue;
    const dir = findPackageDir(name, from);
    if (dir === null) {
      if (optional) continue;
      throw new Error(`Runtime dependency "${name}" (needed from ${from}) is not installed.`);
    }
    if (found.has(dir)) continue;
    found.add(dir);
    const json = readPackageJson(dir);
    for (const dep of Object.keys(json.dependencies ?? {})) {
      queue.push({ name: dep, from: dir, optional: false });
    }
    for (const dep of Object.keys(json.optionalDependencies ?? {})) {
      queue.push({ name: dep, from: dir, optional: true });
    }
  }
  return [...found];
}

/**
 * Where a package folder goes inside `app\`, so that Node finds it from `app\server\dist`:
 * the repo's `node_modules\x` → `app\node_modules\x`; `apps\server\node_modules\x` →
 * `app\server\node_modules\x`.
 */
export function packagedPath(repoRoot: string, packageDir: string): string {
  const relative = path.relative(repoRoot, packageDir);
  const serverPrefix = path.join("apps", "server") + path.sep;
  const mapped = relative.startsWith(serverPrefix)
    ? path.join("server", relative.slice(serverPrefix.length))
    : relative;
  if (!mapped.startsWith(`node_modules${path.sep}`) && !mapped.startsWith(`server${path.sep}`)) {
    throw new Error(`Cannot place ${packageDir} in the package (not reachable from the server).`);
  }
  return mapped;
}

/**
 * Copies one package (without its nested `node_modules`, which are packages of their own).
 * better-sqlite3 keeps only the prebuilt binary for `platform`: its C sources, and any binary
 * compiled on *this* machine in `build/` (which it would load first), must not ship.
 */
export function copyPackage(source: string, target: string, platform: string): void {
  const isSqlite = readPackageJson(source).name === "better-sqlite3";
  fs.cpSync(source, target, {
    recursive: true,
    filter: (file) => {
      const relative = path.relative(source, file);
      if (relative === "") return true;
      const [top, ...rest] = relative.split(path.sep);
      if (top === "node_modules") return false;
      if (!isSqlite) return true;
      if (top === "build" || top === "deps" || top === "src" || top === "binding.gyp") {
        return false;
      }
      if (top === "prebuilds" && rest.length > 0) return rest.join("/") === `${platform}.node`;
      return true;
    },
  });
}

/** `.cmd` files need CRLF line endings, whatever git did on checkout. */
export function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

export function verifySha256(data: Buffer, expected: string): void {
  const actual = crypto.createHash("sha256").update(data).digest("hex");
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch: expected ${expected}, got ${actual}.`);
  }
}

/** `node.exe` from the official `node-v<version>-win-x64.zip`. */
export function extractNodeExe(zip: Buffer, version: string): Buffer {
  const entry = `node-v${version}-win-x64/node.exe`;
  const files = unzipSync(zip, { filter: (file) => file.name === entry });
  const exe = files[entry];
  if (!exe) throw new Error(`${entry} not found in the Node zip.`);
  return Buffer.from(exe);
}

/** Zips `dir` with its own name as the top folder (what the owner sees when extracting). */
export function zipDirectory(dir: string, zipFile: string): void {
  const top = path.basename(dir);
  const entries: Zippable = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const name = [top, ...path.relative(dir, full).split(path.sep)].join("/");
    entries[name] = new Uint8Array(fs.readFileSync(full));
  }
  fs.writeFileSync(zipFile, zipSync(entries, { level: 6 }));
}
