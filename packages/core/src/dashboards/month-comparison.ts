import { z } from "zod";
import { isCivilDate, parseCivilDate, type CivilDate } from "../time/civil-date";
import { addMonths, lastDayOfMonth, yearMonthSchema, type YearMonth } from "../time/year-month";
import { rn10Totals, type MonthSummary } from "../reports/month-summary";
import { variationTenths } from "./variation";

/**
 * FR-24: Dashboard "Como está este mês comparado ao anterior?". The current month up to today
 * against the **same days** of the previous month (A-13: day 1 to today's day), plus the whole
 * previous month as a reference. The totals follow RN-06, RN-08, RN-09 and RN-10; the
 * variation follows RN-11.
 */

/** A range of civil dates, both ends included. */
export interface DayRange {
  from: CivilDate;
  to: CivilDate;
}

const civilDate = z.string().refine(isCivilDate, { message: "Data inválida." });
const dayRangeSchema = z.object({ from: civilDate, to: civilDate });

/**
 * FR-24 (A-13): the two periods compared on `today`. The previous period runs from day 1 to
 * the same day of the previous month, stopping at that month's last day when it is shorter
 * (on 31/03 the previous period is 01–28/02, or 01–29/02 in a leap year).
 *
 * @example comparisonPeriods("2026-11-18") // 01–18/11 against 01–18/10
 */
export function comparisonPeriods(today: CivilDate): {
  currentMonth: YearMonth;
  previousMonth: YearMonth;
  current: DayRange;
  previous: DayRange;
} {
  const [, , day] = parseCivilDate(today, "comparisonPeriods");
  const currentMonth = today.slice(0, 7);
  const previousMonth = addMonths(currentMonth, -1);
  const previousDay = Math.min(day, lastDayOfMonth(previousMonth));
  return {
    currentMonth,
    previousMonth,
    current: { from: `${currentMonth}-01`, to: today },
    previous: {
      from: `${previousMonth}-01`,
      to: `${previousMonth}-${String(previousDay).padStart(2, "0")}`,
    },
  };
}

/**
 * Formats a day range compactly for headers, e.g. "01–18/11". Ranges across two months (not
 * used by FR-24) show both months: "25/10–05/11".
 */
export function formatDayRange(range: DayRange): string {
  const [, fromMonth, fromDay] = parseCivilDate(range.from, "formatDayRange");
  const [, toMonth, toDay] = parseCivilDate(range.to, "formatDayRange");
  const pad = (value: number) => String(value).padStart(2, "0");
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) {
    return `${pad(fromDay)}–${pad(toDay)}/${pad(toMonth)}`;
  }
  return `${pad(fromDay)}/${pad(fromMonth)}–${pad(toDay)}/${pad(toMonth)}`;
}

/** The totals of a day range that RN-10 needs (sums of RN-06, RN-08 and RN-09). */
export interface PeriodTotals {
  /** Σ gross of sales and refunds dated in the range (RN-06). */
  grossCents: number;
  /** Σ fees of sales and refunds dated in the range (RN-06). */
  feeCents: number;
  /** Σ general expenses paid in the range (RN-08). */
  generalExpensesCents: number;
  /** Σ fixed expenses with status paid and payment date in the range (RN-09). */
  fixedExpensesCents: number;
}

/** The FR-24 indicators, in display order. */
export const MONTH_COMPARISON_INDICATORS = ["gross", "fee", "totalExpenses", "balance"] as const;
export type MonthComparisonIndicatorKey = (typeof MONTH_COMPARISON_INDICATORS)[number];

/** pt-BR names of the FR-24 indicators, as the spec lists them. */
export const MONTH_COMPARISON_LABELS: Record<MonthComparisonIndicatorKey, string> = {
  gross: "Entrada mensal",
  fee: "Taxas",
  totalExpenses: "Total de despesas",
  balance: "Saldo",
};

const indicatorSchema = z.object({
  key: z.enum(MONTH_COMPARISON_INDICATORS),
  label: z.string(),
  /** This month, day 1 to today. */
  currentCents: z.number().int(),
  /** The previous month, day 1 to the same day. */
  previousCents: z.number().int(),
  /** RN-11 in tenths of a percent (+12,3 % → 123); null when the previous value is 0 ("—"). */
  variationTenths: z.number().int().nullable(),
  /** The whole previous month (reference), equal to its Resumo mensal (FR-23). */
  previousMonthTotalCents: z.number().int(),
});
export type MonthComparisonIndicator = z.infer<typeof indicatorSchema>;

/** Response of GET /api/dashboards/month-comparison (FR-24). */
export const monthComparisonSchema = z.object({
  today: civilDate,
  currentMonth: yearMonthSchema("Mês inválido."),
  previousMonth: yearMonthSchema("Mês inválido."),
  current: dayRangeSchema,
  previous: dayRangeSchema,
  /**
   * False when the whole previous month had no sales and no counted expenses (first month of
   * use): every variation is "—" with the note "sem dados do mês anterior".
   */
  previousMonthHasData: z.boolean(),
  indicators: z.array(indicatorSchema),
});
export type MonthComparison = z.infer<typeof monthComparisonSchema>;

/** The four FR-24 values of a period: income and fees, then RN-10's totals. */
function indicatorValues(totals: PeriodTotals): Record<MonthComparisonIndicatorKey, number> {
  const { totalExpensesCents, balanceCents } = rn10Totals(totals);
  return {
    gross: totals.grossCents,
    fee: totals.feeCents,
    totalExpenses: totalExpensesCents,
    balance: balanceCents,
  };
}

/**
 * FR-24: builds the dashboard from the totals of both periods and the previous month's
 * summary (FR-23). When the previous month has no data, every previous value is 0, so RN-11
 * already gives "—" for every indicator; `previousMonthHasData` only adds the note.
 */
export function buildMonthComparison(input: {
  today: CivilDate;
  current: PeriodTotals;
  previous: PeriodTotals;
  previousMonth: { summary: MonthSummary; hasData: boolean };
}): MonthComparison {
  const periods = comparisonPeriods(input.today);
  const current = indicatorValues(input.current);
  const previous = indicatorValues(input.previous);
  const reference = indicatorValues(input.previousMonth.summary);
  return {
    today: input.today,
    ...periods,
    previousMonthHasData: input.previousMonth.hasData,
    indicators: MONTH_COMPARISON_INDICATORS.map((key) => ({
      key,
      label: MONTH_COMPARISON_LABELS[key],
      currentCents: current[key],
      previousCents: previous[key],
      variationTenths: variationTenths(current[key], previous[key]),
      previousMonthTotalCents: reference[key],
    })),
  };
}
