import type { Page } from "@playwright/test";
import { chars, createFee, expect, openSales, pressKeys, test } from "./fixtures";

/**
 * CS-2 as an automated budget (ADR 0002). The stopwatch test with the owner happens in #27;
 * this guards what the system controls. The budgets change only on purpose, in review.
 */
const CASH_SALE_BUDGET = 12;
const CARD_SALE_BUDGET = 15;
/** NFR-04: saving a sale answers in < 1 s. */
const SAVE_BUDGET_MS = 1000;
/** A slow beginner's typing pace. */
const KEY_DELAY_MS = 250;

/** "R$ 25,00 · Toner · Dinheiro": the typical cash sale. */
const CASH_SALE = [...chars("25"), "Tab", "7", "Tab", "1"];
/** "R$ 150,00 · Toner · Crédito · Mercado Pago · 3x": a typical card sale. */
const CARD_SALE = [...chars("150"), "Tab", "7", "Tab", "3", "Tab", "2", "Tab", "3"];

/** Types a sale, presses Enter and returns the keystrokes and the save time (Enter → saved). */
async function registerSale(page: Page, keys: readonly string[], delayMs = 0) {
  const typed = await pressKeys(page, keys, delayMs);
  const started = Date.now();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("registrada");
  const saveMs = Date.now() - started;
  await expect(page.getByLabel("Valor (R$)")).toBeFocused();
  return { keystrokes: typed + 1, saveMs };
}

test("CS-2: a typical cash sale needs ≤ 12 keystrokes and saves in < 1 s (NFR-04)", async ({
  page,
}) => {
  await openSales(page);
  const { keystrokes, saveMs } = await registerSale(page, CASH_SALE);
  expect(keystrokes).toBeLessThanOrEqual(CASH_SALE_BUDGET);
  expect(saveMs).toBeLessThan(SAVE_BUDGET_MS);
});

test("CS-2: a typical card sale needs ≤ 15 keystrokes and saves in < 1 s (NFR-04)", async ({
  page,
  api,
  catalog,
}) => {
  await createFee(api, {
    cardMachineId: catalog.machine("Mercado Pago"),
    paymentMethodId: catalog.method("Cartão de crédito"),
    installmentsFrom: 2,
    installmentsTo: 6,
    ratePpm: 37900,
    validFrom: "2026-01-01",
  });
  await openSales(page);
  const { keystrokes, saveMs } = await registerSale(page, CARD_SALE);
  expect(keystrokes).toBeLessThanOrEqual(CARD_SALE_BUDGET);
  expect(saveMs).toBeLessThan(SAVE_BUDGET_MS);
});

test("CS-2: 10 sales in a row at ~250 ms per key take ≤ 100 s (average ≤ 10 s)", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openSales(page);
  const started = Date.now();
  for (let sale = 0; sale < 10; sale++) {
    const { saveMs } = await registerSale(page, CASH_SALE, KEY_DELAY_MS);
    expect(saveMs, `sale ${sale + 1}`).toBeLessThan(SAVE_BUDGET_MS);
  }
  expect(Date.now() - started).toBeLessThanOrEqual(100_000);
});
