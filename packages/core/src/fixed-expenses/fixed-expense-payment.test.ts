import { describe, expect, it } from "vitest";
import { MAX_EXPENSE_CENTS } from "../expenses/expenses";
import {
  contaBillName,
  convertContaInputSchema,
  dismissFixedExpenseBlock,
  FIXED_EXPENSE_PAYMENT_TEXTS,
  fixedExpensesOfMonthCents,
  fixedExpenseStatusChangeInputSchema,
  loanPayment,
  loanUndo,
  payFixedExpenseBlock,
  payFixedExpenseInputSchema,
  undoFixedExpenseBlock,
} from "./fixed-expense-payment";

/** The block's message, or null (the kinds are checked in their own test). */
const payFixedExpenseError = (...args: Parameters<typeof payFixedExpenseBlock>) =>
  payFixedExpenseBlock(...args)?.message ?? null;
const dismissFixedExpenseError = (...args: Parameters<typeof dismissFixedExpenseBlock>) =>
  dismissFixedExpenseBlock(...args)?.message ?? null;
const undoFixedExpenseError = (...args: Parameters<typeof undoFixedExpenseBlock>) =>
  undoFixedExpenseBlock(...args)?.message ?? null;

const OPEN = { dayClosed: false, monthClosed: false };
const TODAY = "2026-11-18";

const PAY = {
  amountCents: 18743,
  paymentDate: "2026-11-10",
  paymentMeans: "pix",
} as const;

function payParseError(input: unknown): string | null {
  const parsed = payFixedExpenseInputSchema.safeParse(input);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "?");
}

describe("FR-12: payment input", () => {
  it("FR-12: accepts amount R$ 187,43, date 10/11/2026 and PIX", () => {
    expect(payFixedExpenseInputSchema.parse(PAY)).toEqual(PAY);
  });

  it("FR-12: the amount is required, an integer of cents, greater than zero", () => {
    expect(payParseError({ ...PAY, amountCents: undefined })).toBe(
      "Informe um valor maior que zero.",
    );
    expect(payParseError({ ...PAY, amountCents: 0 })).toBe("Informe um valor maior que zero.");
    expect(payParseError({ ...PAY, amountCents: -100 })).toBe("Informe um valor maior que zero.");
    expect(payParseError({ ...PAY, amountCents: 187.43 })).toBe("Valor inválido.");
  });

  it("FR-12: accepts the largest amount and refuses one cent more", () => {
    expect(payParseError({ ...PAY, amountCents: MAX_EXPENSE_CENTS })).toBeNull();
    expect(payParseError({ ...PAY, amountCents: MAX_EXPENSE_CENTS + 1 })).toMatch(/valor máximo/);
  });

  it("FR-12: the payment date and the means are required (A-14 list)", () => {
    expect(payParseError({ ...PAY, paymentDate: "10/11/2026" })).toBe("Data inválida.");
    expect(payParseError({ ...PAY, paymentMeans: "cheque" })).toBe("Escolha o meio de pagamento.");
  });

  it("FR-12: a dismissal or undo takes an optional reason; no body is fine", () => {
    expect(fixedExpenseStatusChangeInputSchema.parse(undefined)).toEqual({ reason: null });
    expect(fixedExpenseStatusChangeInputSchema.parse({ reason: "  TFE é anual " })).toEqual({
      reason: "TFE é anual",
    });
    expect(fixedExpenseStatusChangeInputSchema.parse({ reason: "  " })).toEqual({ reason: null });
  });
});

