import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { isYearMonth } from "@color-bms/core";
import { api, QUERY_KEYS } from "@/lib/api";

/**
 * The month of a month report (FR-20, FR-21). It starts as the server's current month, or
 * the one in the link (`?mes=YYYY-MM`), and stays in the address so the page can be reloaded
 * or bookmarked. Returns the valid month (or null), and the field to render.
 */
export function useReportMonth() {
  const [searchParams, setSearchParams] = useSearchParams();
  const linked = searchParams.get("mes");
  const [monthText, setMonthText] = useState(linked && isYearMonth(linked) ? linked : "");

  const today = useQuery({ queryKey: QUERY_KEYS.today, queryFn: api.today });
  const currentMonth = today.data?.slice(0, 7);

  // A new link to another month (while this page is open) opens that month.
  useEffect(() => {
    if (linked && isYearMonth(linked)) setMonthText(linked);
  }, [linked]);

  // Without a link, start on the server's current month (ADR 0002).
  useEffect(() => {
    if (currentMonth) setMonthText((current) => (current === "" ? currentMonth : current));
  }, [currentMonth]);

  const yearMonth = isYearMonth(monthText) ? monthText : null;

  // Keep the chosen month in the address (replace: the field is not navigation history).
  useEffect(() => {
    if (yearMonth && yearMonth !== searchParams.get("mes")) {
      setSearchParams({ mes: yearMonth }, { replace: true });
    }
  }, [yearMonth, searchParams, setSearchParams]);

  return {
    yearMonth,
    monthText,
    setMonthText,
    currentMonth,
    todayFailed: today.isError && monthText === "",
  };
}
