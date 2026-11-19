import type { APIRequestContext } from "@playwright/test";
import { chars, expect, pressKeys, test, type Catalog } from "./fixtures";

/**
 * FR-16 / FR-17 (close and reopen the month) in the real built app, keyboard only after the
 * page loads (ADR 0002). It uses July 2026, a month no other test touches, and reopens it at
 * the end, so tests sharing the worker's database are never locked out.
 */

async function post(api: APIRequestContext, url: string, data: unknown, status = 201) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
}

async function cashSale(api: APIRequestContext, catalog: Catalog, date: string, cents: number) {
  await post(api, "/api/sales", {
    date,
    saleCategoryId: catalog.tab("Toner"),
    paymentMethodId: catalog.method("Dinheiro"),
    grossCents: cents,
  });
}

test("FR-16 / FR-17: close the pending day, close the month, then reopen it, keyboard only", async ({
  page,
  api,
  catalog,
}) => {
  // 10/07 closed with R$ 125,00 counted; 31/07 has a R$ 50,00 cash sale and is still open.
  await cashSale(api, catalog, "2026-07-10", 2500);
  await post(
    api,
    "/api/days/2026-07-10/close",
    { openingCashCents: 10000, countedCashCents: 12500 },
    200,
  );
  await cashSale(api, catalog, "2026-07-31", 5000);

  await page.goto("/fechamento?data=2026-07-31");
  const month = page.getByRole("region", { name: "Fechamento do mês" });
  await expect(month.getByText("julho de 2026", { exact: false })).toBeVisible();

  // FR-16: the pending day is listed (a link to its closing) and there is no "Fechar mês".
  const pending = month.getByRole("list", { name: "Dias pendentes" });
  await expect(pending.getByRole("link", { name: "31/07/2026" })).toBeVisible();
  await expect(month.getByRole("button", { name: "Fechar mês" })).toHaveCount(0);

  // Close 31/07: troco 125,00 (A-12) → Tab → contado 175 → Enter (no difference).
  const opening = page.getByLabel("Troco inicial (R$)");
  await opening.focus();
  await expect(opening).toHaveValue("125,00");
  await pressKeys(page, ["Tab", ...chars("175"), "Enter"]);
  const day = page.getByRole("region", { name: "Fechamento de caixa" });
  await expect(day.getByRole("status")).toHaveText("Dia 31/07/2026 fechado.");

  // FR-16: now the month can be closed. Enter opens "Tem certeza?", Enter confirms.
  const closeButton = month.getByRole("button", { name: "Fechar mês" });
  await closeButton.focus();
  await page.keyboard.press("Enter");
  await expect(month.getByRole("group", { name: "Fechar o mês" })).toContainText("Tem certeza?");
  await expect(month.getByRole("button", { name: "Confirmar fechamento" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(month.getByRole("status")).toHaveText("Mês 07/2026 fechado.");
  await expect(month.getByText("Mês fechado")).toBeVisible();

  // RN-14: the day cannot be reopened while its month is closed (FR-17 first).
  await expect(
    day.getByText("O mês 07/2026 está fechado. Reabra o mês antes de reabrir o dia."),
  ).toBeVisible();
  await expect(day.getByRole("button", { name: "Reabrir dia" })).toHaveCount(0);
  // … and no sale can be added to it.
  const sale = await api.post("/api/sales", {
    data: {
      date: "2026-07-15",
      saleCategoryId: catalog.tab("Toner"),
      paymentMethodId: catalog.method("Dinheiro"),
      grossCents: 1000,
    },
  });
  expect(sale.status()).toBe(409);

  // FR-17: "Reabrir mês" → reason → Enter. The days stay closed but can be reopened again.
  await month.getByRole("button", { name: "Reabrir mês" }).focus();
  await page.keyboard.press("Enter");
  await expect(month.getByLabel("Motivo da reabertura")).toBeFocused();
  await page.keyboard.type("venda esquecida");
  await page.keyboard.press("Enter");
  await expect(month.getByRole("status")).toContainText("Mês 07/2026 reaberto.");
  await expect(month.getByRole("button", { name: "Fechar mês" })).toBeVisible();
  await expect(day.getByRole("button", { name: "Reabrir dia" })).toBeVisible();

  // FR-18: both actions are in the audit log, the reopening with its reason.
  const audit = (await (await api.get("/api/audit?entity=month")).json()) as {
    entries: { entityId: string; action: string; reason: string | null }[];
  };
  const july = audit.entries.filter((entry) => entry.entityId === "2026-07");
  expect(july.map((entry) => entry.action).sort()).toEqual(["close", "reopen"]);
  expect(july.find((entry) => entry.action === "reopen")?.reason).toBe("venda esquecida");
});
