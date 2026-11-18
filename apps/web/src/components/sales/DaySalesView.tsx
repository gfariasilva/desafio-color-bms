import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2, Undo2 } from "lucide-react";
import {
  formatCents,
  formatCivilDate,
  formatInstantTime,
  formatRatePercent,
  type DaySalesResponse,
  type DaySalesTab,
  type Sale,
  type SaleTotals,
} from "@color-bms/core";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { describeSale } from "./describe-sale";

interface DaySalesViewProps {
  day: DaySalesResponse;
  /** The sale loaded in the form, highlighted in its table. */
  editingId: number | null;
  /** Today's civil date: only sales from earlier days can be refunded (FR-04). */
  today: string | null;
  busy: boolean;
  onEdit: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
  onRefund: (sale: Sale) => void;
}

/**
 * FR-05: the day per tab ("aba"). Each tab is a collapsible section: its header shows the
 * number of sales and the tab total; inside, the sales, one subtotal per payment method and
 * the tab total (RN-05). Tabs with sales start open, empty ones start collapsed at R$ 0,00.
 * The day total closes the view. Totals come from the server, computed from the rows.
 *
 * FR-04: a sale from an earlier day with something left to refund has "Estornar"; a refunded
 * sale can no longer be edited or deleted. Refund rows show an "Estorno" badge, the original
 * sale's date and the reason, and can only be deleted (RN-14 decides on the server).
 */
export function DaySalesView({ day, ...rowProps }: DaySalesViewProps) {
  // Only the tabs the owner toggled are stored; the others follow "has sales".
  const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(new Map());

  function isOpen(tab: DaySalesTab) {
    return toggled.get(tab.saleCategoryId) ?? tab.sales.length > 0;
  }

  function toggle(tab: DaySalesTab) {
    setToggled((current) => new Map(current).set(tab.saleCategoryId, !isOpen(tab)));
  }

  return (
    <div className="space-y-2">
      {day.tabs.map((tab) => (
        <TabSection
          key={tab.saleCategoryId}
          tab={tab}
          open={isOpen(tab)}
          onToggle={() => toggle(tab)}
          {...rowProps}
        />
      ))}
      <Card
        data-testid="day-total"
        className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-3 py-2 text-sm font-semibold"
      >
        <span>Total do dia</span>
        <TotalsLine totals={day.total} />
      </Card>
    </div>
  );
}

/** "Bruto … · Taxa … · Líquido …", right-aligned numbers. */
function TotalsLine({ totals }: { totals: SaleTotals }) {
  return (
    <span className="flex gap-4 tabular-nums">
      <span>Bruto {formatCents(totals.grossCents)}</span>
      <span className="text-muted-foreground">Taxa {formatCents(totals.feeCents)}</span>
      <span>Líquido {formatCents(totals.netCents)}</span>
    </span>
  );
}

interface TabSectionProps extends Omit<DaySalesViewProps, "day"> {
  tab: DaySalesTab;
  open: boolean;
  onToggle: () => void;
}

