import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  EXPENSE_STATUS_LABELS,
  FIXED_EXPENSE_GROUP_LABELS,
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

/** Same colors as "Contas do mês": green for paid, muted for dismissed, neutral for pending. */
const STATUS_VARIANTS: Record<ExpenseStatus, BadgeProps["variant"]> = {
  pending: "secondary",
  paid: "success",
  dismissed: "outline",
};

/**
 * Relatórios › Mês – Despesas fixas (FR-22): each bill of the month, grouped in Gerais and
 * Taxas governo, with due date, expected amount, amount paid, payment date and status; the
 * total paid in the month by payment date (RN-09) and the total still pending (informative).
 * Bills of other months paid in this one are listed too, marked "ref. MM/AAAA".
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
        description="Cada conta com vencimento, valor previsto, valor pago, data de pagamento e situação. O total pago conta pela data de pagamento."
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
        <div className="grid gap-6">
          <MonthFixedExpensesTotals report={data} />
          {data.groups.map((group) => (
            <FixedExpenseGroupTable key={group.group} group={group} yearMonth={data.yearMonth} />
          ))}
        </div>
      ) : null}
    </>
  );
}

/** RN-09: total paid in the month; FR-22: total still pending (out of the balance). */
function MonthFixedExpensesTotals({ report }: { report: MonthFixedExpensesReport }) {
  const withoutExpected = report.pendingWithoutExpectedCount;
  return (
    <section aria-label={`Totais de ${formatYearMonthLong(report.yearMonth)}`}>
      <div className="grid max-w-3xl gap-2 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground">Total pago no mês</p>
            <p className="text-xl font-semibold tabular-nums" data-testid="fixed-paid-total">
              {formatCents(report.paidTotalCents)}
            </p>
            <p className="text-muted-foreground">Pela data de pagamento. Entra no saldo.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground">Ainda pendente (previsto)</p>
            <p className="text-xl font-semibold tabular-nums" data-testid="fixed-pending-total">
              {formatCents(report.pendingTotalCents)}
            </p>
            <p className="text-muted-foreground">
              Informativo, fora do saldo.
              {withoutExpected > 0
                ? ` ${withoutExpected} ${withoutExpected === 1 ? "conta" : "contas"} sem valor previsto.`
                : ""}
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function FixedExpenseGroupTable({
  group,
  yearMonth,
}: {
  group: MonthFixedExpenseGroup;
  yearMonth: string;
}) {
  const label = FIXED_EXPENSE_GROUP_LABELS[group.group];
  const headingId = `fixed-report-group-${group.group}`;
  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <h2 id={headingId} className="text-base font-semibold">
        {label}
      </h2>
      <Card className="max-w-5xl overflow-x-auto">
        <Table aria-labelledby={headingId} className="min-w-[60rem] table-fixed">
          <TableHeader>
            <TableRow>
              {/* Fixed layout and widths, so the columns of both groups line up. */}
              <TableHead>Conta</TableHead>
              <TableHead className="w-40">Vencimento</TableHead>
              <TableHead className="w-36 text-right">Valor previsto</TableHead>
              <TableHead className="w-36 text-right">Valor pago</TableHead>
              <TableHead className="w-56">Data de pagamento</TableHead>
              <TableHead className="w-28">Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Nenhuma conta neste grupo.
                </TableCell>
              </TableRow>
            ) : (
              group.rows.map((row) => (
                <FixedExpenseRow key={row.id} row={row} yearMonth={yearMonth} />
              ))
            )}
          </TableBody>
          <tfoot className="border-t-2 bg-muted/30">
            <TableRow className="font-semibold">
              <TableHead scope="row" colSpan={3} className="text-foreground">
                Pago no mês – {label}
              </TableHead>
              <TableCell
                className="whitespace-nowrap text-right tabular-nums"
                data-testid={`fixed-paid-${group.group}`}
              >
                {formatCents(group.paidCents)}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
            <TableRow className="text-muted-foreground">
              <TableHead scope="row" colSpan={2} className="font-normal">
                Pendente (informativo)
              </TableHead>
              <TableCell
                className="whitespace-nowrap text-right tabular-nums"
                data-testid={`fixed-pending-${group.group}`}
              >
                {formatCents(group.pendingCents)}
              </TableCell>
              <TableCell colSpan={3} />
            </TableRow>
          </tfoot>
        </Table>
      </Card>
    </section>
  );
}

/**
 * One bill. A bill of another reference month shows "ref. MM/AAAA"; a bill of this month paid
 * in another one shows "conta em MM/AAAA" next to its payment date (RN-09, cash basis).
 */
function FixedExpenseRow({ row, yearMonth }: { row: MonthFixedExpenseRow; yearMonth: string }) {
  const installment = fixedExpenseInstallmentLabel(row);
  const paid = row.status === "paid" && row.paymentDate !== null;
  return (
    <TableRow className={cn(row.status === "dismissed" && "text-muted-foreground")}>
      <TableHead scope="row" className="font-normal text-foreground">
        <span className="flex flex-wrap items-center gap-2">
          {row.label}
          {installment && <span className="text-muted-foreground">{installment}</span>}
          {row.oneOff && <Badge variant="outline">Avulsa</Badge>}
          {row.referenceMonth !== "" && row.referenceMonth !== yearMonth && (
            <Badge variant="outline">ref. {formatYearMonth(row.referenceMonth)}</Badge>
          )}
        </span>
      </TableHead>
      <TableCell className="whitespace-nowrap">
        {row.dueDate ? (
          formatCivilDate(row.dueDate)
        ) : (
          <Badge variant="outline">Sem vencimento</Badge>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {row.expectedAmountCents === null ? "—" : formatCents(row.expectedAmountCents)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {paid ? formatCents(row.amountCents ?? 0) : "—"}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {paid ? formatCivilDate(row.paymentDate!) : "—"}
        {paid && !row.countsInMonth && (
          <span className="text-muted-foreground">
            {" "}
            · conta em {formatYearMonth(row.paymentDate!.slice(0, 7))}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANTS[row.status]}>{EXPENSE_STATUS_LABELS[row.status]}</Badge>
      </TableCell>
    </TableRow>
  );
}
