#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook: after Claude edits or writes a file, run Prettier and
 * ESLint (--fix) on THAT file only.
 *
 * - Receives the hook payload as JSON on stdin (tool_input.file_path).
 * - Exit 0: nothing to report. Exit 2: lint errors remain; stderr is shown to Claude so it
 *   fixes them right away.
 * - Uses the repo's own Prettier/ESLint via `node <bin>` so it works on Windows and Linux.
 * - Files Prettier/ESLint ignore (Markdown, migrations, dist…) are skipped silently.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const PRETTIER_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".html",
  ".yml",
  ".yaml",
]);
const ESLINT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

function run(projectDir, bin, args) {
  return spawnSync(process.execPath, [path.join(projectDir, bin), ...args], {
    cwd: projectDir,
    encoding: "utf8",
  });
}

const payload = JSON.parse((await readStdin()) || "{}");
const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const filePath = payload.tool_input?.file_path;

if (!filePath || !existsSync(filePath)) process.exit(0);

const relative = path.relative(projectDir, filePath);
if (relative.startsWith("..") || path.isAbsolute(relative)) process.exit(0); // outside the repo
if (relative.split(path.sep).includes("node_modules")) process.exit(0);

const ext = path.extname(filePath).toLowerCase();
const prettierBin = "node_modules/prettier/bin/prettier.cjs";
const eslintBin = "node_modules/eslint/bin/eslint.js";

if (!existsSync(path.join(projectDir, prettierBin))) process.exit(0); // deps not installed yet

if (PRETTIER_EXT.has(ext)) {
  // Respects .prettierignore (e.g. *.md, migrations meta).
  run(projectDir, prettierBin, ["--write", "--ignore-unknown", "--log-level", "warn", relative]);
}

if (ESLINT_EXT.has(ext)) {
  const result = run(projectDir, eslintBin, ["--fix", "--no-warn-ignored", relative]);
  if (result.status !== 0) {
    process.stderr.write(
      `ESLint found problems in ${relative} that --fix could not solve:\n${result.stdout}${result.stderr}`,
    );
    process.exit(2);
  }
}

process.exit(0);
