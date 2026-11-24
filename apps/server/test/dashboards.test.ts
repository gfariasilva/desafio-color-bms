import { describe, expect, it } from "vitest";
import {
  auditListResponseSchema,
  fixedExpenseSchema,
  monthComparisonSchema,
  monthSummarySchema,
  type FixedExpense,
  type MonthComparison,
} from "@color-bms/core";
import { createCashWithdrawal } from "./cash-withdrawals-fixture";
import { createExpense, expenseCategoryId } from "./expenses-fixture";
import { fixedEntry, payEntry } from "./fixed-expenses-fixture";
import { createFee, createSale, TODAY, useSalesApp, type SalesContext } from "./sales-fixture";
import { getPeriodTotals } from "../src/modules/dashboards/dashboards.repository";
import { getMonthSummary } from "../src/modules/reports/month-reports.repository";

/**
 * FR-24: Dashboard "Como está este mês comparado ao anterior?" (RN-10, RN-11, A-13).
 * The clock is 18/11/2026 (`useSalesApp`), so the dashboard compares 01–18/11 with 01–18/10.
 */

const ctx = useSalesApp();

async function getComparison(): Promise<MonthComparison> {
  const response = await ctx.app.inject({
    method: "GET",
    url: "/api/dashboards/month-comparison",
  });
  expect(response.statusCode, response.body).toBe(200);
  return monthComparisonSchema.parse(response.json());
}

