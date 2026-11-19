import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  EXPENSE_STATUS_LABELS,
  fixedExpenseInstallmentLabel,
  formatCents,
  formatCivilDate,
  formatYearMonth,
  formatYearMonthLong,
  type ExpenseStatus,
  type MonthFixedExpenseGroup,
  type MonthFixedExpenseRow,
  type MonthFixedExpensesReport,
} from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { ReportMonthField, ReportMonthStatus } from "@/components/reports/ReportMonthField";
import { useReportMonth } from "@/components/reports/use-report-month";
import { Badge, type BadgeProps } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

/** Design system: green for paid, muted for dismissed, neutral for pending (as Contas do mês). */
const STATUS_VARIANTS: Record<ExpenseStatus, BadgeProps["variant"]> = {
  pending: "secondary",
  paid: "success",
  dismissed: "outline",
};

/**
 * Relatórios › Mês – Despesas fixas (FR-22): the month's bills grouped in Gerais and Taxas
 * governo, with due date, expected and paid amounts, payment date and status; the total paid
 * in the month by payment date (RN-09) and the pending total (informative, not in the saldo).
 */
export function MonthFixedExpensesReportPage() {
  const month = useReportMonth();
  const report = useQuery({
    queryKey: [...QUERY_KEYS.monthFixedExpensesReport, month.yearMonth],
    queryFn: () => api.reports.monthFixedExpenses(month.yearMonth as string),
    enabled: month.yearMonth !== null,
  });
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Relatório do mês – Despesas fixas"
        description="Contas do mês por grupo, o total pago no mês (pela data de pagamento) e o que ainda está pendente."
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
        what="o relatório de despesas fixas"
      />
      {data ? (
        <div className="space-y-6">
          <FixedExpensesTotals report={data} />
          {data.groups.map((group) => (
            <FixedExpensesGroup key={group.group} report={data} group={group} />
          ))}
        </div>
      ) : null}
    </>
  );
}

/** RN-09: total pago no mês; FR-22: the pending total, outside the saldo. */
function FixedExpensesTotals({ report }: { report: MonthFixedExpensesReport }) {
  const missing = report.pendingWithoutExpectedCount;
  return (
    <section aria-label={`Totais de ${formatYearMonthLong(report.yearMonth)}`}>
      <div className="grid max-w-3xl gap-2 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground">Total pago no mês</p>
            <p className="text-xl font-semibold tabular-nums" data-testid="fixed-paid-total">
              {formatCents(report.paidTotalCents)}
            </p>
            <p className="text-sm text-muted-foreground">Pela data de pagamento. Entra no saldo.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground">Pendente (informativo)</p>
            <p className="text-xl font-semibold tabular-nums" data-testid="fixed-pending-total">
              {formatCents(report.pendingTotalCents)}
            </p>
            <p className="text-sm text-muted-foreground">
              Valor previsto das contas pendentes. Fora do saldo.
              {missing > 0
                ? ` ${missing} ${missing === 1 ? "conta" : "contas"} sem valor previsto.`
                : ""}
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

/** FR-22: one group (Gerais or Taxas governo) with its bills and its total paid. */
function FixedExpensesGroup({
  report,
  group,
}: {
  report: MonthFixedExpensesReport;
  group: MonthFixedExpenseGroup;
}) {
  const headingId = `fixed-report-group-${group.group}`;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="text-base font-semibold">
        {group.label}
      </h2>
      <Card className="max-w-5xl overflow-x-auto">
        <Table aria-labelledby={headingId}>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              {/* Fixed widths, so the columns of both groups line up. */}
              <TableHead className="w-36">Vencimento</TableHead>
              <TableHead className="w-32 text-right">Previsto</TableHead>
              <TableHead className="w-32 text-right">Pago</TableHead>
              <TableHead className="w-40">Data de pagamento</TableHead>
              <TableHead className="w-32">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Nenhuma conta neste mês.
                </TableCell>
              </TableRow>
            ) : (
              group.expenses.map((row) => (
                <FixedExpenseRow key={row.id} row={row} yearMonth={report.yearMonth} />
              ))
            )}
          </TableBody>
          <tfoot className="border-t-2 bg-muted/30 font-semibold">
            <TableRow>
              <TableHead scope="row" colSpan={3} className="text-foreground">
                Total pago no mês – {group.label}
              </TableHead>
              <TableCell
                className="whitespace-nowrap text-right tabular-nums"
                data-testid={`fixed-group-total-${group.group}`}
              >
                {formatCents(group.paidTotalCents)}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </tfoot>
        </Table>
      </Card>
    </section>
  );
}

function FixedExpenseRow({ row, yearMonth }: { row: MonthFixedExpenseRow; yearMonth: string }) {
  const installment = fixedExpenseInstallmentLabel(row);
  // A bill of this month paid in a later month: listed, but counted in that month (RN-09).
  const paidLater = row.status === "paid" && !row.countsInMonth && row.paymentDate !== null;
  return (
    <TableRow className={cn(row.status === "dismissed" && "text-muted-foreground")}>
      <TableCell>
        <span className="flex flex-wrap items-center gap-2">
          {row.label}
          {installment ? <span className="text-muted-foreground">{installment}</span> : null}
          {row.oneOff ? <Badge variant="outline">Avulsa</Badge> : null}
          {row.otherReferenceMonth ? (
            <Badge variant="outline">Conta de {formatYearMonth(row.referenceMonth)}</Badge>
          ) : null}
          {paidLater ? (
            <Badge
              variant="outline"
              title={`Paga fora de ${formatYearMonth(yearMonth)}: não entra no total deste mês.`}
            >
              Entra no total de {formatYearMonth(row.paymentDate!.slice(0, 7))}
            </Badge>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {row.dueDate === null ? "Sem vencimento" : formatCivilDate(row.dueDate)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {row.expectedAmountCents === null ? "—" : formatCents(row.expectedAmountCents)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {row.amountCents === null ? "—" : formatCents(row.amountCents)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {row.paymentDate === null ? "—" : formatCivilDate(row.paymentDate)}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANTS[row.status]}>{EXPENSE_STATUS_LABELS[row.status]}</Badge>
      </TableCell>
    </TableRow>
  );
}
