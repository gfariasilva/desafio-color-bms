import { formatCents, formatInstant, type DayCashClosingResponse } from "@color-bms/core";
import { Card, CardContent } from "@/components/ui/card";
import { CashLine } from "./CashLine";
import { DifferenceBadge } from "./DifferenceBadge";

/**
 * FR-08: a closed day, read-only: the stored closing (opening, expected, counted, difference,
 * note) with the RN-07 terms in between. Changing it needs a reopening (FR-09, #10).
 */
export function ClosedDaySummary({
  day,
}: {
  day: DayCashClosingResponse & { closing: NonNullable<DayCashClosingResponse["closing"]> };
}) {
  const { closing } = day;
  return (
    <Card className="max-w-xl">
      <CardContent className="p-4">
        <CashLine label="Troco inicial" testId="opening-cash">
          {formatCents(closing.openingCashCents)}
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
          {formatCents(closing.expectedCashCents)}
        </CashLine>
        <CashLine label="Dinheiro contado" testId="counted-cash" strong>
          {formatCents(closing.countedCashCents)}
        </CashLine>
        <CashLine label="Diferença" testId="difference">
          <DifferenceBadge differenceCents={closing.differenceCents} />
        </CashLine>
        {closing.note ? (
          <CashLine label="Observação">
            <span className="whitespace-normal">{closing.note}</span>
          </CashLine>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">
          Fechado em {formatInstant(closing.closedAt)}. Para alterar lançamentos deste dia, é
          preciso reabri-lo.
        </p>
      </CardContent>
    </Card>
  );
}
