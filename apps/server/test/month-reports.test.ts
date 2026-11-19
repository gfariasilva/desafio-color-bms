import { describe, expect, it } from "vitest";
import {
  monthFixedExpensesReportSchema,
  monthGeneralExpensesResponseSchema,
  monthIncomeResponseSchema,
  monthSummaryResponseSchema,
} from "@color-bms/core";
import { createCashWithdrawal } from "./cash-withdrawals-fixture";
import { createExpense, expenseCategoryId } from "./expenses-fixture";
import { fixedEntry, getFixedMonth, payEntry, postAction } from "./fixed-expenses-fixture";
import { createFee, createSale, TODAY, useSalesApp } from "./sales-fixture";

const ctx = useSalesApp();

async function getIncome(yearMonth: string) {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/api/months/${yearMonth}/reports/income`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return monthIncomeResponseSchema.parse(response.json());
}

async function getGeneralExpenses(yearMonth: string) {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/api/months/${yearMonth}/reports/general-expenses`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return monthGeneralExpensesResponseSchema.parse(response.json());
}

async function getFixedExpensesReport(yearMonth: string) {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/api/months/${yearMonth}/reports/fixed-expenses`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return monthFixedExpensesReportSchema.parse(response.json());
}

async function getSummary(yearMonth: string) {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/api/months/${yearMonth}/reports/summary`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return monthSummaryResponseSchema.parse(response.json());
}

/** FR-11: adds a one-off fixed bill (pending) to a month. */
async function createOneOff(payload: Record<string, unknown>) {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/fixed-expenses",
    payload: { group: "general", ...payload },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: number };
}

const october = (day: number) => `2026-10-${String(day).padStart(2, "0")}`;

describe("FR-20: Relatório Mês – Entradas (GET /api/months/:yearMonth/reports/income)", () => {
  it("FR-20: with sales on 20 days, column sums = tab totals and Σ tabs = monthly income", async () => {
    await createFee(ctx, { ratePpm: 37900 });
    for (let day = 1; day <= 20; day++) {
      await createSale(ctx, {
        date: october(day),
        saleCategoryId: ctx.ids.toner,
        grossCents: 1000,
      });
      await createSale(ctx, {
        date: october(day),
        saleCategoryId: ctx.ids.papelaria,
        paymentMethodId: ctx.ids.credit,
        cardMachineId: ctx.ids.mercadoPago,
        installments: 1,
        grossCents: 15000,
      });
      if (day % 4 === 0) {
        await createSale(ctx, {
          date: october(day),
          saleCategoryId: ctx.ids.chaveiro,
          paymentMethodId: ctx.ids.pix,
          grossCents: 333,
        });
      }
    }
    // Another month: never in October's report.
    await createSale(ctx, { date: "2026-09-30", grossCents: 99999 });
    await createSale(ctx, { date: "2026-11-01", grossCents: 88888 });

    const income = await getIncome("2026-10");
    expect(income.days).toHaveLength(31);
    expect(income.days.filter((day) => day.hasSales)).toHaveLength(20);

    income.tabs.forEach((tab, column) => {
      const columnSum = income.days.reduce((sum, day) => sum + day.cells[column]!, 0);
      expect(columnSum, tab.name).toBe(tab.totalCents);
    });
    expect(income.tabs.reduce((sum, tab) => sum + tab.totalCents, 0)).toBe(income.total.grossCents);

    // RN-06: 20 × (10,00 + 150,00) + 5 × 3,33; fees 20 × 5,69 (RN-03 example).
    expect(income.total).toEqual({
      grossCents: 20 * 16000 + 5 * 333,
      feeCents: 20 * 569,
      netCents: 20 * 16000 + 5 * 333 - 20 * 569,
    });
    const tab = (name: string) => income.tabs.find((t) => t.name === name)!;
    expect(tab("Toner").totalCents).toBe(20000);
    expect(tab("Papelaria").totalCents).toBe(300000);
    expect(tab("Chaveiro").totalCents).toBe(1665);

    const method = (name: string) => income.methods.find((m) => m.name === name)!;
    expect(method("Dinheiro")).toMatchObject({ grossCents: 20000, feeCents: 0, netCents: 20000 });
    expect(method("Cartão de crédito")).toMatchObject({
      grossCents: 300000,
      feeCents: 11380,
      netCents: 288620,
    });
    expect(method("PIX/Depósito").grossCents).toBe(1665);
  });

  it("RN-06: refunds dated in the month reduce the monthly income and fees", async () => {
    await createFee(ctx, { ratePpm: 37900 });
    const sale = await createSale(ctx, {
      date: "2026-10-30",
      paymentMethodId: ctx.ids.credit,
      cardMachineId: ctx.ids.mercadoPago,
      installments: 1,
      grossCents: 15000,
    });
    // FR-04: refunded today (November): it counts in November, not in October.
    const refund = await ctx.app.inject({
      method: "POST",
      url: `/api/sales/${sale.id}/refunds`,
      payload: { refundCents: 5000, reason: "defeito" },
    });
    expect(refund.statusCode, refund.body).toBe(201);
    await createSale(ctx, { date: TODAY, grossCents: 10000 });

    const october = await getIncome("2026-10");
    expect(october.total).toEqual({ grossCents: 15000, feeCents: 569, netCents: 14431 });

    const november = await getIncome("2026-11");
    // 100,00 − 50,00; the refund gives back its proportional fee (RN-04): −1,90 (1,895).
    expect(november.total).toEqual({ grossCents: 5000, feeCents: -190, netCents: 5190 });
    // The current month stops at today.
    expect(november.days).toHaveLength(18);
    expect(november.days.at(-1)).toMatchObject({ date: TODAY, totalCents: 5000 });
  });

  it("FR-20: lists every active tab in display order, even without sales", async () => {
    const income = await getIncome("2026-10");
    expect(income.yearMonth).toBe("2026-10");
    expect(income.tabs).toHaveLength(9);
    expect(income.tabs[0]!.name).toBe("Acessórios");
    expect(income.total).toEqual({ grossCents: 0, feeCents: 0, netCents: 0 });
  });

  it("rejects an invalid month with 400", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/months/2026-13/reports/income",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Mês inválido.");
  });
});

