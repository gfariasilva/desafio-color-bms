import { describe, expect, it } from "vitest";
import { DAY_CLOSED_CODE, EXPENSE_TEXTS } from "@color-bms/core";
import { closeDay, closeMonth, NOW, TODAY, useSalesApp } from "./sales-fixture";
import {
  createExpense,
  expenseAudit,
  expenseCategoryId,
  getDayExpenses,
  postExpense,
} from "./expenses-fixture";

const ctx = useSalesApp();

describe("FR-06: register a general expense (POST /api/expenses)", () => {
  it("FR-06: R$ 45,00 in Abastecimento moto, cash from the till, shows in the day, the month total (RN-08) and the cash paid from the till (RN-07)", async () => {
    const categoryId = await expenseCategoryId(ctx, "Abastecimento moto");
    const response = await postExpense(ctx, {
      paymentDate: TODAY,
      expenseCategoryId: categoryId,
      amountCents: 4500,
      paymentMeans: "cash",
      paidFromTill: true,
    });
    expect(response.statusCode, response.body).toBe(201);
    const expense = response.json();
    expect(expense).toMatchObject({
      type: "general",
      status: "paid",
      paymentDate: TODAY,
      createdAt: NOW.toISOString(),
      expenseCategoryId: categoryId,
      expenseCategoryName: "Abastecimento moto",
      description: null,
      amountCents: 4500,
      paymentMeans: "cash",
      paidFromTill: true,
    });

    const day = await getDayExpenses(ctx, TODAY);
    expect(day).toMatchObject({
      date: TODAY,
      lock: null,
      totalCents: 4500,
      paidFromTillCents: 4500,
      monthGeneralTotalCents: 4500,
    });
    expect(day.expenses).toEqual([expense]);

    const [entry] = await expenseAudit(ctx);
    expect(entry).toMatchObject({
      entity: "expense",
      entityId: String(expense.id),
      action: "create",
      at: NOW.toISOString(),
      before: null,
      after: {
        paymentDate: TODAY,
        expenseCategory: "Abastecimento moto",
        description: null,
        amountCents: 4500,
        paymentMeans: "Dinheiro",
        paidFromTill: true,
      },
    });
  });

  it("FR-06: a PIX expense does not count as paid from the till (no effect on expected cash)", async () => {
    await createExpense(ctx, { paymentMeans: "pix", amountCents: 1200 });
    const day = await getDayExpenses(ctx, TODAY);
    expect(day.totalCents).toBe(1200);
    expect(day.paidFromTillCents).toBe(0);
    expect(day.expenses[0]).toMatchObject({ paymentMeans: "pix", paidFromTill: false });
  });

  it("FR-06: Dinheiro is paid from the till by default; it can be marked as not", async () => {
    const byDefault = await createExpense(ctx, { amountCents: 1000 });
    expect(byDefault.paidFromTill).toBe(true);
    const fromPocket = await createExpense(ctx, { amountCents: 300, paidFromTill: false });
    expect(fromPocket.paidFromTill).toBe(false);
    const day = await getDayExpenses(ctx, TODAY);
    expect(day).toMatchObject({ totalCents: 1300, paidFromTillCents: 1000 });
  });

  it("FR-06: rejects 'paid from the till' for a means other than Dinheiro", async () => {
    const response = await postExpense(ctx, {
      paymentDate: TODAY,
      expenseCategoryId: await expenseCategoryId(ctx, "Alimentação"),
      amountCents: 1500,
      paymentMeans: "card",
      paidFromTill: true,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: EXPENSE_TEXTS.paidFromTillOnlyCash });
    expect(await expenseAudit(ctx)).toEqual([]);
  });

  it("RN-08: the month total counts only general expenses paid in that month", async () => {
    await createExpense(ctx, { paymentDate: "2026-10-31", amountCents: 100 });
    await createExpense(ctx, { paymentDate: "2026-11-01", amountCents: 200 });
    await createExpense(ctx, { paymentDate: TODAY, amountCents: 400, paymentMeans: "boleto" });
    const day = await getDayExpenses(ctx, TODAY);
    expect(day.totalCents).toBe(400);
    expect(day.monthGeneralTotalCents).toBe(600);
    expect((await getDayExpenses(ctx, "2026-10-31")).monthGeneralTotalCents).toBe(100);
  });

  it("FR-06: the description is kept, trimmed", async () => {
    const expense = await createExpense(ctx, { description: "  posto da esquina " });
    expect(expense.description).toBe("posto da esquina");
  });

  it("FR-06: only active general-expense categories are accepted", async () => {
    const categoryId = await expenseCategoryId(ctx, "Diversos");
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/expense-categories/${categoryId}`,
      payload: { active: false },
    });
    const inactive = await postExpense(ctx, {
      paymentDate: TODAY,
      expenseCategoryId: categoryId,
      amountCents: 500,
      paymentMeans: "cash",
    });
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json()).toEqual({ error: EXPENSE_TEXTS.inactiveCategory });

    const missing = await postExpense(ctx, {
      paymentDate: TODAY,
      expenseCategoryId: 9999,
      amountCents: 500,
      paymentMeans: "cash",
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: EXPENSE_TEXTS.inactiveCategory });
  });

  it("FR-06: the value must be greater than 0", async () => {
    const response = await postExpense(ctx, {
      paymentDate: TODAY,
      expenseCategoryId: await expenseCategoryId(ctx, "Diversos"),
      amountCents: 0,
      paymentMeans: "cash",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Informe um valor maior que zero." });
  });

  it("RN-15: future payment dates are not accepted", async () => {
    const response = await postExpense(ctx, {
      paymentDate: "2026-11-19",
      expenseCategoryId: await expenseCategoryId(ctx, "Diversos"),
      amountCents: 500,
      paymentMeans: "cash",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Não é possível registrar lançamentos com data futura.",
    });
  });

  it("RN-14: the payment date cannot fall on a closed day", async () => {
    closeDay(ctx, "2026-11-10");
    const response = await postExpense(ctx, {
      paymentDate: "2026-11-10",
      expenseCategoryId: await expenseCategoryId(ctx, "Diversos"),
      amountCents: 500,
      paymentMeans: "cash",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error:
        "O dia 10/11/2026 está fechado. Reabra o dia para registrar ou alterar lançamentos nessa data.",
      code: DAY_CLOSED_CODE,
    });
    expect(await expenseAudit(ctx)).toEqual([]);
  });

  it("RN-14: nor in a closed month", async () => {
    closeMonth(ctx, "2026-10");
    const response = await postExpense(ctx, {
      paymentDate: "2026-10-15",
      expenseCategoryId: await expenseCategoryId(ctx, "Diversos"),
      amountCents: 500,
      paymentMeans: "cash",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: DAY_CLOSED_CODE });
  });
});

describe("FR-06: the day's expenses (GET /api/days/:date/expenses)", () => {
  it("FR-06: lists the day's expenses in the order they were registered, with totals", async () => {
    const first = await createExpense(ctx, { amountCents: 4500 });
    const second = await createExpense(ctx, {
      amountCents: 2000,
      paymentMeans: "bank_transfer",
      expenseCategoryId: await expenseCategoryId(ctx, "Kalunga"),
    });
    await createExpense(ctx, { paymentDate: "2026-11-17", amountCents: 999 });
    const day = await getDayExpenses(ctx, TODAY);
    expect(day.expenses.map((expense) => expense.id)).toEqual([first.id, second.id]);
    expect(day.expenses[1]?.expenseCategoryName).toBe("Kalunga");
    expect(day).toMatchObject({ totalCents: 6500, paidFromTillCents: 4500 });
  });

  it("RN-14: a closed day comes with the lock message", async () => {
    closeDay(ctx, "2026-11-10");
    const day = await getDayExpenses(ctx, "2026-11-10");
    expect(day.lock).toBe(
      "O dia 10/11/2026 está fechado. Reabra o dia para alterar ou excluir esta despesa.",
    );
    expect(day).toMatchObject({ expenses: [], totalCents: 0, paidFromTillCents: 0 });
  });

  it("FR-06: an invalid date is a 400 with a pt-BR message", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/days/2026-13-01/expenses" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Data inválida." });
  });
});
