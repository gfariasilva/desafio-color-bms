import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  formatYearMonth,
  formatYearMonthLong,
  monthOf,
  type MonthClosingResponse,
  type ReopenMonthInput,
} from "@color-bms/core";
import { Button } from "@/components/ui/button";
import { api, QUERY_KEYS } from "@/lib/api";
import { MonthClosingPanel } from "./MonthClosingPanel";

interface MonthClosingSectionProps {
  /** Today's civil date from the server (RN-15). */
  today: string;
  /** The month of the day chosen above; the section follows it when it changes. */
  initialMonth: string;
  /** Refreshes the screens that show a lock (days, sales, expenses, sangrias). */
  onChanged: () => Promise<unknown>;
}

/**
 * FR-16 / FR-17: "Fechamento do mês" on the Fechamento page. Starts on the month of the chosen
 * day; the arrows move to other months (never past the current one).
 */
export function MonthClosingSection({ today, initialMonth, onChanged }: MonthClosingSectionProps) {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(initialMonth);
  const [saved, setSaved] = useState<string | null>(null);
  const currentMonth = monthOf(today);

  // Choosing another day above shows that day's month.
  useEffect(() => setMonth(initialMonth), [initialMonth]);
  // A message about one month never stays on screen once the section shows another.
  useEffect(() => setSaved(null), [month]);

  const query = useQuery({
    queryKey: [...QUERY_KEYS.monthClosing, month],
    queryFn: () => api.monthClosing.month(month),
  });

  async function apply(change: () => Promise<MonthClosingResponse>, message: string) {
    let result: MonthClosingResponse;
    try {
      result = await change();
    } catch (failure) {
      // The server refused (a day changed, closed elsewhere): show the month as it is now.
      void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.monthClosing, month] });
      throw failure;
    }
    queryClient.setQueryData([...QUERY_KEYS.monthClosing, month], result);
    setSaved(message);
    // RN-14: the lock changed for every day, sale, expense and bill of the month.
    await Promise.all([
      onChanged(),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fixedExpenses }),
    ]);
  }

  const label = formatYearMonth(month);

  return (
    <section aria-labelledby="month-closing-title" className="mt-10 border-t pt-6">
      <h2 id="month-closing-title" className="mb-3 text-base font-semibold">
        Fechamento do mês
      </h2>

      <div className="mb-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Mês anterior"
          title="Mês anterior"
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-36 text-center font-medium" aria-live="polite">
          {formatYearMonthLong(month)}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label="Próximo mês"
          title="Próximo mês"
          disabled={month >= currentMonth}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight />
        </Button>
      </div>

      <p role="status" className="mb-2 min-h-5 text-sm text-muted-foreground">
        {saved}
      </p>

      {query.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar o fechamento do mês. Recarregue a página.
        </p>
      ) : null}
      {query.data ? (
        <MonthClosingPanel
          key={query.data.yearMonth}
          month={query.data}
          today={today}
          onClose={() => apply(() => api.monthClosing.close(month), `Mês ${label} fechado.`)}
          onReopen={(input: ReopenMonthInput) =>
            apply(
              () => api.monthClosing.reopen(month, input),
              `Mês ${label} reaberto. Os dias continuam fechados; reabra um a um se precisar.`,
            )
          }
        />
      ) : null}
    </section>
  );
}
