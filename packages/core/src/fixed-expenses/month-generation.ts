import type { CivilDate } from "../time/civil-date";
import { lastDayOfMonth, type YearMonth } from "../time/year-month";
import { isTemplateGenerated, type FixedExpenseGroup } from "./fixed-expense-templates";

/**
 * FR-11: generating the month's fixed expenses. Pure functions: the server reads the
 * templates, calls `planMonthFixedExpenses` and writes the result in one transaction.
 */

/** The fields of a template the generation reads. */
export interface GenerationTemplate {
  id: number;
  group: FixedExpenseGroup;
  dueDay: number | null;
  expectedAmountCents: number | null;
  isLoan: boolean;
  installmentsTotal: number | null;
  installmentsRemaining: number | null;
  active: boolean;
}

/** One entry to create: a pending fixed expense of the month. */
export interface PlannedFixedExpense {
  fixedExpenseTemplateId: number;
  fixedExpenseGroup: FixedExpenseGroup;
  referenceMonth: YearMonth;
  /** Null while the template's due day is still to be filled in (Q-05). */
  dueDate: CivilDate | null;
  expectedAmountCents: number | null;
  /** FR-13: the loan installment this entry pays; null for other bills. */
  installmentNumber: number | null;
  status: "pending";
}

export interface MonthPlan {
  entries: PlannedFixedExpense[];
  /** FR-11: active loans with 0 installments left, to be deactivated automatically. */
  loansToDeactivate: number[];
}

/**
 * FR-11: the due date in the month: the configured day, or the month's last day when the
 * month does not have that day (31 in November → 30/11; 30 in February → 28/02 or 29/02).
 * Null when the template has no due day yet (Q-05): the entry is generated "sem vencimento".
 */
export function dueDateInMonth(yearMonth: YearMonth, dueDay: number | null): CivilDate | null {
  if (dueDay === null) return null;
  const day = Math.min(dueDay, lastDayOfMonth(yearMonth));
  return `${yearMonth}-${String(day).padStart(2, "0")}`;
}

/**
 * FR-13: the installment the next payment covers, for "parcela n de N": total − remaining + 1
 * (12 in total, 10 left → parcela 3 de 12). Null for regular bills, for a loan whose
 * installments are still to be filled in (Q-06) and for a loan with nothing left.
 */
export function loanInstallmentNumber(template: {
  isLoan: boolean;
  installmentsTotal: number | null;
  installmentsRemaining: number | null;
}): number | null {
  const { isLoan, installmentsTotal: total, installmentsRemaining: remaining } = template;
  if (!isLoan || total === null || remaining === null || remaining <= 0) return null;
  return total - remaining + 1;
}

/**
 * FR-11: what generating month M creates: for each template that `isTemplateGenerated()`
 * (active, and not a loan with 0 left), one pending entry with reference month M, the due
 * date in M and the expected amount. Active loans with 0 left are listed to be deactivated.
 */
export function planMonthFixedExpenses(
  templates: readonly GenerationTemplate[],
  yearMonth: YearMonth,
): MonthPlan {
  const entries: PlannedFixedExpense[] = templates.filter(isTemplateGenerated).map((template) => ({
    fixedExpenseTemplateId: template.id,
    fixedExpenseGroup: template.group,
    referenceMonth: yearMonth,
    dueDate: dueDateInMonth(yearMonth, template.dueDay),
    expectedAmountCents: template.expectedAmountCents,
    installmentNumber: loanInstallmentNumber(template),
    status: "pending",
  }));
  const loansToDeactivate = templates
    .filter(
      (template) => template.active && template.isLoan && template.installmentsRemaining === 0,
    )
    .map((template) => template.id);
  return { entries, loansToDeactivate };
}