function TabSection({ tab, open, onToggle, ...rowProps }: TabSectionProps) {
  const headerId = `day-tab-${tab.saleCategoryId}`;
  const count = tab.sales.length;
  return (
    <section aria-labelledby={headerId}>
      <Card className={cn(!tab.active && "opacity-80")}>
        <button
          type="button"
          id={headerId}
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            {open ? (
              <ChevronDown aria-hidden className="h-4 w-4" />
            ) : (
              <ChevronRight aria-hidden className="h-4 w-4" />
            )}
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor(tab.order - 1) }}
            />
            {tab.name}
            <span className="font-normal text-muted-foreground">
              {count === 0 ? "sem vendas" : count === 1 ? "1 lançamento" : `${count} lançamentos`}
              {tab.active ? "" : " · inativa"}
            </span>
          </span>
          <TotalsLine totals={tab.total} />
        </button>

        {open ? (
          count === 0 ? (
            <p className="border-t px-3 py-2 text-sm text-muted-foreground">
              Nenhuma venda nesta aba.
            </p>
          ) : (
            <div className="border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Maquininha</TableHead>
                    <TableHead className="text-right">Parc.</TableHead>
                    <TableHead className="text-right">Bruto</TableHead>
                    <TableHead className="text-right">Taxa (%)</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="w-28">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tab.sales.map((sale) => (
                    <SaleRow key={sale.id} sale={sale} {...rowProps} />
                  ))}
                </TableBody>
                <tfoot className="border-t bg-muted/30">
                  {tab.methods.map((method) => (
                    <TableRow key={method.paymentMethodId}>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        Subtotal {method.paymentMethodName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {formatCents(method.grossCents)}
                      </TableCell>
                      <TableCell />
                      <TableCell className="whitespace-nowrap text-right">
                        {formatCents(method.feeCents)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {formatCents(method.netCents)}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell colSpan={4}>Total da aba</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {formatCents(tab.total.grossCents)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="whitespace-nowrap text-right">
                      {formatCents(tab.total.feeCents)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {formatCents(tab.total.netCents)}
                    </TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </tfoot>
              </Table>
            </div>
          )
        ) : null}
      </Card>
    </section>
  );
}

type SaleRowProps = Omit<DaySalesViewProps, "day"> & { sale: Sale };

/** One sale or refund of the tab, with its actions (FR-03, FR-04). */
function SaleRow({ sale, editingId, today, busy, onEdit, onDelete, onRefund }: SaleRowProps) {
  const isRefund = sale.type === "refund";
  const refundable =
    !isRefund && today !== null && sale.date < today && sale.refundedCents < sale.grossCents;
  // RN-04: a sale with refunds keeps its values; it is no longer edited or deleted.
  const changeable = !isRefund && sale.refundedCents === 0;
  return (
    <TableRow className={cn(editingId === sale.id && "bg-muted")}>
      <TableCell>{formatInstantTime(sale.createdAt)}</TableCell>
      <TableCell>{sale.paymentMethodName}</TableCell>
      <TableCell>{sale.cardMachineName ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-right">
        {sale.installments === null ? "—" : `${sale.installments}x`}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right">{formatCents(sale.grossCents)}</TableCell>
      <TableCell className="whitespace-nowrap text-right">
        {sale.feeRatePpm === 0 ? "—" : formatRatePercent(sale.feeRatePpm)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right">{formatCents(sale.feeCents)}</TableCell>
      <TableCell className="whitespace-nowrap text-right">{formatCents(sale.netCents)}</TableCell>
      <TableCell className="text-muted-foreground">
        {isRefund ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Badge variant="destructive">Estorno</Badge>
            {sale.originalSaleDate ? (
              <span>da venda de {formatCivilDate(sale.originalSaleDate)}</span>
            ) : null}
            {sale.reason ? <span>· {sale.reason}</span> : null}
          </span>
        ) : (
          <>
            {sale.note ?? ""}
            {sale.refundedCents > 0 ? (
              <span className="ml-1 text-destructive">
                {sale.note ? "· " : ""}Estornado {formatCents(sale.refundedCents)}
              </span>
            ) : null}
          </>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {refundable ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Estornar venda ${describeSale(sale)}`}
              title="Estornar"
              disabled={busy}
              onClick={() => onRefund(sale)}
            >
              <Undo2 />
            </Button>
          ) : null}
          {changeable ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Editar venda ${describeSale(sale)}`}
              title="Editar"
              disabled={busy}
              onClick={() => onEdit(sale)}
            >
              <Pencil />
            </Button>
          ) : null}
          {changeable || isRefund ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              aria-label={`Excluir ${isRefund ? "estorno" : "venda"} ${describeSale(sale)}`}
              title="Excluir"
              disabled={busy}
              onClick={() => onDelete(sale)}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
