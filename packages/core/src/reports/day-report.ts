import { z } from "zod";
import type { SaleCategory } from "../catalog/categories";
import { cashClosingSchema, DAY_STATUSES } from "../cash-closing/cash-closing";
import { cashWithdrawalSchema } from "../cash-withdrawals/cash-withdrawals";
import { expenseSchema } from "../expenses/expenses";
import { fixedExpenseSchema } from "../fixed-expenses/fixed-expenses";
import { civilDateSchema } from "../payments/card-fees";
import type { PaymentMethod } from "../payments/payment-methods";
import { summarizeDaySales } from "../sales/day-summary";
import { saleTotalsSchema, type Sale, type SaleTotals } from "../sales/sales";

/**
 * FR-19: the day report ("Relatório do Dia"): the tab × payment method matrix with gross, fee
 * and net (RN-05), the day's expenses and sangrias, and the cash closing (RN-07). The daily
 * spreadsheet export (FR-28, #21) builds its "Resumo do dia" from the same data, so the file
 * always matches the screen.
 */

/** A column of the matrix: one payment method. */
export const dayMatrixMethodSchema = z.object({
  paymentMethodId: z.number().int(),
  name: z.string(),
  active: z.boolean(),
});
export type DayMatrixMethod = z.infer<typeof dayMatrixMethodSchema>;

/** A row of the matrix: one tab, with one cell per column (same order as `methods`). */
export const dayMatrixTabSchema = z.object({
  saleCategoryId: z.number().int(),
  name: z.string(),
  /** Display order, for the tab's color dot (design system). */
  order: z.number().int(),
  active: z.boolean(),
  /** False when the tab has no sale or refund that day (its cells are all zero). */
  hasSales: z.boolean(),
  cells: z.array(saleTotalsSchema),
  total: saleTotalsSchema,
});
export type DayMatrixTab = z.infer<typeof dayMatrixTabSchema>;

export const dayMatrixSchema = z.object({
  methods: z.array(dayMatrixMethodSchema),
  tabs: z.array(dayMatrixTabSchema),
  /** RN-05: one total per column (Σ tabs), same order as `methods`. */
  methodTotals: z.array(saleTotalsSchema),
  /** RN-05: total of the day = Σ tabs (= Σ method totals). */
  total: saleTotalsSchema,
});
export type DayMatrix = z.infer<typeof dayMatrixSchema>;

const ZERO: SaleTotals = { grossCents: 0, feeCents: 0, netCents: 0 };

/** Adds gross, fee and net separately (RN-05). */
function add(a: SaleTotals, b: SaleTotals): SaleTotals {
  return {
    grossCents: a.grossCents + b.grossCents,
    feeCents: a.feeCents + b.feeCents,
    netCents: a.netCents + b.netCents,
  };
}

/**
 * RN-05 / FR-19: the day's sales as a tab × payment method matrix.
 *
 * - Rows: every active tab, plus inactive tabs with sales that day, in display order (the
 *   order the owner gives the tabs in Cadastros, the same as the daily Excel).
 * - Columns: every active payment method, plus inactive ones with sales that day, in
 *   display order.
 * - Cell = Σ (sales + refunds) of that tab and method; tab total = Σ cells; method total =
 *   Σ column; day total = Σ tabs. Refunds are negative rows, so they are simply added in.
 */
export function buildDayMatrix(input: {
  tabs: readonly SaleCategory[];
  methods: readonly PaymentMethod[];
  sales: readonly Sale[];
}): DayMatrix {
  // The per-tab grouping and the tab list rules are FR-05's (RN-05).
  const summary = summarizeDaySales(input);

  const methodsWithSales = new Set(input.sales.map((sale) => sale.paymentMethodId));
  const methods: DayMatrixMethod[] = [...input.methods]
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .filter((method) => method.active || methodsWithSales.has(method.id))
    .map((method) => ({ paymentMethodId: method.id, name: method.name, active: method.active }));

  const tabs: DayMatrixTab[] = summary.tabs.map((tab) => {
    const cells = methods.map((column) => {
      const subtotal = tab.methods.find((m) => m.paymentMethodId === column.paymentMethodId);
      return subtotal
        ? {
            grossCents: subtotal.grossCents,
            feeCents: subtotal.feeCents,
            netCents: subtotal.netCents,
          }
        : ZERO;
    });
    return {
      saleCategoryId: tab.saleCategoryId,
      name: tab.name,
      order: tab.order,
      active: tab.active,
      hasSales: tab.sales.length > 0,
      cells,
      total: tab.total,
    };
  });

  const methodTotals = methods.map((_, column) =>
    tabs.reduce((sum, tab) => add(sum, tab.cells[column] ?? ZERO), ZERO),
  );

  return { methods, tabs, methodTotals, total: summary.total };
}

/** Response of GET /api/days/:date/report (FR-19). */
export const dayReportResponseSchema = z.object({
  date: civilDateSchema("Data inválida."),
  status: z.enum(DAY_STATUSES),
  /** A-15: any sale, refund, paid expense or sangria on the date. */
  hasMovement: z.boolean(),
  matrix: dayMatrixSchema,
  /** The day's general expenses ("saídas diárias"), in the order they were registered. */
  expenses: z.array(expenseSchema),
  /** The fixed expenses paid on this date (any reference month), by name. */
  fixedExpenses: z.array(fixedExpenseSchema),
  /** Σ of the day's general and fixed expenses. */
  expensesTotalCents: z.number().int(),
  /** RN-07: the part of them paid in cash from the till. */
  paidFromTillCents: z.number().int(),
  withdrawals: z.array(cashWithdrawalSchema),
  /** RN-07: Σ sangrias of the day. */
  withdrawalsTotalCents: z.number().int(),
  /** RN-07 terms computed from the day's records. */
  cash: z.object({
    cashSalesCents: z.number().int(),
    tillExpensesCents: z.number().int(),
    withdrawalsCents: z.number().int(),
  }),
  /** The stored cash closing (FR-08) when the day is closed; null otherwise. */
  closing: cashClosingSchema.nullable(),
});
export type DayReportResponse = z.infer<typeof dayReportResponseSchema>;
