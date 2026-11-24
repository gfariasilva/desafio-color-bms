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
import { AXIS_TICK, barRadius, formatMoneyTick, TOOLTIP_STYLE } from "./chart-style";

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
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <YAxis
            allowDecimals={false}
            tickFormatter={formatMoneyTick}
            tickLine={false}
            axisLine={false}
            width={88}
            tick={AXIS_TICK}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))" }}
            formatter={(value) => formatCents(Number(value))}
            contentStyle={TOOLTIP_STYLE}
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
