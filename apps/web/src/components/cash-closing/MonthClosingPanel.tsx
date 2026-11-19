import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Lock } from "lucide-react";
import {
  formatCents,
  formatCivilDate,
  formatInstant,
  formatYearMonth,
  MONTH_REOPEN_REASON_MAX,
  reopenMonthInputSchema,
  type MonthClosingResponse,
  type ReopenMonthInput,
} from "@color-bms/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReopenPanel } from "./ReopenPanel";

interface MonthClosingPanelProps {
  month: MonthClosingResponse;
  /** Today's civil date (server clock): before the month's last day only the block is shown. */
  today: string;
  /** Closes the month; rejects with an Error whose message is pt-BR (shown in the alert). */
  onClose: () => Promise<unknown>;
  /** Reopens the month with a reason (FR-17). */
  onReopen: (input: ReopenMonthInput) => Promise<unknown>;
}

/**
 * FR-16 / FR-17: the "Fechamento do mês" of one month.
 * - Open: the days with movement still open (RN-14), each a link to its closing; the pending
 *   fixed expenses of the month (a warning, FR-16); "Fechar mês" opens a "Tem certeza?" card
 *   in place: focus on the confirm button, Enter closes, Esc cancels.
 * - Closed: when it was closed, and "Reabrir mês" (confirmation + reason, FR-17).
 */
export function MonthClosingPanel({ month, today, onClose, onReopen }: MonthClosingPanelProps) {
  const label = formatYearMonth(month.yearMonth);

  if (month.status === "closed") {
    return (
      <div>
        <p className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">
            <Lock aria-hidden className="mr-1 h-3 w-3" />
            Mês fechado
          </Badge>
          {month.closedAt ? (
            <span className="text-muted-foreground">
              Fechado em {formatInstant(month.closedAt)}.
            </span>
          ) : null}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhum dia, venda ou despesa de {label} pode ser alterado.
        </p>
        <ReopenPanel
          actionLabel="Reabrir mês"
          formLabel="Reabrir o mês"
          warning={`O mês ${label} volta a aberto. Os dias continuam fechados até serem reabertos um a um.`}
          reasonId="reopen-month-reason"
          reasonMax={MONTH_REOPEN_REASON_MAX}
          placeholder="ex.: lançamento esquecido"
          schema={reopenMonthInputSchema}
          failureMessage="Não foi possível reabrir o mês."
          onReopen={onReopen}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {month.pendingDays.length > 0 && today >= month.lastDate ? (
        // RN-14: the server's message lists the same days; here each one is a link.
        <div className="text-sm">
          <p>Feche os dias com movimento ainda abertos antes de fechar o mês:</p>
          <ul className="mt-1 flex flex-wrap gap-3" aria-label="Dias pendentes">
            {month.pendingDays.map((date) => (
              <li key={date}>
                <Link
                  to={`/fechamento?data=${date}`}
                  className="rounded underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {formatCivilDate(date)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : month.closeBlocked ? (
        <p className="text-sm text-muted-foreground">{month.closeBlocked}</p>
      ) : null}

      {month.pendingFixedExpenses.length > 0 ? (
        <div role="note" className="flex max-w-xl gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p>
              {month.pendingFixedExpenses.length === 1
                ? `1 despesa fixa de ${label} ainda está pendente.`
                : `${month.pendingFixedExpenses.length} despesas fixas de ${label} ainda estão pendentes.`}{" "}
              O mês pode ser fechado: elas continuam pendentes e entram no mês em que forem pagas.
            </p>
            <ul className="mt-1 text-muted-foreground">
              {month.pendingFixedExpenses.map((bill) => (
                <li key={bill.id}>
                  {bill.label}
                  {bill.dueDate ? ` — vence ${formatCivilDate(bill.dueDate)}` : ""}
                  {bill.expectedAmountCents !== null
                    ? ` — ${formatCents(bill.expectedAmountCents)}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {month.closeBlocked ? null : (
        <CloseMonthConfirm key={month.yearMonth} label={label} onClose={onClose} />
      )}
    </div>
  );
}

/** FR-16 "fecha o mês e confirma": the button and its in-place "Tem certeza?" card. */
function CloseMonthConfirm({ label, onClose }: { label: string; onClose: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<"confirm" | "button" | null>(null);

  useEffect(() => {
    if (focusTarget.current === "confirm") confirmButton.current?.focus();
    if (focusTarget.current === "button") closeButton.current?.focus();
    focusTarget.current = null;
  }, [open]);

  function start() {
    focusTarget.current = "confirm";
    setOpen(true);
  }

  function cancel() {
    focusTarget.current = "button";
    setOpen(false);
    setError(null);
  }

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // On success the page shows the month closed instead of this card.
      await onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível fechar o mês.");
      setPending(false);
    }
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      cancel();
    }
  }

  if (!open) {
    return (
      <Button ref={closeButton} type="button" onClick={start}>
        <Lock aria-hidden />
        Fechar mês
      </Button>
    );
  }

  return (
    <Card className="max-w-xl border-primary/40">
      <CardContent className="p-4">
        <div
          role="group"
          aria-label="Fechar o mês"
          onKeyDown={cancelOnEscape}
          className="space-y-3"
        >
          <p className="text-sm">
            <span className="font-medium">Tem certeza?</span> O mês {label} será fechado: nenhum
            dia, venda ou despesa dele poderá ser alterado até ele ser reaberto. Esc cancela.
          </p>
          <div className="flex gap-2">
            <Button ref={confirmButton} type="button" disabled={pending} onClick={confirm}>
              Confirmar fechamento
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>
              Cancelar
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
