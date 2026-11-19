import { describe, expect, it } from "vitest";
import { monthGeneralExpensesResponseSchema, monthIncomeResponseSchema } from "@color-bms/core";
import { createExpense, expenseCategoryId } from "./expenses-fixture";
import { fixedEntry, payEntry } from "./fixed-expenses-fixture";
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
