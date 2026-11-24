import { useQuery } from "@tanstack/react-query";
import {
  formatCivilDate,
  formatDayRange,
  formatYearMonthLong,
  type MonthComparison,
  type MonthComparisonIndicator,
} from "@color-bms/core";
import { IncomeVsExpensesSection } from "@/components/dashboards/IncomeVsExpensesSection";
import { MoneyCell } from "@/components/dashboards/MoneyCell";
import { monthName } from "@/components/dashboards/month-name";
import { MonthComparisonChart } from "@/components/dashboards/MonthComparisonChart";
import { TabRankingSection } from "@/components/dashboards/TabRankingSection";
import { TwoLineHead } from "@/components/dashboards/TwoLineHead";
import { VariationCell } from "@/components/dashboards/VariationCell";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { cn } from "@/lib/utils";

/**
 * Dashboards (FR-24 to FR-26), one section per question of the spec:
 * - FR-24: this month up to today against the same days of the previous month (A-13), with the
 *   RN-11 variation and the whole previous month as a reference;
 * - FR-25: the tabs ranked by gross income in a chosen month (`TabRankingSection`);
 * - FR-26: daily income × expenses over the last 7 or 30 days (`IncomeVsExpensesSection`).
 * The data refetches every time the page opens (TanStack Query's stale time is 0).
 */
export function DashboardsPage() {
  const comparison = useQuery({
    queryKey: QUERY_KEYS.monthComparison,
    queryFn: api.dashboards.monthComparison,
  });

  return (
    <>
      <PageHeader
        title="Dashboards"
        description="Comparação com o mês anterior, ranking das abas e entradas × despesas."
      />
      <section aria-labelledby="month-comparison-title" className="mb-8 max-w-4xl space-y-3">
        <h2 id="month-comparison-title" className="text-base font-semibold">
          Como está este mês comparado ao anterior?
        </h2>
        {comparison.isLoading ? <p className="text-muted-foreground">Carregando…</p> : null}
        {comparison.isError ? (
          <p role="alert" className="text-destructive">
            Não foi possível carregar a comparação com o mês anterior. Recarregue a página.
          </p>
        ) : null}
        {comparison.data ? <MonthComparisonView comparison={comparison.data} /> : null}
      </section>
      <TabRankingSection />
      <IncomeVsExpensesSection />
    </>
  );
}

function MonthComparisonView({ comparison }: { comparison: MonthComparison }) {
  const previousName = monthName(comparison.previousMonth);
  const someZeroPrevious = comparison.indicators.some((i) => i.variationTenths === null);

  return (
    <>
      <Card>
        <Table aria-label="Este mês × mês anterior">
          <TableHeader>
            <TableRow>
              <TableHead className="align-bottom">Indicador</TableHead>
              <TwoLineHead title="Este mês" detail={formatDayRange(comparison.current)} />
              <TwoLineHead title="Mês anterior" detail={formatDayRange(comparison.previous)} />
              <TableHead className="text-right align-bottom">Variação</TableHead>
              <TwoLineHead title={`${previousName} completo`} detail="referência" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.indicators.map((indicator) => (
              <IndicatorRow key={indicator.key} indicator={indicator} />
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="space-y-1 text-muted-foreground">
        <p>
          Mês em andamento: valores até hoje ({formatCivilDate(comparison.today)}), comparados com
          os mesmos dias de {formatYearMonthLong(comparison.previousMonth)}.
        </p>
        {!comparison.previousMonthHasData ? (
          <p>“—” na variação: sem dados do mês anterior.</p>
        ) : someZeroPrevious ? (
          <p>“—” na variação: o mês anterior não teve valor nesses dias.</p>
        ) : null}
        <p>As sangrias não entram (movimentação interna), nem as despesas fixas pendentes.</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <MonthComparisonChart comparison={comparison} />
        </CardContent>
      </Card>
    </>
  );
}

function IndicatorRow({ indicator }: { indicator: MonthComparisonIndicator }) {
  const isBalance = indicator.key === "balance";
  return (
    <TableRow className={cn(isBalance && "font-semibold")}>
      <TableCell>
        <span className="flex items-center gap-2">
          {indicator.label}
          {isBalance && indicator.currentCents < 0 ? (
            <Badge variant="destructive">Saldo negativo</Badge>
          ) : null}
        </span>
      </TableCell>
      <MoneyCell
        cents={indicator.currentCents}
        negative={isBalance && indicator.currentCents < 0}
      />
      <MoneyCell
        cents={indicator.previousCents}
        negative={isBalance && indicator.previousCents < 0}
      />
      <VariationCell tenths={indicator.variationTenths} />
      <MoneyCell
        cents={indicator.previousMonthTotalCents}
        negative={isBalance && indicator.previousMonthTotalCents < 0}
      />
    </TableRow>
  );
}
