import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCents, formatYearMonthLong, type TabRanking } from "@color-bms/core";
import { categoryColor } from "@/lib/category-colors";
import { AXIS_TICK, formatMoneyTick, TOOLTIP_STYLE } from "./chart-style";

/** Height of one horizontal bar's row, in px. */
const ROW_HEIGHT = 32;

/** Rounded corners at the bar's far end: left for a tab below zero (refunds only). */
const horizontalRadius = (cents: number): [number, number, number, number] =>
  cents < 0 ? [3, 0, 0, 3] : [0, 3, 3, 0];

/**
 * FR-25: one horizontal bar per tab with sales (or refunds), in ranking order and in the tab's
 * own color (`categoryColor(order − 1)`, the same color everywhere). A picture of the table,
 * which holds the accessible numbers, so it is one image with a name.
 */
export function TabRankingChart({ ranking }: { ranking: TabRanking }) {
  const data = ranking.tabs
    .filter((tab) => tab.grossCents !== 0)
    .map((tab) => ({ name: tab.name, order: tab.order, grossCents: tab.grossCents }));
  const height = data.length * ROW_HEIGHT + 32;

  return (
    <div
      role="img"
      aria-label={`Gráfico de barras: entrada bruta por aba, ${formatYearMonthLong(ranking.yearMonth)}`}
      className="w-full"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height }}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
          <XAxis
            type="number"
            allowDecimals={false}
            tickFormatter={formatMoneyTick}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
          />
          <ReferenceLine x={0} stroke="hsl(var(--border))" />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))" }}
            formatter={(value) => formatCents(Number(value))}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="grossCents" name="Entrada bruta" barSize={18} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell
                key={entry.name}
                fill={categoryColor(entry.order - 1)}
                radius={horizontalRadius(entry.grossCents) as unknown as number}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
