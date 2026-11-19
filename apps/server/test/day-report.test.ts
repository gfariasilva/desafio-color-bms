import { describe, expect, it } from "vitest";
import { dayReportResponseSchema } from "@color-bms/core";
import { closeDayWithCount, getCashClosing } from "./cash-closing-fixture";
import { createCashWithdrawal, getDayCashWithdrawals } from "./cash-withdrawals-fixture";
import { createExpense, expenseCategoryId, getDayExpenses } from "./expenses-fixture";
import { fixedEntry, payEntry } from "./fixed-expenses-fixture";
import { createFee, createSale, TODAY, useSalesApp, type SalesContext } from "./sales-fixture";

const ctx = useSalesApp();

async function getReport(date: string) {
  const response = await ctx.app.inject({ method: "GET", url: `/api/days/${date}/report` });
  expect(response.statusCode, response.body).toBe(200);
  return dayReportResponseSchema.parse(response.json());
}

async function getDaySales(date: string) {
  const response = await ctx.app.inject({ method: "GET", url: `/api/days/${date}/sales` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    tabs: {
      name: string;
      methods: {
        paymentMethodName: string;
        grossCents: number;
        feeCents: number;
        netCents: number;
      }[];
    }[];
    total: { grossCents: number; feeCents: number; netCents: number };
  };
}

/**
 * A full day: sales on 3 tabs and 3 methods (one with a 3,79% card fee), a refund, general
 * expenses (one from the till, one by PIX), a fixed expense paid from the till, a sangria,
 * and records on another day that must not show.
 */
async function seedDay(context: SalesContext) {
  const { ids } = context;
  await createFee(context, { ratePpm: 37900 });
  const credit = await createSale(context, {
    saleCategoryId: ids.toner,
    paymentMethodId: ids.credit,
    cardMachineId: ids.mercadoPago,
    installments: 1,
    grossCents: 15000,
  });
  await createSale(context, { saleCategoryId: ids.toner, grossCents: 2500 });
  await createSale(context, { saleCategoryId: ids.papelaria, grossCents: 1000 });
  await createSale(context, {
    saleCategoryId: ids.chaveiro,
    paymentMethodId: ids.pix,
    grossCents: 800,
  });
  await createSale(context, { saleCategoryId: ids.papelaria, grossCents: 3000 });
  // FR-04: a refund today of yesterday's cash sale (a sale of today is edited instead).
  const yesterdaySale = await createSale(context, {
    date: "2026-11-17",
    saleCategoryId: ids.papelaria,
    grossCents: 5000,
  });
  const refund = await context.app.inject({
    method: "POST",
    url: `/api/sales/${yesterdaySale.id}/refunds`,
    payload: { refundCents: 1000, reason: "troca" },
  });
  expect(refund.statusCode, refund.body).toBe(201);

  await createExpense(context, { amountCents: 4500, description: "gasolina" });
  await createExpense(context, {
    expenseCategoryId: await expenseCategoryId(context, "Alimentação"),
    amountCents: 2000,
    paymentMeans: "pix",
  });
  const luz = await fixedEntry(context, "Luz");
  await payEntry(context, luz.id, {
    amountCents: 12000,
    paymentDate: TODAY,
    paymentMeans: "cash",
    paidFromTill: true,
  });
  await createCashWithdrawal(context, { amountCents: 30000, note: "depósito no banco" });

  // Another day: never in this report.
  await createSale(context, { date: "2026-11-17", grossCents: 99999 });
  await createExpense(context, { paymentDate: "2026-11-17", amountCents: 777 });
  await createCashWithdrawal(context, { date: "2026-11-17", amountCents: 555 });
  return { credit };
}

describe("FR-19: the day report (GET /api/days/:date/report)", () => {
  it("FR-19: shows the tab × method matrix with gross, fee and net, and the totals (RN-05)", async () => {
    await seedDay(ctx);
    const report = await getReport(TODAY);
    const { matrix } = report;

    // Columns: the active payment methods, in display order.
    const column = (name: string) => matrix.methods.findIndex((m) => m.name === name);
    const cash = column("Dinheiro");
    const credit = column("Cartão de crédito");
    const pix = column("PIX/Depósito");
    expect(Math.min(cash, credit, pix)).toBeGreaterThanOrEqual(0);

    const row = (name: string) => matrix.tabs.find((tab) => tab.name === name)!;
    expect(row("Toner").cells[credit]).toEqual({
      grossCents: 15000,
      feeCents: 569,
      netCents: 14431,
    });
    expect(row("Toner").cells[cash]).toEqual({ grossCents: 2500, feeCents: 0, netCents: 2500 });
    expect(row("Toner").total).toEqual({ grossCents: 17500, feeCents: 569, netCents: 16931 });
    // Papelaria: 10,00 + 30,00 − 10,00 refunded = 30,00 in cash.
    expect(row("Papelaria").cells[cash]).toEqual({ grossCents: 3000, feeCents: 0, netCents: 3000 });
    expect(row("Chaveiro").cells[pix]!.grossCents).toBe(800);

    expect(matrix.methodTotals[cash]).toEqual({ grossCents: 5500, feeCents: 0, netCents: 5500 });
    expect(matrix.methodTotals[credit]).toEqual({
      grossCents: 15000,
      feeCents: 569,
      netCents: 14431,
    });
    expect(matrix.total).toEqual({ grossCents: 21300, feeCents: 569, netCents: 20731 });

    // Every active tab, in display order; tabs without sales at zero.
    expect(matrix.tabs).toHaveLength(9);
    expect(matrix.tabs.filter((tab) => tab.hasSales)).toHaveLength(3);
  });

  it("FR-19: lists the day's expenses (general and fixed) and sangrias, and nothing from other days", async () => {
    await seedDay(ctx);
    const report = await getReport(TODAY);

    expect(report.expenses.map((e) => [e.expenseCategoryName, e.amountCents])).toEqual([
      ["Abastecimento moto", 4500],
      ["Alimentação", 2000],
    ]);
    expect(report.fixedExpenses).toEqual([
      expect.objectContaining({
        label: "Luz",
        amountCents: 12000,
        paymentMeans: "cash",
        paidFromTill: true,
        paymentDate: TODAY,
      }),
    ]);
    expect(report.expensesTotalCents).toBe(4500 + 2000 + 12000);
    // RN-07: only cash from the till (the PIX lunch is out).
    expect(report.paidFromTillCents).toBe(4500 + 12000);

    expect(report.withdrawals).toEqual([
      expect.objectContaining({ amountCents: 30000, note: "depósito no banco" }),
    ]);
    expect(report.withdrawalsTotalCents).toBe(30000);
  });

  it("FR-19: an open day has no closing but shows the RN-07 terms so far", async () => {
    await seedDay(ctx);
    const report = await getReport(TODAY);
    expect(report.status).toBe("open");
    expect(report.hasMovement).toBe(true);
    expect(report.closing).toBeNull();
    expect(report.cash).toEqual({
      cashSalesCents: 5500,
      tillExpensesCents: 16500,
      withdrawalsCents: 30000,
    });
  });

  it("FR-19: a closed day shows the stored cash closing (RN-07)", async () => {
    await seedDay(ctx);
    // Expected = 500,00 + 55,00 − 165,00 − 300,00 = 90,00; counted 85,00 → falta de 5,00.
    await closeDayWithCount(ctx, TODAY, {
      openingCashCents: 50000,
      countedCashCents: 8500,
      note: "faltou troco",
    });
    const report = await getReport(TODAY);
    expect(report.status).toBe("closed");
    expect(report.closing).toMatchObject({
      openingCashCents: 50000,
      expectedCashCents: 9000,
      countedCashCents: 8500,
      differenceCents: -500,
      note: "faltou troco",
    });
    const { closing, cash } = report;
    expect(closing!.expectedCashCents).toBe(
      closing!.openingCashCents +
        cash.cashSalesCents -
        cash.tillExpensesCents -
        cash.withdrawalsCents,
    );
  });

  it("FR-19: a closed day's report matches the day's records value for value", async () => {
    await seedDay(ctx);
    await closeDayWithCount(ctx, TODAY, { openingCashCents: 50000, countedCashCents: 9000 });
    const report = await getReport(TODAY);

    // The tab × method matrix equals the day view of the sales (FR-05).
    const daySales = await getDaySales(TODAY);
    expect(report.matrix.total).toEqual(daySales.total);
    for (const tab of daySales.tabs) {
      const row = report.matrix.tabs.find((r) => r.name === tab.name)!;
      for (const subtotal of tab.methods) {
        const column = report.matrix.methods.findIndex(
          (m) => m.name === subtotal.paymentMethodName,
        );
        expect(row.cells[column]).toEqual({
          grossCents: subtotal.grossCents,
          feeCents: subtotal.feeCents,
          netCents: subtotal.netCents,
        });
      }
    }

    const expenses = await getDayExpenses(ctx, TODAY);
    expect(report.expenses).toEqual(expenses.expenses);
    const withdrawals = await getDayCashWithdrawals(ctx, TODAY);
    expect(report.withdrawals).toEqual(withdrawals.withdrawals);
    expect(report.withdrawalsTotalCents).toBe(withdrawals.totalCents);

    const closing = await getCashClosing(ctx, TODAY);
    expect(report.closing).toEqual(closing.closing);
    expect(report.cash).toEqual({
      cashSalesCents: closing.cashSalesCents,
      tillExpensesCents: closing.tillExpensesCents,
      withdrawalsCents: closing.withdrawalsCents,
    });

    // The same values computed by hand from the seeded records (independent of the shared
    // queries): cash 25,00 + 10,00 + 30,00 − 10,00; till 45,00 gasolina + 120,00 Luz.
    expect(report.cash).toEqual({
      cashSalesCents: 5500,
      tillExpensesCents: 16500,
      withdrawalsCents: 30000,
    });
    expect(report.expensesTotalCents).toBe(4500 + 2000 + 12000);
    expect(report.withdrawalsTotalCents).toBe(30000);
    // RN-07: 500,00 + 55,00 − 165,00 − 300,00 = 90,00 expected; 90,00 counted.
    expect(report.closing).toMatchObject({ expectedCashCents: 9000, differenceCents: 0 });
  });

  it("FR-19: a day without movement shows every tab at zero and no closing", async () => {
    const report = await getReport("2026-11-01");
    expect(report.hasMovement).toBe(false);
    expect(report.matrix.total).toEqual({ grossCents: 0, feeCents: 0, netCents: 0 });
    expect(report.expenses).toEqual([]);
    expect(report.fixedExpenses).toEqual([]);
    expect(report.withdrawals).toEqual([]);
    expect(report.closing).toBeNull();
  });

  it("FR-19: rejects an invalid date with a pt-BR message", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/days/2026-13-40/report" });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("Data inválida.");
  });
});
