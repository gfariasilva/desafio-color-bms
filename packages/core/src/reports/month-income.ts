import { z } from "zod";
import type { SaleCategory } from "../catalog/categories";
import type { PaymentMethod } from "../payments/payment-methods";
import { civilDateSchema } from "../payments/card-fees";
import { saleTotalsSchema, type SaleTotals } from "../sales/sales";
import type { CivilDate } from "../time/civil-date";
import { lastDayOfMonth, yearMonthSchema, type YearMonth } from "../time/year-month";

/**
 * FR-20: the month income report ("Relatório Mês – Entradas"): a days × tabs grid with the
 * gross of each tab on each day, the month total of each tab, the month totals per payment
 * method (gross, fee, net) and the monthly income, fees and net (RN-06). The monthly
 * spreadsheet (FR-29, #28) builds its "Entradas" sheet from the same data.
 */

/**
 * One input row: a sale or refund, or the server's Σ of them per day, tab and method. Any
 * mix of both adds up the same, because every total here is a plain sum (RN-06).
 */
export interface MonthIncomeRow {
  date: CivilDate;
  saleCategoryId: number;
  paymentMethodId: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

/** A grid column: one tab, with its month total (gross). */
export const monthIncomeTabSchema = z.object({
  saleCategoryId: z.number().int(),
  name: z.string(),
  /** Display order, for the tab's color dot (design system). */
  order: z.number().int(),
  active: z.boolean(),
  /** FR-20: Σ gross of the tab in the month (= Σ of its column). */
  totalCents: z.number().int(),
});
export type MonthIncomeTab = z.infer<typeof monthIncomeTabSchema>;

/** A grid row: one day, with the gross of each tab (same order as `tabs`). */
export const monthIncomeDaySchema = z.object({
  date: civilDateSchema("Data inválida."),
  cells: z.array(z.number().int()),
  /** Σ cells: the day's gross. */
  totalCents: z.number().int(),
  /** False when the day has no sale or refund (its cells are all zero). */
  hasSales: z.boolean(),
});
export type MonthIncomeDay = z.infer<typeof monthIncomeDaySchema>;

/** FR-20: the month totals of one payment method. */
export const monthIncomeMethodSchema = saleTotalsSchema.extend({
  paymentMethodId: z.number().int(),
  name: z.string(),
  active: z.boolean(),
});
export type MonthIncomeMethod = z.infer<typeof monthIncomeMethodSchema>;

/** Response of GET /api/months/:yearMonth/reports/income (FR-20). */
export const monthIncomeResponseSchema = z.object({
  yearMonth: yearMonthSchema("Mês inválido."),
  tabs: z.array(monthIncomeTabSchema),
  days: z.array(monthIncomeDaySchema),
  methods: z.array(monthIncomeMethodSchema),
  /** RN-06: Entrada mensal (gross), Taxas do mês (fee) and Líquido do mês (net). */
  total: saleTotalsSchema,
});
export type MonthIncomeResponse = z.infer<typeof monthIncomeResponseSchema>;

/**
 * FR-20: the rows of the grid: every day of the month, up to `today` for the current month
 * (no sale can be in the future, RN-15). A month after today's has no rows.
 *
 * @example monthReportDays("2026-11", "2026-11-18").length // 18
 */
export function monthReportDays(yearMonth: YearMonth, today: CivilDate): CivilDate[] {
  const days: CivilDate[] = [];
  for (let day = 1; day <= lastDayOfMonth(yearMonth); day++) {
    const date = `${yearMonth}-${String(day).padStart(2, "0")}`;
    // Civil dates compare correctly as text.
    if (date > today) break;
    days.push(date);
  }
  return days;
}

/**
 * RN-06 / FR-20: builds the month income report from the month's sales and refunds.
 *
 * - Columns: every active tab, plus inactive tabs with sales in the month, in display order
 *   (the same rule as the day report, FR-19).
 * - Rows: `monthReportDays`, plus any other date of the month that has rows, so the column
 *   sums always equal the tab totals.
 * - Methods: every active method, plus inactive ones with sales in the month.
 * - Refunds are negative rows, so they are simply added in. Rows of other months are ignored.
 */
export function buildMonthIncome(input: {
  yearMonth: YearMonth;
  today: CivilDate;
  tabs: readonly SaleCategory[];
  methods: readonly PaymentMethod[];
  rows: readonly MonthIncomeRow[];
}): MonthIncomeResponse {
  const rows = input.rows.filter((row) => row.date.slice(0, 7) === input.yearMonth);

  const tabsWithSales = new Set(rows.map((row) => row.saleCategoryId));
  const tabs = [...input.tabs]
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .filter((tab) => tab.active || tabsWithSales.has(tab.id));
  const column = new Map(tabs.map((tab, index) => [tab.id, index]));

  // Grid rows: the calendar days, plus any other date that has rows.
  const dates = [
    ...new Set([...monthReportDays(input.yearMonth, input.today), ...rows.map((r) => r.date)]),
  ];
  dates.sort();
  const days = new Map<CivilDate, MonthIncomeDay>(
    dates.map((date) => [date, { date, cells: tabs.map(() => 0), totalCents: 0, hasSales: false }]),
  );

  const methodsWithSales = new Set(rows.map((row) => row.paymentMethodId));
  const methods: MonthIncomeMethod[] = [...input.methods]
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .filter((method) => method.active || methodsWithSales.has(method.id))
    .map((method) => ({
      paymentMethodId: method.id,
      name: method.name,
      active: method.active,
      grossCents: 0,
      feeCents: 0,
      netCents: 0,
    }));
  const methodById = new Map(methods.map((method) => [method.paymentMethodId, method]));

  const total: SaleTotals = { grossCents: 0, feeCents: 0, netCents: 0 };
  for (const row of rows) {
    const day = days.get(row.date)!;
    const index = column.get(row.saleCategoryId);
    // Every tab with rows is a column (see above); the guard only satisfies the type checker.
    if (index !== undefined) day.cells[index] = (day.cells[index] ?? 0) + row.grossCents;
    day.totalCents += row.grossCents;
    day.hasSales = true;

    const method = methodById.get(row.paymentMethodId);
    if (method) {
      method.grossCents += row.grossCents;
      method.feeCents += row.feeCents;
      method.netCents += row.netCents;
    }

    // RN-06: Entrada mensal = Σ gross; Taxas do mês = Σ fee.
    total.grossCents += row.grossCents;
    total.feeCents += row.feeCents;
  }
  // RN-06: Líquido do mês = Entrada mensal − Taxas do mês.
  total.netCents = total.grossCents - total.feeCents;

  const dayList = [...days.values()];
  return {
    yearMonth: input.yearMonth,
    tabs: tabs.map((tab, index) => ({
      saleCategoryId: tab.id,
      name: tab.name,
      order: tab.order,
      active: tab.active,
      totalCents: dayList.reduce((sum, day) => sum + (day.cells[index] ?? 0), 0),
    })),
    days: dayList,
    methods,
    total,
  };
}