describe("FR-21: Relatório Mês – Despesas gerais (GET /api/months/:yearMonth/reports/general-expenses)", () => {
  it("RN-08 / FR-21: totals by category by payment date, suppliers grouped, total geral", async () => {
    const kalunga = await expenseCategoryId(ctx, "Kalunga");
    const suzano = await expenseCategoryId(ctx, "Suzano");
    const food = await expenseCategoryId(ctx, "Alimentação");
    await createExpense(ctx, { paymentDate: "2026-10-01", amountCents: 4500 });
    await createExpense(ctx, { paymentDate: "2026-10-31", amountCents: 5000 });
    await createExpense(ctx, {
      paymentDate: "2026-10-10",
      expenseCategoryId: food,
      amountCents: 2000,
      paymentMeans: "pix",
    });
    await createExpense(ctx, {
      paymentDate: "2026-10-12",
      expenseCategoryId: kalunga,
      amountCents: 30000,
      paymentMeans: "boleto",
      description: "papel A4",
    });
    await createExpense(ctx, {
      paymentDate: "2026-10-15",
      expenseCategoryId: suzano,
      amountCents: 12345,
      paymentMeans: "pix",
    });
    // Paid in November: not in October (cash basis).
    await createExpense(ctx, { paymentDate: "2026-11-01", amountCents: 777 });

    const report = await getGeneralExpenses("2026-10");
    const category = (name: string) =>
      [...report.general.categories, ...report.suppliers.categories].find((c) => c.name === name)!;
    expect(category("Abastecimento moto").totalCents).toBe(9500);
    expect(category("Alimentação").totalCents).toBe(2000);
    expect(category("Kalunga").totalCents).toBe(30000);
    expect(category("Suzano").totalCents).toBe(12345);
    expect(category("Acessórios").totalCents).toBe(0);

    expect(report.general.categories.map((c) => c.group)).not.toContain("suppliers");
    expect(report.suppliers.categories.map((c) => c.name)).toEqual([
      "Casa Forte",
      "Nova Supri",
      "Canal Verde",
      "Jandaia",
      "Kalunga",
      "Suzano",
      "Outros fornecedores",
    ]);
    expect(report.general.subtotalCents).toBe(11500);
    expect(report.suppliers.subtotalCents).toBe(42345);
    expect(report.totalCents).toBe(53845);

    // RN-08: the same figure the expense screen shows for the month.
    const day = await ctx.app.inject({ method: "GET", url: "/api/days/2026-10-15/expenses" });
    expect(day.json().monthGeneralTotalCents).toBe(report.totalCents);
  });

  it("RN-08: a fixed expense paid in the month is not a general expense (RN-09, #17)", async () => {
    await createExpense(ctx, { paymentDate: "2026-11-01", amountCents: 777 });
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id, { amountCents: 12000, paymentDate: "2026-11-05" });
    const report = await getGeneralExpenses("2026-11");
    expect(report.totalCents).toBe(777);
  });

  it("FR-21: lists the entries of each category", async () => {
    const kalunga = await expenseCategoryId(ctx, "Kalunga");
    await createExpense(ctx, {
      paymentDate: "2026-10-12",
      expenseCategoryId: kalunga,
      amountCents: 30000,
      paymentMeans: "boleto",
      description: "papel A4",
    });
    await createExpense(ctx, {
      paymentDate: "2026-10-03",
      expenseCategoryId: kalunga,
      amountCents: 1500,
      paymentMeans: "cash",
      description: "canetas",
    });
    const report = await getGeneralExpenses("2026-10");
    const entries = report.suppliers.categories.find((c) => c.name === "Kalunga")!.expenses;
    expect(entries.map((e) => [e.paymentDate, e.description, e.amountCents])).toEqual([
      ["2026-10-03", "canetas", 1500],
      ["2026-10-12", "papel A4", 30000],
    ]);
  });

  it("rejects an invalid month with 400", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/months/outubro/reports/general-expenses",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Mês inválido.");
  });
});

