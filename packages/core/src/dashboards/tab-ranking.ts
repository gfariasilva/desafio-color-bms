import { z } from "zod";
import type { SaleCategory } from "../catalog/categories";
import { isCivilDate, type CivilDate } from "../time/civil-date";
import { addMonths, lastDayOfMonth, yearMonthSchema, type YearMonth } from "../time/year-month";
import { comparisonPeriods, type DayRange } from "./month-comparison";
import { formatVariation, percentTenths, variationTenths } from "./variation";

/**
 * FR-25: Dashboard "Quais abas vendem mais?". The tabs ranked by gross income (RN-06) in the
 * chosen month, with each tab's share of the month and its RN-11 variation against the same
 * period of the previous month. "Mais lucrativas" means **highest income**, not margin (Q-11).
 */

const civilDate = z.string().refine(isCivilDate, { message: "Data inválida." });
const dayRangeSchema = z.object({ from: civilDate, to: civilDate });

/** Query of GET /api/dashboards/tab-ranking. */
export const tabRankingQuerySchema = z.object({ month: yearMonthSchema("Mês inválido.") });

/** pt-BR error for a month after today's (no sale can be in the future, RN-15). */
export const TAB_RANKING_FUTURE_MONTH_ERROR = "Escolha um mês até o atual.";

/**
 * RN-15: true when `yearMonth` comes after the month of `today` (no sale can be there).
 *
 * @example isMonthAfterToday("2026-12", "2026-11-18") // true
 */
export function isMonthAfterToday(yearMonth: YearMonth, today: CivilDate): boolean {
  // "YYYY-MM" compares correctly as text.
  return yearMonth > today.slice(0, 7);
}

/**
 * FR-25: the two periods of the ranking of `yearMonth` on `today`.
 * - The current month runs from day 1 to today, against the same days of the previous month
 *   (A-13, the same periods as FR-24).
 * - A past month is compared whole with the whole previous month (on September, 01–31/08:
 *   "the same days" would leave out 31/08).
 *
 * @throws RangeError for an invalid input or a month after today's.
 */
export function rankingPeriods(
  yearMonth: YearMonth,
  today: CivilDate,
): {
  yearMonth: YearMonth;
  previousMonth: YearMonth;
  /** True for the current month: values up to today. */
  partial: boolean;
  current: DayRange;
  previous: DayRange;
} {
  const previousMonth = addMonths(yearMonth, -1); // validates yearMonth
  if (!isCivilDate(today)) {
    throw new RangeError(`rankingPeriods expects a civil date, received "${today}"`);
  }
  const currentMonth = today.slice(0, 7);
  if (isMonthAfterToday(yearMonth, today)) {
    throw new RangeError(`rankingPeriods: ${yearMonth} is after today's month (${today})`);
  }
  if (yearMonth === currentMonth) {
    const periods = comparisonPeriods(today);
    return {
      yearMonth,
      previousMonth,
      partial: true,
      current: periods.current,
      previous: periods.previous,
    };
  }
  const wholeMonth = (month: YearMonth): DayRange => ({
    from: `${month}-01`,
    to: `${month}-${String(lastDayOfMonth(month)).padStart(2, "0")}`,
  });
  return {
    yearMonth,
    previousMonth,
    partial: false,
    current: wholeMonth(yearMonth),
    previous: wholeMonth(previousMonth),
  };
}

/**
 * FR-25: a tab's share of the month's gross income, in tenths of a percent (25,0 % → 250),
 * rounded half away from zero. `null` ("—") when the total is zero or negative (a month of
 * refunds only): a share of nothing means nothing. A tab below zero has a negative share.
 *
 * @example shareTenths(2500, 10000) // 250 (25,0 %)
 */
export function shareTenths(partCents: number, totalCents: number): number | null {
  if (!Number.isSafeInteger(partCents) || !Number.isSafeInteger(totalCents)) {
    throw new RangeError(
      `shareTenths expects integer cents, received ${partCents} and ${totalCents}`,
    );
  }
  if (totalCents <= 0) return null;
  return percentTenths(partCents, totalCents);
}

