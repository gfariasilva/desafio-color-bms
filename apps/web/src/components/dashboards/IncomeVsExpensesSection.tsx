import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  formatCents,
  formatCivilDate,
  INCOME_EXPENSE_WINDOWS,
  type IncomeExpenseWindow,
  type IncomeVsExpenses,
} from "@color-bms/core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, QUERY_KEYS } from "@/lib/api";
import { cn } from "@/lib/utils";
import { IncomeVsExpensesChart } from "./IncomeVsExpensesChart";
import { MoneyCell } from "./MoneyCell";

/**
 * FR-26: Dashboard "Estou ganhando mais do que gasto?". Daily gross income × expenses
 * (general + paid fixed, by payment date) over the last 7 or 30 days, with the period totals
 * and the difference. The totals are the sum of the bars (the server builds both from the
 * same days). The window is a filter, so it is a `NativeSelect` (design system).
 */
export function IncomeVsExpensesSection() {
  const [days, setDays] = useState<IncomeExpenseWindow>(7);
  const chart = useQuery({
    queryKey: [...QUERY_KEYS.incomeVsExpenses, days],
    queryFn: () => api.dashboards.incomeVsExpenses(days),
  });

  return (
    <section aria-labelledby="income-expenses-title" className="max-w-4xl space-y-3">
      <h2 id="income-expenses-title" className="text-base font-semibold">
        Estou ganhando mais do que gasto?
      </h2>
      <div className="w-44 space-y-1.5">
        <Label htmlFor="income-expenses-days">Período</Label>
        <NativeSelect
          id="income-expenses-days"
          value={days}
          onChange={(event) => setDays(Number(event.target.value) as IncomeExpenseWindow)}
        >
          {INCOME_EXPENSE_WINDOWS.map((window) => (
            <option key={window} value={window}>
              Últimos {window} dias
            </option>
          ))}
        </NativeSelect>
      </div>
      {chart.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {chart.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as entradas e despesas. Recarregue a página.
        </p>
      ) : null}
      {chart.data ? <IncomeVsExpensesView chart={chart.data} /> : null}
    </section>
  );
}

function IncomeVsExpensesView({ chart }: { chart: IncomeVsExpenses }) {
  const { totals } = chart;
  const negative = totals.differenceCents < 0;
  const figures = [
    { label: "Entradas brutas", cents: totals.incomeCents, testId: "period-income" },
    { label: "(−) Despesas", cents: totals.expensesCents, testId: "period-expenses" },
  ];

  return (
    <>
      <div
        role="group"
        aria-label={`Totais de ${formatCivilDate(chart.from)} a ${formatCivilDate(chart.to)}`}
        className="grid max-w-3xl gap-2 sm:grid-cols-3"
      >
        {figures.map((figure) => (
          <Card key={figure.testId}>
            <CardContent className="p-4">
              <p className="text-muted-foreground">{figure.label}</p>
              <p className="text-xl font-semibold tabular-nums" data-testid={figure.testId}>
                {formatCents(figure.cents)}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              Diferença
              {negative ? <Badge variant="destructive">Gastou mais do que entrou</Badge> : null}
            </div>
            <p
              className={cn("text-xl font-semibold tabular-nums", negative && "text-destructive")}
              data-testid="period-difference"
            >
              {formatCents(totals.differenceCents)}
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground">
        Despesas = gerais + fixas pagas, pela data de pagamento. As sangrias e as taxas de
        maquininha não entram aqui (o Saldo, acima, desconta as taxas).
      </p>

      <Card>
        <CardContent className="p-4">
          <IncomeVsExpensesChart chart={chart} />
        </CardContent>
      </Card>

      <details className="group">
        <summary className="w-fit cursor-pointer rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          Ver os valores por dia
        </summary>
        <Card className="mt-2 max-w-2xl">
          <Table aria-label="Entradas × despesas por dia">
            <TableHeader>
              <TableRow>
                <TableHead>Dia</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Despesas</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chart.daily.map((day) => {
                const empty = day.incomeCents === 0 && day.expensesCents === 0;
                return (
                  <TableRow key={day.date} className={cn(empty && "text-muted-foreground")}>
                    <TableHead scope="row" className="font-normal">
                      {formatCivilDate(day.date)}
                    </TableHead>
                    <MoneyCell cents={day.incomeCents} />
                    <MoneyCell cents={day.expensesCents} />
                    <MoneyCell cents={day.differenceCents} negative={day.differenceCents < 0} />
                  </TableRow>
                );
              })}
            </TableBody>
            <tfoot className="border-t-2 bg-muted/30 font-medium">
              <TableRow>
                <TableHead scope="row">Total</TableHead>
                <MoneyCell cents={totals.incomeCents} />
                <MoneyCell cents={totals.expensesCents} />
                <MoneyCell cents={totals.differenceCents} negative={negative} />
              </TableRow>
            </tfoot>
          </Table>
        </Card>
      </details>
    </>
  );
}
