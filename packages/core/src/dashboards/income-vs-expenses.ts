import { z } from "zod";
import { addDays, isCivilDate, type CivilDate } from "../time/civil-date";
import type { DayRange } from "./month-comparison";

/**
 * FR-26: Dashboard "Estou ganhando mais do que gasto?". Daily gross income (RN-06: sales and
 * refunds) against expenses (RN-08 general + RN-09 paid fixed, by payment date) over the last
 * 7 or 30 days, with the period totals and the difference. Card fees are not part of this
 * chart (the spec compares "entradas brutas × despesas"); the Saldo of FR-24 subtracts them.
 */

/** FR-26: the windows the owner can choose. */
export const INCOME_EXPENSE_WINDOWS = [7, 30] as const;
export type IncomeExpenseWindow = (typeof INCOME_EXPENSE_WINDOWS)[number];

const WINDOW_ERROR = "Escolha 7 ou 30 dias.";

/** Query of GET /api/dashboards/income-vs-expenses: `?days=7` (default) or `?days=30`. */
export const incomeVsExpensesQuerySchema = z.object({
  days: z
    .string({ message: WINDOW_ERROR })
    .optional()
    .transform((value, ctx): IncomeExpenseWindow => {
      if (value === undefined || value === "7") return 7;
      if (value === "30") return 30;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: WINDOW_ERROR });
      return z.NEVER;
    }),
});

/**
 * FR-26: the last `days` days, today included.
 *
 * @example lastDays("2026-11-18", 7) // { from: "2026-11-12", to: "2026-11-18" }
 * @throws RangeError for a window other than 7 or 30.
 */
export function lastDays(today: CivilDate, days: number): DayRange {
  if (!(INCOME_EXPENSE_WINDOWS as readonly number[]).includes(days)) {
    throw new RangeError(`lastDays expects 7 or 30 days, received ${days}`);
  }
  return { from: addDays(today, -(days - 1)), to: today };
}

/** One input row: an amount on a civil date (or the server's Σ for that date). */
export interface DailyAmountRow {
  date: CivilDate;
  cents: number;
}

const civilDate = z.string().refine(isCivilDate, { message: "Data inválida." });

const incomeExpenseDaySchema = z.object({
  date: civilDate,
  /** Σ gross of sales and refunds on the day (RN-06). */
  incomeCents: z.number().int(),
  /** Σ general expenses + paid fixed expenses with this payment date (RN-08, RN-09). */
  expensesCents: z.number().int(),
  /** income − expenses. */
  differenceCents: z.number().int(),
});
export type IncomeExpenseDay = z.infer<typeof incomeExpenseDaySchema>;

/** Response of GET /api/dashboards/income-vs-expenses (FR-26). */
export const incomeVsExpensesSchema = z.object({
  today: civilDate,
  days: z.union([z.literal(7), z.literal(30)]),
  from: civilDate,
  to: civilDate,
  /** One bar pair per day, oldest first; days without movement are zero. */
  daily: z.array(incomeExpenseDaySchema),
  /** Σ of the bars. */
  totals: z.object({
    incomeCents: z.number().int(),
    expensesCents: z.number().int(),
    differenceCents: z.number().int(),
  }),
});
export type IncomeVsExpenses = z.infer<typeof incomeVsExpensesSchema>;

/**
 * FR-26: one entry per day of the window (zero when nothing happened), and the totals as the
 * sum of those entries, so the totals always match the bars. Rows outside the window are
 * ignored.
 */
export function buildIncomeVsExpenses(input: {
  today: CivilDate;
  days: IncomeExpenseWindow;
  income: readonly DailyAmountRow[];
  expenses: readonly DailyAmountRow[];
}): IncomeVsExpenses {
  const range = lastDays(input.today, input.days);
  const daily = new Map<CivilDate, IncomeExpenseDay>();
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    daily.set(date, { date, incomeCents: 0, expensesCents: 0, differenceCents: 0 });
  }
  for (const row of input.income) {
    const day = daily.get(row.date);
    if (day) day.incomeCents += row.cents;
  }
  for (const row of input.expenses) {
    const day = daily.get(row.date);
    if (day) day.expensesCents += row.cents;
  }

  const totals = { incomeCents: 0, expensesCents: 0, differenceCents: 0 };
  for (const day of daily.values()) {
    day.differenceCents = day.incomeCents - day.expensesCents;
    totals.incomeCents += day.incomeCents;
    totals.expensesCents += day.expensesCents;
  }
  totals.differenceCents = totals.incomeCents - totals.expensesCents;

  return {
    today: input.today,
    days: input.days,
    ...range,
    daily: [...daily.values()],
    totals,
  };
}