describe("FR-22: Relatório Mês – Despesas fixas (GET /api/months/:yearMonth/reports/fixed-expenses)", () => {
  /**
   * November (the clock's month, already generated): Luz and DAS paid, Água dismissed, a
   * pending one-off "Seguro" with an expected amount, and October's one-off "IPTU outubro"
   * paid on 05/11 (RN-09: it counts in November, the month of its payment date).
   */
  async function fillNovember() {
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id, { amountCents: 18743, paymentDate: "2026-11-10" });
    const das = await fixedEntry(ctx, "DAS");
    await payEntry(ctx, das.id, { amountCents: 30000, paymentDate: "2026-11-17" });
    const agua = await fixedEntry(ctx, "Água");
    expect((await postAction(ctx, agua.id, "dismiss")).statusCode).toBe(200);
    await createOneOff({
      referenceMonth: "2026-11",
      description: "Seguro",
      dueDate: "2026-11-25",
      expectedAmountCents: 50000,
    });
    const iptu = await createOneOff({
      referenceMonth: "2026-10",
      description: "IPTU outubro",
      dueDate: "2026-10-20",
      expectedAmountCents: 17000,
    });
    await payEntry(ctx, iptu.id, { amountCents: 17000, paymentDate: "2026-11-05" });
    return { iptuId: iptu.id };
  }

  it("RN-09 / FR-22: total paid by payment date, grouped in Gerais and Taxas governo", async () => {
    const { iptuId } = await fillNovember();
    const report = await getFixedExpensesReport("2026-11");

    expect(report.groups.map((group) => group.label)).toEqual(["Gerais", "Taxas governo"]);
    expect(report.paidTotalCents).toBe(18743 + 30000 + 17000);
    expect(report.groups.map((group) => group.paidTotalCents)).toEqual([18743 + 17000, 30000]);

    const rows = report.groups.flatMap((group) => group.expenses);
    const row = (label: string) => rows.find((r) => r.label === label)!;
    expect(row("Luz")).toMatchObject({
      status: "paid",
      amountCents: 18743,
      paymentDate: "2026-11-10",
      countsInMonth: true,
    });
    expect(row("DAS").group).toBe("government_fees");
    expect(row("Água")).toMatchObject({ status: "dismissed", countsInMonth: false });
    expect(rows.find((r) => r.id === iptuId)).toMatchObject({
      referenceMonth: "2026-10",
      otherReferenceMonth: true,
      countsInMonth: true,
    });
    // The counted rows add up to the total paid.
    expect(
      rows.filter((r) => r.countsInMonth).reduce((sum, r) => sum + (r.amountCents ?? 0), 0),
    ).toBe(report.paidTotalCents);

    // RN-09: the same figure as "Pago no mês" on Contas do mês (#13).
    expect((await getFixedMonth(ctx, "2026-11")).paidTotalCents).toBe(report.paidTotalCents);
  });

  it("FR-22: pending total is informative: Σ expected of the month's pending bills", async () => {
    await fillNovember();
    const month = await getFixedMonth(ctx, "2026-11");
    const pending = month.expenses.filter((entry) => entry.status === "pending");
    const report = await getFixedExpensesReport("2026-11");

    expect(report.pendingTotalCents).toBe(
      pending.reduce((sum, entry) => sum + (entry.expectedAmountCents ?? 0), 0),
    );
    expect(report.pendingTotalCents).toBeGreaterThanOrEqual(50000);
    expect(report.pendingWithoutExpectedCount).toBe(
      pending.filter((entry) => entry.expectedAmountCents === null).length,
    );
  });

  it("RN-09: October lists its bill paid in November, without counting it", async () => {
    const { iptuId } = await fillNovember();
    const report = await getFixedExpensesReport("2026-10");
    const rows = report.groups.flatMap((group) => group.expenses);
    expect(rows.map((r) => r.id)).toEqual([iptuId]);
    expect(rows[0]).toMatchObject({ countsInMonth: false, otherReferenceMonth: false });
    expect(report.paidTotalCents).toBe(0);
    expect(report.pendingTotalCents).toBe(0);
  });

  it("rejects an invalid month with 400", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/months/2026-00/reports/fixed-expenses",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Mês inválido.");
  });
});

