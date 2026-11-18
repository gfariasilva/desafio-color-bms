import { CreditCard, Percent, Tags, Wallet, WalletCards } from "lucide-react";
import { HubLinkCard } from "@/components/layout/HubCards";
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
  {
    to: "/cadastros/formas-pagamento",
    label: "Formas de pagamento",
    description: "Dinheiro, cartões, PIX, boleto: se usam maquininha e se podem ser parceladas.",
    icon: WalletCards,
  },
  {
    to: "/cadastros/maquininhas",
    label: "Maquininhas",
    description: "Os terminais de cartão (PagSeguro, Mercado Pago…).",
    icon: CreditCard,
  },
  {
    to: "/cadastros/taxas",
    label: "Tabela de taxas",
    description:
      "A taxa de cada maquininha por forma de pagamento e parcelas, com a data de início.",
    icon: Percent,
  },
];

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
      </div>
    </>
  );
}
