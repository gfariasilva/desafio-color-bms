import { defineConfig } from "tsup";

// Bundles the server (and @color-bms/core, which is TS source) into dist/main.js.
// better-sqlite3 is a native module, so it stays in node_modules.
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node26",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@color-bms/core"],
  external: ["better-sqlite3"],
});
