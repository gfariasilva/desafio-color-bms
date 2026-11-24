import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCents, formatDayRange, type MonthComparison } from "@color-bms/core";
import { categoryColor } from "@/lib/category-colors";

/** Axis ticks are whole reais ("R$ 1.000"); the tooltip shows the exact value in cents. */
const formatTick = (cents: number) => formatCents(Math.round(cents)).replace(/,00$/, "");

/**
 * Rounded corners at the bar's far end: below zero (a negative Saldo) that is the bottom.
 * Recharts merges a `<Cell>`'s props into its bar, whose `radius` takes the 4 corners, but
 * Cell's type only declares the SVG `radius` (a number), hence the cast where it is used.
 */
const barRadius = (cents: number): [number, number, number, number] =>
  cents < 0 ? [0, 0, 3, 3] : [3, 3, 0, 0];

/**
 * FR-24: grouped bars per indicator, the previous period beside this month. Only a picture of
 * the table above it (which is the accessible source of the numbers), so it is one image with
 * a name for screen readers. Series colors are chart tokens (`--chart-1..2`, design system).
 */
export function MonthComparisonChart({ comparison }: { comparison: MonthComparison }) {
  const currentLabel = `Este mês (${formatDayRange(comparison.current)})`;
  const previousLabel = `Mês anterior (${formatDayRange(comparison.previous)})`;
  const data = comparison.indicators.map((indicator) => ({
    label: indicator.label,
    previous: indicator.previousCents,
    current: indicator.currentCents,
  }));

  return (
    <div
      role="img"
      aria-label={`Gráfico de barras: ${currentLabel.toLowerCase()} × ${previousLabel.toLowerCase()}`}
      className="h-72 w-full"
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 640, height: 288 }}
      >
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            tickFormatter={formatTick}
            tickLine={false}
            axisLine={false}
            width={88}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))" }}
            formatter={(value) => formatCents(Number(value))}
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
              color: "hsl(var(--popover-foreground))",
              fontSize: 13,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Bar
            dataKey="previous"
            name={previousLabel}
            fill={categoryColor(1)}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.label} radius={barRadius(entry.previous) as unknown as number} />
            ))}
          </Bar>
          <Bar
            dataKey="current"
            name={currentLabel}
            fill={categoryColor(0)}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.label} radius={barRadius(entry.current) as unknown as number} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
