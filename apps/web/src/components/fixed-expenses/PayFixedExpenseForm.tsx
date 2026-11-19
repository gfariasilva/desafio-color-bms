import { useState, type FormEvent, type KeyboardEvent } from "react";
import {
  EXPENSE_PAYMENT_MEANS,
  EXPENSE_PAYMENT_MEANS_LABELS,
  fixedExpenseInstallmentLabel,
  formatCents,
  formatMoneyInput,
  formatYearMonthLong,
  parseMoneyText,
  payFixedExpenseBlock,
  payFixedExpenseInputSchema,
  type ExpensePaymentMeans,
  type FixedExpense,
  type PayFixedExpenseInput,
} from "@color-bms/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The ChoiceGroup works with numbers: means n of A-14 is option n (1-based), as on Saídas. */
const MEANS_OPTIONS = EXPENSE_PAYMENT_MEANS.map((means, index) => ({
  value: index + 1,
  label: EXPENSE_PAYMENT_MEANS_LABELS[means],
}));

const VALUE_MESSAGE = "Informe o valor pago, por exemplo 187,43.";

export interface PayFixedExpenseFormProps {
  expense: FixedExpense;
  /** The server's today (RN-15): the default payment date and the date field's maximum. */
  today: string;
  pending: boolean;
  /** The server's error, shown in the form's alert line. */
  serverError: string | null;
  onSubmit: (input: PayFixedExpenseInput) => void;
  onCancel: () => void;
}

/**
 * FR-12: "Pagar" a bill of the month, as a compact card above the list (design system
 * "secondary action panel"). Fields in the Saídas order: Data (today) then Valor, focused and
 * pre-filled with the expected amount (selected, so typing replaces it); Tab goes from Valor
 * to the means. Means: digits 1–5 (A-14); "Pago com dinheiro do caixa" only
 * with Dinheiro, yes by default (FR-06, RN-07). Enter pays, Esc cancels.
 */
export function PayFixedExpenseForm({
  expense,
  today,
  pending,
  serverError,
  onSubmit,
  onCancel,
}: PayFixedExpenseFormProps) {
  const [value, setValue] = useState(
    expense.expectedAmountCents === null ? "" : formatMoneyInput(expense.expectedAmountCents),
  );
  const [date, setDate] = useState(today);
  const [means, setMeans] = useState<ExpensePaymentMeans | null>(null);
  const [paidFromTill, setPaidFromTill] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isCash = means === "cash";
  const installment = fixedExpenseInstallmentLabel(expense);

  function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = parseMoneyText(value);
    if (amountCents === null) return setError(VALUE_MESSAGE);
    // The same schema and rule as the server, so the messages are the same (FR-12).
    const parsed = payFixedExpenseInputSchema.safeParse({
      amountCents,
      paymentDate: date,
      paymentMeans: means ?? undefined,
      paidFromTill: isCash ? paidFromTill : false,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
    // Only the future date here: the server knows which days are closed (A-16).
    const block = payFixedExpenseBlock(expense, parsed.data.paymentDate, today, {
      dayClosed: false,
      monthClosed: false,
    });
    if (block) return setError(block.message);
    setError(null);
    onSubmit(parsed.data);
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onCancel();
  }

  const shownError = error ?? serverError;

  return (
    <Card className="mb-4 border-primary/40">
      <CardContent className="p-4">
        <form
          onSubmit={submit}
          onKeyDown={cancelOnEscape}
          noValidate
          className="space-y-4"
          aria-label={`Pagar ${expense.label}`}
        >
          <p className="text-sm font-medium">
            Pagar {expense.label} ({formatYearMonthLong(expense.referenceMonth)})
            {installment ? ` · ${installment}` : ""}
            {expense.expectedAmountCents === null
              ? ""
              : ` · previsto ${formatCents(expense.expectedAmountCents)}`}{" "}
            · Esc cancela
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40 space-y-1.5">
              <Label htmlFor="pay-date">Data do pagamento</Label>
              <Input
                id="pay-date"
                type="date"
                max={today}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor="pay-value">Valor pago (R$)</Label>
              <Input
                id="pay-value"
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                className="text-right tabular-nums"
                value={value}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
          </div>

          <ChoiceGroup
            label="Meio de pagamento"
            options={MEANS_OPTIONS}
            value={means ? EXPENSE_PAYMENT_MEANS.indexOf(means) + 1 : null}
            onChange={(option) => setMeans(EXPENSE_PAYMENT_MEANS[option - 1] ?? null)}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="pay-from-till"
              className="flex h-9 items-center gap-2 text-sm font-medium has-[:disabled]:opacity-50"
            >
              <input
                id="pay-from-till"
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                checked={isCash && paidFromTill}
                disabled={!isCash}
                onChange={(event) => setPaidFromTill(event.target.checked)}
                onKeyDown={(event) => {
                  // Enter submits from every field (design system), checkboxes included.
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
              Pago com dinheiro do caixa
            </label>
            <Button type="submit" disabled={pending}>
              Pagar
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
              Cancelar
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            A conta entra nas despesas fixas do mês da data do pagamento (regime de caixa).
            {isCash && paidFromTill ? " Ela reduz o dinheiro esperado no fechamento do dia." : ""}
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
