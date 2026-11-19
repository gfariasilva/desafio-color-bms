import { defineConfig } from "tsup";

// Bundles the server (and @color-bms/core, which is TS source) into dist/main.js, plus the
// pilot launcher and the pilot scripts' CLI (#26) into dist/pilot/.
// better-sqlite3 is a native module, so it stays in node_modules.
export default defineConfig({
  entry: {
    main: "src/main.ts",
    "pilot/launcher": "src/pilot/launcher.ts",
    "pilot/cli": "src/pilot/cli.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node26",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@color-bms/core"],
  external: ["better-sqlite3"],
  // #26: the startup check "PC clock earlier than this version" (startup-checks.ts).
  define: { __COLOR_BMS_BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});
