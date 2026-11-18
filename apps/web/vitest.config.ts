import path from "node:path";
import { defineProject } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

export default defineProject({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    name: "web",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
