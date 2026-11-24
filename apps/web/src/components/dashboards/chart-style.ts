import { formatCents } from "@color-bms/core";

/**
 * Shared Recharts styling of the dashboards (design system: muted axis text, grid in
 * `--border`, tooltip in `--popover`).
 */

/** Axis ticks are whole reais ("R$ 1.000"); the tooltip shows the exact value in cents. */
export const formatMoneyTick = (cents: number) =>
  formatCents(Math.round(cents)).replace(/,00$/, "");

export const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 12 } as const;

export const TOOLTIP_STYLE = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  color: "hsl(var(--popover-foreground))",
  fontSize: 13,
} as const;

/**
 * Rounded corners at the bar's far end: below zero that is the bottom (vertical bars).
 * Recharts merges a `<Cell>`'s props into its bar, whose `radius` takes the 4 corners, but
 * Cell's type only declares the SVG `radius` (a number), hence the cast where it is used.
 */
export const barRadius = (cents: number): [number, number, number, number] =>
  cents < 0 ? [0, 0, 3, 3] : [3, 3, 0, 0];