async function getSummary(yearMonth: string) {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/api/months/${yearMonth}/reports/summary`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return monthSummarySchema.parse(response.json());
}

const indicator = (comparison: MonthComparison, key: string) => {
  const found = comparison.indicators.find((i) => i.key === key);
  if (!found) throw new Error(`no indicator ${key}`);
  return found;
};

/** A one-off fixed bill of `referenceMonth`, paid when `paid` is given (FR-11, FR-12). */
async function bill(
  c: SalesContext,
  input: { referenceMonth: string; description: string; paid?: { cents: number; on: string } },
): Promise<FixedExpense> {
  const response = await c.app.inject({
    method: "POST",
    url: "/api/fixed-expenses",
    payload: {
      referenceMonth: input.referenceMonth,
      description: input.description,
      group: "general",
      dueDate: `${input.referenceMonth}-10`,
      expectedAmountCents: 20000,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const created = fixedExpenseSchema.parse(response.json());
  if (!input.paid) return created;
  return payEntry(c, created.id, { amountCents: input.paid.cents, paymentDate: input.paid.on });
}

/**
 * October and November with movement inside and outside the compared days:
 * - 01–18/10: sales 1.000,00 (cash) + 150,00 (credit, fee 5,69); Kalunga 200,00; Luz 180,00.
 * - 19–31/10: a sale of 500,00, an expense of 70,00 and a bill of 90,00 (only in the reference).
 * - 01–18/11: sales 1.200,00 + 150,00 (fee 5,69); a refund of 100,00 of an October sale
 *   (dated today, RN-04); Alimentação 45,00; Luz 187,43. Pending bills and sangrias stay out.
 */
async function seedOctoberAndNovember(c: SalesContext) {
  await createFee(c); // Mercado Pago credit at 3,79 % (RN-03 example).
  const credit = { paymentMethodId: c.ids.credit, cardMachineId: c.ids.mercadoPago };
  const kalunga = await expenseCategoryId(c, "Kalunga");

  // October, inside 01–18.
  const octoberSale = await createSale(c, { date: "2026-10-05", grossCents: 100000 });
  await createSale(c, { date: "2026-10-18", grossCents: 15000, ...credit });
  await createExpense(c, {
    paymentDate: "2026-10-10",
    expenseCategoryId: kalunga,
    amountCents: 20000,
    paymentMeans: "pix",
  });
  await bill(c, {
    referenceMonth: "2026-10",
    description: "Luz outubro",
    paid: { cents: 18000, on: "2026-10-15" },
  });
  // October, after the 18th: only in the full-month reference.
  await createSale(c, { date: "2026-10-19", grossCents: 50000 });
  await createExpense(c, { paymentDate: "2026-10-25", amountCents: 7000, paymentMeans: "pix" });
  await bill(c, {
    referenceMonth: "2026-10",
    description: "Água outubro",
    paid: { cents: 9000, on: "2026-10-30" },
  });
  await createCashWithdrawal(c, { date: "2026-10-05", amountCents: 40000 });

  // November, 01–18.
  await createSale(c, { date: "2026-11-03", grossCents: 120000 });
  await createSale(c, { date: TODAY, grossCents: 15000, ...credit });
  const refund = await c.app.inject({
    method: "POST",
    url: `/api/sales/${octoberSale.id}/refunds`,
    payload: { refundCents: 10000, reason: "devolução" },
  });
  expect(refund.statusCode, refund.body).toBe(201);
  await createExpense(c, {
    paymentDate: "2026-11-12",
    expenseCategoryId: await expenseCategoryId(c, "Alimentação"),
    amountCents: 4500,
    paymentMeans: "pix",
  });
  const luz = await fixedEntry(c, "Luz");
  await payEntry(c, luz.id); // R$ 187,43 on 10/11.
  await createCashWithdrawal(c, { date: TODAY, amountCents: 30000 });
}

describe("FR-24: Dashboard este mês × mês anterior (GET /api/dashboards/month-comparison)", () => {
  it("FR-24: on 18/11 compares 01–18/11 with 01–18/10", async () => {
    await seedOctoberAndNovember(ctx);
    const comparison = await getComparison();

    expect(comparison).toMatchObject({
      today: TODAY,
      currentMonth: "2026-11",
      previousMonth: "2026-10",
      current: { from: "2026-11-01", to: "2026-11-18" },
      previous: { from: "2026-10-01", to: "2026-10-18" },
      previousMonthHasData: true,
    });

    // Entrada mensal (RN-06): 1.200,00 + 150,00 − 100,00 (refund) vs 1.000,00 + 150,00.
    expect(indicator(comparison, "gross")).toMatchObject({
      currentCents: 125000,
      previousCents: 115000,
      variationTenths: 87, // +8,7 %
    });
    // Taxas: one credit sale of R$ 150,00 in each period (the cash refund has no fee).
    expect(indicator(comparison, "fee")).toMatchObject({
      currentCents: 569,
      previousCents: 569,
      variationTenths: 0,
    });
    // Total de despesas (RN-10): general (RN-08) + paid fixed (RN-09). Sangrias stay out.
    expect(indicator(comparison, "totalExpenses")).toMatchObject({
      currentCents: 4500 + 18743,
      previousCents: 20000 + 18000,
      variationTenths: -388, // 23.243 vs 38.000 → −38,8 %
    });
    // Saldo (RN-10).
    expect(indicator(comparison, "balance")).toMatchObject({
      currentCents: 125000 - 569 - 23243,
      previousCents: 115000 - 569 - 38000,
      variationTenths: 324, // 101.188 vs 76.431 → +32,4 %
    });
  });

  it("FR-24: the full previous month equals October's Resumo mensal (FR-23)", async () => {
    await seedOctoberAndNovember(ctx);
    const comparison = await getComparison();
    const october = await getSummary("2026-10");

    expect(october.grossCents).toBe(115000 + 50000);
    expect(indicator(comparison, "gross").previousMonthTotalCents).toBe(october.grossCents);
    expect(indicator(comparison, "fee").previousMonthTotalCents).toBe(october.feeCents);
    expect(indicator(comparison, "totalExpenses").previousMonthTotalCents).toBe(
      october.totalExpensesCents,
    );
    expect(indicator(comparison, "balance").previousMonthTotalCents).toBe(october.balanceCents);
  });

  it("FR-24: period totals over a whole month equal the month's summary (RN-06, RN-08, RN-09)", async () => {
    await seedOctoberAndNovember(ctx);
    const db = ctx.connection.db;
    for (const [yearMonth, last] of [
      ["2026-10", "31"],
      ["2026-11", "30"],
    ] as const) {
      const summary = getMonthSummary(db, yearMonth, TODAY);
      expect(getPeriodTotals(db, `${yearMonth}-01`, `${yearMonth}-${last}`)).toEqual({
        grossCents: summary.grossCents,
        feeCents: summary.feeCents,
        generalExpensesCents: summary.generalExpensesCents,
        fixedExpensesCents: summary.fixedExpensesCents,
        movementCount: expect.any(Number),
      });
    }
  });

  it("FR-24: a pending or dismissed bill and a sangria are no movement", async () => {
    // November's generated bills are pending; a sangria in October is internal movement.
    await createCashWithdrawal(ctx, { date: "2026-10-05", amountCents: 40000 });
    await bill(ctx, { referenceMonth: "2026-10", description: "IPTU" });
    expect(getPeriodTotals(ctx.connection.db, "2026-10-01", "2026-10-31").movementCount).toBe(0);
    expect((await getComparison()).previousMonthHasData).toBe(false);
  });

  it('FR-24: no data in the previous month → every variation is "—" with the note', async () => {
    // First month of use: only November has movement.
    await createSale(ctx, { date: "2026-11-03", grossCents: 120000 });
    await createExpense(ctx, { paymentDate: "2026-11-04", amountCents: 4500 });

    const comparison = await getComparison();
    expect(comparison.previousMonthHasData).toBe(false);
    expect(comparison.indicators.map((i) => i.key)).toEqual([
      "gross",
      "fee",
      "totalExpenses",
      "balance",
    ]);
    expect(comparison.indicators.map((i) => i.variationTenths)).toEqual([null, null, null, null]);
    expect(comparison.indicators.map((i) => i.previousCents)).toEqual([0, 0, 0, 0]);
    expect(indicator(comparison, "gross").currentCents).toBe(120000);
    expect(indicator(comparison, "balance").currentCents).toBe(120000 - 4500);
  });

  it("FR-24: an October with only a few days of data still compares (RN-11 per indicator)", async () => {
    // October has a sale after the 18th only: data in the month, nothing in 01–18/10.
    await createSale(ctx, { date: "2026-10-25", grossCents: 30000 });
    await createSale(ctx, { date: "2026-11-03", grossCents: 50000 });

    const comparison = await getComparison();
    expect(comparison.previousMonthHasData).toBe(true);
    expect(indicator(comparison, "gross")).toMatchObject({
      currentCents: 50000,
      previousCents: 0,
      variationTenths: null,
      previousMonthTotalCents: 30000,
    });
  });

  it("FR-24: the dashboard is read-only (no audit rows)", async () => {
    await createSale(ctx, { date: "2026-10-05", grossCents: 10000 });
    const before = auditListResponseSchema.parse(
      (await ctx.app.inject({ method: "GET", url: "/api/audit" })).json(),
    ).entries.length;
    await getComparison();
    const after = auditListResponseSchema.parse(
      (await ctx.app.inject({ method: "GET", url: "/api/audit" })).json(),
    ).entries.length;
    expect(after).toBe(before);
  });
});
