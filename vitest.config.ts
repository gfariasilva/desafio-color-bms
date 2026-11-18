import { defineConfig } from "vitest/config";

// Runs every workspace's own vitest.config.ts from the root: `npm test`.
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
  },
});
