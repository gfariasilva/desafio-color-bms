import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  formatCivilDate,
  isCivilDate,
  type CloseDayInput,
  type DayCashClosingResponse,
} from "@color-bms/core";
import { CashClosingForm } from "@/components/cash-closing/CashClosingForm";
import { ClosedDaySummary } from "@/components/cash-closing/ClosedDaySummary";
import { UpcomingCard } from "@/components/layout/HubCards";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NAV_ITEMS } from "@/config/navigation";
import { api, QUERY_KEYS } from "@/lib/api";

const area = NAV_ITEMS.find((item) => item.path === "/fechamento");

/**
 * Fechamento (FR-08): the cash closing of a day. The date starts as the server's today, or the
 * day in the link (`?data=YYYY-MM-DD`, from the Início alert, FR-27). An open day with
 * movement shows the closing form; a closed day shows its stored closing; any other day says
 * why it cannot be closed (future, closed month, no movement).
 */
export function ClosingPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const linkedDate = searchParams.get("data");
  const [dateText, setDateText] = useState(linkedDate && isCivilDate(linkedDate) ? linkedDate : "");
  const [saved, setSaved] = useState<string | null>(null);

  const today = useQuery({ queryKey: QUERY_KEYS.today, queryFn: api.today });

  // A new link (e.g. another alert) opens its day.
  useEffect(() => {
    if (linkedDate && isCivilDate(linkedDate)) setDateText(linkedDate);
  }, [linkedDate]);

  // RN-15: without a link, start on the server's today.
  useEffect(() => {
    const todayDate = today.data;
    if (todayDate) setDateText((current) => (current === "" ? todayDate : current));
  }, [today.data]);

  // A message about one day never stays on screen once the page shows another day.
  useEffect(() => setSaved(null), [dateText]);

  const date = isCivilDate(dateText) ? dateText : null;
  const day = useQuery({
    queryKey: [...QUERY_KEYS.cashClosingDay, date],
    queryFn: () => api.cashClosing.day(date as string),
    enabled: date !== null,
  });

  async function close(closeDate: string, input: CloseDayInput) {
    const closed: DayCashClosingResponse = await api.cashClosing.close(closeDate, input);
    queryClient.setQueryData([...QUERY_KEYS.cashClosingDay, closeDate], closed);
    setSaved(`Dia ${formatCivilDate(closeDate)} fechado.`);
    // RN-14: the day is now locked on every screen; FR-27: it leaves the Início alert.
    await Promise.all(
      [
        QUERY_KEYS.cashClosing,
        QUERY_KEYS.sales,
        QUERY_KEYS.expenses,
        QUERY_KEYS.cashWithdrawals,
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  }

  const data = day.data;

  return (
    <>
      <PageHeader title={area?.label ?? "Fechamento"} description={area?.description} />

      <section aria-labelledby="cash-closing-title">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="cash-closing-title" className="text-base font-semibold">
            Fechamento de caixa
          </h2>
          {data?.closing ? <Badge variant="secondary">Dia fechado</Badge> : null}
        </div>

        <div className="mb-4 w-44 space-y-1.5">
          <Label htmlFor="closing-date">Data</Label>
          <Input
            id="closing-date"
            type="date"
            max={today.data}
            value={dateText}
            onChange={(event) => setDateText(event.target.value)}
          />
        </div>

        <p role="status" className="mb-2 min-h-5 text-sm text-muted-foreground">
          {saved}
        </p>

        {date === null && dateText !== "" ? (
          <p role="alert" className="text-sm text-destructive">
            Escolha uma data válida.
          </p>
        ) : null}
        {day.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        {day.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar o fechamento do dia. Recarregue a página.
          </p>
        ) : null}
        {data?.closing ? (
          <ClosedDaySummary day={{ ...data, closing: data.closing }} />
        ) : data?.blocked ? (
          <p className="text-sm text-muted-foreground">{data.blocked}</p>
        ) : data ? (
          <CashClosingForm
            key={data.date}
            day={data}
            onClose={(input) => close(data.date, input)}
          />
        ) : null}
      </section>

      <div className="mt-8 grid max-w-xl gap-2">
        <UpcomingCard label="Reabrir dia" requirements="FR-09" />
        <UpcomingCard label="Fechamento do mês" requirements="FR-16, FR-17" />
      </div>
    </>
  );
}
