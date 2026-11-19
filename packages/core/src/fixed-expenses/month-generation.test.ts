import { describe, expect, it } from "vitest";
import {
  dueDateInMonth,
  loanInstallmentNumber,
  planMonthFixedExpenses,
  type GenerationTemplate,
} from "./month-generation";

function template(overrides: Partial<GenerationTemplate> = {}): GenerationTemplate {
  return {
    id: 1,
    group: "general",
    dueDay: 10,
    expectedAmountCents: 20000,
    isLoan: false,
    installmentsTotal: null,
    installmentsRemaining: null,
    active: true,
    ...overrides,
  };
}

describe("FR-11: due date of the month", () => {
  it("FR-11: due date is the configured day of the month", () => {
    expect(dueDateInMonth("2026-11", 10)).toBe("2026-11-10");
    expect(dueDateInMonth("2026-11", 1)).toBe("2026-11-01");
    expect(dueDateInMonth("2026-01", 31)).toBe("2026-01-31");
  });

  it("FR-11: a day the month does not have falls on the month's last day", () => {
    expect(dueDateInMonth("2026-11", 31)).toBe("2026-11-30");
    expect(dueDateInMonth("2026-02", 31)).toBe("2026-02-28");
    expect(dueDateInMonth("2026-02", 29)).toBe("2026-02-28");
    expect(dueDateInMonth("2028-02", 30)).toBe("2028-02-29");
    expect(dueDateInMonth("2028-02", 29)).toBe("2028-02-29");
  });

  it("FR-11: a template whose due day is still empty (Q-05) has no due date", () => {
    expect(dueDateInMonth("2026-11", null)).toBeNull();
  });
});

describe("FR-13 prep: loan installment number", () => {
  it("FR-13: the next installment is total − remaining + 1", () => {
    expect(
      loanInstallmentNumber({ isLoan: true, installmentsTotal: 12, installmentsRemaining: 10 }),
    ).toBe(3);
    expect(
      loanInstallmentNumber({ isLoan: true, installmentsTotal: 12, installmentsRemaining: 12 }),
    ).toBe(1);
    expect(
      loanInstallmentNumber({ isLoan: true, installmentsTotal: 12, installmentsRemaining: 1 }),
    ).toBe(12);
  });

  it("FR-13: no number for a loan with empty installments (Q-06) or a regular bill", () => {
    expect(
      loanInstallmentNumber({ isLoan: true, installmentsTotal: null, installmentsRemaining: null }),
    ).toBeNull();
    expect(
      loanInstallmentNumber({
        isLoan: false,
        installmentsTotal: null,
        installmentsRemaining: null,
      }),
    ).toBeNull();
  });

  it("FR-13: no number when nothing is left", () => {
    expect(
      loanInstallmentNumber({ isLoan: true, installmentsTotal: 12, installmentsRemaining: 0 }),
    ).toBeNull();
  });
});

describe("FR-11: planning the month's fixed expenses", () => {
  it("FR-11: plans one pending entry per active template, with month, due date and expected amount", () => {
    const plan = planMonthFixedExpenses(
      [
        template({ id: 1, dueDay: 10, expectedAmountCents: 20000 }),
        template({ id: 2, group: "government_fees", dueDay: 31, expectedAmountCents: null }),
      ],
      "2026-11",
    );
    expect(plan.entries).toEqual([
      {
        fixedExpenseTemplateId: 1,
        fixedExpenseGroup: "general",
        referenceMonth: "2026-11",
        dueDate: "2026-11-10",
        expectedAmountCents: 20000,
        installmentNumber: null,
        status: "pending",
      },
      {
        fixedExpenseTemplateId: 2,
        fixedExpenseGroup: "government_fees",
        referenceMonth: "2026-11",
        dueDate: "2026-11-30",
        expectedAmountCents: null,
        installmentNumber: null,
        status: "pending",
      },
    ]);
    expect(plan.loansToDeactivate).toEqual([]);
  });

  it("FR-10: a deactivated template is not planned", () => {
    const plan = planMonthFixedExpenses(
      [template({ id: 1 }), template({ id: 2, active: false })],
      "2026-11",
    );
    expect(plan.entries.map((entry) => entry.fixedExpenseTemplateId)).toEqual([1]);
  });

  it("FR-11: a loan with 0 installments left is not planned and is deactivated", () => {
    const plan = planMonthFixedExpenses(
      [template({ id: 7, isLoan: true, installmentsTotal: 10, installmentsRemaining: 0 })],
      "2026-11",
    );
    expect(plan.entries).toEqual([]);
    expect(plan.loansToDeactivate).toEqual([7]);
  });

  it("FR-11: an already inactive finished loan is not deactivated again", () => {
    const plan = planMonthFixedExpenses(
      [
        template({
          id: 7,
          isLoan: true,
          installmentsTotal: 10,
          installmentsRemaining: 0,
          active: false,
        }),
      ],
      "2026-11",
    );
    expect(plan.loansToDeactivate).toEqual([]);
  });

  it("FR-11: a loan with installments left is planned with its installment number", () => {
    const plan = planMonthFixedExpenses(
      [template({ id: 7, isLoan: true, installmentsTotal: 12, installmentsRemaining: 10 })],
      "2026-11",
    );
    expect(plan.entries[0]?.installmentNumber).toBe(3);
  });

  it("FR-11: a loan with empty installments (Q-06) is planned without a number", () => {
    const plan = planMonthFixedExpenses(
      [template({ id: 7, isLoan: true, installmentsTotal: null, installmentsRemaining: null })],
      "2026-11",
    );
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.installmentNumber).toBeNull();
  });

  it("FR-11: a template without due day (Q-05) is planned without a due date", () => {
    const plan = planMonthFixedExpenses([template({ dueDay: null })], "2026-02");
    expect(plan.entries[0]?.dueDate).toBeNull();
  });
});
