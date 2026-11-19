import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  DAY_CLOSED_CODE,
  FIXED_EXPENSE_PAYMENT_TEXTS,
  fixedExpenseInstallmentLabel,
  fixedExpenseSchema,
} from "@color-bms/core";
import { expenses } from "../src/db/schema";
import {
  closeDay,
  closeMonth,
  createSale,
  TODAY,
  useSalesApp,
  type SalesContext,
} from "./sales-fixture";
import { closeDayWithCount, getCashClosing } from "./cash-closing-fixture";
import {
  auditOf,
  fixedEntry,
  getFixedMonth,
  patchTemplate,
  payEntry,
  postAction,
  templateByName,
} from "./fixed-expenses-fixture";

/**
 * FR-12: paying and dismissing fixed expenses; FR-13: loan installments. The clock is
 * 18/11/2026 15:00 in São Paulo; November's bills were generated when the app started.
 */

const ctx = useSalesApp();

/** Sets the expected amount of an entry directly (as if the template had it at generation). */
function setExpected(c: SalesContext, id: number, cents: number) {
  c.connection.db
    .update(expenses)
    .set({ expectedAmountCents: cents })
    .where(eq(expenses.id, id))
    .run();
}

/** October's Luz, as the generation of October would have created it. */
async function octoberLuz(c: SalesContext) {
  const luz = await templateByName(c, "Luz");
  c.connection.db
    .insert(expenses)
    .values({
      type: "fixed",
      status: "pending",
      referenceMonth: "2026-10",
      fixedExpenseTemplateId: luz.id,
      fixedExpenseGroup: "general",
      dueDate: "2026-10-10",
      expectedAmountCents: 19000,
      paidFromTill: false,
      createdAt: "2026-10-01T12:00:00.000Z",
    })
    .run();
  return fixedEntry(c, "Luz", "2026-10");
}

