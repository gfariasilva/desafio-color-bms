import { z } from "zod";
import { yearMonthSchema } from "../time/year-month";
import type { MonthFixedExpensesReport } from "./month-fixed-expenses";
import type { MonthGeneralExpensesResponse } from "./month-general-expenses";
import type { MonthIncomeResponse } from "./month-income";

/**
 * FR-23: the monthly summary ("Resumo mensal"). Every line is a total of the month reports
 * (FR-20 to FR-22), so the summary always agrees with them (FR-23's acceptance criterion).
 * The monthly spreadsheet (FR-29, #28) builds its "Resumo" sheet from the same data.
 */

/** Response of GET /api/months/:yearMonth/reports/summary (FR-23). */
export const monthSummarySchema = z.object({
  yearMonth: yearMonthSchema("Mês inválido."),
  /** Entrada mensal (bruta), RN-06 (FR-20). */
  grossCents: z.number().int(),
  /** (−) Taxas de maquininha, RN-06 (FR-20). */
  feeCents: z.number().int(),
  /** (−) Total despesas gerais, RN-08 (FR-21). */
  generalExpensesCents: z.number().int(),
  /** (−) Total despesas fixas, RN-09 (FR-22: total pago no mês). */
  fixedExpensesCents: z.number().int(),
  /** RN-10: Total geral de despesas. */
  totalExpensesCents: z.number().int(),
  /** RN-10: Saldo mensal. Negative when the month spent more than it earned. */
  balanceCents: z.number().int(),
});
export type MonthSummary = z.infer<typeof monthSummarySchema>;

/**
 * RN-10: Total geral de despesas = Despesas gerais do mês + Despesas fixas do mês;
 * Saldo mensal = Entrada mensal (bruta) − Taxas do mês − Total geral de despesas.
 * Sangrias never enter it (internal movement): none of the three reports includes them.
 */
export function buildMonthSummary(input: {
  income: Pick<MonthIncomeResponse, "yearMonth" | "total">;
  generalExpenses: Pick<MonthGeneralExpensesResponse, "totalCents">;
  fixedExpenses: Pick<MonthFixedExpensesReport, "paidTotalCents">;
}): MonthSummary {
  const grossCents = input.income.total.grossCents;
  const feeCents = input.income.total.feeCents;
  const generalExpensesCents = input.generalExpenses.totalCents;
  const fixedExpensesCents = input.fixedExpenses.paidTotalCents;
  const totalExpensesCents = generalExpensesCents + fixedExpensesCents;
  return {
    yearMonth: input.income.yearMonth,
    grossCents,
    feeCents,
    generalExpensesCents,
    fixedExpensesCents,
    totalExpensesCents,
    balanceCents: grossCents - feeCents - totalExpensesCents,
  };
}
