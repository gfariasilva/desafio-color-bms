import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { formatCents, formatCivilDate, isCivilDate, type DayReportResponse } from "@color-bms/core";
import { CashLine } from "@/components/cash-closing/CashLine";
import { ClosedDaySummary } from "@/components/cash-closing/ClosedDaySummary";
import { PageHeader } from "@/components/layout/PageHeader";
import { DayReportMatrix } from "@/components/reports/DayReportMatrix";
import { DayReportExpenses, DayReportWithdrawals } from "@/components/reports/DayReportOutflows";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, QUERY_KEYS } from "@/lib/api";

/**
 * Relatórios › Dia (FR-19): everything about one day on one screen: the tab × payment
 * method matrix with gross, fee and net and its totals (RN-05), the day's expenses and
 * sangrias, and the cash closing (RN-07) when the day is closed. It is the comparison tool of
 * the parallel period (CS-3): tabs are in the owner's order, so the check is line by line.
 *
 * The date starts as the server's today, or the one in the link (`?data=YYYY-MM-DD`), and
 * stays in the address so the page can be reloaded or bookmarked.
 */
export function DayReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedDate = searchParams.get("data");
  const [dateText, setDateText] = useState(linkedDate && isCivilDate(linkedDate) ? linkedDate : "");
  const dateInput = useRef<HTMLInputElement>(null);

  const today = useQuery({ queryKey: QUERY_KEYS.today, queryFn: api.today });

  // A new link to another day (while this page is open) opens that day.
  useEffect(() => {
    if (linkedDate && isCivilDate(linkedDate)) setDateText(linkedDate);
  }, [linkedDate]);

  // NFR-05: keyboard-first, the date is the only field.
  useEffect(() => dateInput.current?.focus(), []);

  // RN-15: without a link, start on the server's today.
  useEffect(() => {
    const todayDate = today.data;
    if (todayDate) setDateText((current) => (current === "" ? todayDate : current));
  }, [today.data]);

  const date = isCivilDate(dateText) ? dateText : null;

  // Keep the chosen day in the address (replace: the date field is not navigation history).
  useEffect(() => {
    if (date && date !== searchParams.get("data")) {
      setSearchParams({ data: date }, { replace: true });
    }
  }, [date, searchParams, setSearchParams]);

  const report = useQuery({
    queryKey: [...QUERY_KEYS.dayReport, date],
    queryFn: () => api.reports.day(date as string),
    enabled: date !== null,
  });
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Relatório do dia"
        description="Abas × formas de pagamento, saídas, sangrias e fechamento de caixa."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44 space-y-1.5">
          <Label htmlFor="report-date">Data</Label>
          <Input
            ref={dateInput}
            id="report-date"
            type="date"
            max={today.data}
            value={dateText}
            onChange={(event) => setDateText(event.target.value)}
          />
        </div>
        {/* A-15: only days with movement are closed; an empty or future day has no status. */}
        {data && (data.hasMovement || data.closing) ? (
          <Badge variant={data.status === "closed" ? "secondary" : "outline"} className="mb-2">
            {data.status === "closed" ? "Dia fechado" : "Dia aberto"}
          </Badge>
        ) : null}
      </div>

      {today.isError && dateText === "" ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar a data de hoje. Recarregue a página.
        </p>
      ) : null}
      {date === null && dateText !== "" ? (
        <p role="alert" className="text-sm text-destructive">
          Escolha uma data válida.
        </p>
      ) : null}
      {report.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {report.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar o relatório do dia. Recarregue a página.
        </p>
      ) : null}

      {data ? (
        <div className="space-y-6">
          {data.hasMovement ? null : (
            <p className="text-sm text-muted-foreground">
              Sem movimento em {formatCivilDate(data.date)}: nenhuma venda, saída ou sangria.
            </p>
          )}

          <section aria-labelledby="report-sales-title" className="space-y-2">
            <h2 id="report-sales-title" className="text-base font-semibold">
              Vendas por aba e forma de pagamento
            </h2>
            <DayReportMatrix matrix={data.matrix} />
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section aria-labelledby="report-expenses-title" className="space-y-2">
              <h2 id="report-expenses-title" className="text-base font-semibold">
                Saídas
              </h2>
              <DayReportExpenses report={data} />
            </section>
            <section aria-labelledby="report-withdrawals-title" className="space-y-2">
              <h2 id="report-withdrawals-title" className="text-base font-semibold">
                Sangrias
              </h2>
              <DayReportWithdrawals report={data} />
            </section>
          </div>

          <section aria-labelledby="report-closing-title" className="space-y-2">
            <h2 id="report-closing-title" className="text-base font-semibold">
              Fechamento de caixa
            </h2>
            {data.closing ? (
              <ClosedDaySummary day={{ ...data.cash, closing: data.closing }} />
            ) : (
              <OpenDayCash report={data} />
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

/**
 * An open day has no closing yet (FR-08): show the RN-07 terms so far, without the opening
 * and counted cash, and a link to close it.
 */
function OpenDayCash({ report }: { report: DayReportResponse }) {
  return (
    <Card className="max-w-xl">
      <CardContent className="p-4">
        <CashLine sign="+" label="Vendas em dinheiro (líquidas de estornos)">
          {formatCents(report.cash.cashSalesCents)}
        </CashLine>
        <CashLine sign="−" label="Despesas pagas do caixa">
          {formatCents(report.cash.tillExpensesCents)}
        </CashLine>
        <CashLine sign="−" label="Sangrias">
          {formatCents(report.cash.withdrawalsCents)}
        </CashLine>
        <p className="mt-3 text-sm text-muted-foreground">
          O dia ainda não foi fechado: o troco inicial, o dinheiro contado e a diferença aparecem
          depois do fechamento.{" "}
          {report.hasMovement ? (
            <Link
              to={`/fechamento?data=${report.date}`}
              aria-label={`Fechar o dia ${formatCivilDate(report.date)}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Fechar o dia
            </Link>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}
