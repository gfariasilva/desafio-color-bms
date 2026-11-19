import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  EXPENSE_CATEGORY_GROUP_LABELS,
  EXPENSE_PAYMENT_MEANS_LABELS,
  formatCents,
  formatCivilDate,
  type MonthExpenseCategory,
  type MonthGeneralExpensesResponse,
} from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { ReportMonthField, ReportMonthStatus } from "@/components/reports/ReportMonthField";
import { useReportMonth } from "@/components/reports/use-report-month";
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
import { api, QUERY_KEYS } from "@/lib/api";
import { categoryColor } from "@/lib/category-colors";
import { cn } from "@/lib/utils";

const SUPPLIERS_LABEL = EXPENSE_CATEGORY_GROUP_LABELS.suppliers;

/**
 * Relatórios › Mês – Despesas gerais (FR-21): the total of each category in the month, by
 * payment date (RN-08), the "Fornecedores de materiais" group with its subtotal, and the
 * total geral. Each category with entries can be expanded to list them (drill-down): Tab to
 * its button, Enter or Space opens and closes it.
 */
export function MonthGeneralExpensesReportPage() {
  const month = useReportMonth();
  const report = useQuery({
    queryKey: [...QUERY_KEYS.monthGeneralExpensesReport, month.yearMonth],
    queryFn: () => api.reports.monthGeneralExpenses(month.yearMonth as string),
    enabled: month.yearMonth !== null,
  });
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Relatório do mês – Despesas gerais"
        description="Total de cada categoria pela data de pagamento, com o grupo Fornecedores de materiais e o total geral."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <ReportMonthField {...month} />
      </div>
      <ReportMonthStatus
        {...month}
        isLoading={report.isLoading}
        isError={report.isError}
        what="o relatório de despesas gerais"
      />
      {/* Remount per month, so the expanded categories of one month never carry over. */}
      {data ? <MonthGeneralExpensesTable key={data.yearMonth} report={data} /> : null}
    </>
  );
}

function MonthGeneralExpensesTable({ report }: { report: MonthGeneralExpensesResponse }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = (category: MonthExpenseCategory, indented: boolean) => (
    <CategoryRows
      key={category.expenseCategoryId}
      category={category}
      indented={indented}
      expanded={open.has(category.expenseCategoryId)}
      onToggle={() => toggle(category.expenseCategoryId)}
    />
  );

  return (
    <Card className="max-w-3xl overflow-x-auto">
      <Table aria-label="Despesas gerais por categoria">
        <TableHeader>
          <TableRow>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Lançamentos</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.general.categories.map((category) => rows(category, false))}
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead scope="row" colSpan={3} className="font-semibold text-foreground">
              {SUPPLIERS_LABEL}
            </TableHead>
          </TableRow>
          {report.suppliers.categories.map((category) => rows(category, true))}
          <TableRow className="font-medium">
            <TableHead scope="row" colSpan={2} className="pl-6 text-foreground">
              Subtotal {SUPPLIERS_LABEL}
            </TableHead>
            <TableCell
              className="whitespace-nowrap text-right tabular-nums"
              data-testid="suppliers-subtotal"
            >
              {formatCents(report.suppliers.subtotalCents)}
            </TableCell>
          </TableRow>
        </TableBody>
        <tfoot className="border-t-2 bg-muted/30 font-semibold">
          <TableRow>
            <TableHead scope="row" colSpan={2} className="text-foreground">
              Total geral
            </TableHead>
            <TableCell
              className="whitespace-nowrap text-right tabular-nums"
              data-testid="general-expenses-total"
            >
              {formatCents(report.totalCents)}
            </TableCell>
          </TableRow>
        </tfoot>
      </Table>
    </Card>
  );
}

/** One category row and, when expanded, the row with its entries (FR-21 drill-down). */
function CategoryRows({
  category,
  indented,
  expanded,
  onToggle,
}: {
  category: MonthExpenseCategory;
  indented: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const count = category.expenses.length;
  const entriesId = `category-entries-${category.expenseCategoryId}`;
  const name = (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor(category.order - 1) }}
      />
      {category.name}
      {category.active ? null : <span className="text-muted-foreground">(inativa)</span>}
    </span>
  );
  return (
    <Fragment>
      <TableRow className={cn(count === 0 && "text-muted-foreground")}>
        <TableHead scope="row" className={cn("font-normal text-foreground", indented && "pl-6")}>
          {count === 0 ? (
            <span className="flex h-7 items-center pl-5 text-muted-foreground">{name}</span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 gap-1 px-2 text-[length:inherit] font-normal"
              aria-expanded={expanded}
              aria-controls={expanded ? entriesId : undefined}
              aria-label={`${expanded ? "Ocultar" : "Ver"} lançamentos de ${category.name}`}
              onClick={onToggle}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden />
              )}
              {name}
            </Button>
          )}
        </TableHead>
        {/* Middle-aligned like the name, whose button is taller than a text line. */}
        <TableCell className="text-right align-middle tabular-nums">{count}</TableCell>
        <TableCell className="whitespace-nowrap text-right align-middle tabular-nums">
          {formatCents(category.totalCents)}
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow id={entriesId} className="hover:bg-transparent">
          <TableCell colSpan={3} className={cn("bg-muted/20 py-2", indented ? "pl-12" : "pl-8")}>
            <Table aria-label={`Lançamentos de ${category.name}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Meio</TableHead>
                  <TableHead>Do caixa</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {category.expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatCivilDate(expense.paymentDate)}
                    </TableCell>
                    <TableCell>{expense.description ?? ""}</TableCell>
                    <TableCell>{EXPENSE_PAYMENT_MEANS_LABELS[expense.paymentMeans]}</TableCell>
                    <TableCell>{expense.paidFromTill ? "Sim" : "Não"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatCents(expense.amountCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}
