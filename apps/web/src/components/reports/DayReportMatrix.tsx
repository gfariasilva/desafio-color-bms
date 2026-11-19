import { Fragment } from "react";
import { formatCents, type DayMatrix, type SaleTotals } from "@color-bms/core";
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
import { cn } from "@/lib/utils";

/** The three values of every cell (RN-05), one sub-row each. */
const MEASURES = [
  { key: "grossCents", label: "Bruto", testId: "gross" },
  { key: "feeCents", label: "Taxa", testId: "fee" },
  { key: "netCents", label: "Líquido", testId: "net" },
] as const satisfies readonly { key: keyof SaleTotals; label: string; testId: string }[];

/**
 * FR-19 / RN-05: the day's tab × payment method matrix. One row group per tab (Bruto, Taxa,
 * Líquido), one column per payment method plus the tab total; the footer has the totals per
 * method and of the day. A tab without sales is a single dimmed row, so the list stays short
 * while keeping every tab in the owner's order (line-by-line check against the Excel).
 */
export function DayReportMatrix({ matrix }: { matrix: DayMatrix }) {
  return (
    <Card className="overflow-x-auto">
      <Table aria-label="Matriz aba × forma de pagamento">
        <TableHeader>
          <TableRow>
            <TableHead>Aba</TableHead>
            <TableHead className="w-20">Valor</TableHead>
            {matrix.methods.map((method) => (
              <TableHead key={method.paymentMethodId} className="text-right">
                {method.name}
              </TableHead>
            ))}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {matrix.tabs.map((tab) => {
            const name = (
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: categoryColor(tab.order - 1) }}
                />
                {tab.name}
              </span>
            );
            if (!tab.hasSales) {
              return (
                <TableRow key={tab.saleCategoryId} className="text-muted-foreground">
                  <TableHead scope="row" className="font-normal">
                    {name}
                  </TableHead>
                  <TableCell className="whitespace-nowrap">Sem vendas</TableCell>
                  {matrix.methods.map((method) => (
                    <TableCell key={method.paymentMethodId} className="text-right">
                      —
                    </TableCell>
                  ))}
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              );
            }
            return (
              <Fragment key={tab.saleCategoryId}>
                {MEASURES.map((measure, index) => (
                  <TableRow
                    key={measure.key}
                    className={cn(index < MEASURES.length - 1 && "border-b-0")}
                  >
                    {index === 0 ? (
                      <TableHead
                        scope="rowgroup"
                        rowSpan={MEASURES.length}
                        className="align-top font-medium text-foreground"
                      >
                        {name}
                      </TableHead>
                    ) : null}
                    <TableCell className="text-muted-foreground">{measure.label}</TableCell>
                    {tab.cells.map((cell, column) => (
                      <TableCell
                        key={matrix.methods[column]?.paymentMethodId ?? column}
                        className={cn(
                          "whitespace-nowrap text-right",
                          cell[measure.key] === 0 && "text-muted-foreground",
                        )}
                      >
                        {formatCents(cell[measure.key])}
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap text-right font-medium">
                      {formatCents(tab.total[measure.key])}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
        <tfoot className="border-t-2 bg-muted/30 font-medium">
          {MEASURES.map((measure, index) => (
            <TableRow key={measure.key} className={cn(index < MEASURES.length - 1 && "border-b-0")}>
              {index === 0 ? (
                <TableHead scope="rowgroup" rowSpan={MEASURES.length} className="align-top">
                  Total do dia
                </TableHead>
              ) : null}
              <TableCell className="text-muted-foreground">{measure.label}</TableCell>
              {matrix.methodTotals.map((total, column) => (
                <TableCell
                  key={matrix.methods[column]?.paymentMethodId ?? column}
                  className="whitespace-nowrap text-right"
                >
                  {formatCents(total[measure.key])}
                </TableCell>
              ))}
              <TableCell
                className="whitespace-nowrap text-right font-semibold"
                data-testid={`day-total-${measure.testId}`}
              >
                {formatCents(matrix.total[measure.key])}
              </TableCell>
            </TableRow>
          ))}
        </tfoot>
      </Table>
    </Card>
  );
}
