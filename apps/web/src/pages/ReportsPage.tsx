import { CalendarCheck, CalendarDays, CalendarRange, Receipt, Scale } from "lucide-react";
import { HubLinkCard } from "@/components/layout/HubCards";
import { PageHeader } from "@/components/layout/PageHeader";
import { NAV_ITEMS } from "@/config/navigation";

const reportsArea = NAV_ITEMS.find((item) => item.path === "/relatorios");

/** Relatórios: entry point to the day report (FR-19) and the month reports (FR-20 to FR-23). */
export function ReportsPage() {
  return (
    <>
      <PageHeader
        title={reportsArea?.label ?? "Relatórios"}
        description={reportsArea?.description}
      />
      <div className="grid max-w-xl gap-2">
        <HubLinkCard
          to="/relatorios/dia"
          label="Relatório do dia"
          description="Abas × formas de pagamento (bruto, taxa e líquido), saídas, sangrias e o fechamento de caixa."
          icon={CalendarDays}
        />
        <HubLinkCard
          to="/relatorios/mes/entradas"
          label="Mês – Entradas"
          description="Grade dias × abas, totais por forma de pagamento, Entrada mensal, taxas e líquido."
          icon={CalendarRange}
        />
        <HubLinkCard
          to="/relatorios/mes/despesas-gerais"
          label="Mês – Despesas gerais"
          description="Total de cada categoria, o grupo Fornecedores de materiais e o total geral, com os lançamentos."
          icon={Receipt}
        />
        <HubLinkCard
          to="/relatorios/mes/despesas-fixas"
          label="Mês – Despesas fixas"
          description="Contas de Gerais e Taxas governo: vencimento, previsto, pago e status, o total pago no mês e o pendente."
          icon={CalendarCheck}
        />
        <HubLinkCard
          to="/relatorios/mes/resumo"
          label="Mês – Resumo mensal"
          description="Entrada mensal, taxas, despesas gerais e fixas, total de despesas e o Saldo mensal."
          icon={Scale}
        />
      </div>
    </>
  );
}
