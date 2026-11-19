import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { useReportMonth } from "./use-report-month";

/** The "Mês" field: focused on load (NFR-05, the only field), never past the current month. */
export function ReportMonthField({
  monthText,
  setMonthText,
  currentMonth,
}: Pick<ReturnType<typeof useReportMonth>, "monthText" | "setMonthText" | "currentMonth">) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="w-44 space-y-1.5">
      <Label htmlFor="report-month">Mês</Label>
      <Input
        ref={input}
        id="report-month"
        type="month"
        max={currentMonth}
        value={monthText}
        onChange={(event) => setMonthText(event.target.value)}
      />
    </div>
  );
}

/** The loading and error lines shared by the month reports. */
export function ReportMonthStatus({
  todayFailed,
  monthText,
  yearMonth,
  isLoading,
  isError,
  what,
}: {
  todayFailed: boolean;
  monthText: string;
  yearMonth: string | null;
  isLoading: boolean;
  isError: boolean;
  /** e.g. "o relatório de entradas". */
  what: string;
}) {
  return (
    <>
      {todayFailed ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar o mês atual. Recarregue a página.
        </p>
      ) : null}
      {yearMonth === null && monthText !== "" ? (
        <p role="alert" className="text-sm text-destructive">
          Escolha um mês válido.
        </p>
      ) : null}
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar {what}. Recarregue a página.
        </p>
      ) : null}
    </>
  );
}
