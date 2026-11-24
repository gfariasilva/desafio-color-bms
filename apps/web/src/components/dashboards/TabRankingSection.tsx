import { useQuery } from "@tanstack/react-query";
import {
  formatCivilDate,
  formatDayRange,
  formatShare,
  formatYearMonthLong,
  type RankedTab,
  type TabRanking,
} from "@color-bms/core";
import { ReportMonthField, ReportMonthStatus } from "@/components/reports/ReportMonthField";
import { useReportMonth } from "@/components/reports/use-report-month";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, QUERY_KEYS } from "@/lib/api";
import { categoryColor } from "@/lib/category-colors";
import { MoneyCell } from "./MoneyCell";
import { monthName } from "./month-name";
import { TabRankingChart } from "./TabRankingChart";
import { TwoLineHead } from "./TwoLineHead";
import { VariationCell } from "./VariationCell";

/**
 * FR-25: Dashboard "Quais abas vendem mais?". The tabs of the chosen month ranked by gross
 * income (RN-06, refunds included), with the share of the month and the RN-11 variation
 * against the same period of the previous month. The month field works like the month
 * reports' (`?mes=` in the address), but does not take the focus: FR-24 comes first.
 */
export function TabRankingSection() {
  const month = useReportMonth();
  const ranking = useQuery({
    queryKey: [...QUERY_KEYS.tabRanking, month.yearMonth],
    queryFn: () => api.dashboards.tabRanking(month.yearMonth as string),
    enabled: month.yearMonth !== null,
  });

  return (
    <section aria-labelledby="tab-ranking-title" className="mb-8 max-w-4xl space-y-3">
      <h2 id="tab-ranking-title" className="text-base font-semibold">
        Quais abas vendem mais?
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <ReportMonthField {...month} autoFocus={false} />
      </div>
      <ReportMonthStatus
        {...month}
        isLoading={ranking.isLoading}
        isError={ranking.isError}
        what="o ranking das abas"
      />
      {ranking.data ? <TabRankingView ranking={ranking.data} /> : null}
    </section>
  );
}

function TabRankingView({ ranking }: { ranking: TabRanking }) {
  const noPreviousSales = ranking.tabs.every((tab) => tab.previousCents === 0);
  const someDash = ranking.tabs.some((tab) => tab.variationTenths === null);

  return (
    <>
      <Card>
        <Table aria-label="Ranking das abas">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-right align-bottom">
                <abbr title="Posição" className="no-underline">
                  #
                </abbr>
              </TableHead>
              <TableHead className="align-bottom">Aba</TableHead>
              <TwoLineHead title="Entrada bruta" detail={formatDayRange(ranking.current)} />
              <TableHead className="text-right align-bottom">% do total</TableHead>
              <TwoLineHead title="Mês anterior" detail={formatDayRange(ranking.previous)} />
              <TableHead className="text-right align-bottom">Variação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranking.tabs.map((tab) => (
              <RankedTabRow key={tab.saleCategoryId} tab={tab} />
            ))}
          </TableBody>
          <tfoot className="border-t-2 bg-muted/30 font-medium">
            <TableRow>
              <TableCell />
              <TableHead scope="row">Total</TableHead>
              <MoneyCell cents={ranking.totalCents} />
              <TableCell className="text-right tabular-nums">
                {formatShare(ranking.totalCents > 0 ? 1000 : null)}
              </TableCell>
              <MoneyCell cents={ranking.previousTotalCents} />
              <VariationCell tenths={ranking.totalVariationTenths} />
            </TableRow>
          </tfoot>
        </Table>
      </Card>

      <div className="space-y-1 text-muted-foreground">
        <p>
          {ranking.partial
            ? `${monthName(ranking.yearMonth)} até hoje (${formatCivilDate(ranking.current.to)}), comparado com os mesmos dias de ${formatYearMonthLong(ranking.previousMonth)}.`
            : `${monthName(ranking.yearMonth)} completo, comparado com ${formatYearMonthLong(ranking.previousMonth)} completo.`}
        </p>
        {noPreviousSales ? (
          <p>“—” na variação: sem vendas no mês anterior.</p>
        ) : someDash ? (
          <p>“—” na variação: a aba não vendeu nada nesses dias do mês anterior.</p>
        ) : null}
        <p>
          Ranking por maior faturamento (entrada bruta), não lucro. Os estornos já estão
          descontados.
        </p>
      </div>

      {ranking.tabs.some((tab) => tab.grossCents !== 0) ? (
        <Card>
          <CardContent className="p-4">
            <TabRankingChart ranking={ranking} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function RankedTabRow({ tab }: { tab: RankedTab }) {
  return (
    <TableRow>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {tab.position}
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: categoryColor(tab.order - 1) }}
          />
          {tab.name}
          {tab.active ? null : <Badge variant="outline">Inativa</Badge>}
        </span>
      </TableCell>
      <MoneyCell cents={tab.grossCents} />
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {formatShare(tab.shareTenths)}
      </TableCell>
      <MoneyCell cents={tab.previousCents} />
      <VariationCell tenths={tab.variationTenths} />
    </TableRow>
  );
}
