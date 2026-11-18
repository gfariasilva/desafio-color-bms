import { Pencil, Trash2 } from "lucide-react";
import {
  EXPENSE_PAYMENT_MEANS_LABELS,
  formatCents,
  formatInstantTime,
  type DayExpensesResponse,
  type Expense,
} from "@color-bms/core";
import { Button } from "@/components/ui/button";
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
import { describeExpense } from "./describe-expense";
import { cn } from "@/lib/utils";

interface DayExpensesTableProps {
  day: DayExpensesResponse;
  editingId: number | null;
  busy: boolean;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}

/**
 * FR-06: the day's general expenses ("saídas do dia"), in the order they were registered,
 * with the day total and the part paid in cash from the till (RN-07, the closing uses it).
 */
export function DayExpensesTable({
  day,
  editingId,
  busy,
  onEdit,
  onDelete,
}: DayExpensesTableProps) {
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Hora</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Meio</TableHead>
            <TableHead>Do caixa</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="w-20">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {day.expenses.map((expense) => (
            <TableRow key={expense.id} className={cn(editingId === expense.id && "bg-muted")}>
              <TableCell className="text-muted-foreground">
                {formatInstantTime(expense.createdAt)}
              </TableCell>
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
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar despesa ${describeExpense(expense)}`}
                    title="Editar"
                    disabled={busy}
                    onClick={() => onEdit(expense)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Excluir despesa ${describeExpense(expense)}`}
                    title="Excluir"
                    disabled={busy}
                    onClick={() => onDelete(expense)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <tfoot className="border-t bg-muted/30">
          <TableRow>
            <TableCell colSpan={5} className="text-muted-foreground">
              Pago do caixa (dinheiro)
            </TableCell>
            <TableCell className="whitespace-nowrap text-right">
              {formatCents(day.paidFromTillCents)}
            </TableCell>
            <TableCell />
          </TableRow>
          <TableRow className="font-medium">
            <TableCell colSpan={5}>Total do dia</TableCell>
            <TableCell className="whitespace-nowrap text-right">
              {formatCents(day.totalCents)}
            </TableCell>
            <TableCell />
          </TableRow>
        </tfoot>
      </Table>
    </Card>
  );
}
