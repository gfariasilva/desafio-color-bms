import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  cashDifferenceCents,
  cashDifferenceLabel,
  closeDayInputSchema,
  expectedCashCents,
  formatCents,
  formatCivilDate,
  formatMoneyInput,
  parseMoneyText,
  type CloseDayInput,
  type DayCashClosingResponse,
} from "@color-bms/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CashLine } from "./CashLine";
import { DifferenceBadge } from "./DifferenceBadge";

interface CashClosingFormProps {
  /** An open day with movement (FR-08). The page keys this form by date. */
  day: DayCashClosingResponse;
  /** Saves the closing; rejects with an Error whose message is pt-BR (shown in the alert). */
  onClose: (input: CloseDayInput) => Promise<unknown>;
}

/** Text typed in a money field → cents; undefined when blank, null when malformed. */
function readMoney(text: string): number | null | undefined {
  if (text.trim() === "") return undefined;
  return parseMoneyText(text);
}

/**
 * FR-08: the cash closing form. RN-07 is shown line by line and recomputed as the owner types:
 * Troco inicial (pre-filled from the last count, A-12; empty on the first day) + Vendas em
 * dinheiro − Despesas pagas do caixa − Sangrias = Dinheiro esperado; then Dinheiro contado and
 * the Diferença.
 *
 * Keyboard (NFR-05): focus starts on Troco inicial (text selected, so typing replaces it) →
 * Tab → Dinheiro contado → Enter. With no difference the day closes. With a difference the
 * form asks to confirm: the difference is highlighted, focus goes to Observação (optional) and
 * Enter closes anyway; Esc goes back to Dinheiro contado.
 */
export function CashClosingForm({ day, onClose }: CashClosingFormProps) {
  const [opening, setOpening] = useState(
    day.suggestedOpeningCashCents === null ? "" : formatMoneyInput(day.suggestedOpeningCashCents),
  );
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const openingField = useRef<HTMLInputElement>(null);
  const countedField = useRef<HTMLInputElement>(null);
  const noteField = useRef<HTMLInputElement>(null);

  useEffect(() => openingField.current?.focus(), []);

  // RN-07, live: "—" until the values can be read.
  const openingCents = readMoney(opening);
  const countedCents = readMoney(counted);
  const expected =
    typeof openingCents === "number"
      ? expectedCashCents({
          openingCashCents: openingCents,
          cashSalesCents: day.cashSalesCents,
          tillExpensesCents: day.tillExpensesCents,
          withdrawalsCents: day.withdrawalsCents,
        })
      : null;
  const difference =
    expected !== null && typeof countedCents === "number"
      ? cashDifferenceCents(countedCents, expected)
      : null;

  /** A change in the amounts needs a new confirmation of the difference. */
  function changeAmount(setter: (value: string) => void, value: string) {
    setter(value);
    setConfirming(false);
    setError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (openingCents === null || countedCents === null) {
      setError("Valor inválido. Digite, por exemplo, 150,00.");
      return;
    }
    // The same schema as the server, so its pt-BR messages show before any request.
    const parsed = closeDayInputSchema.safeParse({
      openingCashCents: openingCents,
      countedCashCents: countedCents,
      note,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      return;
    }
    setError(null);
    // FR-08: a difference is shown in highlight and confirmed before closing.
    if (difference !== 0 && !confirming) {
      setConfirming(true);
      noteField.current?.focus();
      return;
    }
    setPending(true);
    onClose(parsed.data).catch((failure: unknown) => {
      // The server may still refuse (e.g. the day was closed elsewhere): say why.
      setPending(false);
      setConfirming(false);
      setError(failure instanceof Error ? failure.message : "Erro inesperado. Tente de novo.");
    });
  }

  function backOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape" && confirming) {
      event.preventDefault();
      setConfirming(false);
      countedField.current?.focus();
    }
  }

  return (
    <Card className="max-w-xl">
      <CardContent className="p-4">
        <form onSubmit={submit} onKeyDown={backOnEscape} noValidate aria-label="Fechar o dia">
          <CashLine
            label={
              <div>
                <label htmlFor="closing-opening">Troco inicial (R$)</label>
                <p className="text-xs text-muted-foreground">
                  {day.suggestedFrom
                    ? `Contado no fechamento de ${formatCivilDate(day.suggestedFrom)}.`
                    : "Primeiro fechamento: digite o troco inicial."}
                </p>
              </div>
            }
          >
            <Input
              id="closing-opening"
              ref={openingField}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className="w-36 text-right tabular-nums"
              value={opening}
              onFocus={(event) => event.target.select()}
              onChange={(event) => changeAmount(setOpening, event.target.value)}
            />
          </CashLine>
          <CashLine sign="+" label="Vendas em dinheiro (líquidas de estornos)" testId="cash-sales">
            {formatCents(day.cashSalesCents)}
          </CashLine>
          <CashLine sign="−" label="Despesas pagas do caixa" testId="till-expenses">
            {formatCents(day.tillExpensesCents)}
          </CashLine>
          <CashLine sign="−" label="Sangrias" testId="withdrawals">
            {formatCents(day.withdrawalsCents)}
          </CashLine>
          <CashLine sign="=" label="Dinheiro esperado" testId="expected-cash" strong>
            {expected === null ? "—" : formatCents(expected)}
          </CashLine>
          <CashLine label={<label htmlFor="closing-counted">Dinheiro contado (R$)</label>} strong>
            <Input
              id="closing-counted"
              ref={countedField}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className="w-36 text-right tabular-nums"
              value={counted}
              onChange={(event) => changeAmount(setCounted, event.target.value)}
            />
          </CashLine>
          <CashLine label="Diferença" testId="difference">
            <DifferenceBadge differenceCents={difference} />
          </CashLine>

          <div className="mt-3 space-y-1.5">
            <label htmlFor="closing-note" className="text-sm font-medium">
              Observação
            </label>
            <Input
              id="closing-note"
              ref={noteField}
              autoComplete="off"
              placeholder="opcional, ex.: troco dado a mais"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {confirming && difference !== null ? (
            <div
              role="alert"
              className={cn(
                "mt-3 rounded-md border-2 p-3 text-sm",
                difference < 0 ? "border-destructive" : "border-rainbow-green",
              )}
            >
              <p className="text-base font-semibold">{cashDifferenceLabel(difference)}</p>
              <p className="text-muted-foreground">
                Confira a contagem. Se estiver certa, escreva uma observação (opcional) e feche
                mesmo assim com Enter. Esc volta ao dinheiro contado.
              </p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={pending}>
              {confirming ? "Fechar mesmo assim" : "Fechar o dia"}
            </Button>
            {confirming ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                  countedField.current?.focus();
                }}
              >
                Voltar
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