describe("FR-12: pay a fixed expense (POST /api/fixed-expenses/:id/pay)", () => {
  it("FR-12: Luz of November, expected R$ 200,00, paid R$ 187,43 on 10/11/2026 via PIX → pago, counts in November (RN-09)", async () => {
    const luz = await fixedEntry(ctx, "Luz");
    setExpected(ctx, luz.id, 20000);

    const paid = await payEntry(ctx, luz.id, {
      amountCents: 18743,
      paymentDate: "2026-11-10",
      paymentMeans: "pix",
    });
    expect(paid).toMatchObject({
      id: luz.id,
      status: "paid",
      amountCents: 18743,
      paymentDate: "2026-11-10",
      paymentMeans: "pix",
      paidFromTill: false,
      expectedAmountCents: 20000,
      referenceMonth: "2026-11",
    });

    const month = await getFixedMonth(ctx, "2026-11");
    expect(month.paidTotalCents).toBe(18743);

    const [entry] = await auditOf(ctx, "expense");
    expect(entry).toMatchObject({
      entityId: String(luz.id),
      action: "update",
      before: { expenseStatus: "pending", amountCents: null, paymentDate: null },
      after: {
        expenseStatus: "paid",
        amountCents: 18743,
        paymentDate: "2026-11-10",
        paymentMeans: "PIX",
        paidFromTill: false,
      },
    });
  });

  it("FR-12: October's Luz paid on 10/11 counts in November (cash basis) and keeps October as its reference month", async () => {
    const october = await octoberLuz(ctx);
    await payEntry(ctx, october.id, { amountCents: 19500, paymentDate: "2026-11-10" });

    expect((await getFixedMonth(ctx, "2026-11")).paidTotalCents).toBe(19500);
    expect((await getFixedMonth(ctx, "2026-10")).paidTotalCents).toBe(0);
    const stored = await fixedEntry(ctx, "Luz", "2026-10");
    expect(stored).toMatchObject({ status: "paid", referenceMonth: "2026-10" });
  });

  it("FR-12: a fixed expense paid in cash from the till reduces that day's expected cash (RN-07)", async () => {
    await createSale(ctx, { grossCents: 50000 });
    const agua = await fixedEntry(ctx, "Água");
    const paid = await payEntry(ctx, agua.id, {
      amountCents: 12000,
      paymentDate: TODAY,
      paymentMeans: "cash",
    });
    // FR-06 default: Dinheiro is paid from the till unless the owner says otherwise.
    expect(paid.paidFromTill).toBe(true);

    const closing = await getCashClosing(ctx, TODAY);
    expect(closing).toMatchObject({ cashSalesCents: 50000, tillExpensesCents: 12000 });
    const closed = await closeDayWithCount(ctx, TODAY, {
      openingCashCents: 10000,
      countedCashCents: 48000,
    });
    // 100,00 + 500,00 − 120,00 = 480,00.
    expect(closed.closing).toMatchObject({ expectedCashCents: 48000, differenceCents: 0 });
  });

  it("FR-12: cash not from the till does not touch the expected cash", async () => {
    await createSale(ctx, { grossCents: 50000 });
    const agua = await fixedEntry(ctx, "Água");
    await payEntry(ctx, agua.id, {
      amountCents: 12000,
      paymentDate: TODAY,
      paymentMeans: "cash",
      paidFromTill: false,
    });
    expect((await getCashClosing(ctx, TODAY)).tillExpensesCents).toBe(0);
  });

  it("FR-12: paid from the till only with Dinheiro", async () => {
    const agua = await fixedEntry(ctx, "Água");
    const response = await postAction(ctx, agua.id, "pay", {
      amountCents: 12000,
      paymentDate: TODAY,
      paymentMeans: "pix",
      paidFromTill: true,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Só despesas pagas em Dinheiro podem sair do caixa.");
  });

  it("FR-12: the payment date cannot fall on a closed day (A-16)", async () => {
    closeDay(ctx, "2026-11-10");
    const luz = await fixedEntry(ctx, "Luz");
    const response = await postAction(ctx, luz.id, "pay", {
      amountCents: 18743,
      paymentDate: "2026-11-10",
      paymentMeans: "pix",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O dia 10/11/2026 está fechado. Reabra o dia para registrar pagamentos nessa data.",
      code: DAY_CLOSED_CODE,
    });
    expect((await fixedEntry(ctx, "Luz")).status).toBe("pending");
    expect(await auditOf(ctx, "expense")).toHaveLength(0);
  });

  it("RN-14: nor in a closed month; RN-15: nor in the future", async () => {
    closeMonth(ctx, "2026-10");
    const luz = await fixedEntry(ctx, "Luz");
    const closedMonth = await postAction(ctx, luz.id, "pay", {
      amountCents: 100,
      paymentDate: "2026-10-30",
      paymentMeans: "pix",
    });
    expect(closedMonth.statusCode).toBe(409);
    expect(closedMonth.json().error).toMatch(/^O mês 10\/2026 está fechado/);

    const future = await postAction(ctx, luz.id, "pay", {
      amountCents: 100,
      paymentDate: "2026-11-19",
      paymentMeans: "pix",
    });
    expect(future.statusCode).toBe(400);
    expect(future.json().error).toBe("Não é possível registrar lançamentos com data futura.");
  });

  it("FR-12: a paid entry cannot be paid again; validation and unknown ids", async () => {
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id);
    const again = await postAction(ctx, luz.id, "pay", {
      amountCents: 100,
      paymentDate: TODAY,
      paymentMeans: "pix",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe(FIXED_EXPENSE_PAYMENT_TEXTS.alreadyPaid);

    const invalid = await postAction(ctx, luz.id, "pay", { amountCents: 0 });
    expect(invalid.statusCode).toBe(400);

    const missing = await postAction(ctx, 999999, "pay", {
      amountCents: 100,
      paymentDate: TODAY,
      paymentMeans: "pix",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe(FIXED_EXPENSE_PAYMENT_TEXTS.notFound);
  });

  it("FR-12: a general expense cannot be paid through this route", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/expenses",
      payload: { paymentDate: TODAY, amountCents: 1000, expenseCategoryId: 1, paymentMeans: "pix" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const response = await postAction(ctx, created.json().id, "pay", {
      amountCents: 100,
      paymentDate: TODAY,
      paymentMeans: "pix",
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("FR-12: dismiss and undo", () => {
  it("FR-12: a dismissed entry (TFE out of its month) leaves every total", async () => {
    const tfe = await fixedEntry(ctx, "TFE");
    setExpected(ctx, tfe.id, 30000);
    const before = await getFixedMonth(ctx);

    const response = await postAction(ctx, tfe.id, "dismiss", { reason: "TFE é anual" });
    expect(response.statusCode, response.body).toBe(200);
    expect(fixedExpenseSchema.parse(response.json()).status).toBe("dismissed");

    const after = await getFixedMonth(ctx);
    expect(after.expectedTotalCents).toBe(before.expectedTotalCents - 30000);
    expect(after.paidTotalCents).toBe(0);

    const [entry] = await auditOf(ctx, "expense");
    expect(entry).toMatchObject({
      entityId: String(tfe.id),
      action: "update",
      before: { expenseStatus: "pending" },
      after: { expenseStatus: "dismissed" },
      reason: "TFE é anual",
    });
  });

  it("FR-12: only a pending entry can be dismissed; not in a closed reference month", async () => {
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id);
    const paid = await postAction(ctx, luz.id, "dismiss");
    expect(paid.statusCode).toBe(409);
    expect(paid.json().error).toBe(FIXED_EXPENSE_PAYMENT_TEXTS.paidCannotDismiss);

    const october = await octoberLuz(ctx);
    closeMonth(ctx, "2026-10");
    const closed = await postAction(ctx, october.id, "dismiss");
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toMatch(/^O mês 10\/2026 está fechado/);
  });

  it("FR-12: undoing a payment brings the entry back to pending and out of the totals", async () => {
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id);
    const response = await postAction(ctx, luz.id, "undo", { reason: "valor errado" });
    expect(response.statusCode, response.body).toBe(200);
    expect(fixedExpenseSchema.parse(response.json())).toMatchObject({
      status: "pending",
      amountCents: null,
      paymentDate: null,
      paymentMeans: null,
      paidFromTill: false,
    });
    expect((await getFixedMonth(ctx)).paidTotalCents).toBe(0);
    const [entry] = await auditOf(ctx, "expense");
    expect(entry).toMatchObject({
      action: "update",
      before: { expenseStatus: "paid", amountCents: 18743 },
      after: { expenseStatus: "pending", amountCents: null },
      reason: "valor errado",
    });
  });

  it("RN-14: a payment on a closed day cannot be undone", async () => {
    const luz = await fixedEntry(ctx, "Luz");
    await payEntry(ctx, luz.id, { paymentDate: "2026-11-10" });
    closeDay(ctx, "2026-11-10");
    const response = await postAction(ctx, luz.id, "undo");
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "O dia 10/11/2026 está fechado. Reabra o dia para desfazer este pagamento.",
      code: DAY_CLOSED_CODE,
    });
  });

  it("FR-12: a dismissed entry can be reactivated; a pending one has nothing to undo", async () => {
    const tfe = await fixedEntry(ctx, "TFE");
    await postAction(ctx, tfe.id, "dismiss");
    const reactivated = await postAction(ctx, tfe.id, "undo");
    expect(reactivated.statusCode, reactivated.body).toBe(200);
    expect(reactivated.json().status).toBe("pending");

    const again = await postAction(ctx, tfe.id, "undo");
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe(FIXED_EXPENSE_PAYMENT_TEXTS.alreadyPending);
  });
});

describe("FR-13: loan installments", () => {
  it("FR-13: a loan with 10 installments left → paid → 9 left, and the entry shows 'parcela n de N'", async () => {
    await patchTemplate(ctx, "Empréstimos", { installmentsTotal: 12, installmentsRemaining: 10 });
    const loan = await fixedEntry(ctx, "Empréstimos");

    const paid = await payEntry(ctx, loan.id, { amountCents: 50000 });
    expect(paid).toMatchObject({ installmentNumber: 3, installmentsTotal: 12 });
    expect(fixedExpenseInstallmentLabel(paid)).toBe("parcela 3 de 12");
    expect((await templateByName(ctx, "Empréstimos")).installmentsRemaining).toBe(9);

    const [templateEntry] = await auditOf(ctx, "fixed_expense_template");
    expect(templateEntry).toMatchObject({
      action: "update",
      before: { installmentsRemaining: 10 },
      after: { installmentsRemaining: 9 },
      reason: "Pagamento da parcela 3 de 12 (FR-13).",
    });
  });

  it("FR-13: undoing the payment gives the installment back", async () => {
    await patchTemplate(ctx, "Empréstimos", { installmentsTotal: 12, installmentsRemaining: 10 });
    const loan = await fixedEntry(ctx, "Empréstimos");
    await payEntry(ctx, loan.id, { amountCents: 50000 });
    const response = await postAction(ctx, loan.id, "undo");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: "pending", installmentNumber: 3 });
    expect((await templateByName(ctx, "Empréstimos")).installmentsRemaining).toBe(10);
  });

  it("FR-13: with no installments left the payment is recorded without a countdown", async () => {
    await patchTemplate(ctx, "Empréstimos", { installmentsTotal: 12, installmentsRemaining: 0 });
    const loan = await fixedEntry(ctx, "Empréstimos");
    const paid = await payEntry(ctx, loan.id, { amountCents: 50000 });
    expect(paid.installmentNumber).toBeNull();
    expect((await templateByName(ctx, "Empréstimos")).installmentsRemaining).toBe(0);
    expect(await auditOf(ctx, "fixed_expense_template")).toHaveLength(1); // only the PATCH

    // Undoing it gives nothing back.
    await postAction(ctx, loan.id, "undo");
    expect((await templateByName(ctx, "Empréstimos")).installmentsRemaining).toBe(0);
  });

  it("FR-13: two pending installments are numbered in the order they are paid", async () => {
    await patchTemplate(ctx, "Empréstimos", { installmentsTotal: 12, installmentsRemaining: 10 });
    const november = await fixedEntry(ctx, "Empréstimos");
    // October's installment, generated with the same provisional number.
    const template = await templateByName(ctx, "Empréstimos");
    ctx.connection.db
      .insert(expenses)
      .values({
        type: "fixed",
        status: "pending",
        referenceMonth: "2026-10",
        fixedExpenseTemplateId: template.id,
        fixedExpenseGroup: "general",
        installmentNumber: 3,
        paidFromTill: false,
        createdAt: "2026-10-01T12:00:00.000Z",
      })
      .run();
    const october = await fixedEntry(ctx, "Empréstimos", "2026-10");

    expect((await payEntry(ctx, october.id)).installmentNumber).toBe(3);
    expect((await payEntry(ctx, november.id)).installmentNumber).toBe(4);
    expect((await templateByName(ctx, "Empréstimos")).installmentsRemaining).toBe(8);
    const stored = ctx.connection.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.type, "fixed"), eq(expenses.fixedExpenseTemplateId, template.id)))
      .all();
    expect(stored.map((row) => row.installmentNumber).sort()).toEqual([3, 4]);
  });
});