/**
 * FR-25: formats a share in tenths of a percent for the pt-BR UI, without a "+" sign.
 *
 * @example formatShare(560) // "56,0%"
 * @example formatShare(-50) // "−5,0%"
 * @example formatShare(null) // "—"
 */
export function formatShare(tenths: number | null): string {
  return formatVariation(tenths).replace(/^\+/, "");
}

/** One input row: the Σ gross of one tab's sales and refunds in a period (RN-06). */
export interface TabTotalRow {
  saleCategoryId: number;
  grossCents: number;
}

const rankedTabSchema = z.object({
  /** 1 = the tab that sold most. */
  position: z.number().int().positive(),
  saleCategoryId: z.number().int(),
  name: z.string(),
  /** Display order, for the tab's color (design system). */
  order: z.number().int(),
  active: z.boolean(),
  /** Σ gross (sales + refunds) in the current period. */
  grossCents: z.number().int(),
  /** Share of the month in tenths of a percent; null when the month's total is ≤ 0. */
  shareTenths: z.number().int().nullable(),
  /** Σ gross in the previous period. */
  previousCents: z.number().int(),
  /** RN-11 in tenths of a percent; null when the previous value is 0 ("—"). */
  variationTenths: z.number().int().nullable(),
});
export type RankedTab = z.infer<typeof rankedTabSchema>;

/** Response of GET /api/dashboards/tab-ranking (FR-25). */
export const tabRankingSchema = z.object({
  yearMonth: yearMonthSchema("Mês inválido."),
  previousMonth: yearMonthSchema("Mês inválido."),
  partial: z.boolean(),
  current: dayRangeSchema,
  previous: dayRangeSchema,
  /** Entrada bruta of the period: Σ of the tabs (equals FR-20's Entrada mensal for a past month). */
  totalCents: z.number().int(),
  previousTotalCents: z.number().int(),
  totalVariationTenths: z.number().int().nullable(),
  tabs: z.array(rankedTabSchema),
});
export type TabRanking = z.infer<typeof tabRankingSchema>;

/**
 * FR-25: builds the ranking.
 * - Tabs: every active tab (also at R$ 0,00, so the owner sees what did not sell), plus the
 *   inactive tabs with sales or refunds in either period.
 * - Order: gross descending; ties keep the display order.
 * - Refunds are negative rows (RN-04), so a tab can end below zero.
 */
export function buildTabRanking(input: {
  yearMonth: YearMonth;
  today: CivilDate;
  tabs: readonly SaleCategory[];
  current: readonly TabTotalRow[];
  previous: readonly TabTotalRow[];
}): TabRanking {
  const periods = rankingPeriods(input.yearMonth, input.today);
  const sumByTab = (rows: readonly TabTotalRow[]) => {
    const sums = new Map<number, number>();
    for (const row of rows) {
      sums.set(row.saleCategoryId, (sums.get(row.saleCategoryId) ?? 0) + row.grossCents);
    }
    return sums;
  };
  const current = sumByTab(input.current);
  const previous = sumByTab(input.previous);

  const listed = input.tabs.filter(
    (tab) => tab.active || current.has(tab.id) || previous.has(tab.id),
  );
  const totalCents = listed.reduce((sum, tab) => sum + (current.get(tab.id) ?? 0), 0);
  const previousTotalCents = listed.reduce((sum, tab) => sum + (previous.get(tab.id) ?? 0), 0);

  const tabs = listed
    .map((tab) => ({ tab, grossCents: current.get(tab.id) ?? 0 }))
    .sort((a, b) => b.grossCents - a.grossCents || a.tab.order - b.tab.order || a.tab.id - b.tab.id)
    .map(({ tab, grossCents }, index): RankedTab => {
      const previousCents = previous.get(tab.id) ?? 0;
      return {
        position: index + 1,
        saleCategoryId: tab.id,
        name: tab.name,
        order: tab.order,
        active: tab.active,
        grossCents,
        shareTenths: shareTenths(grossCents, totalCents),
        previousCents,
        variationTenths: variationTenths(grossCents, previousCents),
      };
    });

  return {
    ...periods,
    totalCents,
    previousTotalCents,
    totalVariationTenths: variationTenths(totalCents, previousTotalCents),
    tabs,
  };
}
