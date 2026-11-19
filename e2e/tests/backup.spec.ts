import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "./fixtures";

/**
 * #25 (pilot slice of FR-31) in the real built app: the server backs up to the OneDrive folder
 * on its first start of the day and after each day closing. The failure cases (missing folder,
 * pre-migration backup) are covered by the server's integration tests.
 */

/** Backup files in the worker's _backup-sistema folder (the server's clock starts 18/11/2026). */
function backups(oneDriveDir: string): string[] {
  const dir = path.join(oneDriveDir, "_backup-sistema");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".db")) : [];
}

/** The status of `date` in the newest backup file, read like the owner's restore would. */
function dayStatusInLatestBackup(oneDriveDir: string, date: string): string | null {
  const latest = backups(oneDriveDir).sort().at(-1);
  if (!latest) return null;
  const db = new Database(path.join(oneDriveDir, "_backup-sistema", latest), { readonly: true });
  try {
    const row = db.prepare("select status from days where date = ?").get(date) as
      { status: string } | undefined;
    return row?.status ?? null;
  } finally {
    db.close();
  }
}

test("FR-31 (#25): the first start of the day writes a backup, shown on Início", async ({
  page,
  server,
}) => {
  expect(backups(server.oneDriveDir)).toContainEqual(
    expect.stringMatching(/^color-2026-11-18_\d{4}\.db$/),
  );

  await page.goto("/");
  await expect(page.getByText("Último backup")).toBeVisible();
  await expect(page.getByText(/^18\/11\/2026 \d{2}:\d{2}$/).first()).toBeVisible();
  await expect(page.getByText(/Backup pendente/)).toHaveCount(0);
});

test("FR-31 (#25): closing a day writes a backup that holds the closed day", async ({
  api,
  catalog,
  server,
}) => {
  const date = "2026-08-11";
  const sale = await api.post("/api/sales", {
    data: {
      date,
      saleCategoryId: catalog.tab("Toner"),
      paymentMethodId: catalog.method("Dinheiro"),
      grossCents: 1234,
    },
  });
  expect(sale.status(), await sale.text()).toBe(201);
  const closing = await api.post(`/api/days/${date}/close`, {
    data: { openingCashCents: 0, countedCashCents: 1234 },
  });
  expect(closing.status(), await closing.text()).toBe(200);

  // The backup runs right after the closing answers.
  await expect.poll(() => dayStatusInLatestBackup(server.oneDriveDir, date)).toBe("closed");
});
