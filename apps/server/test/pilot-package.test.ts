import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectRuntimePackages,
  copyPackage,
  extractNodeExe,
  packagedPath,
  toCrlf,
  verifySha256,
  zipDirectory,
} from "../src/pilot/package";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-pkg-"));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function pkg(dir: string, json: Record<string, unknown>, files: Record<string, string> = {}) {
  const full = path.join(repo, dir);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(path.join(full, "package.json"), JSON.stringify(json));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(full, name)), { recursive: true });
    fs.writeFileSync(path.join(full, name), text);
  }
}

describe("#26: production node_modules copied from the installed tree (lockfile versions)", () => {
  it("#26: walks dependencies with Node's resolution, including nested and workspace-local copies", () => {
    pkg("apps/server", { dependencies: { a: "^1", c: "^1", "@color-bms/core": "*" } });
    pkg("node_modules/a", { name: "a", dependencies: { b: "^1", d: "^2" } });
    pkg("node_modules/b", { name: "b", optionalDependencies: { "not-installed": "^1" } });
    pkg("node_modules/d", { name: "d", version: "1.0.0" }); // the wrong version, hoisted
    pkg("node_modules/a/node_modules/d", { name: "d", version: "2.0.0" });
    pkg("apps/server/node_modules/c", { name: "c", dependencies: { b: "^1" } });

    const found = collectRuntimePackages(path.join(repo, "apps/server"), ["a", "c"]);

    // path.relative uses "\" on Windows; compare with "/" on every OS.
    const relative = found.map((dir) => path.relative(repo, dir).split(path.sep).join("/"));
    expect(relative.sort()).toEqual([
      "apps/server/node_modules/c",
      "node_modules/a",
      "node_modules/a/node_modules/d",
      "node_modules/b",
    ]);
  });

  it("#26: a missing required dependency stops the packaging", () => {
    pkg("apps/server", {});
    pkg("node_modules/a", { name: "a", dependencies: { gone: "^1" } });
    expect(() => collectRuntimePackages(path.join(repo, "apps/server"), ["a"])).toThrow(/gone/);
  });

  it("#26: places packages in app\\ the way Node resolves them from app\\server\\dist", () => {
    expect(packagedPath(repo, path.join(repo, "node_modules", "fastify"))).toBe(
      path.join("node_modules", "fastify"),
    );
    expect(
      packagedPath(repo, path.join(repo, "apps", "server", "node_modules", "fastify", "x")),
    ).toBe(path.join("server", "node_modules", "fastify", "x"));
    expect(() => packagedPath(repo, path.join(repo, "apps", "web", "node_modules", "x"))).toThrow();
  });

  it("#26: better-sqlite3 keeps only the Windows x64 prebuild (no sources, no local build)", () => {
    pkg(
      "node_modules/better-sqlite3",
      { name: "better-sqlite3" },
      {
        "lib/index.js": "js",
        "prebuilds/win32-x64.node": "win",
        "prebuilds/linux-x64.node": "linux",
        "build/Release/better_sqlite3.node": "built for this machine",
        "deps/sqlite3/sqlite3.c": "c",
        "src/better_sqlite3.cpp": "cpp",
        "binding.gyp": "gyp",
        "node_modules/x/package.json": "{}",
      },
    );
    const out = path.join(repo, "out");
    copyPackage(path.join(repo, "node_modules/better-sqlite3"), out, "win32-x64");
    const files = fs.readdirSync(out, { recursive: true, withFileTypes: true });
    const names = files
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(out, path.join(entry.parentPath, entry.name)))
      .sort();
    expect(names).toEqual([
      "lib/index.js".split("/").join(path.sep),
      "package.json",
      "prebuilds/win32-x64.node".split("/").join(path.sep),
    ]);
  });
});

