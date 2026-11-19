import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCents, formatYearMonthLong, type MonthSummaryResponse } from "@color-bms/core";
import { CashLine } from "@/components/cash-closing/CashLine";
import { PageHeader } from "@/components/layout/PageHeader";
import { ReportMonthField, ReportMonthStatus } from "@/components/reports/ReportMonthField";
import { useReportMonth } from "@/components/reports/use-report-month";
import { Card, CardContent } from "@/components/ui/card";
import { api, QUERY_KEYS } from "@/lib/api";
import { cn } from "@/lib/utils";

const LINK_CLASS = "text-primary underline-offset-4 hover:underline";

/**
 * Relatórios › Mês – Resumo mensal (FR-23): the month's figures as a calculation card, like
 * the owner's sheet. Every line is the total of a month report (FR-20 to FR-22) and the
 * saldo follows RN-10. Sangrias are not expenses and never enter it.
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
        title="Relatório do mês – Resumo mensal"
        description="Entrada mensal, taxas, despesas gerais e fixas, e o Saldo mensal."
      />
      <p className="-mt-3 mb-4">
        <Link to="/relatorios" className={LINK_CLASS}>
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
      {data ? <MonthSummaryCard summary={data} /> : null}
    </>
  );
}

function MonthSummaryCard({ summary }: { summary: MonthSummaryResponse }) {
  const query = `?mes=${summary.yearMonth}`;
  const negative = summary.balanceCents < 0;
  return (
    <section aria-labelledby="month-summary-title" className="max-w-xl space-y-3">
      <h2 id="month-summary-title" className="text-base font-semibold">
        Resumo de {formatYearMonthLong(summary.yearMonth)}
      </h2>
      <Card>
        <CardContent className="p-4">
          <CashLine label="Entrada mensal (bruta)" testId="summary-income">
            {formatCents(summary.incomeCents)}
          </CashLine>
          <CashLine label="(−) Taxas de maquininha" testId="summary-fees">
            {formatCents(summary.feesCents)}
          </CashLine>
          <CashLine label="(−) Total despesas gerais" testId="summary-general">
            {formatCents(summary.generalExpensesCents)}
          </CashLine>
          <CashLine label="(−) Total despesas fixas" testId="summary-fixed">
            {formatCents(summary.fixedExpensesCents)}
          </CashLine>
          <CashLine label="Total geral de despesas" testId="summary-total-expenses">
            {formatCents(summary.totalExpensesCents)}
          </CashLine>
          <CashLine sign="=" label="Saldo mensal" testId="summary-balance" strong>
            <span className={cn("text-lg", negative && "text-destructive")}>
              {formatCents(summary.balanceCents)}
            </span>
          </CashLine>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Saldo = Entrada mensal − Taxas − Total geral de despesas. As sangrias não entram: são
        movimentação interna do caixa, não despesa.
      </p>
      <nav aria-label="Detalhes do resumo" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link to={`/relatorios/mes/entradas${query}`} className={LINK_CLASS}>
          Ver Mês – Entradas
        </Link>
        <Link to={`/relatorios/mes/despesas-gerais${query}`} className={LINK_CLASS}>
          Ver Mês – Despesas gerais
        </Link>
        <Link to={`/relatorios/mes/despesas-fixas${query}`} className={LINK_CLASS}>
          Ver Mês – Despesas fixas
        </Link>
      </nav>
    </section>
  );
}
