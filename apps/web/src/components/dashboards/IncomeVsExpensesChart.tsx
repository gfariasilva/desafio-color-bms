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
import { formatCents, formatCivilDate, type IncomeVsExpenses } from "@color-bms/core";
import { categoryColor } from "@/lib/category-colors";
import { AXIS_TICK, barRadius, formatMoneyTick, TOOLTIP_STYLE } from "./chart-style";

/** "2026-11-18" → "18/11". */
const dayMonth = (date: string) => formatCivilDate(date).slice(0, 5);

/**
 * FR-26: one pair of bars per day (zero days included, so the gaps show): gross income
 * (`--chart-1`) beside expenses (`--chart-2`). The totals and the day table above and below
 * hold the accessible numbers, so the chart is one image with a name.
 */
export function IncomeVsExpensesChart({ chart }: { chart: IncomeVsExpenses }) {
  const data = chart.daily.map((day) => ({
    day: dayMonth(day.date),
    incomeCents: day.incomeCents,
    expensesCents: day.expensesCents,
  }));

  return (
    <div
      role="img"
      aria-label={`Gráfico de barras por dia: entradas brutas × despesas, ${dayMonth(chart.from)} a ${dayMonth(chart.to)}`}
      className="h-72 w-full"
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 640, height: 288 }}
      >
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          barGap={1}
          barCategoryGap={chart.days === 30 ? "15%" : "25%"}
        >
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={8}
            tick={AXIS_TICK}
          />
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
            dataKey="incomeCents"
            name="Entradas brutas"
            fill={categoryColor(0)}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.day} radius={barRadius(entry.incomeCents) as unknown as number} />
            ))}
          </Bar>
          <Bar
            dataKey="expensesCents"
            name="Despesas"
            fill={categoryColor(1)}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.day} radius={barRadius(entry.expensesCents) as unknown as number} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