describe("FR-12: can this fixed expense be paid?", () => {
  it("FR-12: a pending entry can be paid on an open day in the past or today", () => {
    expect(payFixedExpenseError({ status: "pending" }, "2026-11-10", TODAY, OPEN)).toBeNull();
    expect(payFixedExpenseError({ status: "pending" }, TODAY, TODAY, OPEN)).toBeNull();
  });

  it("FR-12: a paid or dismissed entry cannot be paid again", () => {
    expect(payFixedExpenseError({ status: "paid" }, TODAY, TODAY, OPEN)).toBe(
      FIXED_EXPENSE_PAYMENT_TEXTS.alreadyPaid,
    );
    expect(payFixedExpenseError({ status: "dismissed" }, TODAY, TODAY, OPEN)).toBe(
      FIXED_EXPENSE_PAYMENT_TEXTS.dismissedCannotPay,
    );
  });

  it("RN-15: the payment date cannot be in the future", () => {
    expect(payFixedExpenseError({ status: "pending" }, "2026-11-19", TODAY, OPEN)).toBe(
      "Não é possível registrar lançamentos com data futura.",
    );
  });

  it("FR-12 / A-16: the payment date cannot fall on a closed day", () => {
    expect(
      payFixedExpenseError({ status: "pending" }, "2026-11-10", TODAY, {
        dayClosed: true,
        monthClosed: false,
      }),
    ).toBe("O dia 10/11/2026 está fechado. Reabra o dia para registrar pagamentos nessa data.");
  });

  it("RN-14: nor in a closed month", () => {
    expect(
      payFixedExpenseError({ status: "pending" }, "2026-10-10", TODAY, {
        dayClosed: true,
        monthClosed: true,
      }),
    ).toMatch(/^O mês 10\/2026 está fechado/);
  });
});

describe("FR-12: block kinds (the server maps them to HTTP)", () => {
  it("FR-12: wrong status, future date and closed period are told apart", () => {
    expect(payFixedExpenseBlock({ status: "paid" }, TODAY, TODAY, OPEN)?.kind).toBe("status");
    expect(payFixedExpenseBlock({ status: "pending" }, "2026-11-19", TODAY, OPEN)?.kind).toBe(
      "future",
    );
    expect(
      payFixedExpenseBlock({ status: "pending" }, TODAY, TODAY, {
        dayClosed: true,
        monthClosed: false,
      })?.kind,
    ).toBe("locked");
    expect(
      dismissFixedExpenseBlock({ status: "pending", referenceMonth: "2026-10" }, true)?.kind,
    ).toBe("locked");
  });
});

describe("FR-12: dismissing and undoing", () => {
  it("FR-12: only a pending entry of an open reference month can be dismissed", () => {
    expect(dismissFixedExpenseError({ status: "pending", referenceMonth: "2026-11" }, false)).toBe(
      null,
    );
    expect(dismissFixedExpenseError({ status: "paid", referenceMonth: "2026-11" }, false)).toBe(
      FIXED_EXPENSE_PAYMENT_TEXTS.paidCannotDismiss,
    );
    expect(
      dismissFixedExpenseError({ status: "dismissed", referenceMonth: "2026-11" }, false),
    ).toBe(FIXED_EXPENSE_PAYMENT_TEXTS.alreadyDismissed);
    expect(dismissFixedExpenseError({ status: "pending", referenceMonth: "2026-10" }, true)).toBe(
      "O mês 10/2026 está fechado. Reabra o mês para alterar as contas dele.",
    );
  });

  it("FR-12 / RN-14: a payment is undone only while its payment day is open", () => {
    const paid = { status: "paid", referenceMonth: "2026-11", paymentDate: "2026-11-10" } as const;
    expect(undoFixedExpenseError(paid, OPEN, false)).toBeNull();
    expect(undoFixedExpenseError(paid, { dayClosed: true, monthClosed: false }, false)).toBe(
      "O dia 10/11/2026 está fechado. Reabra o dia para desfazer este pagamento.",
    );
  });

  it("FR-12: a dismissed entry is reactivated only while its reference month is open", () => {
    const dismissed = {
      status: "dismissed",
      referenceMonth: "2026-11",
      paymentDate: null,
    } as const;
    expect(undoFixedExpenseError(dismissed, OPEN, false)).toBeNull();
    expect(undoFixedExpenseError(dismissed, OPEN, true)).toMatch(/^O mês 11\/2026 está fechado/);
  });

  it("FR-12: a pending entry has nothing to undo", () => {
    expect(
      undoFixedExpenseError(
        { status: "pending", referenceMonth: "2026-11", paymentDate: null },
        OPEN,
        false,
      ),
    ).toBe(FIXED_EXPENSE_PAYMENT_TEXTS.alreadyPending);
  });
});

