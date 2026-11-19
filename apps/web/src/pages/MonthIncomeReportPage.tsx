import { useQuery } from "@tanstack/react-query";
import {
  formatCents,
  formatCivilDate,
  formatYearMonthLong,
  type MonthIncomeResponse,
} from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { ReportMonthField, ReportMonthStatus } from "@/components/reports/ReportMonthField";
import { useReportMonth } from "@/components/reports/use-report-month";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, QUERY_KEYS } from "@/lib/api";
import { categoryColor } from "@/lib/category-colors";
import { cn } from "@/lib/utils";

/**
 * Relatórios › Mês – Entradas (FR-20): the monthly income (RN-06), a days × tabs grid with
 * the gross of each tab on each day and the month total of each tab, and the month totals
 * per payment method. Column sums = tab totals; Σ tabs = Entrada mensal.
 */
export function MonthIncomeReportPage() {
  const month = useReportMonth();
  const report = useQuery({
    queryKey: [...QUERY_KEYS.monthIncomeReport, month.yearMonth],
    queryFn: () => api.reports.monthIncome(month.yearMonth as string),
    enabled: month.yearMonth !== null,
  });
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Relatório do mês – Entradas"
        description="Entradas por dia e aba, totais por forma de pagamento, taxas e líquido."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <ReportMonthField {...month} />
      </div>
      <ReportMonthStatus
        {...month}
        isLoading={report.isLoading}
        isError={report.isError}
        what="o relatório de entradas"
      />

      {data ? (
        <div className="space-y-6">
          <MonthIncomeSummary report={data} />

          <section aria-labelledby="income-grid-title" className="space-y-2">
            <h2 id="income-grid-title" className="text-base font-semibold">
              Entradas por dia e aba (bruto)
            </h2>
            <MonthIncomeGrid report={data} />
          </section>

          <section aria-labelledby="income-methods-title" className="space-y-2">
            <h2 id="income-methods-title" className="text-base font-semibold">
              Totais por forma de pagamento
            </h2>
            <MonthIncomeMethods report={data} />
          </section>
        </div>
      ) : null}
    </>
  );
}

/** RN-06: Entrada mensal, Taxas do mês and Líquido do mês. */
function MonthIncomeSummary({ report }: { report: MonthIncomeResponse }) {
  const figures = [
    { label: "Entrada mensal (bruta)", value: report.total.grossCents, testId: "month-gross" },
    { label: "(−) Taxas de maquininha", value: report.total.feeCents, testId: "month-fee" },
    { label: "Líquido do mês", value: report.total.netCents, testId: "month-net" },
  ];
  return (
    <section aria-label={`Totais de ${formatYearMonthLong(report.yearMonth)}`}>
      <div className="grid max-w-3xl gap-2 sm:grid-cols-3">
        {figures.map((figure) => (
          <Card key={figure.testId}>
            <CardContent className="p-4">
              <p className="text-muted-foreground">{figure.label}</p>
              <p className="text-xl font-semibold tabular-nums" data-testid={figure.testId}>
                {formatCents(figure.value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/**
 * FR-20: one row per day, one column per tab (owner's order) plus the day total; the footer
 * has each tab's month total and the Entrada mensal. Days without sales are dimmed, and zero
 * cells show "—", so the days with movement stand out.
 */
function MonthIncomeGrid({ report }: { report: MonthIncomeResponse }) {
  return (
    <Card className="overflow-x-auto">
      {/* 9 tabs + day + total: tighter cells so the grid fits a 1440 px screen. */}
      <Table aria-label="Entradas por dia e aba" className="text-[13px] [&_td]:px-2 [&_th]:px-2">
        <TableHeader>
          <TableRow>
            <TableHead>Dia</TableHead>
            {report.tabs.map((tab) => (
              <TableHead key={tab.saleCategoryId} className="text-right">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColor(tab.order - 1) }}
                  />
                  {tab.name}
                </span>
              </TableHead>
            ))}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.days.length === 0 ? (
            <TableRow>
              <TableCell colSpan={report.tabs.length + 2} className="text-muted-foreground">
                Nenhum dia deste mês chegou ainda.
              </TableCell>
            </TableRow>
          ) : null}
          {report.days.map((day) => (
            <TableRow key={day.date} className={cn(!day.hasSales && "text-muted-foreground")}>
              <TableHead scope="row" className="whitespace-nowrap font-normal">
                {formatCivilDate(day.date)}
              </TableHead>
              {day.cells.map((cents, column) => (
                <TableCell
                  key={report.tabs[column]?.saleCategoryId ?? column}
                  className={cn(
                    "whitespace-nowrap text-right tabular-nums",
                    cents === 0 && "text-muted-foreground",
                  )}
                >
                  {cents === 0 ? "—" : formatCents(cents)}
                </TableCell>
              ))}
              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                {day.hasSales ? formatCents(day.totalCents) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <tfoot className="border-t-2 bg-muted/30 font-medium">
          <TableRow>
            <TableHead scope="row">Total do mês</TableHead>
            {report.tabs.map((tab) => (
              <TableCell
                key={tab.saleCategoryId}
                className="whitespace-nowrap text-right tabular-nums"
                data-testid={`tab-total-${tab.saleCategoryId}`}
              >
                {formatCents(tab.totalCents)}
              </TableCell>
            ))}
            <TableCell
              className="whitespace-nowrap text-right font-semibold tabular-nums"
              data-testid="grid-total"
            >
              {formatCents(report.total.grossCents)}
            </TableCell>
          </TableRow>
        </tfoot>
      </Table>
    </Card>
  );
}

/** FR-20: the month totals per payment method (gross, fee, net) and their sum. */
function MonthIncomeMethods({ report }: { report: MonthIncomeResponse }) {
  return (
    <Card className="max-w-3xl overflow-x-auto">
      <Table aria-label="Totais por forma de pagamento">
        <TableHeader>
          <TableRow>
            <TableHead>Forma de pagamento</TableHead>
            <TableHead className="text-right">Bruto</TableHead>
            <TableHead className="text-right">Taxa</TableHead>
            <TableHead className="text-right">Líquido</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.methods.map((method) => (
            <TableRow key={method.paymentMethodId}>
              <TableHead scope="row" className="font-normal text-foreground">
                {method.name}
                {method.active ? null : <span className="text-muted-foreground"> (inativa)</span>}
              </TableHead>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {formatCents(method.grossCents)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {formatCents(method.feeCents)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {formatCents(method.netCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <tfoot className="border-t-2 bg-muted/30 font-medium">
          <TableRow>
            <TableHead scope="row">Total</TableHead>
            <TableCell className="whitespace-nowrap text-right tabular-nums">
              {formatCents(report.total.grossCents)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">
              {formatCents(report.total.feeCents)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">
              {formatCents(report.total.netCents)}
            </TableCell>
          </TableRow>
        </tfoot>
      </Table>
    </Card>
  );
}