describe("#26: file names Windows can extract", () => {
  it("#26: copyPackage skips files and folders whose names are not plain ASCII", () => {
    pkg(
      "node_modules/@fastify/send",
      { name: "@fastify/send" },
      {
        "index.js": "js",
        "test/fixtures/snow \u2603/index.html": "fixture",
        "test/fixtures/caf\u00e9.txt": "fixture",
        "test/fixtures/plain.txt": "fixture",
      },
    );
    const out = path.join(repo, "out");
    copyPackage(path.join(repo, "node_modules/@fastify/send"), out, "win32-x64");
    const names = fs
      .readdirSync(out, { recursive: true, withFileTypes: true })
      .map((entry) => path.relative(out, path.join(entry.parentPath, entry.name)))
      .sort();
    expect(names).toEqual(
      ["index.js", "package.json", "test", "test/fixtures", "test/fixtures/plain.txt"].map((n) =>
        n.split("/").join(path.sep),
      ),
    );
  });

  it("#26: zipDirectory refuses a name that is not plain ASCII", () => {
    const dir = path.join(repo, "color-bms-0.2.0");
    fs.mkdirSync(path.join(dir, "snow \u2603"), { recursive: true });
    fs.writeFileSync(path.join(dir, "snow \u2603", "index.html"), "x");
    expect(() => zipDirectory(dir, path.join(repo, "out.zip"))).toThrow(/snow/);
  });
});

describe("#26: zip, Node download and scripts", () => {
  it("#26: .cmd files get Windows line endings", () => {
    expect(toCrlf("@echo off\nset A=1\r\nexit\n")).toBe("@echo off\r\nset A=1\r\nexit\r\n");
  });

  it("#26: the zip holds the folder with every file, under one top folder", () => {
    const dir = path.join(repo, "color-bms-0.2.0");
    fs.mkdirSync(path.join(dir, "app", "node"), { recursive: true });
    fs.writeFileSync(path.join(dir, "instalar.cmd"), "x\r\n");
    fs.writeFileSync(path.join(dir, "app", "node", "node.exe"), "binary");
    const zip = path.join(repo, "color-bms-0.2.0.zip");
    zipDirectory(dir, zip);
    const entries = unzipSync(fs.readFileSync(zip));
    expect(Object.keys(entries).sort()).toEqual([
      "color-bms-0.2.0/app/node/node.exe",
      "color-bms-0.2.0/instalar.cmd",
    ]);
    expect(Buffer.from(entries["color-bms-0.2.0/instalar.cmd"]!).toString()).toBe("x\r\n");
  });

  it("#26: node.exe is taken from the official Node zip, checked against the pinned SHA-256", () => {
    const zip = Buffer.from(
      zipSync({
        "node-v26.13.1-win-x64/node.exe": strToU8("MZ fake node"),
        "node-v26.13.1-win-x64/README.md": strToU8("readme"),
      }),
    );
    const sha = crypto.createHash("sha256").update(zip).digest("hex");
    expect(() => verifySha256(zip, sha)).not.toThrow();
    expect(() => verifySha256(zip, "0".repeat(64))).toThrow(/SHA-256/);
    expect(extractNodeExe(zip, "26.13.1").toString()).toBe("MZ fake node");
    expect(() => extractNodeExe(zip, "26.0.0")).toThrow(/node.exe/);
  });

  it("#26: the .cmd scripts are plain ASCII and call the bundled Node and CLI", () => {
    const dir = path.join(serverRoot, "pilot");
    const scripts = fs.readdirSync(dir).filter((name) => name.endsWith(".cmd"));
    expect(scripts.sort()).toEqual([
      "atualizar.cmd",
      "iniciar-uso-real.cmd",
      "iniciar.cmd",
      "instalar.cmd",
      "parar.cmd",
    ]);
    for (const name of scripts) {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const nonAscii = [...text].filter(
        (char) => char > "~" || (char < " " && !"\t\r\n".includes(char)),
      );
      expect(nonAscii, `${name} is ASCII`).toEqual([]);
      expect(text).toContain('"%~dp0app\\node\\node.exe" "%~dp0app\\server\\dist\\pilot\\cli.js"');
    }
  });
});