describe("FR-13: loan installments", () => {
  const loan = { isLoan: true, installmentsTotal: 12, installmentsRemaining: 10 };

  it("FR-13: paying with 10 left pays installment 3 of 12 and leaves 9", () => {
    expect(loanPayment(loan)).toEqual({ installmentNumber: 3, installmentsRemaining: 9 });
  });

  it("FR-13: paying the last installment leaves 0", () => {
    expect(loanPayment({ ...loan, installmentsRemaining: 1 })).toEqual({
      installmentNumber: 12,
      installmentsRemaining: 0,
    });
  });

  it("FR-13: no countdown for a regular bill, blank installments (Q-06) or nothing left", () => {
    expect(
      loanPayment({ isLoan: false, installmentsTotal: null, installmentsRemaining: null }),
    ).toBe(null);
    expect(
      loanPayment({ isLoan: true, installmentsTotal: null, installmentsRemaining: null }),
    ).toBe(null);
    expect(loanPayment({ ...loan, installmentsRemaining: 0 })).toBeNull();
  });

  it("FR-13: undoing a counted payment gives the installment back, never above the total", () => {
    expect(loanUndo({ ...loan, installmentsRemaining: 9 })).toEqual({ installmentsRemaining: 10 });
    expect(loanUndo({ ...loan, installmentsRemaining: 12 })).toBeNull();
    expect(loanUndo({ isLoan: true, installmentsTotal: null, installmentsRemaining: null })).toBe(
      null,
    );
  });
});

describe("RN-09: fixed expenses of the month", () => {
  const row = {
    type: "fixed",
    status: "paid",
    amountCents: 18743,
    paymentDate: "2026-11-10",
    paymentMeans: "pix",
    paidFromTill: false,
  } as const;

  it("RN-09: Σ paid fixed expenses by payment date (cash basis)", () => {
    const rows = [
      row,
      // October's bill paid on 10/11 counts in November.
      { ...row, amountCents: 20000, paymentDate: "2026-11-01" },
      { ...row, amountCents: 5000, paymentDate: "2026-11-30" },
      // Paid on 31/10: October.
      { ...row, amountCents: 999, paymentDate: "2026-10-31" },
      // Paid on 01/12: December.
      { ...row, amountCents: 777, paymentDate: "2026-12-01" },
    ];
    expect(fixedExpensesOfMonthCents(rows, "2026-11")).toBe(18743 + 20000 + 5000);
    expect(fixedExpensesOfMonthCents(rows, "2026-10")).toBe(999);
  });

  it("RN-09: pending and dismissed entries and general expenses do not count", () => {
    const rows = [
      row,
      { ...row, status: "pending", amountCents: null, paymentDate: null },
      { ...row, status: "dismissed", amountCents: null, paymentDate: null },
      { ...row, type: "general", amountCents: 4500 },
    ] as const;
    expect(fixedExpensesOfMonthCents(rows, "2026-11")).toBe(18743);
    expect(fixedExpensesOfMonthCents([], "2026-11")).toBe(0);
  });
});

describe("#13: converting the pilot's CONTA: sangrias", () => {
  it("#13: a note starting with CONTA: names the bill (any case, spaces trimmed)", () => {
    expect(contaBillName("CONTA: Luz outubro")).toBe("Luz outubro");
    expect(contaBillName("  conta:água ")).toBe("água");
    expect(contaBillName("CONTA:")).toBe("");
  });

  it("#13: any other note is not a bill", () => {
    expect(contaBillName("depósito no banco")).toBeNull();
    expect(contaBillName("Luz CONTA: outubro")).toBeNull();
    expect(contaBillName("CONTAS a pagar")).toBeNull();
    expect(contaBillName(null)).toBeNull();
  });

  it("#13: the target is a pending entry or a new one-off bill with a name and group", () => {
    expect(convertContaInputSchema.parse({ target: "existing", fixedExpenseId: 4 })).toEqual({
      target: "existing",
      fixedExpenseId: 4,
    });
    expect(
      convertContaInputSchema.parse({
        target: "one_off",
        name: " Luz  outubro ",
        group: "general",
      }),
    ).toEqual({ target: "one_off", name: "Luz outubro", group: "general" });
    expect(
      convertContaInputSchema.safeParse({ target: "one_off", name: "", group: "general" }).success,
    ).toBe(false);
    expect(convertContaInputSchema.safeParse({ target: "existing" }).success).toBe(false);
  });
});
