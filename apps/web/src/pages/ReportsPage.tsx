import { CalendarDays } from "lucide-react";
import { HubLinkCard, UpcomingCard } from "@/components/layout/HubCards";
import { PageHeader } from "@/components/layout/PageHeader";
import { NAV_ITEMS } from "@/config/navigation";

const reportsArea = NAV_ITEMS.find((item) => item.path === "/relatorios");

/** Reports that later backlog items will build (shown so the owner knows what is coming). */
const UPCOMING = [
  { label: "Mês – Entradas e Despesas gerais", requirements: "FR-20, FR-21" },
  { label: "Mês – Despesas fixas e Resumo mensal", requirements: "FR-22, FR-23" },
];

/** Relatórios: entry point to the day report (FR-19) and, later, the month reports. */
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
        {UPCOMING.map((section) => (
          <UpcomingCard key={section.label} {...section} />
        ))}
      </div>
    </>
  );
}
