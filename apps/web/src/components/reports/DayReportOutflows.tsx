import {
  EXPENSE_PAYMENT_MEANS_LABELS,
  formatCents,
  formatInstantTime,
  type DayReportResponse,
} from "@color-bms/core";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryColor } from "@/lib/category-colors";

/**
 * FR-19: the day's expenses ("saídas"): the general expenses (FR-06) and the fixed expenses
 * paid on that date (FR-12), with the part paid from the till (RN-07) and the total, in the
 * columns of the daily spreadsheet (spec §7.3).
 */
export function DayReportExpenses({ report }: { report: DayReportResponse }) {
  const empty = report.expenses.length === 0 && report.fixedExpenses.length === 0;
  return (
    <Card className="overflow-x-auto">
      <Table aria-label="Saídas do dia">
        <TableHeader>
          <TableRow>
            <TableHead>Categoria</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Meio</TableHead>
            <TableHead>Do caixa</TableHead>
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {empty ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                Nenhuma saída neste dia.
              </TableCell>
            </TableRow>
          ) : null}
          {report.expenses.map((expense) => (
            <TableRow key={expense.id}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColor(expense.expenseCategoryOrder - 1) }}
                  />
                  {expense.expenseCategoryName}
                </span>
              </TableCell>
              <TableCell>{expense.description ?? ""}</TableCell>
              <TableCell>{EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans]}</TableCell>
              <TableCell>{expense.paidFromTill ? "Sim" : "Não"}</TableCell>
              <TableCell className="whitespace-nowrap text-right">
                {formatCents(expense.amountCents)}
              </TableCell>
            </TableRow>
          ))}
          {report.fixedExpenses.map((expense) => (
            <TableRow key={expense.id}>
              <TableCell>
                <Badge variant="outline">Despesa fixa</Badge>
              </TableCell>
              <TableCell>{expense.label}</TableCell>
              <TableCell>
                {expense.paymentMeans ? EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans] : ""}
              </TableCell>
              <TableCell>{expense.paidFromTill ? "Sim" : "Não"}</TableCell>
              <TableCell className="whitespace-nowrap text-right">
                {formatCents(expense.amountCents ?? 0)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <tfoot className="border-t bg-muted/30">
          <TableRow>
            <TableCell colSpan={4} className="text-muted-foreground">
              Pago do caixa (dinheiro)
            </TableCell>
            <TableCell className="whitespace-nowrap text-right" data-testid="expenses-from-till">
              {formatCents(report.paidFromTillCents)}
            </TableCell>
          </TableRow>
          <TableRow className="font-medium">
            <TableCell colSpan={4}>Total de saídas</TableCell>
            <TableCell className="whitespace-nowrap text-right" data-testid="expenses-total">
              {formatCents(report.expensesTotalCents)}
            </TableCell>
          </TableRow>
        </tfoot>
      </Table>
    </Card>
  );
}

/** FR-19: the day's sangrias (FR-07) and their total (RN-07). */
export function DayReportWithdrawals({ report }: { report: DayReportResponse }) {
  return (
    <Card className="overflow-x-auto">
      <Table aria-label="Sangrias do dia">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Hora</TableHead>
            <TableHead>Observação</TableHead>
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.withdrawals.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                Nenhuma sangria neste dia.
              </TableCell>
            </TableRow>
          ) : null}
          {report.withdrawals.map((withdrawal) => (
            <TableRow key={withdrawal.id}>
              <TableCell className="text-muted-foreground">
                {formatInstantTime(withdrawal.createdAt)}
              </TableCell>
              <TableCell>{withdrawal.note ?? ""}</TableCell>
              <TableCell className="whitespace-nowrap text-right">
                {formatCents(withdrawal.amountCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <tfoot className="border-t bg-muted/30">
          <TableRow className="font-medium">
            <TableCell colSpan={2}>Total de sangrias</TableCell>
            <TableCell className="whitespace-nowrap text-right" data-testid="withdrawals-total">
              {formatCents(report.withdrawalsTotalCents)}
            </TableCell>
          </TableRow>
        </tfoot>
      </Table>
    </Card>
  );
}
