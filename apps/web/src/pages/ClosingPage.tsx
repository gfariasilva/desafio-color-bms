import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  formatCivilDate,
  isCivilDate,
  monthOf,
  type CloseDayInput,
  type DayCashClosingResponse,
  type ReopenDayInput,
} from "@color-bms/core";
import { CashClosingForm } from "@/components/cash-closing/CashClosingForm";
import { ClosedDaySummary } from "@/components/cash-closing/ClosedDaySummary";
import { MonthClosingSection } from "@/components/cash-closing/MonthClosingSection";
import { ReopenDayPanel } from "@/components/cash-closing/ReopenDayPanel";
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
 *
 * FR-09: a closed day offers "Reabrir dia" (confirmation + reason) while its month is open;
 * once reopened, the closing form shows again, since a new closing is required.
 *
 * FR-16 / FR-17: below, "Fechamento do mês" for the month of the chosen day (or another one).
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
    let closed: DayCashClosingResponse;
    try {
      closed = await api.cashClosing.close(closeDate, input);
    } catch (failure) {
      // The server refused (closed elsewhere, records changed): show the day as it is now.
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.cashClosingDay, closeDate] });
      throw failure;
    }
    queryClient.setQueryData([...QUERY_KEYS.cashClosingDay, closeDate], closed);
    setSaved(`Dia ${formatCivilDate(closeDate)} fechado.`);
    // RN-14: the day is now locked on every screen; FR-27: it leaves the Início alert.
    await refreshDayScreens();
  }

  async function reopen(reopenDate: string, input: ReopenDayInput) {
    let reopened: DayCashClosingResponse;
    try {
      reopened = await api.cashClosing.reopen(reopenDate, input);
    } catch (failure) {
      // The server refused (month closed, already reopened elsewhere): show the day as it is now.
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.cashClosingDay, reopenDate] });
      throw failure;
    }
    queryClient.setQueryData([...QUERY_KEYS.cashClosingDay, reopenDate], reopened);
    setSaved(
      `Dia ${formatCivilDate(reopenDate)} reaberto. Corrija os lançamentos e feche o dia de novo.`,
    );
    // RN-14: the day is unlocked on every screen; FR-27: an earlier day is back in the alert.
    await refreshDayScreens();
  }

  /** The screens that show a day's lock or its records. */
  function refreshDayScreens() {
    return Promise.all(
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
        {day.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        {day.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar o fechamento do dia. Recarregue a página.
          </p>
        ) : null}
        {data?.closing ? (
          <>
            <ClosedDaySummary day={{ ...data, closing: data.closing }} />
            {data.reopenBlocked ? (
              // RN-14: a day of a closed month needs the month reopened first (FR-17).
              <p className="mt-3 text-sm text-muted-foreground">{data.reopenBlocked}</p>
            ) : (
              <ReopenDayPanel
                key={data.date}
                date={data.date}
                onReopen={(input) => reopen(data.date, input)}
              />
            )}
          </>
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

      {today.data ? (
        <MonthClosingSection
          today={today.data}
          initialMonth={monthOf(date ?? today.data)}
          onChanged={refreshDayScreens}
        />
      ) : null}
    </>
  );
}
