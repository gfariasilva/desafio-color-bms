import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "server",
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Server tests are integration tests on real files: SQLite with synchronous=FULL, .xlsx
    // and backups written with fsync (§7.4). The slowest takes ~1.3 s on CI, but a slow
    // Windows runner was 2-4x slower on disk (PR #32: one test passed 5 s, four took 3.5-4.1 s).
    // Vitest's 5 s default is too tight for that; a test that hangs still fails.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
