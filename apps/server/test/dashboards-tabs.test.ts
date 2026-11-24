import { describe, expect, it } from "vitest";
import {
  auditListResponseSchema,
  incomeVsExpensesSchema,
  monthIncomeResponseSchema,
  tabRankingSchema,
  type IncomeVsExpenses,
  type TabRanking,
} from "@color-bms/core";
import { createCashWithdrawal } from "./cash-withdrawals-fixture";
import { createExpense } from "./expenses-fixture";
import { fixedEntry, payEntry } from "./fixed-expenses-fixture";
import { createSale, TODAY, useSalesApp } from "./sales-fixture";
import { getPeriodTotals } from "../src/modules/dashboards/dashboards.repository";

/**
 * FR-25 "Quais abas vendem mais?" and FR-26 "Estou ganhando mais do que gasto?" (RN-11).
 * The clock is 18/11/2026 (`useSalesApp`).
 */

const ctx = useSalesApp();

async function get(url: string) {
  return ctx.app.inject({ method: "GET", url });
}

async function getRanking(month: string): Promise<TabRanking> {
  const response = await get(`/api/dashboards/tab-ranking?month=${month}`);
  expect(response.statusCode, response.body).toBe(200);
  return tabRankingSchema.parse(response.json());
}

async function getChart(days?: number): Promise<IncomeVsExpenses> {
  const query = days === undefined ? "" : `?days=${days}`;
  const response = await get(`/api/dashboards/income-vs-expenses${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return incomeVsExpensesSchema.parse(response.json());
}

/**
 * Sales per tab in October and November:
 * - 01–18/10: Toner 1.000,00; Papelaria 300,00.
 * - 25/10: Chaveiro 200,00 (only in the whole month).
 * - 01–18/11: Toner 800,00 and a refund of 100,00 of October's Toner sale (today, RN-04);
 *   Papelaria 500,00; Chaveiro 50,00.
 * Expenses and sangrias never enter the ranking.
 */
async function seedTabs() {
  const toner = { saleCategoryId: ctx.ids.toner };
  const papelaria = { saleCategoryId: ctx.ids.papelaria };
  const chaveiro = { saleCategoryId: ctx.ids.chaveiro };
  const octoberToner = await createSale(ctx, { date: "2026-10-05", grossCents: 100000, ...toner });
  await createSale(ctx, { date: "2026-10-10", grossCents: 30000, ...papelaria });
  await createSale(ctx, { date: "2026-10-25", grossCents: 20000, ...chaveiro });
  await createSale(ctx, { date: "2026-11-03", grossCents: 80000, ...toner });
  await createSale(ctx, { date: "2026-11-11", grossCents: 50000, ...papelaria });
  await createSale(ctx, { date: TODAY, grossCents: 5000, ...chaveiro });
  const refund = await ctx.app.inject({
    method: "POST",
    url: `/api/sales/${octoberToner.id}/refunds`,
    payload: { refundCents: 10000, reason: "devolução" },
  });
  expect(refund.statusCode, refund.body).toBe(201);
  await createExpense(ctx, { paymentDate: "2026-11-04", amountCents: 4500 });
  await createCashWithdrawal(ctx, { date: TODAY, amountCents: 30000 });
}

const byName = (ranking: TabRanking, name: string) => {
  const found = ranking.tabs.find((t) => t.name === name);
  if (!found) throw new Error(`no tab ${name}`);
  return found;
};

describe("FR-25: Dashboard Quais abas vendem mais? (GET /api/dashboards/tab-ranking)", () => {
  it("FR-25: tabs appear in decreasing order of gross income, with % of total and variation", async () => {
    await seedTabs();
    const ranking = await getRanking("2026-11");

    expect(ranking).toMatchObject({
      yearMonth: "2026-11",
      previousMonth: "2026-10",
      partial: true,
      current: { from: "2026-11-01", to: TODAY },
      previous: { from: "2026-10-01", to: "2026-10-18" },
      // 800,00 − 100,00 + 500,00 + 50,00 against 1.000,00 + 300,00 (25/10 is after the 18th).
      totalCents: 125000,
      previousTotalCents: 130000,
      totalVariationTenths: -38, // −3,8 %
    });
    expect(ranking.tabs.slice(0, 3)).toEqual([
      expect.objectContaining({
        position: 1,
        name: "Toner",
        grossCents: 70000,
        shareTenths: 560, // 56,0 %
        previousCents: 100000,
        variationTenths: -300, // −30,0 %
      }),
      expect.objectContaining({
        position: 2,
        name: "Papelaria",
        grossCents: 50000,
        shareTenths: 400,
        previousCents: 30000,
        variationTenths: 667, // +66,7 %
      }),
      expect.objectContaining({
        position: 3,
        name: "Chaveiro",
        grossCents: 5000,
        shareTenths: 40,
        previousCents: 0,
        variationTenths: null, // RN-11: "—"
      }),
    ]);
    // Every active tab is listed (RN-12: 9 tabs), in decreasing order.
    expect(ranking.tabs).toHaveLength(9);
    const grosses = ranking.tabs.map((t) => t.grossCents);
    expect(grosses).toEqual([...grosses].sort((a, b) => b - a));
  });

  it("FR-25: a past month is compared whole, and its total equals Relatório Mês – Entradas (FR-20)", async () => {
    await seedTabs();
    const ranking = await getRanking("2026-10");
    expect(ranking).toMatchObject({
      partial: false,
      current: { from: "2026-10-01", to: "2026-10-31" },
      previous: { from: "2026-09-01", to: "2026-09-30" },
      totalCents: 150000,
      previousTotalCents: 0,
      totalVariationTenths: null,
    });
    expect(ranking.tabs.slice(0, 3).map((t) => [t.name, t.grossCents])).toEqual([
      ["Toner", 100000],
      ["Papelaria", 30000],
      ["Chaveiro", 20000],
    ]);
    expect(ranking.tabs.every((t) => t.variationTenths === null)).toBe(true);

    const report = monthIncomeResponseSchema.parse(
      (await get("/api/months/2026-10/reports/income")).json(),
    );
    expect(ranking.totalCents).toBe(report.total.grossCents);
    for (const tab of report.tabs) {
      expect(byName(ranking, tab.name).grossCents, tab.name).toBe(tab.totalCents);
    }
  });

  it("FR-25: an inactive tab with sales in the period is still listed", async () => {
    await createSale(ctx, {
      date: "2026-11-05",
      grossCents: 1234,
      saleCategoryId: ctx.ids.chaveiro,
    });
    const response = await ctx.app.inject({
      method: "PATCH",
      url: `/api/sale-categories/${ctx.ids.chaveiro}`,
      payload: { active: false },
    });
    expect(response.statusCode, response.body).toBe(200);

    const ranking = await getRanking("2026-11");
    expect(ranking.tabs[0]).toMatchObject({ name: "Chaveiro", active: false, grossCents: 1234 });
    expect(ranking.tabs).toHaveLength(9);
  });

  it("FR-25: rejects a month after today's and an invalid month (pt-BR)", async () => {
    for (const [url, error] of [
      ["/api/dashboards/tab-ranking?month=2026-12", "Escolha um mês até o atual."],
      ["/api/dashboards/tab-ranking?month=11-2026", "Mês inválido."],
      ["/api/dashboards/tab-ranking", "Mês inválido."],
    ] as const) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(400);
      expect(response.json()).toEqual({ error });
    }
  });
});

/**
 * Movement around the 30-day window (20/10–18/11):
 * - 19/10 (outside): a sale of 999,00 and an expense of 99,00.
 * - 20/10: a sale of 100,00.
 * - 03/11: a sale of 250,00 and a general expense of 40,00.
 * - 10/11: Luz paid, 187,43 (RN-09). November's other bills are pending (they stay out).
 * - 18/11: a sale of 30,00 and a sangria (internal movement, stays out).
 */
async function seedWindow() {
  await createSale(ctx, { date: "2026-10-19", grossCents: 99900 });
  await createExpense(ctx, { paymentDate: "2026-10-19", amountCents: 9900 });
  await createSale(ctx, { date: "2026-10-20", grossCents: 10000 });
  await createSale(ctx, { date: "2026-11-03", grossCents: 25000 });
  await createExpense(ctx, { paymentDate: "2026-11-03", amountCents: 4000, paymentMeans: "pix" });
  await payEntry(ctx, (await fixedEntry(ctx, "Luz")).id);
  await createSale(ctx, { date: TODAY, grossCents: 3000 });
  await createCashWithdrawal(ctx, { date: TODAY, amountCents: 20000 });
}

describe("FR-26: Dashboard Estou ganhando mais do que gasto? (GET /api/dashboards/income-vs-expenses)", () => {
  it("FR-26: 30 days → days without movement are zero, and the totals match the sum of the bars", async () => {
    await seedWindow();
    const chart = await getChart(30);

    expect(chart).toMatchObject({ today: TODAY, days: 30, from: "2026-10-20", to: TODAY });
    expect(chart.daily).toHaveLength(30);
    expect(chart.daily[0]).toEqual({
      date: "2026-10-20",
      incomeCents: 10000,
      expensesCents: 0,
      differenceCents: 10000,
    });
    expect(chart.daily.find((d) => d.date === "2026-11-03")).toMatchObject({
      incomeCents: 25000,
      expensesCents: 4000,
    });
    expect(chart.daily.find((d) => d.date === "2026-11-10")).toMatchObject({
      incomeCents: 0,
      expensesCents: 18743,
    });
    expect(chart.daily.at(-1)).toMatchObject({ date: TODAY, incomeCents: 3000, expensesCents: 0 });
    const zeroDays = chart.daily.filter((d) => d.incomeCents === 0 && d.expensesCents === 0);
    expect(zeroDays).toHaveLength(26);

    const sum = (key: "incomeCents" | "expensesCents") =>
      chart.daily.reduce((total, day) => total + day[key], 0);
    expect(chart.totals).toEqual({
      incomeCents: sum("incomeCents"),
      expensesCents: sum("expensesCents"),
      differenceCents: sum("incomeCents") - sum("expensesCents"),
    });
    expect(chart.totals).toEqual({
      incomeCents: 38000,
      expensesCents: 22743,
      differenceCents: 15257,
    });

    // The same rules as the month reports (RN-06, RN-08, RN-09).
    const period = getPeriodTotals(ctx.connection.db, chart.from, chart.to);
    expect(chart.totals.incomeCents).toBe(period.grossCents);
    expect(chart.totals.expensesCents).toBe(
      period.generalExpensesCents + period.fixedExpensesCents,
    );
  });

  it("FR-26: 7 days (the default) covers 12/11–18/11", async () => {
    await seedWindow();
    const chart = await getChart();
    expect(chart).toMatchObject({ days: 7, from: "2026-11-12", to: TODAY });
    expect(chart.daily.map((d) => d.date)).toEqual([
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
    ]);
    expect(chart.totals).toEqual({ incomeCents: 3000, expensesCents: 0, differenceCents: 3000 });
    expect(await getChart(7)).toEqual(chart);
  });

  it("FR-26: a refund lowers the day's income", async () => {
    const sale = await createSale(ctx, { date: "2026-11-17", grossCents: 5000 });
    const refund = await ctx.app.inject({
      method: "POST",
      url: `/api/sales/${sale.id}/refunds`,
      payload: { refundCents: 2000, reason: "devolução" },
    });
    expect(refund.statusCode, refund.body).toBe(201);
    const chart = await getChart(7);
    expect(chart.daily.at(-1)).toMatchObject({ date: TODAY, incomeCents: -2000 });
    expect(chart.totals.incomeCents).toBe(3000);
  });

  it("FR-26: rejects a window other than 7 or 30 days (pt-BR)", async () => {
    for (const days of ["14", "abc", "0"]) {
      const response = await get(`/api/dashboards/income-vs-expenses?days=${days}`);
      expect(response.statusCode, days).toBe(400);
      expect(response.json()).toEqual({ error: "Escolha 7 ou 30 dias." });
    }
  });
});

describe("FR-25, FR-26: read-only", () => {
  it("FR-25, FR-26: the dashboards write no audit rows", async () => {
    await createSale(ctx, { date: "2026-11-05", grossCents: 10000 });
    const count = async () =>
      auditListResponseSchema.parse((await get("/api/audit")).json()).entries.length;
    const before = await count();
    await getRanking("2026-11");
    await getChart(30);
    expect(await count()).toBe(before);
  });
});
