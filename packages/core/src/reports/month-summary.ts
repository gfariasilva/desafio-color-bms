import { z } from "zod";
import { yearMonthSchema, type YearMonth } from "../time/year-month";

/**
 * FR-23: the monthly summary ("Resumo mensal"). Every line is taken from the month reports
 * (FR-20 to FR-22), so the summary can never disagree with them. The dashboards (#18, #19)
 * and the monthly spreadsheet's "Resumo" sheet (FR-29, #28) reuse it.
 */

/** RN-10: the monthly balance from the month's totals. */
export function monthBalance(totals: {
  /** RN-06: Entrada mensal (gross, refunds already negative). */
  incomeCents: number;
  /** RN-06: Taxas do mês. */
  feesCents: number;
  /** RN-08: Despesas gerais do mês. */
  generalExpensesCents: number;
  /** RN-09: Despesas fixas do mês (paid, by payment date). */
  fixedExpensesCents: number;
}): { totalExpensesCents: number; balanceCents: number } {
  // RN-10: Total geral de despesas = Despesas gerais do mês + Despesas fixas do mês.
  const totalExpensesCents = totals.generalExpensesCents + totals.fixedExpensesCents;
  // RN-10: Saldo mensal = Entrada mensal (bruta) − Taxas do mês − Total geral de despesas.
  // Sangrias are not here: they are internal cash movements, not expenses.
  const balanceCents = totals.incomeCents - totals.feesCents - totalExpensesCents;
  return { totalExpensesCents, balanceCents };
}

/** Response of GET /api/months/:yearMonth/reports/summary (FR-23). */
export const monthSummaryResponseSchema = z.object({
  yearMonth: yearMonthSchema("Mês inválido."),
  /** Entrada mensal (bruta): FR-20 total gross. */
  incomeCents: z.number().int(),
  /** (−) Taxas de maquininha: FR-20 total fee. */
  feesCents: z.number().int(),
  /** (−) Total despesas gerais: FR-21 total geral. */
  generalExpensesCents: z.number().int(),
  /** (−) Total despesas fixas: FR-22 total pago no mês. */
  fixedExpensesCents: z.number().int(),
  /** Total geral de despesas (RN-10). */
  totalExpensesCents: z.number().int(),
  /** Saldo mensal (RN-10); negative when the month lost money. */
  balanceCents: z.number().int(),
});
export type MonthSummaryResponse = z.infer<typeof monthSummaryResponseSchema>;

/**
 * FR-23: builds the summary from the three month reports. Only the totals are read, so the
 * reports' full responses can be passed in. Reports of different months are a bug.
 */
export function buildMonthSummary(reports: {
  income: { yearMonth: YearMonth; total: { grossCents: number; feeCents: number } };
  generalExpenses: { yearMonth: YearMonth; totalCents: number };
  fixedExpenses: { yearMonth: YearMonth; paidTotalCents: number };
}): MonthSummaryResponse {
  const { yearMonth } = reports.income;
  if (
    reports.generalExpenses.yearMonth !== yearMonth ||
    reports.fixedExpenses.yearMonth !== yearMonth
  ) {
    throw new RangeError("buildMonthSummary expects the reports of a single month");
  }
  const totals = {
    incomeCents: reports.income.total.grossCents,
    feesCents: reports.income.total.feeCents,
    generalExpensesCents: reports.generalExpenses.totalCents,
    fixedExpensesCents: reports.fixedExpenses.paidTotalCents,
  };
  return { yearMonth, ...totals, ...monthBalance(totals) };
}
