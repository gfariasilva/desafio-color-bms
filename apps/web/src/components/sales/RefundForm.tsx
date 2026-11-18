import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  calculateRefundAmounts,
  createRefundInputSchema,
  formatCents,
  formatCivilDate,
  formatMoneyInput,
  formatRatePercent,
  parseMoneyText,
  refundableCents,
  refundLimitError,
  REFUND_REASON_MAX,
  SALE_TEXTS,
  type ParsedCreateRefundInput,
  type Sale,
} from "@color-bms/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeSale } from "./describe-sale";

interface RefundFormProps {
  /** The sale being refunded (from an earlier day). */
  sale: Sale;
  /** Today's civil date: where the refund is registered (FR-04). */
  today: string;
  pending: boolean;
  /** Changes each time "Estornar" is pressed, even on the same sale: focus moves to Valor. */
  focusRequest: number;
  /** The server's answer to the last attempt, if it failed. */
  serverError: string | null;
  onSubmit: (input: ParsedCreateRefundInput) => void;
  onCancel: () => void;
  /** The owner typed again or submitted: the last server error no longer applies. */
  onEdit: () => void;
}

/**
 * FR-04: refund all or part of a sale from an earlier day. Valor starts with what is left to
 * refund (RN-04), Motivo is required; Enter submits, Esc cancels. The preview uses the same
 * core rule as the server: the original rate, fee rounded on the absolute value.
 */
export function RefundForm({
  sale,
  today,
  pending,
  focusRequest,
  serverError,
  onSubmit,
  onCancel,
  onEdit,
}: RefundFormProps) {
  const left = refundableCents(sale.grossCents, sale.refundedCents);
  const [value, setValue] = useState(() => formatMoneyInput(left));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valueField = useRef<HTMLInputElement>(null);

  // NFR-05: focus on Valor when the form opens and whenever "Estornar" is pressed again.
  useEffect(() => valueField.current?.focus(), [focusRequest]);

  const preview = useMemo(() => {
    const cents = parseMoneyText(value);
    if (
      cents === null ||
      cents <= 0 ||
      refundLimitError(sale.grossCents, sale.refundedCents, cents)
    )
      return null;
    const amounts = calculateRefundAmounts(cents, sale.feeRatePpm);
    const fee =
      sale.feeRatePpm === 0
        ? "Sem taxa"
        : `Taxa ${formatRatePercent(sale.feeRatePpm)} · ${formatCents(amounts.feeCents)}`;
    return `Bruto ${formatCents(amounts.grossCents)} · ${fee} · Líquido ${formatCents(amounts.netCents)}`;
  }, [value, sale]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    onEdit();
    const refundCents = parseMoneyText(value);
    if (refundCents === null) return setError(SALE_TEXTS.invalidValue);
    const parsed = createRefundInputSchema.safeParse({ refundCents, reason });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    const limitError = refundLimitError(sale.grossCents, sale.refundedCents, refundCents);
    if (limitError) return setError(limitError);
    setError(null);
    onSubmit(parsed.data);
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
    }
  }

  const shownError = error ?? serverError;

  return (
    <Card className="mb-4 border-destructive/40">
      <CardContent className="p-4">
        <form
          onSubmit={submit}
          onKeyDown={cancelOnEscape}
          noValidate
          className="space-y-3"
          aria-label="Estornar venda"
        >
          <p className="text-sm font-medium">
            Estornar a venda de {formatCivilDate(sale.date)} {describeSale(sale)} (
            {sale.saleCategoryName}, {sale.paymentMethodName}) · restam {formatCents(left)} · o
            estorno entra em {formatCivilDate(today)} · Esc cancela
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40 space-y-1.5">
              <Label htmlFor="refund-value">Valor do estorno (R$)</Label>
              <Input
                id="refund-value"
                ref={valueField}
                inputMode="decimal"
                autoComplete="off"
                className="text-right tabular-nums"
                value={value}
                // Typing replaces the suggested full value.
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setValue(event.target.value);
                  onEdit();
                }}
              />
            </div>
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="refund-reason">Motivo</Label>
              <Input
                id="refund-reason"
                autoComplete="off"
                maxLength={REFUND_REASON_MAX}
                placeholder="ex.: produto com defeito"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  onEdit();
                }}
              />
            </div>
            <Button type="submit" variant="destructive" disabled={pending}>
              Estornar
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
              Cancelar
            </Button>
          </div>
          <p data-testid="refund-preview" className="text-sm tabular-nums text-muted-foreground">
            {preview}
          </p>
          {shownError ? (
            <p role="alert" className="text-sm text-destructive">
              {shownError}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
