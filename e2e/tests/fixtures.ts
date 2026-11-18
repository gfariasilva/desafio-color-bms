import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { CardFeeInput, CardMachine, PaymentMethod, SaleCategory } from "@color-bms/core";

/**
 * Test clock (ADR 0002): every server starts at 18/11/2026 15:00 in São Paulo and advances in
 * real time from there. Only honoured with NODE_ENV=test.
 */
export const TEST_NOW = "2026-11-18T18:00:00.000Z";
export const TODAY = "2026-11-18";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serverEntry = path.join(repoRoot, "apps/server/dist/main.js");

interface ServerInfo {
  baseURL: string;
  dataDir: string;
}

/** Ids of the RN-12 lists, looked up by name through the public API. */
export interface Catalog {
  tab: (name: string) => number;
  method: (name: string) => number;
  machine: (name: string) => number;
}

async function waitForHealth(baseURL: string, child: ChildProcess, log: () => string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${log()}`);
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start in 15 s:\n${log()}`);
}

export const test = base.extend<
  { catalog: Catalog; api: APIRequestContext },
  { server: ServerInfo }
>({
  // One server per worker: its own port and a fresh, migrated database (ADR 0002).
  server: [
    // eslint-disable-next-line no-empty-pattern -- Playwright needs the object pattern here
    async ({}, use, workerInfo) => {
      if (!fs.existsSync(serverEntry)) {
        throw new Error(
          "apps/server/dist/main.js is missing: run `npm run e2e` (it builds first).",
        );
      }
      const port = 3300 + workerInfo.workerIndex;
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-e2e-"));
      let output = "";
      const child = spawn(process.execPath, [serverEntry], {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: String(port),
          COLOR_BMS_DATA_DIR: dataDir,
          COLOR_BMS_NOW: TEST_NOW,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
      const baseURL = `http://127.0.0.1:${port}`;
      try {
        await waitForHealth(baseURL, child, () => output);
        await use({ baseURL, dataDir });
      } finally {
        child.kill();
        await new Promise((resolve) => child.once("exit", resolve));
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],

  baseURL: async ({ server }, use) => use(server.baseURL),

  api: async ({ playwright, server }, use) => {
    const context = await playwright.request.newContext({ baseURL: server.baseURL });
    await use(context);
    await context.dispose();
  },

  catalog: async ({ api }, use) => {
    const tabs = (
      (await (await api.get("/api/sale-categories")).json()) as {
        categories: SaleCategory[];
      }
    ).categories;
    const methods = (
      (await (await api.get("/api/payment-methods")).json()) as {
        paymentMethods: PaymentMethod[];
      }
    ).paymentMethods;
    const machines = (
      (await (await api.get("/api/card-machines")).json()) as {
        cardMachines: CardMachine[];
      }
    ).cardMachines;
    const find = (list: { id: number; name: string }[], name: string) => {
      const item = list.find((entry) => entry.name === name);
      if (!item) throw new Error(`"${name}" not found`);
      return item.id;
    };
    await use({
      tab: (name) => find(tabs, name),
      method: (name) => find(methods, name),
      machine: (name) => find(machines, name),
    });
  },
});

export { expect };

/** Adds a fee row through the public API, as the owner would on Tabela de taxas. */
export async function createFee(api: APIRequestContext, input: CardFeeInput): Promise<void> {
  const response = await api.post("/api/card-fees", { data: input });
  // 409 = the same row already exists from an earlier test in this worker.
  expect([201, 409]).toContain(response.status());
}

/**
 * Closes a day by writing its row directly. The cash closing (#9) will do this through the
 * API; this is test setup, not a test-only endpoint (ADR 0002).
 */
export function closeDay(server: ServerInfo, date: string): void {
  const db = new Database(path.join(server.dataDir, "color.db"));
  try {
    db.prepare("insert or replace into days (date, status, closed_at) values (?, 'closed', ?)").run(
      date,
      TEST_NOW,
    );
  } finally {
    db.close();
  }
}

/** Opens Vendas and waits until the form is ready (focus on Valor, date filled). */
export async function openSales(page: Page): Promise<void> {
  await page.goto("/vendas");
  await expect(page.getByLabel("Valor (R$)")).toBeFocused();
  await expect(page.getByRole("radio", { name: /Toner/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Dinheiro/ })).toBeVisible();
  await expect(page.getByLabel("Data")).toHaveValue(TODAY);
}

/** Presses keys one by one; returns how many keystrokes were used (CS-2 budget). */
export async function pressKeys(page: Page, keys: readonly string[], delayMs = 0): Promise<number> {
  for (const key of keys) {
    await page.keyboard.press(key);
    if (delayMs) await page.waitForTimeout(delayMs);
  }
  return keys.length;
}

/** "150" → ["1", "5", "0"]: typing a value costs one keystroke per character. */
export function chars(text: string): string[] {
  return [...text];
}
