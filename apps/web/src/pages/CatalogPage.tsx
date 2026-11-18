import { Tags, Wallet } from "lucide-react";
import { HubLinkCard, UpcomingCard } from "@/components/layout/HubCards";
import { PageHeader } from "@/components/layout/PageHeader";
import { NAV_ITEMS } from "@/config/navigation";

const catalogArea = NAV_ITEMS.find((item) => item.path === "/cadastros");

const SECTIONS = [
  {
    to: "/cadastros/abas",
    label: "Abas de venda",
    description: "As abas em que as vendas são registradas (Toner, Papelaria…).",
    icon: Tags,
  },
  {
    to: "/cadastros/categorias-despesa",
    label: "Categorias de despesa",
    description: "Categorias das saídas diárias, incluindo os fornecedores de materiais.",
    icon: Wallet,
  },
];

/** Sections that later backlog items will build (shown so the owner knows what is coming). */
const UPCOMING = [{ label: "Maquininhas, formas de pagamento e taxas", requirements: "FR-15" }];

/** Cadastros: entry point to the master-data lists (FR-14, FR-15). */
export function CatalogPage() {
  return (
    <>
      <PageHeader
        title={catalogArea?.label ?? "Cadastros"}
        description={catalogArea?.description}
      />
      <div className="grid max-w-xl gap-2">
        {SECTIONS.map((section) => (
          <HubLinkCard key={section.to} {...section} />
        ))}
        {UPCOMING.map((section) => (
          <UpcomingCard key={section.label} {...section} />
        ))}
      </div>
    </>
  );
}
