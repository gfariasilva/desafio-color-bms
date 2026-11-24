import { describe, expect, it } from "vitest";
import { fixedExpenseSchema, homeAlertsResponseSchema } from "@color-bms/core";
import { createSale, TODAY, useSalesApp, type SalesContext } from "./sales-fixture";
import { closeDayWithCount } from "./cash-closing-fixture";
import { payEntry, postAction } from "./fixed-expenses-fixture";

/**
 * FR-27: GET /api/alerts, the database alerts of Início (Conta a vencer, Conta vencida, Dia
 * não fechado, Diferença de caixa). Backup pendente is GET /api/exports/status (FR-30).
 * The clock is 18/11/2026 15:00 in São Paulo. November's generated bills have no due date
 * (the seeded templates have no due day yet, Q-05), so they never alert.
 */

const ctx = useSalesApp();

async function getAlerts(c: SalesContext) {
  const response = await c.app.inject({ method: "GET", url: "/api/alerts" });
  expect(response.statusCode, response.body).toBe(200);
  return homeAlertsResponseSchema.parse(response.json());
}

/** A one-off bill (FR-11) through the API, pending. */
async function addBill(
  c: SalesContext,
  description: string,
  dueDate: string,
  referenceMonth = "2026-11",
  expectedAmountCents: number | null = 10000,
) {
  const response = await c.app.inject({
    method: "POST",
    url: "/api/fixed-expenses",
    payload: { referenceMonth, description, group: "general", dueDate, expectedAmountCents },
  });
  expect(response.statusCode, response.body).toBe(201);
  return fixedExpenseSchema.parse(response.json());
}

async function putSettings(
  c: SalesContext,
  input: { cashDifferenceLimitCents?: number; dueSoonDays?: number },
) {
  const response = await c.app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { oneDriveFolder: null, cashDifferenceLimitCents: 0, dueSoonDays: 3, ...input },
  });
  expect(response.statusCode, response.body).toBe(200);
}

/** A cash sale of R$ 25,00 on `date`, closed with `countedCashCents` (opening R$ 0,00). */
async function closeWithCount(c: SalesContext, date: string, countedCashCents: number) {
  await createSale(c, { date, grossCents: 2500 });
  await closeDayWithCount(c, date, { openingCashCents: 0, countedCashCents });
}

describe("FR-27: GET /api/alerts", () => {
  it("FR-27: nothing active → empty lists (Início shows Tudo em dia)", async () => {
    expect(await getAlerts(ctx)).toEqual({
      today: TODAY,
      dueSoonDays: 3,
      overdueBills: [],
      dueSoonBills: [],
      unclosedDays: [],
      cashDifference: null,
    });
  });

  it("FR-27: Conta a vencer lists pending bills due from today to today + 3, by due date", async () => {
    const internet = await addBill(ctx, "Internet", "2026-11-21");
    const luz = await addBill(ctx, "Luz avulsa", TODAY, "2026-11", null);
    await addBill(ctx, "Água", "2026-11-22"); // today + 4: not yet

    const alerts = await getAlerts(ctx);
    expect(alerts.dueSoonBills).toEqual([
      {
        id: luz.id,
        label: "Luz avulsa",
        referenceMonth: "2026-11",
        dueDate: TODAY,
        expectedAmountCents: null,
      },
      {
        id: internet.id,
        label: "Internet",
        referenceMonth: "2026-11",
        dueDate: "2026-11-21",
        expectedAmountCents: 10000,
      },
    ]);
    expect(alerts.overdueBills).toEqual([]);
  });

  it("FR-27: Conta vencida lists pending bills due before today, also of an earlier month", async () => {
    const october = await addBill(ctx, "IPTU outubro", "2026-10-20", "2026-10");
    const yesterday = await addBill(ctx, "Contador", "2026-11-17");

    const alerts = await getAlerts(ctx);
    expect(alerts.overdueBills.map((bill) => [bill.id, bill.label, bill.referenceMonth])).toEqual([
      [october.id, "IPTU outubro", "2026-10"],
      [yesterday.id, "Contador", "2026-11"],
    ]);
    expect(alerts.dueSoonBills).toEqual([]);
  });

  it("FR-27: paid and dismissed bills never alert", async () => {
    const paid = await addBill(ctx, "Internet", "2026-11-10");
    const dismissed = await addBill(ctx, "Água", "2026-11-19");
    await payEntry(ctx, paid.id, { paymentDate: "2026-11-10" });
    const response = await postAction(ctx, dismissed.id, "dismiss");
    expect(response.statusCode, response.body).toBe(200);

    const alerts = await getAlerts(ctx);
    expect(alerts.overdueBills).toEqual([]);
    expect(alerts.dueSoonBills).toEqual([]);
  });

  it("FR-27/FR-33: Conta a vencer follows the configured days", async () => {
    await addBill(ctx, "Água", "2026-11-25");
    expect((await getAlerts(ctx)).dueSoonBills).toEqual([]);

    await putSettings(ctx, { dueSoonDays: 7 });
    const alerts = await getAlerts(ctx);
    expect(alerts.dueSoonDays).toBe(7);
    expect(alerts.dueSoonBills.map((bill) => bill.label)).toEqual(["Água"]);
  });

  it("FR-27: Dia não fechado lists earlier days with movement still open, not today", async () => {
    await createSale(ctx, { date: "2026-11-14" });
    await createSale(ctx, { date: "2026-11-17" });
    await createSale(ctx, { date: TODAY });
    await closeWithCount(ctx, "2026-11-16", 2500); // closed: not listed

    expect((await getAlerts(ctx)).unclosedDays).toEqual(["2026-11-14", "2026-11-17"]);
  });

  it("FR-27: Diferença de caixa: the last closing has a difference", async () => {
    await closeWithCount(ctx, "2026-11-17", 2000); // Falta de R$ 5,00

    expect((await getAlerts(ctx)).cashDifference).toEqual({
      date: "2026-11-17",
      differenceCents: -500,
      limitCents: 0,
    });
  });

  it("FR-27: Diferença de caixa looks only at the last closing", async () => {
    await closeWithCount(ctx, "2026-11-16", 2000); // older closing with a difference
    await closeWithCount(ctx, "2026-11-17", 2500); // last closing: no difference

    expect((await getAlerts(ctx)).cashDifference).toBeNull();
  });

  it("FR-27/FR-09: a reopened day is not a closing; the one before it is the last", async () => {
    await closeWithCount(ctx, "2026-11-16", 3000); // Sobra de R$ 5,00
    await closeWithCount(ctx, "2026-11-17", 2500);
    const reopen = await ctx.app.inject({
      method: "POST",
      url: "/api/days/2026-11-17/reopen",
      payload: { reason: "Corrigir uma venda" },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);

    const alerts = await getAlerts(ctx);
    expect(alerts.cashDifference).toEqual({
      date: "2026-11-16",
      differenceCents: 500,
      limitCents: 0,
    });
    expect(alerts.unclosedDays).toEqual(["2026-11-17"]);
  });

  it("FR-27/FR-33: Diferença de caixa alerts only when |diferença| > the configured limit", async () => {
    await closeWithCount(ctx, "2026-11-17", 2000); // Falta de R$ 5,00
    await putSettings(ctx, { cashDifferenceLimitCents: 500 });
    expect((await getAlerts(ctx)).cashDifference).toBeNull();

    await putSettings(ctx, { cashDifferenceLimitCents: 499 });
    expect((await getAlerts(ctx)).cashDifference).toEqual({
      date: "2026-11-17",
      differenceCents: -500,
      limitCents: 499,
    });
  });
});