describe("FR-23: Resumo mensal (GET /api/months/:yearMonth/reports/summary)", () => {
  /** November with sales, a refund, general expenses and fixed bills paid and pending. */
  async function fillMonth() {
    await createFee(ctx, { ratePpm: 37900 });
    await createSale(ctx, { date: "2026-11-03", grossCents: 25000 });
    const card = await createSale(ctx, {
      date: "2026-11-04",
      paymentMethodId: ctx.ids.credit,
      cardMachineId: ctx.ids.mercadoPago,
      installments: 1,
      grossCents: 15000,
    });
    const refund = await ctx.app.inject({
      method: "POST",
      url: `/api/sales/${card.id}/refunds`,
      payload: { refundCents: 5000, reason: "defeito" },
    });
    expect(refund.statusCode, refund.body).toBe(201);
    await createExpense(ctx, { paymentDate: "2026-11-02", amountCents: 4500 });
    await createExpense(ctx, {
      paymentDate: "2026-11-12",
      expenseCategoryId: await expenseCategoryId(ctx, "Kalunga"),
      amountCents: 30000,
      paymentMeans: "boleto",
    });
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id, { amountCents: 18743, paymentDate: "2026-11-10" });
    await createOneOff({
      referenceMonth: "2026-11",
      description: "Seguro",
      dueDate: "2026-11-25",
      expectedAmountCents: 50000,
    });
  }

  it("FR-23: each line equals the matching total of the FR-20, FR-21 and FR-22 reports", async () => {
    await fillMonth();
    const [summary, income, general, fixed] = await Promise.all([
      getSummary("2026-11"),
      getIncome("2026-11"),
      getGeneralExpenses("2026-11"),
      getFixedExpensesReport("2026-11"),
    ]);

    expect(summary.incomeCents).toBe(income.total.grossCents);
    expect(summary.feesCents).toBe(income.total.feeCents);
    expect(summary.generalExpensesCents).toBe(general.totalCents);
    expect(summary.fixedExpensesCents).toBe(fixed.paidTotalCents);

    // RN-06/RN-08/RN-09 with the numbers: 250,00 + 150,00 − 50,00; fee 5,69 − 1,90 (RN-04).
    expect(summary).toEqual({
      yearMonth: "2026-11",
      incomeCents: 35000,
      feesCents: 379,
      generalExpensesCents: 34500,
      fixedExpensesCents: 18743,
      // RN-10: gerais + fixas; the pending Seguro is not in it.
      totalExpensesCents: 53243,
      // RN-10: 350,00 − 3,79 − 532,43.
      balanceCents: -18622,
    });
  });

  it("RN-10: sangrias do not enter the expenses nor the monthly balance", async () => {
    await fillMonth();
    const before = await getSummary("2026-11");
    await createCashWithdrawal(ctx, { date: "2026-11-10", amountCents: 30000 });
    await createCashWithdrawal(ctx, { date: TODAY, amountCents: 12345, note: "CONTA: Gás" });
    expect(await getSummary("2026-11")).toEqual(before);
  });

  it("FR-23: a month without movement has every line at zero", async () => {
    expect(await getSummary("2026-09")).toEqual({
      yearMonth: "2026-09",
      incomeCents: 0,
      feesCents: 0,
      generalExpensesCents: 0,
      fixedExpensesCents: 0,
      totalExpensesCents: 0,
      balanceCents: 0,
    });
  });

  it("rejects an invalid month with 400", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/months/2026-1/reports/summary",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Mês inválido.");
  });
});
