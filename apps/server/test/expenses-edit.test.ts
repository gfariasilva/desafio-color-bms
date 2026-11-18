import { describe, expect, it } from "vitest";
import { DAY_CLOSED_CODE, EXPENSE_TEXTS, expenseSchema } from "@color-bms/core";
import { closeDay, closeMonth, NOW, TODAY, useSalesApp } from "./sales-fixture";
import { createExpense, expenseAudit, expenseCategoryId, getDayExpenses } from "./expenses-fixture";

const ctx = useSalesApp();

function patch(id: number | string, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: "PATCH", url: `/api/expenses/${id}`, payload });
}

function remove(id: number | string) {
  return ctx.app.inject({ method: "DELETE", url: `/api/expenses/${id}` });
}

const CLOSED_DAY_MESSAGE =
  "O dia 10/11/2026 está fechado. Reabra o dia para alterar ou excluir esta despesa.";

describe("FR-06: edit a general expense (PATCH /api/expenses/:id), as FR-03", () => {
  it("FR-06: editing applies the change, recalculates the totals and audits before/after", async () => {
    const expense = await createExpense(ctx, { amountCents: 4500 });
    const kalunga = await expenseCategoryId(ctx, "Kalunga");

    const response = await patch(expense.id, {
      expenseCategoryId: kalunga,
      amountCents: 12000,
      paymentMeans: "pix",
      description: "papel A4",
    });
    expect(response.statusCode, response.body).toBe(200);
    const edited = expenseSchema.parse(response.json());
    expect(edited).toMatchObject({
      id: expense.id,
      createdAt: expense.createdAt,
      paymentDate: TODAY,
      expenseCategoryName: "Kalunga",
      amountCents: 12000,
      paymentMeans: "pix",
      // A new means other than Dinheiro clears "pago do caixa".
      paidFromTill: false,
      description: "papel A4",
    });

    const day = await getDayExpenses(ctx, TODAY);
    expect(day).toMatchObject({ totalCents: 12000, paidFromTillCents: 0 });

    const [entry] = await expenseAudit(ctx);
    expect(entry).toMatchObject({
      entity: "expense",
      entityId: String(expense.id),
      action: "update",
      at: NOW.toISOString(),
      before: {
        expenseCategory: "Abastecimento moto",
        amountCents: 4500,
        paymentMeans: "Dinheiro",
        paidFromTill: true,
        description: null,
      },
      after: {
        expenseCategory: "Kalunga",
        amountCents: 12000,
        paymentMeans: "PIX",
        paidFromTill: false,
        description: "papel A4",
      },
    });
  });

  it("FR-06: switching to Dinheiro makes it paid from the till by default", async () => {
    const expense = await createExpense(ctx, { paymentMeans: "pix" });
    const edited = expenseSchema.parse((await patch(expense.id, { paymentMeans: "cash" })).json());
    expect(edited.paidFromTill).toBe(true);
  });

  it("FR-06: an edit that changes nothing writes no audit row", async () => {
    const expense = await createExpense(ctx);
    const response = await patch(expense.id, { amountCents: expense.amountCents });
    expect(response.statusCode).toBe(200);
    expect((await expenseAudit(ctx)).map((entry) => entry.action)).toEqual(["create"]);
  });

  it("FR-06: the description can be cleared", async () => {
    const expense = await createExpense(ctx, { description: "lanche" });
    const edited = expenseSchema.parse((await patch(expense.id, { description: "" })).json());
    expect(edited.description).toBeNull();
  });

  it("FR-06: rejects 'paid from the till' on a non-cash expense", async () => {
    const expense = await createExpense(ctx, { paymentMeans: "pix" });
    const response = await patch(expense.id, { paidFromTill: true });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: EXPENSE_TEXTS.paidFromTillOnlyCash });
  });

  it("FR-06: an expense keeps a category deactivated since, but cannot move to another inactive one", async () => {
    const expense = await createExpense(ctx);
    const diversos = await expenseCategoryId(ctx, "Diversos");
    for (const id of [expense.expenseCategoryId, diversos]) {
      await ctx.app.inject({
        method: "PATCH",
        url: `/api/expense-categories/${id}`,
        payload: { active: false },
      });
    }
    expect((await patch(expense.id, { amountCents: 5000 })).statusCode).toBe(200);
    const moved = await patch(expense.id, { expenseCategoryId: diversos });
    expect(moved.statusCode).toBe(400);
    expect(moved.json()).toEqual({ error: EXPENSE_TEXTS.inactiveCategory });
  });

  it("FR-06 / RN-14: blocks editing an expense on a closed day", async () => {
    const expense = await createExpense(ctx, { paymentDate: "2026-11-10" });
    closeDay(ctx, "2026-11-10");
    const response = await patch(expense.id, { amountCents: 1 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: CLOSED_DAY_MESSAGE, code: DAY_CLOSED_CODE });
    expect((await expenseAudit(ctx)).map((entry) => entry.action)).toEqual(["create"]);
  });

  it("RN-14: blocks moving an expense to a closed day or into a closed month", async () => {
    const expense = await createExpense(ctx);
    closeDay(ctx, "2026-11-10");
    closeMonth(ctx, "2026-10");
    const toClosedDay = await patch(expense.id, { paymentDate: "2026-11-10" });
    expect(toClosedDay.statusCode).toBe(409);
    expect(toClosedDay.json()).toMatchObject({ code: DAY_CLOSED_CODE });
    const toClosedMonth = await patch(expense.id, { paymentDate: "2026-10-05" });
    expect(toClosedMonth.statusCode).toBe(409);
  });

  it("RN-15: blocks moving an expense to a future date", async () => {
    const expense = await createExpense(ctx);
    const response = await patch(expense.id, { paymentDate: "2026-11-19" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Não é possível registrar lançamentos com data futura.",
    });
  });

  it("FR-06: an unknown expense is a 404", async () => {
    expect((await patch(9999, { amountCents: 100 })).statusCode).toBe(404);
    expect((await patch("abc", { amountCents: 100 })).json()).toEqual({
      error: EXPENSE_TEXTS.notFound,
    });
  });

  it("FR-06: an empty edit is a 400", async () => {
    const expense = await createExpense(ctx);
    const response = await patch(expense.id, {});
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Nada para alterar." });
  });
});

describe("FR-06: delete a general expense (DELETE /api/expenses/:id), as FR-03", () => {
  it("FR-06: deleting removes it from the day and audits the values before", async () => {
    const expense = await createExpense(ctx, { amountCents: 4500 });
    const response = await remove(expense.id);
    expect(response.statusCode).toBe(204);

    const day = await getDayExpenses(ctx, TODAY);
    expect(day).toMatchObject({ expenses: [], totalCents: 0, monthGeneralTotalCents: 0 });

    const [entry] = await expenseAudit(ctx);
    expect(entry).toMatchObject({
      entity: "expense",
      entityId: String(expense.id),
      action: "delete",
      before: { expenseCategory: "Abastecimento moto", amountCents: 4500 },
      after: null,
    });
  });

  it("FR-06 / RN-14: blocks deleting an expense on a closed day", async () => {
    const expense = await createExpense(ctx, { paymentDate: "2026-11-10" });
    closeDay(ctx, "2026-11-10");
    const response = await remove(expense.id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: CLOSED_DAY_MESSAGE, code: DAY_CLOSED_CODE });
    expect((await getDayExpenses(ctx, "2026-11-10")).expenses).toHaveLength(1);
  });

  it("FR-06: deleting an unknown expense is a 404", async () => {
    const response = await remove(9999);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: EXPENSE_TEXTS.notFound });
  });
});
