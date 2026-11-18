import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import {
  formatCents,
  formatInstantTime,
  formatRatePercent,
  type DaySalesResponse,
  type DaySalesTab,
  type Sale,
  type SaleTotals,
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
import { cn } from "@/lib/utils";
import { describeSale } from "./describe-sale";

interface DaySalesViewProps {
  day: DaySalesResponse;
  /** The sale loaded in the form, highlighted in its table. */
  editingId: number | null;
  busy: boolean;
  onEdit: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
}

/**
 * FR-05: the day per tab ("aba"). Each tab is a collapsible section: its header shows the
 * number of sales and the tab total; inside, the sales, one subtotal per payment method and
 * the tab total (RN-05). Tabs with sales start open, empty ones start collapsed at R$ 0,00.
 * The day total closes the view. Totals come from the server, computed from the rows.
 */
export function DaySalesView({ day, editingId, busy, onEdit, onDelete }: DaySalesViewProps) {
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
          editingId={editingId}
          busy={busy}
          onEdit={onEdit}
          onDelete={onDelete}
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

function TabSection({ tab, open, onToggle, editingId, busy, onEdit, onDelete }: TabSectionProps) {
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
                    <TableHead className="w-20">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tab.sales.map((sale) => (
                    <TableRow key={sale.id} className={cn(editingId === sale.id && "bg-muted")}>
                      <TableCell>{formatInstantTime(sale.createdAt)}</TableCell>
                      <TableCell>{sale.paymentMethodName}</TableCell>
                      <TableCell>{sale.cardMachineName ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {sale.installments === null ? "—" : `${sale.installments}x`}
                      </TableCell>
                      <TableCell className="text-right">{formatCents(sale.grossCents)}</TableCell>
                      <TableCell className="text-right">
                        {sale.feeRatePpm === 0 ? "—" : formatRatePercent(sale.feeRatePpm)}
                      </TableCell>
                      <TableCell className="text-right">{formatCents(sale.feeCents)}</TableCell>
                      <TableCell className="text-right">{formatCents(sale.netCents)}</TableCell>
                      <TableCell className="text-muted-foreground">{sale.note ?? ""}</TableCell>
                      <TableCell>
                        {/* Refunds (#6) are not edited or deleted here. */}
                        {sale.type === "sale" ? (
                          <div className="flex justify-end gap-1">
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
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              aria-label={`Excluir venda ${describeSale(sale)}`}
                              title="Excluir"
                              disabled={busy}
                              onClick={() => onDelete(sale)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot className="border-t bg-muted/30">
                  {tab.methods.map((method) => (
                    <TableRow key={method.paymentMethodId}>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        Subtotal {method.paymentMethodName}
                      </TableCell>
                      <TableCell className="text-right">{formatCents(method.grossCents)}</TableCell>
                      <TableCell />
                      <TableCell className="text-right">{formatCents(method.feeCents)}</TableCell>
                      <TableCell className="text-right">{formatCents(method.netCents)}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell colSpan={4}>Total da aba</TableCell>
                    <TableCell className="text-right">
                      {formatCents(tab.total.grossCents)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right">{formatCents(tab.total.feeCents)}</TableCell>
                    <TableCell className="text-right">{formatCents(tab.total.netCents)}</TableCell>
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
