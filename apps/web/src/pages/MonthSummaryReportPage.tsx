import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCents, formatYearMonthLong, type MonthSummary } from "@color-bms/core";
import { CashLine } from "@/components/cash-closing/CashLine";
import { PageHeader } from "@/components/layout/PageHeader";
import { ReportMonthField, ReportMonthStatus } from "@/components/reports/ReportMonthField";
import { useReportMonth } from "@/components/reports/use-report-month";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { api, QUERY_KEYS } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Relatórios › Resumo mensal (FR-23): the month's income, fees and expenses down to the
 * balance (RN-10), one line each, like the owner's paper sheet. Each line links to the report
 * it comes from (FR-20 to FR-22), for the same month.
 */
export function MonthSummaryReportPage() {
  const month = useReportMonth();
  const report = useQuery({
    queryKey: [...QUERY_KEYS.monthSummaryReport, month.yearMonth],
    queryFn: () => api.reports.monthSummary(month.yearMonth as string),
    enabled: month.yearMonth !== null,
  });
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Resumo mensal"
        description="Entrada mensal, taxas e despesas do mês até o saldo mensal."
      />
      <p className="-mt-3 mb-4">
        <Link to="/relatorios" className="text-primary underline-offset-4 hover:underline">
          ← Relatórios
        </Link>
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <ReportMonthField {...month} />
      </div>
      <ReportMonthStatus
        {...month}
        isLoading={report.isLoading}
        isError={report.isError}
        what="o resumo mensal"
      />
      {data ? (
        <MonthSummaryCard summary={data} inProgress={data.yearMonth === month.currentMonth} />
      ) : null}
    </>
  );
}

function MonthSummaryCard({ summary, inProgress }: { summary: MonthSummary; inProgress: boolean }) {
  const link = (path: string, label: string) => (
    <Link
      to={`/relatorios/mes/${path}?mes=${summary.yearMonth}`}
      className="underline-offset-4 hover:text-primary hover:underline"
    >
      {label}
    </Link>
  );
  const negative = summary.balanceCents < 0;
  return (
    <section
      aria-label={`Resumo de ${formatYearMonthLong(summary.yearMonth)}`}
      className="max-w-xl"
    >
      <Card>
        <CardContent className="p-4">
          <CashLine label={link("entradas", "Entrada mensal (bruta)")} testId="summary-gross">
            {formatCents(summary.grossCents)}
          </CashLine>
          <CashLine label={link("entradas", "(−) Taxas de maquininha")} testId="summary-fee">
            {formatCents(summary.feeCents)}
          </CashLine>
          <CashLine
            label={link("despesas-gerais", "(−) Total despesas gerais")}
            testId="summary-general"
          >
            {formatCents(summary.generalExpensesCents)}
          </CashLine>
          <CashLine
            label={link("despesas-fixas", "(−) Total despesas fixas")}
            testId="summary-fixed"
          >
            {formatCents(summary.fixedExpensesCents)}
          </CashLine>
          <CashLine label="Total geral de despesas" testId="summary-total-expenses">
            <span className="font-medium">{formatCents(summary.totalExpensesCents)}</span>
          </CashLine>
          <div
            className={cn(
              "flex min-h-11 items-center justify-between gap-4 border-t-2 pt-2 text-base font-semibold",
              negative && "text-destructive",
            )}
          >
            <span className="flex items-center gap-2">
              {/* Lines up with CashLine's (empty) sign column above. */}
              <span className="w-3" aria-hidden />
              Saldo mensal
              {negative ? <Badge variant="destructive">Saldo negativo</Badge> : null}
            </span>
            <span className="whitespace-nowrap tabular-nums" data-testid="summary-balance">
              {formatCents(summary.balanceCents)}
            </span>
          </div>
        </CardContent>
      </Card>
      <p className="mt-2 text-muted-foreground">
        {inProgress ? "Mês em andamento: valores até hoje. " : ""}
        As sangrias não entram no saldo (movimentação interna), nem as despesas fixas pendentes.
      </p>
    </section>
  );
}
