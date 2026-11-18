import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests against the **built** app (ADR 0002). `npm run e2e` builds first.
 * Each worker starts its own server and database (see tests/fixtures.ts).
 *
 * Browser:
 * - default: Playwright's Chromium; `PW_CHROMIUM_PATH` points to another Chromium binary
 *   (e.g. /opt/pw-browsers/chromium in the cloud dev container) instead of downloading one;
 * - `PW_CHANNEL=msedge`: Microsoft Edge, the owner's browser (NFR-02), on Windows CI.
 */
const channel = process.env.PW_CHANNEL;
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./tests",
  // A flaky test is a bug to fix, not to retry (ADR 0002).
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "off",
    ...(channel ? { channel } : {}),
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
});
