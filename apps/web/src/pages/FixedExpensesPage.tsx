import { CalendarCheck, ClipboardList } from "lucide-react";
import { HubLinkCard, UpcomingCard } from "@/components/layout/HubCards";
import { PageHeader } from "@/components/layout/PageHeader";
import { NAV_ITEMS } from "@/config/navigation";

const fixedExpensesArea = NAV_ITEMS.find((item) => item.path === "/despesas-fixas");

/** Sections that later backlog items will build (shown so the owner knows what is coming). */
const UPCOMING = [
  { label: "Pagar ou dispensar e parcelas de empréstimo", requirements: "FR-12, FR-13" },
];

/** Despesas fixas: entry point to the month's bills (FR-11) and the templates (FR-10). */
export function FixedExpensesPage() {
  return (
    <>
      <PageHeader
        title={fixedExpensesArea?.label ?? "Despesas fixas"}
        description={fixedExpensesArea?.description}
      />
      <div className="grid max-w-xl gap-2">
        <HubLinkCard
          to="/despesas-fixas/mes"
          label="Contas do mês"
          description="As contas a pagar de cada mês, geradas dos modelos, e as contas avulsas."
          icon={CalendarCheck}
        />
        <HubLinkCard
          to="/despesas-fixas/modelos"
          label="Modelos"
          description="As contas de todo mês (Luz, Aluguel, DAS…), com dia de vencimento, valor previsto e parcelas de empréstimo."
          icon={ClipboardList}
        />
        {UPCOMING.map((section) => (
          <UpcomingCard key={section.label} {...section} />
        ))}
      </div>
    </>
  );
}
